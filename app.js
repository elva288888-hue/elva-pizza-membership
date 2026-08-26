const STORAGE_KEY = "aiwa_drink_membership_v1";
const ORDER_SOUND_STORAGE_KEY = "aiwa_order_sound_enabled_v1";
const CLOUD_SESSION_VERSION = 2;
const PRIMARY_STORE_ID = "store_aiwa_pizza_main";
const ORDER_REMINDER_INTERVAL_MS = 60 * 1000;
const ORIGINAL_PAGE_TITLE = document.title;
const cloudConfig = window.AIWA_CLOUDBASE_CONFIG || {};
const CLOUDBASE_SDK_URL = "./cloudbase-sdk.js?v=20260804-1";
let cloudSaveTimer = null;
let cloudSaveInFlight = false;
let localDataRevision = 0;
let localRefreshTimer = null;
let loginCodeCountdownTimer = null;
let remoteRefreshInFlight = false;
let deliverySettingsDirty = false;
let orderAudioContext = null;
let orderAudioUnlocked = false;
let knownAlertableOrderIds = new Set();
let orderAlertsInitialized = false;
let lastPendingReminderAt = 0;
let titleFlashTimer = null;
let titleFlashStep = 0;
let orderSoundEnabled = localStorage.getItem(ORDER_SOUND_STORAGE_KEY) !== "false";

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
    delivery: { fee: 5, freeThreshold: 58, maxDistanceKm: 3, storeLatitude: null, storeLongitude: null, testMode: false },
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

  if (!cloudConfig.envId) {
    state.cloud.enabled = false;
    state.cloud.message = "CloudBase 环境未配置，已切换本地模式";
    return;
  }

  try {
    await loadCloudBaseSdk();
    state.cloud.app = window.cloudbase.init({ env: cloudConfig.envId });
    state.cloud.auth = state.cloud.app.auth();
    state.cloud.db = state.cloud.app.database();
    if (state.cloud.auth?.signInAnonymously) {
      let loginResult = await state.cloud.auth.signInAnonymously();
      if (loginResult?.error) {
        await state.cloud.auth.signOut().catch(() => {});
        loginResult = await state.cloud.auth.signInAnonymously();
      }
      if (loginResult?.error) {
        throw new Error(loginResult.error.message || "匿名身份认证失败");
      }
    } else if (state.cloud.auth?.anonymousAuthProvider) {
      await state.cloud.auth.anonymousAuthProvider().signIn();
    }
    state.cloud.ready = true;
    state.cloud.message = `CloudBase 已连接：${cloudConfig.envId}`;
  } catch (error) {
    state.cloud.ready = false;
    state.cloud.message = `CloudBase 初始化失败：${error?.message || "未知错误"}`;
    console.warn("[CloudBase]", error);
  }
}

async function loadCloudBaseSdk() {
  if (window.cloudbase) return window.cloudbase;
  const module = await import(CLOUDBASE_SDK_URL);
  window.cloudbase = module.default || window.cloudbase;
  if (!window.cloudbase) throw new Error("CloudBase SDK load failed");
  return window.cloudbase;
}

async function callCloud(action, payload = {}) {
  if (!state.cloud.ready || !state.cloud.app?.callFunction) {
    throw new Error("CloudBase is not ready");
  }
  const result = await Promise.race([
    state.cloud.app.callFunction({
      name: cloudConfig.functions?.membershipApi || "membershipApi",
      data: {
        action,
        payload: {
          ...payload,
          sessionToken: state.session?.token || payload.sessionToken || "",
        },
      },
    }),
    new Promise((_, reject) => {
      window.setTimeout(() => reject(new Error("云端请求超时，请检查网络后重试")), 15000);
    }),
  ]);
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
  loginSubmit: document.querySelector("#loginSubmit"),
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
  deliverySettingsForm: document.querySelector("#deliverySettingsForm"),
  deliveryFee: document.querySelector("#deliveryFee"),
  freeDeliveryThreshold: document.querySelector("#freeDeliveryThreshold"),
  storeLatitude: document.querySelector("#storeLatitude"),
  storeLongitude: document.querySelector("#storeLongitude"),
  deliveryTestMode: document.querySelector("#deliveryTestMode"),
  deliverySettingsStatus: document.querySelector("#deliverySettingsStatus"),
  locateStore: document.querySelector("#locateStore"),
  verifyStoreLocation: document.querySelector("#verifyStoreLocation"),
  orderSoundEnabled: document.querySelector("#orderSoundEnabled"),
  testOrderSound: document.querySelector("#testOrderSound"),
  orderSoundStatus: document.querySelector("#orderSoundStatus"),
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
  memberPrintDialog: document.querySelector("#memberPrintDialog"),
  memberPrintForm: document.querySelector("#memberPrintForm"),
  memberPrintTitle: document.querySelector("#memberPrintTitle"),
  memberPrintId: document.querySelector("#memberPrintId"),
  memberPrintStartDate: document.querySelector("#memberPrintStartDate"),
  memberPrintEndDate: document.querySelector("#memberPrintEndDate"),
  memberPrintAllDates: document.querySelector("#memberPrintAllDates"),
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
    const store = createStore("爱娃披萨店", PRIMARY_STORE_ID);
    const manager = createStaff("店长", "13800000000", "manager", store.id);
    state.stores = [store];
    state.staff = cloudConfig.enabled ? [] : [manager];
    state.session = null;
    const shouldSeedDemoData = !cloudConfig.enabled;
    state.members = shouldSeedDemoData
      ? [createMember("示例会员", "13800000000", "AW0001", 100, "少冰三分糖", store.id)]
      : [];
    state.records = shouldSeedDemoData
      ? [createRecord(state.members[0].id, "recharge", 100, 100, "开卡充值")]
      : [];
    state.categories = createDefaultCategories(store.id);
    state.products = createDefaultProducts(store.id);
    state.orders = [];
    state.refunds = [];
    saveState();
    return;
  }

  try {
    const parsed = JSON.parse(saved);
    const fallbackStore = createStore("爱娃披萨店", PRIMARY_STORE_ID);
    state.stores = Array.isArray(parsed.stores) && parsed.stores.length ? parsed.stores : [fallbackStore];
    const defaultStoreId = state.stores[0].id;
    state.staff =
      Array.isArray(parsed.staff) && parsed.staff.length
        ? parsed.staff.map((staffer) => normalizeStaff(staffer, defaultStoreId))
        : cloudConfig.enabled
          ? []
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
    const store = createStore("爱娃披萨店", PRIMARY_STORE_ID);
    state.stores = [store];
    state.staff = cloudConfig.enabled
      ? []
      : [createStaff("店长", "13800000000", "manager", store.id)];
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

  if (options.sync !== false) localDataRevision += 1;

  if (
    options.sync !== false &&
    state.cloud.ready &&
    state.session?.token &&
    !state.cloud.booting
  ) {
    scheduleCloudSave();
  }
  if (options.sync !== false && state.localApi.ready && !state.cloud.booting) {
    scheduleCloudSave();
  }
}

