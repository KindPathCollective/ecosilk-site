/* ============================================================
   ECOSILK LAYOUT — shared header, footer, theme, toasts, welcome offer,
   product card renderer, newsletter + form helpers.
   ============================================================ */
(function () {
  const E = window.Ecosilk; const CFG = E.CFG;
  const page = (location.pathname.split("/").pop() || "index.html").toLowerCase();

  const ICONS = {
    bag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>',
    menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4m11.4-11.4 1.4-1.4"/></svg>',
    moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
    leaf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.5 19 2c1 2 2 4.2 2 8 0 5.5-4.8 10-10 10Z"/><path d="M2 21c0-3 1.9-5.5 5-6"/></svg>',
    truck: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/></svg>',
    recycle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 19H4.8a1.8 1.8 0 0 1-1.6-2.7l1.6-2.8"/><path d="m11 19-4 0 2-3.5"/><path d="M16.2 19h3a1.8 1.8 0 0 0 1.6-2.7l-1.5-2.6"/><path d="m14.3 16 2 3.5-4 0"/><path d="m8.5 8.5 1.7-3a1.8 1.8 0 0 1 3.1 0l1.5 2.5"/><path d="M7.5 12 9.3 8.4l3.2 2.3"/></svg>',
    spark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1M5.6 18.4l2.1-2.1m8.6-8.6 2.1-2.1"/><circle cx="12" cy="12" r="3"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>'
  };
  E.ICONS = ICONS;

  /* ---------- Theme ---------- */
  let theme = E.Storage.get("ecosilk_theme") || (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  function applyTheme(t) { theme = t; document.documentElement.setAttribute("data-theme", t); const b = document.getElementById("themeToggle"); if (b) { b.innerHTML = t === "dark" ? ICONS.sun : ICONS.moon; b.setAttribute("aria-label", t === "dark" ? "Switch to light mode" : "Switch to dark mode"); } }
  applyTheme(theme);

  /* ---------- Header / footer ---------- */
  const NAV = [["index.html", "Home"], ["shop.html", "Shop"], ["about.html", "Our impact"], ["wholesale.html", "Fundraising & custom"], ["faq.html", "FAQ"], ["contact.html", "Contact"]];
  function header() {
    const links = NAV.map(([href, label]) => `<a href="${href}" ${page === href ? 'aria-current="page"' : ""}>${label}</a>`).join("");
    return `
<a class="skip-link" href="#main">Skip to content</a>
<div class="announce" role="region" aria-label="Offers">Free shipping on orders over ${E.money(CFG.FREE_SHIPPING_THRESHOLD).replace(".00", "")} · New here? Take 15% off with <a href="#" data-open-offer>WELCOME15</a></div>
<header class="site-header">
  <div class="wrap header-row">
    <a class="brand" href="index.html" aria-label="Ecosilk Bags home">
      <img class="logo-light" src="assets/img/logo-t.png" alt="Ecosilk Bags" width="140" height="61">
      <img class="logo-dark" src="assets/img/logo-dark.png" alt="" width="140" height="61">
    </a>
    <nav class="nav-links" id="navLinks" aria-label="Main">${links}</nav>
    <div class="header-actions">
      <button class="icon-btn" id="themeToggle" type="button" aria-label="Switch theme"></button>
      <a class="cart-btn" href="cart.html" aria-label="Your bag">${ICONS.bag}<span>Bag</span><span class="count" data-cart-count aria-live="polite">0</span></a>
      <button class="icon-btn menu-btn" id="menuBtn" type="button" aria-expanded="false" aria-controls="navLinks" aria-label="Open menu">${ICONS.menu}</button>
    </div>
  </div>
</header>`;
  }
  function footer() {
    const B = CFG.BUSINESS;
    return `
<footer class="site-footer">
  <div class="wrap">
    <div class="footer-grid">
      <div class="footer-brand">
        <img class="logo-light" src="assets/img/logo-t.png" alt="Ecosilk Bags" width="150" height="65">
        <img class="logo-dark" src="assets/img/logo-dark.png" alt="" width="150" height="65" style="display:none">
        <p>Strong, pocket-sized reusable bags made from 100% recyclable parachute-silk nylon. Australian owned and designed in the Northern Rivers since 2001.</p>
        <p class="footer-ack">We acknowledge the Widjabul Wia-bal people of the Bundjalung Nation, Traditional Custodians of the land where Ecosilk is based, and pay respect to Elders past and present.</p>
      </div>
      <nav aria-label="Shop"><h3>Shop</h3><ul role="list">
        <li><a href="shop.html">All bags</a></li>
        <li><a href="shop.html?group=singles">Single bags</a></li>
        <li><a href="shop.html?group=packs">Reef Collection packs</a></li>
        <li><a href="shop.html?cat=Shoulder%20Beach%20Bags">Shoulder / beach bags</a></li>
        <li><a href="wholesale.html">Fundraising &amp; custom print</a></li>
      </ul></nav>
      <nav aria-label="Help"><h3>Help</h3><ul role="list">
        <li><a href="faq.html">FAQ</a></li>
        <li><a href="policies.html#shipping">Shipping &amp; returns</a></li>
        <li><a href="about.html#recycling">Recycle your bag</a></li>
        <li><a href="stockists.html">Find a stockist</a></li>
        <li><a href="contact.html">Contact us</a></li>
      </ul></nav>
      <div><h3>Get in touch</h3><ul role="list">
        <li><a href="mailto:${B.email}">${B.email}</a></li>
        <li><a href="tel:${B.phone.replace(/\s/g, "")}">${B.phoneDisplay}</a></li>
        <li><span class="small muted">${B.address}</span></li>
        <li><a href="https://www.marineconservation.org.au/" target="_blank" rel="noopener noreferrer">Proud supporter of AMCS ↗</a></li>
      </ul></div>
    </div>
    <div class="footer-bottom">
      <span>© ${new Date().getFullYear()} Ecosilk Bags. ${B.abnNote}</span>
      <span><a href="policies.html#privacy">Privacy</a> · <a href="policies.html#terms">Terms</a> · <a href="admin.html">Staff</a></span>
    </div>
  </div>
</footer>
<div class="toast-region" id="toasts" aria-live="polite" aria-atomic="false"></div>`;
  }
  function offerModal() {
    return `
<dialog class="modal" id="offerModal" aria-labelledby="offerTitle">
  <form method="dialog" class="modal-body" id="offerForm">
    <button class="icon-btn close" value="cancel" aria-label="Close">${ICONS.close}</button>
    <span class="eyebrow">A small welcome</span>
    <h2 id="offerTitle">15% off your first order</h2>
    <p class="muted">Join the list for new colours and reef updates. Your code appears straight away — no waiting on an email.</p>
    <div class="field"><label for="offerEmail">Email</label><input id="offerEmail" name="email" type="email" autocomplete="email" required placeholder="you@example.com"></div>
    <button class="btn btn-primary btn-block" type="submit" value="join">Get my code</button>
    <p class="small muted">No spam. Unsubscribe any time.</p>
  </form>
</dialog>`;
  }

  document.body.insertAdjacentHTML("afterbegin", header());
  document.body.insertAdjacentHTML("beforeend", footer() + offerModal());
  applyTheme(theme);

  // Dark-mode logo swap in footer
  const syncFooterLogos = () => { document.querySelectorAll(".footer-brand .logo-light").forEach(i => i.style.display = theme === "dark" ? "none" : "block"); document.querySelectorAll(".footer-brand .logo-dark").forEach(i => i.style.display = theme === "dark" ? "block" : "none"); };
  syncFooterLogos();
  document.getElementById("themeToggle").addEventListener("click", () => { applyTheme(theme === "dark" ? "light" : "dark"); E.Storage.set("ecosilk_theme", theme); syncFooterLogos(); });

  // Mobile menu
  const menuBtn = document.getElementById("menuBtn"), navLinks = document.getElementById("navLinks");
  menuBtn.addEventListener("click", () => { const open = navLinks.classList.toggle("open"); menuBtn.setAttribute("aria-expanded", String(open)); menuBtn.innerHTML = open ? ICONS.close : ICONS.menu; menuBtn.setAttribute("aria-label", open ? "Close menu" : "Open menu"); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && navLinks.classList.contains("open")) menuBtn.click(); });

  // Cart count
  function syncCount() { document.querySelectorAll("[data-cart-count]").forEach(el => el.textContent = E.cartCount()); }
  syncCount(); E.onCartChange(syncCount);

  /* ---------- Toasts ---------- */
  E.toast = function (msg, link) {
    const region = document.getElementById("toasts");
    const el = document.createElement("div"); el.className = "toast"; el.setAttribute("role", "status");
    el.innerHTML = `<span>${msg}</span>${link ? `<a href="${link.href}">${link.label}</a>` : ""}`;
    region.appendChild(el); setTimeout(() => el.remove(), 4200);
  };

  /* ---------- Welcome offer ---------- */
  const modal = document.getElementById("offerModal");
  function openOffer() { if (modal && typeof modal.showModal === "function" && !modal.open) modal.showModal(); }
  document.addEventListener("click", e => { const t = e.target.closest("[data-open-offer]"); if (t) { e.preventDefault(); openOffer(); } });
  document.getElementById("offerForm").addEventListener("submit", async e => {
    if (e.submitter && e.submitter.value === "cancel") { E.Storage.set("ecosilk_offer_seen", true); return; }
    e.preventDefault();
    const email = document.getElementById("offerEmail").value.trim();
    if (!email) return;
    const res = await E.submitForm("newsletter", { email, source: "welcome_offer", _subject: "New Ecosilk subscriber" });
    E.Storage.set("ecosilk_offer_seen", true); E.Storage.set("ecosilk_subscriber", email);
    E.applyPromo("WELCOME15"); E.track("sign_up", { method: "welcome_offer" });
    modal.querySelector(".modal-body").innerHTML = `<button class="icon-btn close" value="cancel" aria-label="Close">${ICONS.close}</button><span class="eyebrow">You're in</span><h2>Your code is ready</h2><p class="muted">We've applied it to your bag already. It also works at checkout any time in the next 30 days.</p><div class="code-box" aria-label="Discount code">WELCOME15</div><a class="btn btn-primary" href="shop.html">Start shopping</a>${res.delivered ? "" : `<p class="small muted">${res.message}</p>`}`;
    modal.querySelector(".close").addEventListener("click", () => modal.close());
  });
  if (!E.Storage.get("ecosilk_offer_seen") && !/checkout|thank-you|admin|cart/.test(page)) {
    let shown = false;
    const show = () => { if (shown) return; shown = true; openOffer(); };
    setTimeout(show, 18000);
    document.addEventListener("mouseleave", e => { if (e.clientY <= 0) show(); }, { once: true });
  }

  /* ---------- Product card renderer ---------- */
  E.productCard = function (card, opts) {
    opts = opts || {};
    const p = card.product; const c = E.content(card.category) || {};
    const rt = E.rating(p);
    const pi = card.type === "pack" ? E.packInfo(p) : null;
    const title = card.type === "family" ? E.shortName(card.category) : pi.theme;
    const meta = card.type === "family" ? `${card.colours.filter(x => x.inStock).length} colours` : pi.kind;
    const dots = card.type === "family" ? `<div class="colour-dots" aria-hidden="true">${card.colours.slice(0, 6).map(x => `<span style="${E.colourSwatchStyle(x)}"></span>`).join("")}${card.colours.length > 6 ? `<em>+${card.colours.length - 6}</em>` : ""}</div>` : "";
    const badges = [];
    if (opts.badge) badges.push(`<span class="badge">${opts.badge}</span>`);
    if (card.type === "pack" && pi.isReef) badges.push(`<span class="badge badge-ink">Reef Collection</span>`);
    if (p.proposed) badges.push(`<span class="badge badge-accent">New idea</span>`);
    if (!p.inStock) badges.push(`<span class="badge badge-green">Back soon</span>`);
    return `
<article class="product-card" data-sku="${p.sku}">
  ${badges.length ? `<div class="card-badges">${badges.join("")}</div>` : ""}
  <div class="thumb"><img src="${p.image}" alt="${E.altFor(p)}" loading="lazy" decoding="async" width="400" height="400"></div>
  <div class="info">
    <h3><a href="${E.productUrl(p)}">${title}</a></h3>
    <div class="meta">${meta}</div>
    ${dots}
    ${CFG.SHOW_SAMPLE_RATINGS ? `<div class="rating" aria-label="Rated ${rt.r} out of 5 from ${rt.n} reviews"><span class="stars" aria-hidden="true">★★★★★</span> ${rt.r} <span class="muted">(${rt.n})</span></div>` : ""}
    <div class="price-row">
      <span class="price">${card.type === "family" ? E.money(p.price) : E.money(p.price)}</span>
      ${card.type === "pack" && p.inStock ? `<button class="btn btn-sm btn-outline quick-add" type="button" data-add="${p.sku}" aria-label="Add ${E.displayTitle(p)} to bag">Add</button>` : `<span class="small muted">${card.type === "family" ? "Choose colour" : ""}</span>`}
    </div>
  </div>
</article>`;
  };

  // Global quick-add handler
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-add]"); if (!b) return;
    e.preventDefault();
    const sku = b.getAttribute("data-add"); const qty = parseInt(b.getAttribute("data-qty") || "1", 10);
    E.addToCart(sku, qty);
    const p = E.bySku(sku);
    E.toast(`${E.displayTitle(p)} added to your bag`, { href: "cart.html", label: "View bag" });
    const txt = b.textContent; b.textContent = "Added"; setTimeout(() => b.textContent = txt, 1200);
  });

  /* ---------- Newsletter inline forms ---------- */
  E.bindNewsletter = function (form) {
    form.addEventListener("submit", async e => {
      e.preventDefault();
      const input = form.querySelector('input[type="email"]'); const email = input.value.trim(); if (!email) return;
      const btn = form.querySelector("button"); btn.disabled = true; btn.textContent = "Joining…";
      const res = await E.submitForm("newsletter", { email, source: form.getAttribute("data-source") || "footer", _subject: "New Ecosilk subscriber" });
      E.Storage.set("ecosilk_subscriber", email); E.applyPromo("WELCOME15"); E.track("sign_up", { method: "newsletter" });
      form.outerHTML = `<div class="form-success" role="status">Welcome aboard. Use <strong>WELCOME15</strong> for 15% off your first order — we've added it to your bag.${res.delivered ? "" : ` <span class="small">(${res.message})</span>`}</div>`;
    });
  };
  document.querySelectorAll("form[data-newsletter]").forEach(E.bindNewsletter);

  /* ---------- Reveal on scroll ---------- */
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(entries => entries.forEach(en => { if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); } }), { rootMargin: "0px 0px -8% 0px" });
    document.querySelectorAll(".reveal").forEach(el => io.observe(el));
  } else document.querySelectorAll(".reveal").forEach(el => el.classList.add("in"));

  /* ---------- Form validation helper ---------- */
  E.validate = function (form) {
    let ok = true;
    form.querySelectorAll(".field").forEach(f => {
      const input = f.querySelector("input, select, textarea"); if (!input) return;
      const valid = input.checkValidity();
      f.setAttribute("data-invalid", valid ? "false" : "true");
      input.setAttribute("aria-invalid", valid ? "false" : "true");
      if (!valid && ok) { input.focus(); ok = false; }
    });
    return ok;
  };

  /* ---------- Abandoned bag nudge ---------- */
  if (page === "index.html" || page === "shop.html") {
    const c = E.getCart();
    if (c.length && !E.Storage.get("ecosilk_nudged_" + new Date().toDateString())) {
      E.Storage.set("ecosilk_nudged_" + new Date().toDateString(), true);
      setTimeout(() => E.toast(`You've got ${E.cartCount()} item${E.cartCount() > 1 ? "s" : ""} waiting in your bag`, { href: "cart.html", label: "Finish up" }), 2500);
    }
  }

  E.bootAnalytics();
  E.track("page_view", { page_title: document.title, page_path: location.pathname });
})();
