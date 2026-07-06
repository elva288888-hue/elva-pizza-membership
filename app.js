const STORAGE_KEY = "aiwa_drink_membership_v1";
const OTP_TEST_CODE = "123456";
const cloudConfig = window.AIWA_CLOUDBASE_CONFIG || {};
let cloudSaveTimer = null;
let localRefreshTimer = null;

const state = {
  localApi: {
    enabled: Boolean(cloudConfig.localApi),
    ready: false,
  },
  cloud: {
    enabled: Boolean(cloudConfig.enabled),
    ready: false,
    booting: false,
    message: "本地模式",
  },
  stores: [],
  staff: [],
  session: null,
  members: [],
  records: [],
  categories: [],
  products: [],
  orders: [],
  refunds: [],
  settings: {
    bonusRules: [],
  },
  activeView: "dashboard",
};

async function initLocalApi() {
  if (!cloudConfig.localApi) return;
  try {
    const localSnapshot = serializeState();
    const result = await callLocalApi("GET");
    state.localApi.ready = true;
    state.cloud.enabled = false;
    state.cloud.ready = false;
    state.cloud.message = "本地共享测试模式";
    const merged = await callLocalApi("POST", localSnapshot);
    if (result.data) {
      applyData(merged.data || result.data, { keepSession: true });
      saveState({ sync: false });
    } else if (merged.data) {
      applyData(merged.data, { keepSession: true });
      saveState({ sync: false });
    }
  } catch (error) {
    state.localApi.ready = false;
    state.cloud.message = "本地共享服务未连接，已使用当前浏览器数据";
    console.warn("[Local API]", error);
  }
}

async function callLocalApi(method, data) {
  const response = await fetch(cloudConfig.localApiUrl || "/api/local-data", {
    method,
    headers: { "Content-Type": "application/json" },
    body: method === "POST" ? JSON.stringify({ data }) : undefined,
  });
  const result = await response.json();
  if (!response.ok || result.ok === false) {
    throw new Error(result.message || "Local API request failed");
  }
  return result;
}

async function initCloudBase() {
  if (cloudConfig.localApi) {
    state.cloud.message = "本地共享测试模式";
    return;
  }
  if (!cloudConfig.enabled) {
    state.cloud.message = cloudConfig.envId
      ? `CloudBase 环境已记录：${cloudConfig.envId}，当前仍使用本地模式`
      : "本地模式";
    return;
  }

  if (!window.cloudbase || !cloudConfig.envId) {
    state.cloud.enabled = false;
    state.cloud.message = "CloudBase SDK 未加载，已切换本地模式";
    return;
  }

  try {
    state.cloud.app = window.cloudbase.init({ env: cloudConfig.envId });
    state.cloud.auth = state.cloud.app.auth();
    state.cloud.db = state.cloud.app.database();
    if (state.cloud.auth?.anonymousAuthProvider) {
      await state.cloud.auth.anonymousAuthProvider().signIn().catch(() => {});
    }
    state.cloud.ready = true;
    state.cloud.message = `CloudBase 已连接：${cloudConfig.envId}`;
  } catch (error) {
    state.cloud.enabled = false;
    state.cloud.ready = false;
    state.cloud.message = "CloudBase 初始化失败，已切换本地模式";
    console.warn("[CloudBase]", error);
  }
}

async function callCloud(action, payload = {}) {
  if (!state.cloud.ready || !state.cloud.app?.callFunction) {
    throw new Error("CloudBase is not ready");
  }
  const result = await state.cloud.app.callFunction({
    name: cloudConfig.functions?.membershipApi || "membershipApi",
    data: { action, payload },
  });
  if (!result.result?.ok) {
    throw new Error(result.result?.message || "CloudBase request failed");
  }
  return result.result;
}

const els = {
  loginScreen: document.querySelector("#loginScreen"),
  appShell: document.querySelector("#appShell"),
  loginForm: document.querySelector("#loginForm"),
  loginPhone: document.querySelector("#loginPhone"),
  loginCode: document.querySelector("#loginCode"),
  sendCode: document.querySelector("#sendCode"),
  loginHint: document.querySelector("#loginHint"),
  currentStoreName: document.querySelector("#currentStoreName"),
  currentStaffName: document.querySelector("#currentStaffName"),
  logoutButton: document.querySelector("#logoutButton"),
  navItems: document.querySelectorAll(".nav-item"),
  pageTitle: document.querySelector("#pageTitle"),
  views: {
    dashboard: document.querySelector("#dashboardView"),
    orders: document.querySelector("#ordersView"),
    products: document.querySelector("#productsView"),
    members: document.querySelector("#membersView"),
    records: document.querySelector("#recordsView"),
    settings: document.querySelector("#settingsView"),
  },
  memberCount: document.querySelector("#memberCount"),
  totalBalance: document.querySelector("#totalBalance"),
  todayRecharge: document.querySelector("#todayRecharge"),
  todaySpend: document.querySelector("#todaySpend"),
  todayOrderCount: document.querySelector("#todayOrderCount"),
  pendingOrderCount: document.querySelector("#pendingOrderCount"),
  todayOrderAmount: document.querySelector("#todayOrderAmount"),
  todayRefundAmount: document.querySelector("#todayRefundAmount"),
  quickTransactionForm: document.querySelector("#quickTransactionForm"),
  quickMember: document.querySelector("#quickMember"),
  quickType: document.querySelector("#quickType"),
  quickAmount: document.querySelector("#quickAmount"),
  quickNote: document.querySelector("#quickNote"),
  recentRecords: document.querySelector("#recentRecords"),
  dashboardOrders: document.querySelector("#dashboardOrders"),
  orderSearch: document.querySelector("#orderSearch"),
  orderStatusFilter: document.querySelector("#orderStatusFilter"),
  orderList: document.querySelector("#orderList"),
  productSearch: document.querySelector("#productSearch"),
  productList: document.querySelector("#productList"),
  addProduct: document.querySelector("#addProduct"),
  memberSearch: document.querySelector("#memberSearch"),
  recordSearch: document.querySelector("#recordSearch"),
  recordTypeFilter: document.querySelector("#recordTypeFilter"),
  recordStartDate: document.querySelector("#recordStartDate"),
  recordEndDate: document.querySelector("#recordEndDate"),
  clearRecordDates: document.querySelector("#clearRecordDates"),
  printFilteredRecords: document.querySelector("#printFilteredRecords"),
  memberList: document.querySelector("#memberList"),
  recordTable: document.querySelector("#recordTable"),
  bonusRuleForm: document.querySelector("#bonusRuleForm"),
  ruleMinAmount: document.querySelector("#ruleMinAmount"),
  ruleBonusAmount: document.querySelector("#ruleBonusAmount"),
  bonusRuleList: document.querySelector("#bonusRuleList"),
  staffForm: document.querySelector("#staffForm"),
  staffName: document.querySelector("#staffName"),
  staffPhone: document.querySelector("#staffPhone"),
  staffRole: document.querySelector("#staffRole"),
  staffList: document.querySelector("#staffList"),
  addMember: document.querySelector("#addMember"),
  addMemberTop: document.querySelector("#addMemberTop"),
  memberDialog: document.querySelector("#memberDialog"),
  memberDialogTitle: document.querySelector("#memberDialogTitle"),
  memberForm: document.querySelector("#memberForm"),
  memberId: document.querySelector("#memberId"),
  memberName: document.querySelector("#memberName"),
  memberPhone: document.querySelector("#memberPhone"),
  memberCard: document.querySelector("#memberCard"),
  memberBalance: document.querySelector("#memberBalance"),
  memberNote: document.querySelector("#memberNote"),
  saveMember: document.querySelector("#saveMember"),
  productDialog: document.querySelector("#productDialog"),
  productDialogTitle: document.querySelector("#productDialogTitle"),
  productForm: document.querySelector("#productForm"),
  productId: document.querySelector("#productId"),
  productName: document.querySelector("#productName"),
  productCategory: document.querySelector("#productCategory"),
  productPrice: document.querySelector("#productPrice"),
  productImage: document.querySelector("#productImage"),
  productImageFile: document.querySelector("#productImageFile"),
  productImagePreview: document.querySelector("#productImagePreview"),
  clearProductImage: document.querySelector("#clearProductImage"),
  productDescription: document.querySelector("#productDescription"),
  productActive: document.querySelector("#productActive"),
  saveProduct: document.querySelector("#saveProduct"),
  refundDialog: document.querySelector("#refundDialog"),
  refundOrderId: document.querySelector("#refundOrderId"),
  refundAmount: document.querySelector("#refundAmount"),
  refundMethod: document.querySelector("#refundMethod"),
  refundReason: document.querySelector("#refundReason"),
  confirmRefund: document.querySelector("#confirmRefund"),
  exportData: document.querySelector("#exportData"),
  importData: document.querySelector("#importData"),
  receiptPreviewDialog: document.querySelector("#receiptPreviewDialog"),
  receiptPreviewTitle: document.querySelector("#receiptPreviewTitle"),
  receiptPreviewBody: document.querySelector("#receiptPreviewBody"),
  closeReceiptPreview: document.querySelector("#closeReceiptPreview"),
  cancelReceiptPreview: document.querySelector("#cancelReceiptPreview"),
  confirmReceiptPrint: document.querySelector("#confirmReceiptPrint"),
  receiptPrintArea: document.querySelector("#receiptPrintArea"),
};

