# Setup (Phase 0)

Everything here is free and needs no card. About 20 minutes, all doable from an iPhone browser.
The order matters: the Oura app needs your Worker URL, and the secrets need the Worker to exist.

## 1. Cloudflare account and Worker (deploys from GitHub)

1. Sign up at https://dash.cloudflare.com/sign-up (Free plan; no card is asked for Workers).
2. Dashboard → **Workers & Pages** → **Create** → **Import a repository** → connect GitHub and choose
   `theweekndat/fitness-tracker`.
3. Settings on the import screen:
   - Project / Worker name: **`hub`** (must match `name` in `wrangler.jsonc`).
   - Production branch: `main` (merge this work into `main` first; or pick the
     `claude/vigilant-pascal-7zqbyu` branch just for Phase 0).
   - Build command: `npm run build`
   - Deploy command: `npx wrangler deploy` (the default).
4. Deploy. Wrangler creates the KV namespace on the first deploy automatically.
5. Note your URL: `https://hub.<your-subdomain>.workers.dev`.

If the deploy log says the KV binding needs an id: Workers & Pages → KV → Create namespace (`hub-kv`),
copy its id into `wrangler.jsonc` as `"kv_namespaces": [{ "binding": "KV", "id": "<id>" }]`, push again.

## 2. App token

Open your Worker URL on the iPhone, tap **Generate token**, then **Copy**.
Cloudflare → your `hub` Worker → **Settings → Variables and Secrets → Add** → type **Secret**,
name `APP_TOKEN`, paste. Keep the token: you paste it into the app once.

## 3. Hevy key

https://hevy.com/settings?developer → generate an API key (needs Hevy Pro).
Add Worker secret `HEVY_API_KEY`.

## 4. Oura OAuth app

1. https://cloud.ouraring.com/oauth/applications → create a new application (free).
2. Redirect URI: `https://hub.<your-subdomain>.workers.dev/api/oura/callback` (exact match).
3. Read the API agreement while you are there, especially anything about AI use and fees.
4. Add Worker secrets `OURA_CLIENT_ID` and `OURA_CLIENT_SECRET`.

## 5. Install on the iPhone

Safari → your Worker URL → Share → **Add to Home Screen**. Open it from the Home Screen icon,
tap **Open the Phase 0 checks**, and work through sections 1 to 6. Section 6 exports
`phase0-report.md`; send it back (paste it in chat or upload it) and I turn it into
`docs/PHASE0_FINDINGS.md`.

Do the force-quit test properly: write the marker, swipe the app away in the app switcher,
reopen from the icon, and check the launch count went up with the marker intact.

## Local development (optional, needs a computer)

```
npm install
cp .dev.vars.example .dev.vars   # fill in values
npm run build && npx wrangler dev   # Worker + built app on :8787
npm test
```
