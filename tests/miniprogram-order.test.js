const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadOrderPage() {
  let pageDefinition;
  const toasts = [];
  const cloudCalls = [];
  const phoneCalls = [];
  const app = {
    globalData: {
      storeId: "store_aiwa_pizza_main",
      membershipFunction: "membershipApi",
      payFunction: "partnerPay",
      payCallType: "cloudFunction",
    },
  };
  const wx = {
    getStorageSync() { return ""; },
    setStorageSync() {},
    showToast: (value) => toasts.push(value),
    showLoading() {},
    hideLoading() {},
    stopPullDownRefresh() {},
    navigateTo() {},
    showModal() {},
    makePhoneCall: (value) => phoneCalls.push(value),
    requestPayment: async () => {},
    getLocation: async () => ({ latitude: 31.2304, longitude: 121.4737 }),
    cloud: {
      callFunction: async (request) => {
        cloudCalls.push(request);
        return { result: { ok: true } };
      },
    },
  };

  const source = fs.readFileSync(
    path.join(__dirname, "../miniprogram/pages/order/order.js"),
    "utf8"
  );
  vm.runInNewContext(source, {
    getApp: () => app,
    Page: (definition) => {
      pageDefinition = definition;
    },
    wx,
    console,
    Date,
    Math,
    Number,
    Object,
    String,
    Set,
    Promise,
    setTimeout,
    clearTimeout,
  });

  const page = {
    ...pageDefinition,
    data: structuredClone(pageDefinition.data),
    setData(patch) {
      Object.assign(this.data, patch);
    },
  };
  return { page, app, wx, toasts, cloudCalls, phoneCalls };
}

function event(dataset = {}, detail = {}) {
  return { currentTarget: { dataset }, detail };
}

test("customer service entry dials the configured phone number", () => {
  const { page, phoneCalls } = loadOrderPage();
  page.callCustomerService();
  assert.equal(phoneCalls.length, 1);
  assert.equal(phoneCalls[0].phoneNumber, "13230807901");
});

test("cart totals and count stay consistent when quantities change", () => {
  const { page } = loadOrderPage();
  page.data.products = [
    { id: "p1", name: "披萨", price: 39 },
    { id: "p2", name: "饮品", price: 12 },
  ];

  page.addToCart(event({ id: "p1" }));
  page.addToCart(event({ id: "p1" }));
  page.addToCart(event({ id: "p2" }));

  assert.equal(page.data.cartCount, 3);
  assert.equal(page.data.cartTotal, 90);
  assert.equal(page.data.cartTotalText, "90.00");

  page.decreaseCart(event({ id: "p1" }));
  assert.equal(page.data.cartCount, 2);
  assert.equal(page.data.cartTotal, 51);
});

test("category selection filters visible products", () => {
  const { page } = loadOrderPage();
  page.data.products = [
    { id: "p1", category: "披萨", price: 39 },
    { id: "p2", category: "饮品", price: 12 },
  ];

  page.setCategory(event({ name: "饮品" }));
  assert.deepEqual(page.data.visibleProducts.map((item) => item.id), ["p2"]);
});

test("scheduled pickup cannot submit without date and time", async () => {
  const { page, toasts, cloudCalls } = loadOrderPage();
  page.data.cartRows = [{ product: { id: "p1" }, quantity: 1 }];
  page.data.fulfillmentType = "pickup";
  page.data.pickupMode = "scheduled";

  await page.submitOrder();
  assert.equal(toasts.at(-1).title, "请选择预约取餐时间");
  assert.equal(cloudCalls.length, 0);
});

test("delivery cannot submit without an address", async () => {
  const { page, toasts, cloudCalls } = loadOrderPage();
  page.data.cartRows = [{ product: { id: "p1" }, quantity: 1 }];
  page.data.fulfillmentType = "delivery";
  page.data.deliveryAddress = "   ";

  await page.submitOrder();
  assert.equal(toasts.at(-1).title, "请填写配送地址");
  assert.equal(cloudCalls.length, 0);
});

test("delivery requires confirmation that the address is in the supported community area", async () => {
  const { page, toasts, cloudCalls } = loadOrderPage();
  page.data.cartRows = [{ product: { id: "p1" }, quantity: 1 }];
  page.data.fulfillmentType = "delivery";
  page.data.deliveryAddress = "滨河村某小区1号楼";
  page.data.deliveryRecipientName = "收货人";
  page.data.deliveryRecipientPhone = "13800138000";
  page.data.deliveryAreaConfirmed = false;

  await page.submitOrder();
  assert.equal(toasts.at(-1).title, "请确认地址属于可配送区域");
  assert.equal(cloudCalls.length, 0);
});

test("recharge rejects amounts outside the supported range", async () => {
  const { page, toasts, cloudCalls } = loadOrderPage();
  page.data.currentMember = { id: "member-1", balance: 0 };
  page.data.rechargeAmount = "5000.01";

  await page.submitRecharge();
  assert.equal(toasts.at(-1).title, "请输入 0.01 至 5000 元");
  assert.equal(cloudCalls.length, 0);
});

test("joining a member requires a WeChat phone authorization code", async () => {
  const { page, toasts, cloudCalls } = loadOrderPage();
  page.data.memberNameInput = "测试昵称";
  await page.joinMember({ detail: {} });
  assert.equal(toasts.at(-1).title, "需要授权手机号才能加入会员");
  assert.equal(cloudCalls.length, 0);
});