const viewTitles = {
  dashboard: "总览",
  orders: "订单",
  products: "商品",
  members: "会员",
  records: "流水",
  settings: "设置",
};

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) {
    const store = createStore("爱娃披萨店");
    const manager = createStaff("店长", "13800000000", "manager", store.id);
    state.stores = [store];
    state.staff = [manager];
    state.session = null;
    state.members = [createMember("示例会员", "13800000000", "AW0001", 100, "少冰三分糖", store.id)];
    state.records = [
      createRecord(state.members[0].id, "recharge", 100, 100, "开卡充值"),
    ];
    state.categories = createDefaultCategories(store.id);
    state.products = createDefaultProducts(store.id);
    state.orders = [];
    state.refunds = [];
    saveState();
    return;
  }

  try {
    const parsed = JSON.parse(saved);
    const fallbackStore = createStore("爱娃披萨店");
    state.stores = Array.isArray(parsed.stores) && parsed.stores.length ? parsed.stores : [fallbackStore];
    const defaultStoreId = state.stores[0].id;
    state.staff =
      Array.isArray(parsed.staff) && parsed.staff.length
        ? parsed.staff.map((staffer) => normalizeStaff(staffer, defaultStoreId))
        : [createStaff("店长", "13800000000", "manager", defaultStoreId)];
    state.session = normalizeSession(parsed.session);
    state.members = Array.isArray(parsed.members)
      ? parsed.members.map((member) => normalizeMember(member, defaultStoreId))
      : [];
    state.records = Array.isArray(parsed.records) ? parsed.records : [];
    state.categories = normalizeCategories(parsed.categories, defaultStoreId);
    state.products = normalizeProducts(parsed.products, defaultStoreId);
    state.orders = normalizeOrders(parsed.orders, defaultStoreId);
    state.refunds = normalizeRefunds(parsed.refunds, defaultStoreId);
    state.settings = normalizeSettings(parsed.settings);
    state.records = state.records.map(normalizeRecord);
  } catch {
    const store = createStore("爱娃披萨店");
    state.stores = [store];
    state.staff = [createStaff("店长", "13800000000", "manager", store.id)];
    state.session = null;
    state.members = [];
    state.records = [];
    state.categories = createDefaultCategories(store.id);
    state.products = createDefaultProducts(store.id);
    state.orders = [];
    state.refunds = [];
    state.settings = normalizeSettings();
  }
}

function serializeState() {
  return {
    stores: state.stores,
    staff: state.staff,
    session: state.session,
    members: state.members,
    records: state.records,
    categories: state.categories,
    products: state.products,
    orders: state.orders,
    refunds: state.refunds,
    settings: state.settings,
  };
}

function saveState(options = {}) {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(serializeState())
  );

  if (options.sync !== false && state.cloud.ready && !state.cloud.booting) {
    scheduleCloudSave();
  }
  if (options.sync !== false && state.localApi.ready && !state.cloud.booting) {
    scheduleCloudSave();
  }
}

function applyData(data, options = {}) {
  const fallbackStore = createStore("爱娃披萨店");
  state.stores = Array.isArray(data.stores) && data.stores.length ? data.stores : [fallbackStore];
  const defaultStoreId = state.stores[0].id;
  state.staff =
    Array.isArray(data.staff) && data.staff.length
      ? data.staff.map((staffer) => normalizeStaff(staffer, defaultStoreId))
      : [createStaff("店长", "13800000000", "manager", defaultStoreId)];
  state.session = options.keepSession ? state.session : normalizeSession(data.session);
  state.members = Array.isArray(data.members)
    ? data.members.map((member) => normalizeMember(member, defaultStoreId))
    : [];
  state.records = Array.isArray(data.records) ? data.records.map(normalizeRecord) : [];
  state.categories = normalizeCategories(data.categories, defaultStoreId);
  state.products = normalizeProducts(data.products, defaultStoreId);
  state.orders = normalizeOrders(data.orders, defaultStoreId);
  state.refunds = normalizeRefunds(data.refunds, defaultStoreId);
  state.settings = normalizeSettings(data.settings);
}

function hasBusinessData(data = serializeState()) {
  return (
    (Array.isArray(data.members) && data.members.length > 1) ||
    (Array.isArray(data.records) && data.records.length > 1) ||
    (Array.isArray(data.products) && data.products.length > 0) ||
    (Array.isArray(data.orders) && data.orders.length > 0) ||
    (Array.isArray(data.staff) && data.staff.length > 1) ||
    (Array.isArray(data.settings?.bonusRules) && data.settings.bonusRules.length > 0)
  );
}

async function syncFromCloud() {
  if (state.localApi.ready) {
    try {
      const result = await callLocalApi("GET");
      if (result.data) {
        const currentSession = state.session;
        applyData(result.data, { keepSession: true });
        state.session = currentSession;
        saveState({ sync: false });
      } else {
        await callLocalApi("POST", serializeState());
      }
    } catch (error) {
      console.warn("[Local API sync]", error);
    }
    return;
  }

  if (!state.cloud.ready) return;

  try {
    const localSnapshot = serializeState();
    const result = await callCloud("getStoreData");

    if (result.isNew && hasBusinessData(localSnapshot)) {
      await callCloud("saveStoreData", { data: localSnapshot });
      state.cloud.message = "CloudBase 已用本地数据初始化";
      return;
    }

    if (result.data) {
      const currentSession = state.session;
      applyData(result.data, { keepSession: true });
      state.session = currentSession;
      saveState({ sync: false });
      state.cloud.message = "CloudBase 数据已同步";
    }
  } catch (error) {
    state.cloud.ready = false;
    state.cloud.message = "CloudBase 同步失败，已继续使用本地数据";
    console.warn("[CloudBase sync]", error);
  }
}

function scheduleCloudSave() {
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer = setTimeout(pushCloudState, 500);
}

async function pushCloudState() {
  if (state.localApi.ready) {
    try {
      await callLocalApi("POST", serializeState());
      state.cloud.message = "本地共享数据已保存";
      return true;
    } catch (error) {
      console.warn("[Local API save]", error);
      return false;
    }
  }

  if (!state.cloud.ready) return false;
  try {
    await callCloud("saveStoreData", { data: serializeState() });
    state.cloud.message = "CloudBase 数据已保存";
    return true;
  } catch (error) {
    state.cloud.ready = false;
    state.cloud.message = "CloudBase 保存失败，已继续使用本地数据";
    console.warn("[CloudBase save]", error);
    return false;
  }
}

async function saveStaffAndSync() {
  saveState({ sync: false });
  renderStaff();

  if (!state.cloud.enabled && !state.localApi.ready) return;
  clearTimeout(cloudSaveTimer);
  const saved = await pushCloudState();
  if (!saved) {
    alert("店员已暂存在当前浏览器，但没有保存到云端。请检查网络后重新添加或刷新页面再试。");
  }
}

function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function createStore(name) {
  return {
    id: createId("store"),
    name,
    createdAt: new Date().toISOString(),
  };
}

function createStaff(name, phone, role, storeId) {
  return {
    id: createId("staff"),
    name,
    phone: normalizePhone(phone),
    role,
    storeId,
    active: true,
    createdAt: new Date().toISOString(),
  };
}

function createMember(name, phone, card, balance, note, storeId = getCurrentStore()?.id) {
  return {
    id: createId("member"),
    storeId,
    name,
    phone,
    card: card || nextCardNumber(),
    balance: Number(balance) || 0,
    note: note || "",
    createdAt: new Date().toISOString(),
  };
}

function createCategory(name, storeId = getCurrentStore()?.id) {
  return {
    id: createId("category"),
    storeId,
    name,
    sort: Date.now(),
    createdAt: new Date().toISOString(),
  };
}

