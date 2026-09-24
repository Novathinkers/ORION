// ============================================================
// routes/organizations.js
// Organizations & User Profiles endpoints
// ============================================================
"use strict";
const express = require("express");
const supabase = require("../config/supabase");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// GET /api/organizations — list all organizations (admin)
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const { data, error } = await supabase.from("organizations").select("*").order("name");
    if (error) throw error;
    res.json(data);
  } catch (err) { next(err); }
});

// GET /api/organizations/:id — single organization
router.get("/:id", requireAuth, async (req, res, next) => {
  try {
    const { data, error } = await supabase.from("organizations").select("*").eq("id", req.params.id).single();
    if (error) throw error;
    res.json(data);
  } catch (err) { next(err); }
});

// GET /api/organizations/:id/drivers — drivers in an organization
router.get("/:id/drivers", requireAuth, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("organization_id", req.params.id)
      .eq("role", "secondary")
      .order("full_name");
    if (error) throw error;
    res.json(data);
  } catch (err) { next(err); }
});

// GET /api/organizations/:id/vehicles — vehicles in an organization
router.get("/:id/vehicles", requireAuth, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from("vehicles")
      .select("*")
      .eq("organization_id", req.params.id)
      .order("registration_no");
    if (error) throw error;
    res.json(data);
  } catch (err) { next(err); }
});

module.exports = router;
