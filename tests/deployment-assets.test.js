const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
const sdkPath = path.join(root, "cloudbase-sdk.js");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const compatSource = fs.readFileSync(path.join(root, "app-compat.js"), "utf8");
const miniProgramSource = fs.readFileSync(path.join(root, "miniprogram/pages/order/order.js"), "utf8");
const miniProgramAppSource = fs.readFileSync(path.join(root, "miniprogram/app.js"), "utf8");

assert.match(indexHtml, /src="cloudbase-sdk\.js\?v=[^"]+"/);
assert.ok(fs.existsSync(sdkPath), "线上后台依赖的 cloudbase-sdk.js 必须随站点发布");
assert.ok(fs.statSync(sdkPath).size > 100_000, "cloudbase-sdk.js 看起来不是完整浏览器包");
for (const source of [appSource, compatSource]) {
  assert.match(source, /refreshRevision === localDataRevision/,
    "后台刷新必须拒绝覆盖保存期间产生的本地新数据");
  assert.match(source, /cloudSaveInFlight/,
    "后台刷新必须等待正在进行的云端保存完成");
}
assert.match(compatSource, /orderChannel === "mini_program"/, "小票必须标明微信小程序下单");
assert.match(miniProgramSource, /deliveryRecipientPhone/, "配送订单必须包含独立收货人联系方式");
assert.match(miniProgramSource, /showOrderSuccess/, "下单成功后必须展示持续可见的结果反馈");
assert.match(miniProgramAppSource, /elva-pizza-test-d1far2ax4213b224/,
  "当前体验版小程序必须与测试后台连接同一个 CloudBase 环境");
assert.match(compatSource, /application\/vnd\.ms-excel/, "流水必须导出为 Excel 可打开的表格");
assert.doesNotMatch(compatSource, /aiwa-members-.*\.json/, "店员导出入口不能再下载技术型 JSON 文件");

console.log("部署资源检查通过：CloudBase SDK 位于站点根目录并被后台页面引用。");