function createProduct({
  name,
  category,
  price,
  description = "",
  image = "",
  active = true,
  storeId = getCurrentStore()?.id,
}) {
  return {
    id: createId("product"),
    storeId,
    name,
    category,
    price: Number(price) || 0,
    description,
    image,
    active: active !== false,
    soldOut: false,
    sort: Date.now(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
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
    createProduct({
      name: "玛格丽特披萨",
      category: "披萨",
      price: 39,
      description: "番茄底、马苏里拉芝士、罗勒风味",
      storeId,
    }),
    createProduct({
      name: "夏威夷披萨",
      category: "披萨",
      price: 45,
      description: "火腿、菠萝、芝士，酸甜清爽",
      storeId,
    }),
    createProduct({
      name: "双人分享套餐",
      category: "套餐",
      price: 88,
      description: "任选披萨 1 份，配小食和饮品",
      storeId,
    }),
    createProduct({
      name: "柠檬茶",
      category: "饮品",
      price: 12,
      description: "清爽解腻，可备注少冰",
      storeId,
    }),
  ];
}

function createRecord(memberId, type, amount, balanceAfter, note, bonusAmount = 0) {
  return {
    id: createId("record"),
    memberId,
    storeId: getMember(memberId)?.storeId || getCurrentStore()?.id,
    staffId: state.session?.staffId || null,
    type,
    amount: Number(amount),
    bonusAmount: Number(bonusAmount) || 0,
    balanceAfter: Number(balanceAfter),
    note: note || "",
    createdAt: new Date().toISOString(),
  };
}

function createOrder({
  customerName,
  customerPhone,
  memberId = "",
  items,
  pickupTime,
  fulfillmentType = "pickup",
  pickupMode = "now",
  pickupDate = "",
  deliveryAddress = "",
  deliveryDate = "",
  deliveryTime = "",
  note = "",
  paymentMethod = "wechat_pay",
  storeId = getCurrentStore()?.id,
}) {
  const normalizedItems = items.map((item) => ({
    productId: item.productId,
    name: item.name,
    category: item.category || "",
    price: Number(item.price) || 0,
    quantity: Number(item.quantity) || 1,
    refundedQuantity: 0,
    refundAmount: 0,
    itemStatus: "normal",
  }));
  const totalAmount = normalizedItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
  return {
    id: createId("order"),
    orderNo: createOrderNo(),
    storeId,
    customerName,
    customerPhone: normalizePhone(customerPhone),
    memberId,
    isMember: Boolean(memberId),
    items: normalizedItems,
    totalAmount,
    paidAmount: 0,
    refundAmount: 0,
    adjustmentAmount: 0,
    status: "pending",
    paymentStatus: ["member_balance", "wechat_pay", "alipay_pay"].includes(paymentMethod) ? "paid" : "unpaid",
    paymentMethod,
    fulfillmentType,
    pickupMode,
    pickupDate,
    pickupTime,
    deliveryAddress,
    deliveryDate,
    deliveryTime,
    fulfillmentLabel: buildFulfillmentLabel({ fulfillmentType, pickupMode, pickupDate, pickupTime, deliveryDate, deliveryTime }),
    note,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function createOrderNo() {
  const stamp = new Date();
  const date = `${stamp.getFullYear()}${String(stamp.getMonth() + 1).padStart(2, "0")}${String(stamp.getDate()).padStart(2, "0")}`;
  return `AW${date}${String(Date.now()).slice(-5)}`;
}

function normalizeSettings(settings = {}) {
  const bonusRules = Array.isArray(settings.bonusRules)
    ? settings.bonusRules
        .map((rule) => ({
          id: rule.id || createId("rule"),
          minAmount: Number(rule.minAmount),
          bonusAmount: Number(rule.bonusAmount),
        }))
        .filter((rule) => rule.minAmount > 0 && rule.bonusAmount >= 0)
        .sort((a, b) => a.minAmount - b.minAmount)
    : [];
  return { bonusRules };
}

function normalizePhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}

function normalizeSession(session) {
  if (!session?.staffId || !session?.storeId) return null;
  return {
    staffId: session.staffId,
    storeId: session.storeId,
    loggedInAt: session.loggedInAt || new Date().toISOString(),
  };
}

function normalizeStaff(staffer, defaultStoreId) {
  return {
    id: staffer.id || createId("staff"),
    name: staffer.name || "店员",
    phone: normalizePhone(staffer.phone),
    role: staffer.role === "manager" ? "manager" : "staff",
    storeId: staffer.storeId || defaultStoreId,
    active: staffer.active !== false,
    createdAt: staffer.createdAt || new Date().toISOString(),
  };
}

function normalizeMember(member, defaultStoreId) {
  return {
    ...member,
    storeId: member.storeId || defaultStoreId,
    phone: normalizePhone(member.phone),
    balance: Number(member.balance) || 0,
  };
}

function normalizeRecord(record) {
  return {
    ...record,
    storeId: record.storeId || getMember(record.memberId)?.storeId || state.stores[0]?.id,
    staffId: record.staffId || null,
    amount: Number(record.amount) || 0,
    bonusAmount: Number(record.bonusAmount) || 0,
    balanceAfter: Number(record.balanceAfter) || 0,
    createdAt: record.createdAt || new Date().toISOString(),
  };
}

function normalizeCategories(categories, defaultStoreId) {
  if (!Array.isArray(categories) || !categories.length) return createDefaultCategories(defaultStoreId);
  return categories.map((category, index) => ({
    id: category.id || createId("category"),
    storeId: category.storeId || defaultStoreId,
    name: category.name || "未分类",
    sort: Number(category.sort) || index + 1,
    createdAt: category.createdAt || new Date().toISOString(),
  }));
}

function normalizeProducts(products, defaultStoreId) {
  if (!Array.isArray(products) || !products.length) return createDefaultProducts(defaultStoreId);
  return products.map((product, index) => ({
    id: product.id || createId("product"),
    storeId: product.storeId || defaultStoreId,
    name: product.name || "未命名商品",
    category: product.category || "未分类",
    price: Number(product.price) || 0,
    description: product.description || "",
    image: product.image || "",
    active: product.active !== false,
    soldOut: Boolean(product.soldOut),
    deletedAt: product.deletedAt || "",
    sort: Number(product.sort) || index + 1,
    createdAt: product.createdAt || new Date().toISOString(),
    updatedAt: product.updatedAt || product.createdAt || new Date().toISOString(),
  }));
}

function normalizeOrders(orders, defaultStoreId) {
  if (!Array.isArray(orders)) return [];
  return orders.map((order) => {
    const items = Array.isArray(order.items) ? order.items : [];
    const normalizedItems = items.map((item) => ({
      productId: item.productId || "",
      name: item.name || "商品",
      category: item.category || "",
      price: Number(item.price) || 0,
      quantity: Number(item.quantity) || 1,
      refundedQuantity: Number(item.refundedQuantity) || 0,
      refundAmount: Number(item.refundAmount) || 0,
      itemStatus: item.itemStatus || "normal",
    }));
    const totalAmount =
      Number(order.totalAmount) ||
      normalizedItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
    return {
      id: order.id || createId("order"),
      orderNo: order.orderNo || createOrderNo(),
      storeId: order.storeId || defaultStoreId,
      customerName: order.customerName || "顾客",
      customerPhone: normalizePhone(order.customerPhone),
      customerOpenid: order.customerOpenid || "",
      memberId: order.memberId || "",
      isMember: Boolean(order.memberId || order.isMember),
      items: normalizedItems,
      totalAmount,
      paidAmount: Number(order.paidAmount) || 0,
      refundAmount: Number(order.refundAmount) || 0,
      adjustmentAmount: Number(order.adjustmentAmount) || 0,
      status: order.status || "pending",
      paymentStatus: order.paymentStatus || "unpaid",
      paymentMethod: order.paymentMethod || "wechat_pay",
      paymentTradeNo: order.paymentTradeNo || "",
      paymentRedirect: order.paymentRedirect || "",
      fulfillmentType: order.fulfillmentType || "pickup",
      pickupMode: order.pickupMode || (order.pickupTime && order.pickupTime !== "尽快" ? "scheduled" : "now"),
      pickupDate: order.pickupDate || "",
      pickupTime: order.pickupTime || "",
      deliveryAddress: order.deliveryAddress || "",
      deliveryDate: order.deliveryDate || "",
      deliveryTime: order.deliveryTime || "",
      fulfillmentLabel: order.fulfillmentLabel || buildFulfillmentLabel(order),
      note: order.note || "",
      cancelReason: order.cancelReason || "",
      refundReason: order.refundReason || "",
      createdAt: order.createdAt || new Date().toISOString(),
      updatedAt: order.updatedAt || order.createdAt || new Date().toISOString(),
    };
  });
}

function normalizeRefunds(refunds, defaultStoreId) {
  if (!Array.isArray(refunds)) return [];
  return refunds.map((refund) => ({
    id: refund.id || createId("refund"),
    storeId: refund.storeId || defaultStoreId,
    orderId: refund.orderId || "",
    memberId: refund.memberId || "",
    amount: Number(refund.amount) || 0,
    reason: refund.reason || "",
    method: refund.method || "manual",
    status: refund.status || "completed",
    staffId: refund.staffId || null,
    createdAt: refund.createdAt || new Date().toISOString(),
  }));
}

function recordTypeLabel(type) {
  const labels = {
    recharge: "充值",
    spend: "消费",
    refund: "退款",
    adjust: "调整",
    order_payment: "订单支付",
    order_refund: "订单退款",
    order_cancel: "订单取消",
  };
  return labels[type] || "流水";
}

function recordAmountText(record) {
  if (record.type === "spend" || record.type === "order_payment") return `+${money(record.amount)}`;
  if (record.type === "refund" || record.type === "order_refund") return `-${money(record.amount)}`;
  if (record.type === "order_cancel") return money(0);
  if (record.type === "adjust") {
    const prefix = record.amount >= 0 ? "+" : "-";
    return `${prefix}${money(Math.abs(record.amount))}`;
  }
  return `+${money(record.amount)}`;
}

function recordBonusText(record) {
  return record.bonusAmount ? `+${money(record.bonusAmount)}` : "-";
}

function getRechargeBonus(amount) {
  const value = Number(amount) || 0;
  const matched = [...state.settings.bonusRules]
    .filter((rule) => value >= rule.minAmount)
    .sort((a, b) => b.minAmount - a.minAmount)[0];
  return matched ? matched.bonusAmount : 0;
}

function getRecordDateRange() {
  return {
    start: els.recordStartDate.value ? new Date(`${els.recordStartDate.value}T00:00:00`) : null,
    end: els.recordEndDate.value ? new Date(`${els.recordEndDate.value}T23:59:59`) : null,
  };
}

function isRecordInDateRange(record, range = getRecordDateRange()) {
  const createdAt = new Date(record.createdAt);
  if (range.start && createdAt < range.start) return false;
  if (range.end && createdAt > range.end) return false;
  return true;
}

function recordDateRangeLabel(range = getRecordDateRange()) {
  const start = els.recordStartDate.value || "不限";
  const end = els.recordEndDate.value || "不限";
  return `日期：${start} 至 ${end}`;
}

function recordSearchLabel() {
  return els.recordSearch.value.trim() || "不限";
}

function recordTypeFilterLabel() {
  return els.recordTypeFilter.value === "all" ? "全部类型" : recordTypeLabel(els.recordTypeFilter.value);
}

function buildUnifiedTransactions() {
  const orderItemsText = (order) =>
    (order?.items || []).map((item) => `${item.name}×${item.quantity}`).join("，");

  const memberRecords = getStoreRecords().map((record) => {
    const member = getMember(record.memberId);
    return {
      id: `record_${record.id}`,
      source: "member_record",
      type: record.type,
      createdAt: record.createdAt,
      memberId: record.memberId,
      memberName: member?.name || "已删除会员",
      memberPhone: member?.phone || "",
      memberCard: member?.card || "",
      amount: Number(record.amount) || 0,
      bonusAmount: Number(record.bonusAmount) || 0,
      balanceAfter: Number(record.balanceAfter) || 0,
      paymentMethod: record.type === "recharge" ? "member_balance" : "",
      orderNo: "",
      itemsText: "",
      note: record.note || "",
    };
  });

  const orderPayments = getStoreOrders()
    .filter((order) => Number(order.paidAmount || 0) > 0)
    .map((order) => {
      const member = getMember(order.memberId);
      return {
        id: `order_payment_${order.id}`,
        source: "order",
        type: "order_payment",
        createdAt: order.createdAt,
        memberId: order.memberId || "",
        memberName: member?.name || order.customerName || "顾客",
        memberPhone: member?.phone || order.customerPhone || "",
        memberCard: member?.card || "",
        amount: Number(order.paidAmount || order.totalAmount || 0),
        bonusAmount: 0,
        balanceAfter: member?.balance ?? null,
        paymentMethod: order.paymentMethod || "",
        orderNo: order.orderNo,
        itemsText: orderItemsText(order),
        note: paymentMethodLabel(order.paymentMethod),
      };
    });

  const refundRows = state.refunds
    .filter((refund) => refund.storeId === getCurrentStore()?.id)
    .map((refund) => {
      const order = getOrder(refund.orderId);
      const member = getMember(refund.memberId || order?.memberId);
      return {
        id: `refund_${refund.id}`,
        source: "refund",
        type: "order_refund",
        createdAt: refund.createdAt,
        memberId: refund.memberId || order?.memberId || "",
        memberName: member?.name || order?.customerName || "顾客",
        memberPhone: member?.phone || order?.customerPhone || "",
        memberCard: member?.card || "",
        amount: Number(refund.amount) || 0,
        bonusAmount: 0,
        balanceAfter: member?.balance ?? null,
        paymentMethod: refund.method || order?.paymentMethod || "",
        orderNo: order?.orderNo || "",
        itemsText: orderItemsText(order),
        note: refund.reason || order?.refundReason || "",
      };
    });

  const cancelledOrders = getStoreOrders()
    .filter((order) => order.status === "cancelled")
    .map((order) => {
      const member = getMember(order.memberId);
      return {
        id: `order_cancel_${order.id}`,
        source: "order",
        type: "order_cancel",
        createdAt: order.updatedAt || order.createdAt,
        memberId: order.memberId || "",
        memberName: member?.name || order.customerName || "顾客",
        memberPhone: member?.phone || order.customerPhone || "",
        memberCard: member?.card || "",
        amount: 0,
        bonusAmount: 0,
        balanceAfter: member?.balance ?? null,
        paymentMethod: order.paymentMethod || "",
        orderNo: order.orderNo,
        itemsText: orderItemsText(order),
        note: order.cancelReason || "订单取消",
      };
    });

  return [...memberRecords, ...orderPayments, ...refundRows, ...cancelledOrders];
}

function getFilteredRecords() {
  const keyword = els.recordSearch.value.trim().toLowerCase();
  const type = els.recordTypeFilter.value;
  return buildUnifiedTransactions()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .filter((record) => {
      const typeText = recordTypeLabel(record.type);
      const text = `${record.memberName} ${record.memberPhone} ${record.memberCard} ${record.orderNo} ${record.itemsText} ${record.note} ${paymentMethodLabel(record.paymentMethod)} ${typeText}`.toLowerCase();
      return (type === "all" || record.type === type) && text.includes(keyword) && isRecordInDateRange(record);
    });
}

function nextCardNumber() {
  const usedCards = new Set(state.members.map((member) => member.card).filter(Boolean));
  const maxCardNumber = state.members.reduce((max, member) => {
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

function money(value) {
  return `¥${Number(value || 0).toFixed(2)}`;
}

function formatTime(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatFullTime(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function isToday(value) {
  const date = new Date(value);
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function getCurrentStore() {
  return state.stores.find((store) => store.id === state.session?.storeId) || state.stores[0];
}

function getCurrentStaff() {
  return state.staff.find((staffer) => staffer.id === state.session?.staffId) || null;
}

function getStoreMembers() {
  const storeId = getCurrentStore()?.id;
  const orderPhones = new Set(
    state.orders
      .filter((order) => order.storeId === storeId)
      .map((order) => normalizePhone(order.customerPhone))
      .filter(Boolean)
  );
  const rows = state.members.filter((member) => member.storeId === storeId || orderPhones.has(member.phone));
  return Array.from(new Map(rows.map((member) => [member.id, member])).values());
}

function getStoreRecords() {
  const storeId = getCurrentStore()?.id;
  return state.records.filter((record) => record.storeId === storeId || getMember(record.memberId)?.storeId === storeId);
}

function getStoreStaff() {
  const storeId = getCurrentStore()?.id;
  return state.staff.filter((staffer) => staffer.storeId === storeId);
}

function getStoreProducts() {
  const storeId = getCurrentStore()?.id;
  return state.products.filter((product) => product.storeId === storeId && !product.deletedAt);
}

function getStoreOrders() {
  const storeId = getCurrentStore()?.id;
  return state.orders.filter((order) => order.storeId === storeId);
}

function getOrder(orderId) {
  return state.orders.find((order) => order.id === orderId);
}

function getMember(memberId) {
  return state.members.find((member) => member.id === memberId);
}

function render() {
  renderSession();
  renderNavigation();
  renderDashboard();
  renderOrders();
  renderProducts();
  renderMembers();
  renderRecords();
  renderQuickMembers();
  renderBonusRules();
  renderStaff();
}

function startLocalRefresh() {
  if (!state.localApi.ready || localRefreshTimer) return;
  localRefreshTimer = setInterval(async () => {
    if (!["orders", "dashboard", "members", "records", "products"].includes(state.activeView)) return;
    try {
      const result = await callLocalApi("GET");
      if (result.data) {
        const currentSession = state.session;
        applyData(result.data, { keepSession: true });
        state.session = currentSession;
        saveState({ sync: false });
        render();
      }
    } catch (error) {
      console.warn("[Local API refresh]", error);
    }
  }, 3000);
}

function renderSession() {
  const store = getCurrentStore();
  const staffer = getCurrentStaff();
  els.currentStoreName.textContent = store?.name || "未选择门店";
  els.currentStaffName.textContent = staffer ? `${staffer.name} · ${staffer.role === "manager" ? "店长" : "店员"}` : "未登录";
}

function renderNavigation() {
  els.pageTitle.textContent = viewTitles[state.activeView];
  for (const [view, element] of Object.entries(els.views)) {
    element.classList.toggle("active-view", view === state.activeView);
  }
  els.navItems.forEach((item) => {
    item.classList.toggle("active", item.dataset.view === state.activeView);
  });
}

function renderDashboard() {
  const storeRecords = getStoreRecords();
  const storeMembers = getStoreMembers();
  const storeOrders = getStoreOrders();
  const todayRecords = storeRecords.filter((record) => isToday(record.createdAt));
  const todayOrders = storeOrders.filter((order) => isToday(order.createdAt));
  const todayRecharge = todayRecords
    .filter((record) => record.type === "recharge")
    .reduce((sum, record) => sum + record.amount, 0);
  const todaySpend = todayRecords
    .filter((record) => record.type === "spend")
    .reduce((sum, record) => sum + record.amount, 0);
  const todayRefund = todayRecords
    .filter((record) => record.type === "refund")
    .reduce((sum, record) => sum + record.amount, 0);
  const todayOrderAmount = todayOrders
    .filter((order) => !["cancelled", "refunded"].includes(order.status))
    .reduce((sum, order) => sum + order.totalAmount - (order.refundAmount || 0), 0);
  const pendingCount = storeOrders.filter((order) => ["pending", "making", "ready"].includes(order.status)).length;
  const totalBalance = storeMembers.reduce((sum, member) => sum + member.balance, 0);

  els.memberCount.textContent = String(storeMembers.length);
  els.totalBalance.textContent = money(totalBalance);
  els.todayRecharge.textContent = money(todayRecharge);
  els.todaySpend.textContent = money(todaySpend);
  els.todayOrderCount.textContent = String(todayOrders.length);
  els.pendingOrderCount.textContent = String(pendingCount);
  els.todayOrderAmount.textContent = money(todayOrderAmount);
  els.todayRefundAmount.textContent = money(todayRefund);

  const recent = buildUnifiedTransactions()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 6);

  if (!recent.length) {
    els.recentRecords.className = "record-list empty-state";
    els.recentRecords.textContent = "暂无记录";
  } else {
    els.recentRecords.className = "record-list";
    els.recentRecords.innerHTML = recent.map(recordTemplate).join("");
  }

  const waitingOrders = storeOrders
    .filter((order) => ["pending", "making", "ready"].includes(order.status))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .slice(0, 4);

  if (!waitingOrders.length) {
    els.dashboardOrders.className = "order-list empty-state";
    els.dashboardOrders.textContent = "暂无待处理订单";
    return;
  }

  els.dashboardOrders.className = "order-list compact-order-list";
  els.dashboardOrders.innerHTML = waitingOrders.map(orderTemplate).join("");
}

function renderQuickMembers() {
  const storeMembers = getStoreMembers();
  if (!storeMembers.length) {
    els.quickMember.innerHTML = '<option value="">请先新增会员</option>';
    els.quickMember.disabled = true;
    return;
  }

  els.quickMember.disabled = false;
  els.quickMember.innerHTML = storeMembers
    .map(
      (member) =>
        `<option value="${member.id}">${escapeHtml(member.name)} - ${escapeHtml(member.card)} - ${money(member.balance)}</option>`
    )
    .join("");
}

function renderMembers() {
  const keyword = els.memberSearch.value.trim().toLowerCase();
  const storeMembers = getStoreMembers();
  const members = storeMembers.filter((member) => {
    const text = `${member.name} ${member.phone} ${member.card}`.toLowerCase();
    return text.includes(keyword);
  });

  if (!members.length) {
    els.memberList.className = "member-list empty-state";
    els.memberList.textContent = storeMembers.length ? "没有匹配的会员" : "暂无会员";
    return;
  }

  els.memberList.className = "member-list";
  els.memberList.innerHTML = members
    .map(
      (member) => `
        <article class="member-card">
          <header>
            <div>
              <h3>${escapeHtml(member.name)}</h3>
              <p>${escapeHtml(member.phone)} · ${escapeHtml(member.card)}</p>
            </div>
            <div class="balance">${money(member.balance)}</div>
          </header>
          <p>${escapeHtml(member.note || "暂无备注")}</p>
          <div class="card-actions">
            <button class="mini-button" data-action="recharge" data-id="${member.id}" type="button">充值</button>
            <button class="mini-button" data-action="spend" data-id="${member.id}" type="button">消费</button>
            <button class="mini-button" data-action="edit" data-id="${member.id}" type="button">编辑</button>
            <button class="mini-button" data-action="print-member" data-id="${member.id}" type="button">打印记录</button>
          </div>
        </article>
      `
    )
    .join("");
}

function orderStatusLabel(status) {
  const labels = {
    pending: "待接单",
    making: "制作中",
    ready: "待取餐",
    completed: "已完成",
    cancelled: "已取消",
    refunded: "已退款",
    partial_refund: "部分退款",
  };
  return labels[status] || "未知";
}

function paymentMethodLabel(method) {
  const labels = {
    wechat_pay: "微信支付",
    alipay_pay: "支付宝",
    member_balance: "会员余额支付",
    store_pay: "到店支付",
    cash: "现金",
    wechat: "微信支付",
  };
  return labels[method] || "手动记录";
}

function buildFulfillmentLabel(order) {
  if (order.fulfillmentLabel) return order.fulfillmentLabel;
  if (order.fulfillmentType === "delivery") {
    const when = [order.deliveryDate, order.deliveryTime].filter(Boolean).join(" ");
    return `配送${when ? ` · ${when}` : ""}`;
  }
  if (order.pickupMode === "scheduled") {
    const when = [order.pickupDate, order.pickupTime].filter(Boolean).join(" ");
    return `到店取餐${when ? ` · ${when}` : ""}`;
  }
  return `到店取餐 · ${order.pickupTime && order.pickupTime !== "尽快" ? order.pickupTime : "即时取餐"}`;
}

function fulfillmentDetail(order) {
  if (order.fulfillmentType !== "delivery") return "";
  return order.deliveryAddress ? `配送地址：${order.deliveryAddress}` : "";
}

function getFilteredOrders() {
  const keyword = els.orderSearch.value.trim().toLowerCase();
  const status = els.orderStatusFilter.value;
  return [...getStoreOrders()]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .filter((order) => {
      const itemText = order.items.map((item) => item.name).join(" ");
      const member = getMember(order.memberId);
      const text = `${order.orderNo} ${order.customerName} ${order.customerPhone} ${member?.name || ""} ${member?.phone || ""} ${member?.card || ""} ${itemText}`.toLowerCase();
      return (status === "all" || order.status === status) && text.includes(keyword);
    });
}

function renderOrders() {
  const orders = getFilteredOrders();
  if (!orders.length) {
    els.orderList.className = "order-list empty-state";
    els.orderList.textContent = getStoreOrders().length ? "没有匹配的订单" : "暂无订单";
    return;
  }

  els.orderList.className = "order-list";
  els.orderList.innerHTML = orders.map(orderTemplate).join("");
}

function orderTemplate(order) {
  const member = getMember(order.memberId);
  const customerLabel = member
    ? `${member.name} · ${member.card} · ${member.phone}`
    : `${order.customerName} · ${order.customerPhone || order.customerOpenid || "微信顾客"}`;
  const netAmount = order.totalAmount - (order.refundAmount || 0);
  const canRefund = !["cancelled", "refunded"].includes(order.status) && netAmount > 0;
  const nextActions = {
    pending: [["making", "接单制作"], ["cancelled", "取消订单"]],
    making: [["ready", "标记待取"], ["cancelled", "取消订单"]],
    ready: [["completed", "完成取餐"]],
  }[order.status] || [];

  return `
    <article class="order-card" data-status="${order.status}">
      <header>
        <div>
          <strong>${escapeHtml(order.orderNo)}</strong>
          <span>${formatFullTime(order.createdAt)}</span>
        </div>
        <span class="status-pill ${order.status}">${orderStatusLabel(order.status)}</span>
      </header>
      <div class="order-meta">
        <span>${escapeHtml(customerLabel)}</span>
        <span>${member ? "会员下单" : "非会员下单"}</span>
        <span>${escapeHtml(buildFulfillmentLabel(order))}</span>
        <span>${paymentMethodLabel(order.paymentMethod)} · ${order.paymentStatus === "paid" ? "已支付" : "未支付"}</span>
      </div>
      <div class="order-items">
        ${order.items
          .map(
            (item) => `
              <div>
                <span>${escapeHtml(item.name)} × ${item.quantity}</span>
                <strong>${money(item.price * item.quantity)}</strong>
              </div>
            `
          )
          .join("")}
      </div>
      ${fulfillmentDetail(order) ? `<p class="order-note">${escapeHtml(fulfillmentDetail(order))}</p>` : ""}
      ${order.note ? `<p class="order-note">${escapeHtml(order.note)}</p>` : ""}
      <footer>
        <div class="order-total">
          <span>合计 ${money(order.totalAmount)}</span>
          ${order.refundAmount ? `<span>已退 ${money(order.refundAmount)}</span>` : ""}
          <strong>实收 ${money(netAmount)}</strong>
        </div>
        <div class="card-actions inline-actions">
          ${nextActions
            .map(
              ([status, label]) =>
                `<button class="mini-button" data-order-status="${status}" data-id="${order.id}" type="button">${label}</button>`
            )
            .join("")}
          ${canRefund ? `<button class="mini-button danger-button" data-order-refund="${order.id}" type="button">退款/退货</button>` : ""}
        </div>
      </footer>
    </article>
  `;
}

function renderProducts() {
  const keyword = els.productSearch.value.trim().toLowerCase();
  const products = getStoreProducts()
    .filter((product) => `${product.name} ${product.category}`.toLowerCase().includes(keyword))
    .sort((a, b) => String(a.category).localeCompare(String(b.category), "zh-CN") || a.sort - b.sort);

  if (!products.length) {
    els.productList.className = "product-list empty-state";
    els.productList.textContent = getStoreProducts().length ? "没有匹配的商品" : "暂无商品";
    return;
  }

  els.productList.className = "product-list";
  els.productList.innerHTML = products
    .map(
      (product) => `
        <article class="product-card">
          <div class="product-thumb">${product.image ? `<img src="${escapeHtml(product.image)}" alt="">` : escapeHtml(product.name.slice(0, 1))}</div>
          <div>
            <h3>${escapeHtml(product.name)}</h3>
            <p>${escapeHtml(product.category)} · ${escapeHtml(product.description || "暂无描述")}</p>
            <strong>${money(product.price)}</strong>
          </div>
          <div class="card-actions product-actions">
            <button class="mini-button" data-product-edit="${product.id}" type="button">编辑</button>
            <button class="mini-button" data-product-toggle="${product.id}" type="button">${product.active ? "下架" : "上架"}</button>
            <button class="mini-button" data-product-soldout="${product.id}" type="button">${product.soldOut ? "恢复" : "售罄"}</button>
            <button class="mini-button danger-button" data-product-delete="${product.id}" type="button">删除</button>
          </div>
        </article>
      `
    )
    .join("");
}

function renderRecords() {
  const records = getFilteredRecords();

  if (!records.length) {
    els.recordTable.innerHTML = `
      <tr>
        <td colspan="8" class="empty-state">暂无流水</td>
      </tr>
    `;
    return;
  }

  els.recordTable.innerHTML = records
    .map((record) => {
      const amountText = recordAmountText(record);
      const memberText = [record.memberName, record.memberPhone || record.memberCard].filter(Boolean).join(" · ");
      const balanceText = record.balanceAfter === null || record.balanceAfter === undefined ? "-" : money(record.balanceAfter);
      const noteParts = [
        record.orderNo ? `订单 ${record.orderNo}` : "",
        record.paymentMethod ? paymentMethodLabel(record.paymentMethod) : "",
        record.note || "",
      ].filter(Boolean);
      return `
        <tr>
          <td>${formatTime(record.createdAt)}</td>
          <td>${escapeHtml(memberText || "顾客")}</td>
          <td>${recordTypeLabel(record.type)}</td>
          <td>${escapeHtml(record.itemsText || "-")}</td>
          <td class="record-amount ${record.type}">${amountText}</td>
          <td class="record-amount recharge">${recordBonusText(record)}</td>
          <td>${balanceText}</td>
          <td>${escapeHtml(noteParts.join("；") || "-")}</td>
        </tr>
      `;
    })
    .join("");
}

function recordTemplate(record) {
  const amountText = recordAmountText(record);
  const balanceText = record.balanceAfter === null || record.balanceAfter === undefined ? "" : ` · 余额 ${money(record.balanceAfter)}`;
  return `
    <article class="record-item">
      <div>
        <strong>${escapeHtml(record.memberName || "顾客")} · ${recordTypeLabel(record.type)}</strong>
        <span>${formatTime(record.createdAt)}${balanceText}${record.orderNo ? ` · ${escapeHtml(record.orderNo)}` : ""}</span>
        ${record.note ? `<p>${escapeHtml(record.note)}</p>` : ""}
      </div>
      <div class="record-amount ${record.type}">${amountText}</div>
    </article>
  `;
}

function renderBonusRules() {
  const rules = [...state.settings.bonusRules].sort((a, b) => a.minAmount - b.minAmount);
  if (!rules.length) {
    els.bonusRuleList.className = "rule-list empty-state";
    els.bonusRuleList.textContent = "暂无赠送规则";
    return;
  }

  els.bonusRuleList.className = "rule-list";
  els.bonusRuleList.innerHTML = rules
    .map(
      (rule) => `
        <article class="rule-item">
          <strong>充值满 ${money(rule.minAmount)} 赠送 ${money(rule.bonusAmount)}</strong>
          <button class="mini-button danger-button" data-delete-rule="${rule.id}" type="button">删除</button>
        </article>
      `
    )
    .join("");
}

function renderStaff() {
  const staff = getStoreStaff();
  if (!staff.length) {
    els.staffList.className = "rule-list empty-state";
    els.staffList.textContent = "暂无店员";
    return;
  }

  els.staffList.className = "rule-list";
  els.staffList.innerHTML = staff
    .map(
      (staffer) => `
        <article class="rule-item">
          <div>
            <strong>${escapeHtml(staffer.name)} · ${staffer.role === "manager" ? "店长" : "店员"}</strong>
            <span>${escapeHtml(staffer.phone)} · ${staffer.active ? "可登录" : "已停用"}</span>
          </div>
          <button class="mini-button ${staffer.active ? "danger-button" : ""}" data-toggle-staff="${staffer.id}" type="button">
            ${staffer.active ? "停用" : "启用"}
          </button>
        </article>
      `
    )
    .join("");
}

function showLogin() {
  els.loginScreen.classList.remove("hidden");
  els.appShell.classList.add("hidden");
}

function showApp() {
  els.loginScreen.classList.add("hidden");
  els.appShell.classList.remove("hidden");
  render();
}

function ensureSession() {
  const staffer = getCurrentStaff();
  const store = getCurrentStore();
  if (staffer?.active && store) {
    showApp();
  } else {
    state.session = null;
    saveState();
    showLogin();
  }
}

async function sendTestCode() {
  const phone = normalizePhone(els.loginPhone.value);

  if (state.cloud.ready) {
    try {
      const result = await callCloud("sendLoginCode", { phone });
      els.loginHint.textContent = result.message || `测试验证码已发送：${result.testCode || OTP_TEST_CODE}`;
      return;
    } catch (error) {
      els.loginHint.textContent = error.message || "云端验证码发送失败，已使用本地测试模式。";
      console.warn("[CloudBase login]", error);
    }
  }

  const staffer = state.staff.find((item) => item.phone === phone && item.active);
  if (!staffer) {
    els.loginHint.textContent = "这个手机号还没有录入为店员，请先让店长添加。";
    return;
  }
  els.loginHint.textContent = `测试验证码已发送：${OTP_TEST_CODE}`;
}

async function loginWithCode() {
  const phone = normalizePhone(els.loginPhone.value);
  const code = els.loginCode.value.trim();

  if (state.cloud.ready) {
    try {
      const result = await callCloud("verifyLoginCode", { phone, code });
      state.session = normalizeSession(result.session);
      saveState();
      showApp();
      return;
    } catch (error) {
      els.loginHint.textContent = error.message || "云端登录失败，已使用本地测试模式。";
      console.warn("[CloudBase login]", error);
    }
  }

  const staffer = state.staff.find((item) => item.phone === phone && item.active);
  if (!staffer) {
    els.loginHint.textContent = "这个手机号还没有录入为店员，无法登录。";
    return;
  }
  if (code !== OTP_TEST_CODE) {
    els.loginHint.textContent = "验证码不正确，测试阶段请输入 123456。";
    return;
  }
  state.session = {
    staffId: staffer.id,
    storeId: staffer.storeId,
    loggedInAt: new Date().toISOString(),
  };
  saveState();
  showApp();
}

function switchView(view) {
  state.activeView = view;
  render();
}

function openMemberDialog(member) {
  els.memberDialogTitle.textContent = member ? "编辑会员" : "新增会员";
  els.memberId.value = member?.id || "";
  els.memberName.value = member?.name || "";
  els.memberPhone.value = member?.phone || "";
  els.memberCard.value = member?.card || "";
  els.memberBalance.value = member ? member.balance : 0;
  els.memberNote.value = member?.note || "";
  els.memberDialog.showModal();
}

function saveMemberFromForm() {
  const id = els.memberId.value;
  const name = els.memberName.value.trim();
  const phone = els.memberPhone.value.trim();
  const card = els.memberCard.value.trim();
  const balance = Number(els.memberBalance.value || 0);
  const note = els.memberNote.value.trim();

  if (!name || !phone) {
    alert("请填写姓名和手机号");
    return;
  }

  if (balance < 0) {
    alert("初始余额不能小于 0");
    return;
  }

  if (id) {
    const member = getMember(id);
    if (!member) return;
    const previousBalance = Number(member.balance);
    Object.assign(member, { name, phone, card: card || member.card, balance, note });
    if (previousBalance !== balance) {
      state.records.push(createRecord(id, "adjust", balance - previousBalance, balance, "手动调整余额"));
    }
  } else {
    const member = createMember(name, phone, card, balance, note, getCurrentStore()?.id);
    state.members.push(member);
    if (balance > 0) {
      state.records.push(createRecord(member.id, "recharge", balance, balance, "开卡初始余额"));
    }
  }

  saveState();
  els.memberDialog.close();
  render();
}

function addTransaction(memberId, type, amount, note) {
  const member = getMember(memberId);
  const value = Number(amount);
  if (!member) {
    alert("请选择会员");
    return false;
  }
  if (!Number.isFinite(value) || value <= 0) {
    alert("请输入大于 0 的金额");
    return false;
  }
  if (type === "spend" && member.balance < value) {
    alert("余额不足，无法消费");
    return false;
  }

  const bonusAmount = type === "recharge" ? getRechargeBonus(value) : 0;
  const balanceChange = type === "recharge" || type === "refund" ? value + bonusAmount : -value;
  member.balance += balanceChange;
  const finalNote =
    type === "recharge" && bonusAmount > 0
      ? `${note || "充值"}，赠送 ${money(bonusAmount)}`
      : note;
  const record = createRecord(member.id, type, value, member.balance, finalNote, bonusAmount);
  state.records.push(record);
  saveState();
  render();
  return record;
}

function renderProductImagePreview() {
  const image = els.productImage.value;
  if (!els.productImagePreview) return;
  if (!image) {
    els.productImagePreview.classList.add("empty-image");
    els.productImagePreview.innerHTML = "<span>暂无图片</span>";
    return;
  }
  els.productImagePreview.classList.remove("empty-image");
  els.productImagePreview.innerHTML = `<img src="${escapeHtml(image)}" alt="商品图片预览">`;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = dataUrl;
  });
}

async function compressImageFile(file) {
  if (!file.type.startsWith("image/")) {
    throw new Error("请选择图片文件");
  }
  const dataUrl = await readFileAsDataUrl(file);
  const image = await loadImage(dataUrl);
  const maxSize = 900;
  const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.82);
}

async function handleProductImageFile(event) {
  const [file] = event.target.files || [];
  if (!file) return;
  try {
    els.productImage.value = await compressImageFile(file);
    renderProductImagePreview();
  } catch (error) {
    alert(error.message || "图片读取失败，请换一张图片");
  } finally {
    event.target.value = "";
  }
}

function openProductDialog(product) {
  els.productDialogTitle.textContent = product ? "编辑商品" : "新增商品";
  els.productId.value = product?.id || "";
  els.productName.value = product?.name || "";
  els.productCategory.value = product?.category || "";
  els.productPrice.value = product ? product.price : "";
  els.productImage.value = product?.image || "";
  renderProductImagePreview();
  els.productDescription.value = product?.description || "";
  els.productActive.checked = product ? product.active !== false : true;
  els.productDialog.showModal();
}

function saveProductFromForm() {
  const id = els.productId.value;
  const name = els.productName.value.trim();
  const category = els.productCategory.value.trim();
  const price = Number(els.productPrice.value);
  const image = els.productImage.value.trim();
  const description = els.productDescription.value.trim();
  const active = els.productActive.checked;

  if (!name || !category || !Number.isFinite(price) || price <= 0) {
    alert("请填写商品名称、分类和正确价格");
    return;
  }

  const existingCategory = state.categories.find(
    (item) => item.storeId === getCurrentStore()?.id && item.name === category
  );
  if (!existingCategory) {
    state.categories.push(createCategory(category, getCurrentStore()?.id));
  }

  if (id) {
    const product = state.products.find((item) => item.id === id);
    if (!product) return;
    Object.assign(product, {
      name,
      category,
      price,
      image,
      description,
      active,
      updatedAt: new Date().toISOString(),
    });
  } else {
    state.products.push(
      createProduct({
        name,
        category,
        price,
        image,
        description,
        active,
        storeId: getCurrentStore()?.id,
      })
    );
  }

  saveState();
  els.productDialog.close();
  render();
}

function updateOrderStatus(orderId, status) {
  const order = getOrder(orderId);
  if (!order) return;
  if (status === "cancelled") {
    const reason = prompt("请输入取消原因，例如 顾客取消、缺货、重复下单");
    if (reason === null) return;
    order.cancelReason = reason.trim() || "后台取消订单";
  }
  order.status = status;
  order.updatedAt = new Date().toISOString();
  saveState();
  render();
}

function openRefundDialog(orderId) {
  const order = getOrder(orderId);
  if (!order) return;
  const remaining = Math.max(0, order.totalAmount - (order.refundAmount || 0));
  els.refundOrderId.value = order.id;
  els.refundAmount.value = remaining.toFixed(2);
  els.refundReason.value = "";
  els.refundMethod.value = order.memberId ? "member_balance" : "cash";
  els.refundDialog.showModal();
}

function confirmRefundFromForm() {
  const order = getOrder(els.refundOrderId.value);
  const amount = Number(els.refundAmount.value);
  const reason = els.refundReason.value.trim();
  const method = els.refundMethod.value;

  if (!order) return;
  const remaining = Math.max(0, order.totalAmount - (order.refundAmount || 0));
  if (!Number.isFinite(amount) || amount <= 0 || amount > remaining) {
    alert(`退款金额需大于 0，且不能超过可退金额 ${money(remaining)}`);
    return;
  }
  if (!reason) {
    alert("请填写退款原因");
    return;
  }

  const refund = {
    id: createId("refund"),
    storeId: order.storeId,
    orderId: order.id,
    memberId: order.memberId || "",
    amount,
    reason,
    method,
    status: "completed",
    staffId: state.session?.staffId || null,
    createdAt: new Date().toISOString(),
  };
  state.refunds.push(refund);

  order.refundAmount = Number(order.refundAmount || 0) + amount;
  order.refundReason = reason;
  order.status = order.refundAmount >= order.totalAmount ? "refunded" : "partial_refund";
  order.updatedAt = new Date().toISOString();

  if (method === "member_balance" && order.memberId) {
    const member = getMember(order.memberId);
    if (member) {
      member.balance += amount;
      state.records.push(
        createRecord(member.id, "refund", amount, member.balance, `订单 ${order.orderNo} 退款：${reason}`)
      );
    }
  }

  saveState();
  els.refundDialog.close();
  render();
}

function getRecord(recordId) {
  return state.records.find((record) => record.id === recordId);
}

function receiptLine(label, value) {
  return `
    <div class="receipt-line">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function showReceiptPreview(title, receiptHtml) {
  els.receiptPreviewTitle.textContent = title;
  els.receiptPreviewBody.innerHTML = receiptHtml;
  els.receiptPrintArea.innerHTML = receiptHtml;
  els.receiptPreviewDialog.showModal();
}

function closeReceiptPreview() {
  els.receiptPreviewDialog.close();
}

function printReceiptPreview() {
  if (!els.receiptPrintArea.innerHTML.trim()) return;
  window.print();
}

function printMemberStatement(memberId, useCurrentDateRange = false) {
  const member = getMember(memberId);
  if (!member) {
    alert("没有找到这个会员");
    return;
  }

  const range = useCurrentDateRange ? getRecordDateRange() : { start: null, end: null };
  const records = state.records
    .filter((record) => record.memberId === memberId && isRecordInDateRange(record, range))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  if (!records.length) {
    alert("该会员在当前范围内没有交易记录");
    return;
  }

  const totalRecharge = records
    .filter((record) => record.type === "recharge")
    .reduce((sum, record) => sum + record.amount, 0);
  const totalBonus = records.reduce((sum, record) => sum + (record.bonusAmount || 0), 0);
  const totalSpend = records
    .filter((record) => record.type === "spend")
    .reduce((sum, record) => sum + record.amount, 0);
  const statementNo = `${member.card}-${Date.now().toString().slice(-6)}`;

  const receiptHtml = `
    <div class="receipt">
      <img class="receipt-logo" src="assets/aiwa-pizza-logo.jpg" alt="">
      <h2>爱娃披萨店</h2>
      <p class="receipt-subtitle">会员交易记录</p>
      <div class="receipt-dashed"></div>
      ${receiptLine("单号", statementNo)}
      ${receiptLine("打印时间", formatFullTime(new Date().toISOString()))}
      ${receiptLine("范围", useCurrentDateRange ? recordDateRangeLabel(range) : "全部交易")}
      ${receiptLine("会员", member.name)}
      ${receiptLine("手机号", member.phone)}
      ${receiptLine("卡号", member.card)}
      <div class="receipt-dashed"></div>
      ${receiptLine("充值合计", money(totalRecharge))}
      ${receiptLine("赠送合计", money(totalBonus))}
      ${receiptLine("消费合计", money(totalSpend))}
      ${receiptLine("当前余额", money(member.balance))}
      <div class="receipt-dashed"></div>
      <div class="receipt-records">
        ${records
          .map(
            (record) => `
              <div class="receipt-record">
                <div>
                  <strong>${formatFullTime(record.createdAt)}</strong>
                  <span>${recordTypeLabel(record.type)} ${recordAmountText(record)}${record.bonusAmount ? ` / 赠 ${money(record.bonusAmount)}` : ""}</span>
                  <span>余额 ${money(record.balanceAfter)}</span>
                </div>
                ${record.note ? `<p>${escapeHtml(record.note)}</p>` : ""}
              </div>
            `
          )
          .join("")}
      </div>
      <div class="receipt-dashed"></div>
      <p class="receipt-footer">感谢惠顾，欢迎下次光临</p>
    </div>
  `;
  showReceiptPreview("会员交易记录预览", receiptHtml);
}

function printFilteredRecordStatement() {
  const records = [...getFilteredRecords()].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  if (!records.length) {
    alert("当前查询条件下没有可打印的流水");
    return;
  }

  const totalRecharge = records
    .filter((record) => record.type === "recharge")
    .reduce((sum, record) => sum + record.amount, 0);
  const totalBonus = records.reduce((sum, record) => sum + (record.bonusAmount || 0), 0);
  const totalSpend = records
    .filter((record) => record.type === "spend")
    .reduce((sum, record) => sum + record.amount, 0);
  const totalOrderPayment = records
    .filter((record) => record.type === "order_payment")
    .reduce((sum, record) => sum + record.amount, 0);
  const totalOrderRefund = records
    .filter((record) => record.type === "order_refund")
    .reduce((sum, record) => sum + record.amount, 0);
  const memberNames = Array.from(
    new Set(records.map((record) => record.memberName || getMember(record.memberId)?.name || "顾客"))
  );
  const memberLabel = memberNames.length === 1 ? memberNames[0] : `${memberNames.length} 位会员`;

  const receiptHtml = `
    <div class="receipt">
      <img class="receipt-logo" src="assets/aiwa-pizza-logo.jpg" alt="">
      <h2>爱娃披萨店</h2>
      <p class="receipt-subtitle">流水查询结果</p>
      <div class="receipt-dashed"></div>
      ${receiptLine("打印时间", formatFullTime(new Date().toISOString()))}
      ${receiptLine("会员搜索", recordSearchLabel())}
      ${receiptLine("类型", recordTypeFilterLabel())}
      ${receiptLine("日期范围", recordDateRangeLabel())}
      ${receiptLine("涉及会员", memberLabel)}
      <div class="receipt-dashed"></div>
      ${receiptLine("记录数", `${records.length} 笔`)}
      ${receiptLine("充值合计", money(totalRecharge))}
      ${receiptLine("赠送合计", money(totalBonus))}
      ${receiptLine("余额消费", money(totalSpend))}
      ${receiptLine("订单收入", money(totalOrderPayment))}
      ${receiptLine("订单退款", money(totalOrderRefund))}
      <div class="receipt-dashed"></div>
      <div class="receipt-records">
        ${records
          .map((record) => {
            return `
              <div class="receipt-record">
                <div>
                  <strong>${formatFullTime(record.createdAt)} · ${escapeHtml(record.memberName || "顾客")}</strong>
                  <span>${recordTypeLabel(record.type)} ${recordAmountText(record)}${record.bonusAmount ? ` / 赠 ${money(record.bonusAmount)}` : ""}</span>
                  ${record.itemsText ? `<span>商品 ${escapeHtml(record.itemsText)}</span>` : ""}
                  <span>${record.orderNo ? `订单 ${escapeHtml(record.orderNo)} · ` : ""}${record.balanceAfter === null || record.balanceAfter === undefined ? "余额 -" : `余额 ${money(record.balanceAfter)}`}</span>
                </div>
                ${record.note ? `<p>${escapeHtml(record.note)}</p>` : ""}
              </div>
            `;
          })
          .join("")}
      </div>
      <div class="receipt-dashed"></div>
      <p class="receipt-footer">查询条件对应以上流水</p>
    </div>
  `;
  showReceiptPreview("流水查询结果预览", receiptHtml);
}

function exportData() {
  const blob = new Blob(
    [
      JSON.stringify(
        {
          stores: state.stores,
          staff: state.staff,
          session: state.session,
          members: state.members,
          records: state.records,
          categories: state.categories,
          products: state.products,
          orders: state.orders,
          refunds: state.refunds,
          settings: state.settings,
        },
        null,
        2
      ),
    ],
    { type: "application/json" }
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `aiwa-members-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!Array.isArray(data.members) || !Array.isArray(data.records)) {
        throw new Error("Invalid data");
      }
      const fallbackStore = createStore("爱娃披萨店");
      state.stores = Array.isArray(data.stores) && data.stores.length ? data.stores : [fallbackStore];
      const defaultStoreId = state.stores[0].id;
      state.staff =
        Array.isArray(data.staff) && data.staff.length
          ? data.staff.map((staffer) => normalizeStaff(staffer, defaultStoreId))
          : [createStaff("店长", "13800000000", "manager", defaultStoreId)];
      state.session = normalizeSession(data.session);
      state.members = data.members.map((member) => normalizeMember(member, defaultStoreId));
      state.records = data.records.map(normalizeRecord);
      state.categories = normalizeCategories(data.categories, defaultStoreId);
      state.products = normalizeProducts(data.products, defaultStoreId);
      state.orders = normalizeOrders(data.orders, defaultStoreId);
      state.refunds = normalizeRefunds(data.refunds, defaultStoreId);
      state.settings = normalizeSettings(data.settings);
      saveState();
      render();
      alert("导入成功");
    } catch {
      alert("导入失败，请选择由本系统导出的 JSON 文件");
    }
  };
  reader.readAsText(file);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

els.navItems.forEach((item) => {
  item.addEventListener("click", () => switchView(item.dataset.view));
});

els.sendCode.addEventListener("click", () => {
  sendTestCode();
});
els.loginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  loginWithCode();
});
els.logoutButton.addEventListener("click", () => {
  state.session = null;
  saveState();
  showLogin();
});

