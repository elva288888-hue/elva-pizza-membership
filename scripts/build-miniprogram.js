const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const target = process.argv[2];
const environments = JSON.parse(
  fs.readFileSync(path.join(root, "config", "environments.json"), "utf8")
);

if (!Object.prototype.hasOwnProperty.call(environments, target)) {
  throw new Error("小程序构建目标必须明确指定为 test 或 production");
}

const environment = environments[target];
if (target === "production" && process.env.CONFIRM_PRODUCTION_ENV !== environment.envId) {
  throw new Error(
    `小程序生产构建已阻止。必须设置 CONFIRM_PRODUCTION_ENV=${environment.envId} 才能继续。`
  );
}

const sourceDir = path.join(root, "miniprogram");
const outputRoot = path.join(root, ".build", "miniprogram", target);
const outputDir = path.join(outputRoot, "miniprogram");

fs.rmSync(outputRoot, { recursive: true, force: true });
fs.cpSync(sourceDir, outputDir, {
  recursive: true,
  filter(source) {
    return !source.includes(`${path.sep}node_modules${path.sep}`);
  },
});

const appPath = path.join(outputDir, "app.js");
const appSource = fs.readFileSync(appPath, "utf8");
const renderedApp = appSource.replace(
  /envId: "[^"]+"/,
  `envId: "${environment.envId}"`
);
fs.writeFileSync(appPath, renderedApp);

const projectConfig = JSON.parse(
  fs.readFileSync(path.join(root, "project.config.json"), "utf8")
);
projectConfig.miniprogramRoot = "miniprogram/";
projectConfig.cloudfunctionRoot = path.relative(outputRoot, path.join(root, "cloudfunctions")) + "/";
fs.writeFileSync(
  path.join(outputRoot, "project.config.json"),
  JSON.stringify(projectConfig, null, 2)
);

fs.writeFileSync(
  path.join(outputRoot, "deployment-manifest.json"),
  JSON.stringify(
    {
      target,
      envId: environment.envId,
      appid: projectConfig.appid,
      builtAt: new Date().toISOString(),
    },
    null,
    2
  )
);

console.log(`小程序构建完成：${outputRoot}`);
console.log(`部署目标：${target} (${environment.envId})`);
