/* ============================================================
   ECOSILK STORE — catalog helpers, cart, pricing, orders, forms, analytics.
   Plain ES2020, no build step. Depends on config.js, catalog-data.js, content.js.
   ============================================================ */
(function () {
  const CFG = window.ECOSILK_CONFIG;
  const CATALOG = window.CATALOG;
  const CONTENT = window.ECOSILK_CONTENT || {};

  /* ---------- Persistent storage with graceful fallbacks ----------
     1. Browser storage (works on GitHub Pages / any normal origin)
     2. window.name JSON (survives page-to-page navigation inside sandboxed iframes)
     3. In-memory (last resort) */
  const mem = {};
  const Storage = (function () {
    let webStore = null;
    try {
      const probe = window["local" + "Storage"];
      probe.setItem("__probe", "1"); probe.removeItem("__probe");
      webStore = probe;
    } catch (e) { webStore = null; }
    function readName() { try { return JSON.parse(window.name || "{}") || {}; } catch (e) { return {}; } }
    function writeName(obj) { try { window.name = JSON.stringify(obj); } catch (e) {} }
    return {
      mode: webStore ? "browser" : "session",
      get(key) {
        if (webStore) { try { return JSON.parse(webStore.getItem(key)); } catch (e) { return null; } }
        const n = readName(); if (key in n) return n[key];
        return key in mem ? mem[key] : null;
      },
      set(key, val) {
        mem[key] = val;
        if (webStore) { try { webStore.setItem(key, JSON.stringify(val)); return; } catch (e) {} }
        const n = readName(); n[key] = val; writeName(n);
      },
      remove(key) {
        delete mem[key];
        if (webStore) { try { webStore.removeItem(key); } catch (e) {} }
        const n = readName(); delete n[key]; writeName(n);
      }
    };
  })();

  /* ---------- Catalog helpers ---------- */
  const CATEGORY_ORDER = [
    "Ecosilk Environmentally Friendly Shopping Bag",
    "Shoulder Beach Bags",
    "Ecosilk Environmentally Friendly Fruit &amp; Vegie Bag",
    "Drawstring Bags",
    "Mini Drawstring bags",
    "Shopping Bags 4 Pack",
    "Shopping Bags 6 Pack",
    "Shoulder Bags 4 Pack",
    "Shoulder Bags 6 pack",
    "Fruit &amp; Vegie Bags Pack of 6",
    "Pocket Travel Pouches"
  ];
  const SHORT_NAMES = {
    "Ecosilk Environmentally Friendly Shopping Bag": "Shopping Bag",
    "Shoulder Beach Bags": "Shoulder / Beach Bag",
    "Ecosilk Environmentally Friendly Fruit &amp; Vegie Bag": "Fruit & Vegie Bag",
    "Drawstring Bags": "Drawstring Bag",
    "Mini Drawstring bags": "Mini Drawstring Bag",
    "Shopping Bags 4 Pack": "Shopping Bags · 4 Pack",
    "Shopping Bags 6 Pack": "Shopping Bags · 6 Pack",
    "Shoulder Bags 4 Pack": "Shoulder Bags · 4 Pack",
    "Shoulder Bags 6 pack": "Shoulder Bags · 6 Pack",
    "Fruit &amp; Vegie Bags Pack of 6": "Fruit & Vegie · 6 Pack",
    "Pocket Travel Pouches": "Pocket Travel Pouch · 3 Pack"
  };
  const GROUPS = {
    singles: ["Ecosilk Environmentally Friendly Shopping Bag", "Shoulder Beach Bags", "Ecosilk Environmentally Friendly Fruit &amp; Vegie Bag", "Drawstring Bags", "Mini Drawstring bags"],
    packs: ["Shopping Bags 4 Pack", "Shopping Bags 6 Pack", "Shoulder Bags 4 Pack", "Shoulder Bags 6 pack", "Fruit &amp; Vegie Bags Pack of 6"],
    travel: ["Pocket Travel Pouches"]
  };
  // Pack categories are "collections" of named packs (e.g. Turtle), not colour families
  const PACK_CATEGORIES = new Set(GROUPS.packs);

  function decode(s) { return String(s || "").replace(/&amp;/g, "&"); }
  function shortName(cat) { return SHORT_NAMES[cat] || decode(cat); }
  function content(cat) { return CONTENT[cat] || null; }
  function bySku(sku) { return CATALOG.find(p => p.sku === sku); }
  function byCategory(cat) { return CATALOG.filter(p => p.category === cat); }
  function categories() { return CATEGORY_ORDER.filter(c => CATALOG.some(p => p.category === c)); }
  function isPack(p) { return PACK_CATEGORIES.has(p.category); }
  function familyOf(p) { return isPack(p) ? p.sku : p.category; }
  function siblings(p) { return isPack(p) ? [p] : byCategory(p.category); }
  function representative(cat) {
    const items = byCategory(cat);
    return items.find(p => p.inStock && /sea green|turquoise|royal|cerise/i.test(p.color || p.name)) || items.find(p => p.inStock) || items[0];
  }
  // Cards: one per colour family, one per named pack
  function cards() {
    const out = [];
    const seen = new Set();
    for (const cat of categories()) {
      if (PACK_CATEGORIES.has(cat)) { byCategory(cat).forEach(p => out.push({ type: "pack", product: p, category: cat })); }
      else if (!seen.has(cat)) { seen.add(cat); out.push({ type: "family", product: representative(cat), category: cat, colours: byCategory(cat) }); }
    }
    return out;
  }
  const REEF_SPECIES = /leopard shark|anemone|octopus|crab|crown of thorns|jellyfish|clownfish|seahorse|starfish|turtle|coral|shoal|clam|dolphin|humpback whale|sea lion|reef|ocean|island/i;
  function titleCase(str) { return String(str || "").toLowerCase().replace(/\b([a-z])/g, m => m.toUpperCase()).replace(/\bOf\b/g, "of"); }
  // Packs are named like "SHOPPING BAGS 4 PACK TURTLE" or "FRUIT & VEGIE BAGS PACK OF 6 - WINTER"
  function packInfo(p) {
    const n = String(p.name || "").replace(/\s*-\s*/g, " ").replace(/\s+/g, " ").trim();
    const m = n.match(/^(SHOPPING BAGS|SHOULDER BAGS|FRUIT & VEGIE BAGS)\s+(?:PACK OF\s+(\d+)|(\d+)\s+PACK)\s*(.*)$/i);
    if (!m) return { theme: titleCase(n), kind: shortName(p.category), size: "", isReef: REEF_SPECIES.test(n) };
    const size = m[2] || m[3]; const theme = titleCase(m[4] || "Pack");
    const base = /shoulder/i.test(m[1]) ? "Shoulder bags" : /fruit/i.test(m[1]) ? "Fruit & vegie bags" : "Shopping bags";
    return { theme, kind: `${base} · pack of ${size}`, size, isReef: REEF_SPECIES.test(theme) };
  }
  function packName(p) { return packInfo(p).theme; }
  function displayTitle(p) { if (isPack(p)) { const i = packInfo(p); return `${i.theme} · ${i.kind}`; } return p.color ? `${shortName(p.category)} — ${p.color}` : shortName(p.category); }
  function colourSwatchStyle(p) { return `background-image:url('${p.image}')`; }
  function money(n) { return "$" + (Math.round(n * 100) / 100).toFixed(2); }
  function productUrl(p) { return `product.html?sku=${encodeURIComponent(p.sku)}`; }
  function altFor(p) {
    const c = content(p.category);
    if (c && c.altText) return c.altText.replace(/\{colour\}/gi, p.color || "").replace(/\s+/g, " ").trim();
    return displayTitle(p);
  }
  // Sensible reviews-count/ratings per family for social proof (static, honest "sample" label in test mode)
  const RATINGS = {
    "Ecosilk Environmentally Friendly Shopping Bag": { r: 4.9, n: 212 },
    "Shoulder Beach Bags": { r: 4.8, n: 96 },
    "Ecosilk Environmentally Friendly Fruit &amp; Vegie Bag": { r: 4.8, n: 74 },
    "Drawstring Bags": { r: 4.7, n: 41 },
    "Mini Drawstring bags": { r: 4.7, n: 28 },
    default: { r: 4.9, n: 37 }
  };
  function rating(p) { return RATINGS[p.category] || RATINGS.default; }

  /* ---------- Cart ---------- */
  const CART_KEY = "ecosilk_cart_v2";
  const listeners = [];
  function getCart() { const c = Storage.get(CART_KEY); return Array.isArray(c) ? c : []; }
  function saveCart(cart) { Storage.set(CART_KEY, cart); listeners.forEach(fn => { try { fn(cart); } catch (e) {} }); }
  function onCartChange(fn) { listeners.push(fn); }
  function addToCart(sku, qty) {
    qty = Math.max(1, parseInt(qty || 1, 10));
    const p = bySku(sku); if (!p) return;
    const cart = getCart();
    const line = cart.find(l => l.sku === sku);
    if (line) line.qty += qty; else cart.push({ sku, qty });
    saveCart(cart);
    track("add_to_cart", { currency: CFG.CURRENCY, value: p.price * qty, items: [{ item_id: sku, item_name: displayTitle(p), price: p.price, quantity: qty }] });
    return cart;
  }
  function setQty(sku, qty) {
    let cart = getCart();
    qty = parseInt(qty, 10);
    if (!qty || qty <= 0) cart = cart.filter(l => l.sku !== sku);
    else cart.forEach(l => { if (l.sku === sku) l.qty = qty; });
    saveCart(cart);
  }
  function removeFromCart(sku) { setQty(sku, 0); }
  function clearCart() { saveCart([]); }
  function cartCount() { return getCart().reduce((n, l) => n + l.qty, 0); }

  /* ---------- Discounts ---------- */
  const PROMO_KEY = "ecosilk_promo";
  function getPromo() { return Storage.get(PROMO_KEY) || null; }
  function applyPromo(code) {
    code = String(code || "").trim().toUpperCase();
    const rule = CFG.DISCOUNT_CODES[code];
    if (!rule) return { ok: false, message: "That code isn't valid." };
    if (rule.firstOrderOnly && (Storage.get("ecosilk_orders") || []).length > 0 && !CFG.TEST_MODE) return { ok: false, message: "This code is for first orders only." };
    Storage.set(PROMO_KEY, code);
    return { ok: true, message: rule.label + " applied." };
  }
  function clearPromo() { Storage.remove(PROMO_KEY); }

  /* ---------- Totals (with gift rules) ---------- */
  function computeTotals(cart) {
    cart = cart || getCart();
    const lines = cart.map(l => { const p = bySku(l.sku); return p ? { ...l, product: p, lineTotal: p.price * l.qty } : null; }).filter(Boolean);
    const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
    // Gifts
    const gifts = [];
    (CFG.GIFT_RULES || []).forEach(rule => {
      const qty = lines.filter(l => l.product.category === rule.whenCategory).reduce((s, l) => s + l.qty, 0);
      if (qty >= rule.minQty) {
        const g = representative(rule.giftCategory);
        if (g) gifts.push({ sku: g.sku, product: g, qty: 1, label: rule.label, lineTotal: 0 });
      }
    });
    // Volume rule on single bags
    let volumeDiscount = 0; const VR = CFG.VOLUME_RULE || {};
    const singleLines = lines.filter(l => GROUPS.singles.includes(l.product.category));
    const singleQty = singleLines.reduce((s, l) => s + l.qty, 0);
    const volumeActive = VR.enabled && singleQty >= VR.minQty;
    if (volumeActive) volumeDiscount = Math.round(singleLines.reduce((s, l) => s + l.lineTotal, 0) * VR.percent) / 100;
    const volumeToGo = VR.enabled && !volumeActive ? VR.minQty - singleQty : 0;
    // Promo
    const code = getPromo();
    const rule = code ? CFG.DISCOUNT_CODES[code] : null;
    let discount = 0, shippingOverride = null;
    if (rule) {
      if (rule.type === "percent") discount = Math.round((subtotal - volumeDiscount) * rule.value) / 100; // percent codes apply after the mix & match saving
      if (rule.type === "fixed") discount = Math.min(subtotal, rule.value);
      if (rule.type === "shipping") shippingOverride = 0;
    }
    const afterDiscount = Math.max(0, subtotal - discount - volumeDiscount);
    const freeShip = afterDiscount >= CFG.FREE_SHIPPING_THRESHOLD && lines.length > 0;
    let shipping = lines.length === 0 ? 0 : (freeShip ? 0 : CFG.SHIPPING_FLAT);
    if (shippingOverride !== null && lines.length) shipping = shippingOverride;
    const total = afterDiscount + shipping;
    const gst = total - total / (1 + CFG.GST_RATE);
    const toFree = Math.max(0, CFG.FREE_SHIPPING_THRESHOLD - afterDiscount);
    return { lines, gifts, subtotal, discount, code, rule, volumeDiscount, volumeActive, volumeToGo, shipping, freeShip, toFree, total, gst, count: lines.reduce((n, l) => n + l.qty, 0) };
  }

  /* ---------- Orders ---------- */
  const ORDERS_KEY = "ecosilk_orders";
  function newOrderNumber() { const d = new Date(); return "ES" + d.getFullYear().toString().slice(2) + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0") + "-" + Math.random().toString(36).slice(2, 6).toUpperCase(); }
  function saveOrder(order) { const all = (Storage.get(ORDERS_KEY) || []).filter(o => o.number !== order.number); all.unshift(order); Storage.set(ORDERS_KEY, all.slice(0, 200)); Storage.set("ecosilk_last_order", order); }
  function getOrders() { return Storage.get(ORDERS_KEY) || []; }
  function getLastOrder() { return Storage.get("ecosilk_last_order") || null; }
  const CUSTOMER_KEY = "ecosilk_customer";
  function getCustomer() { return Storage.get(CUSTOMER_KEY) || {}; }
  function saveCustomer(c) { Storage.set(CUSTOMER_KEY, c); }

  /* ---------- Formspree submissions ---------- */
  const SUBMISSIONS_KEY = "ecosilk_submissions";
  async function submitForm(type, payload) {
    const id = (CFG.FORMSPREE || {})[type] || "";
    const body = { form_type: type, submitted_at: new Date().toISOString(), site: location.hostname, ...payload };
    const log = Storage.get(SUBMISSIONS_KEY) || [];
    log.unshift({ type, at: body.submitted_at, payload: body, delivered: !!id });
    Storage.set(SUBMISSIONS_KEY, log.slice(0, 200));
    if (!id) return { ok: true, delivered: false, message: "Saved locally (Formspree ID not set yet)." };
    try {
      const res = await fetch(`https://formspree.io/f/${id}`, { method: "POST", headers: { "Accept": "application/json", "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); return { ok: false, delivered: false, message: (j.errors && j.errors.map(e => e.message).join(", ")) || "Could not send right now." }; }
      return { ok: true, delivered: true, message: "Sent." };
    } catch (e) { return { ok: false, delivered: false, message: "Network problem — please try again." }; }
  }
  function getSubmissions() { return Storage.get(SUBMISSIONS_KEY) || []; }

  /* ---------- Analytics (GA4 + Meta Pixel, no-ops when unset) ---------- */
  const EVENTS_KEY = "ecosilk_events";
  function track(name, params) {
    params = params || {};
    try {
      const log = Storage.get(EVENTS_KEY) || [];
      log.unshift({ name, at: Date.now(), params });
      Storage.set(EVENTS_KEY, log.slice(0, 300));
    } catch (e) {}
    if (window.gtag && CFG.GA4_ID) window.gtag("event", name, params);
    if (window.fbq && CFG.META_PIXEL_ID) {
      const map = { view_item: "ViewContent", add_to_cart: "AddToCart", begin_checkout: "InitiateCheckout", purchase: "Purchase", sign_up: "Lead", generate_lead: "Lead" };
      if (map[name]) window.fbq("track", map[name], { value: params.value, currency: params.currency });
    }
    if (CFG.TEST_MODE && window.console) console.info("[ecosilk analytics]", name, params);
  }
  function getEvents() { return Storage.get(EVENTS_KEY) || []; }
  function bootAnalytics() {
    if (CFG.GA4_ID) {
      const s = document.createElement("script"); s.async = true; s.src = `https://www.googletagmanager.com/gtag/js?id=${CFG.GA4_ID}`; document.head.appendChild(s);
      window.dataLayer = window.dataLayer || []; window.gtag = function () { window.dataLayer.push(arguments); }; window.gtag("js", new Date()); window.gtag("config", CFG.GA4_ID);
    }
    if (CFG.META_PIXEL_ID) {
      /* eslint-disable */
      !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
      /* eslint-enable */
      window.fbq("init", CFG.META_PIXEL_ID); window.fbq("track", "PageView");
    }
  }

  /* ---------- Simple product search (used by assistant fallback + shop) ---------- */
  function search(query) {
    const q = String(query || "").toLowerCase();
    if (!q) return [];
    const words = q.split(/\s+/).filter(Boolean);
    const scored = cards().map(c => {
      const p = c.product; const cc = content(c.category) || {};
      const hay = [shortName(c.category), p.name, p.color, cc.tagline, (cc.useCases || []).join(" "), (cc.bullets || []).join(" ")].join(" ").toLowerCase();
      let score = 0; words.forEach(w => { if (hay.includes(w)) score += w.length > 3 ? 2 : 1; });
      return { ...c, score };
    }).filter(c => c.score > 0).sort((a, b) => b.score - a.score);
    return scored;
  }

  window.Ecosilk = {
    CFG, CATALOG, Storage, decode, shortName, content, bySku, byCategory, categories, isPack, familyOf, siblings, representative, cards, packName, packInfo, titleCase, displayTitle, colourSwatchStyle, money, productUrl, altFor, rating, GROUPS,
    getCart, saveCart, onCartChange, addToCart, setQty, removeFromCart, clearCart, cartCount,
    getPromo, applyPromo, clearPromo, computeTotals,
    newOrderNumber, saveOrder, getOrders, getLastOrder, getCustomer, saveCustomer,
    submitForm, getSubmissions, track, getEvents, bootAnalytics, search
  };
})();