document.querySelectorAll("[data-view-jump]").forEach((button) => {
  button.addEventListener("click", () => switchView(button.dataset.viewJump));
});

els.addMember.addEventListener("click", () => openMemberDialog());
els.addMemberTop.addEventListener("click", () => openMemberDialog());
els.saveMember.addEventListener("click", saveMemberFromForm);
els.addProduct.addEventListener("click", () => openProductDialog());
els.saveProduct.addEventListener("click", saveProductFromForm);
els.productImageFile.addEventListener("change", handleProductImageFile);
els.clearProductImage.addEventListener("click", () => {
  els.productImage.value = "";
  renderProductImagePreview();
});
els.confirmRefund.addEventListener("click", confirmRefundFromForm);
els.orderSearch.addEventListener("input", renderOrders);
els.orderStatusFilter.addEventListener("change", renderOrders);
els.productSearch.addEventListener("input", renderProducts);
els.memberSearch.addEventListener("input", renderMembers);
els.recordSearch.addEventListener("input", renderRecords);
els.recordTypeFilter.addEventListener("change", renderRecords);
els.recordStartDate.addEventListener("change", renderRecords);
els.recordEndDate.addEventListener("change", renderRecords);
els.clearRecordDates.addEventListener("click", () => {
  els.recordStartDate.value = "";
  els.recordEndDate.value = "";
  renderRecords();
});
els.printFilteredRecords.addEventListener("click", printFilteredRecordStatement);
els.closeReceiptPreview.addEventListener("click", closeReceiptPreview);
els.cancelReceiptPreview.addEventListener("click", closeReceiptPreview);
els.confirmReceiptPrint.addEventListener("click", printReceiptPreview);
els.exportData.addEventListener("click", exportData);
els.importData.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (file) importData(file);
  event.target.value = "";
});

