# Ecosilk AI worker

A tiny Cloudflare Worker that gives the static site its AI features:

| Endpoint        | Used by                      | What it does                                      |
| --------------- | ---------------------------- | ------------------------------------------------- |
| `POST /assistant`  | "Ask Ecosilk" helper on every page | Product advice, FAQs, builds sets, adds to bag |
| `POST /order-note` | Thank-you page               | Personalised thank-you + care note for the order  |
| `POST /digest`     | Staff dashboard (`admin.html`) | Weekly digest, low-stock nudges, packing summaries, confirmation email drafts |
| `GET /health`      | You                          | Confirms provider/model and catalog size          |

Your API key lives only in Cloudflare — never in the site. The free Workers plan (100k requests/day) is more than enough.

## Deploy (about 5 minutes)

```bash
cd worker
npm install -g wrangler          # once
wrangler login                   # opens Cloudflare in your browser (free account is fine)
# choose your provider in wrangler.toml (AI_PROVIDER + AI_MODEL), then:
wrangler secret put AI_API_KEY   # paste your OpenAI or Anthropic key when prompted
wrangler deploy
```

Wrangler prints a URL like `https://ecosilk-ai.<your-subdomain>.workers.dev`.
Paste it into `assets/js/config.js` as `ASSISTANT_ENDPOINT` (no trailing slash), commit, push — done.

Check it: `curl https://ecosilk-ai.<your-subdomain>.workers.dev/health`

## Keeping the catalog in sync

The worker carries a compact copy of the catalog (`src/catalog.js`). Whenever `assets/js/catalog-data.js`
changes, regenerate and redeploy:

```bash
node ../build/make_worker_catalog.mjs && wrangler deploy
```

## Costs & limits
- Each chat turn is roughly 3–4k input tokens (the catalog is included) and ~200 output tokens.
  On gpt-4.1-mini that's well under a cent per conversation; Claude Sonnet is a few cents.
- `ALLOWED_ORIGINS` restricts which sites may call the worker. Add any new domain there.
- Rate limiting: for the trial, Cloudflare's free tier is enough. If the helper gets busy, add
  a Workers Rate Limiting binding or Turnstile.
