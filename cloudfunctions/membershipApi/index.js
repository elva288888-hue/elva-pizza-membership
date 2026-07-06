const cloud = require("wx-server-sdk");

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
  loginCodes: "login_codes",
};

const DEFAULT_STORE_ID = "store_aiwa_pizza_main";
const DEFAULT_MANAGER_ID = "staff_aiwa_manager";
const TEST_CODE = "123456";
const CODE_EXPIRE_MINUTES = 5;
const LOGIN_CODE_COOLDOWN_MS = 60 * 1000;

exports.main = async (event = {}) => {
  const { action, payload = {} } = event;

  try {
    if (action === "getStoreData") return await getStoreData();
    if (action === "saveStoreData") return await saveStoreData(payload.data || {});
    if (action === "sendLoginCode") return await sendLoginCode(payload.phone);
    if (action === "verifyLoginCode") return await verifyLoginCode(payload.phone, payload.code);

    return fail(`Unknown action: ${action || "empty"}`);
  } catch (error) {
    console.error("[membershipApi]", error);
    return fail("云函数执行失败，请稍后重试");
  }
};

async function getStoreData() {
  const stores = await safeGetAll(COLLECTIONS.stores);
  const isNew = stores.length === 0;

  if (isNew) {
    await seedDefaultStore();
  }

  return ok({
    isNew,
    data: {
      stores: await safeGetAll(COLLECTIONS.stores),
      staff: await safeGetAll(COLLECTIONS.staff),
      members: await safeGetAll(COLLECTIONS.members),
      records: await safeGetAll(COLLECTIONS.transactions),
      categories: await safeGetAll(COLLECTIONS.categories),
      products: await safeGetAll(COLLECTIONS.products),
      orders: await safeGetAll(COLLECTIONS.orders),
      refunds: await safeGetAll(COLLECTIONS.refunds),
      settings: {
        bonusRules: await safeGetAll(COLLECTIONS.bonusRules),
      },
      session: null,
    },
  });
}

async function saveStoreData(data) {
  const warnings = [];
  await safeReplaceCollection(COLLECTIONS.stores, data.stores || [], warnings);
  await safeReplaceCollection(COLLECTIONS.staff, data.staff || [], warnings);
  await safeReplaceCollection(COLLECTIONS.members, data.members || [], warnings);
  await safeReplaceCollection(COLLECTIONS.transactions, data.records || [], warnings);
  await safeReplaceCollection(COLLECTIONS.categories, data.categories || [], warnings);
  await safeReplaceCollection(COLLECTIONS.products, data.products || [], warnings);
  await safeReplaceCollection(COLLECTIONS.orders, data.orders || [], warnings);
  await safeReplaceCollection(COLLECTIONS.refunds, data.refunds || [], warnings);
  await safeReplaceCollection(COLLECTIONS.bonusRules, data.settings?.bonusRules || [], warnings);

  return ok({ savedAt: new Date().toISOString(), warnings });
}

async function sendLoginCode(phone) {
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

  const smsReady = isSmsConfigured();
  const code = smsReady ? createLoginCode() : TEST_CODE;
  const expiresAt = Date.now() + CODE_EXPIRE_MINUTES * 60 * 1000;

  if (smsReady) {
    const smsResult = await sendSmsCode(normalizedPhone, code);
    if (!smsResult.ok) {
      console.error("[sms send failed]", smsResult.error);
      return fail("短信发送失败，请稍后重试或联系店长。");
    }
  }

  await upsert(COLLECTIONS.loginCodes, normalizedPhone, {
    _id: normalizedPhone,
    phone: normalizedPhone,
    code,
    expiresAt,
    createdAtMs: Date.now(),
    createdAt: new Date().toISOString(),
    mode: smsReady ? "sms" : "test",
  }).catch((error) => {
    console.warn("[login_codes skipped]", error);
  });

  if (smsReady) {
    return ok({ message: "验证码已发送，请查看手机短信。", expiresInMinutes: CODE_EXPIRE_MINUTES });
  }

  return ok({ message: "测试验证码已生成。正式短信配置完成前，请输入 123456。", testCode: TEST_CODE });
}

async function verifyLoginCode(phone, code) {
  const normalizedPhone = normalizePhone(phone);
  const staffer = await findActiveStaff(normalizedPhone);

  if (!staffer) {
    return fail("这个手机号还没有录入为店员，无法登录。");
  }

  const codeDoc = await getDoc(COLLECTIONS.loginCodes, normalizedPhone);
  const isTestCode = !isSmsConfigured() && code === TEST_CODE;
  const isValidCloudCode =
    codeDoc && codeDoc.code === code && Number(codeDoc.expiresAt || 0) > Date.now();

  if (!isTestCode && !isValidCloudCode) {
    return fail("验证码不正确或已过期。");
  }

  return ok({
    session: {
      staffId: staffer.id || staffer._id,
      storeId: staffer.storeId || DEFAULT_STORE_ID,
      loggedInAt: new Date().toISOString(),
    },
  });
}

function isSmsConfigured() {
  return [
    "TENCENT_SECRET_ID",
    "TENCENT_SECRET_KEY",
    "TENCENT_SMS_SDK_APP_ID",
    "TENCENT_SMS_SIGN_NAME",
    "TENCENT_SMS_TEMPLATE_ID",
  ].every((name) => Boolean(process.env[name]));
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

async function seedDefaultStore() {
  const now = new Date().toISOString();
  await upsert(COLLECTIONS.stores, DEFAULT_STORE_ID, {
    _id: DEFAULT_STORE_ID,
    id: DEFAULT_STORE_ID,
    name: "爱娃披萨店",
    createdAt: now,
  });
  await upsert(COLLECTIONS.staff, DEFAULT_MANAGER_ID, {
    _id: DEFAULT_MANAGER_ID,
    id: DEFAULT_MANAGER_ID,
    storeId: DEFAULT_STORE_ID,
    name: "店长",
    phone: "13800000000",
    role: "manager",
    active: true,
    createdAt: now,
  });
}

async function findActiveStaff(phone) {
  const result = await db
    .collection(COLLECTIONS.staff)
    .where({ phone, active: true })
    .limit(1)
    .get();
  return result.data?.[0] || null;
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

async function replaceCollection(collectionName, rows) {
  const existing = await db.collection(collectionName).limit(1000).get();
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
    await db.collection(collectionName).doc(id).update({ data: documentData });
  }
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
