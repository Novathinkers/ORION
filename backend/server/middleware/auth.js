// ============================================================
// middleware/auth.js
// JWT Bearer token validation via Supabase.
// The frontend passes its Supabase JWT in the Authorization header.
// This middleware verifies the token and attaches the user to req.user.
// ============================================================
"use strict";
const supabase = require("../config/supabase");

/**
 * Middleware: requireAuth
 * Validates the Supabase JWT from Authorization: Bearer <token>
 * Attaches req.user = { id, email, role } on success.
 */
async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Unauthorized: missing Bearer token" });
  }

  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) {
      return res.status(401).json({ error: "Unauthorized: invalid or expired token" });
    }
    req.user = data.user;
    next();
  } catch (err) {
    return res.status(500).json({ error: "Auth check failed", detail: err.message });
  }
}

/**
 * Middleware: optionalAuth
 * Like requireAuth but does not block unauthenticated requests.
 * Sets req.user = null if no valid token is provided.
 */
async function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    req.user = null;
    return next();
  }

  try {
    const { data } = await supabase.auth.getUser(token);
    req.user = data?.user || null;
  } catch {
    req.user = null;
  }
  next();
}

module.exports = { requireAuth, optionalAuth };