els.quickTransactionForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const record = addTransaction(
    els.quickMember.value,
    els.quickType.value,
    els.quickAmount.value,
    els.quickNote.value.trim()
  );
  if (record) {
    els.quickAmount.value = "";
    els.quickNote.value = "";
    if (event.submitter?.value === "print") {
      printMemberStatement(record.memberId);
    }
  }
});

els.bonusRuleForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const minAmount = Number(els.ruleMinAmount.value);
  const bonusAmount = Number(els.ruleBonusAmount.value);
  if (!Number.isFinite(minAmount) || minAmount <= 0 || !Number.isFinite(bonusAmount) || bonusAmount < 0) {
    alert("请填写正确的充值金额和赠送金额");
    return;
  }
  state.settings.bonusRules.push({ id: createId("rule"), minAmount, bonusAmount });
  state.settings = normalizeSettings(state.settings);
  saveState();
  els.ruleMinAmount.value = "";
  els.ruleBonusAmount.value = "";
  renderBonusRules();
});

els.bonusRuleList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-delete-rule]");
  if (!button) return;
  state.settings.bonusRules = state.settings.bonusRules.filter((rule) => rule.id !== button.dataset.deleteRule);
  saveState();
  renderBonusRules();
});

els.staffForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = els.staffName.value.trim();
  const phone = normalizePhone(els.staffPhone.value);
  const role = els.staffRole.value;
  if (!name || !phone) {
    alert("请填写店员姓名和手机号");
    return;
  }
  if (getStoreStaff().some((staffer) => staffer.phone === phone)) {
    alert("这个手机号已经是当前门店店员");
    return;
  }
  state.staff.push(createStaff(name, phone, role, getCurrentStore()?.id));
  els.staffName.value = "";
  els.staffPhone.value = "";
  els.staffRole.value = "staff";
  await saveStaffAndSync();
});

