# ECcallingAgent

Dedicated EthikCorp Agent test portal for client-facing browser calls.

This repo is intentionally limited to the public call-testing experience for `ethikcorp.aqionlabs.com`. It does not include dashboard analytics, lead tables, conversation review screens, email updates, or admin controls.

## What It Does

- Shows only the EthikCorp Agent test portal.
- Starts a live browser call through the Vapi browser SDK.
- Requests microphone access from the visitor.
- Sends browser call lifecycle events and transcripts to the backend.
- Supports Vapi Server URL webhooks.
- Supports the Vapi `submit_lead` tool endpoint.
- Stores calls, transcripts, and captured leads in the same Supabase tables used by the EthikCorp dashboard.

## Local Setup

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:5173/
```

The `/agent` path also works as an alias:

```text
http://localhost:5173/agent
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

If Hostinger serves only static files, deploy the `dist/` folder, but backend data capture endpoints will need to run somewhere else.

## Environment Variables

For full dashboard sync, configure these in Hostinger:

```bash
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
VAPI_WEBHOOK_SECRET=your-vapi-webhook-secret
```

The Vapi public key and assistant ID are configured in `src/main.jsx`:

```text
Public key: f80cea3b-d773-4f2c-88a8-8d7c87cd57ee
Assistant ID: da9e9bf5-29e1-4d97-bd4b-f1dc3a97fe76
Assistant name: EthikCorp Agent
Voice provider: cartesia
Voice model: sonic-3.5
Voice ID: 638efaaa-4d0c-442e-b701-3fae16aad012
```

Do not commit `.env.local` or real server-side keys.

## Vapi Endpoints

Set the Vapi assistant Server URL to:

```text
https://ethikcorp.aqionlabs.com/api/vapi/webhook
```

For the structured Vapi Lead Capture Tool, set the tool Server URL to:

```text
https://ethikcorp.aqionlabs.com/api/vapi/lead-tool
```

Use this Vapi custom tool schema:

```json
{
  "type": "function",
  "function": {
    "name": "submit_lead",
    "description": "Submit the captured lead details to the Lead Management Portal. Call this once the user has provided all their contact info (Name, Company, Location, Requirements, Phone, Email).",
    "parameters": {
      "type": "object",
      "properties": {
        "customer_name": { "type": "string" },
        "company_name": { "type": "string" },
        "location": { "type": "string" },
        "requirement_summary": { "type": "string", "description": "Brief summary of what the customer needs" },
        "contact_number": { "type": "string" },
        "email_id": { "type": "string" }
      },
      "required": ["customer_name", "company_name", "location", "contact_number", "email_id"]
    }
  }
}
```

If `VAPI_WEBHOOK_SECRET` is configured, send it from Vapi as either:

```text
Authorization: Bearer your-vapi-webhook-secret
```

or:

```text
x-vapi-secret: your-vapi-webhook-secret
```

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
