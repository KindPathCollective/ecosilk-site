// Offline tests for the Stripe path. Stripe and the ledger are mocked; nothing leaves this process.
import assert from "node:assert/strict";
import { PRODUCT_INDEX } from "../worker/src/catalog.js";
import { handleRequest } from "../worker/src/index.js";
import { formEncode, computeSignature, verifyWebhook, createCheckoutSession, sessionToLedgerOrder, handleStripeEvent } from "../worker/src/stripe.js";
import { CartError } from "../worker/src/pricing.js";

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const SECRET = "whsec_testsecret";
const env = { STRIPE_SECRET_KEY: "sk_test_abc", STRIPE_WEBHOOK_SECRET: SECRET, ORDER_SINK_TOKEN: "t".repeat(40),
  ORDER_SINK_URL: "https://script.example/exec", SITE_URL: "https://site.example/shop", ALLOWED_ORIGINS: "https://site.example" };
const customer = { firstName: "Frank", lastName: "Filet", email: "frank@example.com", address1: "1 Test St", city: "Lismore", state: "NSW", postcode: "2480", phone: "0400", notes: "", gift: false };

function mockFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const body = init.body ? String(init.body) : "";
    calls.push({ url: String(url), init, body, params: body && init.headers && /x-www-form/.test(init.headers["content-type"] || "") ? new URLSearchParams(body) : null });
    return handler(String(url), init, body);
  };
  return calls;
}
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
const stripeMock = url => url.endsWith("/coupons") ? json({ id: "coupon_1" }) : json({ id: "cs_test_a1B2c3D4e5F6", url: "https://checkout.stripe.test/pay/cs_test_a1B2c3D4e5F6" });
async function signed(rawBody, secret = SECRET, t = Math.floor(Date.now() / 1000)) { return `t=${t},v1=${await computeSignature(secret, t, rawBody)}`; }
const paidSession = (over = {}) => ({ id: "cs_test_a1B2c3D4e5F6", object: "checkout.session", payment_status: "paid", payment_intent: "pi_3Abc123Def456", currency: "aud",
  amount_total: 2394, total_details: { amount_shipping: 1095, amount_discount: 0 }, customer_details: { email: "frank@example.com", name: "Frank Filet" },
  metadata: { cart: "ESG:1", name: "Frank Filet", addr1: "1 Test St", city: "Lismore", state: "NSW", postcode: "2480" }, ...over });
const evt = (session, type = "checkout.session.completed", livemode = false) => ({ id: "evt_1", type, livemode, data: { object: session } });

test("formEncode uses Stripe bracket notation", () => {
  const out = new URLSearchParams(formEncode({ a: 1, b: { c: 2 }, d: [{ e: 3 }, { e: 4 }], f: ["x", "y"], skip: undefined }));
  assert.equal(out.get("a"), "1"); assert.equal(out.get("b[c]"), "2"); assert.equal(out.get("d[1][e]"), "4"); assert.equal(out.get("f[0]"), "x"); assert.equal(out.has("skip"), false);
});
test("verifyWebhook accepts a valid signature", async () => {
  const raw = JSON.stringify({ hello: "world" });
  assert.deepEqual(await verifyWebhook(raw, await signed(raw), SECRET), { hello: "world" });
});
for (const [name, build] of [
  ["tampered body", async () => ({ raw: '{"hello":"evil"}', header: await signed('{"hello":"world"}') })],
  ["wrong secret", async () => ({ raw: "{}", header: await signed("{}", "whsec_other") })],
  ["stale timestamp", async () => ({ raw: "{}", header: await signed("{}", SECRET, Math.floor(Date.now() / 1000) - 3600) })],
  ["missing header", async () => ({ raw: "{}", header: "" })],
  ["no v1 signature", async () => ({ raw: "{}", header: `t=${Math.floor(Date.now() / 1000)}` })],
  ["non-numeric timestamp", async () => ({ raw: "{}", header: "t=abc,v1=00" })]
]) test("verifyWebhook rejects " + name, async () => {
  const { raw, header } = await build(); await assert.rejects(() => verifyWebhook(raw, header, SECRET));
});
test("verifyWebhook accepts any matching v1 among several", async () => {
  const raw = "{}"; const t = Math.floor(Date.now() / 1000);
  assert.deepEqual(await verifyWebhook(raw, `t=${t},v1=deadbeef,v1=${await computeSignature(SECRET, t, raw)}`, SECRET), {});
});

