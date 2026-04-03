const { Router } = require("express");
const { v4: uuidv4 } = require("uuid");
const { stmts, db } = require("../db");
const { broadcast } = require("../websocket");
const TranscriptCache = require("../lib/transcript-cache");

const router = Router();

// Shared cache instance — reused by periodic compaction scanner via router.transcriptCache
const transcriptCache = new TranscriptCache();

function ensureSession(sessionId, data, tokenName) {
  let session = stmts.getSession.get(sessionId);
  if (!session) {
    stmts.insertSession.run(
      sessionId,
      data.session_name || `Session ${sessionId.slice(0, 8)}`,
      "active",
      data.cwd || null,
      data.model || null,
      tokenName || null,
      null
    );
    session = stmts.getSession.get(sessionId);
    broadcast("session_created", session);

    // Create main agent for new session
    const mainAgentId = `${sessionId}-main`;
    const sessionLabel = session.name || `Session ${sessionId.slice(0, 8)}`;
    stmts.insertAgent.run(
      mainAgentId,
      sessionId,
      `Main Agent — ${sessionLabel}`,
      "main",
      null,
      "connected",
      null,
      null,
      null
    );
    broadcast("agent_created", stmts.getAgent.get(mainAgentId));
  }
  return session;
}

function getMainAgent(sessionId) {
  return stmts.getAgent.get(`${sessionId}-main`);
}

