// ============================================================
// routes/shipments.js
// Shipment CRUD + driver/org filtering
// ============================================================
"use strict";
const express = require("express");
const supabase = require("../config/supabase");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const SHIPMENT_SELECT = `
  *,
  driver:profiles!shipments_driver_id_fkey(id, full_name, phone, created_at, status),
  vehicle:vehicles(id, registration_no, vehicle_type),
  organization:organizations(id, name)
`;

// GET /api/shipments — all shipments (admin); filter by ?orgId=... or ?driverId=...
router.get("/", requireAuth, async (req, res, next) => {
  try {
    let query = supabase.from("shipments").select(SHIPMENT_SELECT).order("created_at", { ascending: false });

    if (req.query.orgId)    query = query.eq("organization_id", req.query.orgId);
    if (req.query.driverId) {
      query = query.eq("driver_id", req.query.driverId)
        .in("status", ["assigned", "ready_to_start", "in_transit", "delayed", "rerouting", "arrived"]);
    }

    const { data, error } = await query;
    if (error) throw error;
    res.json(data);
  } catch (err) { next(err); }
});

// GET /api/shipments/:id — single shipment
router.get("/:id", requireAuth, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from("shipments")
      .select(SHIPMENT_SELECT)
      .eq("id", req.params.id)
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) { next(err); }
});

// POST /api/shipments — create new shipment
router.post("/", requireAuth, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from("shipments")
      .insert(req.body)
      .select(SHIPMENT_SELECT)
      .single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) { next(err); }
});

// PATCH /api/shipments/:id — update shipment fields (status, eta, etc.)
router.patch("/:id", requireAuth, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from("shipments")
      .update(req.body)
      .eq("id", req.params.id)
      .select(SHIPMENT_SELECT)
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) { next(err); }
});

module.exports = router;
