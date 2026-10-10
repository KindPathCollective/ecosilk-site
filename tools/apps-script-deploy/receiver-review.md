# Ecosilk sandbox receiver review

Reviewed 11 October 2026. This review compares the supplied `ecosilk-order-receiver.gs`
with the current trial checkout and the linked Google Sheet. It does not verify
that the uploaded file is identical to the currently deployed Apps Script version.
No deployed script, Sheet, stock, webhook registration or payment was changed.

### Subsequent approved setup

After approval to proceed, the existing `Untitled` tab was renamed to `Inventory`
without writing to its inventory cells, and an empty `Orders` tab was added with
the 12 candidate headers. Readback confirmed both tab names, the Orders headers
and unchanged sample inventory rows. All 24 offline tests passed again.
The Apps Script candidate is still not deployed, and no sandbox payment was made.
The initial schema blocker described below is now resolved.

### Local deployment handoff prepared

A read-only `checkSandboxReceiverSetup` function was added to the candidate.
It checks headers, required properties, service availability and sandbox OAuth,
without writing inventory or orders or sending mail. Two additional mocked tests
passed, bringing the current receiver test count to 26.

A local Claude Code/clasp deployment helper is available in the GitHub repository
under `tools/apps-script-deploy`. It backs up the source and separates preparation,
head-source upload, and activation of the existing webhook deployment.
Its six mocked integration checks passed. It has not been run against Google.

## Verdict

Do not call the original receiver end-to-end ready. The first concrete blocker is
the Sheet schema: it currently has only an `Untitled` tab, while the supplied
receiver requires `Inventory` and `Orders`. The receiver would fail when it calls
`getRange()` on the missing Orders tab.

The reviewed candidate is a sandbox-only replacement for inspection and testing,
not a production-ready payment backend. Deployment still requires approval,
configuration changes and an authenticated sandbox-buyer checkout.

## Findings in the original file

- **Missing tabs:** Lines 153–163 require `Orders` and `Inventory`. The linked
  Sheet was inspected read-only and has neither name.
- **Duplicate race:** Lines 89–94 check for a previous order without a lock.
  Two concurrent events can both pass that check and each change inventory.
- **Partial writes:** Lines 181–195 append the order first, then change stock
  one item at a time. If a stock update fails, replay sees the existing order
  and skips the remaining updates.
- **Capture/order confusion:** Lines 108–117 fall back to `resource.id` even
  for capture events. When the related order ID is missing, this sends a capture
  ID to the Orders endpoint.
- **Incomplete payment checks:** Lines 83–87 check the order status, but not
  the completed capture, capture amount/currency, expected merchant or ledger
  prices. The original has no independent check of discount entitlement.
- **Invalid inventory handling:** Lines 193–213 turn invalid/zero quantities
  into one, silently clamp stock at zero, and only log unknown SKUs.
- **Missing reconciliation fields:** The order row omits capture ID, currency
  and sandbox/live environment. Its `pending` status does not distinguish paid
  orders awaiting fulfilment from pending payments.
- **Incomplete shipping address:** Lines 176–179 omit address line 2, state
  and country.
- **Customer-controlled spreadsheet input:** `appendRow` receives payer text
  directly. The candidate uses typed string values, not spreadsheet formulas.

## What the candidate changes

`ecosilk-order-receiver-reviewed.gs` keeps the authenticated PayPal order lookup,
but adds a script lock around deduplication and writing, event-specific order ID
extraction, merchant/currency/capture validation, ledger price and quantity checks,
strict headers, aggregated SKU quantities, and insufficient-stock rejection.

