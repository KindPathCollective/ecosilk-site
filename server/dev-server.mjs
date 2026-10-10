// Local/preview server: serves the static site and runs the worker's API under /api/*.
// Usage: node server/dev-server.mjs [port]   (env: AI_PROVIDER, AI_API_KEY, AI_MODEL, AI_BASE_URL)
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { handleRequest } from "../worker/src/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.argv[2] || process.env.PORT || 8787);
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".xml": "application/xml", ".txt": "text/plain", ".webp": "image/webp", ".woff2": "font/woff2" };
const env = { AI_PROVIDER: process.env.AI_PROVIDER, AI_API_KEY: process.env.AI_API_KEY, AI_MODEL: process.env.AI_MODEL, AI_BASE_URL: process.env.AI_BASE_URL, AI_EXTRA_HEADERS: process.env.AI_EXTRA_HEADERS, ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS || "*" };

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith("/api")) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const request = new Request(url, { method: req.method, headers: req.headers, body: ["GET", "HEAD", "OPTIONS"].includes(req.method) ? undefined : Buffer.concat(chunks) });
    const out = await handleRequest(request, env);
    res.writeHead(out.status, Object.fromEntries(out.headers));
    res.end(Buffer.from(await out.arrayBuffer()));
    return;
  }
  let file = path.join(root, decodeURIComponent(url.pathname));
  if (url.pathname.endsWith("/")) file = path.join(file, "index.html");
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { "content-type": "text/html" }); fs.readFile(path.join(root, "404.html"), (e2, d2) => res.end(e2 ? "Not found" : d2)); return; }
    res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream", "cache-control": "no-cache" });
    res.end(data);
  });
}).listen(port, "0.0.0.0", () => {
  console.log(`Ecosilk dev server on http://127.0.0.1:${port}  provider=${env.AI_PROVIDER || "openai"} key=${env.AI_API_KEY ? "set" : "MISSING"} base=${env.AI_BASE_URL || "default"}`);
  console.log("env keys:", Object.keys(process.env).filter(k => /ANTHROPIC|OPENAI|LLM|PPLX_LLM|API_KEY|BASE_URL/i.test(k)).join(", "));
});
