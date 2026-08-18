import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Production entry point for hosts that only accept a Node entry file and
 * never run a separate build step (e.g. Hostinger's Express preset).
 *
 * Builds the client bundle if it is missing, then hands off to the server.
 * Once dist/ exists the build is skipped, so restarts stay fast.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const indexFile = path.join(root, "dist", "index.html");

if (!fs.existsSync(indexFile)) {
  console.log("[start] dist/ missing — running build…");
  try {
    execSync("npm run build", { cwd: root, stdio: "inherit" });
    console.log("[start] build complete.");
  } catch (error) {
    console.error("[start] build failed:", error.message);
    // Boot anyway: the API routes still work, and the failure is visible in
    // the logs rather than the process dying silently.
  }
} else {
  console.log("[start] dist/ present — skipping build.");
}

await import("./dev-server.js");
