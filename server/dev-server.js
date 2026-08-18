import path from "node:path";
import { fileURLToPath } from "node:url";
import https from "node:https";
import "./load-env.js";
import express from "express";
import nodemailer from "nodemailer";
import { createServer as createViteServer } from "vite";
import {
  getPersistenceMode,
  listCallRecords,
  saveCallEvent,
  updateWorkflowStatus,
} from "./call-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const isProduction = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT || 5173);
const hmrPort = Number(process.env.HMR_PORT || port + 20000);
const smtpHost = process.env.SMTP_HOST || "";
const smtpPort = Number(process.env.SMTP_PORT || 587);
const smtpSecure = String(process.env.SMTP_SECURE || "").toLowerCase() === "true";
const smtpUser = process.env.SMTP_USER || "";
const smtpPass = process.env.SMTP_PASS || "";
const emailFrom = process.env.EMAIL_FROM || smtpUser;
const vapiApiHost = process.env.VAPI_API_HOST || "api.vapi.ai";
const vapiApiAddress = process.env.VAPI_API_ADDRESS || "104.18.24.64";
const vapiPublicKey = process.env.VITE_VAPI_PUBLIC_KEY || "f80cea3b-d773-4f2c-88a8-8d7c87cd57ee";
const vapiAssistantId = process.env.VITE_VAPI_ASSISTANT_ID || "da9e9bf5-29e1-4d97-bd4b-f1dc3a97fe76";
const vapiAssistantName = process.env.VITE_VAPI_ASSISTANT_NAME || "EC Calling Agent";
const vapiClientApiBaseUrl = process.env.VITE_VAPI_API_BASE_URL || "/api/vapi";
// Retell — secret key is server-only and must never be exposed to the browser.
const retellApiKey = process.env.RETELL_API_KEY || "";
const retellAgentId = process.env.RETELL_AGENT_ID || "";
const retellApiBase = process.env.RETELL_API_BASE || "https://api.retellai.com";
const deliveredEmailIds = new Set();

const submitLeadToolSchema = {
  type: "function",
  function: {
    name: "submit_lead",
    description: "Submit any captured lead details to the EthikCorp Lead Management Portal. Call this once the caller has provided any contact or requirement information: Name, Company, Location, Requirements, Phone, or Email.",
    parameters: {
      type: "object",
      properties: {
        customer_name: { type: "string", description: "Caller name, if provided." },
        company_name: { type: "string", description: "Caller company or organization, if provided." },
        location: { type: "string", description: "Caller city, emirate, country, or place, if provided." },
        requirement_summary: { type: "string", description: "Brief summary of what the customer needs." },
        contact_number: { type: "string", description: "Caller phone number, if provided or available from the call." },
        email_id: { type: "string", description: "Caller email address, if provided." },
      },
      anyOf: [
        { required: ["customer_name"] },
        { required: ["company_name"] },
        { required: ["location"] },
        { required: ["requirement_summary"] },
        { required: ["contact_number"] },
        { required: ["email_id"] },
      ],
      additionalProperties: false,
    },
  },
};

const app = express();
app.use((request, response, next) => {
  response.setHeader("Access-Control-Allow-Origin", process.env.CORS_ORIGIN || "*");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
  if (request.method === "OPTIONS") {
    response.sendStatus(204);
    return;
  }
  next();
});
app.use(express.json());

function proxyVapiApi(request, response) {
  const upstreamPath = request.originalUrl.replace(/^\/api\/vapi/, "") || "/";
  const payload = request.body && Object.keys(request.body).length ? JSON.stringify(request.body) : "";
  const headers = {
    ...request.headers,
    host: vapiApiHost,
  };
  delete headers.connection;
  delete headers["content-length"];

  const upstreamRequest = https.request({
    hostname: vapiApiAddress,
    servername: vapiApiHost,
    port: 443,
    path: upstreamPath,
    method: request.method,
    headers: {
      ...headers,
      ...(payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {}),
    },
  }, (upstreamResponse) => {
    response.status(upstreamResponse.statusCode || 502);
    Object.entries(upstreamResponse.headers).forEach(([key, value]) => {
      if (key.toLowerCase() !== "transfer-encoding" && value !== undefined) response.setHeader(key, value);
    });
    upstreamResponse.pipe(response);
  });

  upstreamRequest.on("error", (error) => {
    response.status(502).json({ ok: false, error: error.message || "Vapi API proxy failed." });
  });

  if (payload) upstreamRequest.write(payload);
  upstreamRequest.end();
}

