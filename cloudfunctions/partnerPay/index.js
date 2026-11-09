const crypto = require("crypto");
const https = require("https");
const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const WXPAY_HOST = "api.mch.weixin.qq.com";
const RECONCILE_LIMIT = 20;
const RECONCILE_MIN_AGE_MS = 20 * 1000;
const RECONCILE_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const PAYMENT_EXPIRY_MS = 15 * 60 * 1000;
let platformCertificatesCache = { expiresAt: 0, certificates: new Map() };

exports.main = async (event = {}) => {
  const { action, payload = {} } = event;

  try {
    if (isTimerEvent(event)) {
      return await reconcilePendingOrders({ source: "timer" });
    }
    if (action === "createJsapiOrder") {
      return await createJsapiOrder(payload);
    }
    if (action === "confirmJsapiOrder") {
      return await confirmJsapiOrder(payload);
    }
    if (action === "refundJsapiOrder") {
      return await refundJsapiOrder(payload);
    }
    if (action === "reconcilePendingOrders") {
      assertInternalRequest(payload);
      return await reconcilePendingOrders({ source: "manual" });
    }
    if (action === "handlePaymentNotification") {
      return await handlePaymentNotification(payload);
    }

    return fail(`Unknown action: ${action || "empty"}`);
  } catch (error) {
    console.error("[partnerPay]", error);
    return fail(error.message || "微信支付下单失败");
  }
};

async function createJsapiOrder(payload = {}) {
  const config = readConfig();
  const wxContext = cloud.getWXContext();
  const openid = String(payload.openid || wxContext.OPENID || "").trim();
  const outTradeNo = String(payload.out_trade_no || payload.outTradeNo || "").trim();
  const description = String(payload.description || "爱娃披萨订单").trim().slice(0, 127);
  const total = Number(payload.amount?.total || payload.totalFee || 0);

  if (!openid) return fail("缺少小程序用户 openid，无法发起 JSAPI 支付。");
  if (!outTradeNo) return fail("缺少商户订单号 out_trade_no。");
  if (!Number.isInteger(total) || total <= 0) return fail("支付金额必须为大于 0 的整数分。");

  const requestBody = {
    mchid: config.mchid,
    appid: config.appid,
    description,
    out_trade_no: outTradeNo,
    notify_url: config.notifyUrl,
    amount: {
      total,
      currency: payload.amount?.currency || "CNY",
    },
    payer: {
      openid,
    },
  };

  if (payload.attach) requestBody.attach = String(payload.attach).slice(0, 128);

  const wxpayResult = await wxpayRequest({
    method: "POST",
    path: "/v3/pay/transactions/jsapi",
    body: requestBody,
    config,
  });

  const prepayId = wxpayResult.prepay_id;
  if (!prepayId) return fail("微信支付未返回 prepay_id。");

  const payment = buildMiniProgramPayment({
    appId: config.appid,
    prepayId,
    privateKey: config.privateKey,
  });

  return ok({
    payment,
    prepayId,
    outTradeNo,
  });
}

async function refundJsapiOrder(payload = {}) {
  const config = readConfig();
  const expectedSecret = requiredEnv("INTERNAL_PAYMENT_SECRET");
  if (!safeSecretEqual(payload.internalPaymentSecret, expectedSecret)) {
    return fail("退款调用授权无效。");
  }
  const outTradeNo = String(payload.out_trade_no || payload.outTradeNo || "").trim();
  const outRefundNo = String(payload.out_refund_no || payload.outRefundNo || "").trim();
  const refund = Number(payload.amount?.refund);
  const total = Number(payload.amount?.total);
  if (!outTradeNo || !outRefundNo) return fail("缺少微信支付订单号或退款单号。");
  if (!Number.isInteger(refund) || refund <= 0 || !Number.isInteger(total) || total <= 0 || refund > total) {
    return fail("退款金额无效。");
  }
  const result = await wxpayRequest({
    method: "POST",
    path: "/v3/refund/domestic/refunds",
    body: {
      out_trade_no: outTradeNo,
      out_refund_no: outRefundNo,
      reason: String(payload.reason || "顾客订单退款").trim().slice(0, 80),
      amount: { refund, total, currency: "CNY" },
    },
    config,
  });
  return ok({
    refundId: result.refund_id || "",
    outRefundNo,
    status: result.status || "PROCESSING",
  });
}

