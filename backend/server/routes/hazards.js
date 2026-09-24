// ============================================================
// routes/hazards.js
// Hazard reports & danger zone management
// ============================================================
"use strict";
const express = require("express");
const supabase = require("../config/supabase");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// GET /api/hazards — all hazard reports (role-filtered via query params)
router.get("/", requireAuth, async (req, res, next) => {
  try {
    let query = supabase
      .from("incidents")
      .select("*, reporter:profiles!incidents_reported_by_fkey(id, full_name, phone, photo_url, organization_id)")
      .order("created_at", { ascending: false });

    // Secondary (driver): only their own reports
    if (req.query.role === "secondary" && req.query.userId) {
      query = query.eq("reported_by", req.query.userId);
    }
    const { data, error } = await query;
    if (error) throw error;
    res.json(data || []);
  } catch (err) { next(err); }
});

// POST /api/hazards — driver submits a hazard report
router.post("/", requireAuth, async (req, res, next) => {
  try {
    const { reportedBy, lat, lng, imageUrl, voiceUrl, aiAnalysis } = req.body;
    const payload = {
      type: aiAnalysis?.category || "unclear",
      description: aiAnalysis?.driver_description || aiAnalysis?.explanation || null,
      lat, lng,
      severity: (aiAnalysis?.severity || "moderate").toLowerCase(),
      source: "real",
      status: "pending_review",
      reported_by: reportedBy,
      image_url: imageUrl,
      voice_url: voiceUrl || null,
      ai_analysis: aiAnalysis,
    };
    const { data, error } = await supabase.from("incidents").insert(payload).select().single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) { next(err); }
});

// PATCH /api/hazards/:id/mark-danger-zone — admin confirms danger zone
router.patch("/:id/mark-danger-zone", requireAuth, async (req, res, next) => {
  try {
    const { radiusKm = 5 } = req.body;
    const patch = {
      is_danger_zone: true, status: "active",
      radius_km: radiusKm, reviewed_by: req.user.id,
      reviewed_at: new Date().toISOString(),
    };
    const { data, error } = await supabase
      .from("incidents").update(patch).eq("id", req.params.id).select().maybeSingle();
    if (error) throw error;
    res.json(data || { id: req.params.id, ...patch });
  } catch (err) { next(err); }
});

// PATCH /api/hazards/:id/mark-road-blocked — admin marks road blocked
router.patch("/:id/mark-road-blocked", requireAuth, async (req, res, next) => {
  try {
    const { radiusKm = 5, roadSegment = "Highway Segment" } = req.body;
    const patch = {
      is_danger_zone: true, status: "blocked",
      radius_km: radiusKm, reviewed_by: req.user.id,
      reviewed_at: new Date().toISOString(),
    };
    const { data, error } = await supabase
      .from("incidents").update(patch).eq("id", req.params.id).select().maybeSingle();
    if (error) throw error;

    // Also insert into road_conditions
    if (data) {
      await supabase.from("road_conditions").insert({
        road_segment: roadSegment, lat: data.lat, lng: data.lng,
        status: "blocked", reason: data.description || "Admin confirmed road blockage", source: "real",
      }).catch(() => {});
    }
    res.json(data || { id: req.params.id, ...patch });
  } catch (err) { next(err); }
});

// PATCH /api/hazards/:id/dismiss — admin dismisses a report
router.patch("/:id/dismiss", requireAuth, async (req, res, next) => {
  try {
    const patch = {
      status: "dismissed", is_danger_zone: false,
      reviewed_by: req.user.id, reviewed_at: new Date().toISOString(),
    };
    const { data, error } = await supabase
      .from("incidents").update(patch).eq("id", req.params.id).select().maybeSingle();
    if (error) throw error;
    res.json(data || { id: req.params.id, ...patch });
  } catch (err) { next(err); }
});

// DELETE /api/hazards/:id/road-block — admin removes a road block
router.delete("/:id/road-block", requireAuth, async (req, res, next) => {
  try {
    const patch = {
      status: "dismissed", is_danger_zone: false,
      reviewed_by: req.user.id, reviewed_at: new Date().toISOString(),
    };
    await supabase.from("incidents").update(patch).eq("id", req.params.id);
    await supabase.from("road_conditions").delete().eq("status", "blocked");
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
