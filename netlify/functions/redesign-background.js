/**
 * Reroom — background function (async, up to 15 min).
 *
 * Flow:
 *   1. mark job "processing" in Supabase
 *   2. upload the original room photo to Supabase Storage
 *   3. call Gemini (Nano Banana 2) to redesign the room in the chosen style
 *   4. upload the result + mark job "done"
 *
 * Netlify auto-runs any function whose filename ends in "-background"
 * asynchronously and responds 202 immediately to the caller.
 *
 * Required env vars (set in Netlify -> Site settings -> Environment):
 *   GEMINI_API_KEY              (Google AI Studio key, billing enabled)
 *   SUPABASE_URL                (https://<ref>.supabase.co)
 *   SUPABASE_SERVICE_ROLE_KEY   (service role key — server only, never expose)
 */

const MODEL = "gemini-3.1-flash-image-preview";
const BUCKET = "rooms";

const BASE_INSTRUCTION =
  "You are an expert interior designer performing a photo-realistic redesign of this exact room. " +
  "CRITICAL: Keep the room's existing architecture — walls, windows, doors, ceiling, floor layout, " +
  "the camera angle and perspective — EXACTLY the same. Do NOT change the structure or viewpoint. " +
  "ONLY restyle the furniture, decor, materials, textiles, color palette and lighting to match the target style. " +
  "Keep proportions realistic and the result must look like a real photograph of the same room after a renovation.";

const STYLES = {
  minimalist: {
    name: "Modern Minimalist",
    prompt:
      "Modern minimalist style: clean uncluttered lines, a calm neutral palette of warm white, greige and soft charcoal, " +
      "low-profile furniture with matte surfaces, hidden storage, one or two sculptural accent pieces, soft diffused natural daylight. " +
      "Architectural Digest interior aesthetic.",
  },
  scandinavian: {
    name: "Scandinavian",
    prompt:
      "Scandinavian style: light oak wood flooring, crisp white walls, cozy wool throws and linen textiles, " +
      "functional simple furniture, abundant greenery and potted plants, warm bright natural light, hygge atmosphere. " +
      "Kinfolk magazine aesthetic.",
  },
  industrial: {
    name: "Industrial Loft",
    prompt:
      "Industrial loft style: exposed brick and raw concrete surfaces, black metal window frames and fixtures, " +
      "reclaimed wood, a worn leather sofa, Edison-bulb pendant lighting, visible ducting, moody warm directional light. " +
      "Converted warehouse aesthetic.",
  },
  japandi: {
    name: "Japandi",
    prompt:
      "Japandi (Japanese + Scandinavian wabi-sabi) style: low solid-wood furniture, natural materials like linen, paper and rattan, " +
      "a muted earthy palette of beige, clay and soft black, handmade ceramics, paper-lantern lighting, " +
      "minimal serene composition with negative space. Calm wabi-sabi atmosphere.",
  },
};

exports.handler = async (event) => {
  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, body: "bad json" };
  }

  const { id, style, image, mimeType } = body;
  const env = readEnv();

  if (!id || !style || !image) return { statusCode: 400, body: "missing fields" };
  if (!env.ok) {
    // can't even record the error without Supabase — log and exit
    console.error("Missing env vars:", env.missing.join(", "));
    return { statusCode: 500, body: "server not configured: " + env.missing.join(", ") };
  }

  await dbUpsert(env, { id, style, status: "processing" });

  try {
    const originalUrl = await uploadImage(env, `${id}/original.jpg`, Buffer.from(image, "base64"), mimeType || "image/jpeg");
    const resultB64 = await geminiRedesign(env, image, mimeType || "image/jpeg", style);
    const resultUrl = await uploadImage(env, `${id}/result.png`, Buffer.from(resultB64, "base64"), "image/png");
    await dbPatch(env, id, { status: "done", original_url: originalUrl, result_url: resultUrl });
  } catch (err) {
    console.error("redesign failed:", err);
    await dbPatch(env, id, { status: "error", error: String(err.message || err).slice(0, 480) });
  }

  return { statusCode: 202, body: "accepted" };
};

// ---------------------------------------------------------------- Gemini
async function geminiRedesign(env, base64, mimeType, styleKey) {
  const style = STYLES[styleKey] || STYLES.minimalist;
  const prompt = `${BASE_INSTRUCTION}\n\nTarget style — ${style.name}: ${style.prompt}`;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${env.geminiKey}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ inlineData: { mimeType, data: base64 } }, { text: prompt }] }],
      generationConfig: { responseModalities: ["IMAGE"] },
    }),
  });

  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);

  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const imgPart = parts.find((p) => p.inlineData || p.inline_data);
  const inline = imgPart?.inlineData || imgPart?.inline_data;
  if (!inline?.data) {
    const reason = data?.candidates?.[0]?.finishReason || data?.promptFeedback?.blockReason || "no image";
    throw new Error("Gemini returned no image (" + reason + ")");
  }
  return inline.data;
}

// ---------------------------------------------------------------- Supabase Storage
async function uploadImage(env, path, buffer, contentType) {
  const res = await fetch(`${env.supabaseUrl}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.serviceKey}`,
      apikey: env.serviceKey,
      "Content-Type": contentType,
      "x-upsert": "true",
    },
    body: buffer,
  });
  if (!res.ok) throw new Error(`Storage ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return `${env.supabaseUrl}/storage/v1/object/public/${BUCKET}/${path}`;
}

// ---------------------------------------------------------------- Supabase DB (PostgREST)
async function dbUpsert(env, row) {
  await fetch(`${env.supabaseUrl}/rest/v1/redesigns`, {
    method: "POST",
    headers: {
      apikey: env.serviceKey,
      Authorization: `Bearer ${env.serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify(row),
  });
}

async function dbPatch(env, id, patch) {
  await fetch(`${env.supabaseUrl}/rest/v1/redesigns?id=eq.${id}`, {
    method: "PATCH",
    headers: {
      apikey: env.serviceKey,
      Authorization: `Bearer ${env.serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  });
}

// ---------------------------------------------------------------- env
function readEnv() {
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || process.env.GOOGLE_API_KEY;
  const supabaseUrl = process.env.SUPABASE_URL || process.env.SUPABASE_PROJECT_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  const missing = [];
  if (!geminiKey) missing.push("GEMINI_API_KEY");
  if (!supabaseUrl) missing.push("SUPABASE_URL");
  if (!serviceKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  return { ok: missing.length === 0, missing, geminiKey, supabaseUrl, serviceKey };
}
