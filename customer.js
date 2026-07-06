const STORAGE_KEY = "aiwa_drink_membership_v1";
const CUSTOMER_SESSION_KEY = "aiwa_customer_session_v1";
const cloudConfig = window.AIWA_CLOUDBASE_CONFIG || {};
const urlParams = new URLSearchParams(window.location.search);
let localRefreshTimer = null;

const state = {
  localApi: { ready: false },
  cloud: { ready: false, app: null },
  stores: [],
  staff: [],
  session: null,
  members: [],
  records: [],
  categories: [],
  products: [],
  orders: [],
  refunds: [],
  settings: { bonusRules: [] },
  cart: {},
  activeCategory: "全部",
  currentMember: null,
  customerProfile: null,
};

const els = {
  authStatus: document.querySelector("#authStatus"),
  syncStatus: document.querySelector("#syncStatus"),
  authorizeCustomer: document.querySelector("#authorizeCustomer"),
  fulfillmentTypes: document.querySelectorAll('input[name="fulfillmentType"]'),
  pickupModes: document.querySelectorAll('input[name="pickupMode"]'),
  pickupFields: document.querySelector("#pickupFields"),
  scheduledPickupFields: document.querySelector("#scheduledPickupFields"),
  deliveryFields: document.querySelector("#deliveryFields"),
  savedAddressSelect: document.querySelector("#savedAddressSelect"),
  pickupDate: document.querySelector("#pickupDate"),
  pickupTime: document.querySelector("#pickupTime"),
  deliveryAddress: document.querySelector("#deliveryAddress"),
  saveDeliveryAddress: document.querySelector("#saveDeliveryAddress"),
  deliveryDate: document.querySelector("#deliveryDate"),
  deliveryTime: document.querySelector("#deliveryTime"),
  memberStatus: document.querySelector("#memberStatus"),
  joinMember: document.querySelector("#joinMember"),
  openRecharge: document.querySelector("#openRecharge"),
  rechargeDialog: document.querySelector("#rechargeDialog"),
  rechargeForm: document.querySelector("#rechargeForm"),
  rechargeAmount: document.querySelector("#rechargeAmount"),
  rechargePaymentMethod: document.querySelector("#rechargePaymentMethod"),
  rechargeHint: document.querySelector("#rechargeHint"),
  closeRecharge: document.querySelector("#closeRecharge"),
  categoryTabs: document.querySelector("#categoryTabs"),
  productGrid: document.querySelector("#productGrid"),
  cartCount: document.querySelector("#cartCount"),
  cartPanel: document.querySelector("#cartPanel"),
  cartItems: document.querySelector("#cartItems"),
  orderNote: document.querySelector("#orderNote"),
  paymentMethod: document.querySelector("#paymentMethod"),
  paymentHint: document.querySelector("#paymentHint"),
  cartTotal: document.querySelector("#cartTotal"),
  submitOrder: document.querySelector("#submitOrder"),
  orderHint: document.querySelector("#orderHint"),
  historyToggle: document.querySelector("#historyToggle"),
  historyDialog: document.querySelector("#historyDialog"),
  closeHistory: document.querySelector("#closeHistory"),
  historyList: document.querySelector("#historyList"),
  walletStatus: document.querySelector("#walletStatus"),
};

async function initLocalApi() {
  if (!cloudConfig.localApi) return;
  try {
    const localSnapshot = serializeData();
    const result = await callLocalApi("GET");
    state.localApi.ready = true;
    state.cloud.ready = false;
    const merged = await callLocalApi("POST", localSnapshot);
    if (result.data) {
      applyData(merged.data || result.data);
      saveLocal(false);
    } else if (merged.data) {
      applyData(merged.data);
      saveLocal(false);
    }
    renderSyncStatus();
  } catch (error) {
    state.localApi.ready = false;
    renderSyncStatus();
    console.warn("[Local API customer]", error);
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
  if (cloudConfig.localApi) return;
  if (!cloudConfig.enabled || !window.cloudbase || !cloudConfig.envId) return;
  try {
    state.cloud.app = window.cloudbase.init({ env: cloudConfig.envId });
    const auth = state.cloud.app.auth();
    if (auth?.anonymousAuthProvider) {
      await auth.anonymousAuthProvider().signIn().catch(() => {});
    }
    state.cloud.ready = true;
  } catch (error) {
    console.warn("[CloudBase customer]", error);
  }
}

async function callCloud(action, payload = {}) {
  if (!state.cloud.ready || !state.cloud.app?.callFunction) throw new Error("CloudBase is not ready");
  const result = await state.cloud.app.callFunction({
    name: cloudConfig.functions?.membershipApi || "membershipApi",
    data: { action, payload },
  });
  if (!result.result?.ok) throw new Error(result.result?.message || "CloudBase request failed");
  return result.result;
}

function loadLocal() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) {
    const store = createStore("爱娃披萨店");
    state.stores = [store];
    state.categories = createDefaultCategories(store.id);
    state.products = createDefaultProducts(store.id);
    saveLocal();
    return;
  }

  try {
    applyData(JSON.parse(saved));
  } catch {
    const store = createStore("爱娃披萨店");
    state.stores = [store];
    state.categories = createDefaultCategories(store.id);
    state.products = createDefaultProducts(store.id);
  }
}