function sendApiError(response, error) {
  console.error(error);
  response.status(500).json({
    ok: false,
    error: error?.message || "Unexpected server error",
  });
}

function parseMaybeJson(value) {
  if (!value || typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function getToolName(toolCall) {
  return toolCall?.function?.name
    || toolCall?.functionCall?.name
    || toolCall?.function_call?.name
    || toolCall?.tool?.function?.name
    || toolCall?.name
    || "";
}

function getToolArguments(toolCall) {
  return toolCall?.function?.arguments
    || toolCall?.functionCall?.parameters
    || toolCall?.function_call?.arguments
    || toolCall?.parameters
    || toolCall?.arguments
    || toolCall?.input
    || null;
}

function collectToolCalls(value, depth = 0) {
  if (!value || depth > 4) return [];
  if (Array.isArray(value)) return value.flatMap((item) => collectToolCalls(item, depth + 1));
  if (typeof value !== "object") return [];

  const directCalls = [
    value.toolCall,
    value.functionCall,
    value.function_call,
    ...(Array.isArray(value.toolCalls) ? value.toolCalls : []),
    ...(Array.isArray(value.tool_calls) ? value.tool_calls : []),
    ...(Array.isArray(value.toolCallList) ? value.toolCallList : []),
  ].filter(Boolean);

  return [
    value,
    ...directCalls,
    ...collectToolCalls(value.message, depth + 1),
    ...collectToolCalls(value.artifact, depth + 1),
  ];
}

const LEAD_TOOL_NAMES = new Set([
  "capture_identity",
  "capture_requirement",
  "capture_contact",
  "submit_lead",
]);

function findSubmitLeadArguments(payload) {
  const toolCall = collectToolCalls(payload).find((item) => LEAD_TOOL_NAMES.has(getToolName(item)));
  return parseMaybeJson(getToolArguments(toolCall)) || payload?.arguments || payload?.parameters || payload;
}

function findSubmitLeadToolCall(payload) {
  return collectToolCalls(payload).find((item) => LEAD_TOOL_NAMES.has(getToolName(item))) || null;
}

function getVapiCallId(payload) {
  return payload?.sessionId
    // Retell uses snake_case call_id; Vapi uses call.id / callId.
    || payload?.call_id
    || payload?.call?.call_id
    || payload?.message?.call?.call_id
    || payload?.callId
    || payload?.call?.id
    || payload?.call?.callId
    || payload?.message?.call?.id
    || payload?.message?.callId
    || payload?.message?.call?.monitor?.callId
    || payload?.message?.call?.callId
    || payload?.artifact?.call?.id
    || "";
}

function getBrowserSessionId(payload) {
  return payload?.browserSessionId
    || payload?.metadata?.browserSessionId
    || payload?.call?.metadata?.browserSessionId
    || payload?.message?.metadata?.browserSessionId
    || payload?.message?.call?.metadata?.browserSessionId
    || payload?.artifact?.call?.metadata?.browserSessionId
    || "";
}

function normalizeEmail(value) {
  const trimmed = String(value || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? trimmed : "";
}

async function sendEmailSummary(recipients, subject, text) {
  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpSecure,
    auth: smtpUser && smtpPass ? {
      user: smtpUser,
      pass: smtpPass,
    } : undefined,
  });

  return transporter.sendMail({
    from: emailFrom,
    to: recipients,
    subject,
    text,
  });
}

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    persistence: getPersistenceMode(),
  });
});

app.get("/api/vapi/client-config", (_request, response) => {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.json({
    ok: true,
    publicKey: vapiPublicKey,
    assistantId: vapiAssistantId,
    assistantName: vapiAssistantName,
    apiBaseUrl: vapiClientApiBaseUrl,
  });
});

app.get("/api/vapi/lead-tool/schema", (_request, response) => {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.json(submitLeadToolSchema);
});

app.get("/api/call-records", async (_request, response) => {
  try {
    response.json({
      ok: true,
      ...(await listCallRecords()),
    });
  } catch (error) {
    sendApiError(response, error);
  }
});

app.post("/api/call-events", async (request, response) => {
  try {
    response.json({
      ok: true,
      ...(await saveCallEvent(request.body)),
    });
  } catch (error) {
    sendApiError(response, error);
  }
});

