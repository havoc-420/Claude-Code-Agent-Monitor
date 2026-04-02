#!/usr/bin/env node

/**
 * Installs Claude Code hooks that forward events to the Agent Dashboard.
 * Modifies ~/.claude-internal/settings.json to add hook entries.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

const SETTINGS_PATH = path.join(os.homedir(), ".claude-internal", "settings.json");
// Default: hook-handler.js sits next to this script (e.g. both downloaded to ~/.claude-internal/agent-monitor/)
let HOOK_HANDLER = path.resolve(__dirname, "hook-handler.js").replace(/\\/g, "/");

// Hook types to install. Some support matchers, some don't.
const HOOKS_WITH_MATCHER = ["PreToolUse", "PostToolUse", "Stop", "SubagentStop", "Notification", "PermissionRequest"];
const HOOKS_WITHOUT_MATCHER = ["SessionStart", "SessionEnd"];
const HOOK_TYPES = [...HOOKS_WITH_MATCHER, ...HOOKS_WITHOUT_MATCHER];

/**
 * Build a hook entry for a given hook type.
 * @param {string} hookType
 * @param {{ dashboardUrl?: string, apiKey?: string }} [opts]
 */
function makeHookEntry(hookType, opts = {}) {
  // Prefix env vars inline so they are baked into the hook command.
  // Claude Code hook entries don't support a separate env block, but shell
  // command prefixes (KEY=value node ...) work cross-platform via sh -c.
  const envPrefix = [
    opts.dashboardUrl ? `CLAUDE_DASHBOARD_URL=${opts.dashboardUrl}` : "",
    opts.apiKey ? `CLAUDE_DASHBOARD_API_KEY=${opts.apiKey}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const command = envPrefix
    ? `${envPrefix} node "${HOOK_HANDLER}" ${hookType}`
    : `node "${HOOK_HANDLER}" ${hookType}`;

  const entry = {
    hooks: [
      {
        type: "command",
        command,
      },
    ],
  };
  if (HOOKS_WITH_MATCHER.includes(hookType)) {
    entry.matcher = "*";
  }
  return entry;
}

function isOurEntry(entry) {
  // Matches old format (entry.command) and new format (entry.hooks[].command)
  if (entry.command && entry.command.includes("hook-handler.js")) return true;
  if (Array.isArray(entry.hooks)) {
    return entry.hooks.some((h) => h.command && h.command.includes("hook-handler.js"));
  }
  return false;
}

/**
 * Install hook entries into ~/.claude-internal/settings.json.
 * @param {boolean} [silent]
 * @param {{ dashboardUrl?: string, apiKey?: string }} [opts]  Remote server config
 */
function installHooks(silent = false, opts = {}) {
  let settings = {};
  if (fs.existsSync(SETTINGS_PATH)) {
    try {
      const raw = fs.readFileSync(SETTINGS_PATH, "utf8");
      settings = JSON.parse(raw);
    } catch (err) {
      if (!silent) console.error(`Failed to parse ${SETTINGS_PATH}:`, err.message);
      return false;
    }
  }

  if (!settings.hooks) settings.hooks = {};

  let installed = 0;
  let updated = 0;

  for (const hookType of HOOK_TYPES) {
    if (!settings.hooks[hookType]) settings.hooks[hookType] = [];

    const existing = settings.hooks[hookType].findIndex(isOurEntry);
    const entry = makeHookEntry(hookType, opts);

    if (existing >= 0) {
      settings.hooks[hookType][existing] = entry;
      updated++;
    } else {
      settings.hooks[hookType].push(entry);
      installed++;
    }
  }

  const dir = path.dirname(SETTINGS_PATH);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n", "utf8");

  if (!silent) {
    console.log(`Hook handler: ${HOOK_HANDLER}`);
    console.log(`Settings file: ${SETTINGS_PATH}`);
    console.log(`Installed: ${installed} new, updated: ${updated} existing`);
    console.log("Claude Code hooks configured. Start a new Claude Code session to begin tracking.");
  }

  return true;
}

if (require.main === module) {
  // Support CLI args: node install-hooks.js [--handler PATH] [--url URL] [--api-key KEY]
  const args = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--handler" && args[i + 1]) {
      HOOK_HANDLER = args[++i].replace(/\\/g, "/");
    }
    if (args[i] === "--url" && args[i + 1]) { opts.dashboardUrl = args[++i]; }
    if (args[i] === "--api-key" && args[i + 1]) { opts.apiKey = args[++i]; }
  }
  installHooks(false, opts);
}

module.exports = { installHooks };
