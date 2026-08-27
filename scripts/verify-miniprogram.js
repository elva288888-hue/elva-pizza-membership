const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const target = process.argv[2];
const environments = JSON.parse(
  fs.readFileSync(path.join(root, "config", "environments.json"), "utf8")
);

if (!environments[target]) throw new Error("小程序校验目标必须是 test 或 production");

const outputRoot = path.join(root, ".build", "miniprogram", target);
const appSource = fs.readFileSync(path.join(outputRoot, "miniprogram", "app.js"), "utf8");
const manifest = JSON.parse(
  fs.readFileSync(path.join(outputRoot, "deployment-manifest.json"), "utf8")
);

if (manifest.target !== target || manifest.envId !== environments[target].envId) {
  throw new Error("小程序部署清单与目标环境不一致");
}
if (!appSource.includes(`envId: "${environments[target].envId}"`)) {
  throw new Error("小程序构建产物未指向目标 CloudBase 环境");
}
const otherTarget = target === "production" ? "test" : "production";
if (appSource.includes(environments[otherTarget].envId)) {
  throw new Error(`小程序 ${target} 构建产物混入了 ${otherTarget} 环境 ID`);
}

console.log(`小程序部署包校验通过：${target} (${manifest.envId})`);
