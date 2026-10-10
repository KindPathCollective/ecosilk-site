/* ============================================================
   ECOSILK STRIPE — hosted Checkout sessions + verified webhooks.
   Test mode only unless ALLOW_LIVE === "yes" (deliberately blunt).
   Secrets (wrangler secret put): STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, ORDER_SINK_TOKEN
   Vars (wrangler.toml): ORDER_SINK_URL, SITE_URL
   ============================================================ */
import { priceCart, CartError, PRICING } from "./pricing.js";

const API = "https://api.stripe.com/v1";
const WEBHOOK_TOLERANCE_SECONDS = 300;
const enc = new TextEncoder();

export class StripeError extends Error {}

function assertKey(env) {
  const key = env.STRIPE_SECRET_KEY || "";
  if (!key) throw new StripeError("STRIPE_SECRET_KEY not set");
  if (env.ALLOW_LIVE !== "yes" && !/^(sk|rk)_test_/.test(key)) throw new StripeError("Live Stripe keys are blocked (test mode only)");
  return key;
}

/** Flatten nested objects/arrays into Stripe's bracketed form encoding. */
export function formEncode(obj, prefix = "", out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((item, i) => (item && typeof item === "object" ? formEncode(item, `${key}[${i}]`, out) : out.push([`${key}[${i}]`, String(item)])));
    else if (typeof v === "object") formEncode(v, key, out);
    else out.push([key, String(v)]);
  }
  return out;
}

