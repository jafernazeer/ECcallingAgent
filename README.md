# ECcallingAgent

Dedicated EthikCorp Agent test portal for client-facing browser calls.

This portal uses the Vapi browser SDK to call the configured EthikCorp Agent.

## What It Does

- Shows only the EthikCorp Agent test portal.
- Starts live browser calls with Vapi using the EthikCorp Agent assistant ID.
- Stores call events and transcript events through `/api/call-events`.
- Uses the same Supabase tables as the EthikCorp dashboard when persistence is configured.
- Mirrors events to the local dashboard at `http://localhost:5172/api/call-events` when running locally without Supabase.

## Local Setup

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:5173/
```

## Hostinger Deployment

Deploy this repo to:

```text
https://ethikcorp.aqionlabs.com
```

Use:

```bash
npm ci
npm run build
```

Build output:

```text
dist/
```

If Hostinger runs the Node server, use:

```bash
npm run dev
```

If Hostinger serves only static files, deploy the `dist/` folder. Backend data capture endpoints will need to run elsewhere.

## Environment Variables

For Vapi and live dashboard sync, configure these in Hostinger:

```bash
VITE_VAPI_PUBLIC_KEY=f80cea3b-d773-4f2c-88a8-8d7c87cd57ee
VITE_VAPI_ASSISTANT_ID=da9e9bf5-29e1-4d97-bd4b-f1dc3a97fe76
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
```

`VITE_DASHBOARD_EVENTS_URL` is optional. Use it only when the standalone portal must post browser events directly to a separate dashboard API. In production, shared Supabase persistence is preferred.

Do not commit `.env.local` or real server-side keys.

## Backend Endpoints

```text
GET  /api/health
GET  /api/call-records
POST /api/call-events
POST /api/vapi/lead-tool
```

## Vapi Lead Capture Tool

For the production assistant, set the `submit_lead` tool Server URL to the deployed dashboard backend whenever possible:

```text
https://your-dashboard-domain.com/api/vapi/lead-tool
```

This portal also exposes `/api/vapi/lead-tool`, but the dashboard endpoint is preferred because it writes directly to the Lead Management Portal.

## Supabase

Run `supabase/schema.sql` in the Supabase SQL editor. Use the same Supabase project and tables as the EthikCorp dashboard so calls from this portal appear in the dashboard automatically.

Required tables:

- `calls`
- `transcripts`
- `leads`

## Build Check

```bash
npm run build
```
