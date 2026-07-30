# EthikCorpVoiceAgent

Live dashboard for the EthikCorp EC Calling Agent.

## Features

- Home dashboard with voice-agent analytics.
- Conversation timeline with call transcript examples.
- Lead management table for customer details collected from calls.
- Test Call console and floating phone widget connected to the EC Calling Agent via the Vapi browser SDK.
- Optional Supabase persistence for live calls, transcripts, analytics, and captured leads.

## Local Setup

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

## Supabase Live Data Setup

1. Create a Supabase project.
2. Run the SQL in `supabase/schema.sql` from the Supabase SQL editor.
3. Copy `.env.example` to `.env.local`.
4. Add:

```bash
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
VAPI_WEBHOOK_SECRET=your-vapi-webhook-secret
```

The browser uses only the `VITE_` values for Realtime updates. The Express API uses `SUPABASE_SERVICE_ROLE_KEY` to store calls, transcripts, and leads securely on the server side.

## Vapi Server URL

After deploying the Node/Express backend, configure the EC Calling Agent server URL in Vapi:

```text
https://your-domain.com/api/vapi/webhook
```

The local phone widget also posts browser call events to:

```text
/api/call-events
```

If `VAPI_WEBHOOK_SECRET` is configured, send it from Vapi as either:

```text
Authorization: Bearer your-vapi-webhook-secret
```

or:

```text
x-vapi-secret: your-vapi-webhook-secret
```

If Supabase variables are not configured, the dashboard keeps using browser localStorage as a fallback.

## Build

```bash
npm run build
```

The call test uses a browser public key and assistant ID in `src/main.jsx`; Supabase credentials are required only when persistent live data is enabled.