function loadCustomerSession() {
  const savedProfile = readCustomerSession();
  if (urlParams.get("mockAuth") === "1") {
    state.customerProfile = createMockCustomerProfile();
    if (savedProfile?.openid === state.customerProfile.openid) {
      state.customerProfile.addresses = normalizeAddresses(savedProfile.addresses);
    }
    saveCustomerSession();
    return;
  }

  state.customerProfile = savedProfile;
}

function readCustomerSession() {
  try {
    return normalizeCustomerProfile(JSON.parse(localStorage.getItem(CUSTOMER_SESSION_KEY)) || null);
  } catch {
    return null;
  }
}

function saveCustomerSession() {
  if (state.customerProfile) {
    localStorage.setItem(CUSTOMER_SESSION_KEY, JSON.stringify(state.customerProfile));
  }
}

function normalizeCustomerProfile(profile) {
  if (!profile) return null;
  return {
    ...profile,
    phone: normalizePhone(profile.phone),
    addresses: normalizeAddresses(profile.addresses),
  };
}

function normalizeAddresses(addresses) {
  if (!Array.isArray(addresses)) return [];
  return addresses
    .map((item) => ({
      id: item.id || createId("address"),
      address: String(item.address || "").trim(),
      updatedAt: item.updatedAt || new Date().toISOString(),
    }))
    .filter((item) => item.address)
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

function createMockCustomerProfile() {
  return {
    openid: urlParams.get("openid") || "mock_openid_001",
    name: urlParams.get("name") || "微信顾客",
    phone: normalizePhone(urlParams.get("phone") || "13900001111"),
    avatar: "",
    addresses: [],
    authorizedAt: new Date().toISOString(),
    source: "local_mock",
  };
}

function authorizeCustomer() {
  state.customerProfile = createMockCustomerProfile();
  saveCustomerSession();
  render();
  els.orderHint.textContent = "已完成本地模拟授权，可以开始点餐。";
}

async function syncFromCloud() {
  if (state.localApi.ready) {
    try {
      const result = await callLocalApi("GET");
      if (result.data) {
        applyData(result.data);
        saveLocal(false);
      } else {
        const saved = await callLocalApi("POST", serializeData());
        if (saved.data) {
          applyData(saved.data);
          saveLocal(false);
        }
      }
    } catch (error) {
      console.warn("[customer local sync]", error);
    }
    return;
  }

  if (!state.cloud.ready) return;
  try {
    const result = await callCloud("getStoreData");
    if (result.data) {
      applyData(result.data);
      saveLocal(false);
    }
  } catch (error) {
    state.cloud.ready = false;
    console.warn("[customer sync]", error);
  }
}

async function saveAll() {
  saveLocal();
  if (state.localApi.ready) {
    try {
      const result = await callLocalApi("POST", serializeData());
      if (result.data) {
        applyData(result.data);
        saveLocal(false);
      }
    } catch (error) {
      els.orderHint.textContent = "订单已保存在手机，但没有写入电脑本地服务，请确认用 start-mobile-test.command 启动。";
      console.warn("[customer local save]", error);
    }
    return;
  }
  if (!state.cloud.ready) return;
  try {
    await callCloud("saveStoreData", { data: serializeData() });
  } catch (error) {
    els.orderHint.textContent = "已保存在当前设备，云端同步失败，请联系店员确认。";
    console.warn("[customer save]", error);
  }
}

function saveLocal(writeMessage = true) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeData()));
  if (writeMessage) window.dispatchEvent(new Event("storage"));
}