const processEvent = db.transaction((hookType, data, tokenName) => {
  const sessionId = data.session_id;
  if (!sessionId) return null;

  const session = ensureSession(sessionId, data, tokenName);
  let mainAgent = getMainAgent(sessionId);
  const mainAgentId = mainAgent?.id ?? null;

  // Reactivate non-active sessions when we receive hook events proving the session is alive.
  // - Work events (PreToolUse, PostToolUse, Notification, SessionStart) always reactivate.
  // - Stop/SubagentStop reactivate only if session is completed/abandoned — this handles
  //   sessions imported as "completed" before the server started, where the first hook event
  //   might be a Stop. For error sessions, Stop should NOT reactivate (the error is intentional).
  // - SessionEnd never reactivates.
  const isNonTerminalEvent = hookType !== "SessionEnd";
  const isStopLike = hookType === "Stop" || hookType === "SubagentStop";
  const isImportedOrAbandoned = session.status === "completed" || session.status === "abandoned";
  const needsReactivation =
    session.status !== "active" && isNonTerminalEvent && (!isStopLike || isImportedOrAbandoned);
  if (needsReactivation) {
    stmts.reactivateSession.run(sessionId);
    broadcast("session_updated", stmts.getSession.get(sessionId));

    if (mainAgent && mainAgent.status !== "working" && mainAgent.status !== "connected" && mainAgent.status !== "awaiting_approval") {
      stmts.reactivateAgent.run(mainAgentId);
      mainAgent = stmts.getAgent.get(mainAgentId);
      broadcast("agent_updated", mainAgent);
    }
  }

  let eventType = hookType;
  let toolName = data.tool_name || null;
  let summary = null;
  let agentId = mainAgentId;

  switch (hookType) {
    case "PreToolUse": {
      summary = `Using tool: ${toolName}`;

      // If the tool is Agent, a subagent is being created
      if (toolName === "Agent") {
        const input = data.tool_input || {};
        const subId = uuidv4();
        // Use description, then type, then first line of prompt, then fallback
        const rawName =
          input.description ||
          input.subagent_type ||
          (input.prompt ? input.prompt.split("\n")[0].slice(0, 60) : null) ||
          "Subagent";
        const subName = rawName.length > 60 ? rawName.slice(0, 57) + "..." : rawName;
        stmts.insertAgent.run(
          subId,
          sessionId,
          subName,
          "subagent",
          input.subagent_type || null,
          "working",
          input.prompt ? input.prompt.slice(0, 500) : null,
          mainAgentId,
          input.metadata ? JSON.stringify(input.metadata) : null
        );
        broadcast("agent_created", stmts.getAgent.get(subId));
        agentId = subId;
        summary = `Subagent spawned: ${subName}`;
      }

      // Update main agent status for any non-terminal state.
      // Skip only if already completed/error (stale event after SessionEnd).
      // "idle" → "working" is the normal transition when a new turn starts after Stop.
      if (
        mainAgent &&
        (mainAgent.status === "working" ||
          mainAgent.status === "connected" ||
          mainAgent.status === "idle")
      ) {
        stmts.updateAgent.run(null, "working", null, toolName, null, null, mainAgentId);
        broadcast("agent_updated", stmts.getAgent.get(mainAgentId));
      }
      break;
    }

    case "PostToolUse": {
      summary = `Tool completed: ${toolName}`;

      // NOTE: PostToolUse for "Agent" tool fires immediately when a subagent is
      // backgrounded — it does NOT mean the subagent finished its work.
      // Subagent completion is handled by SubagentStop, not here.

      // Only clear current_tool on the main agent if it's actively working or awaiting approval.
      // PostToolUse fires after user approves a permission request, so awaiting_approval → working.
      // Skip if idle (waiting for subagents) or already completed.
      if (mainAgent && (mainAgent.status === "working" || mainAgent.status === "awaiting_approval")) {
        stmts.updateAgent.run(null, "working", null, null, null, null, mainAgentId);
        broadcast("agent_updated", stmts.getAgent.get(mainAgentId));
      }
      break;
    }

    case "Stop": {
      const session = stmts.getSession.get(sessionId);
      const sessionLabel = session?.name || `Session ${sessionId.slice(0, 8)}`;
      summary =
        data.stop_reason === "error"
          ? `Error in ${sessionLabel}`
          : `${sessionLabel} — ready for input`;

      // Stop means Claude finished its turn, NOT that the session is closed.
      // Session stays active — user can still send more messages.
      // Main agent goes to "idle" (waiting for user input).
      // Background subagents may still be running — do NOT complete them here.
      // They complete individually via SubagentStop, or all at once on SessionEnd.
      const now = new Date().toISOString();

      // Set main agent to idle (waiting for user), not completed.
      // For non-tool turns the agent may already be "idle" — still update it
      // so the timestamp and activity log reflect that a turn completed.
      if (mainAgent && mainAgent.status !== "completed" && mainAgent.status !== "error") {
        stmts.updateAgent.run(null, "idle", null, null, null, null, mainAgentId);
        broadcast("agent_updated", stmts.getAgent.get(mainAgentId));
      }

      // Mark error sessions on error stop_reason, but keep normal sessions active
      if (data.stop_reason === "error") {
        stmts.updateSession.run(null, "error", now, null, sessionId);
      }
      broadcast("session_updated", stmts.getSession.get(sessionId));
      break;
    }

    case "SubagentStop": {
      summary = `Subagent completed`;
      const subagents = stmts.listAgentsBySession.all(sessionId);
      let matchingSub = null;

      // Try to identify which subagent stopped using available data.
      // SubagentStop provides: agent_type (e.g. "Explore", "test-engineer"),
      // agent_id (Claude's internal ID), description, last_assistant_message.
      const subDesc = data.description || data.agent_type || data.subagent_type || null;
      if (subDesc) {
        const namePrefix = subDesc.length > 57 ? subDesc.slice(0, 57) : subDesc;
        matchingSub = subagents.find(
          (a) => a.type === "subagent" && a.status === "working" && a.name.startsWith(namePrefix)
        );
      }

      // Try matching by agent_type against stored subagent_type
      if (!matchingSub && data.agent_type) {
        matchingSub = subagents.find(
          (a) =>
            a.type === "subagent" && a.status === "working" && a.subagent_type === data.agent_type
        );
      }

      if (!matchingSub) {
        const prompt = data.prompt ? data.prompt.slice(0, 500) : null;
        if (prompt) {
          matchingSub = subagents.find(
            (a) => a.type === "subagent" && a.status === "working" && a.task === prompt
          );
        }
      }

      // Fallback: oldest working subagent
      if (!matchingSub) {
        matchingSub = subagents.find((a) => a.type === "subagent" && a.status === "working");
      }

      if (matchingSub) {
        stmts.updateAgent.run(
          null,
          "completed",
          null,
          null,
          new Date().toISOString(),
          null,
          matchingSub.id
        );
        broadcast("agent_updated", stmts.getAgent.get(matchingSub.id));
        agentId = matchingSub.id;
        summary = `Subagent completed: ${matchingSub.name}`;

        // Session stays active — SubagentStop just means one subagent finished,
        // the session is not over until the user explicitly closes it.
      }
      break;
    }

    case "SessionStart": {
      summary = data.source === "resume" ? "Session resumed" : "Session started";
      // Reactivation is already handled above for non-active sessions.
      // Set main agent to connected (ready for work).
      if (mainAgent && mainAgent.status === "idle") {
        stmts.updateAgent.run(null, "connected", null, null, null, null, mainAgentId);
        broadcast("agent_updated", stmts.getAgent.get(mainAgentId));
      }

      // Clean up orphaned sessions: when a user runs /resume inside a session,
      // the parent session never receives Stop or SessionEnd. Mark any active
      // session with no events for 5+ minutes as abandoned.
      const staleSessions = stmts.findStaleSessions.all(sessionId, 5);
      const now = new Date().toISOString();
      for (const stale of staleSessions) {
        const staleAgents = stmts.listAgentsBySession.all(stale.id);
        for (const agent of staleAgents) {
          if (agent.status !== "completed" && agent.status !== "error") {
            stmts.updateAgent.run(null, "completed", null, null, now, null, agent.id);
            broadcast("agent_updated", stmts.getAgent.get(agent.id));
          }
        }
        stmts.updateSession.run(null, "abandoned", now, null, stale.id);
        broadcast("session_updated", stmts.getSession.get(stale.id));
      }
      break;
    }

    case "SessionEnd": {
      const endSession = stmts.getSession.get(sessionId);
      const endLabel = endSession?.name || `Session ${sessionId.slice(0, 8)}`;
      summary = `Session closed: ${endLabel}`;

      // SessionEnd is the definitive signal that the CLI process exited.
      // Mark everything as completed.
      const allAgents = stmts.listAgentsBySession.all(sessionId);
      const now = new Date().toISOString();
      for (const agent of allAgents) {
        if (agent.status !== "completed" && agent.status !== "error") {
          stmts.updateAgent.run(null, "completed", null, null, now, null, agent.id);
          broadcast("agent_updated", stmts.getAgent.get(agent.id));
        }
      }
      stmts.updateSession.run(null, "completed", now, null, sessionId);
      broadcast("session_updated", stmts.getSession.get(sessionId));

      break;
    }

    case "Notification": {
      const msg = data.message || "Notification received";
      // Tag compaction-related notifications so they show as Compaction events
      if (/compact|compress|context.*(reduc|truncat|summar)/i.test(msg)) {
        eventType = "Compaction";
        summary = msg;
      } else {
        summary = msg;
      }
      break;
    }

    case "PermissionRequest": {
      summary = toolName ? `Awaiting approval: ${toolName}` : "Awaiting approval";

      // Set main agent to awaiting_approval when a permission dialog is displayed.
      // PostToolUse will transition it back to "working" after the user decides.
      if (
        mainAgent &&
        (mainAgent.status === "working" || mainAgent.status === "connected")
      ) {
        stmts.updateAgent.run(null, "awaiting_approval", null, toolName, null, null, mainAgentId);
        broadcast("agent_updated", stmts.getAgent.get(mainAgentId));
      }
      break;
    }

    default: {
      summary = `Event: ${hookType}`;
    }
  }

  // Extract token usage from transcript on every event that provides transcript_path.
  // Claude Code hooks don't include usage/model in stdin — the transcript JSONL is
  // the only reliable source. Uses replaceTokenUsage with compaction-aware logic:
  // when the JSONL total drops (compaction rewrote it), the old value rolls into
  // a baseline column so effective_total = current_jsonl + baseline. This ensures
  // tokens from before compaction are never lost.
  //
  // Also detects compaction events (isCompactSummary in JSONL) and creates a
  // Compaction agent + event so the dashboard shows when context was compressed.
  if (data.transcript_path) {
    const result = transcriptCache.extract(data.transcript_path);
    if (result) {
      const { tokensByModel, compaction } = result;

      // Register compaction agents and events.
      // Each isCompactSummary entry in the JSONL = one compaction that occurred.
      // Deduplicate by uuid so we only create once per compaction.
      if (compaction) {
        for (const entry of compaction.entries) {
          const compactId = `${sessionId}-compact-${entry.uuid}`;
          if (stmts.getAgent.get(compactId)) continue;

          const ts = entry.timestamp || new Date().toISOString();
          stmts.insertAgent.run(
            compactId,
            sessionId,
            "Context Compaction",
            "subagent",
            "compaction",
            "completed",
            "Automatic conversation context compression",
            mainAgentId,
            null
          );
          stmts.updateAgent.run(null, "completed", null, null, ts, null, compactId);
          broadcast("agent_created", stmts.getAgent.get(compactId));

          const compactSummary = `Context compacted — conversation history compressed (#${compaction.entries.indexOf(entry) + 1})`;
          stmts.insertEvent.run(
            sessionId,
            compactId,
            "Compaction",
            null,
            compactSummary,
            JSON.stringify({
              uuid: entry.uuid,
              timestamp: ts,
              compaction_number: compaction.entries.indexOf(entry) + 1,
              total_compactions: compaction.count,
            })
          );
          broadcast("new_event", {
            session_id: sessionId,
            agent_id: compactId,
            event_type: "Compaction",
            tool_name: null,
            summary: compactSummary,
            created_at: ts,
          });
        }
      }

      if (tokensByModel) {
        for (const [model, tokens] of Object.entries(tokensByModel)) {
          stmts.replaceTokenUsage.run(
            sessionId,
            model,
            tokens.input,
            tokens.output,
            tokens.cacheRead,
            tokens.cacheWrite
          );
        }
      }
    }
  }

  // Evict transcript from cache on SessionEnd — session is done, no more reads expected.
  // Must happen after token extraction above to avoid re-populating the cache.
  if (hookType === "SessionEnd" && data.transcript_path) {
    transcriptCache.invalidate(data.transcript_path);
  }

  // Bump session updated_at on every event
  stmts.touchSession.run(sessionId);

  stmts.insertEvent.run(
    sessionId,
    agentId,
    eventType,
    toolName,
    summary,
    JSON.stringify(data)
    // created_at uses default
  );

  const event = {
    session_id: sessionId,
    agent_id: agentId,
    event_type: eventType,
    tool_name: toolName,
    summary,
    created_at: new Date().toISOString(),
  };
  broadcast("new_event", event);
  return event;
});

