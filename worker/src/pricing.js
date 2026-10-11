/* ============================================================
   ECOSILK SERVER-SIDE PRICING — the browser never sets a price.
   Mirrors assets/js/store.js computeTotals() in integer cents.
   test/worker-pricing.test.mjs fails if the two ever disagree.
   ============================================================ */

export const PRICING = {
  currency: "aud",
  shippingFlatCents: 1095,
  freeShippingThresholdCents: 7500,
  // Short category names, as used in catalog.js (store.js SHORT_NAMES).
  singles: ["Shopping Bag", "Shoulder / Beach Bag", "Fruit & Vegie Bag", "Drawstring Bag", "Mini Drawstring Bag"],
  volumeRule: { enabled: true, minQty: 3, percent: 10 },
  giftRules: [{ whenCategory: "Shoulder / Beach Bag", minQty: 4, label: "Free drawstring bag (4+ shoulder bags)" }],
  discountCodes: {
    WELCOME15: { type: "percent", value: 15 },
    REEF10: { type: "percent", value: 10 },
    FREESHIP: { type: "shipping" }
  },
  maxLines: 30,
  maxQtyPerLine: 50
};

export class CartError extends Error {}

const toCents = dollars => Math.round(dollars * 100);

/** items: [{ sku, qty }]; code: optional discount code; catalog: PRODUCT_INDEX. */
export function priceCart(items, code, catalog, rules = PRICING) {
  if (!Array.isArray(items) || !items.length) throw new CartError("Your bag is empty.");
  if (items.length > rules.maxLines) throw new CartError("Too many different items in one order.");
  const merged = new Map();
  for (const item of items) {
    const sku = String(item && item.sku || "");
    const qty = item && item.qty;
    const product = catalog[sku];
    if (!product) throw new CartError(`Unknown item: ${sku.slice(0, 20)}`);
    if (!Number.isSafeInteger(qty) || qty < 1 || qty > rules.maxQtyPerLine) throw new CartError("Invalid quantity.");
    if (product.inStock === false) throw new CartError(`${product.name} is out of stock.`);
    merged.set(sku, (merged.get(sku) || 0) + qty);
  }
  const lines = [...merged].map(([sku, qty]) => {
    const p = catalog[sku];
    const unitCents = toCents(p.price);
    return { sku, qty, name: p.name, category: p.category, unitCents, lineCents: unitCents * qty };
  });
  const subtotalCents = lines.reduce((s, l) => s + l.lineCents, 0);

  const gifts = [];
  for (const rule of rules.giftRules) {
    const qty = lines.filter(l => l.category === rule.whenCategory).reduce((s, l) => s + l.qty, 0);
    if (qty >= rule.minQty) gifts.push(rule.label);
  }

  const singleLines = lines.filter(l => rules.singles.includes(l.category));
  const singleQty = singleLines.reduce((s, l) => s + l.qty, 0);
  const vr = rules.volumeRule;
  let volumeCents = 0;
  if (vr.enabled && singleQty >= vr.minQty) {
    volumeCents = Math.round(singleLines.reduce((s, l) => s + l.lineCents, 0) * vr.percent / 100);
  }

  const normalised = String(code || "").trim().toUpperCase();
  const rule = normalised ? rules.discountCodes[normalised] : null;
  if (normalised && !rule) throw new CartError("That discount code isn't valid.");
  let promoCents = 0, freeShippingCode = false;
  if (rule) {
    if (rule.type === "percent") promoCents = Math.round((subtotalCents - volumeCents) * rule.value / 100);
    if (rule.type === "shipping") freeShippingCode = true;
  }

  const afterDiscountCents = Math.max(0, subtotalCents - promoCents - volumeCents);
  const shippingCents = freeShippingCode || afterDiscountCents >= rules.freeShippingThresholdCents ? 0 : rules.shippingFlatCents;
  return {
    lines, gifts, code: rule ? normalised : "",
    subtotalCents, volumeCents, promoCents, discountCents: volumeCents + promoCents,
    shippingCents, totalCents: afterDiscountCents + shippingCents
  };
}
