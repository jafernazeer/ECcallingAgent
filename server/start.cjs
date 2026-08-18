/**
 * CommonJS production entry point.
 *
 * Hostinger's LiteSpeed loader (lsnode.js) starts the app with require(), which
 * cannot load an ESM graph containing top-level await — and server/dev-server.js
 * has one. This wrapper stays CommonJS with no top-level await, builds the
 * client bundle if it is missing, then hands off via dynamic import(), which
 * *can* load async modules.
 */
const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const indexFile = path.join(root, "dist", "index.html");

if (!fs.existsSync(indexFile)) {
  console.log("[start] dist/ missing - running build...");
  try {
    execSync("npm run build", { cwd: root, stdio: "inherit" });
    console.log("[start] build complete.");
  } catch (error) {
    // Boot anyway: the API routes still work and the failure stays visible.
    console.error("[start] build failed:", error.message);
  }
} else {
  console.log("[start] dist/ present - skipping build.");
}

import("./dev-server.js").catch((error) => {
  console.error("[start] server failed to boot:", error);
  process.exit(1);
});
