const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function matches(row, criteria) {
  return Object.entries(criteria || {}).every(([key, value]) => row[key] === value);
}

function createDatabase(seed = {}) {
  const collections = new Map(
    Object.entries(seed).map(([name, rows]) => [
      name,
      new Map(rows.map((row) => [row._id || row.id, { ...row }])),
    ])
  );

  function getCollection(name) {
    if (!collections.has(name)) collections.set(name, new Map());
    return collections.get(name);
  }

  return {
    collections,
    createCollection: async (name) => {
      getCollection(name);
    },
    collection(name) {
      const rows = getCollection(name);
      const query = {
        _where: null,
        _limit: 1000,
        where(criteria) {
          this._where = criteria;
          return this;
        },
        limit(value) {
          this._limit = value;
          return this;
        },
        async get() {
          return {
            data: Array.from(rows.values())
              .filter((row) => matches(row, this._where))
              .slice(0, this._limit)
              .map((row) => ({ ...row })),
          };
        },
        doc(id) {
          return {
            async get() {
              return { data: rows.has(id) ? { ...rows.get(id) } : null };
            },
            async set({ data }) {
              rows.set(id, { _id: id, ...data });
            },
            async update({ data }) {
              if (!rows.has(id)) throw new Error("document not found");
              rows.set(id, { ...rows.get(id), ...data, _id: id });
            },
            async remove() {
              rows.delete(id);
            },
          };
        },
      };
      return query;
    },
  };
}

function loadMembershipApi(seed = {}, openid = "openid-test", callFunction = async () => ({
  result: { ok: true, refundId: "WX-REFUND-TEST", outRefundNo: "RF-TEST", status: "PROCESSING" },
})) {
  const database = createDatabase(seed);
  const cloud = {
    DYNAMIC_CURRENT_ENV: "test",
    init() {},
    database: () => database,
    getWXContext: () => ({ OPENID: openid }),
    callFunction,
    uploadFile: async ({ cloudPath }) => ({ fileID: `cloud://test-env.${cloudPath}` }),
    getTempFileURL: async ({ fileList }) => ({
      fileList: fileList.map((fileID) => ({
        fileID,
        tempFileURL: `https://example.test/${encodeURIComponent(fileID)}`,
      })),
    }),
    openapi: {
      phonenumber: {
        getPhoneNumber: async () => ({
          phoneInfo: { purePhoneNumber: "13900000000" },
        }),
      },
    },
  };
  const module = { exports: {} };
  const source = fs.readFileSync(
    path.join(__dirname, "../cloudfunctions/membershipApi/index.js"),
    "utf8"
  );
  vm.runInNewContext(source, {
    module,
    exports: module.exports,
    require(name) {
      if (name === "wx-server-sdk") return cloud;
      if (name === "crypto") return require("node:crypto");
      if (name === "tencentcloud-sdk-nodejs") return {};
      throw new Error(`Unexpected dependency: ${name}`);
    },
    process: {
      env: {
        STORE_MANAGER_NAME: "张锦云",
        STORE_MANAGER_PHONE: "13933378101",
        INTERNAL_PAYMENT_SECRET: "test-payment-secret",
      },
    },
    console,
    Date,
    Math,
    Number,
    Object,
    String,
    Set,
    Map,
    Promise,
    Buffer,
  });
  return { main: module.exports.main, database };
}

function baseSeed() {
  return {
    stores: [{
      _id: "store_aiwa_pizza_main",
      id: "store_aiwa_pizza_main",
      name: "爱娃披萨店",
    }],
    staff: [{
      _id: "staff_aiwa_manager",
      id: "staff_aiwa_manager",
      storeId: "store_aiwa_pizza_main",
      name: "张锦云",
      phone: "13933378101",
      role: "manager",
      active: true,
    }],
    members: [{
      _id: "member-1",
      id: "member-1",
      storeId: "store_aiwa_pizza_main",
      name: "自动化会员",
      phone: "13900000000",
      openid: "openid-test",
      card: "AW0001",
      balance: 100,
    }],
    categories: [{
      _id: "category-1",
      id: "category-1",
      storeId: "store_aiwa_pizza_main",
      name: "披萨",
      sort: 1,
    }],
    products: [{
      _id: "product-1",
      id: "product-1",
      storeId: "store_aiwa_pizza_main",
      name: "自动化披萨",
      category: "披萨",
      price: 39,
      active: true,
      soldOut: false,
      sort: 1,
    }],
    transactions: [],
    orders: [],
    refunds: [],
    bonusrules: [],
  };
}

