if (!process.env.NODE_ENV) process.env.NODE_ENV = "production";

const express = require("express");
const cors = require("cors");
const path = require("path");
const http = require("http");
const { initWebSocket } = require("./websocket");

const sessionsRouter = require("./routes/sessions");
const agentsRouter = require("./routes/agents");
const eventsRouter = require("./routes/events");
const statsRouter = require("./routes/stats");
const hooksRouter = require("./routes/hooks");
const analyticsRouter = require("./routes/analytics");
const pricingRouter = require("./routes/pricing");
const settingsRouter = require("./routes/settings");
const workflowsRouter = require("./routes/workflows");
const authRouter = require("./routes/auth");
const { createAuthMiddleware } = require("./middleware/auth");

const IS_PRODUCTION = process.env.NODE_ENV === "production";

function createApp() {
  const app = express();

  // Trust the first proxy so req.ip reflects the real client IP when behind nginx/etc.
  app.set("trust proxy", 1);

  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  // Lightweight HTTP error logging
  app.use((req, res, next) => {
    res.on("finish", () => {
      if (res.statusCode >= 400) {
        console.log(`\x1b[31m${req.method} ${req.originalUrl} ${res.statusCode}\x1b[0m`);
      }
    });
    next();
  });

  // Serve static frontend files BEFORE auth so the SPA login page can load.
  // API routes remain protected by the auth middleware below.
  const clientDist = path.join(__dirname, "..", "client", "dist");
  if (IS_PRODUCTION) {
    app.use(express.static(clientDist));
  }

  // Global auth gate (opt-in via DASHBOARD_ADMIN_PASSWORD)
  app.use(createAuthMiddleware());

  app.use("/api/auth", authRouter);
  app.use("/api/sessions", sessionsRouter);
  app.use("/api/agents", agentsRouter);
  app.use("/api/events", eventsRouter);
  app.use("/api/stats", statsRouter);
  app.use("/api/hooks", hooksRouter);
  app.use("/api/analytics", analyticsRouter);
  app.use("/api/pricing", pricingRouter);
  app.use("/api/settings", settingsRouter);
  app.use("/api/workflows", workflowsRouter);

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  return app;
}

function startServer(app, port) {
  const server = http.createServer(app);
  initWebSocket(server);

  // SPA catch-all — serve index.html for non-API routes not matched by static files.
  // This must come AFTER all API routes and the auth middleware.
  if (IS_PRODUCTION) {
    const clientDist = path.join(__dirname, "..", "client", "dist");
    app.get("*", (req, res) => {
      // Don't catch API routes — let them 404 normally
      if (req.originalUrl.startsWith("/api/")) return res.status(404).json({ error: "Not found" });
      res.sendFile(path.join(clientDist, "index.html"));
    });
  }

  return new Promise((resolve) => {
    server.listen(port, () => {
      const mode = IS_PRODUCTION ? "production" : "development";
      const displayUrl = process.env.DASHBOARD_PUBLIC_URL || `http://localhost:${port}`;
      console.log(`Agent Dashboard server running on ${displayUrl} (${mode})`);
      if (!IS_PRODUCTION) {
        console.log(`Client dev server expected at http://localhost:5173`);
      }
      resolve(server);
    });
  });
}

