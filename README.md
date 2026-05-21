# Adaptive Hypertrophy Coach — Backend Proxy

This repo holds the backend proxy for `adaptive_hypertrophy_app_v2.html`. The app calls
`POST /generate-workout` on this proxy; the proxy holds the Anthropic API key and forwards
requests to Claude, returning a fully-formed weekly workout JSON.

Two equivalent backend options are provided. Use whichever fits your hosting preference:

| Option | Folder | Host |
|--------|--------|------|
| Cloudflare Worker | `worker/` | Cloudflare (free tier works) |
| Node + Express | `server/` | Any VPS / cloud VM / local machine |

---

## Prerequisites

- **Node.js 18+** and **npm** (both options)
- **Wrangler CLI** (Worker option only): `npm install -g wrangler` then `wrangler login`

---

## Option A — Cloudflare Worker

### 1. Install dependencies

```bash
cd worker
npm install
```

### 2. Set the Anthropic API key as a secret

```bash
npx wrangler secret put ANTHROPIC_API_KEY
# paste your key when prompted — it is stored encrypted, never in any file
```

### 3. (Optional) Configure CORS origin

Edit `wrangler.toml` and uncomment / set:

```toml
ALLOWED_ORIGIN = "https://your-html-host.example.com"
```

Leave it out (or keep `*`) for local dev — the worker will accept any origin.

### 4. Local development

Wrangler reads secrets from `.dev.vars` during local dev (this file is git-ignored):

```bash
cp .dev.vars.example .dev.vars
# edit .dev.vars and fill in your real ANTHROPIC_API_KEY
```

Then start the worker:

```bash
npm run dev
# Worker listens at http://localhost:8787
```

Test it:

```bash
curl -X POST http://localhost:8787/generate-workout \
  -H "Content-Type: application/json" \
  -d '{
    "weekNumber": 1,
    "settings": {"focusArea":"","maxDuration":45,"equipmentPref":"full","intensityTechnique":"standard"},
    "exerciseDatabase": {},
    "recentLogs": [],
    "exerciseProgress": {}
  }'
```

You should get back a JSON `Workout` object with 4 days.

### 5. Deploy

```bash
npm run deploy
```

Wrangler will print the deployed URL, e.g.:
```
https://hypertrophy-coach-proxy.<your-subdomain>.workers.dev
```

Copy that URL — you'll paste it into the HTML next.

---

## Option B — Node + Express server

### 1. Install dependencies

```bash
cd server
npm install
```

### 2. Set the Anthropic API key

```bash
cp .env.example .env
# edit .env and fill in ANTHROPIC_API_KEY=sk-ant-...
```

`.env` is in `.gitignore` — it will never be committed.

### 3. Local development

```bash
npm run dev
# Server listens at http://localhost:3001
```

Test it (same curl as above but port 3001):

```bash
curl -X POST http://localhost:3001/generate-workout \
  -H "Content-Type: application/json" \
  -d '{"weekNumber":1,"settings":{"focusArea":"","maxDuration":45,"equipmentPref":"full","intensityTechnique":"standard"},"exerciseDatabase":{},"recentLogs":[],"exerciseProgress":{}}'
```

### 4. Deploy (example: a Linux VPS)

```bash
# copy the server/ folder to your server, install deps, then:
npm start
# use pm2 / systemd to keep it alive in production
```

---

## Pointing the HTML at your proxy

Open `adaptive_hypertrophy_app_v2.html` and find this line near the top of the `<script>`:

```js
// TODO: set this to your deployed Worker URL
const WORKOUT_API_URL = "";
```

Replace the empty string with your deployed URL:

```js
const WORKOUT_API_URL = "https://hypertrophy-coach-proxy.<your-subdomain>.workers.dev/generate-workout";
// or for the Node server:
const WORKOUT_API_URL = "https://your-server.example.com:3001/generate-workout";
```

Save the file and open it in your browser. Click **New → Generate New Workout** — the request
goes to the proxy, which calls Claude and returns a real AI-designed weekly plan.

---

## Rate limiting (TODO)

The Worker has a placeholder comment for per-IP rate limiting via Workers KV or Durable Objects.
To add it:

1. Create a KV namespace: `npx wrangler kv namespace create RATE_LIMIT_KV`
2. Uncomment the `[[kv_namespaces]]` block in `wrangler.toml` and fill in the ID.
3. Implement a simple counter in `worker/src/index.ts` using `env.RATE_LIMIT_KV.get/put`.

---

## Security notes

- The Anthropic API key lives **only** in the Worker secret or server `.env`. It is never
  returned to the client, never logged, and never included in any response body.
- The HTML contains `WORKOUT_API_URL` (your proxy URL) — this is not a secret.
- `grep -i "sk-ant\|ANTHROPIC_API_KEY\|x-api-key" adaptive_hypertrophy_app_v2.html`
  should return nothing.
