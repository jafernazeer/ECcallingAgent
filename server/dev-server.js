import path from "node:path";
import { fileURLToPath } from "node:url";
import https from "node:https";
import "./load-env.js";
import express from "express";
import { createServer as createViteServer } from "vite";
import {
  getPersistenceMode,
  listCallRecords,
  saveCallEvent,
} from "./call-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const port = Number(process.env.PORT || 5173);
const hmrPort = Number(process.env.HMR_PORT || port + 20000);
const vapiApiHost = process.env.VAPI_API_HOST || "api.vapi.ai";
const vapiApiAddress = process.env.VAPI_API_ADDRESS || "104.18.24.64";

const app = express();
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

function findSubmitLeadArguments(payload) {
  const toolCall = collectToolCalls(payload).find((item) => getToolName(item) === "submit_lead");
  return parseMaybeJson(getToolArguments(toolCall)) || payload?.arguments || payload?.parameters || payload;
}

function findSubmitLeadToolCall(payload) {
  return collectToolCalls(payload).find((item) => getToolName(item) === "submit_lead") || null;
}

function getVapiCallId(payload) {
  return payload?.sessionId
    || payload?.callId
    || payload?.call?.id
    || payload?.message?.call?.id
    || payload?.message?.callId
    || payload?.message?.call?.monitor?.callId
    || "";
}

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    persistence: getPersistenceMode(),
  });
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
    const sessionId = request.body?.sessionId || (vapiCallId ? `vapi-${vapiCallId}` : `vapi-lead-${Date.now()}`);
    const result = await saveCallEvent({
      type: "lead-captured",
      sessionId,
      externalCallId: vapiCallId || null,
      at: new Date().toISOString(),
      source: "Vapi submit_lead tool",
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

const vite = await createViteServer({
  root,
  server: { middlewareMode: true, host: "0.0.0.0", hmr: { port: hmrPort } },
  appType: "spa",
});

app.use(vite.middlewares);

app.listen(port, "0.0.0.0", () => {
  console.log(`EthikCorp Agent test portal running at http://localhost:${port}/`);
});
