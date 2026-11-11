const cloud = require("wx-server-sdk");
const crypto = require("crypto");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const COLLECTIONS = {
  stores: "stores",
  staff: "staff",
  members: "members",
  transactions: "transactions",
  categories: "categories",
  products: "products",
  orders: "orders",
  refunds: "refunds",
  bonusRules: "bonusrules",
  deliverySettings: "delivery_settings",
  loginCodes: "login_codes",
  adminSessions: "admin_sessions",
  migrationBackups: "migration_backups",
  migrations: "schema_migrations",
};

const DEFAULT_STORE_ID = "store_aiwa_pizza_main";
const DEFAULT_MANAGER_ID = "staff_aiwa_manager";
const CODE_EXPIRE_MINUTES = 5;
const LOGIN_CODE_COOLDOWN_MS = 60 * 1000;

exports.main = async (event = {}) => {
  const { action, payload = {} } = event;

  try {
    if (action === "getStoreData") return await getStoreData(payload);
    if (action === "getAdminOrderUpdates") return await getAdminOrderUpdates(payload);
    if (action === "saveStoreData") return await saveStoreData(payload);
    if (action === "sendLoginCode") return await sendLoginCode(payload.phone);
    if (action === "verifyLoginCode") return await verifyLoginCode(payload.phone, payload.code);
    if (action === "sendCustomerBindCode") return await sendCustomerBindCode(payload.phone);
    if (action === "verifyCustomerBindCode") return await verifyCustomerBindCode(payload.phone, payload.code);
    if (action === "joinMiniProgramMember") return await joinMiniProgramMember(payload);
    if (action === "getMiniProgramData") return await getMiniProgramData(payload);
    if (action === "getMiniProgramOrders") return await getMiniProgramOrders(payload);
    if (action === "createMiniProgramPendingOrder") return await createMiniProgramPendingOrder(payload);
    if (action === "createMiniProgramOrder") return await createMiniProgramOrder(payload);
    if (action === "confirmPaidMiniProgramOrder") return await confirmPaidMiniProgramOrder(payload);
    if (action === "recordPaidMiniProgramOrder") return await recordPaidMiniProgramOrder(payload);
    if (action === "registerPendingMiniProgramRecharge") return await registerPendingMiniProgramRecharge(payload);
    if (action === "confirmPaidMiniProgramRecharge") return await confirmPaidMiniProgramRecharge(payload);
    if (action === "migrateSingleStoreData") return await migrateSingleStoreData(payload);
    if (action === "initializeProduction") return await initializeProduction(payload);

    return fail(`Unknown action: ${action || "empty"}`);
  } catch (error) {
    console.error("[membershipApi]", error);
    return fail("云函数执行失败，请稍后重试");
  }
};

async function initializeProduction(payload = {}) {
  if (!isTrustedPaymentConfirmation(payload)) return fail("初始化授权无效。");
  await ensureConfiguredStore();
  await Promise.all(Object.values(COLLECTIONS).map((name) => ensureCollection(name)));
  return ok({ storeId: DEFAULT_STORE_ID, managerId: DEFAULT_MANAGER_ID });
}

async function getStoreData(payload = {}) {
  const adminSession = await requireAdminSession(payload.sessionToken);
  if (!adminSession.ok) return adminSession;
  const stores = await safeGetAll(COLLECTIONS.stores);
  const isNew = stores.length === 0;
  await ensureConfiguredStore();
  await ensureSingleStoreData();
  await repairDuplicateMembers();

  const storedProducts = await safeGetAll(COLLECTIONS.products);
  const products = await resolveProductImageUrls(storedProducts);
  return ok({
    isNew,
    data: {
      stores: await safeGetAll(COLLECTIONS.stores),
      staff: await safeGetAll(COLLECTIONS.staff),
      members: await safeGetAll(COLLECTIONS.members),
      records: await safeGetAll(COLLECTIONS.transactions),
      categories: await safeGetAll(COLLECTIONS.categories),
      products,
      orders: await safeGetAll(COLLECTIONS.orders),
      refunds: await safeGetAll(COLLECTIONS.refunds),
      settings: {
        bonusRules: await safeGetAll(COLLECTIONS.bonusRules),
        delivery: await getDeliverySettings(),
      },
      session: null,
    },
  });
}

async function getAdminOrderUpdates(payload = {}) {
  const adminSession = await requireAdminSession(payload.sessionToken);
  if (!adminSession.ok) return adminSession;
  return ok({
    orders: await safeGetAll(COLLECTIONS.orders),
    checkedAt: new Date().toISOString(),
  });
}

async function saveStoreData(payload = {}) {
  const adminSession = await requireAdminSession(payload.sessionToken);
  if (!adminSession.ok) return adminSession;
  const data = normalizeIncomingStoreData(payload.data || {});
  const warnings = [];
  const products = await persistProductImages(data.products || []);
  const isManager = adminSession.staffer?.role === "manager";
  await safeReplaceCollection(COLLECTIONS.stores, data.stores || [], warnings);
  if (isManager) {
    await safeReplaceCollection(COLLECTIONS.staff, data.staff || [], warnings);
  } else {
    warnings.push("店员无权修改店员管理数据，相关更改已忽略");
  }
  await safeMergeCollection(COLLECTIONS.members, data.members || [], warnings);
  await safeMergeCollection(COLLECTIONS.transactions, data.records || [], warnings);
  await safeReplaceCollection(COLLECTIONS.categories, data.categories || [], warnings);
  // Products may be edited from more than one browser. Never replace the whole
  // collection with one browser's possibly stale snapshot; explicit deletions
  // are already represented by deletedAt and are safely merged below.
  await safeMergeCollection(COLLECTIONS.products, products, warnings);
  await safeMergeCollection(COLLECTIONS.orders, data.orders || [], warnings);
  await safeReplaceCollection(COLLECTIONS.refunds, data.refunds || [], warnings);
  if (isManager) {
    await safeReplaceCollection(COLLECTIONS.bonusRules, data.settings?.bonusRules || [], warnings);
  } else {
    warnings.push("店员无权修改充值赠送规则，相关更改已忽略");
  }
  if (data.settings?.delivery) {
    await upsert(COLLECTIONS.deliverySettings, DEFAULT_STORE_ID, {
      id: DEFAULT_STORE_ID,
      storeId: DEFAULT_STORE_ID,
      ...normalizeDeliverySettings(data.settings.delivery),
      updatedAt: new Date().toISOString(),
    });
  }
  await ensureConfiguredStore();
  await ensureSingleStoreData();
  await repairDuplicateMembers();

  return ok({ savedAt: new Date().toISOString(), warnings });
}

async function getMiniProgramData(payload = {}) {
  // The customer-facing read path must stay fast. Full-store migration and
  // duplicate-member repair scan several collections and can exceed the
  // function's 10-second timeout as production data grows. Only run that
  // legacy migration when an old store id is explicitly encountered.
  if (payload.storeId && payload.storeId !== DEFAULT_STORE_ID) {
    await ensureDefaultStore();
  }
  const storeId = await resolveStoreId(payload.storeId);
  const openid = getOpenid(payload);
  const phone = normalizePhone(payload.phone);
  const [store, rawProducts, categories, member, deliverySettings] = await Promise.all([
    getDoc(COLLECTIONS.stores, storeId),
    getProductsByStore(storeId),
    getCategoriesByStore(storeId),
    phone ? findMemberByPhone(phone, storeId) : Promise.resolve(null),
    getDeliverySettings(),
  ]);
  const products = await resolveProductImageUrls(rawProducts);

  return ok({
    customer: {
      openid,
      phone,
    },
    store,
    products,
    categories,
    member,
    settings: { delivery: deliverySettings },
  });
}

