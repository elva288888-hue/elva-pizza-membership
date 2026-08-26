const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const {
  mergeById,
  mergeData,
  safeStaticPath,
} = require("../local-test-server");

test("mergeById keeps the newest version of a product", () => {
  const existing = [{
    id: "product-1",
    name: "旧名称",
    updatedAt: "2026-07-20T10:00:00.000Z",
  }];
  const incoming = [{
    id: "product-1",
    name: "新名称",
    updatedAt: "2026-07-21T10:00:00.000Z",
  }];

  assert.deepEqual(mergeById(existing, incoming), [incoming[0]]);
});

test("mergeById preserves a newer local deletion marker", () => {
  const existing = [{
    id: "product-1",
    name: "已下架商品",
    deletedAt: "2026-07-22T10:00:00.000Z",
  }];
  const incoming = [{
    id: "product-1",
    name: "过期同步数据",
    updatedAt: "2026-07-21T10:00:00.000Z",
  }];

  assert.deepEqual(mergeById(existing, incoming), [existing[0]]);
});

test("mergeData merges all business collections without dropping records", () => {
  const existing = {
    stores: [{ id: "store-1", name: "爱娃披萨店" }],
    products: [{ id: "p1", name: "测试披萨", updatedAt: "2026-07-20" }],
    orders: [{ id: "o1", status: "pending", updatedAt: "2026-07-20" }],
    settings: { bonusRules: [{ id: "rule-1" }] },
  };
  const incoming = {
    stores: [{ id: "store-1", name: "爱娃披萨店" }],
    products: [{ id: "p2", name: "柠檬茶", updatedAt: "2026-07-21" }],
    orders: [{ id: "o1", status: "completed", updatedAt: "2026-07-21" }],
  };

  const result = mergeData(existing, incoming);
  assert.equal(result.products.length, 2);
  assert.equal(result.orders[0].status, "completed");
  assert.deepEqual(result.settings, existing.settings);
});

test("safeStaticPath confines traversal attempts to the project", () => {
  const traversalResult = safeStaticPath("/../../etc/passwd");
  assert.equal(traversalResult.startsWith(path.resolve(__dirname, "..")), true);
  assert.notEqual(traversalResult, "/etc/passwd");
  assert.equal(
    safeStaticPath("/index.html"),
    path.join(path.resolve(__dirname, ".."), "index.html")
  );
});
