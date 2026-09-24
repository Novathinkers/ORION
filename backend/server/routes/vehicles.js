// ============================================================
// routes/vehicles.js
// Vehicle fleet management endpoints
// ============================================================
"use strict";
const express = require("express");
const supabase = require("../config/supabase");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// GET /api/vehicles?orgId=... — list vehicles (filter by org)
router.get("/", requireAuth, async (req, res, next) => {
  try {
    let query = supabase.from("vehicles").select("*").order("registration_no");
    if (req.query.orgId) query = query.eq("organization_id", req.query.orgId);
    const { data, error } = await query;
    if (error) throw error;
    res.json(data);
  } catch (err) { next(err); }
});

// POST /api/vehicles — create a vehicle
router.post("/", requireAuth, async (req, res, next) => {
  try {
    const { organizationId, registrationNo, vehicleType, capacityKg } = req.body;
    const { data, error } = await supabase
      .from("vehicles")
      .insert({ organization_id: organizationId, registration_no: registrationNo, vehicle_type: vehicleType, capacity_kg: capacityKg })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) { next(err); }
});

// PATCH /api/vehicles/:id/status — update vehicle status
router.patch("/:id/status", requireAuth, async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: "status is required" });
    const { error } = await supabase.from("vehicles").update({ status }).eq("id", req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
