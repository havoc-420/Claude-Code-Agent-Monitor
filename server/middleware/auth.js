/**
 * Global auth middleware.
 *
 * Opt-in via DASHBOARD_ADMIN_PASSWORD env var.
 * When the env var is not set the middleware is a no-op and all routes pass through.
 *
 * Rules (when auth IS enabled):
 *   - GET /api/health                          → always allow
 *   - any path starting with /api/auth/        → always allow
 *   - POST /api/hooks/event                    → require valid X-API-Key header
 *       checked against api_tokens table first, then legacy DASHBOARD_API_KEY env var
 *   - all other routes                         → require client IP in ip_whitelist table
 */

const { stmts } = require("../db");

const ADMIN_PASSWORD = process.env.DASHBOARD_ADMIN_PASSWORD || null;
const LEGACY_API_KEY = process.env.DASHBOARD_API_KEY || null;

/**
 * Returns the middleware function. Called once at startup.
 * If DASHBOARD_ADMIN_PASSWORD is not set, returns a plain next() pass-through.
 */
function createAuthMiddleware() {
  if (!ADMIN_PASSWORD) {
    // Auth disabled — bypass everything
    return (_req, _res, next) => next();
  }

  return (req, res, next) => {
    const { method, path } = req;

    // Health check — always allow
    if (path === "/api/health") return next();

    // Auth routes — always allow (login, logout, status)
    if (path.startsWith("/api/auth/")) return next();

    // Hooks ingestion — validate X-API-Key
    if (method === "POST" && path === "/api/hooks/event") {
      const provided = req.headers["x-api-key"];
      if (!provided) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      // Check against api_tokens table
      const tokenRow = stmts.getTokenByValue.get(provided);
      if (tokenRow) {
        // Touch last_used_at asynchronously (non-blocking)
        setImmediate(() => {
          try { stmts.touchTokenLastUsed.run(provided); } catch { /* ignore */ }
        });
        return next();
      }

      // Fall back to legacy static env var
      if (LEGACY_API_KEY && provided === LEGACY_API_KEY) {
        return next();
      }

      return res.status(401).json({ error: "Unauthorized" });
    }

    // All other routes — validate IP whitelist
    const clientIP = req.ip || req.socket?.remoteAddress || "";
    const ipRow = stmts.getIP.get(clientIP);
    if (ipRow) {
      // Prune expired rows asynchronously (non-blocking)
      setImmediate(() => {
        try { stmts.deleteExpiredIPs.run(); } catch { /* ignore */ }
      });
      return next();
    }

    return res.status(401).json({ error: "Unauthorized", loginRequired: true });
  };
}

module.exports = { createAuthMiddleware, ADMIN_PASSWORD };
