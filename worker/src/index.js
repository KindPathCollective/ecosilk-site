/* ============================================================
   ECOSILK AI WORKER — Cloudflare Worker (also runs locally via ../server).
   Endpoints (all JSON, CORS-restricted to ALLOWED_ORIGINS):
     POST /assistant   shopping helper chat
     POST /order-note  personalised thank-you + packing note
     POST /digest      back-office: weekly digest, low-stock nudges, order summaries
     GET  /health
   Env vars (set with `wrangler secret put` / wrangler.toml [vars]):
     AI_PROVIDER      "openai" | "anthropic"
     AI_API_KEY       your key (secret)
     AI_MODEL         e.g. "gpt-4.1-mini" or "claude-sonnet-4-5"
     AI_BASE_URL      optional override of the provider base URL
     ALLOWED_ORIGINS  comma-separated list, e.g. "https://kindpathcollective.github.io,https://www.ecosilkbags.com.au"
   ============================================================ */
import { CATALOG_SUMMARY, PRODUCT_INDEX } from "./catalog.js";

const BUSINESS = {
  name: "Ecosilk Bags", email: "info@ecosilkbags.com.au", phone: "0439 461 919",
  shippingFlat: 10.95, freeShippingOver: 75, volumeRule: "Any 3 or more single bags together save 10%.",
  codes: "WELCOME15 = 15% off a first order. REEF10 = 10% off. FREESHIP = free shipping.",
  gift: "4 or more single shoulder bags earn a free drawstring bag.",
  returns: "Unused bags can be returned within 30 days. 5-year guarantee on shopping and shoulder bags.",
  recycling: "Worn-out bags can be posted to Ecosilk Bags, 159 McClelland Rd, Barkers Vale NSW 2474 for recycling."
};

const SYSTEM_ASSISTANT = `You are the Ecosilk Bags shopping helper on ecosilkbags.com.au. Voice: warm, plain Australian English, concise (max ~90 words unless listing), no exclamation marks, no emojis. Help people choose bags, build sets, and answer questions about shipping, care, sizes, the guarantee and recycling. Never invent facts, prices, colours or policies — only use the catalog and business facts below. If unsure, say so and point to ${BUSINESS.email} or ${BUSINESS.phone}.

BUSINESS FACTS
- 100% Australian owned and designed by Emily Hay (Northern Rivers, NSW). First bag 2001. Made in China under ethical conditions.
- Material: 100% nylon parachute silk; strong, light, quick-dry, colourfast, endlessly recyclable. Shopping/shoulder bags carry 14 kg; guaranteed 5 years with daily/weekly use. Care: quick machine wash, line dry, cool iron only.
- Shipping: flat $${BUSINESS.shippingFlat} Australia-wide, free over $${BUSINESS.freeShippingOver}. Prices include GST. Ships within 1–2 business days.
- Offers: ${BUSINESS.volumeRule} ${BUSINESS.gift} Codes: ${BUSINESS.codes}
- ${BUSINESS.returns} ${BUSINESS.recycling}
- Ecosilk is a business supporter of the Australian Marine Conservation Society. Reef Collection packs are named after reef species.
- Fundraising/custom printing of logos on shopping, shoulder and fruit & vegie bags is available via the Fundraising & custom page.

CATALOG (sku | name | price | in stock)
${CATALOG_SUMMARY}

RESPONSE FORMAT — return ONLY a single JSON object and nothing else (no prose before or after it):
{"reply": string (plain text, paragraphs separated by blank lines, bullets with "- "),
 "products": [up to 4 SKUs to show as cards, most relevant first],
 "actions": [ {"type":"add_to_cart","sku":"...","qty":1} ] (ONLY when the user clearly asks to add something; otherwise []),
 "suggestions": [up to 3 short follow-up questions the user might ask next]}
When recommending, prefer in-stock SKUs and mention the price. When a user wants a set, pick concrete SKUs/colours and explain the saving.`;