It records the order and every stock update in one
`Sheets.Spreadsheets.batchUpdate` request. Google documents that if one request
in a batch is unsuccessful, the other changes are not written either
([Google Sheets batch updates](https://developers.google.com/workspace/sheets/api/guides/batchupdate)).
The script lock only coordinates executions in this script project; it does not
lock out manual spreadsheet changes or other scripts.

It also records capture ID, currency and environment, preserves more address
fields, stores customer text as typed strings, and treats notification-email
failure separately from a successful ledger write.

The candidate deliberately refuses live mode and multiple purchase units/captures.
Any rejected order that is already paid needs manual reconciliation; stock
rejection does not refund a payment or create an exception row.

## Remaining architecture limitations

- **Webhook authenticity:** The uploaded code uses the webhook only as a trigger
  for an authenticated PayPal lookup. That does not authenticate the sender.
  Google's documented web-app event object does not expose request headers
  ([Apps Script web apps](https://developers.google.com/apps-script/guides/web)).
  For full signature verification, use a header-capable receiver such as a
  Cloudflare Worker. PayPal explicitly says unverified messages cannot establish
  that their sender was PayPal
  ([PayPal webhook overview](https://developer.paypal.com/api/rest/webhooks/)).
- **Retry reliability:** Returning `{"status":"error"}` is not an HTTP error
  status. PayPal retries non-2xx responses, up to 25 times over three days;
  a successful HTTP response can therefore acknowledge a failed application
  operation ([PayPal delivery rules](https://developer.paypal.com/api/rest/webhooks/)).
  The candidate retains this platform limitation. A durable failure queue and
  reconciliation job, or a receiver with control over HTTP status, is needed.
- **Untrusted checkout totals:** The candidate checks ledger unit prices and
  amount arithmetic, not whether a discount/free shipping was authorised.
  The existing checkout calculates totals client-side. Production should create
  orders using a server-priced cart, with trusted offers and stock checks.
- **Quota abuse:** An unauthenticated trigger can initiate PayPal lookups.
  This candidate adds a body-size limit, not robust rate limiting.
- **No reservation/refund handling:** Inventory is changed after capture.
  This does not reserve stock during payment, process refunds or prevent
  concurrent manual inventory edits.

## Checkout compatibility gaps

The current checkout sends paid product SKUs and quantities to PayPal, and those
can be reconciled against Inventory. However:

- Free drawstring gifts appear in the local order/Formspree payload, not in the
  PayPal `items` array. This receiver will not record or decrement them.
- Gift-message flags, checkout notes and the storefront's local order number are
  not sent as fields this receiver consumes.
- The receiver uses PayPal payer identity/email, not necessarily the checkout
  contact identity. Its shipping address is taken from the PayPal order.
- The proposed Travel Pouch SKU may not exist in Inventory. The candidate rejects
  any SKU missing from the ledger.
- Formspree order email remains a separate path. A webhook ledger entry does not
  prove Formspree delivery works.

Use a plain, known-inventory SKU without a promotion or gift for the first sandbox
payment test. Then test discounts, shipping thresholds and gifts separately after
their trusted fulfilment data path is implemented.

## Configuration before deploying the candidate

1. Preserve existing inventory data; rename `Untitled` to `Inventory` only with
   approval. Check the first five headers are exactly:
   `SKU | Name | Variant | Price | Stock`.
2. Add `Orders` with these 12 headers:
   `Order ID | Date | Items (SKU x qty) | Customer Name | Email | Address |
   Total | Status | Tracking | Capture ID | Currency | PayPal Environment`.
3. In Apps Script, enable the Advanced Google Sheets service, identifier `Sheets`.
   Ensure its underlying Sheets API is enabled if the linked Cloud project requires it.
4. Keep existing `SHEET_ID`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` properties.
   Add the sandbox seller's `PAYPAL_MERCHANT_ID` and `EXPECTED_CURRENCY=AUD`;
   keep `PAYPAL_ENV=sandbox`. Do not paste secrets into website code or chat.
5. Optional `NOTIFY_EMAIL` enables the receiver's sandbox notification email.
6. Review the candidate, authorise its required services, then update the existing
   Apps Script deployment to a new version so the webhook URL stays unchanged.
   None of these remote steps has been performed.

## Test evidence and next acceptance check

Run `node test-receiver.cjs` beside the candidate. All 24 offline mocked tests
passed, covering happy path, replays, approved-before-capture, missing related order
ID, pending capture, merchant/currency/amount mismatch, unknown/duplicate SKUs,
invalid quantities, price mismatch, insufficient stock, tab/header problems,
multiple purchase units, arithmetic mismatch, lock contention, simulated atomic
failure, live-mode refusal, malformed/unrelated events, email failure and typed text.

These tests do not exercise Google's real atomicity, real concurrent executions,
PayPal credentials, webhook delivery, deployment permissions or a real checkout.

Acceptance requires one authenticated sandbox buyer payment. Record baseline
stock first; reconcile order ID, completed capture ID, AUD amount and quantities;
check exactly one Orders row and one stock decrement. Replay the real event and
confirm neither changes again. Reconcile failures manually rather than assuming
PayPal will retry an Apps Script JSON error.