router.post("/event", (req, res) => {
  const { hook_type, data } = req.body;
  if (!hook_type || !data) {
    return res.status(400).json({
      error: { code: "INVALID_INPUT", message: "hook_type and data are required" },
    });
  }

  // Resolve token name from the authenticated API token (if any)
  const tokenValue = req.headers["x-api-key"] || req.query.token;
  let tokenName = null;
  if (tokenValue) {
    const tokenRow = stmts.getTokenByValue.get(tokenValue);
    if (tokenRow) {
      tokenName = tokenRow.name;
    }
  }

  const result = processEvent(hook_type, data, tokenName);
  if (!result) {
    return res.status(400).json({
      error: { code: "MISSING_SESSION", message: "session_id is required in data" },
    });
  }

  res.json({ ok: true, event: result });
});

/**
 * Serve the standalone hook-handler.js so remote clients can download it
 * without needing a full clone of the project.
 */
router.get("/handler.js", (_req, res) => {
  const handlerPath = require("path").resolve(__dirname, "../../scripts/hook-handler.js");
  const fs = require("fs");
  if (!fs.existsSync(handlerPath)) {
    return res.status(404).json({ error: "hook-handler.js not found" });
  }
  res.setHeader("Content-Type", "application/javascript");
  res.setHeader("Cache-Control", "no-cache");
  fs.createReadStream(handlerPath).pipe(res);
});

