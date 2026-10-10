# Ecosilk Bags — trial store

A fresh, accessible, static storefront for [Ecosilk Bags](https://www.ecosilkbags.com.au) built to run as a
**dummy site** alongside the current WordPress store, so the full order process can be tested end to end
before switching over.

Live trial: https://kindpathcollective.github.io/ecosilk-site/ (GitHub Pages, `main` branch)

## What's in the box

| Area | Where | Notes |
| --- | --- | --- |
| Storefront pages | `index.html`, `shop.html`, `product.html`, `cart.html`, `checkout.html`, `thank-you.html` | Multi-step checkout with PayPal Buttons (sandbox by default), promo codes, mix & match discount, free-gift rule, free-shipping progress |
| Content pages | `about.html`, `faq.html`, `contact.html`, `wholesale.html`, `stockists.html`, `policies.html`, `404.html` | FAQ & Product JSON-LD, sitemap, robots |
| Staff dashboard | `admin.html` | Launch checklist, orders seen in this browser, Formspree CSV import, funnel events, AI back-office helpers |
| Catalog | `assets/js/catalog-data.js` | 131 real SKUs from the WordPress store + 1 flagged "proposed" product (Travel Pouch 3-Pack) |
| Config | `assets/js/config.js` | Everything you need to change is here — see below |
| Store logic | `assets/js/store.js`, `layout.js`, `assistant.js`, `content.js` | No build step, no framework |
| AI worker | `worker/` | Cloudflare Worker: shopping assistant, thank-you notes, weekly digest / low-stock / packing / email drafts |
| Local dev server | `server/dev-server.mjs` | Serves the site and runs the worker code at `/api` so AI features work locally |

## Configure before launch (`assets/js/config.js`)

```js
TEST_MODE: true,            // false for launch — hides the "Place test order" button
PAYPAL_CLIENT_ID: "sb",     // your PayPal SANDBOX client ID for testing, LIVE client ID at launch
PAYPAL_ENV: "sandbox",      // "live" at launch
FORMSPREE: { orders: "", newsletter: "", contact: "", wholesale: "" }, // Formspree form IDs (e.g. "xyzabcde")
ASSISTANT_ENDPOINT: "",     // e.g. "https://ecosilk-ai.<account>.workers.dev" once the worker is deployed
GA4_ID: "", META_PIXEL_ID: "",
SHOW_SAMPLE_RATINGS: true,  // set false (or wire real reviews) before launch
```

Business rules (free shipping threshold, 3+ singles discount, discount codes, gift rule) live in the same file.

### Formspree

Create four forms at formspree.io (Orders, Newsletter, Contact, Wholesale) and paste each form's ID.
Orders arrive as an email with every field plus an `order_json` column; export CSV from Formspree and
paste it into the staff dashboard to analyse all orders together.

### PayPal

Testing: use a PayPal sandbox **business** app's client ID and pay with a sandbox **personal** account.
Launch: swap to the live client ID and set `PAYPAL_ENV: "live"`, `TEST_MODE: false`.
Payment capture happens client-side via PayPal Buttons; the order email records PayPal's capture ID.

### Existing sandbox automation handover

The sandbox client ID supplied in the handover is configured in `config.js`.
No PayPal client secret is stored in this repository. The handover identifies:

- Inventory ledger: https://docs.google.com/spreadsheets/d/1ocRweWN_gBlzv2gb4WtinX1sWzJTxFCJ_dn3UkBGu_g/edit
- Apps Script project ID: `1uBgQra4ADrUbU8faOR8kvrUJBuZdC6ex9SPespPnRmWf28yAOZFZ2TOw`
- PayPal webhook ID: `8WX66878RJ855574D`
- Reported subscriptions: `CHECKOUT.ORDER.APPROVED` and `PAYMENT.CAPTURE.COMPLETED`

These webhook settings are supplied by the handover, not independently verified.
The Sheet was inspected on 11 October 2026 and contained a single `Untitled`
inventory tab with SKU, Name, Variant, Price and Stock columns.
Apps Script source and deployment settings still need review before claiming
payment-to-ledger integration works.

The storefront deliberately does not POST browser order data to the PayPal webhook.
The no-payment test button must never simulate a payment event or reduce stock.
Only a genuine completed sandbox capture can exercise the existing webhook path.
The local order stores the PayPal order ID and completed capture ID separately,
and does not mark pending captures as paid.

Next verification: review webhook signature verification and idempotency in Apps
Script, perform an authenticated sandbox-buyer checkout, and reconcile the capture
ID, currency, amount, SKU quantities and exactly-once inventory change in the Sheet.
An approved order alone must not trigger paid fulfilment or inventory reduction.

### Claude Code deployment handoff

`tools/apps-script-deploy/CLAUDE-CODE-HANDOFF.md` contains the ready-to-use local
deployment instructions, reviewed sandbox receiver, and a staged clasp helper.
It clones and backs up the existing Apps Script, preserves other source files,
prepares the Advanced Sheets manifest, and separates source upload from activation
of the existing webhook deployment. It needs the user's local Google login.

The Sheet setup is complete: `Inventory` retains the existing inventory data and
`Orders` has the 12 reconciliation headers. The receiver has 26 passing mocked tests;
the helper has 6 passing mocked checks. These do not prove deployment or payment
success. Apps Script deployment and the authenticated buyer checkout remain pending.

### AI worker (Cloudflare, free tier)

```bash
cd worker
npm i -g wrangler && wrangler login
wrangler secret put AI_API_KEY        # your OpenAI or Anthropic key
# optional: wrangler secret put AI_PROVIDER (openai|anthropic), AI_MODEL, AI_BASE_URL
wrangler deploy                       # prints https://ecosilk-ai.<account>.workers.dev
```

Paste that URL into `ASSISTANT_ENDPOINT`. Set `ALLOWED_ORIGINS` in `worker/wrangler.toml` to your site's
origin(s). Without the worker the site still works: the helper answers from the catalog/FAQ, and the
thank-you note uses a static version.

## Run locally

```bash
AI_PROVIDER=openai AI_API_KEY=sk-... node server/dev-server.mjs 8787
# open http://127.0.0.1:8787
```

## Deploy

Pushing to `main` publishes to GitHub Pages. No build step. `.nojekyll` is present so `_`-prefixed
paths are served as-is.

## Launch checklist

The staff dashboard (`admin.html`) shows live status for each item:

1. PayPal live client ID, `TEST_MODE: false`
2. Four Formspree IDs
3. Worker deployed and `ASSISTANT_ENDPOINT` set
4. GA4 / Meta Pixel IDs (optional)
5. Replace sample ratings with real reviews, or hide them
6. Re-host product images (currently hot-linked from WordPress) before WordPress is switched off
7. Confirm policy wording: free shipping over $75, 3+ singles save 10%, 30-day returns, 1–2 day dispatch
8. Point `ecosilkbags.com.au` DNS at GitHub Pages and update `SITE_URL`

## Accessibility

Skip link, landmark regions, visible focus rings, WCAG AA colour contrast in both themes, keyboard-operable
colour swatches (arrow keys), reduced-motion support, `aria-live` cart/toast announcements, labelled form
fields with inline error messages, 44px+ touch targets.