function applyData(data, options = {}) {
  const fallbackStore = createStore("爱娃披萨店", PRIMARY_STORE_ID);
  state.stores = Array.isArray(data.stores) && data.stores.length ? data.stores : [fallbackStore];
  const defaultStoreId = state.stores[0].id;
  state.staff =
    Array.isArray(data.staff) && data.staff.length
      ? data.staff.map((staffer) => normalizeStaff(staffer, defaultStoreId))
      : cloudConfig.enabled
        ? []
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

  if (!state.cloud.ready || !state.session?.token) return;

  try {
    const result = await callCloud("getStoreData");

    if (result.data) {
      const currentSession = state.session;
      const currentStaff = getCurrentStaff();
      const currentStore = getCurrentStore();
      applyData(result.data, { keepSession: true });
      state.session = currentSession;
      if (currentStore && !state.stores.some((store) => store.id === currentStore.id)) state.stores.push(currentStore);
      if (currentStaff && !state.staff.some((staffer) => staffer.id === currentStaff.id)) state.staff.push(currentStaff);
      saveState({ sync: false });
      state.cloud.message = "CloudBase 数据已同步";
    }
  } catch (error) {
    state.cloud.message = `CloudBase 同步失败：${error?.message || "未知错误"}`;
    console.warn("[CloudBase sync]", error);
  }
}

function scheduleCloudSave() {
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer = setTimeout(pushCloudState, 500);
}

