import path from "node:path";
import { fileURLToPath } from "node:url";
import "./load-env.js";
import express from "express";
import { createServer as createViteServer } from "vite";
import {
  getPersistenceMode,
  listCallRecords,
  saveCallEvent,
  saveVapiLeadTool,
  saveVapiWebhook,
} from "./call-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const port = Number(process.env.PORT || 5173);
const hmrPort = Number(process.env.HMR_PORT || port + 20000);
const vapiWebhookSecret = process.env.VAPI_WEBHOOK_SECRET || "";

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

    response.json({
      ok: true,
      ...(await saveVapiLeadTool(request.body)),
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
  console.log(`EthikCorp Agent test portal running at http://localhost:${port}/`);
});
