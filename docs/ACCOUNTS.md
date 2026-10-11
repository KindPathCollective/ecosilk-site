# Ecosilk checkout: which account is which

No secrets in this file. It exists because look-alike accounts caused most of the debugging time (2026-10-11).
Secret *values* live only in Bitwarden Secrets Manager. Set Worker secrets with `tools/secrets/set-worker-secret.ps1`,
check them with `tools/secrets/check-health.ps1`.

| System | Canonical account | Identifier | Notes |
|---|---|---|---|
| Cloudflare (Worker) | sam@kindpathcollective.org.au | account `2aa9d928752ef2f2380aab14446d58c8`, Worker `ecosilk-ai` at `https://ecosilk-ai.ecosilk.workers.dev` | A second, older Cloudflare account exists under sam@kindpathcollective.org (nothing points at it; to confirm empty, then delete) |
| Stripe (test) | "Ecosilk Bags sandbox" | `acct_1UP8fiFgBKLj1k3i` | The publishable key `pk_test_51UP8fiFg…` belongs to this account. The Stripe connector in Claude sees a *different* account, `acct_1UP8fRC7…`; don't mix its keys or sessions with the sandbox. Webhook destination `we_1UP9TZFgBKLj1k3ifs5qS3nF` (`checkout.session.completed`, `checkout.session.async_payment_succeeded`) |
| Google (Apps Script + Sheet) | to confirm owner (clasp is logged in as sam@kindpathcollective.org.au and can deploy) | script `1uBgQra4ADrUbU8faOR8kvrUJBuZdC6ex9SPespPnRmWf28yAOZFZ2TOw`, sheet `1ocRweWN_gBlzv2gb4WtinX1sWzJTxFCJ_dn3UkBGu_g` | Webhook deployment `AKfycbwPeM3WPX9FI2I0c1fCz4z4khKNy4dE2_mRWYPZt5utZXTFUN7YUJ_3l34A-bkUvoHm`: v11 = Stripe-capable receiver, v10 = PayPal-only reviewed receiver (rollback), v9 = original |
| GitHub | KindPathCollective | `KindPathCollective/ecosilk-site`, `main` publishes to Pages | Work on branches |

## Secrets the Worker needs

| Name | Where the real value comes from | Right shape |
|---|---|---|
| `STRIPE_SECRET_KEY` | Stripe sandbox, Developers → API keys (test) | `sk_test_…` |
| `STRIPE_WEBHOOK_SECRET` | The webhook destination's signing secret: **click reveal, then copy the revealed text** | `whsec_` + ~32 letters/digits |
| `ORDER_SINK_TOKEN` | Generated once; the same value must also be an Apps Script Script Property | one 32+ character string, no spaces |

## Lessons

- A masked field (`whsec_·················`) copies as dots. The Worker's `/health` shows booleans for each secret's shape, and a rejected webhook logs the reason and length/prefix, never the value.
- Clipboard values go stale. The script refuses wrong-shaped values before uploading and clears the clipboard afterwards.
