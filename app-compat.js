(() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __defProps = Object.defineProperties;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getOwnPropSymbols = Object.getOwnPropertySymbols;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __propIsEnum = Object.prototype.propertyIsEnumerable;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __spreadValues = (a, b) => {
    for (var prop in b || (b = {}))
      if (__hasOwnProp.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    if (__getOwnPropSymbols)
      for (var prop of __getOwnPropSymbols(b)) {
        if (__propIsEnum.call(b, prop))
          __defNormalProp(a, prop, b[prop]);
      }
    return a;
  };
  var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
  var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
    get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
  }) : x)(function(x) {
    if (typeof require !== "undefined") return require.apply(this, arguments);
    throw Error('Dynamic require of "' + x + '" is not supported');
  });
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));

  // app.js
  var STORAGE_KEY = "aiwa_drink_membership_v1";
  var ORDER_SOUND_STORAGE_KEY = "aiwa_order_sound_enabled_v1";
  var CLOUD_SESSION_VERSION = 2;
  var PRIMARY_STORE_ID = "store_aiwa_pizza_main";
  var ORDER_REMINDER_INTERVAL_MS = 60 * 1e3;
  var ORIGINAL_PAGE_TITLE = document.title;
  var cloudConfig = window.AIWA_CLOUDBASE_CONFIG || {};
  var CLOUDBASE_SDK_URL = "./cloudbase-sdk.js?v=20260804-1";
  var cloudSaveTimer = null;
  var cloudSaveInFlight = false;
  var localDataRevision = 0;
  var localRefreshTimer = null;
  var loginCodeCountdownTimer = null;
  var remoteRefreshInFlight = false;
  var deliverySettingsDirty = false;
  var orderAudioContext = null;
  var orderAudioUnlocked = false;
  var knownAlertableOrderIds = /* @__PURE__ */ new Set();
  var orderAlertsInitialized = false;
  var lastPendingReminderAt = 0;
  var titleFlashTimer = null;
  var titleFlashStep = 0;
  var orderSoundEnabled = localStorage.getItem(ORDER_SOUND_STORAGE_KEY) !== "false";
  var state = {
    localApi: {
      enabled: Boolean(cloudConfig.localApi),
      ready: false
    },
    cloud: {
      enabled: Boolean(cloudConfig.enabled),
      ready: false,
      booting: false,
      message: "\u672C\u5730\u6A21\u5F0F"
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
      delivery: { fee: 5, freeThreshold: 58, maxDistanceKm: 3, storeLatitude: null, storeLongitude: null, testMode: false }
    },
    activeView: "dashboard"
  };
  async function initLocalApi() {
    if (!cloudConfig.localApi) return;
    try {
      const localSnapshot = serializeState();
      const result = await callLocalApi("GET");
      state.localApi.ready = true;
      state.cloud.enabled = false;
      state.cloud.ready = false;
      state.cloud.message = "\u672C\u5730\u5171\u4EAB\u6D4B\u8BD5\u6A21\u5F0F";
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
      state.cloud.message = "\u672C\u5730\u5171\u4EAB\u670D\u52A1\u672A\u8FDE\u63A5\uFF0C\u5DF2\u4F7F\u7528\u5F53\u524D\u6D4F\u89C8\u5668\u6570\u636E";
      console.warn("[Local API]", error);
    }
  }
  async function callLocalApi(method, data) {
    const response = await fetch(cloudConfig.localApiUrl || "/api/local-data", {
      method,
      headers: { "Content-Type": "application/json" },
      body: method === "POST" ? JSON.stringify({ data }) : void 0
    });
    const result = await response.json();
    if (!response.ok || result.ok === false) {
      throw new Error(result.message || "Local API request failed");
    }
    return result;
  }
  async function initCloudBase() {
    var _a, _b;
    if (cloudConfig.localApi) {
      state.cloud.message = "\u672C\u5730\u5171\u4EAB\u6D4B\u8BD5\u6A21\u5F0F";
      return;
    }
    if (!cloudConfig.enabled) {
      state.cloud.message = cloudConfig.envId ? `CloudBase \u73AF\u5883\u5DF2\u8BB0\u5F55\uFF1A${cloudConfig.envId}\uFF0C\u5F53\u524D\u4ECD\u4F7F\u7528\u672C\u5730\u6A21\u5F0F` : "\u672C\u5730\u6A21\u5F0F";
      return;
    }
    if (!cloudConfig.envId) {
      state.cloud.enabled = false;
      state.cloud.message = "CloudBase \u73AF\u5883\u672A\u914D\u7F6E\uFF0C\u5DF2\u5207\u6362\u672C\u5730\u6A21\u5F0F";
      return;
    }
    try {
      await loadCloudBaseSdk();
      state.cloud.app = window.cloudbase.init({ env: cloudConfig.envId });
      state.cloud.auth = state.cloud.app.auth();
      state.cloud.db = state.cloud.app.database();
      if ((_a = state.cloud.auth) == null ? void 0 : _a.signInAnonymously) {
        let loginResult = await state.cloud.auth.signInAnonymously();
        if (loginResult == null ? void 0 : loginResult.error) {
          await state.cloud.auth.signOut().catch(() => {
          });
          loginResult = await state.cloud.auth.signInAnonymously();
        }
        if (loginResult == null ? void 0 : loginResult.error) {
          throw new Error(loginResult.error.message || "\u533F\u540D\u8EAB\u4EFD\u8BA4\u8BC1\u5931\u8D25");
        }
      } else if ((_b = state.cloud.auth) == null ? void 0 : _b.anonymousAuthProvider) {
        await state.cloud.auth.anonymousAuthProvider().signIn();
      }
      state.cloud.ready = true;
      state.cloud.message = `CloudBase \u5DF2\u8FDE\u63A5\uFF1A${cloudConfig.envId}`;
    } catch (error) {
      state.cloud.ready = false;
      state.cloud.message = `CloudBase \u521D\u59CB\u5316\u5931\u8D25\uFF1A${(error == null ? void 0 : error.message) || "\u672A\u77E5\u9519\u8BEF"}`;
      console.warn("[CloudBase]", error);
    }
  }
  async function loadCloudBaseSdk() {
    if (window.cloudbase) return window.cloudbase;
    const module = await Promise.resolve().then(() => __toESM(__require(CLOUDBASE_SDK_URL)));
    window.cloudbase = module.default || window.cloudbase;
    if (!window.cloudbase) throw new Error("CloudBase SDK load failed");
    return window.cloudbase;
  }
  async function callCloud(action, payload = {}) {
    var _a, _b, _c, _d, _e;
    if (!state.cloud.ready || !((_a = state.cloud.app) == null ? void 0 : _a.callFunction)) {
      throw new Error("CloudBase is not ready");
    }
    const result = await Promise.race([
      state.cloud.app.callFunction({
        name: ((_b = cloudConfig.functions) == null ? void 0 : _b.membershipApi) || "membershipApi",
        data: {
          action,
          payload: __spreadProps(__spreadValues({}, payload), {
            sessionToken: ((_c = state.session) == null ? void 0 : _c.token) || payload.sessionToken || ""
          })
        }
      }),
      new Promise((_, reject) => {
        window.setTimeout(() => reject(new Error("\u4E91\u7AEF\u8BF7\u6C42\u8D85\u65F6\uFF0C\u8BF7\u68C0\u67E5\u7F51\u7EDC\u540E\u91CD\u8BD5")), 15e3);
      })
    ]);
    if (!((_d = result.result) == null ? void 0 : _d.ok)) {
      throw new Error(((_e = result.result) == null ? void 0 : _e.message) || "CloudBase request failed");
    }
    return result.result;
  }
  var els = {
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
      settings: document.querySelector("#settingsView")
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
    memberPrintAllDates: document.querySelector("#memberPrintAllDates")
  };
  var viewTitles = {
    dashboard: "\u603B\u89C8",
    orders: "\u8BA2\u5355",
    products: "\u5546\u54C1",
    members: "\u4F1A\u5458",
    records: "\u6D41\u6C34",
    settings: "\u8BBE\u7F6E"
  };
  function loadState() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      const store = createStore("\u7231\u5A03\u62AB\u8428\u5E97", PRIMARY_STORE_ID);
      const manager = createStaff("\u5E97\u957F", "13800000000", "manager", store.id);
      state.stores = [store];
      state.staff = cloudConfig.enabled ? [] : [manager];
      state.session = null;
      const shouldSeedDemoData = !cloudConfig.enabled;
      state.members = shouldSeedDemoData ? [createMember("\u793A\u4F8B\u4F1A\u5458", "13800000000", "AW0001", 100, "\u5C11\u51B0\u4E09\u5206\u7CD6", store.id)] : [];
      state.records = shouldSeedDemoData ? [
        createRecord(state.members[0].id, "recharge", 100, 100, "\u5F00\u5361\u5145\u503C")
      ] : [];
      state.categories = createDefaultCategories(store.id);
      state.products = createDefaultProducts(store.id);
      state.orders = [];
      state.refunds = [];
      saveState();
      return;
    }
    try {
      const parsed = JSON.parse(saved);
      const fallbackStore = createStore("\u7231\u5A03\u62AB\u8428\u5E97", PRIMARY_STORE_ID);
      state.stores = Array.isArray(parsed.stores) && parsed.stores.length ? parsed.stores : [fallbackStore];
      const defaultStoreId = state.stores[0].id;
      state.staff = Array.isArray(parsed.staff) && parsed.staff.length ? parsed.staff.map((staffer) => normalizeStaff(staffer, defaultStoreId)) : cloudConfig.enabled ? [] : [createStaff("\u5E97\u957F", "13800000000", "manager", defaultStoreId)];
      state.session = normalizeSession(parsed.session);
      state.members = Array.isArray(parsed.members) ? parsed.members.map((member) => normalizeMember(member, defaultStoreId)) : [];
      state.records = Array.isArray(parsed.records) ? parsed.records : [];
      state.categories = normalizeCategories(parsed.categories, defaultStoreId);
      state.products = normalizeProducts(parsed.products, defaultStoreId);
      state.orders = normalizeOrders(parsed.orders, defaultStoreId);
      state.refunds = normalizeRefunds(parsed.refunds, defaultStoreId);
      state.settings = normalizeSettings(parsed.settings);
      state.records = state.records.map(normalizeRecord);
    } catch (e) {
      const store = createStore("\u7231\u5A03\u62AB\u8428\u5E97", PRIMARY_STORE_ID);
      state.stores = [store];
      state.staff = cloudConfig.enabled ? [] : [createStaff("\u5E97\u957F", "13800000000", "manager", store.id)];
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
      settings: state.settings
    };
  }
  function saveState(options = {}) {
    var _a;
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(serializeState())
    );
    if (options.sync !== false) localDataRevision += 1;
    if (options.sync !== false && state.cloud.ready && ((_a = state.session) == null ? void 0 : _a.token) && !state.cloud.booting) {
      scheduleCloudSave();
    }
    if (options.sync !== false && state.localApi.ready && !state.cloud.booting) {
      scheduleCloudSave();
    }
  }
  function applyData(data, options = {}) {
    const fallbackStore = createStore("\u7231\u5A03\u62AB\u8428\u5E97", PRIMARY_STORE_ID);
    state.stores = Array.isArray(data.stores) && data.stores.length ? data.stores : [fallbackStore];
    const defaultStoreId = state.stores[0].id;
    state.staff = Array.isArray(data.staff) && data.staff.length ? data.staff.map((staffer) => normalizeStaff(staffer, defaultStoreId)) : cloudConfig.enabled ? [] : [createStaff("\u5E97\u957F", "13800000000", "manager", defaultStoreId)];
    state.session = options.keepSession ? state.session : normalizeSession(data.session);
    state.members = Array.isArray(data.members) ? data.members.map((member) => normalizeMember(member, defaultStoreId)) : [];
    state.records = Array.isArray(data.records) ? data.records.map(normalizeRecord) : [];
    state.categories = normalizeCategories(data.categories, defaultStoreId);
    state.products = normalizeProducts(data.products, defaultStoreId);
    state.orders = normalizeOrders(data.orders, defaultStoreId);
    state.refunds = normalizeRefunds(data.refunds, defaultStoreId);
    state.settings = normalizeSettings(data.settings);
  }
  async function syncFromCloud() {
    var _a;
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
    if (!state.cloud.ready || !((_a = state.session) == null ? void 0 : _a.token)) return;
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
        state.cloud.message = "CloudBase \u6570\u636E\u5DF2\u540C\u6B65";
      }
    } catch (error) {
      state.cloud.message = `CloudBase \u540C\u6B65\u5931\u8D25\uFF1A${(error == null ? void 0 : error.message) || "\u672A\u77E5\u9519\u8BEF"}`;
      console.warn("[CloudBase sync]", error);
    }
  }
  function scheduleCloudSave() {
    clearTimeout(cloudSaveTimer);
    cloudSaveTimer = setTimeout(pushCloudState, 500);
  }
  async function pushCloudState() {
    var _a;
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
        state.cloud.message = "\u672C\u5730\u5171\u4EAB\u6570\u636E\u5DF2\u4FDD\u5B58";
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
    if (!state.cloud.ready || !((_a = state.session) == null ? void 0 : _a.token)) {
      cloudSaveInFlight = false;
      return false;
    }
    try {
      await callCloud("saveStoreData", { data: serializeState() });
      state.cloud.message = "CloudBase \u6570\u636E\u5DF2\u4FDD\u5B58";
      deliverySettingsDirty = false;
      return true;
    } catch (error) {
      state.cloud.message = "CloudBase \u4FDD\u5B58\u5931\u8D25\uFF0C\u5DF2\u7EE7\u7EED\u4F7F\u7528\u672C\u5730\u6570\u636E";
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
      alert("\u5E97\u5458\u5DF2\u6682\u5B58\u5728\u5F53\u524D\u6D4F\u89C8\u5668\uFF0C\u4F46\u6CA1\u6709\u4FDD\u5B58\u5230\u4E91\u7AEF\u3002\u8BF7\u68C0\u67E5\u7F51\u7EDC\u540E\u91CD\u65B0\u6DFB\u52A0\u6216\u5237\u65B0\u9875\u9762\u518D\u8BD5\u3002");
    }
  }
  function createId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }
  function createStore(name, id = createId("store")) {
    return {
      id,
      name,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
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
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  function createMember(name, phone, card, balance, note, storeId = ((_a) => (_a = getCurrentStore()) == null ? void 0 : _a.id)()) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    return {
      id: createId("member"),
      storeId,
      name,
      phone: normalizePhone(phone),
      card: card || nextCardNumber(),
      balance: Number(balance) || 0,
      note: note || "",
      createdAt: now,
      updatedAt: now
    };
  }
  function createCategory(name, storeId = ((_a) => (_a = getCurrentStore()) == null ? void 0 : _a.id)()) {
    return {
      id: createId("category"),
      storeId,
      name,
      sort: Date.now(),
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  function createProduct({
    name,
    category,
    price,
    description = "",
    image = "",
    active = true,
    storeId = ((_a) => (_a = getCurrentStore()) == null ? void 0 : _a.id)()
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
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  function createDefaultCategories(storeId) {
    return ["\u62AB\u8428", "\u5957\u9910", "\u996E\u54C1"].map((name, index) => ({
      id: `category_${index + 1}`,
      storeId,
      name,
      sort: index + 1,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    }));
  }
  function createDefaultProducts(storeId) {
    return [
      createProduct({
        name: "\u739B\u683C\u4E3D\u7279\u62AB\u8428",
        category: "\u62AB\u8428",
        price: 39,
        description: "\u756A\u8304\u5E95\u3001\u9A6C\u82CF\u91CC\u62C9\u829D\u58EB\u3001\u7F57\u52D2\u98CE\u5473",
        storeId
      }),
      createProduct({
        name: "\u590F\u5A01\u5937\u62AB\u8428",
        category: "\u62AB\u8428",
        price: 45,
        description: "\u706B\u817F\u3001\u83E0\u841D\u3001\u829D\u58EB\uFF0C\u9178\u751C\u6E05\u723D",
        storeId
      }),
      createProduct({
        name: "\u53CC\u4EBA\u5206\u4EAB\u5957\u9910",
        category: "\u5957\u9910",
        price: 88,
        description: "\u4EFB\u9009\u62AB\u8428 1 \u4EFD\uFF0C\u914D\u5C0F\u98DF\u548C\u996E\u54C1",
        storeId
      }),
      createProduct({
        name: "\u67E0\u6AAC\u8336",
        category: "\u996E\u54C1",
        price: 12,
        description: "\u6E05\u723D\u89E3\u817B\uFF0C\u53EF\u5907\u6CE8\u5C11\u51B0",
        storeId
      })
    ];
  }
  function createRecord(memberId, type, amount, balanceAfter, note, bonusAmount = 0) {
    var _a, _b, _c;
    return {
      id: createId("record"),
      memberId,
      storeId: ((_a = getMember(memberId)) == null ? void 0 : _a.storeId) || ((_b = getCurrentStore()) == null ? void 0 : _b.id),
      staffId: ((_c = state.session) == null ? void 0 : _c.staffId) || null,
      type,
      amount: Number(amount),
      bonusAmount: Number(bonusAmount) || 0,
      balanceAfter: Number(balanceAfter),
      note: note || "",
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  function createOrderNo() {
    const stamp = /* @__PURE__ */ new Date();
    const date = `${stamp.getFullYear()}${String(stamp.getMonth() + 1).padStart(2, "0")}${String(stamp.getDate()).padStart(2, "0")}`;
    return `AW${date}${String(Date.now()).slice(-5)}`;
  }
  function normalizeSettings(settings = {}) {
    const bonusRules = Array.isArray(settings.bonusRules) ? settings.bonusRules.map((rule) => ({
      id: rule.id || createId("rule"),
      minAmount: Number(rule.minAmount),
      bonusAmount: Number(rule.bonusAmount)
    })).filter((rule) => rule.minAmount > 0 && rule.bonusAmount >= 0).sort((a, b) => a.minAmount - b.minAmount) : [];
    const incoming = settings.delivery || {};
    const coordinate = (value, min, max) => {
      if (value === "" || value === null || value === void 0) return null;
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
        testMode: incoming.testMode === true
      }
    };
  }
  function normalizePhone(phone) {
    return String(phone || "").replace(/\D/g, "");
  }
  function normalizeSession(session) {
    if (!(session == null ? void 0 : session.staffId) || !(session == null ? void 0 : session.storeId) || !(session == null ? void 0 : session.token) || Number((session == null ? void 0 : session.expiresAt) || 0) <= Date.now() || session.authVersion !== CLOUD_SESSION_VERSION) return null;
    return {
      staffId: session.staffId,
      storeId: session.storeId,
      token: session.token,
      expiresAt: Number(session.expiresAt),
      loggedInAt: session.loggedInAt || (/* @__PURE__ */ new Date()).toISOString(),
      authVersion: CLOUD_SESSION_VERSION
    };
  }
  function normalizeStaff(staffer, defaultStoreId) {
    return {
      id: staffer.id || createId("staff"),
      name: staffer.name || "\u5E97\u5458",
      phone: normalizePhone(staffer.phone),
      role: staffer.role === "manager" ? "manager" : "staff",
      storeId: staffer.storeId || defaultStoreId,
      active: staffer.active !== false,
      createdAt: staffer.createdAt || (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  function normalizeMember(member, defaultStoreId) {
    return __spreadProps(__spreadValues({}, member), {
      storeId: member.storeId || defaultStoreId,
      phone: normalizePhone(member.phone),
      balance: Number(member.balance) || 0,
      updatedAt: member.updatedAt || member.createdAt || (/* @__PURE__ */ new Date()).toISOString()
    });
  }
  function normalizeRecord(record) {
    var _a, _b;
    return __spreadProps(__spreadValues({}, record), {
      storeId: record.storeId || ((_a = getMember(record.memberId)) == null ? void 0 : _a.storeId) || ((_b = state.stores[0]) == null ? void 0 : _b.id),
      staffId: record.staffId || null,
      amount: Number(record.amount) || 0,
      bonusAmount: Number(record.bonusAmount) || 0,
      balanceAfter: Number(record.balanceAfter) || 0,
      createdAt: record.createdAt || (/* @__PURE__ */ new Date()).toISOString()
    });
  }
  function normalizeCategories(categories, defaultStoreId) {
    if (!Array.isArray(categories) || !categories.length) return [];
    return categories.map((category, index) => ({
      id: category.id || createId("category"),
      storeId: category.storeId || defaultStoreId,
      name: category.name || "\u672A\u5206\u7C7B",
      sort: Number(category.sort) || index + 1,
      createdAt: category.createdAt || (/* @__PURE__ */ new Date()).toISOString()
    }));
  }
  function normalizeProducts(products, defaultStoreId) {
    if (!Array.isArray(products) || !products.length) return [];
    return products.map((product, index) => ({
      id: product.id || createId("product"),
      storeId: product.storeId || defaultStoreId,
      name: product.name || "\u672A\u547D\u540D\u5546\u54C1",
      category: product.category || "\u672A\u5206\u7C7B",
      price: Number(product.price) || 0,
      description: product.description || "",
      image: product.image || "",
      active: product.active !== false,
      soldOut: Boolean(product.soldOut),
      deletedAt: product.deletedAt || "",
      sort: Number(product.sort) || index + 1,
      createdAt: product.createdAt || (/* @__PURE__ */ new Date()).toISOString(),
      updatedAt: product.updatedAt || product.createdAt || (/* @__PURE__ */ new Date()).toISOString()
    }));
  }
  function normalizeOrders(orders, defaultStoreId) {
    if (!Array.isArray(orders)) return [];
    return orders.map((order) => {
      var _a, _b;
      const items = Array.isArray(order.items) ? order.items : [];
      const normalizedItems = items.map((item) => ({
        productId: item.productId || "",
        name: item.name || "\u5546\u54C1",
        category: item.category || "",
        price: Number(item.price) || 0,
        quantity: Number(item.quantity) || 1,
        refundedQuantity: Number(item.refundedQuantity) || 0,
        refundAmount: Number(item.refundAmount) || 0,
        itemStatus: item.itemStatus || "normal"
      }));
      const totalAmount = Number(order.totalAmount) || normalizedItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
      return {
        id: order.id || createId("order"),
        orderNo: order.orderNo || createOrderNo(),
        storeId: order.storeId || defaultStoreId,
        customerName: order.customerName || "\u987E\u5BA2",
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
        pickupMode: order.pickupMode || (order.pickupTime && order.pickupTime !== "\u5C3D\u5FEB" ? "scheduled" : "now"),
        pickupDate: order.pickupDate || "",
        pickupTime: order.pickupTime || "",
        deliveryAddress: order.deliveryAddress || "",
        deliveryRecipientName: order.deliveryRecipientName || "",
        deliveryRecipientPhone: normalizePhone(order.deliveryRecipientPhone),
        deliveryDate: order.deliveryDate || "",
        deliveryTime: order.deliveryTime || "",
        deliveryLatitude: (_a = order.deliveryLatitude) != null ? _a : null,
        deliveryLongitude: (_b = order.deliveryLongitude) != null ? _b : null,
        deliveryDistanceKm: Number.isFinite(Number(order.deliveryDistanceKm)) ? Number(order.deliveryDistanceKm) : null,
        fulfillmentLabel: order.fulfillmentLabel || buildFulfillmentLabel(order),
        note: order.note || "",
        cancelReason: order.cancelReason || "",
        refundReason: order.refundReason || "",
        createdAt: order.createdAt || (/* @__PURE__ */ new Date()).toISOString(),
        updatedAt: order.updatedAt || order.createdAt || (/* @__PURE__ */ new Date()).toISOString()
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
      createdAt: refund.createdAt || (/* @__PURE__ */ new Date()).toISOString()
    }));
  }
  function recordTypeLabel(type) {
    const labels = {
      recharge: "\u5145\u503C",
      spend: "\u6D88\u8D39",
      refund: "\u9000\u6B3E",
      adjust: "\u8C03\u6574",
      order_payment: "\u8BA2\u5355\u652F\u4ED8",
      order_refund: "\u8BA2\u5355\u9000\u6B3E",
      order_cancel: "\u8BA2\u5355\u53D6\u6D88"
    };
    return labels[type] || "\u6D41\u6C34";
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
    const matched = [...state.settings.bonusRules].filter((rule) => value >= rule.minAmount).sort((a, b) => b.minAmount - a.minAmount)[0];
    return matched ? matched.bonusAmount : 0;
  }
  function getRecordDateRange() {
    return {
      start: els.recordStartDate.value ? /* @__PURE__ */ new Date(`${els.recordStartDate.value}T00:00:00`) : null,
      end: els.recordEndDate.value ? /* @__PURE__ */ new Date(`${els.recordEndDate.value}T23:59:59`) : null
    };
  }
  function isRecordInDateRange(record, range = getRecordDateRange()) {
    const createdAt = new Date(record.createdAt);
    if (range.start && createdAt < range.start) return false;
    if (range.end && createdAt > range.end) return false;
    return true;
  }
  function recordDateRangeLabel(range = getRecordDateRange()) {
    const start = range.start ? formatDateInputValue(range.start) : "\u4E0D\u9650";
    const end = range.end ? formatDateInputValue(range.end) : "\u4E0D\u9650";
    return `\u65E5\u671F\uFF1A${start} \u81F3 ${end}`;
  }
  function formatDateInputValue(value) {
    const date = value instanceof Date ? value : new Date(value);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  function recordSearchLabel() {
    return els.recordSearch.value.trim() || "\u4E0D\u9650";
  }
  function recordTypeFilterLabel() {
    return els.recordTypeFilter.value === "all" ? "\u5168\u90E8\u7C7B\u578B" : recordTypeLabel(els.recordTypeFilter.value);
  }
  function buildUnifiedTransactions() {
    const orderItemsText = (order) => ((order == null ? void 0 : order.items) || []).map((item) => `${item.name}\xD7${item.quantity}`).join("\uFF0C");
    const storedRecords = getStoreRecords();
    const existingOrderPaymentKeys = new Set(
      storedRecords.filter((record) => ["spend", "order_payment"].includes(record.type)).flatMap((record) => [
        record.orderId ? `id:${record.orderId}` : "",
        record.orderNo ? `no:${record.orderNo}` : ""
      ]).filter(Boolean)
    );
    const memberRecords = storedRecords.map((record) => {
      const member = getMember(record.memberId);
      return {
        id: `record_${record.id}`,
        source: "member_record",
        type: record.type,
        createdAt: record.createdAt,
        memberId: record.memberId,
        memberName: (member == null ? void 0 : member.name) || record.memberName || "\u5DF2\u5220\u9664\u4F1A\u5458",
        memberPhone: (member == null ? void 0 : member.phone) || record.memberPhone || "",
        memberCard: (member == null ? void 0 : member.card) || record.memberCard || "",
        amount: Number(record.amount) || 0,
        bonusAmount: Number(record.bonusAmount) || 0,
        balanceAfter: record.balanceAfter === null || record.balanceAfter === void 0 ? null : Number(record.balanceAfter),
        paymentMethod: record.paymentMethod || (record.type === "recharge" ? "member_balance" : ""),
        orderNo: record.orderNo || "",
        itemsText: record.itemsText || "",
        note: record.note || ""
      };
    });
    const orderPayments = getStoreOrders().filter((order) => Number(order.paidAmount || 0) > 0 && !existingOrderPaymentKeys.has(`id:${order.id}`) && !existingOrderPaymentKeys.has(`no:${order.orderNo}`)).map((order) => {
      var _a;
      const member = getMember(order.memberId);
      return {
        id: `order_payment_${order.id}`,
        source: "order",
        type: "order_payment",
        createdAt: order.createdAt,
        memberId: order.memberId || "",
        memberName: (member == null ? void 0 : member.name) || order.customerName || "\u987E\u5BA2",
        memberPhone: (member == null ? void 0 : member.phone) || order.customerPhone || "",
        memberCard: (member == null ? void 0 : member.card) || "",
        amount: Number(order.paidAmount || order.totalAmount || 0),
        bonusAmount: 0,
        balanceAfter: (_a = member == null ? void 0 : member.balance) != null ? _a : null,
        paymentMethod: order.paymentMethod || "",
        orderNo: order.orderNo,
        itemsText: orderItemsText(order),
        note: paymentMethodLabel(order.paymentMethod)
      };
    });
    const refundRows = state.refunds.filter((refund) => {
      var _a;
      return refund.storeId === ((_a = getCurrentStore()) == null ? void 0 : _a.id);
    }).map((refund) => {
      var _a;
      const order = getOrder(refund.orderId);
      const member = getMember(refund.memberId || (order == null ? void 0 : order.memberId));
      return {
        id: `refund_${refund.id}`,
        source: "refund",
        type: "order_refund",
        createdAt: refund.createdAt,
        memberId: refund.memberId || (order == null ? void 0 : order.memberId) || "",
        memberName: (member == null ? void 0 : member.name) || (order == null ? void 0 : order.customerName) || "\u987E\u5BA2",
        memberPhone: (member == null ? void 0 : member.phone) || (order == null ? void 0 : order.customerPhone) || "",
        memberCard: (member == null ? void 0 : member.card) || "",
        amount: Number(refund.amount) || 0,
        bonusAmount: 0,
        balanceAfter: (_a = member == null ? void 0 : member.balance) != null ? _a : null,
        paymentMethod: refund.method || (order == null ? void 0 : order.paymentMethod) || "",
        orderNo: (order == null ? void 0 : order.orderNo) || "",
        itemsText: orderItemsText(order),
        note: refund.reason || (order == null ? void 0 : order.refundReason) || ""
      };
    });
    const cancelledOrders = getStoreOrders().filter((order) => order.status === "cancelled").map((order) => {
      var _a;
      const member = getMember(order.memberId);
      return {
        id: `order_cancel_${order.id}`,
        source: "order",
        type: "order_cancel",
        createdAt: order.updatedAt || order.createdAt,
        memberId: order.memberId || "",
        memberName: (member == null ? void 0 : member.name) || order.customerName || "\u987E\u5BA2",
        memberPhone: (member == null ? void 0 : member.phone) || order.customerPhone || "",
        memberCard: (member == null ? void 0 : member.card) || "",
        amount: 0,
        bonusAmount: 0,
        balanceAfter: (_a = member == null ? void 0 : member.balance) != null ? _a : null,
        paymentMethod: order.paymentMethod || "",
        orderNo: order.orderNo,
        itemsText: orderItemsText(order),
        note: order.cancelReason || "\u8BA2\u5355\u53D6\u6D88"
      };
    });
    return [...memberRecords, ...orderPayments, ...refundRows, ...cancelledOrders];
  }
  function getFilteredRecords() {
    const keyword = els.recordSearch.value.trim().toLowerCase();
    const type = els.recordTypeFilter.value;
    return buildUnifiedTransactions().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).filter((record) => {
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
    return `\xA5${Number(value || 0).toFixed(2)}`;
  }
  function formatTime(value) {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(value));
  }
  function formatFullTime(value) {
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }).format(new Date(value));
  }
  function isToday(value) {
    const date = new Date(value);
    const now = /* @__PURE__ */ new Date();
    return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  }
  function getCurrentStore() {
    return state.stores.find((store) => {
      var _a;
      return store.id === ((_a = state.session) == null ? void 0 : _a.storeId);
    }) || state.stores[0];
  }
  function getCurrentStaff() {
    return state.staff.find((staffer) => {
      var _a;
      return staffer.id === ((_a = state.session) == null ? void 0 : _a.staffId);
    }) || null;
  }
  function currentStaffIsManager() {
    var _a;
    return ((_a = getCurrentStaff()) == null ? void 0 : _a.role) === "manager";
  }
  function getStoreMembers() {
    var _a;
    const storeId = ((_a = getCurrentStore()) == null ? void 0 : _a.id) || PRIMARY_STORE_ID;
    return Array.from(
      new Map(
        state.members.filter((member) => member.storeId === storeId).map((member) => [member.id, member])
      ).values()
    );
  }
  function getStoreRecords() {
    var _a;
    const storeId = ((_a = getCurrentStore()) == null ? void 0 : _a.id) || PRIMARY_STORE_ID;
    return state.records.filter((record) => record.storeId === storeId);
  }
  function getStoreStaff() {
    var _a;
    const storeId = (_a = getCurrentStore()) == null ? void 0 : _a.id;
    return state.staff.filter((staffer) => staffer.storeId === storeId);
  }
  function getStoreProducts() {
    var _a;
    const storeId = ((_a = getCurrentStore()) == null ? void 0 : _a.id) || PRIMARY_STORE_ID;
    return state.products.filter((product) => product.storeId === storeId && !product.deletedAt);
  }
  function getStoreOrders() {
    var _a;
    const storeId = ((_a = getCurrentStore()) == null ? void 0 : _a.id) || PRIMARY_STORE_ID;
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
    var _a;
    const storeId = ((_a = getCurrentStore()) == null ? void 0 : _a.id) || PRIMARY_STORE_ID;
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
      els.orderSoundStatus.textContent = "\u58F0\u97F3\u63D0\u9192\u5DF2\u5173\u95ED";
    } else if (orderAudioUnlocked) {
      els.orderSoundStatus.textContent = "\u58F0\u97F3\u63D0\u9192\u5DF2\u5F00\u542F";
    } else {
      els.orderSoundStatus.textContent = "\u58F0\u97F3\u63D0\u9192\u9ED8\u8BA4\u5F00\u542F\uFF0C\u767B\u5F55\u6216\u70B9\u51FB\u9875\u9762\u540E\u5373\u53EF\u64AD\u653E";
    }
  }
  async function unlockOrderAudio() {
    if (!orderSoundEnabled) return false;
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        renderOrderSoundSetting("\u5F53\u524D\u6D4F\u89C8\u5668\u4E0D\u652F\u6301\u58F0\u97F3\u63D0\u9192");
        return false;
      }
      if (!orderAudioContext) orderAudioContext = new AudioContextClass();
      if (orderAudioContext.state === "suspended") await orderAudioContext.resume();
      orderAudioUnlocked = orderAudioContext.state === "running";
      renderOrderSoundSetting();
      return orderAudioUnlocked;
    } catch (error) {
      console.warn("[Order alert audio]", error);
      renderOrderSoundSetting("\u6D4F\u89C8\u5668\u963B\u6B62\u4E86\u58F0\u97F3\uFF0C\u8BF7\u70B9\u51FB\u201C\u8BD5\u542C\u63D0\u793A\u97F3\u201D\u5F00\u542F");
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
      gain.gain.setValueAtTime(1e-4, toneStart);
      gain.gain.exponentialRampToValueAtTime(0.22, toneStart + 0.02);
      gain.gain.exponentialRampToValueAtTime(1e-4, toneStart + 0.14);
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
      document.title = titleFlashStep % 2 ? ORIGINAL_PAGE_TITLE : `\u{1F514} ${orderCount} \u4E2A\u65B0\u8BA2\u5355`;
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
        played ? `\u6536\u5230 ${newPendingOrders.length} \u4E2A\u65B0\u8BA2\u5355\uFF0C\u5DF2\u64AD\u653E\u63D0\u9192` : orderSoundEnabled ? `\u6536\u5230 ${newPendingOrders.length} \u4E2A\u65B0\u8BA2\u5355\uFF0C\u8BF7\u70B9\u51FB\u9875\u9762\u5F00\u542F\u58F0\u97F3` : `\u6536\u5230 ${newPendingOrders.length} \u4E2A\u65B0\u8BA2\u5355\uFF0C\u58F0\u97F3\u63D0\u9192\u5DF2\u5173\u95ED`
      );
      return;
    }
    if (pendingOrders.length && now - lastPendingReminderAt >= ORDER_REMINDER_INTERVAL_MS) {
      playOrderTone();
      flashOrderTitle(pendingOrders.length);
      lastPendingReminderAt = now;
      renderOrderSoundSetting(`\u4ECD\u6709 ${pendingOrders.length} \u4E2A\u8BA2\u5355\u5F85\u63A5\u5355`);
    }
  }
  function startLocalRefresh() {
    if (!state.localApi.ready && !state.cloud.ready || localRefreshTimer) return;
    localRefreshTimer = setInterval(async () => {
      if (!["orders", "dashboard", "members", "records", "products", "settings"].includes(state.activeView)) return;
      if (remoteRefreshInFlight || cloudSaveTimer || cloudSaveInFlight || state.cloud.booting) return;
      remoteRefreshInFlight = true;
      const refreshRevision = localDataRevision;
      try {
        const result = state.localApi.ready ? await callLocalApi("GET") : await callCloud("getStoreData");
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
    els.currentStoreName.textContent = (store == null ? void 0 : store.name) || "\u672A\u9009\u62E9\u95E8\u5E97";
    els.currentStaffName.textContent = staffer ? `${staffer.name} \xB7 ${staffer.role === "manager" ? "\u5E97\u957F" : "\u5E97\u5458"}` : "\u672A\u767B\u5F55";
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
    const todayRecharge = todayRecords.filter((record) => record.type === "recharge").reduce((sum, record) => sum + record.amount, 0);
    const todaySpend = todayRecords.filter((record) => record.type === "spend").reduce((sum, record) => sum + record.amount, 0);
    const todayRefund = todayRecords.filter((record) => record.type === "refund").reduce((sum, record) => sum + record.amount, 0);
    const todayOrderAmount = todayOrders.filter((order) => !["cancelled", "refunded"].includes(order.status)).reduce((sum, order) => sum + order.totalAmount - (order.refundAmount || 0), 0);
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
    const recent = buildUnifiedTransactions().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 6);
    if (!recent.length) {
      els.recentRecords.className = "record-list empty-state";
      els.recentRecords.textContent = "\u6682\u65E0\u8BB0\u5F55";
    } else {
      els.recentRecords.className = "record-list";
      els.recentRecords.innerHTML = recent.map(recordTemplate).join("");
    }
    const waitingOrders = storeOrders.filter((order) => ["pending", "making", "ready", "delivering"].includes(order.status)).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)).slice(0, 4);
    if (!waitingOrders.length) {
      els.dashboardOrders.className = "order-list empty-state";
      els.dashboardOrders.textContent = "\u6682\u65E0\u5F85\u5904\u7406\u8BA2\u5355";
      return;
    }
    els.dashboardOrders.className = "order-list compact-order-list";
    els.dashboardOrders.innerHTML = waitingOrders.map(orderTemplate).join("");
  }
  function renderQuickMembers() {
    const storeMembers = getStoreMembers();
    if (!storeMembers.length) {
      els.quickMember.innerHTML = '<option value="">\u8BF7\u5148\u65B0\u589E\u4F1A\u5458</option>';
      els.quickMember.disabled = true;
      return;
    }
    els.quickMember.disabled = false;
    els.quickMember.innerHTML = storeMembers.map(
      (member) => `<option value="${member.id}">${escapeHtml(member.name)} - ${escapeHtml(member.card)} - ${money(member.balance)}</option>`
    ).join("");
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
      els.memberList.textContent = storeMembers.length ? "\u6CA1\u6709\u5339\u914D\u7684\u4F1A\u5458" : "\u6682\u65E0\u4F1A\u5458";
      return;
    }
    els.memberList.className = "member-list";
    els.memberList.innerHTML = members.map(
      (member) => `
        <article class="member-card">
          <header>
            <div>
              <h3>${escapeHtml(member.name)}</h3>
              <p>${escapeHtml(member.phone)} \xB7 ${escapeHtml(member.card)}</p>
            </div>
            <div class="balance">${money(member.balance)}</div>
          </header>
          <p>${escapeHtml(member.note || "\u6682\u65E0\u5907\u6CE8")}</p>
          <div class="card-actions">
            <button class="mini-button" data-action="recharge" data-id="${member.id}" type="button">\u5145\u503C</button>
            <button class="mini-button" data-action="spend" data-id="${member.id}" type="button">\u6D88\u8D39</button>
            <button class="mini-button" data-action="edit" data-id="${member.id}" type="button">\u7F16\u8F91</button>
            <button class="mini-button" data-action="print-member" data-id="${member.id}" type="button">\u6253\u5370\u8BB0\u5F55</button>
          </div>
        </article>
      `
    ).join("");
  }
  function orderStatusLabel(status) {
    const labels = {
      pending_payment: "\u5F85\u652F\u4ED8",
      pending: "\u5F85\u63A5\u5355",
      making: "\u5236\u4F5C\u4E2D",
      ready: "\u5F85\u53D6\u9910",
      delivering: "\u914D\u9001\u4E2D",
      completed: "\u5DF2\u5B8C\u6210",
      cancelled: "\u5DF2\u53D6\u6D88",
      refunded: "\u5DF2\u9000\u6B3E",
      partial_refund: "\u90E8\u5206\u9000\u6B3E"
    };
    return labels[status] || "\u672A\u77E5";
  }
  function paymentMethodLabel(method) {
    const labels = {
      wechat_pay: "\u5FAE\u4FE1\u652F\u4ED8",
      alipay_pay: "\u652F\u4ED8\u5B9D",
      member_balance: "\u4F1A\u5458\u4F59\u989D\u652F\u4ED8",
      store_pay: "\u5230\u5E97\u652F\u4ED8",
      cash: "\u73B0\u91D1",
      wechat: "\u5FAE\u4FE1\u652F\u4ED8"
    };
    return labels[method] || "\u624B\u52A8\u8BB0\u5F55";
  }
  function buildFulfillmentLabel(order) {
    if (order.fulfillmentLabel) return order.fulfillmentLabel;
    if (order.fulfillmentType === "delivery") {
      const when = [order.deliveryDate, order.deliveryTime].filter(Boolean).join(" ");
      return `\u914D\u9001${when ? ` \xB7 ${when}` : ""}`;
    }
    if (order.pickupMode === "scheduled") {
      const when = [order.pickupDate, order.pickupTime].filter(Boolean).join(" ");
      return `\u5230\u5E97\u53D6\u9910${when ? ` \xB7 ${when}` : ""}`;
    }
    return `\u5230\u5E97\u53D6\u9910 \xB7 ${order.pickupTime && order.pickupTime !== "\u5C3D\u5FEB" ? order.pickupTime : "\u5373\u65F6\u53D6\u9910"}`;
  }
  function fulfillmentDetail(order) {
    if (order.fulfillmentType !== "delivery") return "";
    return order.deliveryAddress ? `\u914D\u9001\u5730\u5740\uFF1A${order.deliveryAddress}` : "";
  }
  function getFilteredOrders() {
    const keyword = els.orderSearch.value.trim().toLowerCase();
    const status = els.orderStatusFilter.value;
    return [...getStoreOrders()].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).filter((order) => {
      const itemText = order.items.map((item) => item.name).join(" ");
      const member = getMember(order.memberId);
      const text = `${order.orderNo} ${order.customerName} ${order.customerPhone} ${(member == null ? void 0 : member.name) || ""} ${(member == null ? void 0 : member.phone) || ""} ${(member == null ? void 0 : member.card) || ""} ${itemText}`.toLowerCase();
      return (status === "all" || order.status === status) && text.includes(keyword);
    });
  }
  function renderOrders() {
    const orders = getFilteredOrders();
    if (!orders.length) {
      els.orderList.className = "order-list empty-state";
      els.orderList.textContent = getStoreOrders().length ? "\u6CA1\u6709\u5339\u914D\u7684\u8BA2\u5355" : "\u6682\u65E0\u8BA2\u5355";
      return;
    }
    els.orderList.className = "order-list";
    els.orderList.innerHTML = orders.map(orderTemplate).join("");
  }
  function orderTemplate(order) {
    const member = getMember(order.memberId);
    const customerLabel = member ? `${member.name} \xB7 ${member.card} \xB7 ${member.phone}` : `${order.customerName} \xB7 ${order.customerPhone || order.customerOpenid || "\u5FAE\u4FE1\u987E\u5BA2"}`;
    const netAmount = order.totalAmount - (order.refundAmount || 0);
    const canRefund = order.paymentStatus === "paid" && !["cancelled", "refunded"].includes(order.status) && netAmount > 0;
    const nextActions = {
      pending: [["making", "\u63A5\u5355\u5236\u4F5C"], ["cancelled", "\u53D6\u6D88\u8BA2\u5355"]],
      making: order.fulfillmentType === "delivery" ? [["delivering", "\u5F00\u59CB\u914D\u9001"], ["cancelled", "\u53D6\u6D88\u8BA2\u5355"]] : [["ready", "\u6807\u8BB0\u5F85\u53D6"], ["cancelled", "\u53D6\u6D88\u8BA2\u5355"]],
      ready: [["completed", "\u5B8C\u6210\u53D6\u9910"]],
      delivering: [["completed", "\u786E\u8BA4\u9001\u8FBE"]]
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
        <span>${member ? "\u4F1A\u5458\u4E0B\u5355" : "\u975E\u4F1A\u5458\u4E0B\u5355"}</span>
        <span>${escapeHtml(buildFulfillmentLabel(order))}</span>
        <span>${paymentMethodLabel(order.paymentMethod)} \xB7 ${order.paymentStatus === "paid" ? "\u5DF2\u652F\u4ED8" : "\u672A\u652F\u4ED8"}</span>
      </div>
      <div class="order-items">
        ${order.items.map(
      (item) => `
              <div>
                <span>${escapeHtml(item.name)} \xD7 ${item.quantity}</span>
                <strong>${money(item.price * item.quantity)}</strong>
              </div>
            `
    ).join("")}
        ${order.fulfillmentType === "delivery" ? `<div><span>\u914D\u9001\u8D39${order.deliveryFeeWaived ? "\uFF08\u6EE1\u989D\u51CF\u514D\uFF09" : ""}</span><strong>${money(order.deliveryFee)}</strong></div>` : ""}
      </div>
      ${fulfillmentDetail(order) ? `<p class="order-note">${escapeHtml(fulfillmentDetail(order))}</p>` : ""}
      ${order.note ? `<p class="order-note">${escapeHtml(order.note)}</p>` : ""}
      <footer>
        <div class="order-total">
          <span>\u5408\u8BA1 ${money(order.totalAmount)}</span>
          ${order.refundAmount ? `<span>\u5DF2\u9000 ${money(order.refundAmount)}</span>` : ""}
          <strong>\u5B9E\u6536 ${money(netAmount)}</strong>
        </div>
        <div class="card-actions inline-actions">
          ${nextActions.map(
      ([status, label]) => `<button class="mini-button" data-order-status="${status}" data-id="${order.id}" type="button">${label}</button>`
    ).join("")}
          <button class="mini-button" data-order-print="${order.id}" type="button">\u6253\u5370\u5C0F\u7968</button>
          ${canRefund ? `<button class="mini-button danger-button" data-order-refund="${order.id}" type="button">\u9000\u6B3E/\u9000\u8D27</button>` : ""}
        </div>
      </footer>
    </article>
  `;
  }
  function renderProducts() {
    const keyword = els.productSearch.value.trim().toLowerCase();
    const products = getStoreProducts().filter((product) => `${product.name} ${product.category}`.toLowerCase().includes(keyword)).sort((a, b) => String(a.category).localeCompare(String(b.category), "zh-CN") || a.sort - b.sort);
    if (!products.length) {
      els.productList.className = "product-list empty-state";
      els.productList.textContent = getStoreProducts().length ? "\u6CA1\u6709\u5339\u914D\u7684\u5546\u54C1" : "\u6682\u65E0\u5546\u54C1";
      return;
    }
    els.productList.className = "product-list";
    els.productList.innerHTML = products.map(
      (product) => `
        <article class="product-card">
          <div class="product-thumb">${product.image ? `<img src="${escapeHtml(product.image)}" alt="">` : escapeHtml(product.name.slice(0, 1))}</div>
          <div>
            <h3>${escapeHtml(product.name)}</h3>
            <p>${escapeHtml(product.category)} \xB7 ${escapeHtml(product.description || "\u6682\u65E0\u63CF\u8FF0")}</p>
            <strong>${money(product.price)}</strong>
          </div>
          <div class="card-actions product-actions">
            <button class="mini-button" data-product-edit="${product.id}" type="button">\u7F16\u8F91</button>
            <button class="mini-button" data-product-toggle="${product.id}" type="button">${product.active ? "\u4E0B\u67B6" : "\u4E0A\u67B6"}</button>
            <button class="mini-button" data-product-soldout="${product.id}" type="button">${product.soldOut ? "\u6062\u590D" : "\u552E\u7F44"}</button>
            <button class="mini-button danger-button" data-product-delete="${product.id}" type="button">\u5220\u9664</button>
          </div>
        </article>
      `
    ).join("");
  }
  function renderRecords() {
    const records = getFilteredRecords();
    if (!records.length) {
      els.recordTable.innerHTML = `
      <tr>
        <td colspan="8" class="empty-state">\u6682\u65E0\u6D41\u6C34</td>
      </tr>
    `;
      return;
    }
    els.recordTable.innerHTML = records.map((record) => {
      const amountText = recordAmountText(record);
      const memberText = [record.memberName, record.memberPhone || record.memberCard].filter(Boolean).join(" \xB7 ");
      const balanceText = record.balanceAfter === null || record.balanceAfter === void 0 ? "-" : money(record.balanceAfter);
      const noteParts = [
        record.orderNo ? `\u8BA2\u5355 ${record.orderNo}` : "",
        record.paymentMethod ? paymentMethodLabel(record.paymentMethod) : "",
        record.note || ""
      ].filter(Boolean);
      return `
        <tr>
          <td>${formatTime(record.createdAt)}</td>
          <td>${escapeHtml(memberText || "\u987E\u5BA2")}</td>
          <td>${recordTypeLabel(record.type)}</td>
          <td>${escapeHtml(record.itemsText || "-")}</td>
          <td class="record-amount ${record.type}">${amountText}</td>
          <td class="record-amount recharge">${recordBonusText(record)}</td>
          <td>${balanceText}</td>
          <td>${escapeHtml(noteParts.join("\uFF1B") || "-")}</td>
        </tr>
      `;
    }).join("");
  }
  function recordTemplate(record) {
    const amountText = recordAmountText(record);
    const balanceText = record.balanceAfter === null || record.balanceAfter === void 0 ? "" : ` \xB7 \u4F59\u989D ${money(record.balanceAfter)}`;
    return `
    <article class="record-item">
      <div>
        <strong>${escapeHtml(record.memberName || "\u987E\u5BA2")} \xB7 ${recordTypeLabel(record.type)}</strong>
        <span>${formatTime(record.createdAt)}${balanceText}${record.orderNo ? ` \xB7 ${escapeHtml(record.orderNo)}` : ""}</span>
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
      els.bonusRuleList.textContent = "\u6682\u65E0\u8D60\u9001\u89C4\u5219";
      return;
    }
    els.bonusRuleList.className = "rule-list";
    els.bonusRuleList.innerHTML = rules.map(
      (rule) => `
        <article class="rule-item">
          <strong>\u5145\u503C\u6EE1 ${money(rule.minAmount)} \u8D60\u9001 ${money(rule.bonusAmount)}</strong>
          <button class="mini-button danger-button" data-delete-rule="${rule.id}" type="button">\u5220\u9664</button>
        </article>
      `
    ).join("");
  }
  function renderDeliverySettings() {
    var _a, _b;
    const delivery = state.settings.delivery;
    els.deliveryFee.value = delivery.fee;
    els.freeDeliveryThreshold.value = delivery.freeThreshold;
    els.storeLatitude.value = (_a = delivery.storeLatitude) != null ? _a : "";
    els.storeLongitude.value = (_b = delivery.storeLongitude) != null ? _b : "";
    els.deliveryTestMode.checked = delivery.testMode;
    updateStoreLocationVerification();
    els.deliverySettingsStatus.textContent = delivery.storeLatitude === null || delivery.storeLongitude === null ? "\u8BF7\u586B\u5199\u95E8\u5E97\u7ECF\u7EAC\u5EA6\uFF0C\u4FDD\u5B58\u540E\u987E\u5BA2\u624D\u80FD\u901A\u8FC7 3 \u516C\u91CC\u914D\u9001\u8303\u56F4\u6821\u9A8C\u3002" : `${delivery.testMode ? "\u26A0 \u5F53\u524D\u4E3A\u4E34\u65F6\u6D4B\u8BD5\u6A21\u5F0F\uFF1B" : ""}\u5F53\u524D\u89C4\u5219\uFF1A3 \u516C\u91CC\u5185\u914D\u9001\uFF0C\u914D\u9001\u8D39 ${money(delivery.fee)}\uFF0C\u5546\u54C1\u6EE1 ${money(delivery.freeThreshold)} \u514D\u914D\u9001\u8D39\u3002`;
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
      els.verifyStoreLocation.href = `https://uri.amap.com/marker?position=${longitude},${latitude}&name=${encodeURIComponent("\u7231\u5A03\u62AB\u8428\u5E97\uFF08\u5F85\u6838\u5BF9\uFF09")}`;
    }
  }
  function captureDeliverySettingsDraft() {
    state.settings.delivery = normalizeSettings({ delivery: {
      fee: els.deliveryFee.value,
      freeThreshold: els.freeDeliveryThreshold.value,
      storeLatitude: els.storeLatitude.value,
      storeLongitude: els.storeLongitude.value,
      testMode: els.deliveryTestMode.checked
    } }).delivery;
    deliverySettingsDirty = true;
    updateStoreLocationVerification();
  }
  function renderStaff() {
    const staff = getStoreStaff();
    if (!staff.length) {
      els.staffList.className = "rule-list empty-state";
      els.staffList.textContent = "\u6682\u65E0\u5E97\u5458";
      return;
    }
    els.staffList.className = "rule-list";
    els.staffList.innerHTML = staff.map(
      (staffer) => `
        <article class="rule-item">
          <div>
            <strong>${escapeHtml(staffer.name)} \xB7 ${staffer.role === "manager" ? "\u5E97\u957F" : "\u5E97\u5458"}</strong>
            <span>${escapeHtml(staffer.phone)} \xB7 ${staffer.active ? "\u53EF\u767B\u5F55" : "\u5DF2\u505C\u7528"}</span>
          </div>
          <button class="mini-button ${staffer.active ? "danger-button" : ""}" data-toggle-staff="${staffer.id}" type="button">
            ${staffer.active ? "\u505C\u7528" : "\u542F\u7528"}
          </button>
        </article>
      `
    ).join("");
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
    els.sendCode.textContent = "\u83B7\u53D6\u9A8C\u8BC1\u7801";
  }
  function startLoginCodeCountdown(seconds = 60) {
    if (loginCodeCountdownTimer) clearInterval(loginCodeCountdownTimer);
    let remaining = seconds;
    els.sendCode.disabled = true;
    els.sendCode.textContent = `${remaining} \u79D2\u540E\u91CD\u8BD5`;
    loginCodeCountdownTimer = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        resetSendCodeButton();
        return;
      }
      els.sendCode.textContent = `${remaining} \u79D2\u540E\u91CD\u8BD5`;
    }, 1e3);
  }
  function ensureSession() {
    const staffer = getCurrentStaff();
    const store = getCurrentStore();
    if ((staffer == null ? void 0 : staffer.active) && store) {
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
      setLoginHint("\u8BF7\u8F93\u5165\u6B63\u786E\u7684 11 \u4F4D\u624B\u673A\u53F7\u540E\u518D\u83B7\u53D6\u9A8C\u8BC1\u7801\u3002", "error");
      els.loginPhone.focus();
      return;
    }
    els.sendCode.disabled = true;
    els.sendCode.textContent = "\u53D1\u9001\u4E2D\u2026";
    els.sendCode.setAttribute("aria-busy", "true");
    setLoginHint("\u6B63\u5728\u53D1\u9001\u9A8C\u8BC1\u7801\uFF0C\u8BF7\u7A0D\u5019\u2026", "loading");
    if (state.cloud.ready) {
      try {
        const result = await callCloud("sendLoginCode", { phone });
        setLoginHint(result.message || "\u9A8C\u8BC1\u7801\u5DF2\u53D1\u9001\uFF0C\u8BF7\u67E5\u770B\u624B\u673A\u77ED\u4FE1\u3002", "success");
        startLoginCodeCountdown(60);
        els.loginCode.focus();
        return;
      } catch (error) {
        setLoginHint(error.message || "\u4E91\u7AEF\u9A8C\u8BC1\u7801\u53D1\u9001\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002", "error");
        console.warn("[CloudBase login]", error);
        resetSendCodeButton();
        return;
      } finally {
        els.sendCode.removeAttribute("aria-busy");
      }
    }
    if (cloudConfig.enabled) {
      setLoginHint(`\u9A8C\u8BC1\u7801\u53D1\u9001\u5931\u8D25\uFF1A\u4E91\u7AEF\u670D\u52A1\u672A\u8FDE\u63A5\u3002${state.cloud.message}`, "error");
      resetSendCodeButton();
      els.sendCode.removeAttribute("aria-busy");
      return;
    }
    const staffer = state.staff.find((item) => item.phone === phone && item.active);
    if (!staffer) {
      setLoginHint("\u8FD9\u4E2A\u624B\u673A\u53F7\u8FD8\u6CA1\u6709\u5F55\u5165\u4E3A\u5E97\u5458\uFF0C\u8BF7\u5148\u8BA9\u5E97\u957F\u6DFB\u52A0\u3002", "error");
      resetSendCodeButton();
      els.sendCode.removeAttribute("aria-busy");
      return;
    }
    setLoginHint("\u5F53\u524D\u4E3A\u672C\u5730\u79BB\u7EBF\u6A21\u5F0F\uFF0C\u4E0D\u80FD\u53D1\u9001\u771F\u5B9E\u77ED\u4FE1\u3002", "error");
    resetSendCodeButton();
    els.sendCode.removeAttribute("aria-busy");
  }
  async function loginWithCode() {
    const phone = normalizePhone(els.loginPhone.value);
    const code = els.loginCode.value.trim();
    if (!/^1\d{10}$/.test(phone) || !code) {
      setLoginHint("\u8BF7\u8F93\u5165\u6B63\u786E\u7684\u624B\u673A\u53F7\u548C\u77ED\u4FE1\u9A8C\u8BC1\u7801\u3002", "error");
      return;
    }
    els.loginSubmit.disabled = true;
    els.loginSubmit.textContent = "\u767B\u5F55\u4E2D\u2026";
    els.loginSubmit.setAttribute("aria-busy", "true");
    setLoginHint("\u6B63\u5728\u9A8C\u8BC1\uFF0C\u8BF7\u7A0D\u5019\u2026", "loading");
    if (state.cloud.ready) {
      try {
        const result = await callCloud("verifyLoginCode", { phone, code });
        state.session = normalizeSession(__spreadProps(__spreadValues({}, result.session), { authVersion: CLOUD_SESSION_VERSION }));
        saveState({ sync: false });
        showApp();
        syncFromCloud().then(() => render()).catch((error) => console.warn("[CloudBase post-login sync]", error));
        return;
      } catch (error) {
        setLoginHint(error.message || "\u4E91\u7AEF\u767B\u5F55\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002", "error");
        console.warn("[CloudBase login]", error);
        return;
      } finally {
        els.loginSubmit.disabled = false;
        els.loginSubmit.textContent = "\u767B\u5F55";
        els.loginSubmit.removeAttribute("aria-busy");
      }
    }
    if (cloudConfig.enabled) {
      setLoginHint(`\u4E91\u7AEF\u670D\u52A1\u672A\u8FDE\u63A5\uFF0C\u65E0\u6CD5\u767B\u5F55\u3002${state.cloud.message}`, "error");
      els.loginSubmit.disabled = false;
      els.loginSubmit.textContent = "\u767B\u5F55";
      els.loginSubmit.removeAttribute("aria-busy");
      return;
    }
    const staffer = state.staff.find((item) => item.phone === phone && item.active);
    if (!staffer) {
      setLoginHint("\u8FD9\u4E2A\u624B\u673A\u53F7\u8FD8\u6CA1\u6709\u5F55\u5165\u4E3A\u5E97\u5458\uFF0C\u65E0\u6CD5\u767B\u5F55\u3002", "error");
      els.loginSubmit.disabled = false;
      els.loginSubmit.textContent = "\u767B\u5F55";
      els.loginSubmit.removeAttribute("aria-busy");
      return;
    }
    setLoginHint("\u5F53\u524D\u4E3A\u672C\u5730\u79BB\u7EBF\u6A21\u5F0F\uFF0C\u4E0D\u80FD\u4F7F\u7528\u77ED\u4FE1\u9A8C\u8BC1\u7801\u767B\u5F55\u3002", "error");
    els.loginSubmit.disabled = false;
    els.loginSubmit.textContent = "\u767B\u5F55";
    els.loginSubmit.removeAttribute("aria-busy");
  }
  function switchView(view) {
    state.activeView = view;
    render();
  }
  function openMemberDialog(member) {
    els.memberDialogTitle.textContent = member ? "\u7F16\u8F91\u4F1A\u5458" : "\u65B0\u589E\u4F1A\u5458";
    els.memberId.value = (member == null ? void 0 : member.id) || "";
    els.memberName.value = (member == null ? void 0 : member.name) || "";
    els.memberPhone.value = (member == null ? void 0 : member.phone) || "";
    els.memberCard.value = (member == null ? void 0 : member.card) || "";
    els.memberBalance.value = member ? member.balance : 0;
    els.memberNote.value = (member == null ? void 0 : member.note) || "";
    els.memberDialog.showModal();
  }
  function saveMemberFromForm() {
    var _a;
    const id = els.memberId.value;
    const name = els.memberName.value.trim();
    const phone = normalizePhone(els.memberPhone.value);
    const card = els.memberCard.value.trim();
    const balance = Number(els.memberBalance.value || 0);
    const note = els.memberNote.value.trim();
    if (!name || !/^1\d{10}$/.test(phone)) {
      alert("\u8BF7\u586B\u5199\u59D3\u540D\u548C\u6B63\u786E\u7684 11 \u4F4D\u624B\u673A\u53F7");
      return;
    }
    const duplicate = state.members.find(
      (member) => {
        var _a2;
        return member.id !== id && member.storeId === ((_a2 = getCurrentStore()) == null ? void 0 : _a2.id) && normalizePhone(member.phone) === phone;
      }
    );
    if (duplicate) {
      alert(`\u8BE5\u624B\u673A\u53F7\u5DF2\u6CE8\u518C\u4F1A\u5458\u201C${duplicate.name}\u201D\uFF0C\u6BCF\u4E2A\u624B\u673A\u53F7\u53EA\u80FD\u6CE8\u518C\u4E00\u6B21`);
      els.memberPhone.focus();
      return;
    }
    if (balance < 0) {
      alert("\u521D\u59CB\u4F59\u989D\u4E0D\u80FD\u5C0F\u4E8E 0");
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
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      });
      if (previousBalance !== balance) {
        state.records.push(createRecord(id, "adjust", balance - previousBalance, balance, "\u624B\u52A8\u8C03\u6574\u4F59\u989D"));
      }
    } else {
      const member = createMember(name, phone, card, balance, note, (_a = getCurrentStore()) == null ? void 0 : _a.id);
      state.members.push(member);
      if (balance > 0) {
        state.records.push(createRecord(member.id, "recharge", balance, balance, "\u5F00\u5361\u521D\u59CB\u4F59\u989D"));
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
      alert("\u8BF7\u9009\u62E9\u4F1A\u5458");
      return false;
    }
    if (!Number.isFinite(value) || value <= 0) {
      alert("\u8BF7\u8F93\u5165\u5927\u4E8E 0 \u7684\u91D1\u989D");
      return false;
    }
    if (type === "spend" && member.balance < value) {
      alert("\u4F59\u989D\u4E0D\u8DB3\uFF0C\u65E0\u6CD5\u6D88\u8D39");
      return false;
    }
    const bonusAmount = type === "recharge" ? getRechargeBonus(value) : 0;
    const balanceChange = type === "recharge" || type === "refund" ? value + bonusAmount : -value;
    member.balance += balanceChange;
    member.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    const finalNote = type === "recharge" && bonusAmount > 0 ? `${note || "\u5145\u503C"}\uFF0C\u8D60\u9001 ${money(bonusAmount)}` : note;
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
      els.productImagePreview.innerHTML = "<span>\u6682\u65E0\u56FE\u7247</span>";
      return;
    }
    els.productImagePreview.classList.remove("empty-image");
    els.productImagePreview.innerHTML = `<img src="${escapeHtml(image)}" alt="\u5546\u54C1\u56FE\u7247\u9884\u89C8">`;
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
      throw new Error("\u8BF7\u9009\u62E9\u56FE\u7247\u6587\u4EF6");
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
      alert(error.message || "\u56FE\u7247\u8BFB\u53D6\u5931\u8D25\uFF0C\u8BF7\u6362\u4E00\u5F20\u56FE\u7247");
    } finally {
      event.target.value = "";
    }
  }
  function openProductDialog(product) {
    els.productDialogTitle.textContent = product ? "\u7F16\u8F91\u5546\u54C1" : "\u65B0\u589E\u5546\u54C1";
    els.productId.value = (product == null ? void 0 : product.id) || "";
    els.productName.value = (product == null ? void 0 : product.name) || "";
    els.productCategory.value = (product == null ? void 0 : product.category) || "";
    els.productPrice.value = product ? product.price : "";
    els.productImage.value = (product == null ? void 0 : product.image) || "";
    renderProductImagePreview();
    els.productDescription.value = (product == null ? void 0 : product.description) || "";
    els.productActive.checked = product ? product.active !== false : true;
    els.productDialog.showModal();
  }
  function saveProductFromForm() {
    var _a, _b;
    const id = els.productId.value;
    const name = els.productName.value.trim();
    const category = els.productCategory.value.trim();
    const price = Number(els.productPrice.value);
    const image = els.productImage.value.trim();
    const description = els.productDescription.value.trim();
    const active = els.productActive.checked;
    if (!name || !category || !Number.isFinite(price) || price <= 0) {
      alert("\u8BF7\u586B\u5199\u5546\u54C1\u540D\u79F0\u3001\u5206\u7C7B\u548C\u6B63\u786E\u4EF7\u683C");
      return;
    }
    const existingCategory = state.categories.find(
      (item) => {
        var _a2;
        return item.storeId === ((_a2 = getCurrentStore()) == null ? void 0 : _a2.id) && item.name === category;
      }
    );
    if (!existingCategory) {
      state.categories.push(createCategory(category, (_a = getCurrentStore()) == null ? void 0 : _a.id));
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
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
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
          storeId: (_b = getCurrentStore()) == null ? void 0 : _b.id
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
      const reason = prompt("\u8BF7\u8F93\u5165\u53D6\u6D88\u539F\u56E0\uFF0C\u4F8B\u5982 \u987E\u5BA2\u53D6\u6D88\u3001\u7F3A\u8D27\u3001\u91CD\u590D\u4E0B\u5355");
      if (reason === null) return;
      order.cancelReason = reason.trim() || "\u540E\u53F0\u53D6\u6D88\u8BA2\u5355";
    }
    if (status === "delivering" && order.fulfillmentType !== "delivery") return;
    if (status === "delivering") order.dispatchedAt = (/* @__PURE__ */ new Date()).toISOString();
    if (status === "completed" && order.fulfillmentType === "delivery") {
      order.deliveredAt = (/* @__PURE__ */ new Date()).toISOString();
    }
    order.status = status;
    order.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
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
    els.refundMethod.value = order.paymentMethod === "wechat_pay" ? "wechat_pay" : order.paymentMethod === "member_balance" ? "member_balance" : "cash";
    els.refundMethod.disabled = true;
    els.refundDialog.showModal();
  }
  async function confirmRefundFromForm() {
    var _a;
    const order = getOrder(els.refundOrderId.value);
    const amount = Number(els.refundAmount.value);
    const reason = els.refundReason.value.trim();
    const method = els.refundMethod.value;
    if (!order) return;
    const remaining = Math.max(0, order.totalAmount - (order.refundAmount || 0));
    if (!Number.isFinite(amount) || amount <= 0 || amount > remaining) {
      alert(`\u9000\u6B3E\u91D1\u989D\u9700\u5927\u4E8E 0\uFF0C\u4E14\u4E0D\u80FD\u8D85\u8FC7\u53EF\u9000\u91D1\u989D ${money(remaining)}`);
      return;
    }
    if (!reason) {
      alert("\u8BF7\u586B\u5199\u9000\u6B3E\u539F\u56E0");
      return;
    }
    if (state.cloud.ready && ((_a = state.session) == null ? void 0 : _a.token)) {
      const originalLabel = els.confirmRefund.textContent;
      els.confirmRefund.disabled = true;
      els.confirmRefund.textContent = method === "wechat_pay" ? "\u6B63\u5728\u539F\u8DEF\u9000\u6B3E\u2026" : "\u6B63\u5728\u9000\u6B3E\u2026";
      try {
        const result = await callCloud("refundOrder", { orderId: order.id, amount, reason });
        await syncFromCloud();
        els.refundDialog.close();
        render();
        alert(method === "wechat_pay" ? `\u5FAE\u4FE1\u9000\u6B3E\u5DF2\u53D7\u7406\uFF0C\u5C06\u6309\u539F\u652F\u4ED8\u6E20\u9053\u9000\u56DE\u3002\u9000\u6B3E\u5355\u53F7\uFF1A${result.refund && result.refund.outRefundNo || "\u5904\u7406\u4E2D"}` : "\u9000\u6B3E\u5DF2\u5B8C\u6210\u5E76\u9000\u56DE\u4F1A\u5458\u4F59\u989D");
      } catch (error) {
        alert(`\u9000\u6B3E\u5931\u8D25\uFF1A${(error == null ? void 0 : error.message) || "\u672A\u77E5\u9519\u8BEF"}\u3002\u8BA2\u5355\u72B6\u6001\u548C\u4F1A\u5458\u4F59\u989D\u5747\u672A\u4FEE\u6539\u3002`);
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
      staffId: ((_a = state.session) == null ? void 0 : _a.staffId) || null,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    state.refunds.push(refund);
    order.refundAmount = Number(order.refundAmount || 0) + amount;
    order.refundReason = reason;
    order.status = order.refundAmount >= order.totalAmount ? "refunded" : "partial_refund";
    order.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    if (method === "member_balance" && order.memberId) {
      const member = getMember(order.memberId);
      if (member) {
        member.balance += amount;
        state.records.push(
          createRecord(member.id, "refund", amount, member.balance, `\u8BA2\u5355 ${order.orderNo} \u9000\u6B3E\uFF1A${reason}`)
        );
      }
    }
    saveState();
    els.refundDialog.close();
    render();
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
      els.confirmReceiptPrint.textContent = "\u6B63\u5728\u53D1\u9001\u2026";
      try {
        const response = await Promise.race([
          fetch("http://127.0.0.1:17891/print", {
            method: "POST",
            headers: { "Content-Type": "text/plain;charset=UTF-8" },
            body: window.btoa(unescape(encodeURIComponent(directPrintText)))
          }),
          new Promise((_, reject) => window.setTimeout(() => reject(new Error("\u6253\u5370\u670D\u52A1\u8FDE\u63A5\u8D85\u65F6")), 3e3))
        ]);
        const result = await response.text();
        if (!response.ok || result.trim() !== "OK") throw new Error(result || "\u6253\u5370\u5931\u8D25");
        closeReceiptPreview();
        alert("\u5C0F\u7968\u5DF2\u53D1\u9001\u5230 POS58");
        return;
      } catch (error) {
        alert(`\u672C\u5730\u6253\u5370\u670D\u52A1\u672A\u8FDE\u63A5\uFF0C\u672A\u6267\u884C\u6253\u5370\uFF1A${(error == null ? void 0 : error.message) || "\u672A\u77E5\u9519\u8BEF"}`);
        return;
      } finally {
        els.confirmReceiptPrint.disabled = false;
        els.confirmReceiptPrint.textContent = "\u6253\u5370";
      }
    }
    const printWindow = window.open("", "aiwaReceiptPrint", "width=420,height=720");
    if (!printWindow) {
      alert("\u6D4F\u89C8\u5668\u963B\u6B62\u4E86\u6253\u5370\u7A97\u53E3\uFF0C\u8BF7\u5141\u8BB8\u672C\u7AD9\u5F39\u51FA\u7A97\u53E3\u540E\u91CD\u8BD5");
      return;
    }
    printWindow.document.open();
    printWindow.document.write(`<!doctype html>
    <html lang="zh-CN">
      <head>
        <meta charset="utf-8">
        <title>\u7231\u5A03\u62AB\u8428\u5E97\u5C0F\u7968</title>
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
        const pageHeightMm = Math.min(1e3, Math.max(60, contentHeightMm + 8));
        pageSizeStyle.textContent = `@page { size: 58mm ${pageHeightMm}mm; margin: 0; }`;
      }
      printWindow.print();
    }, 500);
  }
  function buildOrderReceiptText(order) {
    const member = getMember(order.memberId);
    const customerName = (member == null ? void 0 : member.name) || order.customerName || "\u5FAE\u4FE1\u987E\u5BA2";
    const customerPhone = (member == null ? void 0 : member.phone) || order.customerPhone || "";
    const subtotal = order.items.reduce(
      (sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0),
      0
    );
    const netAmount = Number(order.totalAmount || 0) - Number(order.refundAmount || 0);
    const lines = [
      "\u7231\u5A03\u62AB\u8428\u5E97",
      "\u8BA2\u5355\u5C0F\u7968",
      "--------------------------------",
      `\u8BA2\u5355\u53F7\uFF1A${order.orderNo}`,
      `\u4E0B\u5355\u65F6\u95F4\uFF1A${formatFullTime(order.createdAt)}`,
      `\u8BA2\u5355\u72B6\u6001\uFF1A${orderStatusLabel(order.status)}`,
      `\u8BA2\u5355\u6765\u6E90\uFF1A${order.orderChannel === "mini_program" || order.paymentRedirect === "mini_program" ? "\u5FAE\u4FE1\u5C0F\u7A0B\u5E8F\u4E0B\u5355" : "\u5E97\u5BB6\u540E\u53F0\u4E0B\u5355"}`,
      `\u4F1A\u5458\u6635\u79F0\uFF1A${customerName}`
    ];
    if (member == null ? void 0 : member.card) lines.push(`\u4F1A\u5458\u53F7\uFF1A${member.card}`);
    if (customerPhone) lines.push(`\u7535\u8BDD\uFF1A${customerPhone}`);
    lines.push(`\u53D6\u9910\u65B9\u5F0F\uFF1A${buildFulfillmentLabel(order)}`);
    if (order.fulfillmentType === "delivery" && order.deliveryAddress) {
      if (order.deliveryRecipientName) lines.push(`\u6536\u8D27\u4EBA\uFF1A${order.deliveryRecipientName}`);
      if (order.deliveryRecipientPhone) lines.push(`\u6536\u8D27\u7535\u8BDD\uFF1A${order.deliveryRecipientPhone}`);
      lines.push(`\u914D\u9001\u5730\u5740\uFF1A${order.deliveryAddress}`);
    }
    lines.push("--------------------------------", "\u5546\u54C1\u660E\u7EC6");
    for (const item of order.items) {
      lines.push(String(item.name || "\u5546\u54C1"));
      lines.push(`  \xD7${Number(item.quantity || 0)}    ${money(Number(item.price || 0) * Number(item.quantity || 0))}`);
    }
    lines.push("--------------------------------", `\u5546\u54C1\u5C0F\u8BA1\uFF1A${money(subtotal)}`);
    if (Number(order.deliveryFee || 0)) {
      lines.push(`\u914D\u9001\u8D39\uFF1A${order.deliveryFeeWaived ? `${money(order.deliveryFee)}\uFF08\u5DF2\u51CF\u514D\uFF09` : money(order.deliveryFee)}`);
    }
    if (order.refundAmount) lines.push(`\u5DF2\u9000\u6B3E\uFF1A${money(order.refundAmount)}`);
    lines.push(`\u5B9E\u6536\uFF1A${money(netAmount)}`, `\u652F\u4ED8\u65B9\u5F0F\uFF1A${paymentMethodLabel(order.paymentMethod)}`);
    if (order.note) lines.push(`\u5907\u6CE8\uFF1A${order.note}`);
    lines.push("--------------------------------", "\u611F\u8C22\u60E0\u987E\uFF0C\u6B22\u8FCE\u4E0B\u6B21\u5149\u4E34");
    return lines.join("\n");
  }
  function buildMemberStatementText({ member, records, statementNo, rangeLabel, totalRecharge, totalBonus, totalSpend }) {
    const lines = [
      "\u7231\u5A03\u62AB\u8428\u5E97",
      "\u4F1A\u5458\u4EA4\u6613\u8BB0\u5F55",
      "--------------------------------",
      `\u5355\u53F7\uFF1A${statementNo}`,
      `\u6253\u5370\u65F6\u95F4\uFF1A${formatFullTime((/* @__PURE__ */ new Date()).toISOString())}`,
      `\u8303\u56F4\uFF1A${rangeLabel}`,
      `\u4F1A\u5458\uFF1A${member.name}`,
      `\u624B\u673A\u53F7\uFF1A${member.phone}`,
      `\u5361\u53F7\uFF1A${member.card}`,
      "--------------------------------",
      `\u5145\u503C\u5408\u8BA1\uFF1A${money(totalRecharge)}`,
      `\u8D60\u9001\u5408\u8BA1\uFF1A${money(totalBonus)}`,
      `\u6D88\u8D39\u5408\u8BA1\uFF1A${money(totalSpend)}`,
      `\u5F53\u524D\u4F59\u989D\uFF1A${money(member.balance)}`,
      "--------------------------------"
    ];
    for (const record of records) {
      lines.push(formatFullTime(record.createdAt));
      lines.push(`${recordTypeLabel(record.type)} ${recordAmountText(record)}${record.bonusAmount ? ` / \u8D60 ${money(record.bonusAmount)}` : ""}`);
      lines.push(`\u4F59\u989D\uFF1A${record.balanceAfter === null || record.balanceAfter === void 0 ? "-" : money(record.balanceAfter)}`);
      if (record.note) lines.push(`\u5907\u6CE8\uFF1A${record.note}`);
      lines.push("--------------------------------");
    }
    lines.push("\u611F\u8C22\u60E0\u987E\uFF0C\u6B22\u8FCE\u4E0B\u6B21\u5149\u4E34");
    return lines.join("\n");
  }
  function buildFilteredRecordStatementText({
    records,
    memberLabel,
    totalRecharge,
    totalBonus,
    totalSpend,
    totalOrderPayment,
    totalOrderRefund
  }) {
    const lines = [
      "\u7231\u5A03\u62AB\u8428\u5E97",
      "\u6D41\u6C34\u67E5\u8BE2\u7ED3\u679C",
      "--------------------------------",
      `\u6253\u5370\u65F6\u95F4\uFF1A${formatFullTime((/* @__PURE__ */ new Date()).toISOString())}`,
      `\u4F1A\u5458\u641C\u7D22\uFF1A${recordSearchLabel()}`,
      `\u7C7B\u578B\uFF1A${recordTypeFilterLabel()}`,
      `\u65E5\u671F\u8303\u56F4\uFF1A${recordDateRangeLabel()}`,
      `\u6D89\u53CA\u4F1A\u5458\uFF1A${memberLabel}`,
      "--------------------------------",
      `\u8BB0\u5F55\u6570\uFF1A${records.length} \u7B14`,
      `\u5145\u503C\u5408\u8BA1\uFF1A${money(totalRecharge)}`,
      `\u8D60\u9001\u5408\u8BA1\uFF1A${money(totalBonus)}`,
      `\u4F59\u989D\u6D88\u8D39\uFF1A${money(totalSpend)}`,
      `\u8BA2\u5355\u6536\u5165\uFF1A${money(totalOrderPayment)}`,
      `\u8BA2\u5355\u9000\u6B3E\uFF1A${money(totalOrderRefund)}`,
      "--------------------------------",
      "\u67E5\u8BE2\u6761\u4EF6\u5BF9\u5E94\u4EE5\u4E0A\u6C47\u603B\u6570\u636E"
    ];
    return lines.join("\n");
  }
  function printOrderReceipt(orderId) {
    const order = getOrder(orderId);
    if (!order) {
      alert("\u6CA1\u6709\u627E\u5230\u8FD9\u4E2A\u8BA2\u5355");
      return;
    }
    const member = getMember(order.memberId);
    const customerName = (member == null ? void 0 : member.name) || order.customerName || "\u5FAE\u4FE1\u987E\u5BA2";
    const customerPhone = (member == null ? void 0 : member.phone) || order.customerPhone || "";
    const subtotal = order.items.reduce(
      (sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0),
      0
    );
    const netAmount = Number(order.totalAmount || 0) - Number(order.refundAmount || 0);
    const receiptHtml = `
    <div class="receipt order-receipt">
      <h2>\u7231\u5A03\u62AB\u8428\u5E97</h2>
      <p class="receipt-subtitle">\u8BA2\u5355\u5C0F\u7968</p>
      <div class="receipt-dashed"></div>
      ${receiptLine("\u8BA2\u5355\u53F7", order.orderNo)}
      ${receiptLine("\u4E0B\u5355\u65F6\u95F4", formatFullTime(order.createdAt))}
      ${receiptLine("\u8BA2\u5355\u72B6\u6001", orderStatusLabel(order.status))}
      ${receiptLine("\u8BA2\u5355\u6765\u6E90", order.orderChannel === "mini_program" || order.paymentRedirect === "mini_program" ? "\u5FAE\u4FE1\u5C0F\u7A0B\u5E8F\u4E0B\u5355" : "\u5E97\u5BB6\u540E\u53F0\u4E0B\u5355")}
      ${receiptLine("\u4F1A\u5458\u6635\u79F0", customerName)}
      ${(member == null ? void 0 : member.card) ? receiptLine("\u4F1A\u5458\u53F7", member.card) : ""}
      ${customerPhone ? receiptLine("\u7535\u8BDD", customerPhone) : ""}
      ${receiptLine("\u53D6\u9910\u65B9\u5F0F", buildFulfillmentLabel(order))}
      ${order.fulfillmentType === "delivery" && order.deliveryRecipientName ? receiptLine("\u6536\u8D27\u4EBA", order.deliveryRecipientName) : ""}
      ${order.fulfillmentType === "delivery" && order.deliveryRecipientPhone ? receiptLine("\u6536\u8D27\u7535\u8BDD", order.deliveryRecipientPhone) : ""}
      ${order.fulfillmentType === "delivery" && order.deliveryAddress ? receiptLine("\u914D\u9001\u5730\u5740", order.deliveryAddress) : ""}
      <div class="receipt-dashed"></div>
      <div class="receipt-order-head"><span>\u5546\u54C1</span><span>\u6570\u91CF</span><span>\u91D1\u989D</span></div>
      <div class="receipt-order-items">
        ${order.items.map((item) => `
          <div class="receipt-order-item">
            <span>${escapeHtml(item.name)}</span>
            <span>\xD7${Number(item.quantity || 0)}</span>
            <strong>${money(Number(item.price || 0) * Number(item.quantity || 0))}</strong>
          </div>
        `).join("")}
      </div>
      <div class="receipt-dashed"></div>
      ${receiptLine("\u5546\u54C1\u5C0F\u8BA1", money(subtotal))}
      ${Number(order.deliveryFee || 0) ? receiptLine("\u914D\u9001\u8D39", order.deliveryFeeWaived ? `${money(order.deliveryFee)}\uFF08\u5DF2\u51CF\u514D\uFF09` : money(order.deliveryFee)) : ""}
      ${order.refundAmount ? receiptLine("\u5DF2\u9000\u6B3E", money(order.refundAmount)) : ""}
      ${receiptLine("\u5B9E\u6536", money(netAmount))}
      ${receiptLine("\u652F\u4ED8\u65B9\u5F0F", paymentMethodLabel(order.paymentMethod))}
      ${order.note ? `<div class="receipt-note"><strong>\u5907\u6CE8\uFF1A</strong>${escapeHtml(order.note)}</div>` : ""}
      <div class="receipt-dashed"></div>
      <p class="receipt-footer">\u611F\u8C22\u60E0\u987E\uFF0C\u6B22\u8FCE\u4E0B\u6B21\u5149\u4E34</p>
    </div>
  `;
    showReceiptPreview(`\u8BA2\u5355 ${order.orderNo} \u5C0F\u7968\u9884\u89C8`, receiptHtml, buildOrderReceiptText(order));
  }
  function openMemberPrintDialog(memberId) {
    const member = getMember(memberId);
    if (!member) {
      alert("\u6CA1\u6709\u627E\u5230\u8FD9\u4E2A\u4F1A\u5458");
      return;
    }
    const today = /* @__PURE__ */ new Date();
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(today.getDate() - 29);
    els.memberPrintId.value = member.id;
    els.memberPrintTitle.textContent = `${member.name} \xB7 \u9009\u62E9\u4EA4\u6613\u65E5\u671F`;
    els.memberPrintStartDate.value = formatDateInputValue(thirtyDaysAgo);
    els.memberPrintEndDate.value = formatDateInputValue(today);
    els.memberPrintAllDates.checked = false;
    els.memberPrintStartDate.disabled = false;
    els.memberPrintEndDate.disabled = false;
    els.memberPrintDialog.showModal();
  }
  function printMemberStatement(memberId, range = { start: null, end: null }, rangeLabel = "\u5168\u90E8\u4EA4\u6613") {
    const member = getMember(memberId);
    if (!member) {
      alert("\u6CA1\u6709\u627E\u5230\u8FD9\u4E2A\u4F1A\u5458");
      return;
    }
    const records = state.records.filter((record) => record.memberId === memberId && isRecordInDateRange(record, range)).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    if (!records.length) {
      alert("\u8BE5\u4F1A\u5458\u5728\u5F53\u524D\u8303\u56F4\u5185\u6CA1\u6709\u4EA4\u6613\u8BB0\u5F55");
      return;
    }
    const totalRecharge = records.filter((record) => record.type === "recharge").reduce((sum, record) => sum + record.amount, 0);
    const totalBonus = records.reduce((sum, record) => sum + (record.bonusAmount || 0), 0);
    const totalSpend = records.filter((record) => record.type === "spend").reduce((sum, record) => sum + record.amount, 0);
    const statementNo = `${member.card}-${Date.now().toString().slice(-6)}`;
    const receiptHtml = `
    <div class="receipt">
      <img class="receipt-logo" src="assets/aiwa-pizza-logo.jpg" alt="">
      <h2>\u7231\u5A03\u62AB\u8428\u5E97</h2>
      <p class="receipt-subtitle">\u4F1A\u5458\u4EA4\u6613\u8BB0\u5F55</p>
      <div class="receipt-dashed"></div>
      ${receiptLine("\u5355\u53F7", statementNo)}
      ${receiptLine("\u6253\u5370\u65F6\u95F4", formatFullTime((/* @__PURE__ */ new Date()).toISOString()))}
      ${receiptLine("\u8303\u56F4", rangeLabel)}
      ${receiptLine("\u4F1A\u5458", member.name)}
      ${receiptLine("\u624B\u673A\u53F7", member.phone)}
      ${receiptLine("\u5361\u53F7", member.card)}
      <div class="receipt-dashed"></div>
      ${receiptLine("\u5145\u503C\u5408\u8BA1", money(totalRecharge))}
      ${receiptLine("\u8D60\u9001\u5408\u8BA1", money(totalBonus))}
      ${receiptLine("\u6D88\u8D39\u5408\u8BA1", money(totalSpend))}
      ${receiptLine("\u5F53\u524D\u4F59\u989D", money(member.balance))}
      <div class="receipt-dashed"></div>
      <div class="receipt-records">
        ${records.map(
      (record) => `
              <div class="receipt-record">
                <div>
                  <strong>${formatFullTime(record.createdAt)}</strong>
                  <span>${recordTypeLabel(record.type)} ${recordAmountText(record)}${record.bonusAmount ? ` / \u8D60 ${money(record.bonusAmount)}` : ""}</span>
                  <span>\u4F59\u989D ${money(record.balanceAfter)}</span>
                </div>
                ${record.note ? `<p>${escapeHtml(record.note)}</p>` : ""}
              </div>
            `
    ).join("")}
      </div>
      <div class="receipt-dashed"></div>
      <p class="receipt-footer">\u611F\u8C22\u60E0\u987E\uFF0C\u6B22\u8FCE\u4E0B\u6B21\u5149\u4E34</p>
    </div>
  `;
    showReceiptPreview(
      "\u4F1A\u5458\u4EA4\u6613\u8BB0\u5F55\u9884\u89C8",
      receiptHtml,
      buildMemberStatementText({
        member,
        records,
        statementNo,
        rangeLabel,
        totalRecharge,
        totalBonus,
        totalSpend
      })
    );
  }
  function printFilteredRecordStatement() {
    const records = [...getFilteredRecords()].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    if (!records.length) {
      alert("\u5F53\u524D\u67E5\u8BE2\u6761\u4EF6\u4E0B\u6CA1\u6709\u53EF\u6253\u5370\u7684\u6D41\u6C34");
      return;
    }
    const totalRecharge = records.filter((record) => record.type === "recharge").reduce((sum, record) => sum + record.amount, 0);
    const totalBonus = records.reduce((sum, record) => sum + (record.bonusAmount || 0), 0);
    const totalSpend = records.filter((record) => record.type === "spend").reduce((sum, record) => sum + record.amount, 0);
    const totalOrderPayment = records.filter((record) => record.type === "order_payment").reduce((sum, record) => sum + record.amount, 0);
    const totalOrderRefund = records.filter((record) => record.type === "order_refund").reduce((sum, record) => sum + record.amount, 0);
    const memberNames = Array.from(
      new Set(records.map((record) => {
        var _a;
        return record.memberName || ((_a = getMember(record.memberId)) == null ? void 0 : _a.name) || "\u987E\u5BA2";
      }))
    );
    const memberLabel = memberNames.length === 1 ? memberNames[0] : `${memberNames.length} \u4F4D\u4F1A\u5458`;
    const receiptHtml = `
    <div class="receipt">
      <img class="receipt-logo" src="assets/aiwa-pizza-logo.jpg" alt="">
      <h2>\u7231\u5A03\u62AB\u8428\u5E97</h2>
      <p class="receipt-subtitle">\u6D41\u6C34\u67E5\u8BE2\u7ED3\u679C</p>
      <div class="receipt-dashed"></div>
      ${receiptLine("\u6253\u5370\u65F6\u95F4", formatFullTime((/* @__PURE__ */ new Date()).toISOString()))}
      ${receiptLine("\u4F1A\u5458\u641C\u7D22", recordSearchLabel())}
      ${receiptLine("\u7C7B\u578B", recordTypeFilterLabel())}
      ${receiptLine("\u65E5\u671F\u8303\u56F4", recordDateRangeLabel())}
      ${receiptLine("\u6D89\u53CA\u4F1A\u5458", memberLabel)}
      <div class="receipt-dashed"></div>
      ${receiptLine("\u8BB0\u5F55\u6570", `${records.length} \u7B14`)}
      ${receiptLine("\u5145\u503C\u5408\u8BA1", money(totalRecharge))}
      ${receiptLine("\u8D60\u9001\u5408\u8BA1", money(totalBonus))}
      ${receiptLine("\u4F59\u989D\u6D88\u8D39", money(totalSpend))}
      ${receiptLine("\u8BA2\u5355\u6536\u5165", money(totalOrderPayment))}
      ${receiptLine("\u8BA2\u5355\u9000\u6B3E", money(totalOrderRefund))}
      <div class="receipt-dashed"></div>
      <p class="receipt-footer">\u67E5\u8BE2\u6761\u4EF6\u5BF9\u5E94\u4EE5\u4E0A\u6C47\u603B\u6570\u636E</p>
    </div>
  `;
    showReceiptPreview(
      "\u6D41\u6C34\u67E5\u8BE2\u7ED3\u679C\u9884\u89C8",
      receiptHtml,
      buildFilteredRecordStatementText({
        records,
        memberLabel,
        totalRecharge,
        totalBonus,
        totalSpend,
        totalOrderPayment,
        totalOrderRefund
      })
    );
  }
  function exportData() {
    const records = getFilteredRecords();
    if (!records.length) {
      alert("\u5F53\u524D\u67E5\u8BE2\u6761\u4EF6\u4E0B\u6CA1\u6709\u53EF\u5BFC\u51FA\u7684\u6D41\u6C34");
      return;
    }
    const excelText = (value) => {
      const text = String(value != null ? value : "");
      const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
      return escapeHtml(safe);
    };
    const rows = records.map((record) => `
    <tr><td>${excelText(formatFullTime(record.createdAt))}</td><td>${excelText(recordTypeLabel(record.type))}</td>
    <td>${excelText(record.memberName || "\u987E\u5BA2")}</td><td style="mso-number-format:'\\@'">${excelText(record.memberCard)}</td>
    <td style="mso-number-format:'\\@'">${excelText(record.memberPhone)}</td><td style="mso-number-format:'\\@'">${excelText(record.orderNo)}</td>
    <td>${excelText(paymentMethodLabel(record.paymentMethod))}</td><td>${excelText(record.itemsText)}</td>
    <td class="number">${Number(record.amount || 0)}</td><td class="number">${Number(record.bonusAmount || 0)}</td>
    <td class="number">${record.balanceAfter === null || record.balanceAfter === void 0 ? "" : Number(record.balanceAfter)}</td><td>${excelText(record.note)}</td></tr>`).join("");
    const workbook = `<!doctype html><html><head><meta charset="UTF-8"><style>
    table{border-collapse:collapse;font-family:Arial,"Microsoft YaHei",sans-serif;font-size:11pt}
    th,td{border:1px solid #999;padding:6px;vertical-align:top}th{background:#0f8a6b;color:#fff}
    .title{font-size:16pt;font-weight:bold;background:#e8f5f1;color:#111}.meta{background:#f3f6f5}.number{mso-number-format:'0.00'}
    </style></head><body><table><tr><td class="title" colspan="12">\u7231\u5A03\u62AB\u8428\u5E97\u6D41\u6C34\u660E\u7EC6</td></tr>
    <tr><td class="meta" colspan="12">\u7B5B\u9009\u6761\u4EF6\uFF1A\u4F1A\u5458\u641C\u7D22 ${excelText(recordSearchLabel())}\uFF1B\u7C7B\u578B ${excelText(recordTypeFilterLabel())}\uFF1B\u65E5\u671F ${excelText(recordDateRangeLabel())}\uFF1B\u5171 ${records.length} \u7B14</td></tr>
    <tr><th>\u4EA4\u6613\u65F6\u95F4</th><th>\u7C7B\u578B</th><th>\u4F1A\u5458\u540D\u79F0</th><th>\u4F1A\u5458\u53F7</th><th>\u624B\u673A\u53F7</th><th>\u8BA2\u5355\u53F7</th><th>\u652F\u4ED8\u65B9\u5F0F</th><th>\u5546\u54C1</th><th>\u91D1\u989D</th><th>\u8D60\u9001\u91D1\u989D</th><th>\u4EA4\u6613\u540E\u4F59\u989D</th><th>\u5907\u6CE8</th></tr>${rows}</table></body></html>`;
    const blob = new Blob(["\uFEFF", workbook], { type: "application/vnd.ms-excel;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `\u7231\u5A03\u62AB\u8428\u5E97\u6D41\u6C34-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.xls`;
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
        const fallbackStore = createStore("\u7231\u5A03\u62AB\u8428\u5E97", PRIMARY_STORE_ID);
        state.stores = Array.isArray(data.stores) && data.stores.length ? data.stores : [fallbackStore];
        const defaultStoreId = state.stores[0].id;
        state.staff = Array.isArray(data.staff) && data.staff.length ? data.staff.map((staffer) => normalizeStaff(staffer, defaultStoreId)) : cloudConfig.enabled ? [] : [createStaff("\u5E97\u957F", "13800000000", "manager", defaultStoreId)];
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
        alert("\u5BFC\u5165\u6210\u529F");
      } catch (e) {
        alert("\u5BFC\u5165\u5931\u8D25\uFF0C\u8BF7\u9009\u62E9\u7531\u672C\u7CFB\u7EDF\u5BFC\u51FA\u7684 JSON \u6587\u4EF6");
      }
    };
    reader.readAsText(file);
  }
  function escapeHtml(value) {
    return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
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
    button.addEventListener("click", () => {
      var _a;
      return (_a = button.closest("dialog")) == null ? void 0 : _a.close("cancel");
    });
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
    var _a;
    if (((_a = event.submitter) == null ? void 0 : _a.value) === "cancel") return;
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
      alert("\u8BF7\u9009\u62E9\u5F00\u59CB\u65E5\u671F\u548C\u7ED3\u675F\u65E5\u671F");
      return;
    }
    if (startValue > endValue) {
      alert("\u5F00\u59CB\u65E5\u671F\u4E0D\u80FD\u665A\u4E8E\u7ED3\u675F\u65E5\u671F");
      return;
    }
    const range = {
      start: /* @__PURE__ */ new Date(`${startValue}T00:00:00`),
      end: /* @__PURE__ */ new Date(`${endValue}T23:59:59`)
    };
    els.memberPrintDialog.close();
    printMemberStatement(memberId, range, `\u65E5\u671F\uFF1A${startValue} \u81F3 ${endValue}`);
  });
  els.closeReceiptPreview.addEventListener("click", closeReceiptPreview);
  els.cancelReceiptPreview.addEventListener("click", closeReceiptPreview);
  els.confirmReceiptPrint.addEventListener("click", printReceiptPreview);
  els.exportData.addEventListener("click", exportData);
  els.importData.addEventListener("change", (event) => {
    var _a;
    const file = (_a = event.target.files) == null ? void 0 : _a[0];
    if (file) importData(file);
    event.target.value = "";
  });
  els.quickTransactionForm.addEventListener("submit", (event) => {
    var _a;
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
      if (((_a = event.submitter) == null ? void 0 : _a.value) === "print") {
        openMemberPrintDialog(record.memberId);
      }
    }
  });
  els.bonusRuleForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!currentStaffIsManager()) {
      alert("\u53EA\u6709\u5E97\u957F\u53EF\u4EE5\u4FEE\u6539\u5145\u503C\u8D60\u9001\u89C4\u5219");
      return;
    }
    const minAmount = Number(els.ruleMinAmount.value);
    const bonusAmount = Number(els.ruleBonusAmount.value);
    if (!Number.isFinite(minAmount) || minAmount <= 0 || !Number.isFinite(bonusAmount) || bonusAmount < 0) {
      alert("\u8BF7\u586B\u5199\u6B63\u786E\u7684\u5145\u503C\u91D1\u989D\u548C\u8D60\u9001\u91D1\u989D");
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
      testMode: els.deliveryTestMode.checked
    } }).delivery;
    if (delivery.storeLatitude === null || delivery.storeLongitude === null) {
      alert("\u8BF7\u586B\u5199\u6B63\u786E\u7684\u95E8\u5E97\u7ECF\u7EAC\u5EA6");
      return;
    }
    if (!delivery.testMode && !storeLocationIsInQianan(delivery.storeLatitude, delivery.storeLongitude)) {
      alert("\u6B63\u5F0F\u6A21\u5F0F\u53EA\u5141\u8BB8\u4FDD\u5B58\u8FC1\u5B89\u5E02\u8303\u56F4\u5185\u7684\u95E8\u5E97\u5750\u6807\uFF1B\u5728\u5317\u4EAC\u6D4B\u8BD5\u8BF7\u5148\u5F00\u542F\u201C\u4E34\u65F6\u6D4B\u8BD5\u6A21\u5F0F\u201D\u3002");
      return;
    }
    state.settings.delivery = delivery;
    await saveState();
    renderDeliverySettings();
    els.deliverySettingsStatus.textContent = "\u914D\u9001\u8BBE\u7F6E\u5DF2\u4FDD\u5B58\u5E76\u540C\u6B65\u5230\u987E\u5BA2\u7AEF\u3002";
  });
  els.locateStore.addEventListener("click", () => {
    if (!navigator.geolocation) {
      els.deliverySettingsStatus.textContent = "\u5F53\u524D\u6D4F\u89C8\u5668\u4E0D\u652F\u6301\u5B9A\u4F4D\uFF0C\u8BF7\u4F7F\u7528\u624B\u673A\u5FAE\u4FE1\u6216\u6700\u65B0\u7248\u6D4F\u89C8\u5668\u6253\u5F00\u540E\u53F0\u3002";
      return;
    }
    els.deliverySettingsStatus.textContent = "\u6B63\u5728\u83B7\u53D6\u95E8\u5E97\u5F53\u524D\u4F4D\u7F6E\u2026";
    navigator.geolocation.getCurrentPosition(
      (position) => {
        els.storeLatitude.value = Number(position.coords.latitude).toFixed(6);
        els.storeLongitude.value = Number(position.coords.longitude).toFixed(6);
        updateStoreLocationVerification();
        captureDeliverySettingsDraft();
        const inQianan = storeLocationIsInQianan(position.coords.latitude, position.coords.longitude);
        els.deliverySettingsStatus.textContent = inQianan ? `\u5B9A\u4F4D\u6210\u529F\uFF08\u7CBE\u5EA6\u7EA6 ${Math.round(position.coords.accuracy || 0)} \u7C73\uFF09\uFF0C\u8BF7\u5148\u5728\u5730\u56FE\u4E2D\u6838\u5BF9\uFF0C\u518D\u4FDD\u5B58\u3002` : "\u5B9A\u4F4D\u7ED3\u679C\u4E0D\u5728\u8FC1\u5B89\u5E02\u8303\u56F4\u5185\uFF0C\u53EF\u80FD\u662F\u7535\u8111\u7F51\u7EDC\u5B9A\u4F4D\u504F\u79FB\uFF0C\u8BF7\u6539\u7528\u95E8\u5E97\u624B\u673A\u5B9A\u4F4D\u3002";
      },
      () => {
        els.deliverySettingsStatus.textContent = "\u5B9A\u4F4D\u5931\u8D25\uFF0C\u8BF7\u5141\u8BB8\u6D4F\u89C8\u5668\u83B7\u53D6\u4F4D\u7F6E\u540E\u91CD\u8BD5\u3002";
      },
      { enableHighAccuracy: true, timeout: 15e3, maximumAge: 0 }
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
      renderOrderSoundSetting("\u8BD5\u542C\u6210\u529F\uFF0C\u65B0\u8BA2\u5355\u8FDB\u5165\u65F6\u4F1A\u81EA\u52A8\u63D0\u9192");
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
      alert("\u53EA\u6709\u5E97\u957F\u53EF\u4EE5\u4FEE\u6539\u5145\u503C\u8D60\u9001\u89C4\u5219");
      return;
    }
    state.settings.bonusRules = state.settings.bonusRules.filter((rule) => rule.id !== button.dataset.deleteRule);
    saveState();
    renderBonusRules();
  });
  els.staffForm.addEventListener("submit", async (event) => {
    var _a;
    event.preventDefault();
    if (!currentStaffIsManager()) {
      alert("\u53EA\u6709\u5E97\u957F\u53EF\u4EE5\u7BA1\u7406\u5E97\u5458");
      return;
    }
    const name = els.staffName.value.trim();
    const phone = normalizePhone(els.staffPhone.value);
    const role = els.staffRole.value;
    if (!name || !phone) {
      alert("\u8BF7\u586B\u5199\u5E97\u5458\u59D3\u540D\u548C\u624B\u673A\u53F7");
      return;
    }
    if (getStoreStaff().some((staffer) => staffer.phone === phone)) {
      alert("\u8FD9\u4E2A\u624B\u673A\u53F7\u5DF2\u7ECF\u662F\u5F53\u524D\u95E8\u5E97\u5E97\u5458");
      return;
    }
    state.staff.push(createStaff(name, phone, role, (_a = getCurrentStore()) == null ? void 0 : _a.id));
    els.staffName.value = "";
    els.staffPhone.value = "";
    els.staffRole.value = "staff";
    await saveStaffAndSync();
  });
  els.staffList.addEventListener("click", async (event) => {
    var _a;
    const button = event.target.closest("[data-toggle-staff]");
    if (!button) return;
    if (!currentStaffIsManager()) {
      alert("\u53EA\u6709\u5E97\u957F\u53EF\u4EE5\u7BA1\u7406\u5E97\u5458");
      return;
    }
    const staffer = state.staff.find((item) => item.id === button.dataset.toggleStaff);
    if (!staffer) return;
    if (staffer.id === ((_a = state.session) == null ? void 0 : _a.staffId) && staffer.active) {
      alert("\u4E0D\u80FD\u505C\u7528\u5F53\u524D\u767B\u5F55\u7684\u8D26\u53F7");
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
    const id = (editButton == null ? void 0 : editButton.dataset.productEdit) || (toggleButton == null ? void 0 : toggleButton.dataset.productToggle) || (soldoutButton == null ? void 0 : soldoutButton.dataset.productSoldout) || (deleteButton == null ? void 0 : deleteButton.dataset.productDelete);
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
      if (!confirm("\u786E\u8BA4\u5220\u9664\u8FD9\u4E2A\u5546\u54C1\uFF1F\u5386\u53F2\u8BA2\u5355\u4F1A\u4FDD\u7559\u5546\u54C1\u540D\u79F0\u3002")) return;
      product.active = false;
      product.deletedAt = (/* @__PURE__ */ new Date()).toISOString();
    }
    product.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
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
    const label = button.dataset.action === "recharge" ? "\u5145\u503C" : "\u6D88\u8D39";
    const amount = prompt(`\u8BF7\u8F93\u5165${member.name}\u672C\u6B21${label}\u91D1\u989D`);
    if (amount === null) return;
    const note = prompt("\u5907\u6CE8\uFF0C\u53EF\u7559\u7A7A") || "";
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
})();
