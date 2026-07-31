import path from "node:path";
import { fileURLToPath } from "node:url";
import "./load-env.js";
import express from "express";
import nodemailer from "nodemailer";
import { createServer as createViteServer } from "vite";
import {
  getPersistenceMode,
  listCallRecords,
  saveCallEvent,
  saveVapiLeadTool,
  saveVapiWebhook,
  updateWorkflowStatus,
} from "./call-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const port = Number(process.env.PORT || 5173);
const hmrPort = Number(process.env.HMR_PORT || port + 20000);
const vapiPrivateApiKey = process.env.VAPI_PRIVATE_API_KEY || "";
const vapiAssistantId = process.env.VAPI_ASSISTANT_ID || "da9e9bf5-29e1-4d97-bd4b-f1dc3a97fe76";
const vapiWebhookSecret = process.env.VAPI_WEBHOOK_SECRET || "";
const smtpHost = process.env.SMTP_HOST || "";
const smtpPort = Number(process.env.SMTP_PORT || 587);
const smtpSecure = String(process.env.SMTP_SECURE || "").toLowerCase() === "true";
const smtpUser = process.env.SMTP_USER || "";
const smtpPass = process.env.SMTP_PASS || "";
const emailFrom = process.env.EMAIL_FROM || smtpUser;

const app = express();
app.use(express.json());

function sendApiError(response, error) {
  console.error(error);
  response.status(500).json({
    ok: false,
    error: error?.message || "Unexpected server error",
  });
}

function isValidVapiWebhook(request) {
  if (!vapiWebhookSecret) return true;
  const bearerToken = request.get("authorization")?.replace(/^Bearer\s+/i, "");
  return request.get("x-vapi-secret") === vapiWebhookSecret || bearerToken === vapiWebhookSecret;
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

async function fetchVapiJson(pathname, query = {}) {
  if (!vapiPrivateApiKey) {
    return null;
  }

  const url = new URL(pathname, "https://api.vapi.ai");
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${vapiPrivateApiKey}`,
      "Content-Type": "application/json",
    },
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data?.message || data?.error || `Vapi request failed with ${response.status}`);
  }

  return data;
}

function summarizeVapiAssistant(assistant) {
  if (!assistant) return null;
  return {
    id: assistant.id,
    name: assistant.name,
    modelProvider: assistant.model?.provider || null,
    model: assistant.model?.model || null,
    voiceProvider: assistant.voice?.provider || null,
    firstMessage: assistant.firstMessage || "",
    serverUrl: assistant.serverUrl || assistant.server?.url || "",
    updatedAt: assistant.updatedAt || assistant.createdAt || null,
  };
}

function summarizeVapiCall(call) {
  if (!call) return null;
  return {
    id: call.id,
    type: call.type,
    status: call.status || call.endedReason || "unknown",
    startedAt: call.startedAt || call.createdAt || null,
    endedAt: call.endedAt || null,
    customerNumber: call.customer?.number || call.customerNumber || "",
    summary: call.summary || call.analysis?.summary || "",
    transcript: call.transcript || "",
    recordingUrl: call.recordingUrl || "",
    endedReason: call.endedReason || "",
    cost: call.cost ?? null,
  };
}

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    persistence: getPersistenceMode(),
  });
});

app.get("/api/vapi/latest", async (_request, response) => {
  try {
    if (!vapiPrivateApiKey) {
      response.json({
        ok: true,
        configured: false,
        assistantId: vapiAssistantId,
        message: "Add VAPI_PRIVATE_API_KEY on the server to fetch the latest Vapi agent and call data.",
      });
      return;
    }

    const [assistant, callsResponse] = await Promise.all([
      fetchVapiJson(`/assistant/${vapiAssistantId}`),
      fetchVapiJson("/v2/call", {
        assistantId: vapiAssistantId,
        limit: 5,
        sortOrder: "DESC",
      }),
    ]);
    const calls = Array.isArray(callsResponse?.data)
      ? callsResponse.data
      : Array.isArray(callsResponse)
        ? callsResponse
        : [];

    response.json({
      ok: true,
      configured: true,
      fetchedAt: new Date().toISOString(),
      assistant: summarizeVapiAssistant(assistant),
      latestCalls: calls.map(summarizeVapiCall).filter(Boolean),
    });
  } catch (error) {
    sendApiError(response, error);
  }
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

app.post("/api/vapi/webhook", async (request, response) => {
  try {
    if (!isValidVapiWebhook(request)) {
      response.status(401).json({ ok: false, error: "Unauthorized webhook request" });
      return;
    }

    response.json({
      ok: true,
      ...(await saveVapiWebhook(request.body)),
    });
  } catch (error) {
    sendApiError(response, error);
  }
});

app.post("/api/vapi/lead-tool", async (request, response) => {
  try {
    if (!isValidVapiWebhook(request)) {
      response.status(401).json({ ok: false, error: "Unauthorized webhook request" });
      return;
    }

    const result = await saveVapiLeadTool(request.body);
    response.json({
      ok: true,
      ...result,
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
    const normalizedRecipients = [...new Set(recipients.map(normalizeEmail).filter(Boolean))];

    if (!normalizedRecipients.length) {
      response.status(400).json({ ok: false, error: "At least one valid email recipient is required." });
      return;
    }

    if (!message) {
      response.status(400).json({ ok: false, error: "Email message cannot be empty." });
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

const vite = await createViteServer({
  root,
  server: { middlewareMode: true, host: "0.0.0.0", hmr: { port: hmrPort } },
  appType: "spa",
});

app.use(vite.middlewares);

app.listen(port, "0.0.0.0", () => {
  console.log(`EthikCorp Agent dashboard running at http://localhost:${port}/`);
});
