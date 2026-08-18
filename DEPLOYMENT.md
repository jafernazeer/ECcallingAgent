# EthikCorp Agent Portal — Hostinger Deployment

The portal is **not** a static site. It is an Express server (`server/dev-server.js`)
that serves the built frontend *and* the `/api/*` routes. Deploying only the Vite
`dist/` output is what causes `503 Service Unavailable` on every `/api/*` call.

## 1. Hostinger plan requirement

You need a plan with **Node.js application support** (Business / Cloud hosting or a
VPS). Static/shared hosting cannot run Express, so `/api/health`, `/api/retell/web-call`,
and `/api/vapi/lead-tool` will all 503 there no matter what is uploaded.

## 2. Create the Node.js application

hPanel → **Websites → (your site) → Advanced → Node.js**

| Field | Value |
|---|---|
| Node version | 20.x |
| Application root | `/home/<user>/domains/ethikcorp.aqionlabs.com/public_html` |
| Application URL | `ethikcorp.aqionlabs.com` |
| Application startup file | `server/dev-server.js` |

Leave the port to Hostinger — it injects `PORT` and the server already reads
`process.env.PORT`.

## 3. Deploy from GitHub

hPanel → **Websites → (your site) → Advanced → GIT**

1. **Repository**: `https://github.com/jafernazeer/ECcallingAgent.git`
2. **Branch**: `main`
3. **Install path**: the same application root as above
4. Click **Create**, then **Deploy** for the first pull.

### Auto-deploy on push (optional)

After creating the repo entry, Hostinger shows a **Webhook URL**. Add it in GitHub:

GitHub repo → Settings → Webhooks → Add webhook
- Payload URL: the Hostinger webhook URL
- Content type: `application/json`
- Event: *Just the push event*

Every push to `main` then triggers a pull. Note it only **pulls** — it does not run
`npm install` or `npm run build`. See step 5.

## 4. Environment variables

hPanel → Node.js app → **Environment variables**. Add each as a key/value pair.
Do **not** upload a `.env` file — it is gitignored and will not arrive via Git.

```
NODE_ENV=production
RETELL_API_KEY=<retell secret key>
RETELL_AGENT_ID=agent_32ed880947c418370d19839958
SUPABASE_URL=https://xhzukynariylbojypjww.supabase.co
SUPABASE_SECRET_KEY=<supabase service role / secret key>
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=<smtp user>
SMTP_PASS=<smtp app password>
EMAIL_FROM=EthikCorp Agent <notifications@ethikcorp.aqionlabs.com>
CORS_ORIGIN=https://ethikcorp.aqionlabs.com
```

**Never** prefix a secret with `VITE_`. Vite inlines every `VITE_*` value into the
browser bundle, which would publish it to anyone who opens devtools. Only the
Retell *public* key is safe client-side.

## 5. Build and start

Hostinger's Git integration pulls source only. After each deploy, from the Node.js
app panel (or SSH in the application root):

```bash
npm ci --omit=dev
npm run build      # produces dist/, served by the Express app
```

Then **Restart** the application from the Node.js panel.

To make this repeatable, the repo's `package.json` can expose:

```bash
npm run deploy     # npm ci --omit=dev && npm run build
```

## 6. Verify — do not skip

```bash
curl -i https://ethikcorp.aqionlabs.com/api/health
```

Expected: `HTTP/1.1 200` and a JSON body `{"ok":true,...}`.

If you get a `503` **HTML** page, that is Hostinger's error page, meaning the Node
process is not running — recheck the startup file and the app status. If you get
the site's HTML instead of JSON, static hosting is still serving the domain and
the Node app is not bound to it.

Then verify the Retell token endpoint:

```bash
curl -i -X POST https://ethikcorp.aqionlabs.com/api/retell/web-call
```

- `200` with `accessToken` → working.
- `503` with `"Retell is not configured"` → env vars missing.
- `502` → Retell rejected the request; check the key and agent id.

Finally, re-run the Retell webhook test for
`https://ethikcorp.aqionlabs.com/api/vapi/lead-tool`. It should return `200`.

## 7. Common failure modes

| Symptom | Cause |
|---|---|
| All `/api/*` return 503 HTML | Node app not running; static hosting serving the domain |
| `/api/health` 200 but tools still fail | Env vars missing — check `RETELL_API_KEY` |
| Four separate lead records per call | `call_id` not correlating — verify the webhook payload includes `call.call_id` |
| Frontend loads but calls fail instantly | `dist/` stale — re-run `npm run build` and restart |
