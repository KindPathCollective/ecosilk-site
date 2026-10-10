/* ============================================================
   ECOSILK ASSISTANT — floating shopping helper.
   With ASSISTANT_ENDPOINT set it talks to the AI worker (see /worker).
   Without it, it runs a smart catalog + FAQ mode so nothing breaks.
   ============================================================ */
(function () {
  const E = window.Ecosilk; const CFG = E.CFG;
  const endpoint = (CFG.ASSISTANT_ENDPOINT || "").replace(/\/$/, "");
  const available = () => !!endpoint;
  async function call(path, body) {
    const res = await fetch(endpoint + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error("assistant " + res.status);
    return res.json();
  }

  const FAQ = [
    { k: /ship|post|deliver|freight|how long|arrive/i, a: `Shipping is a flat $${CFG.SHIPPING_FLAT} anywhere in Australia, and free once your order reaches $${CFG.FREE_SHIPPING_THRESHOLD}. Orders leave our Northern Rivers base within 1–2 business days. For international orders, send us a message via the contact page and we'll quote you.` },
    { k: /wash|clean|care|iron|dry/i, a: "Quick machine wash, line dry, and a cool iron only if you must. The nylon dries in minutes and the colours hold." },
    { k: /heavy|weight|carry|kg|kilo|strong|capacity|hold/i, a: "The shopping and shoulder bags carry up to 14 kg each — a full week's shop, six bottles, a watermelon. They're guaranteed for at least 5 years of daily or weekly use." },
    { k: /guarantee|warranty|last|durab|break|rip/i, a: "Every shopping and shoulder bag is guaranteed for a minimum of 5 years with daily or weekly use. If the stitching gives up before then, we replace it." },
    { k: /recycl|end of life|landfill|dispose|throw/i, a: `When a bag is finally worn out, post it back to ${CFG.BUSINESS.recyclingAddress}. The nylon is endlessly recyclable, so it never has to go to landfill.` },
    { k: /return|refund|exchange|change my mind/i, a: "Unused bags can be returned within 30 days for a refund. Faulty bags are covered by the 5-year guarantee at any time." },
    { k: /size|dimension|big|how large|measure/i, a: "Shopping bag: 55 cm long × 32.5 cm wide, expanding to 52 cm with the gusset. Shoulder / beach bag: 70 cm × 32.5 cm, same gusset. Drawstring bag: 27 cm × 16 cm." },
    { k: /made|where|china|australia|ethic/i, a: "Ecosilk is 100% Australian owned and designed by Emily Hay in the Northern Rivers of NSW. The bags are made in China to a high standard under ethical working conditions." },
    { k: /material|nylon|silk|parachute|plastic|fabric/i, a: "It's 100% nylon 'parachute silk' — strong, feather-light, quick-drying, colourfast and endlessly recyclable. Not actual silk, and no plastic bag in sight." },
    { k: /discount|code|promo|offer|deal|save|cheap/i, a: `Three ways to save: any 3 single bags together take 10% off, orders over $${CFG.FREE_SHIPPING_THRESHOLD} ship free, and new customers get 15% off with WELCOME15.` },
    { k: /gift|present|wrap/i, a: "The Reef Collection packs are the easy gift — four or six coordinated colours named after a reef species. The mini drawstring bag also works as a reusable gift wrap for a single shopping bag. Tick 'this is a gift' at checkout to keep prices off the packing slip." },
    { k: /wholesale|bulk|fundrais|logo|print|custom|school|club/i, a: "We print logos and artwork on shopping, shoulder and fruit & vegie bags for fundraising and promotions, with healthy margins for schools and clubs. Use the Fundraising & custom page to tell us what you need." },
    { k: /stock|available|sold out|back in/i, a: "Most colours are in stock. If one you want is out, pick another colour or leave your email on the contact page and we'll let you know when it's back." },
    { k: /stockist|store|shop near|buy local|where can i buy/i, a: "You'll find Ecosilk in health food stores, post offices and gift shops across Australia — see the stockists page for the full list by state." },
    { k: /beach|gym|travel|holiday|suitcase|overnight/i, a: "The shoulder / beach bag is the pick for that — longer, with a big armhole, and it still folds flat. The travel pouch set keeps shoes and laundry sorted inside a suitcase." },
    { k: /market|fruit|veg|produce|grocer/i, a: "Fruit & vegie bags are the lightweight produce bags; most people take four to six and a shopping bag to carry them home. Three or more singles save 10%." }
  ];

  function fallbackReply(text, history) {
    const hits = FAQ.filter(f => f.k.test(text));
    const products = E.search(text).slice(0, 3).map(c => c.product.sku);
    if (/hello|hi\b|hey|g'day/i.test(text) && !hits.length) return { reply: "Hi there. I can help you pick a bag, answer questions about shipping, care and the guarantee, or build a set that qualifies for a discount. What are you after?", products: [] };
    if (hits.length) return { reply: hits.slice(0, 2).map(h => h.a).join("\n\n"), products };
    if (products.length) return { reply: "Here's what matches. Tap one to see colours, or add it straight to your bag.", products };
    return { reply: `I'm not sure about that one. For anything specific, email ${CFG.BUSINESS.email} or call ${CFG.BUSINESS.phoneDisplay} and a human will sort it. Otherwise, try asking about sizes, shipping, washing or which bag suits what.`, products: [] };
  }

  /* ---------- UI ---------- */
  const history = [];
  const el = document.createElement("div");
  el.innerHTML = `
<button class="assist-fab" id="assistFab" type="button" aria-expanded="false" aria-controls="assistPanel">${E.ICONS.spark}<span>Ask Ecosilk</span></button>
<section class="assist-panel" id="assistPanel" role="dialog" aria-label="Ecosilk shopping helper" aria-modal="false">
  <div class="assist-head"><div><b>${E.ICONS.spark} Ecosilk helper<small id="assistMode"></small></b></div><button class="icon-btn" id="assistClose" type="button" aria-label="Close helper">${E.ICONS.close}</button></div>
  <div class="assist-log" id="assistLog" aria-live="polite"></div>
  <div class="assist-chips" id="assistChips"></div>
  <form class="assist-form" id="assistForm"><label class="visually-hidden" for="assistInput">Your question</label><input id="assistInput" autocomplete="off" placeholder="Ask about sizes, shipping, gifts…" maxlength="400"><button type="submit" aria-label="Send">${E.ICONS.send}</button></form>
</section>`;
  document.body.appendChild(el);
  const fab = document.getElementById("assistFab"), panel = document.getElementById("assistPanel"), log = document.getElementById("assistLog"), input = document.getElementById("assistInput");
  document.getElementById("assistMode").textContent = available() ? "AI-powered · answers in seconds" : "Instant answers from our catalog & FAQ";

  const CHIPS = ["Which bag for a weekly shop?", "How much is shipping?", "Best gift under $60", "Can I wash it?", "Build me a set that saves 10%"];
  const chips = document.getElementById("assistChips");
  function renderChips(list) { chips.innerHTML = list.map(c => `<button type="button">${c}</button>`).join(""); chips.querySelectorAll("button").forEach(b => b.addEventListener("click", () => send(b.textContent))); }
  renderChips(CHIPS);

  function open() { panel.classList.add("open"); fab.setAttribute("aria-expanded", "true"); if (!log.children.length) bot({ reply: "Hi, I'm the Ecosilk helper. Ask me which bag suits you, how to care for it, or what ships free. I can add things to your bag too.", products: [] }); setTimeout(() => input.focus(), 50); }
  function close() { panel.classList.remove("open"); fab.setAttribute("aria-expanded", "false"); fab.focus(); }
  fab.addEventListener("click", () => panel.classList.contains("open") ? close() : open());
  document.getElementById("assistClose").addEventListener("click", close);
  document.addEventListener("keydown", e => { if (e.key === "Escape" && panel.classList.contains("open")) close(); });
  window.addEventListener("hashchange", () => { if (location.hash === "#ask") open(); }); if (location.hash === "#ask") open();

  function md(text) {
    const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    return esc(text).split(/\n{2,}/).map(block => {
      const lines = block.split("\n");
      if (lines.every(l => /^\s*[-•*]\s+/.test(l))) return `<ul>${lines.map(l => `<li>${l.replace(/^\s*[-•*]\s+/, "")}</li>`).join("")}</ul>`;
      return `<p>${block.replace(/\n/g, "<br>").replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")}</p>`;
    }).join("");
  }
  function user(text) { const m = document.createElement("div"); m.className = "msg user"; m.textContent = text; log.appendChild(m); log.scrollTop = log.scrollHeight; }
  function bot(r) {
    const m = document.createElement("div"); m.className = "msg bot"; m.innerHTML = md(r.reply || ""); log.appendChild(m);
    const skus = (r.products || []).map(s => E.bySku(s)).filter(Boolean).slice(0, 4);
    if (skus.length) {
      const wrap = document.createElement("div"); wrap.className = "msg-products";
      wrap.innerHTML = skus.map(p => `<div class="mini-product"><img src="${p.image}" alt="${E.altFor(p)}" width="56" height="56"><div class="t"><a href="${E.productUrl(p)}">${E.isPack(p) ? p.name : E.shortName(p.category)}</a><small>${E.isPack(p) ? "Reef pack" : p.color} · ${E.money(p.price)}</small></div>${p.inStock ? `<button class="btn btn-dark" type="button" data-add="${p.sku}">Add</button>` : `<span class="small muted">Out</span>`}</div>`).join("");
      log.appendChild(wrap);
    }
    (r.actions || []).forEach(a => { if (a.type === "add_to_cart" && E.bySku(a.sku)) { E.addToCart(a.sku, a.qty || 1); E.toast(`${E.displayTitle(E.bySku(a.sku))} added to your bag`, { href: "cart.html", label: "View bag" }); } if (a.type === "apply_code") { E.applyPromo(a.code); } });
    if (r.suggestions && r.suggestions.length) renderChips(r.suggestions.slice(0, 4));
    log.scrollTop = log.scrollHeight;
  }
  function typing(on) { let t = document.getElementById("assistTyping"); if (on && !t) { t = document.createElement("div"); t.id = "assistTyping"; t.className = "msg bot"; t.innerHTML = '<span class="typing" aria-label="Thinking"><i></i><i></i><i></i></span>'; log.appendChild(t); log.scrollTop = log.scrollHeight; } if (!on && t) t.remove(); }

  async function send(text) {
    text = String(text || "").trim(); if (!text) return; input.value = "";
    user(text); history.push({ role: "user", content: text }); E.track("assistant_message", { mode: available() ? "ai" : "local" });
    typing(true);
    let r;
    try {
      if (available()) {
        const t = E.computeTotals();
        r = await call("/assistant", { messages: history.slice(-10), context: { page: location.pathname.split("/").pop(), cart: t.lines.map(l => ({ sku: l.sku, qty: l.qty, name: E.displayTitle(l.product) })), cartTotal: t.total, sku: new URLSearchParams(location.search).get("sku") } });
      } else { await new Promise(res => setTimeout(res, 350)); r = fallbackReply(text, history); }
    } catch (e) { r = fallbackReply(text, history); r.reply = r.reply; }
    typing(false); bot(r); history.push({ role: "assistant", content: r.reply || "" });
  }
  document.getElementById("assistForm").addEventListener("submit", e => { e.preventDefault(); send(input.value); });

  window.EcosilkAssistant = { available, call, open, send };
})();
