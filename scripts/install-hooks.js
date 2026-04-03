#!/usr/bin/env node

/**
 * Installs hooks that forward events to the Agent Dashboard.
 * Supports both Claude Code and CodeBuddy platforms.
 *
 * Claude Code: writes to ~/.claude-internal/settings.json
 * CodeBuddy:   writes to ~/.codebuddy/settings.json
 *
 * Usage:
 *   node install-hooks.js [--handler PATH] [--platform claude|codebuddy]
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

let platform = "claude";
let HOOK_HANDLER = path.resolve(__dirname, "hook-handler.js").replace(/\\/g, "/");

// Platform-specific hook types
// Claude Code: SubagentStop, Notification, PermissionRequest (Claude-specific)
// CodeBuddy: UserPromptSubmit, PreCompact (CodeBuddy-specific)
// Common: SessionStart, SessionEnd, PreToolUse, PostToolUse, Stop
const CLAUDE_HOOKS_WITH_MATCHER = ["PreToolUse", "PostToolUse", "Stop", "SubagentStop", "Notification", "PermissionRequest"];
const CLAUDE_HOOKS_WITHOUT_MATCHER = ["SessionStart", "SessionEnd"];
const CLAUDE_HOOK_TYPES = [...CLAUDE_HOOKS_WITH_MATCHER, ...CLAUDE_HOOKS_WITHOUT_MATCHER];

const CODEBUDDY_HOOKS_WITH_MATCHER = ["PreToolUse", "PostToolUse", "Stop", "UserPromptSubmit", "PreCompact"];
const CODEBUDDY_HOOKS_WITHOUT_MATCHER = ["SessionStart", "SessionEnd"];
const CODEBUDDY_HOOK_TYPES = [...CODEBUDDY_HOOKS_WITH_MATCHER, ...CODEBUDDY_HOOKS_WITHOUT_MATCHER];

function getPlatformConfig() {
  const isCodeBuddy = platform === "codebuddy";
  const configDir = isCodeBuddy ? ".codebuddy" : ".claude-internal";
  const settingsPath = path.join(os.homedir(), configDir, "settings.json");
  const hooksWithMatcher = isCodeBuddy ? CODEBUDDY_HOOKS_WITH_MATCHER : CLAUDE_HOOKS_WITH_MATCHER;
  const hookTypes = isCodeBuddy ? CODEBUDDY_HOOK_TYPES : CLAUDE_HOOK_TYPES;
  const platformLabel = isCodeBuddy ? "CodeBuddy" : "Claude Code";
  return { settingsPath, hooksWithMatcher, hookTypes, platformLabel };
}

/**
 * Build a hook entry for a given hook type.
 * The command is minimal: just points to hook-handler.js.
 * URL and token are read by hook-handler.js from claude-dashboard.json.
 * @param {string} hookType
 * @param {string[]} hooksWithMatcher
 */
function makeHookEntry(hookType, hooksWithMatcher) {
  const command = `node "${HOOK_HANDLER}" ${hookType}`;

  const entry = {
    hooks: [
      {
        type: "command",
        command,
      },
    ],
  };
  if (hooksWithMatcher.includes(hookType)) {
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
 * Install hook entries into the platform settings file.
 * @param {boolean} [silent]
 */
function installHooks(silent = false) {
  const { settingsPath, hooksWithMatcher, hookTypes, platformLabel } = getPlatformConfig();
  let settings = {};
  if (fs.existsSync(settingsPath)) {
    try {
      const raw = fs.readFileSync(settingsPath, "utf8");
      settings = JSON.parse(raw);
    } catch (err) {
      if (!silent) console.error(`Failed to parse ${settingsPath}:`, err.message);
      return false;
    }
  }

  if (!settings.hooks) settings.hooks = {};

  let installed = 0;
  let updated = 0;

  for (const hookType of hookTypes) {
    if (!settings.hooks[hookType]) settings.hooks[hookType] = [];

    const existing = settings.hooks[hookType].findIndex(isOurEntry);
    const entry = makeHookEntry(hookType, hooksWithMatcher);

    if (existing >= 0) {
      settings.hooks[hookType][existing] = entry;
      updated++;
    } else {
      settings.hooks[hookType].push(entry);
      installed++;
    }
  }

  const dir = path.dirname(settingsPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf8");

  if (!silent) {
    console.log(`Platform: ${platformLabel}`);
    console.log(`Hook handler: ${HOOK_HANDLER}`);
    console.log(`Settings file: ${settingsPath}`);
    console.log(`Installed: ${installed} new, updated: ${updated} existing`);
    console.log(`${platformLabel} hooks configured. Start a new ${platformLabel} session to begin tracking.`);
  }

  return true;
}

if (require.main === module) {
  // Support CLI args: node install-hooks.js [--handler PATH] [--platform claude|codebuddy]
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--handler" && args[i + 1]) {
      HOOK_HANDLER = args[++i].replace(/\\/g, "/");
    }
    if (args[i] === "--platform" && args[i + 1]) {
      const p = args[++i].toLowerCase();
      if (p === "claude" || p === "codebuddy") {
        platform = p;
      }
    }
  }
  installHooks(false);
}

module.exports = { installHooks };
