// ============================================================
// config/supabase.js
// Server-side Supabase client.
// Uses service_role key if provided (bypasses RLS for admin ops),
// otherwise falls back to anon key (RLS enforced — same as frontend).
// ============================================================
"use strict";
require("dotenv").config();

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY.trim() !== ""
    ? process.env.SUPABASE_SERVICE_ROLE_KEY
    : process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("[Supabase] SUPABASE_URL / SUPABASE_ANON_KEY are not configured in server/.env");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: false,  // server-side: no session persistence
    autoRefreshToken: false,
  },
});

module.exports = supabase;