test("createCheckoutSession: one ESG is AUD 23.94, priced by the server", async () => {
  const calls = mockFetch(stripeMock);
  const r = await createCheckoutSession(env, { items: [{ sku: "ESG", qty: 1 }], code: "", customer, orderNumber: "ES1" }, PRODUCT_INDEX);
  assert.equal(r.totals.totalCents, 2394); assert.match(r.url, /^https:\/\/checkout\.stripe\.test/);
  assert.equal(calls.length, 1); const p = calls[0].params;
  assert.equal(p.get("line_items[0][price_data][unit_amount]"), "1299"); assert.equal(p.get("line_items[0][quantity]"), "1");
  assert.equal(p.get("shipping_options[0][shipping_rate_data][fixed_amount][amount]"), "1095"); assert.equal(p.get("mode"), "payment");
  assert.equal(p.get("shipping_address_collection[allowed_countries][0]"), "AU");
  assert.equal(p.get("metadata[cart]"), "ESG:1"); assert.equal(p.has("discounts[0][coupon]"), false);
  assert.equal(calls[0].init.headers.authorization, "Bearer sk_test_abc");
  assert.equal(p.get("success_url"), "https://site.example/shop/thank-you.html?paid=1&session_id={CHECKOUT_SESSION_ID}");
});
test("createCheckoutSession ignores any client-supplied price", async () => {
  const calls = mockFetch(stripeMock);
  await createCheckoutSession(env, { items: [{ sku: "ESG", qty: 1, price: 0.01, unitCents: 1 }], customer, total: 1 }, PRODUCT_INDEX);
  assert.equal(calls[0].params.get("line_items[0][price_data][unit_amount]"), "1299");
});
test("createCheckoutSession adds a coupon for discounts", async () => {
  const calls = mockFetch(stripeMock);
  const r = await createCheckoutSession(env, { items: [{ sku: "ESG", qty: 1 }], code: "WELCOME15", customer }, PRODUCT_INDEX);
  assert.equal(r.totals.discountCents, 195); assert.equal(r.totals.totalCents, 2394 - 195);
  assert.equal(calls.length, 2); assert.equal(calls[0].params.get("amount_off"), "195"); assert.equal(calls[1].params.get("discounts[0][coupon]"), "coupon_1");
});
test("createCheckoutSession rejects bad input before calling Stripe", async () => {
  const calls = mockFetch(stripeMock);
  for (const body of [{ items: [], customer }, { items: [{ sku: "ESG", qty: 1 }], customer: { ...customer, email: "nope" } }, { items: [{ sku: "ESG", qty: 1 }], code: "HACK", customer }])
    await assert.rejects(() => createCheckoutSession(env, body, PRODUCT_INDEX), CartError);
  assert.equal(calls.length, 0);
});
test("Live Stripe keys are blocked", async () => {
  mockFetch(stripeMock);
  await assert.rejects(() => createCheckoutSession({ ...env, STRIPE_SECRET_KEY: "sk_live_abc" }, { items: [{ sku: "ESG", qty: 1 }], customer }, PRODUCT_INDEX), /test mode only/);
});

test("sessionToLedgerOrder maps a paid session", () => {
  const o = sessionToLedgerOrder(paidSession(), false, PRODUCT_INDEX);
  assert.deepEqual([o.id, o.paymentId, o.livemode, o.currency, o.totalCents, o.shippingCents, o.discountCents], ["cs_test_a1B2c3D4e5F6", "pi_3Abc123Def456", false, "AUD", 2394, 1095, 0]);
  assert.deepEqual(o.items, [{ sku: "ESG", qty: 1, unitCents: 1299 }]); assert.equal(o.customer.email, "frank@example.com");
});
test("sessionToLedgerOrder treats a missing livemode flag as live (so the ledger refuses it)", () => {
  assert.equal(sessionToLedgerOrder(paidSession(), undefined, PRODUCT_INDEX).livemode, true);
  assert.equal(sessionToLedgerOrder(paidSession(), "false", PRODUCT_INDEX).livemode, true);
  assert.equal(sessionToLedgerOrder(paidSession(), false, PRODUCT_INDEX).livemode, false);
});
test("sessionToLedgerOrder rejects unknown SKUs", () => assert.throws(() => sessionToLedgerOrder(paidSession({ metadata: { cart: "NOPE:1" } }), false, PRODUCT_INDEX), /Unknown SKU/));

