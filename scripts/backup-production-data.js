#!/usr/bin/env node

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ENV_ID = "elva-pizza-prod-d3f8fae10cb05aca";
const BACKUP_ROOT = "/Users/dimengjiao/Documents/AiwaPizza-Backups/production";
const COLLECTIONS = [
  "stores",
  "staff",
  "members",
  "transactions",
  "categories",
  "products",
  "orders",
  "refunds",
  "bonusrules",
  "delivery_settings",
  "login_codes",
  "admin_sessions",
  "customer_profiles",
  "migration_backups",
  "schema_migrations",
];

function localTimestamp(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  return formatter.format(date).replace(" ", "T").replaceAll(":", "-");
}

function findRuntimePath() {
  const candidates = [
    process.env.PATH || "",
    "/Users/dimengjiao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin",
    "/Users/dimengjiao/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback",
  ];
  return candidates.filter(Boolean).join(path.delimiter);
}

function commandArgs(args) {
  return ["--package=@cloudbase/cli@latest", "dlx", "tcb", "-e", ENV_ID, ...args];
}

function runTcb(args, options = {}) {
  const result = spawnSync("pnpm", commandArgs(args), {
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, PATH: findRuntimePath(), NO_UPDATE_NOTIFIER: "1" },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "CloudBase CLI failed").trim();
    throw new Error(`${args.join(" ")} failed: ${detail.slice(0, 1200)}`);
  }
  return String(result.stdout || "");
}

function parseCliJson(output) {
  const start = output.indexOf("{");
  if (start < 0) throw new Error("CloudBase CLI did not return JSON");
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < output.length; index += 1) {
    const char = output[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return JSON.parse(output.slice(start, index + 1));
    }
  }
  throw new Error("CloudBase CLI returned incomplete JSON");
}

function countCollection(collection) {
  const command = JSON.stringify([{
    TableName: collection,
    CommandType: "COMMAND",
    Command: JSON.stringify({ count: collection, query: {} }),
  }]);
  const response = parseCliJson(runTcb([
    "db", "nosql", "execute", "--json", "--command", command,
  ]));
  const value = response?.data?.results?.[0]?.[0]?.n;
  return Number(value?.$numberInt ?? value?.$numberLong ?? value ?? 0);
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function exportCollection(collection, count, outputDir) {
  if (count === 0) {
    const emptyPath = path.join(outputDir, `${collection}.ndjson`);
    fs.writeFileSync(emptyPath, "", { mode: 0o600 });
    return emptyPath;
  }
  const before = new Set(fs.readdirSync(outputDir));
  runTcb([
    "db", "nosql", "dump", collection,
    "--file-type", "json", "--output-dir", outputDir, "--json",
  ]);
  const created = fs.readdirSync(outputDir).find((name) => (
    !before.has(name) && name.includes(`-${collection}-`) && name.endsWith(".json")
  ));
  if (!created) throw new Error(`Export for ${collection} completed without a local file`);
  const target = path.join(outputDir, `${collection}.ndjson`);
  fs.renameSync(path.join(outputDir, created), target);
  fs.chmodSync(target, 0o600);
  return target;
}

function main() {
  fs.mkdirSync(BACKUP_ROOT, { recursive: true, mode: 0o700 });
  fs.chmodSync(BACKUP_ROOT, 0o700);
  const backupId = localTimestamp();
  const finalDir = path.join(BACKUP_ROOT, backupId);
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "aiwa-production-backup-"));
  fs.chmodSync(workDir, 0o700);
  const manifest = {
    schemaVersion: 1,
    backupId,
    environmentId: ENV_ID,
    region: "ap-shanghai",
    startedAt: new Date().toISOString(),
    timezone: "Asia/Shanghai",
    readOnly: true,
    collections: {},
    cloudStorage: {},
    rollback: {},
  };

  try {
    for (const collection of COLLECTIONS) {
      const count = countCollection(collection);
      const filePath = exportCollection(collection, count, workDir);
      manifest.collections[collection] = {
        count,
        file: path.basename(filePath),
        bytes: fs.statSync(filePath).size,
        sha256: sha256(filePath),
      };
    }

    const storage = parseCliJson(runTcb(["storage", "list", "--json"]));
    const storageItems = Array.isArray(storage.data) ? storage.data : [];
    const storageManifestPath = path.join(workDir, "cloud-storage-manifest.json");
    fs.writeFileSync(storageManifestPath, `${JSON.stringify(storageItems, null, 2)}\n`, { mode: 0o600 });
    manifest.cloudStorage = {
      objectCount: storageItems.length,
      manifestFile: path.basename(storageManifestPath),
      sha256: sha256(storageManifestPath),
    };

    const rollback = parseCliJson(runTcb(["db", "nosql", "backup", "time", "--json"]));
    manifest.rollback = {
      restoreTimes: rollback?.data?.restoreTimes || [],
      restoreTimeRanges: rollback?.data?.restoreTimeRanges || [],
    };
    manifest.completedAt = new Date().toISOString();

    const manifestPath = path.join(workDir, "manifest.json");
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(workDir, finalDir);
    fs.chmodSync(finalDir, 0o700);
    fs.writeFileSync(path.join(BACKUP_ROOT, "LATEST"), `${backupId}\n`, { mode: 0o600 });
    process.stdout.write(`${JSON.stringify({ ok: true, backupDir: finalDir, manifest }, null, 2)}\n`);
  } catch (error) {
    fs.rmSync(workDir, { recursive: true, force: true });
    throw error;
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`[production-backup] ${error.message}\n`);
  process.exitCode = 1;
}