test("membership balance order deducts balance and records a paid order", async () => {
  const { main, database } = loadMembershipApi(baseSeed());
  const result = await main({
    action: "createMiniProgramOrder",
    payload: {
      storeId: "store_aiwa_pizza_main",
      customer: { phone: "13900000000", name: "自动化会员" },
      items: [{ productId: "product-1", quantity: 2 }],
      fulfillmentType: "pickup",
      pickupMode: "now",
      paymentMethod: "member_balance",
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.order.totalAmount, 78);
  assert.equal(result.order.paymentStatus, "paid");
  assert.equal(database.collections.get("members").get("member-1").balance, 22);
  assert.equal(database.collections.get("orders").size, 1);
  assert.equal(database.collections.get("transactions").size, 1);
});

test("phone authorization and normal ordering do not create a member", async () => {
  const seed = baseSeed();
  seed.members = [];
  const { main, database } = loadMembershipApi(seed, "openid-nonmember");

  const authorized = await main({
    action: "authorizeMiniProgramPhone",
    payload: { phoneCode: "valid-phone-code", storeId: "store_aiwa_pizza_main" },
  });
  assert.equal(authorized.ok, true);
  assert.equal(authorized.member, null);
  assert.equal(database.collections.get("members").size, 0);

  const order = await main({
    action: "createMiniProgramPendingOrder",
    payload: {
      storeId: "store_aiwa_pizza_main",
      customer: { phone: "13900000000", name: "普通顾客" },
      items: [{ productId: "product-1", quantity: 1 }],
      fulfillmentType: "pickup",
      pickupMode: "now",
      paymentMethod: "wechat_pay",
    },
  });
  assert.equal(order.ok, true);
  assert.equal(order.order.memberId, "");
  assert.equal(order.order.isMember, false);
  assert.equal(database.collections.get("members").size, 0);
});

test("explicit recharge enrollment creates one member after phone authorization", async () => {
  const seed = baseSeed();
  seed.members = [];
  const { main, database } = loadMembershipApi(seed, "openid-recharge-member");
  await main({
    action: "authorizeMiniProgramPhone",
    payload: { phoneCode: "valid-phone-code", storeId: "store_aiwa_pizza_main" },
  });
  const joined = await main({
    action: "createMiniProgramMember",
    payload: { storeId: "store_aiwa_pizza_main", name: "充值会员" },
  });
  assert.equal(joined.ok, true);
  assert.equal(joined.member.phone, "13900000000");
  assert.equal(database.collections.get("members").size, 1);
});

test("recharge confirmation is idempotent", async () => {
  const { main, database } = loadMembershipApi(baseSeed());
  const payload = {
    rechargeNo: "RC-AUTOMATION-1",
    memberId: "member-1",
    paidTotalInCents: 5000,
    payerOpenid: "openid-test",
    paymentTradeNo: "WX-RECHARGE-1",
    internalPaymentSecret: "test-payment-secret",
  };
  const first = await main({ action: "confirmPaidMiniProgramRecharge", payload });
  const second = await main({ action: "confirmPaidMiniProgramRecharge", payload });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.duplicated, true);
  assert.equal(database.collections.get("members").get("member-1").balance, 150);
  assert.equal(database.collections.get("transactions").size, 1);
});

test("recharge confirmation rejects unverified client requests", async () => {
  const { main, database } = loadMembershipApi(baseSeed());
  const result = await main({
    action: "confirmPaidMiniProgramRecharge",
    payload: {
      rechargeNo: "RC-FORGED-1",
      memberId: "member-1",
      paidTotalInCents: 500000,
      payerOpenid: "openid-test",
    },
  });

  assert.equal(result.ok, false);
  assert.equal(database.collections.get("members").get("member-1").balance, 100);
  assert.equal(database.collections.get("transactions").size, 0);
});

test("wechat paid order refund uses the original payment channel without crediting member balance", async () => {
  const seed = baseSeed();
  const sessionToken = "c".repeat(64);
  seed.admin_sessions = [{
    _id: sessionToken,
    id: sessionToken,
    staffId: "staff_aiwa_manager",
    storeId: "store_aiwa_pizza_main",
    expiresAt: Date.now() + 60 * 60 * 1000,
  }];
  seed.orders.push({
    _id: "order-wechat-1",
    id: "order-wechat-1",
    orderNo: "OD202608250001",
    storeId: "store_aiwa_pizza_main",
    memberId: "member-1",
    totalAmount: 39,
    refundAmount: 0,
    paymentStatus: "paid",
    paymentMethod: "wechat_pay",
    status: "pending",
  });
  const calls = [];
  const { main, database } = loadMembershipApi(seed, "openid-test", async (request) => {
    calls.push(request);
    return {
      result: {
        ok: true,
        refundId: "WX-REFUND-1",
        outRefundNo: request.data.payload.out_refund_no,
        status: "PROCESSING",
      },
    };
  });

  const result = await main({
    action: "refundOrder",
    payload: { sessionToken, orderId: "order-wechat-1", amount: 10, reason: "顾客申请退款" },
  });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "partnerPay");
  assert.equal(calls[0].data.action, "refundJsapiOrder");
  assert.equal(calls[0].data.payload.amount.refund, 1000);
  assert.equal(result.refund.method, "wechat_pay");
  assert.equal(result.refund.status, "processing");
  assert.equal(database.collections.get("members").get("member-1").balance, 100);
  assert.equal(database.collections.get("transactions").size, 0);
  assert.equal(database.collections.get("orders").get("order-wechat-1").refundAmount, 10);
});

