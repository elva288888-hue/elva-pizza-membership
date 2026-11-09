const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const playwrightPath =
  "/Users/dimengjiao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright";
const { chromium } = require(playwrightPath);

const projectRoot = path.resolve(__dirname, "..");
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function fixture() {
  const storeId = "store-e2e";
  const staffId = "staff-e2e";
  return {
    stores: [{ id: storeId, name: "爱娃披萨店", createdAt: "2026-07-24T00:00:00.000Z" }],
    staff: [{
      id: staffId,
      storeId,
      name: "张锦云",
      phone: "13933378101",
      role: "manager",
      active: true,
      createdAt: "2026-07-24T00:00:00.000Z",
    }],
    session: {
      staffId,
      storeId,
      token: "local-e2e-session",
      expiresAt: Date.now() + 60 * 60 * 1000,
      loggedInAt: "2026-07-24T00:00:00.000Z",
      authVersion: 2,
    },
    categories: [{ id: "category-1", storeId, name: "披萨", sort: 1 }],
    products: [{
      id: "product-1",
      storeId,
      name: "自动化测试披萨",
      category: "披萨",
      price: 0.1,
      description: "仅用于自动化测试",
      active: true,
      soldOut: false,
      createdAt: "2026-07-24T00:00:00.000Z",
      updatedAt: "2026-07-24T00:00:00.000Z",
    }],
    members: [],
    records: [],
    orders: [],
    refunds: [],
    settings: { bonusRules: [] },
  };
}

async function waitForServer(url, timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not start: ${url}`);
}

test("admin and customer pages share product data through isolated local API", async (t) => {
  if (!fs.existsSync(chromePath)) {
    t.skip("Google Chrome is not installed");
    return;
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aiwa-pizza-e2e-"));
  const dataFile = path.join(tempDir, "data.json");
  fs.writeFileSync(dataFile, JSON.stringify(fixture(), null, 2));

  const port = 43173;
  const server = spawn(process.execPath, ["local-test-server.js"], {
    cwd: projectRoot,
    env: { ...process.env, PORT: String(port), DATA_FILE: dataFile },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => server.kill("SIGTERM"));
  await waitForServer(`http://127.0.0.1:${port}/index.html`);

  const browser = await chromium.launch({
    headless: true,
    executablePath: chromePath,
  });
  t.after(() => browser.close());

  const page = await browser.newPage();
  await page.addInitScript((data) => {
    localStorage.setItem("aiwa_drink_membership_v1", JSON.stringify(data));
  }, fixture());
  await page.goto(`http://127.0.0.1:${port}/index.html?local=1&localApi=1`);
  await page.getByRole("button", { name: "商品", exact: true }).click();
  await page.waitForSelector("text=自动化测试披萨");
  assert.equal(await page.getByText("自动化测试披萨").count(), 1);

  const customer = await browser.newPage();
  await customer.goto(
    `http://127.0.0.1:${port}/customer.html?local=1&localApi=1&mockAuth=1`
  );
  await customer.waitForSelector("text=自动化测试披萨");
  assert.equal(await customer.getByText("自动化测试披萨").count(), 1);

  const product = fixture().products[0];
  product.name = "自动化同步后的披萨";
  product.updatedAt = "2026-07-24T01:00:00.000Z";
  const response = await fetch(`http://127.0.0.1:${port}/api/local-data`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: { products: [product] } }),
  });
  assert.equal(response.ok, true);

  await customer.reload();
  await customer.waitForSelector("text=自动化同步后的披萨");
  assert.equal(await customer.getByText("自动化同步后的披萨").count(), 1);
});

test("dialogs can cancel empty forms, admin cannot add members, and orders refresh automatically", async (t) => {
  if (!fs.existsSync(chromePath)) {
    t.skip("Google Chrome is not installed");
    return;
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aiwa-pizza-regression-"));
  const dataFile = path.join(tempDir, "data.json");
  fs.writeFileSync(dataFile, JSON.stringify(fixture(), null, 2));
  const port = 43174;
  const server = spawn(process.execPath, ["local-test-server.js"], {
    cwd: projectRoot,
    env: { ...process.env, PORT: String(port), DATA_FILE: dataFile },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => server.kill("SIGTERM"));
  await waitForServer(`http://127.0.0.1:${port}/index.html`);

  const browser = await chromium.launch({ headless: true, executablePath: chromePath });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.addInitScript((data) => {
    localStorage.setItem("aiwa_drink_membership_v1", JSON.stringify(data));
  }, fixture());
  await page.goto(`http://127.0.0.1:${port}/index.html?local=1&localApi=1`);

  await page.getByRole("button", { name: "商品", exact: true }).click();
  await page.getByRole("button", { name: "新增商品" }).click();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(await page.locator("#productDialog").evaluate((dialog) => dialog.open), false);

  await page.getByRole("button", { name: "会员", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "新增会员" }).count(), 0);

  await page.getByRole("button", { name: "订单", exact: true }).click();
  const order = {
    id: "order-live-1",
    orderNo: "AW-LIVE-1",
    storeId: "store-e2e",
    customerName: "实时顾客",
    customerPhone: "13800138001",
    items: [{ productId: "product-1", name: "自动化测试披萨", price: 0.1, quantity: 1 }],
    totalAmount: 0.1,
    paidAmount: 0.1,
    status: "pending",
    paymentStatus: "paid",
    paymentMethod: "wechat_pay",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const response = await fetch(`http://127.0.0.1:${port}/api/local-data`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: { orders: [order] } }),
  });
  assert.equal(response.ok, true);
  await page.locator("#orderList").getByText("AW-LIVE-1", { exact: true }).waitFor({ timeout: 5000 });
  assert.equal(await page.locator("#orderList").getByRole("button", { name: "退款/退货" }).count(), 1);
  await page.locator("#orderList").getByRole("button", { name: "接单制作" }).click();
  assert.equal(await page.locator("#orderList").getByRole("button", { name: "退款/退货" }).count(), 0);
  await page.locator("#orderList").getByRole("button", { name: "打印小票" }).click();
  assert.equal(await page.locator("#receiptPreviewDialog").evaluate((dialog) => dialog.open), true);
  assert.equal(await page.locator("#receiptPreviewBody").getByText("订单小票", { exact: true }).count(), 1);
  assert.equal(await page.locator("#receiptPreviewBody").getByText("自动化测试披萨", { exact: true }).count(), 1);
});

