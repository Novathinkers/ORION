// ============================================================================
// Supabase Edge Function: analyze-image (API Vision Integration)
// ----------------------------------------------------------------------------
// Accepts a base64-encoded photo a driver submits as a possible hazard report
// (flood, landslide, damaged road, blocked road, damaged bridge, fallen tree,
// accident/obstruction, debris, other) and calls Google API (gemini-2.5-flash).
//
// Deploy:
//   supabase functions deploy analyze-image
//
// Request body:  { imageBase64: string, mediaType: "image/jpeg"|"image/png"|... }
// Response body: {
//   category: string,
//   hazard: string,
//   confidence: number, // percentage (0 - 100)
//   explanation: string,
//   severity: "LOW" | "MODERATE" | "HIGH" | "CRITICAL",
//   recommended_action: string,
//   isDangerZoneCandidate: boolean
// }
// ============================================================================

import { serve } from "https://deno.land/std@0.203.0/http/server.ts";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
const GEMINI_MODEL = "gemini-2.5-flash";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `You are an expert AI road-hazard triage assistant for the ORION logistics platform in North East India.
Analyze the driver's photo for transportation hazards and classify accurately.

CRITICAL DISAMBIGUATION RULES (MUST FOLLOW STRICTLY):
1. LANDSLIDE vs FLOOD:
   - "landslide": Classify as "landslide" if you see soil, rocks, boulders, mudslides, earth movement, collapsed slopes, or hillside debris blocking the road. EVEN IF THE MUD IS WET OR RAINY, if there is earth/rock/dirt displacement, it is a LANDSLIDE (NOT a flood).
   - "flood": Classify as "flood" ONLY if you see standing water, waterlogging, overflowing river/stream water, or submerged road surfaces WITHOUT rockfall or earth slope collapse.

2. OTHER CATEGORIES:
   - "damaged_road": Potholes, cracked asphalt, washed-out road edges, eroded surface.
   - "blocked_road": Barriers, construction blocks, structural obstructions.
   - "fallen_tree": Tree trunks, branches, or foliage across the road.
   - "accident": Vehicle crashes, overturned trucks, collisions.
   - "debris": Loose trash, fallen cargo, minor road clutter.
   - "damaged_bridge": Bridge structural damage or collapse.

Respond ONLY with a valid JSON object in this exact shape:
{
  "category": "landslide" | "flood" | "damaged_road" | "blocked_road" | "damaged_bridge" | "fallen_tree" | "accident" | "debris" | "other",
  "hazard": "Specific hazard title (e.g. Severe Landslide & Debris / Road Flood)",
  "confidence": 94, // integer percentage 0 to 100
  "explanation": "Detailed 1-2 sentence description highlighting key visual evidence (e.g. soil slope collapse vs standing water)",
  "severity": "LOW" | "MODERATE" | "HIGH" | "CRITICAL",
  "recommended_action": "Short recommended action (e.g. Immediate reroute due to landslide blockage)",
  "isDangerZoneCandidate": true or false
}`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    if (!GEMINI_API_KEY) {
      return new Response(
        JSON.stringify({ error: "GEMINI_API_KEY is not configured on the server." }),
        { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    const { imageBase64, mediaType } = await req.json();
    if (!imageBase64 || !mediaType) {
      return new Response(JSON.stringify({ error: "imageBase64 and mediaType are required." }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    
    const geminiRes = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: SYSTEM_PROMPT },
              {
                inline_data: {
                  mime_type: mediaType,
                  data: imageBase64,
                },
              },
            ],
          },
        ],
      }),
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      return new Response(JSON.stringify({ error: `Gemini API error: ${errText}` }), {
        status: 502,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const data = await geminiRes.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    const cleaned = rawText.replace(/```json|```/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      parsed = {
        category: "other",
        hazard: "Unclear Road Condition",
        confidence: 50,
        explanation: "Could not structure classification from photo.",
        severity: "MODERATE",
        recommended_action: "Manual admin review required",
        isDangerZoneCandidate: false,
      };
    }

    return new Response(JSON.stringify(parsed), {
      status: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