const SYSTEM_NOTE = `You write short, warm thank-you notes for Ecosilk Bags customers after they order. Plain Australian English, no exclamation marks, no emojis, 70–110 words, 2–3 short paragraphs separated by a blank line. Use the customer's first name once. Mention what they ordered in natural language (not SKUs), one genuinely useful care or usage tip relevant to those items (machine wash, line dry, cool iron; shopping/shoulder bags carry 14 kg; drawstring holds six shopping bags; fruit & vegie bags double as travel organisers), and that worn-out bags can be posted back for recycling. If a free drawstring gift is included, mention it. If it is a gift order, keep the tone gift-appropriate. Do not invent delivery dates beyond "within 1–2 business days". Return plain text only.`;

const SYSTEM_DIGEST = `You are the back-office analyst for Ecosilk Bags, a small Australian reusable-bag business. You receive JSON order data and write for the owner: plain Australian English, concise, no exclamation marks, no emojis, use short headings and bullet points. Never invent numbers — compute only from the data provided and show your figures. Flag anything odd (duplicate orders, test orders, unusual discounts). Keep it under 350 words.`;

/* ---------- Provider calls ---------- */
async function chat(env, system, messages, { json = false, maxTokens = 900 } = {}) {
  const provider = (env.AI_PROVIDER || "openai").toLowerCase();
  if (!env.AI_API_KEY) throw new Error("AI_API_KEY not set");
  if (provider === "anthropic") {
    const base = (env.AI_BASE_URL || "https://api.anthropic.com").replace(/\/$/, "");
    const res = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": env.AI_API_KEY, "anthropic-version": "2023-06-01", ...(env.AI_EXTRA_HEADERS ? JSON.parse(env.AI_EXTRA_HEADERS) : {}) },
      body: JSON.stringify({ model: env.AI_MODEL || "claude-sonnet-4-5", max_tokens: maxTokens, system, messages: messages.map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content) })) })
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("");
    return text;
  }
  // OpenAI Responses API
  const base = (env.AI_BASE_URL || "https://api.openai.com").replace(/\/$/, "");
  const body = { model: env.AI_MODEL || "gpt-4.1-mini", instructions: system, input: messages.map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content) })), max_output_tokens: maxTokens };
  if (json) body.text = { format: { type: "json_object" } };
  const res = await fetch(`${base}/v1/responses`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${env.AI_API_KEY}`, ...(env.AI_EXTRA_HEADERS ? JSON.parse(env.AI_EXTRA_HEADERS) : {}) }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`openai ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  if (typeof data.output_text === "string") return data.output_text;
  return (data.output || []).flatMap(o => o.content || []).filter(c => c.type === "output_text").map(c => c.text).join("");
}

function parseJson(text) {
  text = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try { return JSON.parse(text); } catch (e) {}
  // Find the first object that contains a "reply" key and parse up to its balanced closing brace
  const start = text.search(/\{\s*"reply"/); if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true; else if (ch === "{") depth++; else if (ch === "}") { depth--; if (depth === 0) { try { return JSON.parse(text.slice(start, i + 1)); } catch (e) { return null; } } }
  }
  return null;
}

