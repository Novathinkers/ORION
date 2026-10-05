// ============================================================
// routes/alerts.js
// Alerts, incidents & risk history endpoints
// ============================================================
"use strict";
const express = require("express");
const supabase = require("../config/supabase");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// GET /api/alerts — all alerts (admin) or filtered by ?orgId=
router.get("/", requireAuth, async (req, res, next) => {
  try {
    let query = supabase
      .from("alerts")
      .select("*, shipments(source_name, destination_name, priority), organizations(name)")
      .order("created_at", { ascending: false })
      .limit(100);
    if (req.query.orgId) {
      query = supabase
        .from("alerts")
        .select("*, shipments(source_name, destination_name, priority)")
        .eq("organization_id", req.query.orgId)
        .order("created_at", { ascending: false })
        .limit(50);
    }
    const { data, error } = await query;
    if (error) throw error;
    res.json(data);
  } catch (err) { next(err); }
});

// PATCH /api/alerts/:id/acknowledge — acknowledge an alert
router.patch("/:id/acknowledge", requireAuth, async (req, res, next) => {
  try {
    const { error } = await supabase
      .from("alerts")
      .update({ acknowledged: true, acknowledged_by: req.user.id })
      .eq("id", req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) { next(err); }
});

// GET /api/alerts/weather — latest weather conditions
router.get("/weather", requireAuth, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from("weather_conditions")
      .select("*")
      .order("recorded_at", { ascending: false })
      .limit(20);
    if (error) throw error;
    res.json(data);
  } catch (err) { next(err); }
});

// GET /api/alerts/road-issues — active road conditions/issues
router.get("/road-issues", requireAuth, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from("road_conditions")
      .select("*")
      .neq("status", "open")
      .order("recorded_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    res.json(data);
  } catch (err) { next(err); }
});

// GET /api/alerts/incidents — active incidents & danger zones
router.get("/incidents", requireAuth, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from("incidents")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    const filtered = (data || []).filter(
      (i) => i.status === "active" || i.is_danger_zone === true
    );
    res.json(filtered);
  } catch (err) { next(err); }
});

module.exports = router;