async function pushCloudState() {
  cloudSaveTimer = null;
  if (cloudSaveInFlight) {
    scheduleCloudSave();
    return false;
  }
  cloudSaveInFlight = true;
  const savedRevision = localDataRevision;
  if (state.localApi.ready) {
    try {
      await callLocalApi("POST", serializeState());
      state.cloud.message = "本地共享数据已保存";
      deliverySettingsDirty = false;
      return true;
    } catch (error) {
      console.warn("[Local API save]", error);
      return false;
    } finally {
      cloudSaveInFlight = false;
      if (localDataRevision > savedRevision) scheduleCloudSave();
    }
  }

  if (!state.cloud.ready || !state.session?.token) {
    cloudSaveInFlight = false;
    return false;
  }
  try {
    await callCloud("saveStoreData", { data: serializeState() });
    state.cloud.message = "CloudBase 数据已保存";
    deliverySettingsDirty = false;
    return true;
  } catch (error) {
    state.cloud.message = "CloudBase 保存失败，已继续使用本地数据";
    console.warn("[CloudBase save]", error);
    return false;
  } finally {
    cloudSaveInFlight = false;
    if (localDataRevision > savedRevision) scheduleCloudSave();
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

function createStore(name, id = createId("store")) {
  return {
    id,
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
  const now = new Date().toISOString();
  return {
    id: createId("member"),
    storeId,
    name,
    phone: normalizePhone(phone),
    card: card || nextCardNumber(),
    balance: Number(balance) || 0,
    note: note || "",
    createdAt: now,
    updatedAt: now,
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
  const incoming = settings.delivery || {};
  const coordinate = (value, min, max) => {
    if (value === "" || value === null || value === undefined) return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= min && number <= max ? number : null;
  };
  return {
    bonusRules,
    delivery: {
      fee: Math.max(0, Number.isFinite(Number(incoming.fee)) ? Number(incoming.fee) : 5),
      freeThreshold: Math.max(0, Number.isFinite(Number(incoming.freeThreshold)) ? Number(incoming.freeThreshold) : 58),
      maxDistanceKm: 3,
      storeLatitude: coordinate(incoming.storeLatitude, -90, 90),
      storeLongitude: coordinate(incoming.storeLongitude, -180, 180),
      testMode: incoming.testMode === true,
    },
  };
}

function normalizePhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}

function normalizeSession(session) {
  if (
    !session?.staffId ||
    !session?.storeId ||
    !session?.token ||
    Number(session?.expiresAt || 0) <= Date.now() ||
    session.authVersion !== CLOUD_SESSION_VERSION
  ) return null;
  return {
    staffId: session.staffId,
    storeId: session.storeId,
    token: session.token,
    expiresAt: Number(session.expiresAt),
    loggedInAt: session.loggedInAt || new Date().toISOString(),
    authVersion: CLOUD_SESSION_VERSION,
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
    updatedAt: member.updatedAt || member.createdAt || new Date().toISOString(),
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
  if (!Array.isArray(categories) || !categories.length) return [];
  return categories.map((category, index) => ({
    id: category.id || createId("category"),
    storeId: category.storeId || defaultStoreId,
    name: category.name || "未分类",
    sort: Number(category.sort) || index + 1,
    createdAt: category.createdAt || new Date().toISOString(),
  }));
}

function normalizeProducts(products, defaultStoreId) {
  if (!Array.isArray(products) || !products.length) return [];
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
      goodsAmount: Number(order.goodsAmount) || normalizedItems.reduce((sum, item) => sum + item.price * item.quantity, 0),
      deliveryFee: Number(order.deliveryFee) || 0,
      deliveryFeeWaived: Boolean(order.deliveryFeeWaived),
      totalAmount,
      paidAmount: Number(order.paidAmount) || 0,
      refundAmount: Number(order.refundAmount) || 0,
      adjustmentAmount: Number(order.adjustmentAmount) || 0,
      status: order.status || "pending",
      paymentStatus: order.paymentStatus || "unpaid",
      paymentMethod: order.paymentMethod || "wechat_pay",
      paymentTradeNo: order.paymentTradeNo || "",
      paymentRedirect: order.paymentRedirect || "",
      orderChannel: order.orderChannel || (order.paymentRedirect === "mini_program" ? "mini_program" : ""),
      fulfillmentType: order.fulfillmentType || "pickup",
      pickupMode: order.pickupMode || (order.pickupTime && order.pickupTime !== "尽快" ? "scheduled" : "now"),
      pickupDate: order.pickupDate || "",
      pickupTime: order.pickupTime || "",
      deliveryAddress: order.deliveryAddress || "",
      deliveryRecipientName: order.deliveryRecipientName || "",
      deliveryRecipientPhone: normalizePhone(order.deliveryRecipientPhone),
      deliveryDate: order.deliveryDate || "",
      deliveryTime: order.deliveryTime || "",
      deliveryLatitude: order.deliveryLatitude ?? null,
      deliveryLongitude: order.deliveryLongitude ?? null,
      deliveryDistanceKm: Number.isFinite(Number(order.deliveryDistanceKm)) ? Number(order.deliveryDistanceKm) : null,
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
  const start = range.start ? formatDateInputValue(range.start) : "不限";
  const end = range.end ? formatDateInputValue(range.end) : "不限";
  return `日期：${start} 至 ${end}`;
}

function formatDateInputValue(value) {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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
  const storedRecords = getStoreRecords();
  const existingOrderPaymentKeys = new Set(
    storedRecords
      .filter((record) => ["spend", "order_payment"].includes(record.type))
      .flatMap((record) => [
        record.orderId ? `id:${record.orderId}` : "",
        record.orderNo ? `no:${record.orderNo}` : "",
      ])
      .filter(Boolean)
  );

  const memberRecords = storedRecords.map((record) => {
    const member = getMember(record.memberId);
    return {
      id: `record_${record.id}`,
      source: "member_record",
      type: record.type,
      createdAt: record.createdAt,
      memberId: record.memberId,
      memberName: member?.name || record.memberName || "已删除会员",
      memberPhone: member?.phone || record.memberPhone || "",
      memberCard: member?.card || record.memberCard || "",
      amount: Number(record.amount) || 0,
      bonusAmount: Number(record.bonusAmount) || 0,
      balanceAfter: record.balanceAfter === null || record.balanceAfter === undefined
        ? null
        : Number(record.balanceAfter),
      paymentMethod: record.paymentMethod || (record.type === "recharge" ? "member_balance" : ""),
      orderNo: record.orderNo || "",
      itemsText: record.itemsText || "",
      note: record.note || "",
    };
  });

  const orderPayments = getStoreOrders()
    .filter((order) => (
      Number(order.paidAmount || 0) > 0
      && !existingOrderPaymentKeys.has(`id:${order.id}`)
      && !existingOrderPaymentKeys.has(`no:${order.orderNo}`)
    ))
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

function currentStaffIsManager() {
  return getCurrentStaff()?.role === "manager";
}

function getStoreMembers() {
  const storeId = getCurrentStore()?.id || PRIMARY_STORE_ID;
  return Array.from(
    new Map(
      state.members
        .filter((member) => member.storeId === storeId)
        .map((member) => [member.id, member])
    ).values()
  );
}

function getStoreRecords() {
  const storeId = getCurrentStore()?.id || PRIMARY_STORE_ID;
  return state.records.filter((record) => record.storeId === storeId);
}

function getStoreStaff() {
  const storeId = getCurrentStore()?.id;
  return state.staff.filter((staffer) => staffer.storeId === storeId);
}

function getStoreProducts() {
  const storeId = getCurrentStore()?.id || PRIMARY_STORE_ID;
  return state.products.filter((product) => product.storeId === storeId && !product.deletedAt);
}

function getStoreOrders() {
  const storeId = getCurrentStore()?.id || PRIMARY_STORE_ID;
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
  renderDeliverySettings();
  renderStaff();
  renderOrderSoundSetting();
}

function getAlertableOrders() {
  const storeId = getCurrentStore()?.id || PRIMARY_STORE_ID;
  return state.orders.filter(
    (order) => order.storeId === storeId && order.status !== "pending_payment"
  );
}

function initializeOrderAlerts() {
  knownAlertableOrderIds = new Set(getAlertableOrders().map((order) => order.id));
  orderAlertsInitialized = true;
  lastPendingReminderAt = Date.now();
  renderOrderSoundSetting();
}

function renderOrderSoundSetting(message = "") {
  if (!els.orderSoundEnabled || !els.orderSoundStatus) return;
  els.orderSoundEnabled.checked = orderSoundEnabled;
  els.orderSoundStatus.classList.toggle("is-ready", orderSoundEnabled && orderAudioUnlocked);
  els.orderSoundStatus.classList.toggle("is-warning", orderSoundEnabled && !orderAudioUnlocked);
  if (message) {
    els.orderSoundStatus.textContent = message;
  } else if (!orderSoundEnabled) {
    els.orderSoundStatus.textContent = "声音提醒已关闭";
  } else if (orderAudioUnlocked) {
    els.orderSoundStatus.textContent = "声音提醒已开启";
  } else {
    els.orderSoundStatus.textContent = "声音提醒默认开启，登录或点击页面后即可播放";
  }
}

async function unlockOrderAudio() {
  if (!orderSoundEnabled) return false;
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      renderOrderSoundSetting("当前浏览器不支持声音提醒");
      return false;
    }
    if (!orderAudioContext) orderAudioContext = new AudioContextClass();
    if (orderAudioContext.state === "suspended") await orderAudioContext.resume();
    orderAudioUnlocked = orderAudioContext.state === "running";
    renderOrderSoundSetting();
    return orderAudioUnlocked;
  } catch (error) {
    console.warn("[Order alert audio]", error);
    renderOrderSoundSetting("浏览器阻止了声音，请点击“试听提示音”开启");
    return false;
  }
}

function playOrderTone() {
  if (!orderSoundEnabled || !orderAudioUnlocked || !orderAudioContext) return false;
  const startAt = orderAudioContext.currentTime;
  [784, 988, 1175].forEach((frequency, index) => {
    const oscillator = orderAudioContext.createOscillator();
    const gain = orderAudioContext.createGain();
    const toneStart = startAt + index * 0.18;
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, toneStart);
    gain.gain.setValueAtTime(0.0001, toneStart);
    gain.gain.exponentialRampToValueAtTime(0.22, toneStart + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, toneStart + 0.14);
    oscillator.connect(gain);
    gain.connect(orderAudioContext.destination);
    oscillator.start(toneStart);
    oscillator.stop(toneStart + 0.16);
  });
  return true;
}

function flashOrderTitle(orderCount) {
  clearInterval(titleFlashTimer);
  titleFlashStep = 0;
  titleFlashTimer = setInterval(() => {
    document.title = titleFlashStep % 2
      ? ORIGINAL_PAGE_TITLE
      : `🔔 ${orderCount} 个新订单`;
    titleFlashStep += 1;
    if (titleFlashStep >= 10) {
      clearInterval(titleFlashTimer);
      titleFlashTimer = null;
      document.title = ORIGINAL_PAGE_TITLE;
    }
  }, 700);
}

function processOrderAlerts() {
  const alertableOrders = getAlertableOrders();
  if (!orderAlertsInitialized) {
    initializeOrderAlerts();
    return;
  }

  const newPendingOrders = alertableOrders.filter(
    (order) => order.status === "pending" && !knownAlertableOrderIds.has(order.id)
  );
  alertableOrders.forEach((order) => knownAlertableOrderIds.add(order.id));

  const pendingOrders = alertableOrders.filter((order) => order.status === "pending");
  const now = Date.now();
  if (newPendingOrders.length) {
    const played = playOrderTone();
    flashOrderTitle(newPendingOrders.length);
    lastPendingReminderAt = now;
    renderOrderSoundSetting(
      played
        ? `收到 ${newPendingOrders.length} 个新订单，已播放提醒`
        : orderSoundEnabled
          ? `收到 ${newPendingOrders.length} 个新订单，请点击页面开启声音`
          : `收到 ${newPendingOrders.length} 个新订单，声音提醒已关闭`
    );
    return;
  }

  if (
    pendingOrders.length
    && now - lastPendingReminderAt >= ORDER_REMINDER_INTERVAL_MS
  ) {
    playOrderTone();
    flashOrderTitle(pendingOrders.length);
    lastPendingReminderAt = now;
    renderOrderSoundSetting(`仍有 ${pendingOrders.length} 个订单待接单`);
  }
}

function startLocalRefresh() {
  if ((!state.localApi.ready && !state.cloud.ready) || localRefreshTimer) return;
  localRefreshTimer = setInterval(async () => {
    if (!["orders", "dashboard", "members", "records", "products", "settings"].includes(state.activeView)) return;
    if (remoteRefreshInFlight || cloudSaveTimer || cloudSaveInFlight || state.cloud.booting) return;
    remoteRefreshInFlight = true;
    const refreshRevision = localDataRevision;
    try {
      const result = state.localApi.ready
        ? await callLocalApi("GET")
        : await callCloud("getStoreData");
      // Never apply a remote snapshot fetched before a newer local save.
      if (result.data && refreshRevision === localDataRevision && !cloudSaveTimer && !cloudSaveInFlight) {
        const deliveryDraft = deliverySettingsDirty ? state.settings.delivery : null;
        const currentSession = state.session;
        const currentStaff = getCurrentStaff();
        const currentStore = getCurrentStore();
        applyData(result.data, { keepSession: true });
        if (deliveryDraft) state.settings.delivery = deliveryDraft;
        state.session = currentSession;
        if (currentStore && !state.stores.some((store) => store.id === currentStore.id)) state.stores.push(currentStore);
        if (currentStaff && !state.staff.some((staffer) => staffer.id === currentStaff.id)) state.staff.push(currentStaff);
        saveState({ sync: false });
        render();
        processOrderAlerts();
      }
    } catch (error) {
      console.warn("[Remote refresh]", error);
    } finally {
      remoteRefreshInFlight = false;
    }
  }, 1500);
}

function renderSession() {
  const store = getCurrentStore();
  const staffer = getCurrentStaff();
  els.currentStoreName.textContent = store?.name || "未选择门店";
  els.currentStaffName.textContent = staffer ? `${staffer.name} · ${staffer.role === "manager" ? "店长" : "店员"}` : "未登录";
  document.querySelectorAll("[data-manager-only]").forEach((section) => {
    section.hidden = !currentStaffIsManager();
  });
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
  const pendingCount = storeOrders.filter((order) => ["pending", "making", "ready", "delivering"].includes(order.status)).length;
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
    .filter((order) => ["pending", "making", "ready", "delivering"].includes(order.status))
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
    pending_payment: "待支付",
    pending: "待接单",
    making: "制作中",
    ready: "待取餐",
    delivering: "配送中",
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
  const canRefund = order.paymentStatus === "paid" && !["cancelled", "refunded"].includes(order.status) && netAmount > 0;
  const nextActions = {
    pending: [["making", "接单制作"], ["cancelled", "取消订单"]],
    making: order.fulfillmentType === "delivery"
      ? [["delivering", "开始配送"], ["cancelled", "取消订单"]]
      : [["ready", "标记待取"], ["cancelled", "取消订单"]],
    ready: [["completed", "完成取餐"]],
    delivering: [["completed", "确认送达"]],
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
        ${order.fulfillmentType === "delivery" ? `<div><span>配送费${order.deliveryFeeWaived ? "（满额减免）" : ""}</span><strong>${money(order.deliveryFee)}</strong></div>` : ""}
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
          <button class="mini-button" data-order-print="${order.id}" type="button">打印小票</button>
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

function renderDeliverySettings() {
  const delivery = state.settings.delivery;
  els.deliveryFee.value = delivery.fee;
  els.freeDeliveryThreshold.value = delivery.freeThreshold;
  els.storeLatitude.value = delivery.storeLatitude ?? "";
  els.storeLongitude.value = delivery.storeLongitude ?? "";
  els.deliveryTestMode.checked = delivery.testMode;
  updateStoreLocationVerification();
  els.deliverySettingsStatus.textContent = delivery.storeLatitude === null || delivery.storeLongitude === null
    ? "请填写门店经纬度，保存后顾客才能通过 3 公里配送范围校验。"
    : `${delivery.testMode ? "⚠ 当前为临时测试模式；" : ""}当前规则：3 公里内配送，配送费 ${money(delivery.fee)}，商品满 ${money(delivery.freeThreshold)} 免配送费。`;
}

function storeLocationIsInQianan(latitude, longitude) {
  return latitude >= 39.75 && latitude <= 40.35 && longitude >= 118.45 && longitude <= 119.05;
}

function updateStoreLocationVerification() {
  const latitude = Number(els.storeLatitude.value);
  const longitude = Number(els.storeLongitude.value);
  const valid = Number.isFinite(latitude) && Number.isFinite(longitude);
  els.verifyStoreLocation.hidden = !valid;
  if (valid) {
    els.verifyStoreLocation.href = `https://uri.amap.com/marker?position=${longitude},${latitude}&name=${encodeURIComponent("爱娃披萨店（待核对）")}`;
  }
}

function captureDeliverySettingsDraft() {
  state.settings.delivery = normalizeSettings({ delivery: {
    fee: els.deliveryFee.value,
    freeThreshold: els.freeDeliveryThreshold.value,
    storeLatitude: els.storeLatitude.value,
    storeLongitude: els.storeLongitude.value,
    testMode: els.deliveryTestMode.checked,
  }}).delivery;
  deliverySettingsDirty = true;
  updateStoreLocationVerification();
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

function setLoginHint(message, status = "") {
  els.loginHint.textContent = message;
  els.loginHint.classList.remove("is-loading", "is-success", "is-error");
  if (status) els.loginHint.classList.add(`is-${status}`);
}

function resetSendCodeButton() {
  if (loginCodeCountdownTimer) {
    clearInterval(loginCodeCountdownTimer);
    loginCodeCountdownTimer = null;
  }
  els.sendCode.disabled = false;
  els.sendCode.textContent = "获取验证码";
}

function startLoginCodeCountdown(seconds = 60) {
  if (loginCodeCountdownTimer) clearInterval(loginCodeCountdownTimer);
  let remaining = seconds;
  els.sendCode.disabled = true;
  els.sendCode.textContent = `${remaining} 秒后重试`;
  loginCodeCountdownTimer = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      resetSendCodeButton();
      return;
    }
    els.sendCode.textContent = `${remaining} 秒后重试`;
  }, 1000);
}

function ensureSession() {
  const staffer = getCurrentStaff();
  const store = getCurrentStore();
  if (staffer?.active && store) {
    showApp();
  } else {
    state.session = null;
    saveState({ sync: false });
    showLogin();
  }
}

async function sendTestCode() {
  const phone = normalizePhone(els.loginPhone.value);

  if (!/^1\d{10}$/.test(phone)) {
    setLoginHint("请输入正确的 11 位手机号后再获取验证码。", "error");
    els.loginPhone.focus();
    return;
  }

  els.sendCode.disabled = true;
  els.sendCode.textContent = "发送中…";
  els.sendCode.setAttribute("aria-busy", "true");
  setLoginHint("正在发送验证码，请稍候…", "loading");

  if (state.cloud.ready) {
    try {
      const result = await callCloud("sendLoginCode", { phone });
      setLoginHint(result.message || "验证码已发送，请查看手机短信。", "success");
      startLoginCodeCountdown(60);
      els.loginCode.focus();
      return;
    } catch (error) {
      setLoginHint(error.message || "云端验证码发送失败，请稍后重试。", "error");
      console.warn("[CloudBase login]", error);
      resetSendCodeButton();
      return;
    } finally {
      els.sendCode.removeAttribute("aria-busy");
    }
  }

  if (cloudConfig.enabled) {
    setLoginHint(`验证码发送失败：云端服务未连接。${state.cloud.message}`, "error");
    resetSendCodeButton();
    els.sendCode.removeAttribute("aria-busy");
    return;
  }

  const staffer = state.staff.find((item) => item.phone === phone && item.active);
  if (!staffer) {
    setLoginHint("这个手机号还没有录入为店员，请先让店长添加。", "error");
    resetSendCodeButton();
    els.sendCode.removeAttribute("aria-busy");
    return;
  }
  setLoginHint("当前为本地离线模式，不能发送真实短信。", "error");
  resetSendCodeButton();
  els.sendCode.removeAttribute("aria-busy");
}

async function loginWithCode() {
  const phone = normalizePhone(els.loginPhone.value);
  const code = els.loginCode.value.trim();

  if (!/^1\d{10}$/.test(phone) || !code) {
    setLoginHint("请输入正确的手机号和短信验证码。", "error");
    return;
  }

  els.loginSubmit.disabled = true;
  els.loginSubmit.textContent = "登录中…";
  els.loginSubmit.setAttribute("aria-busy", "true");
  setLoginHint("正在验证，请稍候…", "loading");

  if (state.cloud.ready) {
    try {
      const result = await callCloud("verifyLoginCode", { phone, code });
      state.session = normalizeSession({ ...result.session, authVersion: CLOUD_SESSION_VERSION });
      saveState({ sync: false });
      showApp();
      syncFromCloud()
        .then(() => render())
        .catch((error) => console.warn("[CloudBase post-login sync]", error));
      return;
    } catch (error) {
      setLoginHint(error.message || "云端登录失败，请稍后重试。", "error");
      console.warn("[CloudBase login]", error);
      return;
    } finally {
      els.loginSubmit.disabled = false;
      els.loginSubmit.textContent = "登录";
      els.loginSubmit.removeAttribute("aria-busy");
    }
  }

  if (cloudConfig.enabled) {
    setLoginHint(`云端服务未连接，无法登录。${state.cloud.message}`, "error");
    els.loginSubmit.disabled = false;
    els.loginSubmit.textContent = "登录";
    els.loginSubmit.removeAttribute("aria-busy");
    return;
  }

  const staffer = state.staff.find((item) => item.phone === phone && item.active);
  if (!staffer) {
    setLoginHint("这个手机号还没有录入为店员，无法登录。", "error");
    els.loginSubmit.disabled = false;
    els.loginSubmit.textContent = "登录";
    els.loginSubmit.removeAttribute("aria-busy");
    return;
  }
  setLoginHint("当前为本地离线模式，不能使用短信验证码登录。", "error");
  els.loginSubmit.disabled = false;
  els.loginSubmit.textContent = "登录";
  els.loginSubmit.removeAttribute("aria-busy");
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
  const phone = normalizePhone(els.memberPhone.value);
  const card = els.memberCard.value.trim();
  const balance = Number(els.memberBalance.value || 0);
  const note = els.memberNote.value.trim();

  if (!name || !/^1\d{10}$/.test(phone)) {
    alert("请填写姓名和正确的 11 位手机号");
    return;
  }
  const duplicate = state.members.find(
    (member) => member.id !== id && member.storeId === getCurrentStore()?.id && normalizePhone(member.phone) === phone
  );
  if (duplicate) {
    alert(`该手机号已注册会员“${duplicate.name}”，每个手机号只能注册一次`);
    els.memberPhone.focus();
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
    Object.assign(member, {
      name,
      phone,
      card: card || member.card,
      balance,
      note,
      updatedAt: new Date().toISOString(),
    });
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
  member.updatedAt = new Date().toISOString();
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
  if (status === "delivering" && order.fulfillmentType !== "delivery") return;
  if (status === "delivering") order.dispatchedAt = new Date().toISOString();
  if (status === "completed" && order.fulfillmentType === "delivery") {
    order.deliveredAt = new Date().toISOString();
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
  els.refundMethod.value = order.paymentMethod === "wechat_pay"
    ? "wechat_pay"
    : (order.paymentMethod === "member_balance" ? "member_balance" : "cash");
  els.refundMethod.disabled = true;
  els.refundDialog.showModal();
}

async function confirmRefundFromForm() {
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

  if (state.cloud.ready && state.session?.token) {
    const originalLabel = els.confirmRefund.textContent;
    els.confirmRefund.disabled = true;
    els.confirmRefund.textContent = method === "wechat_pay" ? "正在原路退款…" : "正在退款…";
    try {
      const result = await callCloud("refundOrder", { orderId: order.id, amount, reason });
      await syncFromCloud();
      els.refundDialog.close();
      render();
      alert(method === "wechat_pay"
        ? `微信退款已受理，将按原支付渠道退回。退款单号：${result.refund?.outRefundNo || "处理中"}`
        : "退款已完成并退回会员余额");
    } catch (error) {
      alert(`退款失败：${error?.message || "未知错误"}。订单状态和会员余额均未修改。`);
    } finally {
      els.confirmRefund.disabled = false;
      els.confirmRefund.textContent = originalLabel;
    }
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

function showReceiptPreview(title, receiptHtml, printText = "") {
  els.receiptPreviewTitle.textContent = title;
  els.receiptPreviewBody.innerHTML = receiptHtml;
  els.receiptPrintArea.innerHTML = receiptHtml;
  els.receiptPrintArea.dataset.printText = printText;
  els.receiptPreviewDialog.showModal();
}

function closeReceiptPreview() {
  els.receiptPreviewDialog.close();
}

async function printReceiptPreview() {
  if (!els.receiptPrintArea.innerHTML.trim()) return;
  const directPrintText = els.receiptPrintArea.dataset.printText || "";
  if (directPrintText) {
    els.confirmReceiptPrint.disabled = true;
    els.confirmReceiptPrint.textContent = "正在发送…";
    try {
      const response = await Promise.race([
        fetch("http://127.0.0.1:17891/print", {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=UTF-8" },
          body: window.btoa(unescape(encodeURIComponent(directPrintText))),
        }),
        new Promise((_, reject) => window.setTimeout(() => reject(new Error("打印服务连接超时")), 3000)),
      ]);
      const result = await response.text();
      if (!response.ok || result.trim() !== "OK") throw new Error(result || "打印失败");
      closeReceiptPreview();
      alert("小票已发送到 POS58");
      return;
    } catch (error) {
      alert(`本地打印服务未连接，未执行打印：${error?.message || "未知错误"}`);
      return;
    } finally {
      els.confirmReceiptPrint.disabled = false;
      els.confirmReceiptPrint.textContent = "打印";
    }
  }

  const printWindow = window.open("", "aiwaReceiptPrint", "width=420,height=720");
  if (!printWindow) {
    alert("浏览器阻止了打印窗口，请允许本站弹出窗口后重试");
    return;
  }

  printWindow.document.open();
  printWindow.document.write(`<!doctype html>
    <html lang="zh-CN">
      <head>
        <meta charset="utf-8">
        <title>爱娃披萨店小票</title>
        <style id="receiptPageSize">
          @page { size: 58mm 200mm; margin: 0; }
        </style>
        <style>
          * { box-sizing: border-box; }
          html, body { width: 58mm; margin: 0; padding: 0; background: #fff; }
          body { color: #111; font-family: "Microsoft YaHei", "SimSun", sans-serif; }
          .receipt { width: 54mm; margin: 0; padding: 3mm 2mm; font-size: 11px; line-height: 1.4; }
          .receipt-logo { display: block; width: 20mm; height: 20mm; margin: 0 auto 1mm; object-fit: cover; }
          h2 { margin: 0 0 1mm; text-align: center; font-size: 17px; }
          .receipt-subtitle, .receipt-footer { margin: 0; text-align: center; }
          .receipt-dashed { margin: 2mm 0; border-top: 1px dashed #222; }
          .receipt-line { display: flex; justify-content: space-between; gap: 2mm; margin: 1.5mm 0; }
          .receipt-line span { flex: 0 0 auto; color: #333; }
          .receipt-line strong { max-width: 34mm; text-align: right; overflow-wrap: anywhere; }
          .receipt-order-head, .receipt-order-item { display: grid; grid-template-columns: minmax(0, 1fr) 7mm 14mm; gap: 1mm; align-items: start; }
          .receipt-order-head { color: #444; }
          .receipt-order-head span:nth-child(n + 2), .receipt-order-item span:nth-child(2), .receipt-order-item strong { text-align: right; }
          .receipt-order-items, .receipt-records { display: grid; gap: 2mm; margin-top: 2mm; }
          .receipt-order-item span:first-child, .receipt-note { overflow-wrap: anywhere; }
          .receipt-note { margin-top: 2mm; line-height: 1.5; }
          .receipt-record { display: grid; gap: 1mm; }
          .receipt-record div, .receipt-record span { display: grid; gap: 0.5mm; }
          .receipt-record strong { font-size: 10px; }
          .receipt-record span, .receipt-record p { margin: 0; color: #222; }
        </style>
      </head>
      <body>${els.receiptPrintArea.innerHTML}</body>
    </html>`);
  printWindow.document.close();
  printWindow.focus();
  window.setTimeout(() => {
    const receipt = printWindow.document.querySelector(".receipt");
    const pageSizeStyle = printWindow.document.querySelector("#receiptPageSize");
    if (receipt && pageSizeStyle) {
      const contentHeightMm = Math.ceil(receipt.scrollHeight * 25.4 / 96);
      const pageHeightMm = Math.min(1000, Math.max(60, contentHeightMm + 8));
      pageSizeStyle.textContent = `@page { size: 58mm ${pageHeightMm}mm; margin: 0; }`;
    }
    printWindow.print();
  }, 500);
}

function buildOrderReceiptText(order) {
  const member = getMember(order.memberId);
  const customerName = member?.name || order.customerName || "微信顾客";
  const customerPhone = member?.phone || order.customerPhone || "";
  const subtotal = order.items.reduce(
    (sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0),
    0
  );
  const netAmount = Number(order.totalAmount || 0) - Number(order.refundAmount || 0);
  const lines = [
    "爱娃披萨店",
    "订单小票",
    "--------------------------------",
    `订单号：${order.orderNo}`,
    `下单时间：${formatFullTime(order.createdAt)}`,
    `订单状态：${orderStatusLabel(order.status)}`,
    `订单来源：${order.orderChannel === "mini_program" || order.paymentRedirect === "mini_program" ? "微信小程序下单" : "店家后台下单"}`,
    `会员昵称：${customerName}`,
  ];
  if (member?.card) lines.push(`会员号：${member.card}`);
  if (customerPhone) lines.push(`电话：${customerPhone}`);
  lines.push(`取餐方式：${buildFulfillmentLabel(order)}`);
  if (order.fulfillmentType === "delivery" && order.deliveryAddress) {
    if (order.deliveryRecipientName) lines.push(`收货人：${order.deliveryRecipientName}`);
    if (order.deliveryRecipientPhone) lines.push(`收货电话：${order.deliveryRecipientPhone}`);
    lines.push(`配送地址：${order.deliveryAddress}`);
  }
  lines.push("--------------------------------", "商品明细");
  for (const item of order.items) {
    lines.push(String(item.name || "商品"));
    lines.push(`  ×${Number(item.quantity || 0)}    ${money(Number(item.price || 0) * Number(item.quantity || 0))}`);
  }
  lines.push("--------------------------------", `商品小计：${money(subtotal)}`);
  if (Number(order.deliveryFee || 0)) {
    lines.push(`配送费：${order.deliveryFeeWaived ? `${money(order.deliveryFee)}（已减免）` : money(order.deliveryFee)}`);
  }
  if (order.refundAmount) lines.push(`已退款：${money(order.refundAmount)}`);
  lines.push(`实收：${money(netAmount)}`, `支付方式：${paymentMethodLabel(order.paymentMethod)}`);
  if (order.note) lines.push(`备注：${order.note}`);
  lines.push("--------------------------------", "感谢惠顾，欢迎下次光临");
  return lines.join("\n");
}

function buildMemberStatementText({ member, records, statementNo, rangeLabel, totalRecharge, totalBonus, totalSpend }) {
  const lines = [
    "爱娃披萨店",
    "会员交易记录",
    "--------------------------------",
    `单号：${statementNo}`,
    `打印时间：${formatFullTime(new Date().toISOString())}`,
    `范围：${rangeLabel}`,
    `会员：${member.name}`,
    `手机号：${member.phone}`,
    `卡号：${member.card}`,
    "--------------------------------",
    `充值合计：${money(totalRecharge)}`,
    `赠送合计：${money(totalBonus)}`,
    `消费合计：${money(totalSpend)}`,
    `当前余额：${money(member.balance)}`,
    "--------------------------------",
  ];
  for (const record of records) {
    lines.push(formatFullTime(record.createdAt));
    lines.push(`${recordTypeLabel(record.type)} ${recordAmountText(record)}${record.bonusAmount ? ` / 赠 ${money(record.bonusAmount)}` : ""}`);
    lines.push(`余额：${record.balanceAfter === null || record.balanceAfter === undefined ? "-" : money(record.balanceAfter)}`);
    if (record.note) lines.push(`备注：${record.note}`);
    lines.push("--------------------------------");
  }
  lines.push("感谢惠顾，欢迎下次光临");
  return lines.join("\n");
}

function buildFilteredRecordStatementText({
  records,
  memberLabel,
  totalRecharge,
  totalBonus,
  totalSpend,
  totalOrderPayment,
  totalOrderRefund,
}) {
  const lines = [
    "爱娃披萨店",
    "流水查询结果",
    "--------------------------------",
    `打印时间：${formatFullTime(new Date().toISOString())}`,
    `会员搜索：${recordSearchLabel()}`,
    `类型：${recordTypeFilterLabel()}`,
    `日期范围：${recordDateRangeLabel()}`,
    `涉及会员：${memberLabel}`,
    "--------------------------------",
    `记录数：${records.length} 笔`,
    `充值合计：${money(totalRecharge)}`,
    `赠送合计：${money(totalBonus)}`,
    `余额消费：${money(totalSpend)}`,
    `订单收入：${money(totalOrderPayment)}`,
    `订单退款：${money(totalOrderRefund)}`,
    "--------------------------------",
    "查询条件对应以上汇总数据",
  ];
  return lines.join("\n");
}

function printOrderReceipt(orderId) {
  const order = getOrder(orderId);
  if (!order) {
    alert("没有找到这个订单");
    return;
  }

  const member = getMember(order.memberId);
  const customerName = member?.name || order.customerName || "微信顾客";
  const customerPhone = member?.phone || order.customerPhone || "";
  const subtotal = order.items.reduce(
    (sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0),
    0
  );
  const netAmount = Number(order.totalAmount || 0) - Number(order.refundAmount || 0);
  const receiptHtml = `
    <div class="receipt order-receipt">
      <h2>爱娃披萨店</h2>
      <p class="receipt-subtitle">订单小票</p>
      <div class="receipt-dashed"></div>
      ${receiptLine("订单号", order.orderNo)}
      ${receiptLine("下单时间", formatFullTime(order.createdAt))}
      ${receiptLine("订单状态", orderStatusLabel(order.status))}
      ${receiptLine("订单来源", order.orderChannel === "mini_program" || order.paymentRedirect === "mini_program" ? "微信小程序下单" : "店家后台下单")}
      ${receiptLine("会员昵称", customerName)}
      ${member?.card ? receiptLine("会员号", member.card) : ""}
      ${customerPhone ? receiptLine("电话", customerPhone) : ""}
      ${receiptLine("取餐方式", buildFulfillmentLabel(order))}
      ${order.fulfillmentType === "delivery" && order.deliveryRecipientName ? receiptLine("收货人", order.deliveryRecipientName) : ""}
      ${order.fulfillmentType === "delivery" && order.deliveryRecipientPhone ? receiptLine("收货电话", order.deliveryRecipientPhone) : ""}
      ${order.fulfillmentType === "delivery" && order.deliveryAddress ? receiptLine("配送地址", order.deliveryAddress) : ""}
      <div class="receipt-dashed"></div>
      <div class="receipt-order-head"><span>商品</span><span>数量</span><span>金额</span></div>
      <div class="receipt-order-items">
        ${order.items.map((item) => `
          <div class="receipt-order-item">
            <span>${escapeHtml(item.name)}</span>
            <span>×${Number(item.quantity || 0)}</span>
            <strong>${money(Number(item.price || 0) * Number(item.quantity || 0))}</strong>
          </div>
        `).join("")}
      </div>
      <div class="receipt-dashed"></div>
      ${receiptLine("商品小计", money(subtotal))}
      ${Number(order.deliveryFee || 0) ? receiptLine("配送费", order.deliveryFeeWaived ? `${money(order.deliveryFee)}（已减免）` : money(order.deliveryFee)) : ""}
      ${order.refundAmount ? receiptLine("已退款", money(order.refundAmount)) : ""}
      ${receiptLine("实收", money(netAmount))}
      ${receiptLine("支付方式", paymentMethodLabel(order.paymentMethod))}
      ${order.note ? `<div class="receipt-note"><strong>备注：</strong>${escapeHtml(order.note)}</div>` : ""}
      <div class="receipt-dashed"></div>
      <p class="receipt-footer">感谢惠顾，欢迎下次光临</p>
    </div>
  `;
  showReceiptPreview(`订单 ${order.orderNo} 小票预览`, receiptHtml, buildOrderReceiptText(order));
}

function openMemberPrintDialog(memberId) {
  const member = getMember(memberId);
  if (!member) {
    alert("没有找到这个会员");
    return;
  }
  const today = new Date();
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(today.getDate() - 29);
  els.memberPrintId.value = member.id;
  els.memberPrintTitle.textContent = `${member.name} · 选择交易日期`;
  els.memberPrintStartDate.value = formatDateInputValue(thirtyDaysAgo);
  els.memberPrintEndDate.value = formatDateInputValue(today);
  els.memberPrintAllDates.checked = false;
  els.memberPrintStartDate.disabled = false;
  els.memberPrintEndDate.disabled = false;
  els.memberPrintDialog.showModal();
}

function printMemberStatement(memberId, range = { start: null, end: null }, rangeLabel = "全部交易") {
  const member = getMember(memberId);
  if (!member) {
    alert("没有找到这个会员");
    return;
  }

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
      ${receiptLine("范围", rangeLabel)}
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
  showReceiptPreview(
    "会员交易记录预览",
    receiptHtml,
    buildMemberStatementText({
      member,
      records,
      statementNo,
      rangeLabel,
      totalRecharge,
      totalBonus,
      totalSpend,
    })
  );
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
      <p class="receipt-footer">查询条件对应以上汇总数据</p>
    </div>
  `;
  showReceiptPreview(
    "流水查询结果预览",
    receiptHtml,
    buildFilteredRecordStatementText({
      records,
      memberLabel,
      totalRecharge,
      totalBonus,
      totalSpend,
      totalOrderPayment,
      totalOrderRefund,
    })
  );
}

function exportData() {
  const records = getFilteredRecords();
  if (!records.length) {
    alert("当前查询条件下没有可导出的流水");
    return;
  }
  const excelText = (value) => {
    const text = String(value ?? "");
    const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
    return escapeHtml(safe);
  };
  const rows = records.map((record) => `
    <tr>
      <td>${excelText(formatFullTime(record.createdAt))}</td>
      <td>${excelText(recordTypeLabel(record.type))}</td>
      <td>${excelText(record.memberName || "顾客")}</td>
      <td style="mso-number-format:'\\@'">${excelText(record.memberCard)}</td>
      <td style="mso-number-format:'\\@'">${excelText(record.memberPhone)}</td>
      <td style="mso-number-format:'\\@'">${excelText(record.orderNo)}</td>
      <td>${excelText(paymentMethodLabel(record.paymentMethod))}</td>
      <td>${excelText(record.itemsText)}</td>
      <td class="number">${Number(record.amount || 0)}</td>
      <td class="number">${Number(record.bonusAmount || 0)}</td>
      <td class="number">${record.balanceAfter === null || record.balanceAfter === undefined ? "" : Number(record.balanceAfter)}</td>
      <td>${excelText(record.note)}</td>
    </tr>`).join("");
  const workbook = `<!doctype html><html><head><meta charset="UTF-8"><style>
    table{border-collapse:collapse;font-family:Arial,"Microsoft YaHei",sans-serif;font-size:11pt}
    th,td{border:1px solid #999;padding:6px;vertical-align:top}th{background:#0f8a6b;color:#fff}
    .title{font-size:16pt;font-weight:bold;background:#e8f5f1;color:#111}.meta{background:#f3f6f5}.number{mso-number-format:'0.00'}
  </style></head><body><table>
    <tr><td class="title" colspan="12">爱娃披萨店流水明细</td></tr>
    <tr><td class="meta" colspan="12">筛选条件：会员搜索 ${excelText(recordSearchLabel())}；类型 ${excelText(recordTypeFilterLabel())}；日期 ${excelText(recordDateRangeLabel())}；共 ${records.length} 笔</td></tr>
    <tr><th>交易时间</th><th>类型</th><th>会员名称</th><th>会员号</th><th>手机号</th><th>订单号</th><th>支付方式</th><th>商品</th><th>金额</th><th>赠送金额</th><th>交易后余额</th><th>备注</th></tr>
    ${rows}
  </table></body></html>`;
  const blob = new Blob(["\ufeff", workbook], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `爱娃披萨店流水-${new Date().toISOString().slice(0, 10)}.xls`;
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
      const fallbackStore = createStore("爱娃披萨店", PRIMARY_STORE_ID);
      state.stores = Array.isArray(data.stores) && data.stores.length ? data.stores : [fallbackStore];
      const defaultStoreId = state.stores[0].id;
      state.staff =
        Array.isArray(data.staff) && data.staff.length
          ? data.staff.map((staffer) => normalizeStaff(staffer, defaultStoreId))
          : cloudConfig.enabled
            ? []
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
document.querySelectorAll("[data-dialog-close]").forEach((button) => {
  button.addEventListener("click", () => button.closest("dialog")?.close("cancel"));
});
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
els.memberPrintAllDates.addEventListener("change", () => {
  const disabled = els.memberPrintAllDates.checked;
  els.memberPrintStartDate.disabled = disabled;
  els.memberPrintEndDate.disabled = disabled;
});
els.memberPrintForm.addEventListener("submit", (event) => {
  if (event.submitter?.value === "cancel") return;
  event.preventDefault();
  const memberId = els.memberPrintId.value;
  if (els.memberPrintAllDates.checked) {
    els.memberPrintDialog.close();
    printMemberStatement(memberId);
    return;
  }
  const startValue = els.memberPrintStartDate.value;
  const endValue = els.memberPrintEndDate.value;
  if (!startValue || !endValue) {
    alert("请选择开始日期和结束日期");
    return;
  }
  if (startValue > endValue) {
    alert("开始日期不能晚于结束日期");
    return;
  }
  const range = {
    start: new Date(`${startValue}T00:00:00`),
    end: new Date(`${endValue}T23:59:59`),
  };
  els.memberPrintDialog.close();
  printMemberStatement(memberId, range, `日期：${startValue} 至 ${endValue}`);
});
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
      openMemberPrintDialog(record.memberId);
    }
  }
});

els.bonusRuleForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!currentStaffIsManager()) {
    alert("只有店长可以修改充值赠送规则");
    return;
  }
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

els.deliverySettingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const delivery = normalizeSettings({ delivery: {
    fee: els.deliveryFee.value,
    freeThreshold: els.freeDeliveryThreshold.value,
    storeLatitude: els.storeLatitude.value,
    storeLongitude: els.storeLongitude.value,
    testMode: els.deliveryTestMode.checked,
  }}).delivery;
  if (delivery.storeLatitude === null || delivery.storeLongitude === null) {
    alert("请填写正确的门店经纬度");
    return;
  }
  if (!delivery.testMode && !storeLocationIsInQianan(delivery.storeLatitude, delivery.storeLongitude)) {
    alert("正式模式只允许保存迁安市范围内的门店坐标；在北京测试请先开启“临时测试模式”。");
    return;
  }
  state.settings.delivery = delivery;
  await saveState();
  renderDeliverySettings();
  els.deliverySettingsStatus.textContent = "配送设置已保存并同步到顾客端。";
});

els.locateStore.addEventListener("click", () => {
  if (!navigator.geolocation) {
    els.deliverySettingsStatus.textContent = "当前浏览器不支持定位，请使用手机微信或最新版浏览器打开后台。";
    return;
  }
  els.deliverySettingsStatus.textContent = "正在获取门店当前位置…";
  navigator.geolocation.getCurrentPosition(
    (position) => {
      els.storeLatitude.value = Number(position.coords.latitude).toFixed(6);
      els.storeLongitude.value = Number(position.coords.longitude).toFixed(6);
      updateStoreLocationVerification();
      captureDeliverySettingsDraft();
      const inQianan = storeLocationIsInQianan(position.coords.latitude, position.coords.longitude);
      els.deliverySettingsStatus.textContent = inQianan
        ? `定位成功（精度约 ${Math.round(position.coords.accuracy || 0)} 米），请先在地图中核对，再保存。`
        : "定位结果不在迁安市范围内，可能是电脑网络定位偏移，请改用门店手机定位。";
    },
    () => {
      els.deliverySettingsStatus.textContent = "定位失败，请允许浏览器获取位置后重试。";
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
});

els.storeLatitude.addEventListener("input", updateStoreLocationVerification);
els.storeLongitude.addEventListener("input", updateStoreLocationVerification);
els.deliverySettingsForm.addEventListener("input", captureDeliverySettingsDraft);
els.deliverySettingsForm.addEventListener("change", captureDeliverySettingsDraft);

els.orderSoundEnabled.addEventListener("change", async () => {
  orderSoundEnabled = els.orderSoundEnabled.checked;
  localStorage.setItem(ORDER_SOUND_STORAGE_KEY, String(orderSoundEnabled));
  if (orderSoundEnabled) {
    const unlocked = await unlockOrderAudio();
    if (unlocked) playOrderTone();
  }
  renderOrderSoundSetting();
});

els.testOrderSound.addEventListener("click", async () => {
  if (!orderSoundEnabled) {
    orderSoundEnabled = true;
    localStorage.setItem(ORDER_SOUND_STORAGE_KEY, "true");
  }
  const unlocked = await unlockOrderAudio();
  if (unlocked && playOrderTone()) {
    renderOrderSoundSetting("试听成功，新订单进入时会自动提醒");
  }
});

document.addEventListener("pointerdown", () => {
  if (orderSoundEnabled && !orderAudioUnlocked) unlockOrderAudio();
}, { passive: true });

document.addEventListener("keydown", () => {
  if (orderSoundEnabled && !orderAudioUnlocked) unlockOrderAudio();
}, { passive: true });

els.bonusRuleList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-delete-rule]");
  if (!button) return;
  if (!currentStaffIsManager()) {
    alert("只有店长可以修改充值赠送规则");
    return;
  }
  state.settings.bonusRules = state.settings.bonusRules.filter((rule) => rule.id !== button.dataset.deleteRule);
  saveState();
  renderBonusRules();
});

els.staffForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentStaffIsManager()) {
    alert("只有店长可以管理店员");
    return;
  }
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
  if (!currentStaffIsManager()) {
    alert("只有店长可以管理店员");
    return;
  }
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
  const printButton = event.target.closest("[data-order-print]");
  if (printButton) {
    printOrderReceipt(printButton.dataset.orderPrint);
    return;
  }
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
  const printButton = event.target.closest("[data-order-print]");
  if (printButton) {
    printOrderReceipt(printButton.dataset.orderPrint);
    return;
  }
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
    openMemberPrintDialog(member.id);
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
  initializeOrderAlerts();
  startLocalRefresh();
});