if (require.main === module) {
  const PORT = parseInt(process.env.DASHBOARD_PORT || "4820", 10);
  const app = createApp();
  startServer(app, PORT);

  // Auto-install Claude Code hooks on every startup so users don't have to
  try {
    const { installHooks } = require("../scripts/install-hooks");
    const { ADMIN_PASSWORD } = require("./middleware/auth");
    const { v4: uuidv4 } = require("uuid");
    const fs = require("fs");
    const path = require("path");
    const os = require("os");
    const dbModule = require("./db");

    if (ADMIN_PASSWORD) {
      // Auth enabled — ensure a dedicated API token exists for hook ingestion.
      // Persist to ~/.claude-internal/claude-dashboard.json so hook-handler.js
      // can read it without embedding secrets in Claude Code settings.json.
      const settingsPath = path.join(os.homedir(), ".claude-internal", "claude-dashboard.json");
      let dashboardSettings = {};
      try {
        dashboardSettings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
      } catch { /* file doesn't exist yet */ }

      const tokenName = "hook-ingestion";
      const existing = dbModule.db
        .prepare("SELECT token FROM api_tokens WHERE name = ?")
        .get(tokenName);
      const token = existing ? existing.token : uuidv4();
      if (!existing) {
        dbModule.stmts.insertToken.run(uuidv4(), tokenName, token);
      }

      dashboardSettings.hook_api_key = token;
      const dir = path.dirname(settingsPath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(settingsPath, JSON.stringify(dashboardSettings, null, 2) + "\n", "utf8");
    }

    // Always reinstall hooks (without apiKey — hook-handler reads from file)
    installHooks(true);
    console.log("Claude Code hooks auto-configured.");
  } catch {
    // Non-fatal — user can run npm run install-hooks manually
  }

  // Periodic maintenance sweep (every 2 min):
  // 1. Mark abandoned sessions that slipped through event-based detection
  // 2. Scan active sessions' JSONL files for new compaction entries
  //    (/compact fires no hooks, so compaction agents only appear on next hook event
  //    without this scanner)
  const cleanupDb = require("./db");
  const { broadcast } = require("./websocket");
  const { importCompactions } = require("../scripts/import-history");
  const { transcriptCache } = require("./routes/hooks");
  setInterval(
    () => {
      // 1. Stale session cleanup
      const stale = cleanupDb.stmts.findStaleSessions.all("__periodic__", 5);
      const now = new Date().toISOString();
      for (const s of stale) {
        const agents = cleanupDb.stmts.listAgentsBySession.all(s.id);
        for (const agent of agents) {
          if (agent.status !== "completed" && agent.status !== "error") {
            cleanupDb.stmts.updateAgent.run(null, "completed", null, null, now, null, agent.id);
            broadcast("agent_updated", cleanupDb.stmts.getAgent.get(agent.id));
          }
        }
        cleanupDb.stmts.updateSession.run(null, "abandoned", now, null, s.id);
        broadcast("session_updated", cleanupDb.stmts.getSession.get(s.id));

        // Evict transcript cache for abandoned sessions to bound memory growth
        const tpRow = cleanupDb.db
          .prepare(
            "SELECT json_extract(data, '$.transcript_path') as tp FROM events WHERE session_id = ? AND json_extract(data, '$.transcript_path') IS NOT NULL LIMIT 1"
          )
          .get(s.id);
        if (tpRow?.tp) transcriptCache.invalidate(tpRow.tp);
      }

      // 2. Scan active sessions for new compaction entries
      const active = cleanupDb.db
        .prepare(
          "SELECT DISTINCT e.session_id, json_extract(e.data, '$.transcript_path') as tp FROM events e JOIN sessions s ON s.id = e.session_id WHERE s.status = 'active' AND json_extract(e.data, '$.transcript_path') IS NOT NULL GROUP BY e.session_id ORDER BY MAX(e.id) DESC"
        )
        .all();
      for (const row of active) {
        if (!row.tp) continue;
        try {
          const compactions = transcriptCache.extractCompactions(row.tp);
          if (compactions.length === 0) continue;
          const mainAgentId = `${row.session_id}-main`;
          const created = importCompactions(cleanupDb, row.session_id, mainAgentId, compactions);
          if (created > 0) {
            broadcast(
              "agent_created",
              cleanupDb.stmts.getAgent.get(
                `${row.session_id}-compact-${compactions[compactions.length - 1].uuid}`
              )
            );
          }
        } catch {
          continue;
        }
      }
      // 3. Recover agents stuck in awaiting_approval for too long.
      // Claude Code has no hook for permission denial/dismissal (ESC),
      // so we use a timeout to reset these agents back to working.
      const stuckAgents = cleanupDb.db
        .prepare(
          `SELECT a.id FROM agents a JOIN sessions s ON a.session_id = s.id
           WHERE a.status = 'awaiting_approval' AND s.status = 'active'
             AND a.updated_at < strftime('%Y-%m-%dT%H:%M:%fZ','now', '-5 minutes')`
        )
        .all();
      for (const a of stuckAgents) {
        cleanupDb.stmts.updateAgent.run(null, "working", null, null, null, null, a.id);
        broadcast("agent_updated", cleanupDb.stmts.getAgent.get(a.id));
      }
    },
    2 * 60 * 1000
  );

  // Auto-import legacy sessions and backfill compaction tracking on startup
  const { importAllSessions, backfillCompactions } = require("../scripts/import-history");
  const dbModule = require("./db");
  importAllSessions(dbModule)
    .then(({ imported, skipped, errors }) => {
      if (imported > 0) console.log(`Imported ${imported} legacy sessions from ~/.claude-internal/`);
      if (errors > 0) console.log(`${errors} session files had errors during import`);
    })
    .then(() => backfillCompactions(dbModule))
    .then(({ backfilled }) => {
      if (backfilled > 0) console.log(`Backfilled ${backfilled} compaction events from ~/.claude-internal/`);
    })
    .catch(() => {
      // Non-fatal — legacy import is best-effort
    });
}

module.exports = { createApp, startServer };
