const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const target = process.argv[2];
const environments = JSON.parse(
  fs.readFileSync(path.join(root, "config", "environments.json"), "utf8")
);

if (!environments[target]) throw new Error("校验目标必须是 test 或 production");
const outputDir = path.join(root, ".build", "deploy", target);
const manifest = JSON.parse(
  fs.readFileSync(path.join(outputDir, "deployment-manifest.json"), "utf8")
);
const config = fs.readFileSync(path.join(outputDir, "cloudbase-config.js"), "utf8");

if (manifest.target !== target || manifest.envId !== environments[target].envId) {
  throw new Error("部署清单与目标环境不一致，已阻止部署");
}
if (!config.includes(`envId: "${environments[target].envId}"`)) {
  throw new Error("站点 CloudBase 配置与目标环境不一致，已阻止部署");
}
if (target === "test" && config.includes(environments.production.envId)) {
  throw new Error("测试构建中检测到生产环境 ID，已阻止部署");
}
if (!fs.readFileSync(path.join(outputDir, "app-compat.js"), "utf8").includes("data-order-print")) {
  throw new Error("部署包未包含订单小票功能");
}
if (!fs.readFileSync(path.join(outputDir, "app-compat.js"), "utf8").includes("application/vnd.ms-excel")) {
  throw new Error("部署包未包含流水 Excel 导出功能");
}

console.log(`部署包校验通过：${target} (${manifest.envId})`);
