# EthikcorpECDashboard

Live dashboard shell for the EthikCorp calling agent.

This dashboard uses the Vapi browser SDK for diagnostics/test calls and receives call events from the standalone EthikCorp Agent portal.

## Features

- Dashboard analytics layout.
- Conversation timeline.
- Lead management table.
- Email update workflow.
- Diagnostics page with Vapi-powered live call controls.
- Supabase persistence for generic calls, transcripts, analytics, and captured leads when configured.
- Local fallback event storage for portal-to-dashboard testing without Supabase.

## Local Setup

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:5173
```

## Supabase Live Data Setup

1. Create a Supabase project.
2. Run the SQL in `supabase/schema.sql` from the Supabase SQL editor.
3. Copy `.env.example` to `.env.local`.
4. Add:

```bash
VITE_VAPI_PUBLIC_KEY=f80cea3b-d773-4f2c-88a8-8d7c87cd57ee
VITE_VAPI_ASSISTANT_ID=da9e9bf5-29e1-4d97-bd4b-f1dc3a97fe76
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
```

The browser uses only the `VITE_` values for Vapi calls and Realtime updates. The Express API uses `SUPABASE_SERVICE_ROLE_KEY` to store calls, transcripts, and leads securely on the server side.

## Backend Endpoints

The portal and dashboard use these endpoints for live records:

```text
GET  /api/health
GET  /api/call-records
POST /api/call-events
POST /api/vapi/lead-tool
PATCH /api/calls/:id/status
POST /api/email-updates
```

## Vapi Lead Capture Tool

Set the `submit_lead` tool Server URL to the deployed dashboard endpoint:

```text
https://your-dashboard-domain.com/api/vapi/lead-tool
```

The endpoint accepts the Vapi tool payload and stores:

- `customer_name` as lead name
- `company_name` inside the call lead details
- `location` as lead location
- `contact_number` as phone
- `email_id` as email
- `requirement_summary` as requirement and call summary

## Email Updates

To send real emails from the deployed backend, add SMTP credentials:

```bash
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=notifications@your-domain.com
SMTP_PASS=your-smtp-password-or-app-password
EMAIL_FROM="EthikCorp Agent <notifications@your-domain.com>"
```

When those variables are missing, the dashboard still builds the message preview and stores recipient emails locally, but the server will not send external email messages.

## Build

```bash
npm run build
```
