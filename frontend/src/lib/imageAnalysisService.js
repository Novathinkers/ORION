import { supabase } from "./supabaseClient";

// ============================================================================
// Image & Audio Analysis / Upload for driver-submitted hazard reports
// ============================================================================

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = () => reject(new Error("Could not read the image file."));
    reader.readAsDataURL(file);
  });
}

function demoAnalysis(file) {
  const fileName = (file?.name || "").toLowerCase();
  
  if (
    fileName.includes("landslide") ||
    fileName.includes("mud") ||
    fileName.includes("rock") ||
    fileName.includes("slide") ||
    fileName.includes("earth") ||
    fileName.includes("slope") ||
    fileName.includes("debris")
  ) {
    return {
      source: "demo",
      category: "landslide",
      hazard: "Landslide & Rockfall Collapse",
      confidence: 96,
      explanation: "Mud, soil displacement, and heavy rockfall covering both transit lanes following slope failure.",
      severity: "CRITICAL",
      recommended_action: "Immediate stoppage; detour via alternate valley corridor required",
      isDangerZoneCandidate: true,
    };
  }

  if (fileName.includes("water") || fileName.includes("flood") || fileName.includes("rain")) {
    return {
      source: "demo",
      category: "flood",
      hazard: "Road Flood & Waterlogging",
      confidence: 93,
      explanation: "Standing water and river overflow covering asphalt surface without earth slope collapse.",
      severity: "HIGH",
      recommended_action: "Reroute via higher elevation bypass",
      isDangerZoneCandidate: true,
    };
  }

  if (fileName.includes("tree")) {
    return {
      source: "demo",
      category: "fallen_tree",
      hazard: "Fallen Tree Obstruction",
      confidence: 90,
      explanation: "Large tree limb fallen across left lane.",
      severity: "MODERATE",
      recommended_action: "Proceed with caution on single lane",
      isDangerZoneCandidate: false,
    };
  }

  if (fileName.includes("accident") || fileName.includes("crash")) {
    return {
      source: "demo",
      category: "accident",
      hazard: "Accident Obstruction",
      confidence: 91,
      explanation: "Vehicle collision blocking main transit lane.",
      severity: "HIGH",
      recommended_action: "Await clearance or detour via secondary route",
      isDangerZoneCandidate: true,
    };
  }

  return {
    source: "demo",
    category: "landslide",
    hazard: "Hillside Landslide & Debris Blockage",
    confidence: 94,
    explanation: "Earth slope movement, soil displacement, and rockfall obstructing mountain transit corridor.",
    severity: "CRITICAL",
    recommended_action: "Halt vehicle movement; confirm alternate route with Transport Manager",
    isDangerZoneCandidate: true,
  };
}

/** Analyze an uploaded hazard photo via  API and return structured classification. */
export async function analyzeHazardImage(file) {
  try {
    const imageBase64 = await fileToBase64(file);
    const mediaType = file.type || "image/jpeg";

    const { data, error } = await supabase.functions.invoke("analyze-image", {
      body: { imageBase64, mediaType },
    });

    if (error) throw error;
    if (data?.error) throw new Error(data.error);

    return { source: "real", ...data };
  } catch (err) {
    console.warn("[imageAnalysisService analyze-image failed, using DEMO fallback:", err.message);
    return demoAnalysis(file);
  }
}

/** Upload raw image to public `hazard-images` storage bucket, return URL. */
export async function uploadHazardImage(file, { userId } = {}) {
  const ext = file.name.split(".").pop() || "jpg";
  const path = `${userId || "anon"}/${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from("hazard-images").upload(path, file, { upsert: false });
  if (error) throw error;
  const { data } = supabase.storage.from("hazard-images").getPublicUrl(path);
  return data.publicUrl;
}

/** Upload recorded audio blob to public `hazard-audio` storage bucket, return public URL. */
export async function uploadHazardAudio(audioBlob, { userId } = {}) {
  if (!audioBlob || audioBlob.size === 0) {
    throw new Error("❌ Audio recording is empty or invalid.");
  }
  const ext = audioBlob.type?.includes("mp4") ? "mp4" : "webm";
  const path = `${userId || "anon"}/${Date.now()}_report.${ext}`;

  try {
    const { error } = await supabase.storage
      .from("hazard-audio")
      .upload(path, audioBlob, { contentType: audioBlob.type || "audio/webm", upsert: false });

    if (error) throw error;

    const { data } = supabase.storage.from("hazard-audio").getPublicUrl(path);
    if (!data?.publicUrl) throw new Error("Could not resolve public URL");
    return data.publicUrl;
  } catch (err) {
    console.warn("[imageAnalysisService] Supabase audio storage upload fallback:", err.message);
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("❌ Failed to process voice recording."));
      reader.readAsDataURL(audioBlob);
    });
  }
}

/** Upload avatar image file directly to Supabase storage bucket `hazard-images`, return public URL. */
export async function uploadProfilePhoto(file, { userId } = {}) {
  if (!file) throw new Error("No file selected.");
  const ext = file.name ? file.name.split(".").pop() : "jpg";
  const path = `avatars/${userId || "user"}_${Date.now()}.${ext}`;

  try {
    const { error } = await supabase.storage.from("hazard-images").upload(path, file, { upsert: true });
    if (error) throw error;

    const { data } = supabase.storage.from("hazard-images").getPublicUrl(path);
    return data.publicUrl;
  } catch (err) {
    console.warn("[uploadProfilePhoto] Supabase storage upload fallback:", err.message);
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Could not process image file"));
      reader.readAsDataURL(file);
    });
  }
}
