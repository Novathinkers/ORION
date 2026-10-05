// ============================================================
// routes/risk.js
// Risk score history endpoints
// ============================================================
"use strict";
const express = require("express");
const supabase = require("../config/supabase");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// GET /api/risk/:shipmentId/history — risk score history for a shipment
router.get("/:shipmentId/history", requireAuth, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from("risk_score_history")
      .select("*")
      .eq("shipment_id", req.params.shipmentId)
      .order("created_at", { ascending: true })
      .limit(50);
    if (error) throw error;
    res.json(data);
  } catch (err) { next(err); }
});

// POST /api/risk/:shipmentId/history — insert a risk score record
router.post("/:shipmentId/history", requireAuth, async (req, res, next) => {
  try {
    const { score, factors, explanation } = req.body;
    const { error } = await supabase.from("risk_score_history").insert({
      shipment_id: req.params.shipmentId, score,
      factors_json: factors, explanation,
    });
    if (error) throw error;
    res.status(201).json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