app.post("/api/vapi/lead-tool", async (request, response) => {
  try {
    const toolCall = findSubmitLeadToolCall(request.body);
    const args = findSubmitLeadArguments(request.body);
    const vapiCallId = getVapiCallId(request.body);
    const browserSessionId = getBrowserSessionId(request.body);
    const sessionId = browserSessionId || request.body?.sessionId || (vapiCallId ? `vapi-${vapiCallId}` : `vapi-lead-${Date.now()}`);
    const result = await saveCallEvent({
      type: "lead-captured",
      sessionId,
      externalCallId: vapiCallId || null,
      at: new Date().toISOString(),
      source: `Vapi ${getToolName(toolCall) || "submit_lead"} tool`,
      lead: args,
    }, request.body);

    response.json({
      ok: true,
      ...result,
      results: [{
        toolCallId: toolCall?.id || toolCall?.toolCallId || "submit_lead",
        result: "Lead submitted to the EthikCorp Lead Management Portal.",
      }],
      result: "Lead submitted to the EthikCorp Lead Management Portal.",
    });
  } catch (error) {
    sendApiError(response, error);
  }
});

app.use("/api/vapi", proxyVapiApi);

/**
 * Mint a Retell web-call access token. The browser calls this instead of ever
 * holding the Retell secret key.
 */
app.post("/api/retell/web-call", async (request, response) => {
  try {
    if (!retellApiKey || !retellAgentId) {
      response.status(503).json({
        ok: false,
        error: "Retell is not configured on this server. Set RETELL_API_KEY and RETELL_AGENT_ID.",
      });
      return;
    }

    const upstream = await fetch(`${retellApiBase}/v2/create-web-call`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${retellApiKey}`,
      },
      body: JSON.stringify({
        agent_id: retellAgentId,
        metadata: {
          source: "Client agent test portal",
          browserSessionId: String(request.body?.browserSessionId || ""),
        },
      }),
    });

    const result = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      response.status(502).json({
        ok: false,
        error: result?.message || `Retell rejected the web call request (${upstream.status}).`,
      });
      return;
    }

    response.json({
      ok: true,
      accessToken: result.access_token,
      callId: result.call_id,
      agentId: retellAgentId,
    });
  } catch (error) {
    sendApiError(response, error);
  }
});

app.post("/api/email-updates", async (request, response) => {
  try {
    const recipients = Array.isArray(request.body?.recipients) ? request.body.recipients : [];
    const subject = String(request.body?.subject || "EthikCorp Agent call summary").trim();
    const message = String(request.body?.message || "").trim();
    const deliveryId = String(request.body?.deliveryId || "").trim();
    const normalizedRecipients = [...new Set(recipients.map(normalizeEmail).filter(Boolean))];

    if (!normalizedRecipients.length) {
      response.status(400).json({ ok: false, error: "At least one valid email recipient is required." });
      return;
    }

    if (!message) {
      response.status(400).json({ ok: false, error: "Email message cannot be empty." });
      return;
    }

    if (deliveryId && deliveredEmailIds.has(deliveryId)) {
      response.json({
        ok: true,
        configured: Boolean(smtpHost && emailFrom),
        sent: 0,
        duplicate: true,
        recipients: normalizedRecipients,
      });
      return;
    }

    if (!smtpHost || !emailFrom) {
      response.json({
        ok: true,
        configured: false,
        sent: 0,
        recipients: normalizedRecipients,
      });
      return;
    }

    const result = await sendEmailSummary(normalizedRecipients, subject, message);
    if (deliveryId) {
      if (deliveredEmailIds.size > 1000) deliveredEmailIds.clear();
      deliveredEmailIds.add(deliveryId);
    }
    response.json({
      ok: true,
      configured: true,
      sent: normalizedRecipients.length,
      recipients: normalizedRecipients,
      messageId: result.messageId || "",
    });
  } catch (error) {
    sendApiError(response, error);
  }
});

app.patch("/api/calls/:id/status", async (request, response) => {
  try {
    response.json({
      ok: true,
      ...(await updateWorkflowStatus(request.params.id, request.body?.workflowStatus)),
    });
  } catch (error) {
    sendApiError(response, error);
  }
});

if (isProduction) {
  const distPath = path.join(root, "dist");
  app.use(express.static(distPath));
  app.get(/.*/, (_request, response) => {
    response.sendFile(path.join(distPath, "index.html"));
  });
} else {
  const vite = await createViteServer({
    root,
    server: { middlewareMode: true, host: "0.0.0.0", hmr: { port: hmrPort } },
    appType: "spa",
  });

  app.use(vite.middlewares);
}

app.listen(port, "0.0.0.0", () => {
  console.log(`EthikCorp Agent test portal running at http://localhost:${port}/`);
});