function safeSecretEqual(received, expected) {
  const left = Buffer.from(String(received || ""));
  const right = Buffer.from(String(expected || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

async function confirmJsapiOrder(payload = {}) {
  const config = readConfig();
  const outTradeNo = String(payload.out_trade_no || payload.outTradeNo || "").trim();
  if (!outTradeNo) return fail("缺少商户订单号 out_trade_no。");

  const payment = await queryJsapiOrder(outTradeNo, config);
  if (payment.trade_state !== "SUCCESS") {
    return fail(`微信支付尚未成功：${payment.trade_state_desc || payment.trade_state || "UNKNOWN"}`);
  }

  const paidTotal = Number(payment.amount?.total || 0);
  if (!Number.isInteger(paidTotal) || paidTotal <= 0) return fail("微信支付返回金额无效。");

  const payerOpenid = String(payment.payer?.openid || "").trim();
  if (!payerOpenid) return fail("微信支付未返回付款人身份。");
  const internalPaymentSecret = requiredEnv("INTERNAL_PAYMENT_SECRET");
  const attach = String(payment.attach || "").trim();

  if (attach.startsWith("recharge:")) {
    const memberId = attach.slice("recharge:".length).trim();
    if (!memberId) return fail("充值支付缺少会员标识。");
    const confirmedRecharge = await cloud.callFunction({
      name: process.env.MEMBERSHIP_FUNCTION || "membershipApi",
      data: {
        action: "confirmPaidMiniProgramRecharge",
        payload: {
          rechargeNo: outTradeNo,
          memberId,
          paidTotalInCents: paidTotal,
          payerOpenid,
          paymentTradeNo: payment.transaction_id || "",
          internalPaymentSecret,
        },
      },
    });
    if (!confirmedRecharge.result?.ok) return fail(confirmedRecharge.result?.message || "充值入账失败");
    return ok({
      type: "recharge",
      member: confirmedRecharge.result.member,
      transactionId: payment.transaction_id || "",
    });
  }

  const confirmed = await cloud.callFunction({
    name: process.env.MEMBERSHIP_FUNCTION || "membershipApi",
    data: {
      action: "confirmPaidMiniProgramOrder",
      payload: {
        orderNo: outTradeNo,
        paidTotalInCents: paidTotal,
        paymentMethod: "wechat_pay",
        paymentTradeNo: payment.transaction_id || "",
        payerOpenid,
        internalPaymentSecret,
      },
    },
  });
  if (!confirmed.result?.ok) return fail(confirmed.result?.message || "订单入账失败");
  return ok({ order: confirmed.result.order, transactionId: payment.transaction_id || "" });
}

async function reconcilePendingOrders({ source = "timer" } = {}) {
  const db = cloud.database();
  const now = Date.now();
  const result = await db.collection("orders")
    .where({
      status: "pending_payment",
      paymentStatus: "unpaid",
      paymentMethod: "wechat_pay",
    })
    .limit(100)
    .get();

  const candidates = (result.data || [])
    .filter((order) => shouldReconcileOrder(order, now))
    .slice(0, RECONCILE_LIMIT);
  const summary = { source, checked: 0, paid: 0, unpaid: 0, closed: 0, failed: 0, orders: [] };

  for (const order of candidates) {
    summary.checked += 1;
    try {
      const payment = await queryJsapiOrder(order.orderNo);
      if (payment.trade_state === "SUCCESS") {
        const confirmed = await confirmJsapiOrder({ out_trade_no: order.orderNo });
        if (!confirmed.ok) throw new Error(confirmed.message || "订单入账失败");
        summary.paid += 1;
        summary.orders.push({ orderNo: order.orderNo, state: "SUCCESS" });
      } else if (payment.trade_state === "CLOSED") {
        await markExpiredOrderCancelled(db, order, "微信支付订单已关闭");
        summary.closed += 1;
        summary.orders.push({ orderNo: order.orderNo, state: "CLOSED" });
      } else if (payment.trade_state === "NOTPAY" && isPaymentExpired(order, now)) {
        const closeResult = await closeExpiredOrder(db, order);
        if (closeResult === "SUCCESS") {
          summary.paid += 1;
        } else {
          summary.closed += 1;
        }
        summary.orders.push({ orderNo: order.orderNo, state: closeResult });
      } else {
        summary.unpaid += 1;
        const state = payment.trade_state || "UNKNOWN";
        summary.orders.push({ orderNo: order.orderNo, state });
        await recordPaymentCheck(db, order, payment.trade_state_desc || state);
      }
    } catch (error) {
      summary.failed += 1;
      summary.orders.push({ orderNo: order.orderNo, state: "ERROR" });
      await recordPaymentCheck(db, order, error.message || "ERROR");
      console.error("[partnerPay.reconcile]", order.orderNo, error);
    }
  }

  return ok(summary);
}

async function closeExpiredOrder(db, order) {
  const config = readConfig();
  try {
    await wxpayRequest({
      method: "POST",
      path: `/v3/pay/transactions/out-trade-no/${encodeURIComponent(order.orderNo)}/close`,
      body: { mchid: config.mchid },
      config,
    });
    await markExpiredOrderCancelled(db, order, "待支付超过15分钟，系统自动关闭");
    return "CLOSED";
  } catch (error) {
    // Payment may have completed between the preceding query and the close
    // request. Query again before changing any local order state.
    const latest = await queryJsapiOrder(order.orderNo, config);
    if (latest.trade_state === "SUCCESS") {
      const confirmed = await confirmJsapiOrder({ out_trade_no: order.orderNo });
      if (!confirmed.ok) throw new Error(confirmed.message || "订单入账失败");
      return "SUCCESS";
    }
    if (latest.trade_state === "CLOSED") {
      await markExpiredOrderCancelled(db, order, "待支付超过15分钟，微信支付订单已关闭");
      return "CLOSED";
    }
    throw error;
  }
}

async function markExpiredOrderCancelled(db, order, reason) {
  const now = new Date().toISOString();
  await db.collection("orders").doc(order._id || order.id).update({
    data: {
      status: "cancelled",
      paymentStatus: "unpaid",
      cancelledAt: now,
      paymentClosedAt: now,
      cancellationReason: reason,
      paymentLastCheckedAt: now,
      paymentCheckCount: Number(order.paymentCheckCount || 0) + 1,
      paymentLastCheckResult: "CLOSED",
      updatedAt: now,
    },
  });
}

function isPaymentExpired(order, now = Date.now()) {
  const createdAt = Date.parse(order?.createdAt || "");
  return Number.isFinite(createdAt) && now - createdAt >= PAYMENT_EXPIRY_MS;
}

async function queryJsapiOrder(outTradeNo, config = readConfig()) {
  return wxpayRequest({
    method: "GET",
    path: `/v3/pay/transactions/out-trade-no/${encodeURIComponent(outTradeNo)}?mchid=${encodeURIComponent(config.mchid)}`,
    body: null,
    config,
  });
}

async function handlePaymentNotification(payload = {}) {
  const headers = normalizeHeaders(payload.headers || {});
  const bodyText = String(payload.body || "");
  if (!bodyText) throw new Error("微信支付通知正文为空。");

  const timestamp = headers["wechatpay-timestamp"];
  const nonce = headers["wechatpay-nonce"];
  const serial = headers["wechatpay-serial"];
  const signature = headers["wechatpay-signature"];
  if (!timestamp || !nonce || !serial || !signature) {
    throw new Error("微信支付通知签名头不完整。");
  }

  const config = readConfig();
  const certificate = await getPlatformCertificate(serial, config);
  const message = `${timestamp}\n${nonce}\n${bodyText}\n`;
  const verified = crypto.verify(
    "RSA-SHA256",
    Buffer.from(message),
    certificate,
    Buffer.from(signature, "base64")
  );
  if (!verified) throw new Error("微信支付通知签名验证失败。");

  const notification = safeJson(bodyText);
  if (notification.event_type !== "TRANSACTION.SUCCESS") {
    return ok({ ignored: true, eventType: notification.event_type || "" });
  }

  const payment = decryptNotificationResource(notification.resource, requiredEnv("WXPAY_API_V3_KEY"));
  if (!payment.out_trade_no) throw new Error("微信支付通知缺少商户订单号。");
  if (payment.mchid && payment.mchid !== config.mchid) throw new Error("微信支付商户号不匹配。");
  if (payment.appid && payment.appid !== config.appid) throw new Error("微信支付 AppID 不匹配。");

  // Never trust notification fields alone. Query WeChat Pay again and only
  // update the order when the server-side transaction status is SUCCESS.
  return confirmJsapiOrder({ out_trade_no: payment.out_trade_no });
}

async function getPlatformCertificate(serial, config) {
  if (platformCertificatesCache.expiresAt > Date.now() && platformCertificatesCache.certificates.has(serial)) {
    return platformCertificatesCache.certificates.get(serial);
  }

  const result = await wxpayRequest({
    method: "GET",
    path: "/v3/certificates",
    body: null,
    config,
  });
  const certificates = new Map();
  for (const item of result.data || []) {
    if (!item.serial_no || !item.encrypt_certificate) continue;
    const pem = decryptNotificationResource(item.encrypt_certificate, requiredEnv("WXPAY_API_V3_KEY"), false);
    certificates.set(String(item.serial_no), String(pem));
  }
  platformCertificatesCache = {
    expiresAt: Date.now() + 12 * 60 * 60 * 1000,
    certificates,
  };
  const certificate = certificates.get(serial);
  if (!certificate) throw new Error(`未找到微信支付平台证书 ${serial}。`);
  return certificate;
}

function decryptNotificationResource(resource = {}, apiV3Key, parseJson = true) {
  const ciphertext = Buffer.from(String(resource.ciphertext || ""), "base64");
  if (ciphertext.length <= 16) throw new Error("微信支付通知密文无效。");
  const authTag = ciphertext.subarray(ciphertext.length - 16);
  const encrypted = ciphertext.subarray(0, ciphertext.length - 16);
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    Buffer.from(String(apiV3Key), "utf8"),
    Buffer.from(String(resource.nonce || ""), "utf8")
  );
  decipher.setAuthTag(authTag);
  decipher.setAAD(Buffer.from(String(resource.associated_data || ""), "utf8"));
  const plainText = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  return parseJson ? safeJson(plainText) : plainText;
}

function normalizeHeaders(headers = {}) {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [String(key).toLowerCase(), value]));
}

