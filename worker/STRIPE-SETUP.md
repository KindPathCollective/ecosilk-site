# Stripe checkout (test mode) — setup and test

Hosted Stripe Checkout, created and verified by the Worker, recorded in the Sheet by the Apps Script.
Nothing here can take a live payment: the Worker refuses non-test Stripe keys, the ledger refuses
non-test sessions, and `PAYMENT_PROVIDER` stays `"paypal"` until you flip it.

```
Browser ──SKUs+qty──▶ Worker /create-session ──▶ Stripe Checkout (hosted page)
                                                      │ payment
Stripe ──signed webhook──▶ Worker /stripe-webhook ──token──▶ Apps Script ──▶ Sheet (Orders + Inventory, one atomic write)
```

## One-off setup

1. **Stripe** (dashboard in *Test mode*): copy your test secret key (`sk_test_…`). Don't paste it in chat or commit it.
2. **Worker secrets** (from `worker/`):
   ```bash
   npx wrangler secret put STRIPE_SECRET_KEY      # sk_test_…
   npx wrangler secret put ORDER_SINK_TOKEN       # any long random string (40+ chars); keep a copy for step 4
   ```
   `SITE_URL` and `ORDER_SINK_URL` are already in `wrangler.toml`. Then `npx wrangler deploy`.
3. **Stripe webhook**: Developers → Webhooks → Add endpoint →
   `https://<your-worker>.workers.dev/stripe-webhook`, events `checkout.session.completed` and
   `checkout.session.async_payment_succeeded`. Copy the signing secret (`whsec_…`), then:
   ```bash
   npx wrangler secret put STRIPE_WEBHOOK_SECRET
   ```
4. **Apps Script**: Project Settings → Script Properties → add `ORDER_SINK_TOKEN` with the *same* value as step 2.
   Deploy the updated receiver (`tools/apps-script-deploy`: `stage`, review, `push-head`, `activate --setup-verified`).
5. **Site**: in `assets/js/config.js` set `PAYMENT_PROVIDER: "stripe"` and `PAYMENTS_ENDPOINT: "https://<your-worker>.workers.dev"`.

## Test checkout (no real money)

1. Note baseline stock for one SKU (e.g. ESG) and confirm Orders has no rows.
2. Add exactly one ESG, **no promo**; the total must read **AUD 23.94** (12.99 + 10.95 shipping).
3. Pay with test card `4242 4242 4242 4242`, any future expiry, any CVC.
4. Verify separately: exactly one Orders row (Order ID `cs_test_…`, Capture ID `pi_…`, AUD 23.94,
   environment `stripe-test`), and ESG stock down by exactly 1.
5. In Stripe → Webhooks → your endpoint, resend the event; confirm nothing changes (duplicate ignored).

## Notes and limits

- **Session creation was verified against Stripe's test API** (single ESG → `amount_total` 2394; with a 195¢ coupon → 2199, `amount_discount` 195, `amount_shipping` 1095). **Webhook delivery and the Worker→Sheet hand-off have not run end to end yet** — that is what your first test checkout proves. Stripe's hosted page will also ask for the shipping address again.

- The `PayPal Environment` column holds `stripe-test` for Stripe rows (header left unchanged on purpose).
- Prices, discounts and shipping are computed on the Worker; `test/worker-pricing.test.mjs` fails if
  they ever drift from the storefront's `computeTotals()`.
- The Worker only knows in/out of stock; the Sheet holds the real counts. An order that overshoots
  stock is rejected by the ledger after payment and needs manual reconciliation (Stripe will keep
  retrying the webhook for up to 3 days).
- Free-gift items are noted in Stripe metadata but not recorded in the ledger.
- Going live is a separate, deliberate change (live keys, `ALLOW_LIVE`, ledger live-mode support). Not included.

## Tests

```bash
node test/worker-pricing.test.mjs
node test/worker-stripe.test.mjs
node tools/apps-script-deploy/test-receiver.cjs
```