test("wechat refund failure leaves order and member balance unchanged", async () => {
  const seed = baseSeed();
  const sessionToken = "d".repeat(64);
  seed.admin_sessions = [{
    _id: sessionToken,
    id: sessionToken,
    staffId: "staff_aiwa_manager",
    storeId: "store_aiwa_pizza_main",
    expiresAt: Date.now() + 60 * 60 * 1000,
  }];
  seed.orders.push({
    _id: "order-wechat-failed",
    id: "order-wechat-failed",
    orderNo: "OD202608250002",
    storeId: "store_aiwa_pizza_main",
    memberId: "member-1",
    totalAmount: 39,
    refundAmount: 0,
    paymentStatus: "paid",
    paymentMethod: "wechat_pay",
    status: "pending",
  });
  const { main, database } = loadMembershipApi(seed, "openid-test", async () => ({
    result: { ok: false, message: "微信支付拒绝退款" },
  }));

  const result = await main({
    action: "refundOrder",
    payload: { sessionToken, orderId: "order-wechat-failed", amount: 10, reason: "顾客申请退款" },
  });

  assert.equal(result.ok, false);
  assert.equal(database.collections.get("members").get("member-1").balance, 100);
  assert.equal(database.collections.get("refunds").size, 0);
  assert.equal(database.collections.get("orders").get("order-wechat-failed").refundAmount, 0);
});

test("accepted orders cannot be refunded", async () => {
  const seed = baseSeed();
  const sessionToken = "e".repeat(64);
  seed.admin_sessions = [{
    _id: sessionToken,
    id: sessionToken,
    staffId: "staff_aiwa_manager",
    storeId: "store_aiwa_pizza_main",
    expiresAt: Date.now() + 60 * 60 * 1000,
  }];
  seed.orders.push({
    _id: "order-accepted-1",
    id: "order-accepted-1",
    orderNo: "OD202610070001",
    storeId: "store_aiwa_pizza_main",
    memberId: "member-1",
    totalAmount: 39,
    refundAmount: 0,
    paymentStatus: "paid",
    paymentMethod: "member_balance",
    status: "making",
  });
  const { main, database } = loadMembershipApi(seed);
  const result = await main({
    action: "refundOrder",
    payload: { sessionToken, orderId: "order-accepted-1", amount: 39, reason: "接单后退款" },
  });

  assert.equal(result.ok, false);
  assert.match(result.message, /接单后不可退款/);
  assert.equal(database.collections.get("refunds").size, 0);
  assert.equal(database.collections.get("members").get("member-1").balance, 100);
});

