#!/usr/bin/env node

/**
 * Claude Code hook handler.
 * Receives hook event JSON on stdin and forwards it to the Agent Dashboard API.
 * Designed to fail silently so it never blocks Claude Code.
 *
 * API key resolution (first match wins):
 *   1. CLAUDE_DASHBOARD_API_KEY env var
 *   2. ~/.claude-internal/claude-dashboard.json → hook_api_key field
 *
 * Environment variables:
 *   CLAUDE_DASHBOARD_URL      Full URL of the dashboard server (default: http://127.0.0.1:4820)
 *   CLAUDE_DASHBOARD_PORT     Port override when using default localhost URL (default: 4820)
 *   CLAUDE_DASHBOARD_API_KEY  API key sent as X-API-Key header (optional)
 *   CLAUDE_DASHBOARD_TIMEOUT  Request timeout in ms (default: 5000)
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const hookType = process.argv[2] || "unknown";

/**
 * Read ~/.claude-internal/claude-dashboard.json for remote config.
 * Supports: dashboard_url, hook_api_key
 */
function readDashboardSettings() {
  try {
    const settingsPath = path.join(os.homedir(), ".claude-internal", "claude-dashboard.json");
    return JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  } catch { return {}; }
}

// Resolve API key: env var > settings file
function resolveApiKey() {
  if (process.env.CLAUDE_DASHBOARD_API_KEY) return process.env.CLAUDE_DASHBOARD_API_KEY;
  const settings = readDashboardSettings();
  if (settings.hook_api_key) return settings.hook_api_key;
  return null;
}

const apiKey = resolveApiKey();

// Resolve target URL — env var > settings file > legacy port-only config
const dashboardSettings = readDashboardSettings();
const rawUrl = process.env.CLAUDE_DASHBOARD_URL
  || dashboardSettings.dashboard_url
  || `http://127.0.0.1:${process.env.CLAUDE_DASHBOARD_PORT || "4820"}`;

let parsedUrl;
try {
  parsedUrl = new URL(rawUrl);
} catch {
  parsedUrl = new URL("http://127.0.0.1:4820");
}

const useHttps = parsedUrl.protocol === "https:";
const transport = useHttps ? require("https") : require("http");
const hostname = parsedUrl.hostname;
const port = parsedUrl.port
  ? parseInt(parsedUrl.port, 10)
  : (useHttps ? 443 : 80);
const basePath = parsedUrl.pathname.replace(/\/$/, "");
const timeout = parseInt(process.env.CLAUDE_DASHBOARD_TIMEOUT || "5000", 10);

// Read all stdin, then process
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  let parsedData;
  try {
    parsedData = JSON.parse(input);
  } catch {
    parsedData = { raw: input };
  }

  const payload = JSON.stringify({
    hook_type: hookType,
    data: parsedData,
  });

  const headers = {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  };
  if (apiKey) {
    headers["X-API-Key"] = apiKey;
  }

  const req = transport.request(
    {
      hostname,
      port,
      path: `${basePath}/api/hooks/event`,
      method: "POST",
      headers,
      timeout,
    },
    (res) => {
      res.resume();
      process.exit(0);
    }
  );

  req.on("error", () => process.exit(0));
  req.on("timeout", () => {
    req.destroy();
    process.exit(0);
  });

  req.write(payload);
  req.end();
});

// Safety net timeout — always exit, never block Claude Code
setTimeout(() => process.exit(0), timeout + 3000);
