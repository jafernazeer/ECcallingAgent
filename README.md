# EthikCorpVoiceAgent

Live dashboard for the EthikCorp Agent.

## Features

- Home dashboard with voice-agent analytics.
- Conversation timeline with call transcript examples.
- Lead management table for customer details collected from calls.
- Email Updates tab for sending answered-call summaries and captured lead details to selected email addresses.
- Test Call console and floating phone widget connected to the EthikCorp Agent via the Vapi browser SDK.
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
VAPI_PRIVATE_API_KEY=your-vapi-private-api-key
VAPI_ASSISTANT_ID=da9e9bf5-29e1-4d97-bd4b-f1dc3a97fe76
VAPI_AGENT_NAME=EthikCorp Agent
VAPI_ORG_ID=7a20e8e2-726e-485e-8348-09fb9ef8e729
VAPI_VOICE_PROVIDER=cartesia
VAPI_VOICE_MODEL=sonic-3.5
VAPI_VOICE_ID=638efaaa-4d0c-442e-b701-3fae16aad012
VAPI_WEBHOOK_SECRET=your-vapi-webhook-secret
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=notifications@your-domain.com
SMTP_PASS=your-smtp-password-or-app-password
EMAIL_FROM="EthikCorp Agent <notifications@your-domain.com>"
```

The browser uses only the `VITE_` values for Realtime updates. The Express API uses `SUPABASE_SERVICE_ROLE_KEY` to store calls, transcripts, and leads securely on the server side.

## Vapi Latest Agent Update

The Diagnostics page includes a **Get Latest Vapi Update** button. To fetch the latest assistant settings and recent calls from Vapi, add the private server key:

```bash
VAPI_PRIVATE_API_KEY=your-vapi-private-api-key
VAPI_ASSISTANT_ID=da9e9bf5-29e1-4d97-bd4b-f1dc3a97fe76
```

The active browser-call assistant is:

```text
Name: EthikCorp Agent
Assistant ID: da9e9bf5-29e1-4d97-bd4b-f1dc3a97fe76
Org ID: 7a20e8e2-726e-485e-8348-09fb9ef8e729
Voice provider: cartesia
Voice model: sonic-3.5
Voice ID: 638efaaa-4d0c-442e-b701-3fae16aad012
```

Do not expose the private key in browser code or commit it to GitHub. It must stay in `.env.local` locally or the deployment provider's server environment variables.

## Vapi Server URL

After deploying the Node/Express backend, configure the EthikCorp Agent server URL in Vapi:

```text
https://your-domain.com/api/vapi/webhook
```

For the structured Vapi **Lead Capture Tool**, use this Server URL:

```text
https://your-domain.com/api/vapi/lead-tool
```

For local testing, Vapi cannot call `localhost` directly from the cloud. Use a public tunnel such as ngrok or Cloudflare Tunnel, then set the tool Server URL to:

```text
https://your-public-tunnel-url/api/vapi/lead-tool
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

## Email Updates

The Email Updates tab can generate a full lead digest or a selected answered-call summary from the live dashboard data. To send real emails from the deployed backend, add SMTP credentials:

```bash
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=notifications@your-domain.com
SMTP_PASS=your-smtp-password-or-app-password
EMAIL_FROM="EthikCorp Agent <notifications@your-domain.com>"
```

When those variables are missing, the tab still builds the message preview and stores recipient emails locally, but the server will not send external email messages.

For live delivery you need:

- A real sending mailbox or SMTP provider.
- SMTP host, port, username, and password or app password.
- A verified sender address in `EMAIL_FROM`.
- Domain email records configured for deliverability: SPF, DKIM, and ideally DMARC.
- Recipient addresses entered in the Email Updates tab.

## Build

```bash
npm run build
```

The call test uses a browser public key and assistant ID in `src/main.jsx`; Supabase credentials are required only when persistent live data is enabled.
