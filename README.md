# EthikCorpVoiceAgent

Live dashboard for the EthikCorp EC Calling Agent.

## Features

- Home dashboard with voice-agent analytics.
- Conversation timeline with call transcript examples.
- Lead management table for customer details collected from calls.
- Email Updates tab for sending answered-call summaries and captured lead details to selected email addresses.
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
VAPI_PRIVATE_API_KEY=your-vapi-private-api-key
VAPI_ASSISTANT_ID=429bb390-be3c-4b1e-bc3a-2a717917725c
VAPI_WEBHOOK_SECRET=your-vapi-webhook-secret
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=notifications@your-domain.com
SMTP_PASS=your-smtp-password-or-app-password
EMAIL_FROM="EthikCorp EC Calling Agent <notifications@your-domain.com>"
```

The browser uses only the `VITE_` values for Realtime updates. The Express API uses `SUPABASE_SERVICE_ROLE_KEY` to store calls, transcripts, and leads securely on the server side.

## Vapi Latest Agent Update

The Diagnostics page includes a **Get Latest Vapi Update** button. To fetch the latest assistant settings and recent calls from Vapi, add the private server key:

```bash
VAPI_PRIVATE_API_KEY=your-vapi-private-api-key
VAPI_ASSISTANT_ID=429bb390-be3c-4b1e-bc3a-2a717917725c
```

Do not expose the private key in browser code or commit it to GitHub. It must stay in `.env.local` locally or the deployment provider's server environment variables.

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

## Email Updates

The Email Updates tab can generate a full lead digest or a selected answered-call summary from the live dashboard data. To send real emails from the deployed backend, add SMTP credentials:

```bash
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=notifications@your-domain.com
SMTP_PASS=your-smtp-password-or-app-password
EMAIL_FROM="EthikCorp EC Calling Agent <notifications@your-domain.com>"
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
