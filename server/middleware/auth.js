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
 *   - all other routes                         → require EITHER client IP in ip_whitelist
 *       OR a valid API token (X-API-Key header or ?token= query param)
 */

const { stmts } = require("../db");

const ADMIN_PASSWORD = process.env.DASHBOARD_ADMIN_PASSWORD || null;
const LEGACY_API_KEY = process.env.DASHBOARD_API_KEY || null;

/**
 * Validate an API token value against the database and legacy env var.
 * Returns the token value if valid, null otherwise.
 * Also touches last_used_at asynchronously for valid DB tokens.
 */
function validateApiToken(tokenValue) {
  if (!tokenValue) return null;

  const tokenRow = stmts.getTokenByValue.get(tokenValue);
  if (tokenRow) {
    setImmediate(() => {
      try { stmts.touchTokenLastUsed.run(tokenValue); } catch { /* ignore */ }
    });
    return tokenValue;
  }

  if (LEGACY_API_KEY && tokenValue === LEGACY_API_KEY) {
    return tokenValue;
  }

  return null;
}

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

    // Hooks ingestion — validate X-API-Key header
    if (method === "POST" && path === "/api/hooks/event") {
      const provided = req.headers["x-api-key"];
      if (validateApiToken(provided)) {
        return next();
      }
      return res.status(401).json({ error: "Unauthorized" });
    }

    // All other routes — IP whitelist OR valid API token
    // 1. Check IP whitelist
    const clientIP = req.ip || req.socket?.remoteAddress || "";
    const ipRow = stmts.getIP.get(clientIP);
    if (ipRow) {
      setImmediate(() => {
        try { stmts.deleteExpiredIPs.run(); } catch { /* ignore */ }
      });
      return next();
    }

    // 2. Check API token (header first, then query param)
    const tokenValue = req.headers["x-api-key"] || req.query.token;
    if (validateApiToken(tokenValue)) {
      return next();
    }

    return res.status(401).json({ error: "Unauthorized", loginRequired: true });
  };
}

module.exports = { createAuthMiddleware, ADMIN_PASSWORD };