async function persistProductImages(products = []) {
  return Promise.all(products.map(async (product) => {
    const image = String(product.image || "");
    if (!image.startsWith("data:image/")) {
      const fileId = product.imageFileId || (image.startsWith("cloud://") ? image : "");
      return { ...product, image: fileId || image, imageFileId: fileId };
    }

    const match = image.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s);
    if (!match) return product;
    const mimeType = match[1].toLowerCase();
    const fileContent = Buffer.from(match[2], "base64");
    const extension = imageExtensionForMime(mimeType);
    const digest = crypto.createHash("sha256").update(fileContent).digest("hex").slice(0, 20);
    const cloudPath = `product-images/${product.id || "product"}-${digest}.${extension}`;
    const uploaded = await cloud.uploadFile({ cloudPath, fileContent });
    return {
      ...product,
      image: uploaded.fileID,
      imageFileId: uploaded.fileID,
      imageMimeType: mimeType,
    };
  }));
}

async function resolveProductImageUrls(products = []) {
  const fileIds = [...new Set(products
    .map((product) => product.imageFileId || product.image)
    .filter((image) => String(image || "").startsWith("cloud://")))];
  if (!fileIds.length) return products;

  const urlMap = new Map();
  for (let index = 0; index < fileIds.length; index += 50) {
    const result = await cloud.getTempFileURL({ fileList: fileIds.slice(index, index + 50) });
    for (const item of result.fileList || []) {
      if (item.fileID && item.tempFileURL) urlMap.set(item.fileID, item.tempFileURL);
    }
  }
  return products.map((product) => {
    const fileId = product.imageFileId || product.image;
    return fileId && urlMap.has(fileId)
      ? { ...product, image: urlMap.get(fileId), imageFileId: fileId }
      : product;
  });
}

function imageExtensionForMime(mimeType) {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/gif") return "gif";
  return "jpg";
}

async function joinMiniProgramMember(payload = {}) {
  await ensureDefaultStore();
  const phoneCode = String(payload.phoneCode || "").trim();
  if (!phoneCode) return fail("未取得手机号授权，请重新点击加入会员。");

  let phoneResult;
  try {
    phoneResult = await cloud.openapi.phonenumber.getPhoneNumber({ code: phoneCode });
  } catch (error) {
    console.error("[get phone number failed]", error);
    return fail("手机号授权失败，请确认小程序已认证并重新授权。");
  }

  const phoneInfo = phoneResult?.phoneInfo || phoneResult?.result?.phoneInfo || {};
  const phone = normalizePhone(phoneInfo.purePhoneNumber || phoneInfo.phoneNumber);
  if (!/^1\d{10}$/.test(phone)) return fail("未能取得有效手机号，请重新授权。");

  const storeId = await resolveStoreId(payload.storeId);
  const openid = getOpenid(payload);
  const member = await getOrCreateCloudMember({
    storeId,
    name: String(payload.name || "微信顾客").trim() || "微信顾客",
    phone,
    openid,
  });

  return ok({ customer: { openid, phone }, member });
}

async function confirmPaidMiniProgramRecharge(payload = {}) {
  if (!isTrustedPaymentConfirmation(payload)) return fail("支付确认来源无效。");
  const rechargeNo = String(payload.rechargeNo || payload.outTradeNo || payload.out_trade_no || "").trim();
  const paidTotalInCents = Number(payload.paidTotalInCents);
  const amount = Number((paidTotalInCents / 100).toFixed(2));
  const memberId = String(payload.memberId || "").trim();
  const openid = String(payload.payerOpenid || "").trim();

  if (!rechargeNo) return fail("缺少充值单号，无法入账。");
  if (!Number.isInteger(paidTotalInCents) || paidTotalInCents < 1 || paidTotalInCents > 500000) {
    return fail("充值金额须在 0.01 元至 5000 元之间。");
  }
  if (!memberId || !openid) return fail("会员身份无效，请重新进入小程序后再试。");

  const member = await getDoc(COLLECTIONS.members, memberId);
  if (!member) return fail("未找到充值对应的会员。");

  const existing = await findRechargeRecord(rechargeNo);
  if (existing) {
    await completePendingRecharge(rechargeNo, payload.paymentTradeNo || "");
    return ok({ member, record: existing, duplicated: true });
  }

  const storeId = member.storeId || DEFAULT_STORE_ID;
  const bonusAmount = await getRechargeBonus(amount, storeId);
  const balanceAfter = Number((Number(member.balance || 0) + amount + bonusAmount).toFixed(2));
  const updatedMember = {
    ...member,
    balance: balanceAfter,
    updatedAt: new Date().toISOString(),
  };
  await upsert(COLLECTIONS.members, member.id, updatedMember);

  const recordId = createId("record");
  const record = {
    id: recordId,
    memberId: member.id,
    memberName: member.name || "微信顾客",
    memberPhone: member.phone || "",
    memberCard: member.card || "",
    storeId: member.storeId || DEFAULT_STORE_ID,
    staffId: null,
    type: "recharge",
    amount,
    bonusAmount,
    balanceAfter,
    orderId: "",
    orderNo: rechargeNo,
    paymentMethod: "wechat_pay",
    paymentTradeNo: String(payload.paymentTradeNo || ""),
    payerOpenid: openid,
    payerMatchedMember: !member.openid || String(member.openid) === openid,
    itemsText: "",
    note: bonusAmount > 0
      ? `小程序会员充值 ${rechargeNo}，赠送 ${bonusAmount.toFixed(2)} 元`
      : `小程序会员充值 ${rechargeNo}`,
    createdAt: new Date().toISOString(),
  };
  await upsert(COLLECTIONS.transactions, recordId, record);
  await completePendingRecharge(rechargeNo, payload.paymentTradeNo || "");

  return ok({ member: updatedMember, record });
}

async function registerPendingMiniProgramRecharge(payload = {}) {
  if (!isTrustedPaymentConfirmation(payload)) return fail("充值登记来源无效。");
  const rechargeNo = String(payload.rechargeNo || payload.outTradeNo || payload.out_trade_no || "").trim();
  const paidTotalInCents = Number(payload.totalInCents || payload.paidTotalInCents);
  const memberId = String(payload.memberId || "").trim();
  const payerOpenid = String(payload.payerOpenid || "").trim();
  if (!rechargeNo || !memberId || !payerOpenid) return fail("充值登记信息不完整。");
  if (!Number.isInteger(paidTotalInCents) || paidTotalInCents < 1 || paidTotalInCents > 500000) {
    return fail("充值金额须在 0.01 元至 5000 元之间。");
  }
  const member = await getDoc(COLLECTIONS.members, memberId);
  if (!member) return fail("未找到充值对应的会员。");
  const existing = await findPendingRechargeRecord(rechargeNo);
  if (existing) return ok({ pending: existing, duplicated: true });
  const now = new Date().toISOString();
  const id = `pending_recharge_${crypto.createHash("sha256").update(rechargeNo).digest("hex").slice(0, 24)}`;
  const pending = {
    id,
    memberId: member.id,
    memberName: member.name || "微信顾客",
    memberPhone: member.phone || "",
    memberCard: member.card || "",
    storeId: member.storeId || DEFAULT_STORE_ID,
    type: "recharge_pending",
    status: "pending",
    paymentStatus: "unpaid",
    amount: Number((paidTotalInCents / 100).toFixed(2)),
    orderNo: rechargeNo,
    payerOpenid,
    createdAt: now,
    updatedAt: now,
  };
  await upsert(COLLECTIONS.transactions, id, pending);
  return ok({ pending });
}

async function findPendingRechargeRecord(rechargeNo) {
  const result = await db.collection(COLLECTIONS.transactions)
    .where({ orderNo: rechargeNo, type: "recharge_pending" })
    .limit(1)
    .get();
  return result.data?.[0] ? removeCloudId(result.data[0]) : null;
}

