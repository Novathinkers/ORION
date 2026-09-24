// ============================================================
// routes/profiles.js
// User profile management endpoints
// ============================================================
"use strict";
const express = require("express");
const supabase = require("../config/supabase");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// GET /api/profiles — list all profiles (admin)
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("*, organizations(name)")
      .order("created_at", { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (err) { next(err); }
});

// GET /api/profiles/me — current authenticated user profile
router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("*, organizations(name)")
      .eq("id", req.user.id)
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) { next(err); }
});

// GET /api/profiles/:id — single profile by ID
router.get("/:id", requireAuth, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("*, organizations(name)")
      .eq("id", req.params.id)
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) { next(err); }
});

// PATCH /api/profiles/:id — update a profile (full_name, phone, photo_url)
router.patch("/:id", requireAuth, async (req, res, next) => {
  try {
    const { fullName, phone, photoUrl, status } = req.body;
    const updates = {};
    if (fullName  !== undefined) updates.full_name = fullName;
    if (phone     !== undefined) updates.phone     = phone;
    if (photoUrl  !== undefined) updates.photo_url = photoUrl;
    if (status    !== undefined) updates.status    = status;

    const { data, error } = await supabase
      .from("profiles")
      .update(updates)
      .eq("id", req.params.id)
      .select()
      .maybeSingle();
    if (error) throw error;
    res.json(data);
  } catch (err) { next(err); }
});

module.exports = router;