test("handleStripeEvent forwards a paid session to the ledger with the shared token", async () => {
  const calls = mockFetch(() => json({ status: "ok" }));
  const r = await handleStripeEvent(env, evt(paidSession()), PRODUCT_INDEX, globalThis.fetch);
  assert.deepEqual(r, { status: "ok", httpStatus: 200 });
  const sent = JSON.parse(calls[0].body); assert.equal(sent.source, "ecosilk-worker"); assert.equal(sent.token, env.ORDER_SINK_TOKEN); assert.equal(sent.order.totalCents, 2394);
});
test("handleStripeEvent: duplicate is acknowledged", async () => {
  mockFetch(() => json({ status: "duplicate_ignored" }));
  assert.equal((await handleStripeEvent(env, evt(paidSession()), PRODUCT_INDEX, globalThis.fetch)).httpStatus, 200);
});
for (const [name, respond] of [["ledger error", () => json({ status: "error" })], ["HTML error page", () => new Response("<html>nope</html>", { status: 200 })], ["ledger http 500", () => new Response("x", { status: 500 })]])
  test(`handleStripeEvent: ${name} → 500 so Stripe retries`, async () => {
    mockFetch(respond);
    assert.equal((await handleStripeEvent(env, evt(paidSession()), PRODUCT_INDEX, globalThis.fetch)).httpStatus, 500);
  });
test("handleStripeEvent: unpaid and unrelated events never touch the ledger", async () => {
  const calls = mockFetch(() => json({ status: "ok" }));
  assert.equal((await handleStripeEvent(env, evt(paidSession({ payment_status: "unpaid" })), PRODUCT_INDEX)).status, "not_paid");
  assert.equal((await handleStripeEvent(env, { type: "charge.refunded", data: { object: {} } }, PRODUCT_INDEX)).status, "ignored");
  assert.equal(calls.length, 0);
});

test("Router: bad signature → 400 and no ledger call", async () => {
  const calls = mockFetch(() => json({ status: "ok" }));
  const res = await handleRequest(new Request("https://w.test/stripe-webhook", { method: "POST", headers: { "stripe-signature": "t=1,v1=bad" }, body: JSON.stringify(evt(paidSession())) }), env);
  assert.equal(res.status, 400); assert.equal(calls.length, 0);
});
test("Router: valid signed event reaches the ledger", async () => {
  const calls = mockFetch(() => json({ status: "ok" }));
  const raw = JSON.stringify(evt(paidSession()));
  const res = await handleRequest(new Request("https://w.test/stripe-webhook", { method: "POST", headers: { "stripe-signature": await signed(raw) }, body: raw }), env);
  assert.equal(res.status, 200); assert.equal(calls.length, 1);
});
test("Router: /create-session returns a URL; cart errors are 400", async () => {
  mockFetch(stripeMock);
  const ok = await handleRequest(new Request("https://w.test/create-session", { method: "POST", headers: { origin: "https://site.example", "content-type": "application/json" }, body: JSON.stringify({ items: [{ sku: "ESG", qty: 1 }], customer }) }), env);
  assert.equal(ok.status, 200); assert.match((await ok.json()).url, /^https:\/\/checkout\.stripe\.test/);
  const bad = await handleRequest(new Request("https://w.test/create-session", { method: "POST", headers: { origin: "https://site.example" }, body: JSON.stringify({ items: [] }) }), env);
  assert.equal(bad.status, 400);
});
test("Router: Stripe failures do not leak details to the browser", async () => {
  mockFetch(() => json({ error: { message: "secret detail sk_test_abc" } }, 401));
  const res = await handleRequest(new Request("https://w.test/create-session", { method: "POST", body: JSON.stringify({ items: [{ sku: "ESG", qty: 1 }], customer }) }), env);
  assert.equal(res.status, 502); assert.doesNotMatch(await res.text(), /sk_test|secret detail/);
});

const realFetch = globalThis.fetch;
for (const [name, fn] of tests) { try { await fn(); passed++; console.log("PASS " + name); } catch (e) { console.error("FAIL " + name + "\n" + (e && e.stack || e)); process.exitCode = 1; } finally { globalThis.fetch = realFetch; } }
console.log(`${passed}/${tests.length} Stripe worker tests passed.`);
