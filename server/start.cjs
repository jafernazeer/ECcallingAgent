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

/** Newest mtime under a directory, or 0 when it does not exist. */
function newestMtime(dir) {
  let newest = 0;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      newest = Math.max(newest, newestMtime(full));
    } else {
      try {
        newest = Math.max(newest, fs.statSync(full).mtimeMs);
      } catch {
        // Unreadable file - ignore it rather than failing the boot.
      }
    }
  }
  return newest;
}

/**
 * Rebuild when dist/ is absent OR older than the sources it was built from.
 * A deploy that pulls into the existing directory leaves the previous dist/
 * in place, and without this check the server would keep serving a stale
 * bundle after every code change.
 */
function needsBuild() {
  if (!fs.existsSync(indexFile)) return "dist/ missing";
  const built = fs.statSync(indexFile).mtimeMs;
  const newestSource = Math.max(
    newestMtime(path.join(root, "src")),
    newestMtime(path.join(root, "public")),
    (() => {
      try { return fs.statSync(path.join(root, "index.html")).mtimeMs; } catch { return 0; }
    })(),
  );
  return newestSource > built ? "sources newer than dist/" : "";
}

const buildReason = needsBuild();
if (buildReason) {
  console.log(`[start] ${buildReason} - running build...`);
  try {
    execSync("npm run build", { cwd: root, stdio: "inherit" });
    console.log("[start] build complete.");
  } catch (error) {
    // Boot anyway: the API routes still work and the failure stays visible.
    console.error("[start] build failed:", error.message);
  }
} else {
  console.log("[start] dist/ up to date - skipping build.");
}

import("./dev-server.js").catch((error) => {
  console.error("[start] server failed to boot:", error);
  process.exit(1);
});