test("home allows browsing before the user chooses to join as a member", () => {
  const { page } = loadOrderPage();
  assert.equal(page.data.authRequired, false);

  page.openMemberJoin();
  assert.equal(page.data.authRequired, true);

  page.closeMemberJoin();
  assert.equal(page.data.authRequired, false);
});

test("checkout asks for phone verification only after the user chooses to submit", async () => {
  const { page, toasts, cloudCalls } = loadOrderPage();
  page.data.cartRows = [{ product: { id: "p1" }, quantity: 1 }];
  page.data.fulfillmentType = "pickup";
  page.data.pickupMode = "now";

  await page.submitOrder();

  assert.equal(page.data.authRequired, true);
  assert.equal(toasts.at(-1).title, "结算前请先验证手机号");
  assert.equal(cloudCalls.length, 0);
});

test("joining a member requires a nickname before phone authorization", async () => {
  const { page, toasts, cloudCalls } = loadOrderPage();
  await page.joinMember({ detail: { code: "valid-phone-code" } });
  assert.equal(toasts.at(-1).title, "请先填写会员昵称");
  assert.equal(cloudCalls.length, 0);
});

test("delivery requires a separate recipient name and phone", async () => {
  const { page, toasts, cloudCalls } = loadOrderPage();
  page.data.cartRows = [{ product: { id: "p1" }, quantity: 1 }];
  page.data.fulfillmentType = "delivery";
  page.data.deliveryAddress = "滨河村某小区1号楼";
  page.data.deliveryAreaConfirmed = true;
  await page.submitOrder();
  assert.equal(toasts.at(-1).title, "请填写收货人姓名");
  page.data.deliveryRecipientName = "代收人";
  await page.submitOrder();
  assert.equal(toasts.at(-1).title, "请填写正确的收货人手机号");
  assert.equal(cloudCalls.length, 0);
});

test("order draft carries item, fulfillment, note and payment data", () => {
  const { page } = loadOrderPage();
  page.data.store = { id: "store-1" };
  page.data.customer = { phone: "13900000000", name: "测试顾客" };
  page.data.cartRows = [{
    product: { id: "p1", name: "测试披萨", category: "披萨", price: 0.1 },
    quantity: 2,
  }];
  page.data.cartTotal = 0.2;
  page.data.fulfillmentType = "pickup";
  page.data.pickupMode = "now";
  page.data.orderNote = "不要辣";
  page.data.paymentMethod = "member_balance";

  const draft = page.buildOrderDraft();
  assert.equal(draft.items[0].quantity, 2);
  assert.equal(draft.totalAmount, 0.2);
  assert.equal(draft.note, "不要辣");
  assert.equal(draft.paymentMethod, "member_balance");
});

test("delivery draft carries recipient independently from member profile", () => {
  const { page } = loadOrderPage();
  page.data.customer = { phone: "13900000000", name: "会员本人" };
  page.data.fulfillmentType = "delivery";
  page.data.deliveryRecipientName = "收货朋友";
  page.data.deliveryRecipientPhone = "13800138000";
  const draft = page.buildOrderDraft();
  assert.equal(draft.deliveryRecipientName, "收货朋友");
  assert.equal(draft.deliveryRecipientPhone, "13800138000");
});

test("delivery fee is added below 58 yuan and waived at 58 yuan", () => {
  const { page } = loadOrderPage();
  page.data.fulfillmentType = "delivery";
  page.data.deliverySettings = { fee: 5, freeThreshold: 58, maxDistanceKm: 3 };
  page.data.cartRows = [{ product: { id: "p1", name: "披萨", price: 57 }, quantity: 1 }];
  page.data.cartTotal = 57;
  assert.equal(page.buildOrderDraft().deliveryFee, 5);
  assert.equal(page.buildOrderDraft().totalAmount, 62);

  page.data.cartTotal = 58;
  assert.equal(page.buildOrderDraft().deliveryFee, 0);
  assert.equal(page.buildOrderDraft().totalAmount, 58);
});

test("customer order history displays the delivery-in-progress status", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../miniprogram/pages/orders/orders.js"),
    "utf8"
  );
  assert.match(source, /delivering:\s*"配送中"/);
});

test("successful orders show a persistent confirmation with order number", () => {
  const { page } = loadOrderPage();
  page.showOrderSuccess({ orderNo: "AW-SUCCESS-1", fulfillmentType: "delivery" });
  assert.equal(page.data.orderSuccessOpen, true);
  assert.equal(page.data.orderSuccessNo, "AW-SUCCESS-1");
  assert.match(page.data.orderSuccessMessage, /配送/);
  page.closeOrderSuccess();
  assert.equal(page.data.orderSuccessOpen, false);
});

test("phone authorization has an explicit timeout and visible failure dialog", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../miniprogram/pages/order/order.js"),
    "utf8"
  );
  assert.match(source, /withTimeout\(wx\.cloud\.callFunction/);
  assert.match(source, /8000, "手机号授权响应超时/);
  assert.match(source, /title: "手机号授权未完成"/);
  assert.ok(source.indexOf("wx.hideLoading();") < source.indexOf('wx.showModal({\n        title: "手机号授权未完成"'));
});
