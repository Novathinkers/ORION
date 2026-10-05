// ============================================================
// server/index.js
// ORION Node.js/Express Backend Server Entrypoint
// ============================================================
"use strict";
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");

const errorHandler = require("./middleware/errorHandler");

const app = express();
const PORT = process.env.PORT || 3001;

// --- Middleware ---
app.use(helmet());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan("dev"));

// CORS configuration (allow Vite frontend)
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "").split(",").map(o => o.trim()).filter(Boolean);
app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes("*")) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
}));

// Basic rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per `window`
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Ignore favicon requests to avoid 404 errors in the API logs
app.get('/favicon.ico', (req, res) => res.status(204).end());

// --- Routes ---
app.get("/api/health", (req, res) => {
  res.json({ status: "online", timestamp: new Date().toISOString() });
});

app.use("/api/organizations", require("./routes/organizations"));
app.use("/api/profiles", require("./routes/profiles"));
app.use("/api/shipments", require("./routes/shipments"));
app.use("/api/vehicles", require("./routes/vehicles"));
app.use("/api/gps", require("./routes/gps"));
app.use("/api/alerts", require("./routes/alerts"));
app.use("/api/hazards", require("./routes/hazards"));
app.use("/api/risk", require("./routes/risk"));

// 404 handler
app.use((req, res, next) => {
  const err = new Error("Not Found");
  err.status = 404;
  next(err);
});

// Error handler
app.use(errorHandler);

// --- Start Server ---
app.listen(PORT, () => {
  console.log(`\n=======================================================`);
  console.log(`🚀 ORION Express API Server running on port ${PORT}`);
  console.log(`=======================================================\n`);
});
