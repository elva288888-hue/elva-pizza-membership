const crypto = require("crypto");
const https = require("https");
const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const WXPAY_HOST = "api.mch.weixin.qq.com";

exports.main = async (event = {}) => {
  const { action, payload = {} } = event;

  try {
    if (action === "createJsapiOrder") {
      return await createJsapiOrder(payload);
    }
    if (action === "confirmJsapiOrder") {
      return await confirmJsapiOrder(payload);
    }
    if (action === "refundJsapiOrder") {
      return await refundJsapiOrder(payload);
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

  const payment = await wxpayRequest({
    method: "GET",
    path: `/v3/pay/transactions/out-trade-no/${encodeURIComponent(outTradeNo)}?mchid=${encodeURIComponent(config.mchid)}`,
    body: null,
    config,
  });
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