els.staffList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-toggle-staff]");
  if (!button) return;
  const staffer = state.staff.find((item) => item.id === button.dataset.toggleStaff);
  if (!staffer) return;
  if (staffer.id === state.session?.staffId && staffer.active) {
    alert("不能停用当前登录的账号");
    return;
  }
  staffer.active = !staffer.active;
  await saveStaffAndSync();
});

els.orderList.addEventListener("click", (event) => {
  const statusButton = event.target.closest("[data-order-status]");
  if (statusButton) {
    updateOrderStatus(statusButton.dataset.id, statusButton.dataset.orderStatus);
    return;
  }
  const refundButton = event.target.closest("[data-order-refund]");
  if (refundButton) {
    openRefundDialog(refundButton.dataset.orderRefund);
  }
});

els.dashboardOrders.addEventListener("click", (event) => {
  const statusButton = event.target.closest("[data-order-status]");
  if (statusButton) {
    updateOrderStatus(statusButton.dataset.id, statusButton.dataset.orderStatus);
    return;
  }
  const refundButton = event.target.closest("[data-order-refund]");
  if (refundButton) {
    openRefundDialog(refundButton.dataset.orderRefund);
  }
});

els.productList.addEventListener("click", (event) => {
  const editButton = event.target.closest("[data-product-edit]");
  const toggleButton = event.target.closest("[data-product-toggle]");
  const soldoutButton = event.target.closest("[data-product-soldout]");
  const deleteButton = event.target.closest("[data-product-delete]");
  const id =
    editButton?.dataset.productEdit ||
    toggleButton?.dataset.productToggle ||
    soldoutButton?.dataset.productSoldout ||
    deleteButton?.dataset.productDelete;
  if (!id) return;
  const product = state.products.find((item) => item.id === id);
  if (!product) return;

  if (editButton) {
    openProductDialog(product);
    return;
  }
  if (toggleButton) {
    product.active = !product.active;
  }
  if (soldoutButton) {
    product.soldOut = !product.soldOut;
  }
  if (deleteButton) {
    if (!confirm("确认删除这个商品？历史订单会保留商品名称。")) return;
    product.active = false;
    product.deletedAt = new Date().toISOString();
  }
  product.updatedAt = new Date().toISOString();
  saveState();
  renderProducts();
});

els.memberList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const member = getMember(button.dataset.id);
  if (!member) return;

  if (button.dataset.action === "edit") {
    openMemberDialog(member);
    return;
  }

  if (button.dataset.action === "print-member") {
    printMemberStatement(member.id);
    return;
  }

  const label = button.dataset.action === "recharge" ? "充值" : "消费";
  const amount = prompt(`请输入${member.name}本次${label}金额`);
  if (amount === null) return;
  const note = prompt("备注，可留空") || "";
  addTransaction(member.id, button.dataset.action, amount, note);
});

initCloudBase().finally(async () => {
  state.cloud.booting = true;
  loadState();
  await initLocalApi();
  state.cloud.booting = false;
  await syncFromCloud();
  ensureSession();
  startLocalRefresh();
});
