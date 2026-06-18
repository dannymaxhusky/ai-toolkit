/**
 * Reroom — background function (async, up to 15 min).
 *
 * Uses Netlify Blobs (zero-config, built in) for BOTH:
 *   - job state  (store "jobs", key = job id, JSON)
 *   - images     (store "images", key = `${id}/v${i}.png`, binary)
 *   - lookbook   (store "meta", key "recent", JSON array)
 *
 * Generated image URLs point at the `img` function, which streams the blob.
 *
 * Required env var (Netlify -> Site settings -> Environment):
 *   GEMINI_API_KEY   (Google AI Studio key with billing enabled)
 *
 * No database account needed — Netlify Blobs is provisioned automatically.
 */
import { getStore } from "@netlify/blobs";

const MODEL = "gemini-3.1-flash-image-preview";

const BASE_INSTRUCTION =
  "You are an expert interior designer performing a photo-realistic redesign of this exact room. " +
  "CRITICAL: Keep the room's existing architecture — walls, windows, doors, ceiling, floor layout, " +
  "the camera angle and perspective — EXACTLY the same. Do NOT change the structure or viewpoint. " +
  "ONLY restyle the furniture, decor, materials, textiles, color palette and lighting to match the target style. " +
  "Keep proportions realistic and the result must look like a real photograph of the same room after a renovation.";

const STYLES = {
  minimalist: { name: "Modern Minimalist", prompt: "Modern minimalist style: clean uncluttered lines, a calm neutral palette of warm white, greige and soft charcoal, low-profile furniture with matte surfaces, hidden storage, one or two sculptural accent pieces, soft diffused natural daylight. Architectural Digest interior aesthetic." },
  scandinavian: { name: "Scandinavian", prompt: "Scandinavian style: light oak wood flooring, crisp white walls, cozy wool throws and linen textiles, functional simple furniture, abundant greenery and potted plants, warm bright natural light, hygge atmosphere. Kinfolk magazine aesthetic." },
  industrial: { name: "Industrial Loft", prompt: "Industrial loft style: exposed brick and raw concrete surfaces, black metal window frames and fixtures, reclaimed wood, a worn leather sofa, Edison-bulb pendant lighting, visible ducting, moody warm directional light. Converted warehouse aesthetic." },
  japandi: { name: "Japandi", prompt: "Japandi (Japanese + Scandinavian wabi-sabi) style: low solid-wood furniture, natural materials like linen, paper and rattan, a muted earthy palette of beige, clay and soft black, handmade ceramics, paper-lantern lighting, minimal serene composition with negative space. Calm wabi-sabi atmosphere." },
  luxury: { name: "Modern Luxury", prompt: "Modern luxury (quiet glam) style: rich materials — marble, brushed brass, smoked glass and velvet; a deep sophisticated palette of charcoal, taupe and warm gold accents; plush low seating, sculptural statement lighting, polished reflective surfaces; refined and elegant. Five-star hotel suite aesthetic." },
  midcentury: { name: "Mid-Century Modern", prompt: "Mid-century modern style: warm walnut wood, tapered-leg furniture, organic curved shapes, a retro palette of mustard yellow, teal and burnt orange, iconic 1950s–60s design pieces, globe pendant lights. Palm Springs aesthetic." },
  french: { name: "French Parisian", prompt: "French Parisian style: ornate wall moldings and herringbone parquet floors, elegant antique and vintage furniture, a soft muted palette of cream, dusty rose and grey, gilded mirrors, a delicate chandelier, refined romantic atmosphere. Haussmann apartment aesthetic." },
  bohemian: { name: "Bohemian", prompt: "Bohemian (boho) style: layered eclectic textiles, rattan and natural-fiber furniture, abundant trailing plants, macrame and woven wall hangings, warm earthy terracotta and ochre tones, vintage patterned rugs, a relaxed free-spirited mix of patterns. Warm artisanal atmosphere." },
};