async function stripePost(env, path, body, idempotencyKey) {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${assertKey(env)}`, "content-type": "application/x-www-form-urlencoded", ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}) },
    body: new URLSearchParams(formEncode(body)).toString()
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new StripeError(`Stripe ${path} failed: ${(json.error && json.error.message) || res.status}`);
  return json;
}

const clean = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);

/** body: { items:[{sku,qty}], code, customer:{...}, orderNumber } → { url, id, totals } */
export async function createCheckoutSession(env, body, catalog) {
  const siteUrl = (env.SITE_URL || "").replace(/\/$/, "");
  if (!/^https:\/\//.test(siteUrl)) throw new StripeError("SITE_URL not set to an https address");
  const priced = priceCart(body.items, body.code, catalog);
  const c = body.customer || {};
  const email = clean(c.email, 200);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new CartError("A valid email is required.");
  const orderNumber = clean(body.orderNumber, 40) || "ES-" + Date.now();

  const params = {
    mode: "payment",
    customer_email: email,
    client_reference_id: orderNumber,
    success_url: `${siteUrl}/thank-you.html?paid=1&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${siteUrl}/checkout.html?cancelled=1`,
    line_items: priced.lines.map(l => ({
      quantity: l.qty,
      price_data: { currency: PRICING.currency, unit_amount: l.unitCents, product_data: { name: l.name.slice(0, 120), metadata: { sku: l.sku } } }
    })),
    // Stripe pairs shipping_options with address collection; Australia-only matches the flat-rate policy.
    shipping_address_collection: { allowed_countries: ["AU"] },
    shipping_options: [{ shipping_rate_data: {
      type: "fixed_amount", display_name: priced.shippingCents === 0 ? "Free standard post" : "Standard post",
      fixed_amount: { amount: priced.shippingCents, currency: PRICING.currency },
      delivery_estimate: { minimum: { unit: "business_day", value: 3 }, maximum: { unit: "business_day", value: 8 } }
    } }],
    metadata: {
      order: orderNumber,
      cart: priced.lines.map(l => `${l.sku}:${l.qty}`).join(","),
      code: priced.code,
      gifts: priced.gifts.join("; ").slice(0, 200),
      name: clean(`${c.firstName || ""} ${c.lastName || ""}`, 120),
      addr1: clean(c.address1, 120), addr2: clean(c.address2, 120), city: clean(c.city, 80),
      state: clean(c.state, 20), postcode: clean(c.postcode, 12),
      phone: clean(c.phone, 30), notes: clean(c.notes, 300), gift: c.gift ? "yes" : "no"
    }
  };
  if (priced.discountCents > 0) {
    // One-off coupon so the discount shows on Stripe's hosted page.
    const coupon = await stripePost(env, "/coupons", { amount_off: priced.discountCents, currency: PRICING.currency, duration: "once", max_redemptions: 1, name: "Ecosilk savings" });
    params.discounts = [{ coupon: coupon.id }];
  }
  const session = await stripePost(env, "/checkout/sessions", params);
  return { url: session.url, id: session.id, totals: { totalCents: priced.totalCents, discountCents: priced.discountCents, shippingCents: priced.shippingCents } };
}

/* ---------- Webhook signature (Stripe-Signature: t=...,v1=...) ---------- */
function hex(buf) { return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join(""); }
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
export async function computeSignature(secret, timestamp, rawBody) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(`${timestamp}.${rawBody}`)));
}
export async function verifyWebhook(rawBody, header, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!secret) throw new StripeError("STRIPE_WEBHOOK_SECRET not set");
  const parts = String(header || "").split(",").map(p => p.trim().split("="));
  const t = (parts.find(p => p[0] === "t") || [])[1];
  const sigs = parts.filter(p => p[0] === "v1").map(p => p[1]);
  if (!t || !/^\d+$/.test(t) || !sigs.length) throw new StripeError("Malformed signature header");
  if (Math.abs(nowSeconds - Number(t)) > WEBHOOK_TOLERANCE_SECONDS) throw new StripeError("Signature timestamp outside tolerance");
  const expected = await computeSignature(secret, t, rawBody);
  if (!sigs.some(s => safeEqual(s, expected))) throw new StripeError("Signature mismatch");
  return JSON.parse(rawBody);
}

/** Turn a paid checkout.session into the order shape the ledger (Apps Script) validates. */
export function sessionToLedgerOrder(session, livemode, catalog) {
  const m = session.metadata || {};
  const items = String(m.cart || "").split(",").filter(Boolean).map(pair => {
    const [sku, qty] = pair.split(":");
    const product = catalog[sku];
    if (!product) throw new StripeError(`Unknown SKU in session metadata: ${String(sku).slice(0, 20)}`);
    return { sku, qty: Number(qty), unitCents: Math.round(product.price * 100) };
  });
  const details = session.customer_details || {};
  const td = session.total_details || {};
  return {
    id: session.id,
    paymentId: session.payment_intent,
    livemode: livemode === false ? false : true, // anything but an explicit false is treated as live (and refused by the ledger)
    currency: String(session.currency || "").toUpperCase(),
    totalCents: session.amount_total,
    shippingCents: td.amount_shipping || 0,
    discountCents: td.amount_discount || 0,
    items,
    customer: { name: m.name || details.name || "", email: details.email || session.customer_email || "" },
    address: { line1: m.addr1, line2: m.addr2, city: m.city, state: m.state, postcode: m.postcode, country: "AU" }
  };
}

/** Handle a verified Stripe event. Returns { status, httpStatus }. Non-2xx makes Stripe retry. */
export async function handleStripeEvent(env, event, catalog, fetchImpl = fetch) {
  if (!["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(event.type)) return { status: "ignored", httpStatus: 200 };
  const session = event.data && event.data.object;
  if (!session || session.object !== "checkout.session") return { status: "ignored", httpStatus: 200 };
  if (session.payment_status !== "paid") return { status: "not_paid", httpStatus: 200 };
  if (!env.ORDER_SINK_URL || !env.ORDER_SINK_TOKEN) throw new StripeError("ORDER_SINK_URL / ORDER_SINK_TOKEN not set");
  const order = sessionToLedgerOrder(session, event.livemode, catalog);
  const res = await fetchImpl(env.ORDER_SINK_URL, {
    method: "POST", redirect: "follow", headers: { "content-type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ source: "ecosilk-worker", token: env.ORDER_SINK_TOKEN, order })
  });
  const text = await res.text();
  let status = "error";
  try { status = JSON.parse(text).status; } catch (e) { /* Apps Script returned HTML or an error page */ }
  if (status === "ok" || status === "duplicate_ignored") return { status, httpStatus: 200 };
  // Anything else: tell Stripe to retry, and surface it in Worker logs for reconciliation.
  console.error(`Ledger rejected ${session.id}: ${status}`);
  return { status: "ledger_error", httpStatus: 500 };
}