async function completePendingRecharge(rechargeNo, paymentTradeNo) {
  const pending = await findPendingRechargeRecord(rechargeNo);
  if (!pending) return;
  await upsert(COLLECTIONS.transactions, pending.id, {
    ...pending,
    status: "completed",
    paymentStatus: "paid",
    paymentTradeNo: String(paymentTradeNo || pending.paymentTradeNo || ""),
    completedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

async function getRechargeBonus(amount, storeId = DEFAULT_STORE_ID) {
  const amountInCents = Math.round(Number(amount || 0) * 100);
  const rules = await safeGetAll(COLLECTIONS.bonusRules);
  const matched = rules
    .filter((rule) => !rule.storeId || rule.storeId === storeId)
    .map((rule) => ({
      minAmountInCents: Math.round(Number(rule.minAmount || 0) * 100),
      bonusAmountInCents: Math.round(Number(rule.bonusAmount || 0) * 100),
    }))
    .filter((rule) => (
      rule.minAmountInCents > 0
      && rule.bonusAmountInCents >= 0
      && amountInCents >= rule.minAmountInCents
    ))
    .sort((a, b) => b.minAmountInCents - a.minAmountInCents)[0];

  return matched ? Number((matched.bonusAmountInCents / 100).toFixed(2)) : 0;
}

async function getMiniProgramOrders(payload = {}) {
  const openid = getOpenid(payload);
  const phone = normalizePhone(payload.phone);
  const storeId = await resolveStoreId(payload.storeId);
  const orders = await getOrdersForCustomer({ openid, phone, storeId });
  return ok({ orders });
}

async function createMiniProgramOrder(payload = {}) {
  const paymentMethod = payload.paymentMethod || "wechat_pay";
  if (paymentMethod === "wechat_pay") {
    return fail("微信支付订单需先走支付云函数，支付回调确认后再入账。");
  }
  if (paymentMethod !== "member_balance") {
    return fail("当前小程序仅支持微信支付和会员余额支付。");
  }

  const draft = await buildMiniProgramOrderDraft(payload, {
    paymentMethod,
    paymentStatus: "paid",
    paymentTradeNo: "",
  });
  if (!draft.ok) return draft;

  const member = await getDoc(COLLECTIONS.members, draft.order.memberId);
  if (!member) return fail("请先授权手机号并加入会员后再使用余额支付。");
  if (Number(member.balance || 0) < draft.order.totalAmount) {
    return fail(`会员余额不足，当前余额 ${Number(member.balance || 0).toFixed(2)}。`);
  }

  const balanceAfter = Number((Number(member.balance || 0) - draft.order.totalAmount).toFixed(2));
  await upsert(COLLECTIONS.members, member.id, {
    ...member,
    balance: balanceAfter,
    updatedAt: new Date().toISOString(),
  });
  const recordId = createId("record");
  await upsert(COLLECTIONS.transactions, recordId, buildOrderPaymentRecord({
    id: recordId,
    order: draft.order,
    member: { ...member, balance: balanceAfter },
    type: "spend",
    note: `订单 ${draft.order.orderNo} 会员余额支付`,
  }));
  const paidOrder = {
    ...draft.order,
    paidAmount: draft.order.totalAmount,
    paymentTradeNo: `BALANCE-${draft.order.orderNo}`,
  };
  await upsert(COLLECTIONS.orders, paidOrder.id, paidOrder);

  return ok({ order: paidOrder });
}

async function createMiniProgramPendingOrder(payload = {}) {
  const draft = await buildMiniProgramOrderDraft(payload, {
    paymentMethod: "wechat_pay",
    paymentStatus: "unpaid",
    paymentTradeNo: "",
  });
  if (!draft.ok) return draft;

  const pendingOrder = {
    ...draft.order,
    status: "pending_payment",
    paidAmount: 0,
    paymentStatus: "unpaid",
    paymentMethod: "wechat_pay",
  };
  await upsert(COLLECTIONS.orders, pendingOrder.id, pendingOrder);
  return ok({ order: pendingOrder });
}

async function confirmPaidMiniProgramOrder(payload = {}) {
  if (!isTrustedPaymentConfirmation(payload)) return fail("支付确认来源无效。");
  const orderNo = String(payload.orderNo || payload.outTradeNo || payload.out_trade_no || "").trim();
  if (!orderNo) return fail("缺少订单号，无法确认支付。");

  const existing = await findOrderByOrderNo(orderNo);
  if (!existing) return fail("未找到待支付订单。");
  const payerOpenid = String(payload.payerOpenid || "").trim();
  if (!payerOpenid || payerOpenid !== String(existing.customerOpenid || "")) {
    return fail("付款人与订单用户不一致。");
  }
  const expectedTotalInCents = Math.round(Number(existing.totalAmount) * 100);
  if (Number(payload.paidTotalInCents) !== expectedTotalInCents) {
    return fail("支付金额与订单金额不一致。");
  }
  const paidOrder = await markMiniProgramOrderPaid(existing, {
    paymentTradeNo: payload.paymentTradeNo || payload.transactionId || payload.transaction_id || "",
    paymentMethod: payload.paymentMethod || existing.paymentMethod || "wechat_pay",
  });
  return ok({ order: paidOrder });
}

async function recordPaidMiniProgramOrder(payload = {}) {
  if (!isTrustedPaymentConfirmation(payload)) return fail("支付确认来源无效。");
  const orderNo = String(payload.orderNo || payload.outTradeNo || payload.out_trade_no || "").trim();
  if (orderNo) {
    const existing = await findOrderByOrderNo(orderNo);
    if (existing) {
      const paidOrder = await markMiniProgramOrderPaid(existing, {
        paymentTradeNo: payload.paymentTradeNo || payload.transactionId || payload.transaction_id || "",
        paymentMethod: payload.paymentMethod || existing.paymentMethod || "wechat_pay",
      });
      return ok({ order: paidOrder });
    }
  }

  const draft = await buildMiniProgramOrderDraft(payload, {
    paymentMethod: payload.paymentMethod || "wechat_pay",
    paymentStatus: "paid",
    paymentTradeNo: payload.paymentTradeNo || payload.transactionId || "",
  });
  if (!draft.ok) return draft;

  const paidOrder = {
    ...draft.order,
    paidAmount: draft.order.totalAmount,
    paymentTradeNo: payload.paymentTradeNo || payload.transactionId || "",
    paymentCallbackAt: new Date().toISOString(),
  };
  await markMiniProgramOrderPaid(paidOrder, {
    paymentTradeNo: paidOrder.paymentTradeNo,
    paymentMethod: paidOrder.paymentMethod,
  });
  return ok({ order: paidOrder });
}

function isTrustedPaymentConfirmation(payload = {}) {
  const expected = String(process.env.INTERNAL_PAYMENT_SECRET || "");
  const received = String(payload.internalPaymentSecret || "");
  if (!expected || !received || expected.length !== received.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}

async function buildMiniProgramOrderDraft(payload = {}, payment = {}) {
  await ensureDefaultStore();
  const storeId = await resolveStoreId(payload.storeId);
  const openid = getOpenid(payload);
  const customer = payload.customer || {};
  const phone = normalizePhone(customer.phone || payload.phone);
  const name = String(customer.name || payload.customerName || "微信顾客").trim() || "微信顾客";
  const items = await normalizeOrderItems(payload.items || [], storeId);
  if (!items.length) return fail("请先选择商品。");

  const deliverySettings = await getDeliverySettings();
  const fulfillment = buildFulfillmentInfo(payload, deliverySettings);
  if (!fulfillment.ok) return fulfillment;

  let member = null;
  if (phone) {
    member = await getOrCreateCloudMember({
      storeId,
      name,
      phone,
      openid,
    });
  }

  const goodsAmount = Number(items.reduce((sum, item) => sum + item.price * item.quantity, 0).toFixed(2));
  const deliveryFee = fulfillment.fulfillmentType === "delivery" && goodsAmount < deliverySettings.freeThreshold
    ? deliverySettings.fee
    : 0;
  const totalAmount = Number((goodsAmount + deliveryFee).toFixed(2));
  const now = new Date().toISOString();
  const order = {
    id: payload.orderId || createId("order"),
    orderNo: payload.orderNo || createOrderNo(),
    storeId,
    customerName: name,
    customerPhone: phone,
    customerOpenid: openid,
    memberId: member?.id || "",
    isMember: Boolean(member),
    items,
    goodsAmount,
    deliveryFee,
    deliveryFeeWaived: fulfillment.fulfillmentType === "delivery" && deliveryFee === 0,
    totalAmount,
    paidAmount: payment.paymentStatus === "paid" ? totalAmount : 0,
    refundAmount: 0,
    adjustmentAmount: 0,
    status: "pending",
    paymentStatus: payment.paymentStatus || "unpaid",
    paymentMethod: payment.paymentMethod || payload.paymentMethod || "wechat_pay",
    paymentTradeNo: payment.paymentTradeNo || "",
    paymentRedirect: "mini_program",
    paymentExternalUrl: "",
    fulfillmentType: fulfillment.fulfillmentType,
    pickupMode: fulfillment.pickupMode,
    pickupDate: fulfillment.pickupDate,
    pickupTime: fulfillment.pickupTime,
    deliveryAddress: fulfillment.deliveryAddress,
    deliveryDate: fulfillment.deliveryDate,
    deliveryTime: fulfillment.deliveryTime,
    deliveryLatitude: fulfillment.deliveryLatitude,
    deliveryLongitude: fulfillment.deliveryLongitude,
    deliveryDistanceKm: fulfillment.deliveryDistanceKm,
    fulfillmentLabel: fulfillment.fulfillmentLabel,
    note: String(payload.note || "").trim(),
    createdAt: payload.createdAt || now,
    updatedAt: now,
  };

  return { ok: true, order };
}

async function sendLoginCode(phone) {
  await ensureConfiguredStore();
  const normalizedPhone = normalizePhone(phone);
  const staffer = await findActiveStaff(normalizedPhone);

  if (!staffer) {
    return fail("这个手机号还没有录入为店员，请先让店长添加。");
  }

  const previousCode = await getDoc(COLLECTIONS.loginCodes, normalizedPhone);
  if (
    previousCode?.createdAtMs &&
    Date.now() - Number(previousCode.createdAtMs) < LOGIN_CODE_COOLDOWN_MS
  ) {
    return fail("验证码刚刚已发送，请 1 分钟后再试。");
  }

  if (!isSmsConfigured()) return fail("短信服务尚未配置，无法发送登录验证码。");
  const code = createLoginCode();
  const expiresAt = Date.now() + CODE_EXPIRE_MINUTES * 60 * 1000;

  const smsResult = await sendSmsCode(normalizedPhone, code);
  if (!smsResult.ok) {
    console.error("[sms send failed]", smsResult.error);
    if (isTemporaryTestLoginEnabled(normalizedPhone)) {
      return ok({ message: "运营商短信报备中，已启用今日临时测试验证码。", mode: "temporary_test" });
    }
    return fail(buildSmsFailureMessage(smsResult.error));
  }

  await upsert(COLLECTIONS.loginCodes, normalizedPhone, {
    _id: normalizedPhone,
    phone: normalizedPhone,
    code,
    expiresAt,
    createdAtMs: Date.now(),
    createdAt: new Date().toISOString(),
    mode: "sms",
  }).catch((error) => {
    console.warn("[login_codes skipped]", error);
  });

  return ok({ message: "验证码已发送，请查看手机短信。", expiresInMinutes: CODE_EXPIRE_MINUTES });
}

async function verifyLoginCode(phone, code) {
  await ensureConfiguredStore();
  const normalizedPhone = normalizePhone(phone);
  const staffer = await findActiveStaff(normalizedPhone);

  if (!staffer) {
    return fail("这个手机号还没有录入为店员，无法登录。");
  }

  const codeDoc = await getDoc(COLLECTIONS.loginCodes, normalizedPhone);
  const isTemporaryTestCode =
    isTemporaryTestLoginEnabled(normalizedPhone) &&
    String(code || "").trim() === String(process.env.TEMP_TEST_LOGIN_CODE || "").trim();
  const isValidCloudCode =
    codeDoc && codeDoc.code === code && Number(codeDoc.expiresAt || 0) > Date.now();

  if (!isTemporaryTestCode && !isValidCloudCode) {
    return fail("验证码不正确或已过期。");
  }
  await db.collection(COLLECTIONS.loginCodes).doc(normalizedPhone).remove().catch(() => {});

  const sessionToken = crypto.randomBytes(32).toString("hex");
  const sessionExpiresAt = Date.now() + 12 * 60 * 60 * 1000;
  await upsert(COLLECTIONS.adminSessions, sessionToken, {
    _id: sessionToken,
    id: sessionToken,
    staffId: staffer.id || staffer._id,
    storeId: staffer.storeId || DEFAULT_STORE_ID,
    expiresAt: sessionExpiresAt,
    createdAt: new Date().toISOString(),
  });

  return ok({
    session: {
      staffId: staffer.id || staffer._id,
      storeId: staffer.storeId || DEFAULT_STORE_ID,
      token: sessionToken,
      expiresAt: sessionExpiresAt,
      loggedInAt: new Date().toISOString(),
    },
  });
}

async function requireAdminSession(token) {
  const normalizedToken = String(token || "").trim();
  if (!/^[a-f0-9]{64}$/.test(normalizedToken)) {
    return fail("后台登录状态无效，请重新登录。");
  }
  const session = await getDoc(COLLECTIONS.adminSessions, normalizedToken);
  if (!session || Number(session.expiresAt || 0) <= Date.now()) {
    return fail("后台登录状态已过期，请重新登录。");
  }
  const staffer = await getDoc(COLLECTIONS.staff, session.staffId);
  if (staffer && !staffer.active) {
    return fail("店员账号已停用。");
  }
  return {
    ok: true,
    session,
    staffer: staffer || { id: session.staffId, storeId: session.storeId, active: true },
  };
}

async function sendCustomerBindCode(phone) {
  const normalizedPhone = normalizePhone(phone);
  if (!/^1\d{10}$/.test(normalizedPhone)) {
    return fail("请输入正确的 11 位手机号。");
  }

  const codeId = customerCodeId(normalizedPhone);
  const previousCode = await getDoc(COLLECTIONS.loginCodes, codeId);
  if (
    previousCode?.createdAtMs &&
    Date.now() - Number(previousCode.createdAtMs) < LOGIN_CODE_COOLDOWN_MS
  ) {
    return fail("验证码刚刚已发送，请 1 分钟后再试。");
  }

  if (!isSmsConfigured()) return fail("短信服务尚未配置，无法发送验证码。");
  const code = createLoginCode();
  const expiresAt = Date.now() + CODE_EXPIRE_MINUTES * 60 * 1000;

  const smsResult = await sendSmsCode(normalizedPhone, code);
  if (!smsResult.ok) {
    console.error("[customer sms send failed]", smsResult.error);
    return fail("短信发送失败，请稍后重试或联系店长。");
  }

  await upsert(COLLECTIONS.loginCodes, codeId, {
    _id: codeId,
    id: codeId,
    phone: normalizedPhone,
    code,
    purpose: "customer_bind",
    expiresAt,
    createdAtMs: Date.now(),
    createdAt: new Date().toISOString(),
    mode: "sms",
  });

  return ok({ message: "验证码已发送，请查看手机短信。", expiresInMinutes: CODE_EXPIRE_MINUTES });
}

async function verifyCustomerBindCode(phone, code) {
  const normalizedPhone = normalizePhone(phone);
  const normalizedCode = String(code || "").trim();
  if (!/^1\d{10}$/.test(normalizedPhone)) {
    return fail("请输入正确的 11 位手机号。");
  }
  if (!/^\d{6}$/.test(normalizedCode)) {
    return fail("请输入 6 位短信验证码。");
  }

  const codeId = customerCodeId(normalizedPhone);
  const codeDoc = await getDoc(COLLECTIONS.loginCodes, codeId);
  const isValidCloudCode =
    codeDoc &&
    codeDoc.purpose === "customer_bind" &&
    codeDoc.code === normalizedCode &&
    Number(codeDoc.expiresAt || 0) > Date.now();

  if (!isValidCloudCode) {
    return fail("验证码不正确或已过期。");
  }
  await db.collection(COLLECTIONS.loginCodes).doc(codeId).remove().catch(() => {});

  return ok({
    verified: true,
    phone: normalizedPhone,
    verifiedAt: new Date().toISOString(),
  });
}

function customerCodeId(phone) {
  return `customer_${phone}`;
}

function isSmsConfigured() {
  return [
    "TENCENT_SECRET_ID",
    "TENCENT_SECRET_KEY",
    "TENCENT_SMS_SDK_APP_ID",
    "TENCENT_SMS_SIGN_NAME",
    "TENCENT_SMS_TEMPLATE_ID",
  ].every((name) => Boolean(String(process.env[name] || "").trim()));
}

function buildSmsFailureMessage(error) {
  const code = String(error?.Code || error?.code || "").trim();
  const message = String(error?.Message || error?.message || "").trim();
  const safeCode = /^[A-Za-z0-9_.-]{1,100}$/.test(code) ? code : "";
  const friendlyMessages = {
    "LimitExceeded.PhoneNumberOneHourLimit": "该手机号一小时内获取验证码次数过多，请一小时后再试。",
    "LimitExceeded.PhoneNumberDailyLimit": "该手机号今天获取验证码次数已达上限，请明天再试。",
    "LimitExceeded.PhoneNumberThirtySecondLimit": "验证码请求过于频繁，请稍后再试。",
    "LimitExceeded.PhoneNumberOneMinuteLimit": "验证码请求过于频繁，请一分钟后再试。",
    "FailedOperation.SignatureIncorrectOrUnapproved": "短信签名不正确或尚未审核通过。",
    "FailedOperation.TemplateIncorrectOrUnapproved": "短信模板不正确或尚未审核通过。",
    "FailedOperation.TemplateParamSetNotMatchApprovedTemplate": "短信模板变量数量与已审核模板不一致。",
    "UnauthorizedOperation": "当前腾讯云密钥没有发送短信的权限。",
    "AuthFailure.SecretIdNotFound": "腾讯云短信访问密钥无效，请重新配置。",
  };
  if (friendlyMessages[code]) {
    return `短信发送失败（${safeCode || code}）：${friendlyMessages[code]}`;
  }
  const safeMessage = message
    .replace(/(?:secret(?:Id|Key)?|token|credential)[=:：\s]+[^\s,，;；]+/gi, "[敏感信息已隐藏]")
    .replace(/\s+/g, " ")
    .slice(0, 180);

  if (safeCode && safeMessage) return `短信发送失败（${safeCode}）：${safeMessage}`;
  if (safeCode) return `短信发送失败，腾讯云错误码：${safeCode}`;
  if (safeMessage) return `短信发送失败：${safeMessage}`;
  return "短信发送失败，请检查腾讯云短信签名、模板参数和密钥权限。";
}

function isTemporaryTestLoginEnabled(phone) {
  const configuredPhone = normalizePhone(process.env.TEMP_TEST_LOGIN_PHONE);
  const configuredCode = String(process.env.TEMP_TEST_LOGIN_CODE || "").trim();
  const expiresAt = Number(process.env.TEMP_TEST_LOGIN_EXPIRES_AT || 0);
  return (
    /^1\d{10}$/.test(configuredPhone) &&
    /^\d{6}$/.test(configuredCode) &&
    phone === configuredPhone &&
    Date.now() < expiresAt
  );
}

function createLoginCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function buildTemplateParams(code) {
  const configured = process.env.TENCENT_SMS_TEMPLATE_PARAMS;
  if (!configured) return [code, String(CODE_EXPIRE_MINUTES)];

  return configured.split(",").map((item) =>
    item
      .trim()
      .replace(/\{code\}/g, code)
      .replace(/\{minutes\}/g, String(CODE_EXPIRE_MINUTES))
  );
}

async function sendSmsCode(phone, code) {
  try {
    const tencentcloud = require("tencentcloud-sdk-nodejs");
    const SmsClient = tencentcloud.sms.v20210111.Client;
    const client = new SmsClient({
      credential: {
        secretId: process.env.TENCENT_SECRET_ID,
        secretKey: process.env.TENCENT_SECRET_KEY,
      },
      region: process.env.TENCENT_SMS_REGION || "ap-guangzhou",
      profile: {
        httpProfile: {
          endpoint: "sms.tencentcloudapi.com",
        },
      },
    });

    const response = await client.SendSms({
      SmsSdkAppId: process.env.TENCENT_SMS_SDK_APP_ID,
      SignName: process.env.TENCENT_SMS_SIGN_NAME,
      TemplateId: process.env.TENCENT_SMS_TEMPLATE_ID,
      TemplateParamSet: buildTemplateParams(code),
      PhoneNumberSet: [`+86${phone}`],
    });

    const status = response?.SendStatusSet?.[0];
    if (!status || status.Code !== "Ok") {
      return { ok: false, error: status || response };
    }

    return { ok: true, response };
  } catch (error) {
    return { ok: false, error };
  }
}

async function ensureConfiguredStore() {
  const now = new Date().toISOString();
  const managerName = String(process.env.STORE_MANAGER_NAME || "").trim();
  const managerPhone = normalizePhone(process.env.STORE_MANAGER_PHONE);
  if (!managerName || !/^1\d{10}$/.test(managerPhone)) {
    throw new Error("缺少真实店长姓名或手机号配置");
  }
  const store = await getDoc(COLLECTIONS.stores, DEFAULT_STORE_ID);
  if (!store) {
    await upsert(COLLECTIONS.stores, DEFAULT_STORE_ID, {
      _id: DEFAULT_STORE_ID,
      id: DEFAULT_STORE_ID,
      name: "爱娃披萨店",
      createdAt: now,
    });
  }
  await upsert(COLLECTIONS.staff, DEFAULT_MANAGER_ID, {
    _id: DEFAULT_MANAGER_ID,
    id: DEFAULT_MANAGER_ID,
    storeId: DEFAULT_STORE_ID,
    name: managerName,
    phone: managerPhone,
    role: "manager",
    active: true,
    createdAt: (await getDoc(COLLECTIONS.staff, DEFAULT_MANAGER_ID))?.createdAt || now,
  });
}

async function ensureDefaultStore() {
  await ensureConfiguredStore();
  await ensureSingleStoreData();
  await repairDuplicateMembers();
}

async function ensureDefaultCatalog() {
  await ensureDefaultStore();
}

async function migrateSingleStoreData(payload = {}) {
  const adminSession = await requireAdminSession(payload.sessionToken);
  if (!adminSession.ok) return adminSession;
  const result = await ensureSingleStoreData();
  return ok(result);
}

async function ensureSingleStoreData(options = {}) {
  const migrationId = "single_store_primary_v1";
  const existingMigration = await getDoc(COLLECTIONS.migrations, migrationId);
  if (existingMigration?.completedAt && !options.force) {
    return existingMigration.summary || { migrated: false };
  }

  const startedAt = new Date().toISOString();
  const collectionNames = [
    COLLECTIONS.stores,
    COLLECTIONS.staff,
    COLLECTIONS.members,
    COLLECTIONS.transactions,
    COLLECTIONS.categories,
    COLLECTIONS.products,
    COLLECTIONS.orders,
    COLLECTIONS.refunds,
    COLLECTIONS.bonusRules,
  ];
  const snapshot = {};
  for (const collectionName of collectionNames) {
    snapshot[collectionName] = await safeGetAll(collectionName);
    await upsert(
      COLLECTIONS.migrationBackups,
      `${migrationId}_${collectionName}`,
      {
        id: `${migrationId}_${collectionName}`,
        migrationId,
        collectionName,
        createdAt: startedAt,
        rows: snapshot[collectionName],
      }
    );
  }

  const memberResult = mergeMembersForPrimaryStore(snapshot[COLLECTIONS.members]);
  const normalizeStoreId = (row) => ({ ...row, storeId: DEFAULT_STORE_ID });
  const staff = dedupeByKey(
    snapshot[COLLECTIONS.staff].map(normalizeStoreId),
    (row) => normalizePhone(row.phone) || row.id
  );
  const categories = dedupeByKey(
    snapshot[COLLECTIONS.categories].map(normalizeStoreId),
    (row) => String(row.name || "").trim().toLowerCase() || row.id
  );
  const products = dedupeByKey(
    snapshot[COLLECTIONS.products].map(normalizeStoreId),
    (row) => {
      const name = String(row.name || "").trim().toLowerCase();
      const category = String(row.category || "").trim().toLowerCase();
      return name ? `${category}:${name}` : row.id;
    }
  );
  const transactions = snapshot[COLLECTIONS.transactions].map((row) => ({
    ...normalizeStoreId(row),
    memberId: memberResult.idMap.get(row.memberId) || row.memberId,
  }));
  const orders = snapshot[COLLECTIONS.orders].map((row) => ({
    ...normalizeStoreId(row),
    memberId: memberResult.idMap.get(row.memberId) || row.memberId,
  }));
  const refunds = snapshot[COLLECTIONS.refunds].map((row) => ({
    ...normalizeStoreId(row),
    memberId: memberResult.idMap.get(row.memberId) || row.memberId,
  }));
  const bonusRules = dedupeByKey(
    snapshot[COLLECTIONS.bonusRules].map(normalizeStoreId),
    (row) => row.id || `${row.minAmount}:${row.bonusAmount}`
  );
  const primaryStore = snapshot[COLLECTIONS.stores].find(
    (store) => store.id === DEFAULT_STORE_ID
  ) || snapshot[COLLECTIONS.stores][0] || {};

  await replaceCollection(COLLECTIONS.stores, [{
    ...primaryStore,
    id: DEFAULT_STORE_ID,
    name: primaryStore.name || "爱娃披萨店",
    createdAt: primaryStore.createdAt || startedAt,
    updatedAt: startedAt,
  }]);
  await replaceCollection(COLLECTIONS.staff, staff);
  await replaceCollection(COLLECTIONS.members, memberResult.members);
  await replaceCollection(COLLECTIONS.transactions, transactions);
  await replaceCollection(COLLECTIONS.categories, categories);
  await replaceCollection(COLLECTIONS.products, products);
  await replaceCollection(COLLECTIONS.orders, orders);
  await replaceCollection(COLLECTIONS.refunds, refunds);
  await replaceCollection(COLLECTIONS.bonusRules, bonusRules);
  await ensureConfiguredStore();

  const summary = {
    migrated: true,
    sourceStoreCount: snapshot[COLLECTIONS.stores].length,
    memberCountBefore: snapshot[COLLECTIONS.members].length,
    memberCountAfter: memberResult.members.length,
    productCountBefore: snapshot[COLLECTIONS.products].length,
    productCountAfter: products.length,
    orderCount: orders.length,
  };
  await upsert(COLLECTIONS.migrations, migrationId, {
    id: migrationId,
    startedAt,
    completedAt: new Date().toISOString(),
    primaryStoreId: DEFAULT_STORE_ID,
    summary,
  });
  return summary;
}

function normalizeIncomingStoreData(data = {}) {
  const normalizeRows = (rows) =>
    Array.isArray(rows) ? rows.map((row) => ({ ...row, storeId: DEFAULT_STORE_ID })) : [];
  const memberResult = mergeMembersForPrimaryStore(normalizeRows(data.members));
  const remapMemberId = (row) => ({
    ...row,
    storeId: DEFAULT_STORE_ID,
    memberId: memberResult.idMap.get(row.memberId) || row.memberId,
  });
  const stores = Array.isArray(data.stores) && data.stores.length
    ? [{ ...data.stores[0], id: DEFAULT_STORE_ID }]
    : [{ id: DEFAULT_STORE_ID, name: "爱娃披萨店" }];
  return {
    ...data,
    stores,
    staff: normalizeRows(data.staff),
    members: memberResult.members,
    records: normalizeRows(data.records).map(remapMemberId),
    categories: normalizeRows(data.categories),
    products: normalizeRows(data.products),
    orders: normalizeRows(data.orders).map(remapMemberId),
    refunds: normalizeRows(data.refunds).map(remapMemberId),
    settings: {
      ...(data.settings || {}),
      bonusRules: normalizeRows(data.settings?.bonusRules),
      ...(data.settings && Object.prototype.hasOwnProperty.call(data.settings, "delivery")
        ? { delivery: normalizeDeliverySettings(data.settings.delivery) }
        : {}),
    },
  };
}

function mergeMembersForPrimaryStore(rows = []) {
  const groups = new Map();
  for (const row of rows) {
    const phone = normalizePhone(row.phone);
    const key = phone || row.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const idMap = new Map();
  const members = [];
  for (const group of groups.values()) {
    const { canonical, merged } = mergeMemberGroup(group, DEFAULT_STORE_ID);
    for (const row of group) idMap.set(row.id, canonical.id);
    members.push(merged);
  }
  return { members, idMap };
}

function mergeMemberGroup(group, storeId = DEFAULT_STORE_ID) {
  const byOldestCard = [...group].sort((a, b) => {
    const cardA = Number(String(a.card || "").replace(/\D/g, "")) || Number.MAX_SAFE_INTEGER;
    const cardB = Number(String(b.card || "").replace(/\D/g, "")) || Number.MAX_SAFE_INTEGER;
    if (cardA !== cardB) return cardA - cardB;
    return documentTimestamp(a) - documentTimestamp(b);
  });
  const byNewest = [...group].sort((a, b) => documentTimestamp(b) - documentTimestamp(a));
  const canonical = byOldestCard[0];
  const meaningfulName = byNewest.find((row) => {
    const name = String(row.name || "").trim();
    return name && name !== "微信顾客" && name !== normalizePhone(row.phone);
  })?.name;
  const notes = Array.from(new Set(
    byNewest.map((row) => String(row.note || "").trim()).filter(Boolean)
  ));
  return {
    canonical,
    merged: {
      ...canonical,
      storeId,
      phone: normalizePhone(canonical.phone),
      name: meaningfulName || canonical.name || "微信顾客",
      balance: Number(
        group.reduce((sum, row) => sum + (Number(row.balance) || 0), 0).toFixed(2)
      ),
      openid: byNewest.find((row) => row.openid)?.openid || canonical.openid || "",
      note: notes.join("；"),
      updatedAt: new Date().toISOString(),
    },
  };
}

async function repairDuplicateMembers() {
  const allMembers = await safeGetAll(COLLECTIONS.members);
  const groups = new Map();
  for (const member of allMembers) {
    const phone = normalizePhone(member.phone);
    if (!phone) continue;
    const storeId = member.storeId || DEFAULT_STORE_ID;
    const key = `${storeId}:${phone}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(member);
  }

  const duplicateGroups = Array.from(groups.values()).filter((group) => group.length > 1);
  if (!duplicateGroups.length) return { repaired: 0 };

  const idMap = new Map();
  for (const group of duplicateGroups) {
    const storeId = group[0].storeId || DEFAULT_STORE_ID;
    const { canonical, merged } = mergeMemberGroup(group, storeId);
    await upsert(COLLECTIONS.members, canonical.id, merged);
    for (const member of group) idMap.set(member.id, canonical.id);
  }

  for (const collectionName of [
    COLLECTIONS.transactions,
    COLLECTIONS.orders,
    COLLECTIONS.refunds,
  ]) {
    const rows = await safeGetAll(collectionName);
    await Promise.all(rows.map((row) => {
      const memberId = idMap.get(row.memberId);
      if (!memberId || memberId === row.memberId) return Promise.resolve();
      return upsert(collectionName, row.id, {
        ...row,
        memberId,
        updatedAt: new Date().toISOString(),
      });
    }));
  }

  await Promise.all(
    duplicateGroups.flatMap((group) => {
      const canonicalId = idMap.get(group[0].id);
      return group
        .filter((member) => member.id !== canonicalId)
        .map((member) => db.collection(COLLECTIONS.members).doc(member.id).remove());
    })
  );

  return {
    repaired: duplicateGroups.reduce((sum, group) => sum + group.length - 1, 0),
  };
}

function dedupeByKey(rows, getKey) {
  const result = new Map();
  for (const row of rows) {
    const key = getKey(row);
    const current = result.get(key);
    if (!current || documentTimestamp(row) >= documentTimestamp(current)) {
      result.set(key, row);
    }
  }
  return Array.from(result.values());
}

function createDefaultCategories(storeId) {
  return ["披萨", "套餐", "饮品"].map((name, index) => ({
    id: `category_${index + 1}`,
    storeId,
    name,
    sort: index + 1,
    createdAt: new Date().toISOString(),
  }));
}

function createDefaultProducts(storeId) {
  return [
    ["玛格丽特披萨", "披萨", 39, "番茄底、马苏里拉芝士、罗勒风味"],
    ["夏威夷披萨", "披萨", 45, "火腿、菠萝、芝士，酸甜清爽"],
    ["双人分享套餐", "套餐", 88, "任选披萨 1 份，配小食和饮品"],
    ["柠檬茶", "饮品", 12, "清爽解腻，可备注少冰"],
  ].map(([name, category, price, description], index) => ({
    id: `product_default_${index + 1}`,
    storeId,
    name,
    category,
    price,
    description,
    image: "",
    active: true,
    soldOut: false,
    sort: index + 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));
}

async function findActiveStaff(phone) {
  const result = await db
    .collection(COLLECTIONS.staff)
    .where({ phone, active: true })
    .limit(1)
    .get();
  return result.data?.[0] || null;
}

async function findMemberByPhone(phone, storeId = DEFAULT_STORE_ID) {
  if (!phone) return null;
  const storeResult = await db
    .collection(COLLECTIONS.members)
    .where({ phone, storeId })
    .limit(1)
    .get();
  if (storeResult.data?.[0]) return removeCloudId(storeResult.data[0]);

  const anyStoreResult = await db
    .collection(COLLECTIONS.members)
    .where({ phone })
    .limit(1)
    .get();
  return anyStoreResult.data?.[0] ? removeCloudId(anyStoreResult.data[0]) : null;
}

async function getOrCreateCloudMember({ storeId, name, phone, openid }) {
  const existing = await findMemberByPhone(phone, storeId);
  if (existing) {
    const updated = {
      ...existing,
      storeId,
      name: existing.name && existing.name !== "微信顾客" ? existing.name : name,
      openid: existing.openid || openid,
      updatedAt: new Date().toISOString(),
    };
    await upsert(COLLECTIONS.members, updated.id, updated);
    return updated;
  }

  const member = {
    id: memberIdForPhone(storeId, phone),
    storeId,
    name,
    phone,
    openid,
    card: await nextCloudCardNumber(),
    balance: 0,
    note: "小程序端自动创建",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await upsert(COLLECTIONS.members, member.id, member);
  return member;
}

function memberIdForPhone(storeId, phone) {
  return `member_phone_${crypto
    .createHash("sha256")
    .update(`${storeId}:${normalizePhone(phone)}`)
    .digest("hex")
    .slice(0, 24)}`;
}

async function nextCloudCardNumber() {
  const members = await safeGetAll(COLLECTIONS.members);
  const usedCards = new Set(members.map((member) => member.card).filter(Boolean));
  const maxCardNumber = members.reduce((max, member) => {
    const match = String(member.card || "").match(/^AW(\d+)$/);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  let next = maxCardNumber + 1;
  let card = `AW${String(next).padStart(4, "0")}`;
  while (usedCards.has(card)) {
    next += 1;
    card = `AW${String(next).padStart(4, "0")}`;
  }
  return card;
}

async function getProductsByStore(storeId) {
  const result = await db
    .collection(COLLECTIONS.products)
    .where({ storeId })
    .limit(1000)
    .get();
  return (result.data || [])
    .map(removeCloudId)
    .filter((item) => item.active !== false && !item.deletedAt)
    .sort((a, b) => Number(a.sort || 0) - Number(b.sort || 0));
}

async function resolveStoreId(requestedStoreId) {
  if (process.env.MULTI_STORE_ENABLED === "true" && requestedStoreId) return requestedStoreId;
  return DEFAULT_STORE_ID;
}

async function getCategoriesByStore(storeId) {
  const result = await db
    .collection(COLLECTIONS.categories)
    .where({ storeId })
    .limit(1000)
    .get();
  return (result.data || [])
    .map(removeCloudId)
    .sort((a, b) => Number(a.sort || 0) - Number(b.sort || 0));
}

async function getOrdersForCustomer({ openid, phone, storeId }) {
  const allOrders = await safeGetAll(COLLECTIONS.orders);
  return allOrders
    .filter((order) => {
      if (storeId && order.storeId !== storeId) return false;
      return (openid && order.customerOpenid === openid) || (phone && order.customerPhone === phone);
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

async function findOrderByOrderNo(orderNo) {
  const result = await db
    .collection(COLLECTIONS.orders)
    .where({ orderNo })
    .limit(1)
    .get();
  return result.data?.[0] ? removeCloudId(result.data[0]) : null;
}

async function markMiniProgramOrderPaid(order, payment = {}) {
  if (order.paymentStatus === "paid") return order;

  const member = order.memberId ? await getDoc(COLLECTIONS.members, order.memberId) : null;
  const paidOrder = {
    ...order,
    status: "pending",
    paymentStatus: "paid",
    paymentMethod: payment.paymentMethod || order.paymentMethod || "wechat_pay",
    paymentTradeNo: payment.paymentTradeNo || order.paymentTradeNo || "",
    paidAmount: Number(order.totalAmount || 0),
    paymentCallbackAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await upsert(COLLECTIONS.orders, paidOrder.id, paidOrder);

  const existingRecord = await findOrderPaymentRecord(paidOrder.orderNo);
  if (!existingRecord) {
    const recordId = createId("record");
    await upsert(COLLECTIONS.transactions, recordId, buildOrderPaymentRecord({
      id: recordId,
      order: paidOrder,
      member,
      type: "order_payment",
      note: `订单 ${paidOrder.orderNo} ${paymentMethodLabel(paidOrder.paymentMethod)}`,
    }));
  }

  return paidOrder;
}

async function findOrderPaymentRecord(orderNo) {
  const result = await db
    .collection(COLLECTIONS.transactions)
    .where({ orderNo, type: "order_payment" })
    .limit(1)
    .get();
  return result.data?.[0] ? removeCloudId(result.data[0]) : null;
}

async function findRechargeRecord(rechargeNo) {
  const result = await db
    .collection(COLLECTIONS.transactions)
    .where({ orderNo: rechargeNo, type: "recharge" })
    .limit(1)
    .get();
  return result.data?.[0] ? removeCloudId(result.data[0]) : null;
}

function buildOrderPaymentRecord({ id, order, member, type, note }) {
  return {
    id,
    memberId: order.memberId || member?.id || "",
    memberName: member?.name || order.customerName || "微信顾客",
    memberPhone: member?.phone || order.customerPhone || "",
    memberCard: member?.card || "",
    storeId: order.storeId,
    staffId: null,
    type,
    amount: Number(order.totalAmount || 0),
    bonusAmount: 0,
    balanceAfter: member ? Number(member.balance || 0) : null,
    orderId: order.id,
    orderNo: order.orderNo,
    paymentMethod: order.paymentMethod,
    itemsText: (order.items || []).map((item) => `${item.name}×${item.quantity}`).join("，"),
    note,
    createdAt: new Date().toISOString(),
  };
}

function paymentMethodLabel(method) {
  return {
    wechat_pay: "微信支付",
    member_balance: "会员余额支付",
    alipay_pay: "支付宝",
    pay_on_pickup: "到店支付",
  }[method] || "支付";
}

async function normalizeOrderItems(rawItems, storeId) {
  if (!Array.isArray(rawItems)) return [];
  const products = await getProductsByStore(storeId);
  const productMap = new Map(products.map((product) => [product.id, product]));
  return rawItems
    .map((item) => {
      const product = productMap.get(item.productId || item.id);
      const quantity = Number(item.quantity || 0);
      if (!product || product.soldOut || quantity <= 0) return null;
      return {
        productId: product.id,
        name: product.name,
        category: product.category || "",
        price: Number(product.price) || 0,
        quantity,
        refundedQuantity: 0,
        refundAmount: 0,
        itemStatus: "normal",
      };
    })
    .filter(Boolean);
}

function buildFulfillmentInfo(payload = {}, deliverySettings = normalizeDeliverySettings()) {
  const fulfillmentType = payload.fulfillmentType === "delivery" ? "delivery" : "pickup";
  const pickupMode = payload.pickupMode === "scheduled" ? "scheduled" : "now";
  const pickupDate = String(payload.pickupDate || "").trim();
  const pickupTime = String(payload.pickupTime || "").trim();
  const deliveryAddress = String(payload.deliveryAddress || "").trim();
  const deliveryDate = String(payload.deliveryDate || "").trim();
  const deliveryTime = String(payload.deliveryTime || "").trim();
  const deliveryLatitude = Number(payload.deliveryLatitude);
  const deliveryLongitude = Number(payload.deliveryLongitude);

  if (fulfillmentType === "pickup" && pickupMode === "scheduled" && (!pickupDate || !pickupTime)) {
    return fail("请选择预约取餐日期和时间。");
  }
  if (fulfillmentType === "delivery" && !deliveryAddress) {
    return fail("请填写配送地址。");
  }
  if (fulfillmentType === "delivery") {
    if (!Number.isFinite(deliverySettings.storeLatitude) || !Number.isFinite(deliverySettings.storeLongitude)) {
      return fail("门店尚未配置配送定位，请联系店员。");
    }
    if (!Number.isFinite(deliveryLatitude) || !Number.isFinite(deliveryLongitude)) {
      return fail("请授权定位后再提交配送订单。");
    }
    const distanceKm = calculateDistanceKm(
      deliverySettings.storeLatitude,
      deliverySettings.storeLongitude,
      deliveryLatitude,
      deliveryLongitude
    );
    if (distanceKm > deliverySettings.maxDistanceKm) {
      return fail(`当前位置距门店 ${distanceKm.toFixed(1)} 公里，超出 3 公里配送范围。`);
    }
  }

  return {
    ok: true,
    fulfillmentType,
    pickupMode,
    pickupDate,
    pickupTime,
    deliveryAddress,
    deliveryDate,
    deliveryTime,
    deliveryLatitude: fulfillmentType === "delivery" ? deliveryLatitude : null,
    deliveryLongitude: fulfillmentType === "delivery" ? deliveryLongitude : null,
    deliveryDistanceKm: fulfillmentType === "delivery"
      ? Number(calculateDistanceKm(deliverySettings.storeLatitude, deliverySettings.storeLongitude, deliveryLatitude, deliveryLongitude).toFixed(2))
      : null,
    fulfillmentLabel: buildFulfillmentLabel({
      fulfillmentType,
      pickupMode,
      pickupDate,
      pickupTime,
      deliveryDate,
      deliveryTime,
    }),
  };
}

function normalizeDeliverySettings(settings = {}) {
  const numberOrNull = (value, min, max) => {
    if (value === "" || value === null || value === undefined) return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= min && number <= max ? number : null;
  };
  const storeLatitude = numberOrNull(settings.storeLatitude, -90, 90);
  const storeLongitude = numberOrNull(settings.storeLongitude, -180, 180);
  const testMode = settings.testMode === true;
  const inQianan = storeLatitude !== null && storeLongitude !== null
    && storeLatitude >= 39.75 && storeLatitude <= 40.35
    && storeLongitude >= 118.45 && storeLongitude <= 119.05;
  const coordinateAllowed = testMode || inQianan;
  return {
    fee: Math.max(0, Number.isFinite(Number(settings.fee)) ? Number(settings.fee) : 5),
    freeThreshold: Math.max(0, Number.isFinite(Number(settings.freeThreshold)) ? Number(settings.freeThreshold) : 58),
    maxDistanceKm: 3,
    storeLatitude: coordinateAllowed ? storeLatitude : null,
    storeLongitude: coordinateAllowed ? storeLongitude : null,
    testMode,
  };
}

async function getDeliverySettings() {
  const stored = await getDoc(COLLECTIONS.deliverySettings, DEFAULT_STORE_ID);
  return normalizeDeliverySettings(stored || {});
}

function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const deltaLat = radians(lat2 - lat1);
  const deltaLon = radians(lon2 - lon1);
  const a = Math.sin(deltaLat / 2) ** 2
    + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(deltaLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function buildFulfillmentLabel({
  fulfillmentType,
  pickupMode,
  pickupDate,
  pickupTime,
  deliveryDate,
  deliveryTime,
}) {
  if (fulfillmentType === "delivery") {
    const time = [deliveryDate, deliveryTime].filter(Boolean).join(" ");
    return time ? `配送 · ${time}` : "配送 · 尽快送达";
  }
  if (pickupMode === "scheduled") {
    return `预约取餐 · ${[pickupDate, pickupTime].filter(Boolean).join(" ")}`;
  }
  return "到店取餐 · 即时取餐";
}

function createOrderNo() {
  const stamp = new Date();
  const date = `${stamp.getFullYear()}${String(stamp.getMonth() + 1).padStart(2, "0")}${String(stamp.getDate()).padStart(2, "0")}`;
  return `AW${date}${String(Date.now()).slice(-5)}`;
}

function getOpenid(payload = {}) {
  const wxContext = cloud.getWXContext ? cloud.getWXContext() : {};
  return payload.openid || wxContext.OPENID || "";
}

async function getAll(collectionName) {
  const result = await db.collection(collectionName).limit(1000).get();
  return (result.data || []).map(removeCloudId);
}

async function safeGetAll(collectionName) {
  try {
    return await getAll(collectionName);
  } catch (error) {
    console.warn(`[${collectionName} skipped]`, error);
    return [];
  }
}

async function safeReplaceCollection(collectionName, rows, warnings) {
  try {
    await replaceCollection(collectionName, rows);
  } catch (error) {
    console.warn(`[${collectionName} save skipped]`, error);
    warnings.push(`${collectionName} 保存失败，请确认集合已创建`);
  }
}

async function safeMergeCollection(collectionName, rows, warnings) {
  try {
    const existing = await safeGetAll(collectionName);
    const merged = new Map(existing.map((row) => [row.id, row]));
    for (const row of rows) {
      if (!row?.id) continue;
      const current = merged.get(row.id);
      if (!current || documentTimestamp(row) >= documentTimestamp(current)) {
        merged.set(row.id, current ? { ...current, ...row } : row);
      }
    }
    await Promise.all(
      Array.from(merged.values()).map((row) => upsert(collectionName, row.id, row))
    );
  } catch (error) {
    console.warn(`[${collectionName} merge skipped]`, error);
    warnings.push(`${collectionName} 保存失败，请确认集合已创建`);
  }
}

function documentTimestamp(row = {}) {
  return Date.parse(row.deletedAt || row.updatedAt || row.createdAt || 0) || 0;
}

async function replaceCollection(collectionName, rows) {
  let existing = { data: [] };
  try {
    existing = await db.collection(collectionName).limit(1000).get();
  } catch (error) {
    console.warn(`[${collectionName} create on save]`, error);
  }
  await Promise.all(
    (existing.data || []).map((item) => db.collection(collectionName).doc(item._id).remove())
  );
  await Promise.all(
    rows.map((row) => {
      const id = row.id || row._id || createId(collectionName);
      return upsert(collectionName, id, { ...row, _id: id, id });
    })
  );
}

async function upsert(collectionName, id, data) {
  const { _id, ...documentData } = data;
  try {
    await db.collection(collectionName).doc(id).set({ data: documentData });
  } catch (error) {
    if (isCollectionMissing(error)) {
      await ensureCollection(collectionName);
      await db.collection(collectionName).doc(id).set({ data: documentData });
      return;
    }
    await db.collection(collectionName).doc(id).update({ data: documentData });
  }
}

async function ensureCollection(collectionName) {
  if (!db.createCollection) return;
  try {
    await db.createCollection(collectionName);
  } catch (error) {
    if (!isCollectionAlreadyExists(error)) {
      console.warn(`[${collectionName} create collection skipped]`, error);
    }
  }
}

function isCollectionMissing(error) {
  const message = String(error?.message || error?.errMsg || "");
  return message.includes("collection not exists") || message.includes("Table not exist");
}

function isCollectionAlreadyExists(error) {
  const message = String(error?.message || error?.errMsg || "");
  return message.includes("already exists") || message.includes("already exist") || message.includes("Collection already exists");
}

async function getDoc(collectionName, id) {
  try {
    const result = await db.collection(collectionName).doc(id).get();
    return result.data ? removeCloudId(result.data) : null;
  } catch {
    return null;
  }
}

function removeCloudId(row) {
  const { _id, ...rest } = row;
  return { ...rest, id: rest.id || _id };
}

function normalizePhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}

function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function ok(data = {}) {
  return { ok: true, ...data };
}

function fail(message) {
  return { ok: false, message };
}