const VARIATIONS = [
  "Design direction A: a balanced, timeless arrangement with a soft neutral palette and bright natural daylight.",
  "Design direction B: a warmer, cozier mood with richer accent colors, layered textiles and soft ambient evening lighting.",
  "Design direction C: an alternative furniture layout featuring one bold statement piece and dramatic directional lighting.",
  "Design direction D: a lighter, airier, more open feel with abundant greenery and a minimal, decluttered composition.",
];

// strong consistency so the polling client never reads stale job state
const jobsStore = () => getStore({ name: "jobs", consistency: "strong" });
const imageStore = () => getStore({ name: "images", consistency: "strong" });
const metaStore = () => getStore({ name: "meta", consistency: "strong" });

export default async (req) => {
  let body;
  try { body = await req.json(); } catch { return new Response("bad json", { status: 400 }); }

  const { id, style } = body;
  const count = Math.min(Math.max(parseInt(body.count, 10) || 1, 1), 4);
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || process.env.GOOGLE_API_KEY;

  if (!id || !style) return new Response("missing fields", { status: 400 });

  const jobs = jobsStore();
  if (!geminiKey) {
    await jobs.setJSON(id, { style, status: "error", error: "GEMINI_API_KEY not set on the site" });
    return new Response("not configured", { status: 500 });
  }

  await jobs.setJSON(id, { style, status: "processing", createdAt: Date.now() });

  try {
    const images = imageStore();

    // read the source photo the client uploaded via the `upload` function
    const src = await images.getWithMetadata(`src/${id}`, { type: "arrayBuffer" });
    if (!src || !src.data) throw new Error("source image not found — the upload step did not run");
    const image = Buffer.from(src.data).toString("base64");
    const mimeType = (src.metadata && src.metadata.contentType) || "image/jpeg";

    const settled = await Promise.allSettled(
      Array.from({ length: count }, (_, i) => generateAndStore(images, geminiKey, id, image, mimeType, style, i))
    );
    const urls = settled.filter((s) => s.status === "fulfilled").map((s) => s.value);

    if (!urls.length) {
      const firstErr = settled.find((s) => s.status === "rejected");
      throw new Error(firstErr ? String(firstErr.reason?.message || firstErr.reason) : "all variations failed");
    }

    await jobs.setJSON(id, { style, status: "done", results: urls, result_url: urls[0], createdAt: Date.now() });
    await pushRecent({ style, result_url: urls[0], ts: Date.now() });
  } catch (err) {
    console.error("redesign failed:", err);
    await jobs.setJSON(id, { style, status: "error", error: String(err.message || err).slice(0, 480) });
  }

  return new Response("accepted", { status: 202 });
};

// ---------------------------------------------------------------- one variation
async function generateAndStore(images, geminiKey, id, image, mimeType, styleKey, idx) {
  const out = await geminiRedesign(geminiKey, image, mimeType, styleKey, idx);
  const key = `${id}/v${idx}`;
  await images.set(key, Buffer.from(out.data, "base64"), { metadata: { contentType: out.mimeType } });
  return `/.netlify/functions/img?key=${encodeURIComponent(key)}`;
}

// ---------------------------------------------------------------- Gemini
async function geminiRedesign(geminiKey, base64, mimeType, styleKey, idx = 0) {
  const style = STYLES[styleKey] || STYLES.minimalist;
  const variation = VARIATIONS[idx % VARIATIONS.length];
  const prompt = `${BASE_INSTRUCTION}\n\nTarget style — ${style.name}: ${style.prompt}\n\n${variation}`;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${geminiKey}`;

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
  return { data: inline.data, mimeType: inline.mimeType || inline.mime_type || "image/png" };
}

// ---------------------------------------------------------------- lookbook
async function pushRecent(item) {
  try {
    const meta = metaStore();
    const list = (await meta.get("recent", { type: "json" })) || [];
    list.unshift(item);
    await meta.setJSON("recent", list.slice(0, 12));
  } catch (e) {
    console.error("pushRecent failed:", e);
  }
}