/* ---------- Handlers ---------- */
async function handleAssistant(env, body) {
  const messages = (body.messages || []).slice(-12).filter(m => m && m.content).map(m => ({ role: m.role, content: String(m.content).slice(0, 1500) }));
  if (!messages.length) return { reply: "Ask me anything about the bags.", products: [], actions: [], suggestions: [] };
  const ctx = body.context || {};
  const ctxText = `CONTEXT: page=${ctx.page || "?"}${ctx.sku ? `, viewing SKU ${ctx.sku}` : ""}; cart=${(ctx.cart || []).map(l => `${l.qty}×${l.name}`).join(", ") || "empty"}; cartTotal=$${Number(ctx.cartTotal || 0).toFixed(2)}`;
  const convo = [...messages.slice(0, -1), { role: "user", content: `${ctxText}\n\nUSER: ${messages[messages.length - 1].content}` }];
  const raw = await chat(env, SYSTEM_ASSISTANT, convo, { json: true, maxTokens: 1200 });
  const parsed = parseJson(raw) || { reply: raw.replace(/\{\s*"reply"[\s\S]*$/, "").trim() || raw };
  const valid = new Set(Object.keys(PRODUCT_INDEX));
  return {
    reply: String(parsed.reply || "").trim(),
    products: (parsed.products || []).filter(s => valid.has(s)).slice(0, 4),
    actions: (parsed.actions || []).filter(a => a && a.type === "add_to_cart" && valid.has(a.sku)).map(a => ({ type: "add_to_cart", sku: a.sku, qty: Math.min(50, Math.max(1, parseInt(a.qty || 1, 10))) })).slice(0, 6),
    suggestions: (parsed.suggestions || []).map(String).slice(0, 3)
  };
}

async function handleOrderNote(env, body) {
  const o = body.order || {};
  const lines = (o.lines || []).map(l => `${l.qty} × ${l.name}`).join("; ");
  const gifts = (o.gifts || []).map(g => g.name).join("; ");
  const prompt = `Customer first name: ${o.customer?.firstName || "there"}. State: ${o.customer?.state || "?"}. Items: ${lines}. ${gifts ? `Free gift included: ${gifts}. ` : ""}${o.customer?.gift ? "This is a gift order. " : ""}${o.customer?.notes ? `Customer note: "${String(o.customer.notes).slice(0, 300)}". ` : ""}Order total $${Number(o.total || 0).toFixed(2)}.${o.code ? ` Discount code used: ${o.code}.` : ""}`;
  const note = await chat(env, SYSTEM_NOTE, [{ role: "user", content: prompt }], { maxTokens: 400 });
  return { note: note.trim() };
}

async function handleDigest(env, body) {
  const type = body.type || "weekly";
  const orders = (body.orders || []).slice(0, 200);
  const ask = {
    weekly: "Write the weekly sales digest: total orders, revenue, average order value, best-selling items and colours, discount usage, shipping (free vs paid), and 3 concrete suggestions for next week.",
    lowstock: "Based on what sold and the stock-on-hand list, which SKUs or colours need reordering first? Rank by urgency with reasoning.",
    summary: "Write a short fulfilment summary for the packer for each order: what to pack (including free gifts), gift flag, notes, and anything to double-check.",
    email: "Draft a short, friendly order-confirmation email body for the most recent order, from Ecosilk Bags (plain text, no subject line)."
  }[type] || "Summarise this order data for the owner.";
  const payload = { orders, stock: body.stock || null, period: body.period || null };
  const digest = await chat(env, SYSTEM_DIGEST, [{ role: "user", content: `${ask}\n\nDATA:\n${JSON.stringify(payload).slice(0, 60000)}` }], { maxTokens: 1200 });
  return { digest: digest.trim(), type };
}

/* ---------- Router + CORS ---------- */
function cors(req, env) {
  const origin = req.headers.get("origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || "*").split(",").map(s => s.trim()).filter(Boolean);
  const ok = allowed.includes("*") || allowed.includes(origin) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return { "access-control-allow-origin": ok ? (origin || "*") : "null", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type", "access-control-max-age": "86400", "vary": "origin" };
}

export async function handleRequest(request, env) {
  const headers = { ...cors(request, env), "content-type": "application/json; charset=utf-8" };
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api/, "").replace(/\/$/, "") || "/";
  try {
    if (request.method === "GET" && (path === "/health" || path === "/")) return new Response(JSON.stringify({ ok: true, provider: env.AI_PROVIDER || "openai", model: env.AI_MODEL || null, products: Object.keys(PRODUCT_INDEX).length }), { headers });
    if (request.method !== "POST") return new Response(JSON.stringify({ error: "method" }), { status: 405, headers });
    const body = await request.json().catch(() => ({}));
    let out;
    if (path === "/assistant") out = await handleAssistant(env, body);
    else if (path === "/order-note") out = await handleOrderNote(env, body);
    else if (path === "/digest") out = await handleDigest(env, body);
    else return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers });
    return new Response(JSON.stringify(out), { headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e.message || e) }), { status: 500, headers });
  }
}

export default { fetch: handleRequest };