test("a paid member order appears only once in transaction records", async (t) => {
  if (!fs.existsSync(chromePath)) {
    t.skip("Google Chrome is not installed");
    return;
  }

  const data = fixture();
  const member = {
    id: "member-record-1",
    storeId: "store-e2e",
    name: "流水会员",
    phone: "13800138002",
    card: "AW0099",
    balance: 51.96,
    createdAt: "2026-07-31T06:00:00.000Z",
    updatedAt: "2026-07-31T06:11:00.000Z",
  };
  const order = {
    id: "order-record-1",
    orderNo: "AW2026073179178",
    storeId: "store-e2e",
    customerName: member.name,
    customerPhone: member.phone,
    memberId: member.id,
    items: [{ productId: "product-1", name: "自动化测试披萨", price: 0.01, quantity: 1 }],
    totalAmount: 0.01,
    paidAmount: 0.01,
    status: "pending",
    paymentStatus: "paid",
    paymentMethod: "member_balance",
    createdAt: "2026-07-31T06:11:00.000Z",
    updatedAt: "2026-07-31T06:11:00.000Z",
  };
  data.members = [member];
  data.orders = [order];
  data.records = [{
    id: "record-order-1",
    storeId: "store-e2e",
    memberId: member.id,
    memberName: member.name,
    memberPhone: member.phone,
    memberCard: member.card,
    type: "spend",
    amount: 0.01,
    balanceAfter: member.balance,
    orderId: order.id,
    orderNo: order.orderNo,
    paymentMethod: "member_balance",
    itemsText: "自动化测试披萨×1",
    note: `订单 ${order.orderNo} 会员余额支付`,
    createdAt: order.createdAt,
  }];

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aiwa-pizza-record-e2e-"));
  const dataFile = path.join(tempDir, "data.json");
  fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
  const port = 43175;
  const server = spawn(process.execPath, ["local-test-server.js"], {
    cwd: projectRoot,
    env: { ...process.env, PORT: String(port), DATA_FILE: dataFile },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => server.kill("SIGTERM"));
  await waitForServer(`http://127.0.0.1:${port}/index.html`);

  const browser = await chromium.launch({ headless: true, executablePath: chromePath });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.addInitScript((initialData) => {
    localStorage.setItem("aiwa_drink_membership_v1", JSON.stringify(initialData));
  }, data);
  await page.goto(`http://127.0.0.1:${port}/index.html?local=1&localApi=1`);

  await page.getByRole("button", { name: "流水", exact: true }).click();
  await page.locator("#recordTable").getByText(order.orderNo, { exact: false }).first().waitFor();
  assert.equal(await page.locator("#recordTable tr").count(), 1);
  assert.equal(await page.locator("#recordTable").getByText("消费", { exact: true }).count(), 1);
  assert.equal(await page.locator("#recordTable").getByText("订单支付", { exact: true }).count(), 0);

  await page.getByRole("button", { name: "打印查询结果" }).click();
  assert.equal(await page.locator("#receiptPreviewBody").getByText("记录数", { exact: true }).count(), 1);
  assert.equal(await page.locator("#receiptPreviewBody").getByText(order.orderNo, { exact: false }).count(), 0);
  await page.locator("#cancelReceiptPreview").click();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出流水 Excel" }).click();
  const download = await downloadPromise;
  assert.match(download.suggestedFilename(), /\.xls$/);
  const stream = await download.createReadStream();
  let exported = "";
  for await (const chunk of stream) exported += chunk.toString("utf8");
  assert.match(exported, /流水明细/);
  assert.match(exported, new RegExp(order.orderNo));
});

test("staff can see delivery settings but not manager-only settings", async (t) => {
  if (!fs.existsSync(chromePath)) {
    t.skip("Google Chrome is not installed");
    return;
  }

  const data = fixture();
  data.staff[0].role = "staff";
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aiwa-pizza-permission-e2e-"));
  const dataFile = path.join(tempDir, "data.json");
  fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
  const port = 43176;
  const server = spawn(process.execPath, ["local-test-server.js"], {
    cwd: projectRoot,
    env: { ...process.env, PORT: String(port), DATA_FILE: dataFile },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => server.kill("SIGTERM"));
  await waitForServer(`http://127.0.0.1:${port}/index.html`);

  const browser = await chromium.launch({ headless: true, executablePath: chromePath });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.addInitScript((initialData) => {
    localStorage.setItem("aiwa_drink_membership_v1", JSON.stringify(initialData));
  }, data);
  await page.goto(`http://127.0.0.1:${port}/index.html?local=1&localApi=1`);

  await page.getByRole("button", { name: "设置", exact: true }).click();
  assert.equal(await page.getByText("新订单提醒", { exact: true }).isVisible(), true);
  assert.equal(await page.getByText("配送设置", { exact: true }).isVisible(), true);
  assert.equal(await page.getByText("临时测试模式（允许使用北京等非门店坐标）", { exact: true }).isVisible(), true);
  assert.equal(await page.getByText("充值赠送规则", { exact: true }).isVisible(), false);
  assert.equal(await page.getByText("店员管理", { exact: true }).isVisible(), false);
});