/**
 * Serve install-hooks.js so remote clients can download and run it.
 * Used by the setup-info one-liner.
 */
router.get("/install-hooks.js", (_req, res) => {
  const installerPath = require("path").resolve(__dirname, "../../scripts/install-hooks.js");
  const fs = require("fs");
  if (!fs.existsSync(installerPath)) {
    return res.status(404).json({ error: "install-hooks.js not found" });
  }
  res.setHeader("Content-Type", "application/javascript");
  res.setHeader("Cache-Control", "no-cache");
  fs.createReadStream(installerPath).pipe(res);
});

/**
 * Return setup info for remote Claude Code clients.
 * Used by the one-liner: curl -s "$DASHBOARD/api/hooks/setup-info?token=YOUR_TOKEN" | sh
 *
 * Flow:
 *   1. User creates a named API token in the Settings UI (e.g. "my-macbook")
 *   2. User runs: curl -s "https://dashboard/api/hooks/setup-info?token=xxx" | sh
 *   3. Server validates the token, then returns a shell script that downloads
 *      hook-handler.js + install-hooks.js and runs the installer.
 *
 * If auth is disabled (no DASHBOARD_ADMIN_PASSWORD), no token is required and
 * the script is generated without one.
 */
router.get("/setup-info", (req, res) => {
  const { ADMIN_PASSWORD, DASHBOARD_API_KEY } = require("../middleware/auth");
  const { stmts } = require("../db");
  let hookToken = null;

  if (ADMIN_PASSWORD) {
    // Auth enabled — require a valid API token
    const provided = req.headers["x-api-key"] || req.query.token;
    if (!provided) {
      return res.status(401).json({
        error: "API key required. Create a token in Settings and pass ?token=YOUR_TOKEN.",
      });
    }
    const tokenRow = stmts.getTokenByValue.get(provided);
    if (!tokenRow && provided !== DASHBOARD_API_KEY) {
      return res.status(401).json({ error: "Invalid API key." });
    }
    // Use the caller's own token — each machine gets its own named token
    hookToken = provided;
  }

  // Derive the public-facing base URL.
  // Priority: DASHBOARD_PUBLIC_URL env > request headers (for reverse-proxy setups)
  const dashboardUrl = process.env.DASHBOARD_PUBLIC_URL
    || `${req.protocol}://${req.get("host")}`;

  const tokenJson = hookToken
    ? `,"hook_api_key":"${hookToken}"`
    : "";

  // Build the one-liner shell script
  // Downloads both scripts from the server, then runs install-hooks.js with correct args.
  // No inline Node.js code — avoids escaping nightmares.
  const script = `#!/bin/sh
# Auto-generated setup script for Claude Code Agent Monitor
# Dashboard: ${dashboardUrl}

set -e

HANDLER_DIR="$HOME/.claude-internal/agent-monitor"
HANDLER_FILE="$HANDLER_DIR/hook-handler.js"
INSTALLER_FILE="$HANDLER_DIR/install-hooks.js"
DASHBOARD_SETTINGS="$HOME/.claude-internal/claude-dashboard.json"
SETTINGS_FILE="$HOME/.claude-internal/settings.json"

# 0. Clean up previous agent-monitor installation
echo "Cleaning up previous installation..."
rm -rf "$HANDLER_DIR"
rm -f "$DASHBOARD_SETTINGS"

# Remove stale hook-handler entries from settings.json (if the file exists)
if [ -f "$SETTINGS_FILE" ]; then
  node -e "
    const fs = require('fs');
    const p = process.argv[1];
    try {
      const s = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (s.hooks) {
        for (const k of Object.keys(s.hooks)) {
          s.hooks[k] = s.hooks[k].filter(e => {
            const str = JSON.stringify(e);
            return !str.includes('hook-handler') && !str.includes('HOOK_HANDLER');
          });
          if (s.hooks[k].length === 0) delete s.hooks[k];
        }
        if (Object.keys(s.hooks).length === 0) delete s.hooks;
      }
      fs.writeFileSync(p, JSON.stringify(s, null, 2) + '\\n');
    } catch {}
  " "$SETTINGS_FILE"
fi

# 1. Download scripts
mkdir -p "$HANDLER_DIR"
echo "Downloading scripts from ${dashboardUrl}..."
curl -sf "${dashboardUrl}/api/hooks/handler.js" -o "$HANDLER_FILE" || {
  echo "ERROR: Failed to download hook-handler.js"
  exit 1
}
curl -sf "${dashboardUrl}/api/hooks/install-hooks.js" -o "$INSTALLER_FILE" || {
  echo "ERROR: Failed to download install-hooks.js"
  exit 1
}

# 2. Write dashboard settings (URL + token)
echo '{"dashboard_url":"${dashboardUrl}"${tokenJson}}' > "$DASHBOARD_SETTINGS"
echo "Dashboard settings saved to $DASHBOARD_SETTINGS"

# 3. Run install-hooks.js — it modifies ~/.claude-internal/settings.json
echo "Installing Claude Code hooks..."
node "$INSTALLER_FILE" --handler "$HANDLER_FILE"

echo ""
echo "Done! Claude Code hooks are configured to send events to ${dashboardUrl}"
echo "Start a new Claude Code session to begin tracking."
`;

  res.setHeader("Content-Type", "application/x-sh");
  res.setHeader("Content-Disposition", "inline; filename=\"setup-agent-monitor.sh\"");
  res.send(script);
});

router.transcriptCache = transcriptCache;
module.exports = router;
