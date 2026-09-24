// ============================================================================
// Supabase Edge Function: place-call  (OPTIONAL — real phone calls)
// ----------------------------------------------------------------------------
// Real PSTN phone calls are not free anywhere — this function uses Twilio
// Voice as the provider. It is entirely optional: if you don't deploy this
// function (or don't set the Twilio secrets), callService.js automatically
// falls back to a DEMO simulated call that requires no account, no card, and
// still logs to `call_logs` and shows the same in-app calling UI.
//
// Deploy (only if you want REAL calls):
//   supabase functions deploy place-call
//   supabase secrets set TWILIO_ACCOUNT_SID=AC...
//   supabase secrets set TWILIO_AUTH_TOKEN=...
//   supabase secrets set TWILIO_FROM_NUMBER=+1...
//
// Request body: { to: "+91...", message: "...", language: "en"|"hi"|"ta" }
// ============================================================================

import { serve } from "https://deno.land/std@0.203.0/http/server.ts";

const ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
const AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
const FROM_NUMBER = Deno.env.get("TWILIO_FROM_NUMBER");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Twilio <Say> / Amazon Polly language codes used for text-to-speech.
const TTS_LANGUAGE = { en: "en-IN", hi: "hi-IN", ta: "ta-IN" };

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  if (!ACCOUNT_SID || !AUTH_TOKEN || !FROM_NUMBER) {
    return new Response(
      JSON.stringify({ error: "Twilio is not configured on the server. Falling back to DEMO calling." }),
      { status: 501, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }

  try {
    const { to, message, language = "en" } = await req.json();
    if (!to || !message) {
      return new Response(JSON.stringify({ error: "to and message are required." }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const ttsLang = TTS_LANGUAGE[language] || "en-IN";
    const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Say language="${ttsLang}">${escapeXml(
      message
    )}</Say></Response>`;

    const auth = btoa(`${ACCOUNT_SID}:${AUTH_TOKEN}`);
    const body = new URLSearchParams({ To: to, From: FROM_NUMBER, Twiml: twiml });

    const twilioRes = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Calls.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });

    const data = await twilioRes.json();
    if (!twilioRes.ok) {
      return new Response(JSON.stringify({ error: data.message || "Twilio call failed", status: "failed" }), {
        status: 502,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ status: "placed", sid: data.sid }), {
      status: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message, status: "failed" }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});

function escapeXml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
