const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const port = Number(process.env.PORT || 4173);
const dataFile = process.env.DATA_FILE
  ? path.resolve(process.env.DATA_FILE)
  : path.join(root, ".local-test-data.json");

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".md": "text/markdown; charset=utf-8",
};

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 8 * 1024 * 1024) {
        request.destroy();
        reject(new Error("Request body is too large"));
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function sendJson(response, status, data) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  });
  response.end(JSON.stringify(data));
}

function readData() {
  if (!fs.existsSync(dataFile)) return null;
  try {
    return JSON.parse(fs.readFileSync(dataFile, "utf8"));
  } catch {
    return null;
  }
}

function writeData(data) {
  const tempFile = `${dataFile}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(data, null, 2));
  fs.renameSync(tempFile, dataFile);
}

function mergeById(existingRows = [], incomingRows = []) {
  const rows = new Map();
  for (const row of existingRows || []) {
    if (row?.id) rows.set(row.id, row);
  }
  for (const row of incomingRows || []) {
    if (!row?.id) continue;
    const current = rows.get(row.id);
    if (!current) {
      rows.set(row.id, row);
      continue;
    }
    const currentTime = Date.parse(current.deletedAt || current.updatedAt || current.createdAt || 0) || 0;
    const incomingTime = Date.parse(row.deletedAt || row.updatedAt || row.createdAt || 0) || 0;
    rows.set(row.id, incomingTime >= currentTime ? { ...current, ...row } : current);
  }
  return Array.from(rows.values());
}

function mergeData(existing = {}, incoming = {}) {
  if (!existing || !Object.keys(existing).length) return incoming;
  if (!incoming || !Object.keys(incoming).length) return existing;
  return {
    ...existing,
    ...incoming,
    stores: mergeById(existing.stores, incoming.stores),
    staff: mergeById(existing.staff, incoming.staff),
    members: mergeById(existing.members, incoming.members),
    records: mergeById(existing.records, incoming.records),
    categories: mergeById(existing.categories, incoming.categories),
    products: mergeById(existing.products, incoming.products),
    orders: mergeById(existing.orders, incoming.orders),
    refunds: mergeById(existing.refunds, incoming.refunds),
    settings: incoming.settings || existing.settings || {},
  };
}

function safeStaticPath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const normalized = path.normalize(decoded === "/" ? "/index.html" : decoded);
  const filePath = path.join(root, normalized);
  if (!filePath.startsWith(root)) return null;
  return filePath;
}

function createServer() {
  return http.createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    sendJson(response, 204, {});
    return;
  }

  if (request.url.startsWith("/api/local-data")) {
    try {
      if (request.method === "GET") {
        sendJson(response, 200, { ok: true, data: readData() });
        return;
      }
      if (request.method === "POST") {
        const body = await readBody(request);
        const parsed = JSON.parse(body || "{}");
        const merged = mergeData(readData(), parsed.data || {});
        writeData(merged);
        sendJson(response, 200, { ok: true, savedAt: new Date().toISOString(), data: merged });
        return;
      }
      sendJson(response, 405, { ok: false, message: "Method not allowed" });
      return;
    } catch (error) {
      sendJson(response, 500, { ok: false, message: error.message });
      return;
    }
  }

  const filePath = safeStaticPath(request.url);
  if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    "Content-Type": contentTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream",
    "Cache-Control": "no-store",
  });
  fs.createReadStream(filePath).pipe(response);
  });
}

if (require.main === module) {
  const server = createServer();
  server.listen(port, "0.0.0.0", () => {
    console.log(`Local test server: http://127.0.0.1:${port}`);
    console.log(`Shared data file: ${dataFile}`);
  });
}

module.exports = {
  createServer,
  mergeById,
  mergeData,
  safeStaticPath,
};
