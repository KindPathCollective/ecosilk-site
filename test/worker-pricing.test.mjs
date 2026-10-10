// Parity test: Worker pricing (cents) must equal the storefront's computeTotals() (dollars).
import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { PRODUCT_INDEX } from "../worker/src/catalog.js";
import { priceCart, PRICING, CartError } from "../worker/src/pricing.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const mem = {};
const window = { name: "", localStorage: { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } } };
window.window = window;
const ctx = vm.createContext({ window, console, document: { addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], head: { appendChild() {} }, createElement: () => ({}) }, location: { hostname: "test" } });
for (const f of ["assets/js/config.js", "assets/js/catalog-data.js", "assets/js/content.js", "assets/js/store.js"]) {
  vm.runInContext(fs.readFileSync(path.join(root, f), "utf8"), ctx, { filename: f });
}
const E = window.ECOSILK_STORE || window.E || window.Ecosilk || Object.values(window).find(v => v && typeof v.computeTotals === "function");
assert.ok(E, "could not find store API on window");
const CFG = window.ECOSILK_CONFIG;

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log("PASS " + name); };

test("Worker constants match config.js", () => {
  assert.equal(PRICING.shippingFlatCents, Math.round(CFG.SHIPPING_FLAT * 100));
  assert.equal(PRICING.freeShippingThresholdCents, Math.round(CFG.FREE_SHIPPING_THRESHOLD * 100));
  assert.equal(PRICING.volumeRule.minQty, CFG.VOLUME_RULE.minQty);
  assert.equal(PRICING.volumeRule.percent, CFG.VOLUME_RULE.percent);
  assert.equal(PRICING.volumeRule.enabled, CFG.VOLUME_RULE.enabled);
  assert.equal(PRICING.currency, CFG.CURRENCY.toLowerCase());
  for (const [code, r] of Object.entries(CFG.DISCOUNT_CODES)) {
    assert.equal(PRICING.discountCodes[code].type, r.type, code);
    if (r.type === "percent") assert.equal(PRICING.discountCodes[code].value, r.value, code);
  }
  assert.deepEqual(Object.keys(PRICING.discountCodes).sort(), Object.keys(CFG.DISCOUNT_CODES).sort());
  assert.equal(PRICING.giftRules[0].minQty, CFG.GIFT_RULES[0].minQty);
});

test("Worker catalog prices match the storefront catalog", () => {
  for (const p of window.CATALOG) {
    if (!PRODUCT_INDEX[p.sku]) continue;
    assert.equal(Math.round(PRODUCT_INDEX[p.sku].price * 100), Math.round(p.price * 100), p.sku);
  }
});

const inStock = sku => PRODUCT_INDEX[sku] && PRODUCT_INDEX[sku].inStock;
const pick = pred => Object.keys(PRODUCT_INDEX).filter(s => inStock(s) && window.CATALOG.some(p => p.sku === s) && pred(PRODUCT_INDEX[s]));
const ESG = "ESG";
const shoulder = pick(p => p.category === "Shoulder / Beach Bag");
const packs = pick(p => /Pack/.test(p.category));
const minis = pick(p => p.category === "Mini Drawstring Bag");
const scenarios = [
  ["one ESG", [{ sku: ESG, qty: 1 }], ""],
  ["one ESG + WELCOME15", [{ sku: ESG, qty: 1 }], "WELCOME15"],
  ["one ESG + REEF10", [{ sku: ESG, qty: 1 }], "REEF10"],
  ["one ESG + FREESHIP", [{ sku: ESG, qty: 1 }], "FREESHIP"],
  ["3 singles (volume rule)", [{ sku: ESG, qty: 3 }], ""],
  ["3 singles + WELCOME15", [{ sku: ESG, qty: 3 }], "WELCOME15"],
  ["mixed singles across lines", [{ sku: ESG, qty: 1 }, { sku: minis[0], qty: 1 }, { sku: minis[1], qty: 1 }], ""],
  ["5 ESG crosses free-ship threshold", [{ sku: ESG, qty: 5 }], ""],
  ["pack only", [{ sku: packs[0], qty: 1 }], ""],
  ["pack + single", [{ sku: packs[0], qty: 1 }, { sku: ESG, qty: 1 }], "REEF10"],
  ["4 shoulder bags (gift rule)", [{ sku: shoulder[0], qty: 2 }, { sku: shoulder[1], qty: 2 }], ""],
  ["threshold edge", [{ sku: ESG, qty: 4 }, { sku: minis[0], qty: 3 }], "WELCOME15"]
];
for (const [name, items, code] of scenarios) test("Parity: " + name, () => {
  for (const k of Object.keys(mem)) delete mem[k];
  E.clearPromo();
  if (code) assert.ok(E.applyPromo(code).ok);
  const browser = E.computeTotals(items.map(i => ({ sku: i.sku, qty: i.qty })));
  const server = priceCart(items, code, PRODUCT_INDEX);
  const c = d => Math.round(d * 100);
  assert.equal(server.subtotalCents, c(browser.subtotal), "subtotal");
  assert.equal(server.discountCents, c(browser.discount + browser.volumeDiscount), "discount");
  assert.equal(server.shippingCents, c(browser.shipping), "shipping");
  assert.equal(server.totalCents, c(browser.total), "total");
  assert.equal(server.gifts.length, browser.gifts.length, "gifts");
});

test("Unpromoted single ESG is 12.99 + 10.95 = AUD 23.94", () => {
  assert.equal(priceCart([{ sku: ESG, qty: 1 }], "", PRODUCT_INDEX).totalCents, 2394);
});
for (const [name, items, code, re] of [
  ["empty cart", [], "", /empty/],
  ["unknown SKU", [{ sku: "NOPE", qty: 1 }], "", /Unknown/],
  ["zero qty", [{ sku: ESG, qty: 0 }], "", /quantity/],
  ["fractional qty", [{ sku: ESG, qty: 1.5 }], "", /quantity/],
  ["string qty", [{ sku: ESG, qty: "2" }], "", /quantity/],
  ["huge qty", [{ sku: ESG, qty: 999 }], "", /quantity/],
  ["bad code", [{ sku: ESG, qty: 1 }], "HACK100", /code/],
  ["out of stock", [{ sku: "EGU", qty: 1 }], "", /out of stock/]
]) test("Rejects " + name, () => assert.throws(() => priceCart(items, code, PRODUCT_INDEX), e => e instanceof CartError && re.test(e.message)));
test("Duplicate lines merge", () => {
  const r = priceCart([{ sku: ESG, qty: 1 }, { sku: ESG, qty: 2 }], "", PRODUCT_INDEX);
  assert.equal(r.lines.length, 1); assert.equal(r.lines[0].qty, 3);
});
console.log(`${passed} pricing tests passed.`);
