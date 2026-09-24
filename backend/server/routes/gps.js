// ============================================================
// routes/gps.js
// GPS location tracking endpoints
// ============================================================
"use strict";
const express = require("express");
const supabase = require("../config/supabase");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// POST /api/gps — insert a GPS point
router.post("/", requireAuth, async (req, res, next) => {
  try {
    const { shipmentId, driverId, lat, lng, speedKmh, heading, accuracyM, source = "real" } = req.body;
    const { error } = await supabase.from("gps_locations").insert({
      shipment_id: shipmentId, driver_id: driverId,
      lat, lng, speed_kmh: speedKmh, heading, accuracy_m: accuracyM, source,
    });
    if (error) throw error;
    res.status(201).json({ success: true });
  } catch (err) { next(err); }
});

// GET /api/gps/latest?shipmentId=... — latest GPS for a shipment
router.get("/latest", requireAuth, async (req, res, next) => {
  try {
    const { shipmentId } = req.query;
    if (!shipmentId) return res.status(400).json({ error: "shipmentId is required" });
    const { data, error } = await supabase
      .from("gps_locations")
      .select("*")
      .eq("shipment_id", shipmentId)
      .order("recorded_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    res.json(data);
  } catch (err) { next(err); }
});

// GET /api/gps/active?shipmentIds=id1,id2,... — latest GPS for multiple active shipments
router.get("/active", requireAuth, async (req, res, next) => {
  try {
    const ids = (req.query.shipmentIds || "").split(",").filter(Boolean);
    if (!ids.length) return res.json({});
    const { data, error } = await supabase
      .from("gps_locations")
      .select("*")
      .in("shipment_id", ids)
      .order("recorded_at", { ascending: false });
    if (error) throw error;
    const latestByShipment = {};
    for (const row of data) {
      if (!latestByShipment[row.shipment_id]) latestByShipment[row.shipment_id] = row;
    }
    res.json(latestByShipment);
  } catch (err) { next(err); }
});

module.exports = router;