function serializeData() {
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

function applyData(data) {
  const fallbackStore = createStore("爱娃披萨店");
  state.stores = Array.isArray(data.stores) && data.stores.length ? data.stores : [fallbackStore];
  const storeId = state.stores[0].id;
  state.staff = Array.isArray(data.staff) ? data.staff : [];
  state.session = data.session || null;
  state.members = Array.isArray(data.members) ? data.members.map((member) => normalizeMember(member, storeId)) : [];
  state.records = Array.isArray(data.records) ? data.records.map(normalizeRecord) : [];
  state.categories = normalizeCategories(data.categories, storeId);
  state.products = normalizeProducts(data.products, storeId);
  state.orders = normalizeOrders(data.orders, storeId);
  state.refunds = Array.isArray(data.refunds) ? data.refunds : [];
  state.settings = data.settings || { bonusRules: [] };
}

function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function createStore(name) {
  return { id: createId("store"), name, createdAt: new Date().toISOString() };
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
  ].map(([name, category, price, description]) => ({
    id: createId("product"),
    storeId,
    name,
    category,
    price,
    description,
    image: "",
    active: true,
    soldOut: false,
    sort: Date.now(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));
}

function normalizePhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}

function normalizeMember(member, storeId) {
  return {
    ...member,
    id: member.id || createId("member"),
    storeId: member.storeId || storeId,
    phone: normalizePhone(member.phone),
    balance: Number(member.balance) || 0,
  };
}

function normalizeRecord(record) {
  return {
    ...record,
    amount: Number(record.amount) || 0,
    bonusAmount: Number(record.bonusAmount) || 0,
    balanceAfter: Number(record.balanceAfter) || 0,
    createdAt: record.createdAt || new Date().toISOString(),
  };
}

function normalizeCategories(categories, storeId) {
  if (!Array.isArray(categories) || !categories.length) return createDefaultCategories(storeId);
  return categories.map((category, index) => ({
    id: category.id || createId("category"),
    storeId: category.storeId || storeId,
    name: category.name || "未分类",
    sort: Number(category.sort) || index + 1,
    createdAt: category.createdAt || new Date().toISOString(),
  }));
}

function normalizeProducts(products, storeId) {
  if (!Array.isArray(products) || !products.length) return createDefaultProducts(storeId);
  return products.map((product, index) => ({
    id: product.id || createId("product"),
    storeId: product.storeId || storeId,
    name: product.name || "商品",
    category: product.category || "未分类",
    price: Number(product.price) || 0,
    description: product.description || "",
    image: product.image || "",
    active: product.active !== false,
    soldOut: Boolean(product.soldOut),
    deletedAt: product.deletedAt || "",
    sort: Number(product.sort) || index + 1,
    createdAt: product.createdAt || new Date().toISOString(),
    updatedAt: product.updatedAt || new Date().toISOString(),
  }));
}

function normalizeOrders(orders, storeId) {
  if (!Array.isArray(orders)) return [];
  return orders.map((order) => ({
    ...order,
    id: order.id || createId("order"),
    storeId: order.storeId || storeId,
    customerPhone: normalizePhone(order.customerPhone),
    items: Array.isArray(order.items) ? order.items : [],
    totalAmount: Number(order.totalAmount) || 0,
    refundAmount: Number(order.refundAmount) || 0,
    fulfillmentType: order.fulfillmentType || "pickup",
    pickupMode: order.pickupMode || (order.pickupTime === "尽快" ? "now" : "scheduled"),
    pickupDate: order.pickupDate || "",
    pickupTime: order.pickupTime || "",
    deliveryAddress: order.deliveryAddress || "",
    deliveryDate: order.deliveryDate || "",
    deliveryTime: order.deliveryTime || "",
    fulfillmentLabel: order.fulfillmentLabel || buildFulfillmentLabel(order),
    createdAt: order.createdAt || new Date().toISOString(),
    updatedAt: order.updatedAt || order.createdAt || new Date().toISOString(),
  }));
}

function money(value) {
  return `¥${Number(value || 0).toFixed(2)}`;
}

function getStoreId() {
  return state.stores[0]?.id;
}

function getVisibleProducts() {
  return state.products
    .filter((product) => product.storeId === getStoreId() && product.active && !product.deletedAt)
    .filter((product) => state.activeCategory === "全部" || product.category === state.activeCategory)
    .sort((a, b) => a.sort - b.sort);
}

function getCartRows() {
  return Object.entries(state.cart)
    .map(([productId, quantity]) => {
      const product = state.products.find((item) => item.id === productId);
      if (!product) return null;
      return { product, quantity };
    })
    .filter(Boolean);
}

function cartTotal() {
  return getCartRows().reduce((sum, row) => sum + row.product.price * row.quantity, 0);
}

function render() {
  renderAuth();
  renderMember();
  renderWallet();
  renderSyncStatus();
  renderFulfillmentFields();
  renderSavedAddresses();
  renderCategories();
  renderProducts();
  renderCart();
}

function renderSyncStatus() {
  if (!els.syncStatus) return;
  if (state.localApi.ready) {
    els.syncStatus.textContent = "手机与后台同步中";
    els.syncStatus.className = "sync-status ok";
    return;
  }
  els.syncStatus.textContent = "本机数据，后台可能看不到";
  els.syncStatus.className = "sync-status warn";
}

function startLocalRefresh() {
  if (!state.localApi.ready || localRefreshTimer) return;
  localRefreshTimer = setInterval(async () => {
    try {
      const result = await callLocalApi("GET");
      if (result.data) {
        const cartSnapshot = { ...state.cart };
        applyData(result.data);
        state.cart = cartSnapshot;
        saveLocal(false);
        render();
      }
    } catch (error) {
      console.warn("[customer local refresh]", error);
    }
  }, 4000);
}

function getCheckedValue(name) {
  return document.querySelector(`input[name="${name}"]:checked`)?.value || "";
}

function todayValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function renderFulfillmentFields() {
  const fulfillmentType = getCheckedValue("fulfillmentType") || "pickup";
  const pickupMode = getCheckedValue("pickupMode") || "now";
  els.pickupFields.classList.toggle("hidden", fulfillmentType !== "pickup");
  els.scheduledPickupFields.classList.toggle("hidden", fulfillmentType !== "pickup" || pickupMode !== "scheduled");
  els.deliveryFields.classList.toggle("hidden", fulfillmentType !== "delivery");
  if (!els.pickupDate.value) els.pickupDate.value = todayValue();
  if (!els.deliveryDate.value) els.deliveryDate.value = todayValue();
  if (fulfillmentType === "delivery") fillPreferredAddress();
}

function getSavedAddresses() {
  return normalizeAddresses(state.customerProfile?.addresses);
}

function renderSavedAddresses() {
  if (!els.savedAddressSelect) return;
  const addresses = getSavedAddresses();
  els.savedAddressSelect.innerHTML = [
    '<option value="">填写新地址</option>',
    ...addresses.map(
      (item) => `<option value="${item.id}">${escapeHtml(item.address)}</option>`
    ),
  ].join("");
  const matched = addresses.find((item) => item.address === els.deliveryAddress.value.trim());
  els.savedAddressSelect.value = matched?.id || "";
}

function fillPreferredAddress() {
  if (els.deliveryAddress.value.trim()) return;
  const [address] = getSavedAddresses();
  if (!address) return;
  els.deliveryAddress.value = address.address;
  if (els.savedAddressSelect) els.savedAddressSelect.value = address.id;
}

function selectSavedAddress() {
  const address = getSavedAddresses().find((item) => item.id === els.savedAddressSelect.value);
  if (address) {
    els.deliveryAddress.value = address.address;
    return;
  }
  els.deliveryAddress.value = "";
}

function rememberDeliveryAddress(address) {
  if (!state.customerProfile || !els.saveDeliveryAddress?.checked) return;
  const addresses = getSavedAddresses().filter((item) => item.address !== address);
  addresses.unshift({
    id: createId("address"),
    address,
    updatedAt: new Date().toISOString(),
  });
  state.customerProfile.addresses = addresses.slice(0, 5);
  saveCustomerSession();
}

function buildFulfillmentInfo() {
  const fulfillmentType = getCheckedValue("fulfillmentType") || "pickup";
  if (fulfillmentType === "delivery") {
    const address = els.deliveryAddress.value.trim();
    const date = els.deliveryDate.value;
    const time = els.deliveryTime.value;
    if (!address) return { ok: false, message: "请选择配送时请填写配送地址。" };
    return {
      ok: true,
      fulfillmentType,
      pickupMode: "",
      pickupDate: "",
      pickupTime: "",
      deliveryAddress: address,
      deliveryDate: date,
      deliveryTime: time,
      fulfillmentLabel: `配送${date || time ? ` · ${[date, time].filter(Boolean).join(" ")}` : ""}`,
    };
  }

  const pickupMode = getCheckedValue("pickupMode") || "now";
  if (pickupMode === "now") {
    return {
      ok: true,
      fulfillmentType,
      pickupMode,
      pickupDate: "",
      pickupTime: "即时取餐",
      deliveryAddress: "",
      deliveryDate: "",
      deliveryTime: "",
      fulfillmentLabel: "到店取餐 · 即时取餐",
    };
  }

  const date = els.pickupDate.value;
  const time = els.pickupTime.value;
  if (!date || !time) return { ok: false, message: "预约取餐请填写取餐日期和时间。" };
  return {
    ok: true,
    fulfillmentType,
    pickupMode,
    pickupDate: date,
    pickupTime: time,
    deliveryAddress: "",
    deliveryDate: "",
    deliveryTime: "",
    fulfillmentLabel: `到店取餐 · ${date} ${time}`,
  };
}

function buildFulfillmentLabel(order) {
  if (order.fulfillmentLabel) return order.fulfillmentLabel;
  if (order.fulfillmentType === "delivery") {
    const when = [order.deliveryDate, order.deliveryTime].filter(Boolean).join(" ");
    return `配送${when ? ` · ${when}` : ""}`;
  }
  if (order.pickupMode === "scheduled") {
    return `到店取餐 · ${[order.pickupDate, order.pickupTime].filter(Boolean).join(" ")}`;
  }
  return `到店取餐 · ${order.pickupTime || "即时取餐"}`;
}

function renderAuth() {
  if (!state.customerProfile) {
    els.authStatus.textContent = "未授权。本地测试请点击模拟授权；正式小程序中将通过微信授权识别。";
    els.authorizeCustomer.classList.remove("hidden");
    return;
  }
  els.authorizeCustomer.classList.add("hidden");
  els.authStatus.textContent = `${state.customerProfile.name} · ${state.customerProfile.phone || "已授权微信身份"}`;
}

function renderMember() {
  const phone = normalizePhone(state.customerProfile?.phone);
  state.currentMember = phone ? state.members.find((member) => member.phone === phone) || null : null;
  if (!phone) {
    els.memberStatus.textContent = state.customerProfile ? "已识别微信身份，暂无手机号信息" : "授权后自动识别会员余额";
    els.joinMember.classList.toggle("hidden", !phone);
    els.openRecharge.classList.add("hidden");
    return;
  }
  if (!state.currentMember) {
    els.memberStatus.textContent = "当前手机号尚未加入会员，可加入后充值并使用余额支付";
    els.joinMember.classList.remove("hidden");
    els.openRecharge.classList.add("hidden");
    return;
  }
  els.memberStatus.textContent = `会员 ${state.currentMember.card || ""} · 余额 ${money(state.currentMember.balance)}`;
  els.joinMember.classList.add("hidden");
  els.openRecharge.classList.remove("hidden");
}

function renderWallet() {
  if (!els.walletStatus) return;
  if (!state.customerProfile) {
    els.walletStatus.textContent = "授权后查看";
    return;
  }
  const phone = normalizePhone(state.customerProfile.phone);
  const member = phone ? state.members.find((item) => item.phone === phone) : null;
  els.walletStatus.textContent = member ? `${member.card || "会员"} · ${money(member.balance)}` : "下单或充值后自动建档";
}

async function joinMemberFromPage() {
  if (!state.customerProfile) {
    els.orderHint.textContent = "请先完成微信授权。";
    return;
  }
  const phone = normalizePhone(state.customerProfile.phone);
  if (!phone) {
    els.orderHint.textContent = "当前授权没有手机号，无法创建会员档案。";
    return;
  }
  const member = getOrCreateMember(state.customerProfile.name || "微信顾客", phone);
  await saveAll();
  render();
  els.orderHint.textContent = `已加入会员，卡号 ${member.card}。`;
}

function openRechargeDialog() {
  if (!state.customerProfile) {
    els.orderHint.textContent = "请先完成微信授权。";
    return;
  }
  const phone = normalizePhone(state.customerProfile.phone);
  if (!phone) {
    els.orderHint.textContent = "当前授权没有手机号，无法充值。";
    return;
  }
  const member = getOrCreateMember(state.customerProfile.name || "微信顾客", phone);
  els.rechargeHint.textContent = `会员 ${member.card} · 当前余额 ${money(member.balance)}`;
  els.rechargeDialog.showModal();
}

function renderCategories() {
  const categories = [
    "全部",
    ...new Set(state.products.filter((product) => product.active && !product.deletedAt).map((product) => product.category)),
  ];
  if (!categories.includes(state.activeCategory)) state.activeCategory = "全部";
  els.categoryTabs.innerHTML = categories
    .map(
      (category) =>
        `<button class="${category === state.activeCategory ? "active" : ""}" data-category="${escapeHtml(category)}" type="button">${escapeHtml(category)}</button>`
    )
    .join("");
}

function renderProducts() {
  const products = getVisibleProducts();
  if (!products.length) {
    els.productGrid.innerHTML = '<div class="empty">当前分类暂无可点商品</div>';
    return;
  }
  els.productGrid.innerHTML = products
    .map(
      (product) => `
        <article class="product-card">
          <div class="product-image">${product.image ? `<img src="${escapeHtml(product.image)}" alt="">` : escapeHtml(product.name.slice(0, 1))}</div>
          <div>
            <h3>${escapeHtml(product.name)}</h3>
            <p>${escapeHtml(product.description || "暂无描述")}</p>
            <footer>
              <strong>${money(product.price)}</strong>
              <button data-add="${product.id}" ${product.soldOut ? "disabled" : ""} type="button">${product.soldOut ? "已售罄" : "加入购物车"}</button>
            </footer>
          </div>
        </article>
      `
    )
    .join("");
}

function renderCart() {
  const rows = getCartRows();
  const count = rows.reduce((sum, row) => sum + row.quantity, 0);
  els.cartCount.textContent = `${count} 件`;
  els.cartTotal.textContent = money(cartTotal());

  if (!rows.length) {
    els.cartPanel.classList.add("empty-cart");
    els.cartPanel.classList.remove("has-cart");
    els.cartItems.className = "cart-items empty";
    els.cartItems.textContent = "请先选择商品";
    return;
  }

  els.cartPanel.classList.remove("empty-cart");
  els.cartPanel.classList.add("has-cart");
  els.cartItems.className = "cart-items";
  els.cartItems.innerHTML = rows
    .map(
      ({ product, quantity }) => `
        <div class="cart-row">
          <div>
            <strong>${escapeHtml(product.name)}</strong>
            <span>${money(product.price)} × ${quantity}</span>
          </div>
          <div class="qty-control">
            <button data-minus="${product.id}" type="button">-</button>
            <strong>${quantity}</strong>
            <button data-plus="${product.id}" type="button">+</button>
          </div>
        </div>
      `
    )
    .join("");
}

function getOrCreateMember(name, phone) {
  const storeId = getStoreId();
  let member = state.members.find((item) => item.phone === phone && item.storeId === storeId);
  if (!member) member = state.members.find((item) => item.phone === phone);
  if (member) {
    member.storeId = storeId;
    if (!member.name || member.name === "微信顾客") member.name = name || member.name;
    member.updatedAt = new Date().toISOString();
    return member;
  }
  member = {
    id: createId("member"),
    storeId,
    name,
    phone,
    card: nextCardNumber(),
    balance: 0,
    note: "消费者端自动创建",
    createdAt: new Date().toISOString(),
  };
  state.members.push(member);
  return member;
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

function createRecord(member, type, amount, note) {
  return {
    id: createId("record"),
    memberId: member.id,
    storeId: getStoreId(),
    staffId: null,
    type,
    amount,
    bonusAmount: 0,
    balanceAfter: member.balance,
    note,
    createdAt: new Date().toISOString(),
  };
}

function createOrderNo() {
  const now = new Date();
  return `AW${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}${String(Date.now()).slice(-5)}`;
}

function paymentMethodLabel(method) {
  return {
    wechat_pay: "微信支付",
    alipay_pay: "支付宝",
    member_balance: "会员余额支付",
  }[method] || "在线支付";
}

function paymentHint(method = els.paymentMethod.value) {
  return {
    wechat_pay: "微信内完成付款后自动下单",
    alipay_pay: "将跳转支付宝 App 或外部浏览器完成付款",
    member_balance: "使用会员余额立即扣款",
  }[method] || "付款成功后自动下单";
}

function renderPaymentHint() {
  if (els.paymentHint) els.paymentHint.textContent = paymentHint();
}

async function requestExternalLikePayment(paymentMethod, amount, orderNo, scene) {
  if (paymentMethod === "alipay_pay") {
    const payUrl = `alipay-mock.html?orderNo=${encodeURIComponent(orderNo)}&amount=${encodeURIComponent(amount.toFixed(2))}&scene=${encodeURIComponent(scene)}`;
    const payWindow = window.open(payUrl, "_blank");
    const done = window.confirm("已打开支付宝支付页面。请在支付宝 App 或外部浏览器完成付款后，再点“确定”完成本地测试入账。");
    if (!done) return { ok: false, message: "支付宝支付未确认，未入账。" };
    return {
      ok: true,
      paidAmount: amount,
      paymentStatus: "paid",
      paymentTradeNo: `LOCAL-ALIPAY-${Date.now()}`,
      paymentRedirect: "external_alipay",
      paymentExternalUrl: payUrl,
      paymentNote: payWindow
        ? "支付宝本地模拟支付完成"
        : "支付宝本地模拟支付完成；浏览器可能拦截了新窗口",
    };
  }

  const done = window.confirm(`本地测试：请确认${paymentMethodLabel(paymentMethod)}已完成付款。`);
  if (!done) return { ok: false, message: `${paymentMethodLabel(paymentMethod)}未确认，未入账。` };
  return {
    ok: true,
    paidAmount: amount,
    paymentStatus: "paid",
    paymentTradeNo: `LOCAL-${paymentMethod}-${Date.now()}`,
    paymentRedirect: "in_wechat",
    paymentNote: `${paymentMethodLabel(paymentMethod)}本地模拟支付完成`,
  };
}

async function requestPayment(paymentMethod, amount, orderNo, member) {
  if (paymentMethod === "member_balance") {
    if (member.balance < amount) {
      return { ok: false, message: `会员余额不足，当前余额 ${money(member.balance)}。` };
    }
    member.balance -= amount;
    state.records.push(createRecord(member, "spend", amount, `订单 ${orderNo} 会员余额支付`));
    return {
      ok: true,
      paidAmount: amount,
      paymentStatus: "paid",
      paymentTradeNo: `BALANCE-${orderNo}`,
    };
  }

  return requestExternalLikePayment(paymentMethod, amount, orderNo, "order");
}

async function submitOrder() {
  if (!state.customerProfile) {
    els.orderHint.textContent = "请先完成微信授权。";
    return;
  }
  const name = state.customerProfile.name || "微信顾客";
  const phone = normalizePhone(state.customerProfile.phone);
  const rows = getCartRows();
  const total = cartTotal();
  if (!phone) {
    els.orderHint.textContent = "当前授权没有手机号。正式小程序需完成手机号授权后再下单。";
    return;
  }
  if (!rows.length) {
    els.orderHint.textContent = "请先选择商品。";
    return;
  }
  const fulfillment = buildFulfillmentInfo();
  if (!fulfillment.ok) {
    els.orderHint.textContent = fulfillment.message;
    return;
  }
  if (
    fulfillment.fulfillmentType === "delivery" &&
    !window.confirm(`请确认配送地址：\n${fulfillment.deliveryAddress}\n\n送达时间：${[fulfillment.deliveryDate, fulfillment.deliveryTime].filter(Boolean).join(" ") || "尽快送达"}`)
  ) {
    els.orderHint.textContent = "请确认配送地址后再提交订单。";
    return;
  }

  const member = getOrCreateMember(name, phone);
  const paymentMethod = els.paymentMethod.value;
  const orderNo = createOrderNo();
  els.orderHint.textContent = `正在发起${paymentMethodLabel(paymentMethod)}...`;
  const payment = await requestPayment(paymentMethod, total, orderNo, member);
  if (!payment.ok) {
    els.orderHint.textContent = payment.message || "支付未完成，请重新选择支付方式。";
    return;
  }

  const sourceParts = [];
  if (urlParams.get("table")) sourceParts.push(`桌号/取餐点：${urlParams.get("table")}`);
  if (urlParams.get("source")) sourceParts.push(`来源：${urlParams.get("source")}`);
  const customerNote = [els.orderNote.value.trim(), ...sourceParts].filter(Boolean).join("；");

  const order = {
    id: createId("order"),
    orderNo,
    storeId: getStoreId(),
    customerName: name,
    customerPhone: phone,
    customerOpenid: state.customerProfile.openid,
    memberId: member.id,
    isMember: true,
    items: rows.map(({ product, quantity }) => ({
      productId: product.id,
      name: product.name,
      category: product.category,
      price: product.price,
      quantity,
      refundedQuantity: 0,
      refundAmount: 0,
      itemStatus: "normal",
    })),
    totalAmount: total,
    paidAmount: payment.paidAmount,
    refundAmount: 0,
    adjustmentAmount: 0,
    status: "pending",
    paymentStatus: payment.paymentStatus,
    paymentMethod,
    paymentTradeNo: payment.paymentTradeNo,
    paymentRedirect: payment.paymentRedirect || "",
    paymentExternalUrl: payment.paymentExternalUrl || "",
    fulfillmentType: fulfillment.fulfillmentType,
    pickupMode: fulfillment.pickupMode,
    pickupDate: fulfillment.pickupDate,
    pickupTime: fulfillment.pickupTime,
    deliveryAddress: fulfillment.deliveryAddress,
    deliveryDate: fulfillment.deliveryDate,
    deliveryTime: fulfillment.deliveryTime,
    fulfillmentLabel: fulfillment.fulfillmentLabel,
    note: [customerNote, payment.paymentNote].filter(Boolean).join("；"),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  state.orders.push(order);
  if (fulfillment.fulfillmentType === "delivery") {
    rememberDeliveryAddress(fulfillment.deliveryAddress);
  }
  state.cart = {};
  els.orderNote.value = "";
  await saveAll();
  render();
  els.orderHint.textContent = `${paymentMethodLabel(paymentMethod)}完成，订单 ${order.orderNo} 已提交，${order.fulfillmentLabel}。`;
}

async function submitRecharge(event) {
  event.preventDefault();
  if (!state.customerProfile) {
    els.orderHint.textContent = "请先完成微信授权。";
    return;
  }
  const name = state.customerProfile.name || "微信顾客";
  const phone = normalizePhone(state.customerProfile.phone);
  const amount = Number(els.rechargeAmount.value);
  if (!name || !phone || !Number.isFinite(amount) || amount <= 0) {
    els.orderHint.textContent = "充值前请填写姓名、手机号和正确金额。";
    return;
  }
  const member = getOrCreateMember(name, phone);
  const paymentMethod = els.rechargePaymentMethod.value;
  els.rechargeHint.textContent = `正在发起${paymentMethodLabel(paymentMethod)}充值...`;
  const payment = await requestExternalLikePayment(paymentMethod, amount, `RC${Date.now()}`, "recharge");
  if (!payment.ok) {
    els.rechargeHint.textContent = payment.message || "充值支付未完成，余额未增加。";
    return;
  }
  member.balance += amount;
  state.records.push(createRecord(member, "recharge", amount, `消费者端充值 · ${paymentMethodLabel(paymentMethod)} · ${payment.paymentTradeNo}`));
  els.rechargeAmount.value = "";
  await saveAll();
  render();
  renderWallet();
  els.rechargeDialog.close();
  els.orderHint.textContent = `充值已记录，当前余额 ${money(member.balance)}。`;
}

function renderHistory() {
  renderWallet();
  if (!state.customerProfile) {
    els.historyList.className = "history-list empty";
    els.historyList.textContent = "请先完成微信授权后查看订单";
    return;
  }
  const phone = normalizePhone(state.customerProfile.phone);
  const orders = state.orders
    .filter((order) => order.customerPhone === phone || order.customerOpenid === state.customerProfile.openid)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  if (!orders.length) {
    els.historyList.className = "history-list empty";
    els.historyList.textContent = "当前手机号暂无订单";
    return;
  }
  els.historyList.className = "history-list";
  els.historyList.innerHTML = orders
    .map(
      (order) => `
        <article class="history-card">
          <div><strong>${escapeHtml(order.orderNo)}</strong> · ${statusLabel(order.status)}</div>
          <p>${escapeHtml(order.items.map((item) => `${item.name}×${item.quantity}`).join("，"))}</p>
          <div>${money(order.totalAmount)} · ${escapeHtml(buildFulfillmentLabel(order))}</div>
          <div>${paymentMethodLabel(order.paymentMethod)} · ${order.paymentStatus === "paid" ? "已支付" : "未支付"}</div>
        </article>
      `
    )
    .join("");
}

function statusLabel(status) {
  return {
    pending: "待接单",
    making: "制作中",
    ready: "待取餐",
    completed: "已完成",
    cancelled: "已取消",
    refunded: "已退款",
    partial_refund: "部分退款",
  }[status] || "处理中";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

els.authorizeCustomer.addEventListener("click", authorizeCustomer);
els.fulfillmentTypes.forEach((input) => input.addEventListener("change", renderFulfillmentFields));
els.pickupModes.forEach((input) => input.addEventListener("change", renderFulfillmentFields));
els.savedAddressSelect.addEventListener("change", selectSavedAddress);
els.joinMember.addEventListener("click", joinMemberFromPage);
els.openRecharge.addEventListener("click", openRechargeDialog);
els.closeRecharge.addEventListener("click", () => els.rechargeDialog.close());
els.paymentMethod.addEventListener("change", renderPaymentHint);
els.rechargeForm.addEventListener("submit", submitRecharge);
els.categoryTabs.addEventListener("click", (event) => {
  const button = event.target.closest("[data-category]");
  if (!button) return;
  state.activeCategory = button.dataset.category;
  render();
});
els.productGrid.addEventListener("click", (event) => {
  const button = event.target.closest("[data-add]");
  if (!button) return;
  state.cart[button.dataset.add] = (state.cart[button.dataset.add] || 0) + 1;
  renderCart();
});
els.cartItems.addEventListener("click", (event) => {
  const plus = event.target.closest("[data-plus]");
  const minus = event.target.closest("[data-minus]");
  const id = plus?.dataset.plus || minus?.dataset.minus;
  if (!id) return;
  state.cart[id] = (state.cart[id] || 0) + (plus ? 1 : -1);
  if (state.cart[id] <= 0) delete state.cart[id];
  renderCart();
});
els.submitOrder.addEventListener("click", submitOrder);
els.historyToggle.addEventListener("click", () => {
  renderHistory();
  els.historyDialog.showModal();
});
els.closeHistory.addEventListener("click", () => els.historyDialog.close());

initCloudBase().finally(async () => {
  loadLocal();
  loadCustomerSession();
  await initLocalApi();
  await syncFromCloud();
  render();
  renderPaymentHint();
  startLocalRefresh();
});
