# Ecosilk Apps Script deployment handoff

This folder prepares deployment from the user's Windows machine using their
existing Google/clasp login. No secret is stored in this repository. Remote
deployment and the authenticated sandbox checkout have NOT been performed here.

## Paste this into Claude Code

> Set up the reviewed Ecosilk sandbox receiver from
> `KindPathCollective/ecosilk-site`, folder `tools/apps-script-deploy`.
> Use my existing local Google/clasp setup. Read this handoff and the review before
> executing remote writes. Run the offline tests. Then run
> `node deploy-receiver.mjs stage`; it clones the existing Apps Script, backs it up
> locally outside the upload directory, preserves unrelated project files and
> prepares the receiver and Advanced Sheets manifest.
>
> Review the staged diff before running `node deploy-receiver.mjs push-head`.
> Do not upload backups or unrelated local files. Do not expose OAuth files,
> client secrets, tokens or Script Properties in chat or logs.
>
> Help me set the missing sandbox merchant ID and other properties in the Apps
> Script editor, then run `checkSandboxReceiverSetup`. It is read-only apart from
> obtaining a PayPal OAuth token. After it reports `ready:true`, run
> `node deploy-receiver.mjs activate --setup-verified`.
> Update only the existing webhook deployment; do not create a new webhook URL.
>
> Finally, guide me through a one-ESG, no-promo sandbox buyer checkout. Do not make
> a live payment or use the no-payment test button. Record baseline stock and
> reconcile exactly one order row, capture ID, AUD amount and stock decrement.
> Ask before replaying the real PayPal webhook event. Report deployment and
> checkout separately; do not claim either succeeded without verifying it.

## Required configuration

The Sheet is already prepared:
`Inventory` preserves the existing inventory data, and `Orders` contains 12 headers.
Do not rename or recreate either tab.

- `SHEET_ID`: `1ocRweWN_gBlzv2gb4WtinX1sWzJTxFCJ_dn3UkBGu_g`
- `PAYPAL_ENV`: `sandbox`
- `EXPECTED_CURRENCY`: `AUD`
- `PAYPAL_CLIENT_ID`: preserve the configured sandbox app ID.
- `PAYPAL_CLIENT_SECRET`: preserve the existing Script Property; source it only
  through the user's existing Bitwarden setup if missing. Never hardcode it.
- `PAYPAL_MERCHANT_ID`: sandbox seller's merchant ID, not buyer ID, client ID or
  webhook ID. Obtain/confirm it in the sandbox seller's account settings.
- `NOTIFY_EMAIL`: optional sandbox notification destination.

The helper uses pinned `@google/clasp@3.4.1` and needs Node.js 20+ according to that
package's declared engine. Existing Google authorisation may need renewing locally.
The Apps Script API must be enabled for clasp use. The helper enables the Advanced
Sheets service in the manifest; a linked standard Cloud project may also need its
Google Sheets API enabled and the script owner must authorise the new scopes.

## Safeguards and limits

- Staging performs no remote source or deployment mutation.
- `push-head` modifies the project source, but does not switch the existing
  deployed webhook version. Save the original source backup.
- `activate` requires explicit setup confirmation and targets the existing
  deployment ID from the handover.
- Source upload replaces remote project contents. Avoid concurrent editor changes;
  pull/review afresh if someone edits the project after staging.
- An unrecognised remote source, unavailable deployment or failed command stops
  the helper. Diagnose instead of repeatedly pushing or inventing a new deployment.
- The helper cannot set Script Properties or perform editor authorisation through
  ordinary clasp source upload. Those steps are explicitly required.
- Deployment changes are not rolled back automatically. Keep the old deployed
  version available if a rollback is needed.
- The receiver remains sandbox-only. The review documents discount trust,
  webhook signature/retry, free-gift fulfilment and reconciliation limitations.

## Offline test and checkout

Run `node test-receiver.cjs` in this folder. These are mocks, not a deployed test.
The first buyer checkout should use exactly one `ESG` and no promo/gift.
The current unpromoted amount is AUD 23.94: 12.99 product plus 10.95 shipping.
Verify the UI total before payment, then match order and capture IDs to the Sheet.

## CLI reference

Current clasp clone, push, version and deployment commands are documented in
[the clasp repository](https://github.com/google/clasp).
This helper's command arguments were checked against the pinned package's CLI help.
