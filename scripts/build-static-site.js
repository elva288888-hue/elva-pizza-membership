const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const target = process.argv[2];
const environments = JSON.parse(
  fs.readFileSync(path.join(root, "config", "environments.json"), "utf8")
);

if (!Object.prototype.hasOwnProperty.call(environments, target)) {
  throw new Error("部署目标必须明确指定为 test 或 production");
}

const environment = environments[target];
if (target === "production" && process.env.CONFIRM_PRODUCTION_ENV !== environment.envId) {
  throw new Error(
    `生产构建已阻止。必须设置 CONFIRM_PRODUCTION_ENV=${environment.envId} 才能继续。`
  );
}

const outputDir = path.join(root, ".build", "deploy", target);
const sharedFiles = [
  "app-compat.js",
  "app.js",
  "cloudbase-sdk.js",
  "compatibility.js",
  "customer.css",
  "customer.html",
  "customer.js",
  "index.html",
  "styles.css",
  path.join("assets", "aiwa-pizza-logo.jpg"),
  path.join("downloads", "aiwa-pos58-print-service-win7.zip"),
];
const testOnlyFiles = ["alipay-mock.html", "mobile-test.html"];
const files = target === "production" ? sharedFiles : [...testOnlyFiles, ...sharedFiles];

fs.rmSync(outputDir, { recursive: true, force: true });
for (const relativePath of files) {
  const source = path.join(root, relativePath);
  const destination = path.join(outputDir, relativePath);
  if (!fs.existsSync(source)) throw new Error(`缺少部署资源：${relativePath}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

const configSource = fs.readFileSync(path.join(root, "cloudbase-config.js"), "utf8");
const renderedConfig = configSource
  .replace(/envId: "[^"]+"/, `envId: "${environment.envId}"`)
  .replace(/envName: "[^"]+"/, `envName: "${environment.envName}"`)
  .replace(/accountId: "[^"]+"/, `accountId: "${environment.accountId}"`)
  .replace(/region: "[^"]+"/, `region: "${environment.region}"`);

fs.writeFileSync(path.join(outputDir, "cloudbase-config.js"), renderedConfig);
fs.writeFileSync(
  path.join(outputDir, "deployment-manifest.json"),
  JSON.stringify(
    {
      target,
      envId: environment.envId,
      builtAt: new Date().toISOString(),
      files: [...files, "cloudbase-config.js"],
    },
    null,
    2
  )
);

console.log(`静态站点构建完成：${outputDir}`);
console.log(`部署目标：${target} (${environment.envId})`);
