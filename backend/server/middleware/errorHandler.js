// ============================================================
// middleware/errorHandler.js
// Centralized Express error handler.
// ============================================================
"use strict";

function errorHandler(err, req, res, _next) {
  const status = err.status || err.statusCode || 500;
  const message = err.message || "Internal Server Error";

  console.error(`[ORION API Error] ${req.method} ${req.path} -> ${status}: ${message}`);

  res.status(status).json({
    error: message,
    path: req.path,
    timestamp: new Date().toISOString(),
  });
}

module.exports = errorHandler;