function shouldReconcileOrder(order, now = Date.now()) {
  if (!order?.orderNo) return false;
  const createdAt = Date.parse(order.createdAt || "");
  if (!Number.isFinite(createdAt)) return false;
  const age = now - createdAt;
  if (age < RECONCILE_MIN_AGE_MS || age > RECONCILE_MAX_AGE_MS) return false;

  const lastCheckedAt = Date.parse(order.paymentLastCheckedAt || "");
  if (!Number.isFinite(lastCheckedAt)) return true;
  return now - lastCheckedAt >= reconcileIntervalMs(age);
}

function reconcileIntervalMs(age) {
  // Keep checking once per minute through the expiry boundary so stale
  // transactions are closed promptly after 15 minutes.
  if (age < PAYMENT_EXPIRY_MS + 60 * 1000) return 60 * 1000;
  if (age < 60 * 60 * 1000) return 5 * 60 * 1000;
  if (age < 24 * 60 * 60 * 1000) return 30 * 60 * 1000;
  return 6 * 60 * 60 * 1000;
}

async function recordPaymentCheck(db, order, message) {
  await db.collection("orders").doc(order._id || order.id).update({
    data: {
      paymentLastCheckedAt: new Date().toISOString(),
      paymentCheckCount: Number(order.paymentCheckCount || 0) + 1,
      paymentLastCheckResult: String(message || "").slice(0, 200),
    },
  });
}

