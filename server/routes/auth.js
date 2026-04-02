const { Router } = require("express");
const { v4: uuidv4 } = require("uuid");
const { randomBytes } = require("crypto");
const { stmts } = require("../db");
const { ADMIN_PASSWORD } = require("../middleware/auth");

const router = Router();

/**
 * GET /api/auth/status
 * Public — no auth required.
 * Returns whether auth is enabled and (if so) whether the caller's IP is whitelisted.
 */
router.get("/status", (req, res) => {
  const enabled = !!ADMIN_PASSWORD;
  if (!enabled) {
    return res.json({ enabled: false, authenticated: true });
  }
  const clientIP = req.ip || req.socket?.remoteAddress || "";
  const ipRow = stmts.getIP.get(clientIP);
  return res.json({ enabled: true, authenticated: !!ipRow });
});

/**
 * POST /api/auth/login
 * Public — no auth required.
 * Body: { password: string }
 * On success: whitelists caller IP for 24 hours, returns { ok: true }
 * On failure: 401 { error: "Invalid password" }
 */
router.post("/login", (req, res) => {
  if (!ADMIN_PASSWORD) {
    // Auth disabled — login is a no-op
    return res.json({ ok: true });
  }

  const { password } = req.body || {};
  if (!password || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Invalid password" });
  }

  const clientIP = req.ip || req.socket?.remoteAddress || "";
  // expires_at = now + 24 hours
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  stmts.insertOrReplaceIP.run(clientIP, expiresAt);

  return res.json({ ok: true });
});

/**
 * POST /api/auth/logout
 * IP-whitelist protected (handled by global middleware).
 * Removes caller IP from whitelist.
 */
router.post("/logout", (req, res) => {
  const clientIP = req.ip || req.socket?.remoteAddress || "";
  stmts.deleteIP.run(clientIP);
  return res.json({ ok: true });
});

/**
 * GET /api/auth/tokens
 * IP-whitelist protected.
 * Returns list of tokens — id, name, created_at, last_used_at (never the raw token value).
 */
router.get("/tokens", (req, res) => {
  const tokens = stmts.listTokens.all();
  return res.json(tokens);
});

/**
 * POST /api/auth/tokens
 * IP-whitelist protected.
 * Body: { name: string }
 * Creates a new API token. Returns id, name, token, created_at.
 * This is the ONLY time the raw token value is returned.
 */
router.post("/tokens", (req, res) => {
  const { name } = req.body || {};
  if (!name || typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "name is required" });
  }

  const id = uuidv4();
  const token = "dm_" + randomBytes(32).toString("hex");
  const trimmedName = name.trim().slice(0, 100);

  stmts.insertToken.run(id, trimmedName, token);

  // Fetch to get created_at from DB
  const row = stmts.getTokenByValue.get(token);
  return res.status(201).json({
    id: row.id,
    name: row.name,
    token: row.token,
    created_at: row.created_at,
  });
});

/**
 * DELETE /api/auth/tokens/:id
 * IP-whitelist protected.
 * Deletes the named token.
 */
router.delete("/tokens/:id", (req, res) => {
  stmts.deleteToken.run(req.params.id);
  return res.json({ ok: true });
});

module.exports = router;