test("admin data sync cannot create a member", async () => {
  const seed = baseSeed();
  const sessionToken = "f".repeat(64);
  seed.admin_sessions = [{
    _id: sessionToken,
    id: sessionToken,
    staffId: "staff_aiwa_manager",
    storeId: "store_aiwa_pizza_main",
    expiresAt: Date.now() + 60 * 60 * 1000,
  }];
  const { main, database } = loadMembershipApi(seed);
  const result = await main({
    action: "saveStoreData",
    payload: {
      sessionToken,
      data: {
        members: [{ ...seed.members[0], name: "后台篡改姓名", balance: 9999 }, {
          id: "member-created-from-admin",
          storeId: "store_aiwa_pizza_main",
          name: "后台新增会员",
          phone: "13800138000",
          card: "AW9999",
          balance: 0,
        }],
        settings: { bonusRules: seed.bonusrules },
      },
    },
  });

  assert.equal(result.ok, true);
  assert.match(result.warnings.join("；"), /后台不允许新增会员/);
  assert.equal(database.collections.get("members").has("member-created-from-admin"), false);
  assert.equal(database.collections.get("members").get("member-1").name, "自动化会员");
  assert.equal(database.collections.get("members").get("member-1").balance, 100);
});

test("staff can modify delivery settings but not bonus rules or staff management data", async () => {
  const seed = baseSeed();
  const sessionToken = "a".repeat(64);
  seed.staff.push({
    _id: "staff-clerk-1",
    id: "staff-clerk-1",
    storeId: "store_aiwa_pizza_main",
    name: "普通店员",
    phone: "13900000000",
    role: "staff",
    active: true,
  });
  seed.admin_sessions = [{
    _id: sessionToken,
    id: sessionToken,
    staffId: "staff-clerk-1",
    storeId: "store_aiwa_pizza_main",
    expiresAt: Date.now() + 60 * 60 * 1000,
  }];
  seed.bonusrules = [{
    _id: "bonus-rule-1",
    id: "bonus-rule-1",
    storeId: "store_aiwa_pizza_main",
    minAmount: 100,
    bonusAmount: 10,
  }];

  const { main, database } = loadMembershipApi(seed);
  const result = await main({
    action: "saveStoreData",
    payload: {
      sessionToken,
      data: {
        stores: seed.stores,
        staff: seed.staff.map((row) => ({ ...row, role: "manager" })),
        members: seed.members,
        records: seed.transactions,
        categories: seed.categories,
        products: seed.products.map((row) => ({ ...row, name: "店员可编辑商品" })),
        orders: seed.orders,
        refunds: seed.refunds,
        settings: {
          delivery: {
            fee: 6,
            freeThreshold: 68,
            storeLatitude: 39.917301,
            storeLongitude: 116.14803,
            testMode: true,
          },
          bonusRules: [{
            id: "bonus-rule-malicious",
            storeId: "store_aiwa_pizza_main",
            minAmount: 1,
            bonusAmount: 999,
          }],
        },
      },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.warnings.length, 2);
  assert.equal(database.collections.get("staff").get("staff-clerk-1").role, "staff");
  assert.equal(database.collections.get("bonusrules").size, 1);
  assert.equal(database.collections.get("bonusrules").get("bonus-rule-1").bonusAmount, 10);
  assert.equal(database.collections.get("delivery_settings").get("store_aiwa_pizza_main").fee, 6);
  assert.equal(database.collections.get("delivery_settings").get("store_aiwa_pizza_main").freeThreshold, 68);
  assert.equal(database.collections.get("delivery_settings").get("store_aiwa_pizza_main").testMode, true);
  assert.equal(database.collections.get("delivery_settings").get("store_aiwa_pizza_main").storeLongitude, 116.14803);
  assert.equal(database.collections.get("products").get("product-1").name, "店员可编辑商品");
});

async function confirmRechargeAt(amount, rules) {
  const seed = baseSeed();
  seed.bonusrules = rules.map((rule, index) => ({
    _id: `bonus-rule-${index + 1}`,
    id: `bonus-rule-${index + 1}`,
    storeId: "store_aiwa_pizza_main",
    ...rule,
  }));
  const { main, database } = loadMembershipApi(seed);
  const result = await main({
    action: "confirmPaidMiniProgramRecharge",
    payload: {
      rechargeNo: `RC-${String(amount).replace(".", "-")}`,
      memberId: "member-1",
      paidTotalInCents: Math.round(amount * 100),
      payerOpenid: "openid-test",
      paymentTradeNo: `WX-${String(amount).replace(".", "-")}`,
      internalPaymentSecret: "test-payment-secret",
    },
  });
  return {
    result,
    member: database.collections.get("members").get("member-1"),
    record: Array.from(database.collections.get("transactions").values())[0],
  };
}

test("a single recharge rule applies to every amount at or above its threshold", async () => {
  const rules = [{ minAmount: 100, bonusAmount: 10 }];

  const below = await confirmRechargeAt(99.99, rules);
  const threshold = await confirmRechargeAt(100, rules);
  const above = await confirmRechargeAt(500, rules);

  assert.equal(below.record.bonusAmount, 0);
  assert.equal(below.member.balance, 199.99);
  assert.equal(threshold.record.bonusAmount, 10);
  assert.equal(threshold.member.balance, 210);
  assert.equal(above.record.bonusAmount, 10);
  assert.equal(above.member.balance, 610);
});

test("multiple recharge rules use the highest qualifying tier without stacking", async () => {
  const rules = [
    { minAmount: 100, bonusAmount: 10 },
    { minAmount: 200, bonusAmount: 20 },
  ];

  const firstTier = await confirmRechargeAt(100, rules);
  const firstTierUpperBoundary = await confirmRechargeAt(199.99, rules);
  const secondTier = await confirmRechargeAt(200, rules);
  const aboveSecondTier = await confirmRechargeAt(500, rules);

  assert.equal(firstTier.record.bonusAmount, 10);
  assert.equal(firstTierUpperBoundary.record.bonusAmount, 10);
  assert.equal(secondTier.record.bonusAmount, 20);
  assert.equal(secondTier.member.balance, 320);
  assert.equal(aboveSecondTier.record.bonusAmount, 20);
  assert.equal(aboveSecondTier.member.balance, 620);
});

test("sold-out products cannot be ordered", async () => {
  const seed = baseSeed();
  seed.products[0].soldOut = true;
  const { main } = loadMembershipApi(seed);
  const result = await main({
    action: "createMiniProgramOrder",
    payload: {
      storeId: "store_aiwa_pizza_main",
      customer: { phone: "13900000000" },
      items: [{ productId: "product-1", quantity: 1 }],
      fulfillmentType: "pickup",
      pickupMode: "now",
      paymentMethod: "member_balance",
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.message, "请先选择商品。");
});

test("mini-program catalog returns oversized images through cloud-storage URLs", async () => {
  const seed = baseSeed();
  const sessionToken = "b".repeat(64);
  seed.admin_sessions = [{
    _id: sessionToken,
    id: sessionToken,
    staffId: "staff_aiwa_manager",
    storeId: "store_aiwa_pizza_main",
    expiresAt: Date.now() + 60 * 60 * 1000,
  }];
  seed.products[0].image = `data:image/jpeg;base64,${"a".repeat(130 * 1024)}`;
  const { main } = loadMembershipApi(seed);

  const saved = await main({
    action: "saveStoreData",
    payload: {
      sessionToken,
      data: {
        stores: seed.stores,
        staff: seed.staff,
        members: seed.members,
        records: seed.transactions,
        categories: seed.categories,
        products: seed.products,
        orders: seed.orders,
        refunds: seed.refunds,
        settings: { bonusRules: seed.bonusrules },
      },
    },
  });
  assert.equal(saved.ok, true);

  const result = await main({
    action: "getMiniProgramData",
    payload: { storeId: "store_aiwa_pizza_main" },
  });

  assert.equal(result.ok, true);
  assert.equal(result.products.length, 1);
  assert.match(result.products[0].image, /^https:\/\/example\.test\//);
  assert.match(result.products[0].imageFileId, /^cloud:\/\//);
});

test("mini-program restores a previously linked member from the current WeChat openid", async () => {
  const seed = baseSeed();
  seed.members[0].openid = "openid-linked-member";
  const { main } = loadMembershipApi(seed, "openid-linked-member");

  const result = await main({
    action: "getMiniProgramData",
    payload: { storeId: "store_aiwa_pizza_main" },
  });

  assert.equal(result.ok, true);
  assert.equal(result.member.id, seed.members[0].id);
  assert.equal(result.customer.phone, seed.members[0].phone);
  assert.equal(result.customer.name, seed.members[0].name);
});

test("single-store migration backs up and unifies products, members, and orders", async () => {
  const seed = baseSeed();
  seed.stores.push({
    _id: "store-old",
    id: "store-old",
    name: "爱娃披萨店",
  });
  seed.products.push({
    _id: "product-old-copy",
    id: "product-old-copy",
    storeId: "store-old",
    name: "自动化披萨",
    category: "披萨",
    price: 39,
    active: true,
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  seed.members.push({
    _id: "member-old-copy",
    id: "member-old-copy",
    storeId: "store-old",
    name: "自动化会员",
    phone: "13900000000",
    card: "AW0002",
    balance: 80,
  });
  seed.orders.push({
    _id: "order-old",
    id: "order-old",
    storeId: "store-old",
    memberId: "member-old-copy",
    customerPhone: "13900000000",
    status: "paid",
  });

  const { main, database } = loadMembershipApi(seed);
  const result = await main({
    action: "getMiniProgramData",
    payload: { storeId: "store-old", phone: "13900000000" },
  });

  assert.equal(result.ok, true);
  assert.equal(result.store.id, "store_aiwa_pizza_main");
  assert.equal(result.products.length, 1);
  assert.equal(database.collections.get("stores").size, 1);
  assert.equal(database.collections.get("members").size, 1);
  assert.equal(database.collections.get("members").get("member-1").balance, 180);
  assert.equal(
    database.collections.get("orders").get("order-old").storeId,
    "store_aiwa_pizza_main"
  );
  assert.equal(
    database.collections.get("orders").get("order-old").memberId,
    "member-1"
  );
  assert.ok(database.collections.get("migration_backups").size >= 1);
  assert.equal(
    database.collections.get("schema_migrations").get("single_store_primary_v1").primaryStoreId,
    "store_aiwa_pizza_main"
  );
});

test("duplicate member phones are repaired on member write after the one-time migration completed", async () => {
  const seed = baseSeed();
  seed.schema_migrations = [{
    _id: "single_store_primary_v1",
    id: "single_store_primary_v1",
    completedAt: "2026-07-20T00:00:00.000Z",
    summary: { migrated: true },
  }];
  seed.members.push({
    _id: "member-duplicate",
    id: "member-duplicate",
    storeId: "store_aiwa_pizza_main",
    name: "重复会员",
    phone: "13900000000",
    card: "AW0002",
    balance: 51,
    openid: "openid-test",
    createdAt: "2026-07-30T00:00:00.000Z",
  });
  seed.transactions.push({
    _id: "record-duplicate",
    id: "record-duplicate",
    storeId: "store_aiwa_pizza_main",
    memberId: "member-duplicate",
    type: "recharge",
    amount: 51,
  });

  const { main, database } = loadMembershipApi(seed);
  await main({
    action: "authorizeMiniProgramPhone",
    payload: { phoneCode: "valid-phone-code" },
  });
  const result = await main({
    action: "createMiniProgramMember",
    payload: { name: "合并后的会员" },
  });

  assert.equal(result.ok, true);
  assert.equal(database.collections.get("members").size, 1);
  assert.equal(database.collections.get("members").get("member-1").balance, 151);
  assert.equal(
    database.collections.get("transactions").get("record-duplicate").memberId,
    "member-1"
  );
});

test("mini-program registration rejects the default placeholder nickname", async () => {
  const { main } = loadMembershipApi(baseSeed());
  await main({
    action: "authorizeMiniProgramPhone",
    payload: { phoneCode: "valid-phone-code" },
  });
  const result = await main({
    action: "createMiniProgramMember",
    payload: { name: "微信顾客" },
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /会员昵称/);
});

test("phone-authorized mini-program nickname replaces any existing back-office name", async () => {
  const seed = baseSeed();
  seed.members[0] = {
    ...seed.members[0],
    name: "中",
    phone: "13900000000",
    note: "后台手工录入",
    nameSource: "existing_member_record",
  };
  const { main, database } = loadMembershipApi(seed);
  await main({
    action: "authorizeMiniProgramPhone",
    payload: { phoneCode: "valid-phone-code" },
  });
  const result = await main({
    action: "createMiniProgramMember",
    payload: { name: "测试" },
  });
  assert.equal(result.ok, true);
  assert.equal(result.member.name, "测试");
  assert.equal(result.member.nameSource, "mini_program_member_input");
  assert.equal(database.collections.get("members").get("member-1").name, "测试");
});

test("concurrent mini-program registrations share one deterministic member document", async () => {
  const seed = baseSeed();
  seed.members = [];
  seed.schema_migrations = [{
    _id: "single_store_primary_v1",
    id: "single_store_primary_v1",
    completedAt: "2026-07-20T00:00:00.000Z",
    summary: { migrated: true },
  }];
  const { main, database } = loadMembershipApi(seed);
  await main({
    action: "authorizeMiniProgramPhone",
    payload: { phoneCode: "valid-phone-code" },
  });
  const request = {
    action: "createMiniProgramMember",
    payload: { name: "并发会员" },
  };

  const [first, second] = await Promise.all([main(request), main(request)]);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.member.id, second.member.id);
  assert.equal(database.collections.get("members").size, 1);
});

test("legacy phone-authorization membership action is rejected", async () => {
  const { main, database } = loadMembershipApi(baseSeed());
  const result = await main({
    action: "joinMiniProgramMember",
    payload: { phoneCode: "valid-phone-code", name: "旧版会员" },
  });

  assert.equal(result.ok, false);
  assert.match(result.message, /先授权手机号.*充值入口/);
  assert.equal(database.collections.get("members").size, 1);
});

test("customer can fully refund their own paid order before it is accepted", async () => {
  const seed = baseSeed();
  seed.orders.push({
    _id: "order-customer-pending",
    id: "order-customer-pending",
    orderNo: "OD202610070002",
    storeId: "store_aiwa_pizza_main",
    customerOpenid: "openid-test",
    memberId: "member-1",
    totalAmount: 39,
    refundAmount: 0,
    paymentStatus: "paid",
    paymentMethod: "member_balance",
    status: "pending",
  });
  const { main, database } = loadMembershipApi(seed, "openid-test");
  const result = await main({
    action: "refundMiniProgramOrder",
    payload: { orderId: "order-customer-pending" },
  });

  assert.equal(result.ok, true);
  assert.equal(database.collections.get("orders").get("order-customer-pending").status, "refunded");
  assert.equal(database.collections.get("members").get("member-1").balance, 139);
});

test("customer cannot refund another customer's order or an accepted order", async () => {
  const seed = baseSeed();
  seed.orders.push({
    _id: "order-other-customer",
    id: "order-other-customer",
    orderNo: "OD202610070003",
    storeId: "store_aiwa_pizza_main",
    customerOpenid: "openid-owner",
    memberId: "member-1",
    totalAmount: 39,
    refundAmount: 0,
    paymentStatus: "paid",
    paymentMethod: "member_balance",
    status: "pending",
  }, {
    _id: "order-customer-accepted",
    id: "order-customer-accepted",
    orderNo: "OD202610070004",
    storeId: "store_aiwa_pizza_main",
    customerOpenid: "openid-test",
    memberId: "member-1",
    totalAmount: 39,
    refundAmount: 0,
    paymentStatus: "paid",
    paymentMethod: "member_balance",
    status: "making",
  });
  const { main, database } = loadMembershipApi(seed, "openid-test");

  const otherCustomer = await main({
    action: "refundMiniProgramOrder",
    payload: { orderId: "order-other-customer" },
  });
  const accepted = await main({
    action: "refundMiniProgramOrder",
    payload: { orderId: "order-customer-accepted" },
  });

  assert.equal(otherCustomer.ok, false);
  assert.match(otherCustomer.message, /当前微信账号/);
  assert.equal(accepted.ok, false);
  assert.match(accepted.message, /接单后不可退款/);
  assert.equal(database.collections.get("refunds").size, 0);
});