function isTimerEvent(event = {}) {
  return Boolean(event.TriggerName || event.Type === "Timer" || event.type === "timer");
}

function assertInternalRequest(payload = {}) {
  const expected = requiredEnv("INTERNAL_PAYMENT_SECRET");
  if (!safeSecretEqual(payload.internalPaymentSecret, expected)) {
    throw new Error("无权执行支付补单。");
  }
}

function readConfig() {
  const config = {
    mchid: process.env.WXPAY_MCHID || "1115301146",
    appid: process.env.WXPAY_APPID || "wx7d5ec34bff1ac7dc",
    merchantSerialNumber: requiredEnv("WXPAY_MERCHANT_SERIAL_NO"),
    privateKey: normalizePem(requiredEnv("WXPAY_MERCHANT_PRIVATE_KEY")),
    notifyUrl: requiredEnv("WXPAY_NOTIFY_URL"),
  };

  return config;
}

function requiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    throw new Error(`缺少云函数环境变量 ${name}`);
  }
  return value;
}

function normalizePem(value) {
  return String(value || "").replace(/\\n/g, "\n").trim();
}

async function wxpayRequest({ method, path, body, config }) {
  const bodyText = body ? JSON.stringify(body) : "";
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(16).toString("hex");
  const signature = sign(`${method}\n${path}\n${timestamp}\n${nonce}\n${bodyText}\n`, config.privateKey);
  const authorizationParameters = [
    `mchid="${config.mchid}"`,
    `nonce_str="${nonce}"`,
    `timestamp="${timestamp}"`,
    `serial_no="${config.merchantSerialNumber}"`,
    `signature="${signature}"`,
  ].join(",");
  const authorization = `WECHATPAY2-SHA256-RSA2048 ${authorizationParameters}`;

  return requestJson({
    method,
    hostname: WXPAY_HOST,
    path,
    headers: {
      Authorization: authorization,
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "aiwa-pizza-cloudbase/1.0",
    },
    bodyText,
  });
}

