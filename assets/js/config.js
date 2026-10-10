/* ============================================================
   ECOSILK SITE CONFIG — the only file you should need to edit
   to connect real services. Everything degrades gracefully when
   a value is blank (test mode), so the site never breaks.
   ============================================================ */
window.ECOSILK_CONFIG = {
  // --- Mode ---
  // true  = "dummy run": test-order button shown, submissions logged locally when
  //         Formspree isn't set, analytics printed to console.
  // false = production behaviour.
  TEST_MODE: true,

  // --- Payments (PayPal) ---
  // "sb" is PayPal's generic sandbox test client. Replace with your own sandbox
  // client ID from developer.paypal.com → Apps & Credentials, then with the LIVE
  // client ID when you go live. Set PAYPAL_ENV to "live" at the same time.
  PAYPAL_CLIENT_ID: "AZ2QiaVg4WCQ6hMBvllDmWiYp7jVIvqFMcf2czr1-KDKz7YPkI70nauA7MFJwcpkZ0Y9KHlRA6ohzvzc",
  PAYPAL_ENV: "sandbox",
  CURRENCY: "AUD",

  // --- Formspree (orders, newsletter, contact, wholesale) ---
  // Create forms at formspree.io and paste each form's ID (the part after /f/).
  // One form can be reused for all four; the `form_type` field tells them apart.
  FORMSPREE: {
    orders: "",
    newsletter: "",
    contact: "",
    wholesale: ""
  },

  // --- AI helpers ---
  // URL of the deployed Cloudflare Worker (see /worker/README.md), no trailing slash.
  // Blank = assistant runs in "smart catalog" mode with no AI backend.
  ASSISTANT_ENDPOINT: "",

  // --- Analytics (optional) ---
  GA4_ID: "",          // e.g. "G-XXXXXXX"
  META_PIXEL_ID: "",   // e.g. "123456789"

  // Star ratings / review counts on product cards are SAMPLE figures for the trial.
  // Set to false to hide them until real reviews are imported.
  SHOW_SAMPLE_RATINGS: true,

  // --- Commerce rules ---
  SHIPPING_FLAT: 10.95,            // Australia-wide flat rate
  FREE_SHIPPING_THRESHOLD: 75,     // free shipping at/above this subtotal
  GST_RATE: 0.10,                  // prices are GST-inclusive; shown for the invoice
  LOW_STOCK_HINT: 5,               // "Only a few left" display threshold for packs
  DISCOUNT_CODES: {
    WELCOME15: { type: "percent", value: 15, label: "15% welcome offer", firstOrderOnly: true },
    REEF10:    { type: "percent", value: 10, label: "10% Reef Collection supporter" },
    FREESHIP:  { type: "shipping", value: 0, label: "Free shipping" }
  },
  // Volume offer (suggested for the trial — set `enabled: false` to switch off):
  // buy any 3 or more single bags and save 10% on those bags.
  VOLUME_RULE: { enabled: true, minQty: 3, percent: 10, label: "Mix & match: 3+ single bags save 10%" },
  // Real Ecosilk offer: a free drawstring bag with 4+ single shoulder bags
  GIFT_RULES: [
    { whenCategory: "Shoulder Beach Bags", minQty: 4, giftCategory: "Drawstring Bags", label: "Free drawstring bag (4+ shoulder bags)" }
  ],

  // --- Business details ---
  BUSINESS: {
    name: "Ecosilk Bags",
    email: "info@ecosilkbags.com.au",
    phone: "+61 439 461 919",
    phoneDisplay: "0439 461 919",
    address: "PO Box 6306, South Lismore NSW 2480",
    recyclingAddress: "Ecosilk Bags, 159 McClelland Rd, Barkers Vale NSW 2474",
    abnNote: "Prices include GST."
  },

  // Public URL once DNS is pointed (used for canonical/OG tags and the sitemap)
  SITE_URL: "https://kindpathcollective.github.io/ecosilk-site"
};

// Local development: `node server/dev-server.mjs` serves the site and proxies /api to the worker code,
// so the AI helpers work without deploying anything.
if (!window.ECOSILK_CONFIG.ASSISTANT_ENDPOINT && /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
  window.ECOSILK_CONFIG.ASSISTANT_ENDPOINT = "/api";
}