function requestJson({ method, hostname, path, headers, bodyText }) {
  return new Promise((resolve, reject) => {
    const request = https.request({ method, hostname, path, headers }, (response) => {
      let raw = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        raw += chunk;
      });
      response.on("end", () => {
        const data = raw ? safeJson(raw) : {};
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(data);
          return;
        }

        const message = data.message || data.detail?.message || `微信支付接口返回 ${response.statusCode}`;
        reject(new Error(message));
      });
    });

    request.on("error", reject);
    if (bodyText) request.write(bodyText);
    request.end();
  });
}

function safeJson(raw) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    return { raw };
  }
}

function buildMiniProgramPayment({ appId, prepayId, privateKey }) {
  const timeStamp = Math.floor(Date.now() / 1000).toString();
  const nonceStr = crypto.randomBytes(16).toString("hex");
  const packageValue = `prepay_id=${prepayId}`;
  const paySign = sign(`${appId}\n${timeStamp}\n${nonceStr}\n${packageValue}\n`, privateKey);

  return {
    timeStamp,
    nonceStr,
    package: packageValue,
    signType: "RSA",
    paySign,
  };
}

function sign(message, privateKey) {
  return crypto.createSign("RSA-SHA256").update(message).sign(privateKey, "base64");
}

function ok(data = {}) {
  return { ok: true, ...data };
}

function fail(message) {
  return { ok: false, message };
}
