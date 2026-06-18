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
 * Env vars (Netlify -> Site settings -> Environment):
 *   GEMINI_API_KEY     (Google path; AI Studio key with billing enabled)
 *   SEEDANCE_API_KEY   (Seedance path; Bearer token sk_live_... from seedance2.ai)
 * Optional Seedance overrides: SEEDANCE_API_BASE, SEEDANCE_IMAGE_ENDPOINT, SEEDANCE_IMAGE_MODEL
 *
 * The user picks the model per generation (provider = "google" | "seedance").
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
  const provider = body.provider === "seedance" ? "seedance" : "google";
  // economy = cheaper original Nano Banana (2.5 Flash); hd = Nano Banana 2
  const economy = !!body.economy;
  const designModel = economy ? "gemini-2.5-flash-image" : MODEL;
  const tilesEnabled = !!body.tilesEnabled;
  const tiles = Array.isArray(body.tiles) ? body.tiles.slice(0, 4) : [];
  const tt = body.tileTargets || {};
  const tileTargets = { design: !!tt.design, original: !!tt.original };
  const needDesign = !tilesEnabled || tileTargets.design; // floor-swap-only-on-original skips the restyle
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || process.env.GOOGLE_API_KEY;
  const seedanceKey = process.env.SEEDANCE_API_KEY;

  if (!id) return new Response("missing id", { status: 400 });
  if (needDesign && !style) return new Response("missing style", { status: 400 });

  const jobs = jobsStore();
  const fail = async (msg) => {
    await jobs.setJSON(id, { style, provider, status: "error", error: msg });
    return new Response("not configured", { status: 500 });
  };
  const willSwapTiles = tilesEnabled && tiles.length && (tileTargets.design || tileTargets.original);
  // tile swaps always use Gemini (multi-image edit); base redesign uses the chosen provider
  if (((needDesign && provider === "google") || willSwapTiles) && !geminiKey) return fail("GEMINI_API_KEY not set on the site");
  if (needDesign && provider === "seedance" && !seedanceKey) return fail("SEEDANCE_API_KEY not set on the site");

  const base = { style, provider, status: "processing", createdAt: Date.now() };
  await jobs.setJSON(id, { ...base, progress: 5 });

  try {
    const images = imageStore();

    // read the source photo the client uploaded via the `upload` function
    const src = await images.getWithMetadata(`src/${id}`, { type: "arrayBuffer" });
    if (!src || !src.data) throw new Error("source image not found — the upload step did not run");
    const image = Buffer.from(src.data).toString("base64");
    const mimeType = (src.metadata && src.metadata.contentType) || "image/jpeg";
    // public URL of the source photo (Seedance image API takes image URLs, not base64)
    const origin = process.env.URL || process.env.DEPLOY_PRIME_URL || new URL(req.url).origin;
    const originalUrl = `${origin}/.netlify/functions/img?key=${encodeURIComponent("src/" + id)}`;

    // progress across both phases
    const swapPerTile = (tileTargets.original ? 1 : 0) + (tileTargets.design ? 1 : 0);
    const totalSteps = (needDesign ? count : 0) + (willSwapTiles ? tiles.length * swapPerTile : 0) || 1;
    let completed = 0;
    const bump = async () => {
      completed++;
      await jobs.setJSON(id, { ...base, progress: Math.min(95, 5 + Math.round((completed / totalSteps) * 90)) });
    };

    const results = []; // [{ url, label }]
    let coverB64 = null, coverMime = "image/png";

    // ---- phase 1: base redesign ----
    if (needDesign) {
      const ctx = { images, geminiKey, seedanceKey, id, image, mimeType, style, originalUrl, model: designModel };
      const settled = await Promise.allSettled(
        Array.from({ length: count }, (_, i) =>
          generateOne(provider, { ...ctx, idx: i }).then(
            async (url) => { await bump(); return url; },
            async (err) => { await bump(); throw err; }
          )
        )
      );
      const urls = settled.filter((s) => s.status === "fulfilled").map((s) => s.value);
      if (!urls.length) {
        const firstErr = settled.find((s) => s.status === "rejected");
        throw new Error(firstErr ? String(firstErr.reason?.message || firstErr.reason) : "all variations failed");
      }
      urls.forEach((u, i) => results.push({ url: u, label: count > 1 ? `设计 ${i + 1}` : "设计方案" }));
      // cover design bytes (for applying tiles to the design)
      const cov = await images.getWithMetadata(`${id}/v0`, { type: "arrayBuffer" });
      if (cov && cov.data) { coverB64 = Buffer.from(cov.data).toString("base64"); coverMime = (cov.metadata && cov.metadata.contentType) || "image/png"; }
    }

    // ---- phase 2: floor-tile swaps (always via Gemini multi-image edit) ----
    if (willSwapTiles) {
      const resolved = await Promise.all(tiles.map((t) => resolveTile(t, origin, images)));
      const swapTasks = [];
      resolved.forEach((tile, ti) => {
        if (tileTargets.original) {
          swapTasks.push((async () => {
            const out = await geminiFloorSwap(geminiKey, image, mimeType, tile.base64, tile.mime, designModel);
            const key = `${id}/t-orig-${ti}`;
            await images.set(key, Buffer.from(out.data, "base64"), { metadata: { contentType: out.mimeType } });
            await bump();
            return { url: `/.netlify/functions/img?key=${encodeURIComponent(key)}`, label: `原图·${tile.name}` };
          })());
        }
        if (tileTargets.design && coverB64) {
          swapTasks.push((async () => {
            const out = await geminiFloorSwap(geminiKey, coverB64, coverMime, tile.base64, tile.mime, designModel);
            const key = `${id}/t-des-${ti}`;
            await images.set(key, Buffer.from(out.data, "base64"), { metadata: { contentType: out.mimeType } });
            await bump();
            return { url: `/.netlify/functions/img?key=${encodeURIComponent(key)}`, label: `设计·${tile.name}` };
          })());
        }
      });
      const swapSettled = await Promise.allSettled(swapTasks);
      swapSettled.forEach((s) => { if (s.status === "fulfilled") results.push(s.value); });
    }

    if (!results.length) throw new Error("no images produced");

    await jobs.setJSON(id, { ...base, status: "done", progress: 100, results, result_url: results[0].url });
    const originalRel = `/.netlify/functions/img?key=${encodeURIComponent("src/" + id)}`;
    await pushRecent(results, { style: style || null, original_url: originalRel, ts: Date.now() });
  } catch (err) {
    console.error("redesign failed:", err);
    await jobs.setJSON(id, { ...base, status: "error", error: String(err.message || err).slice(0, 480) });
  }

  return new Response("accepted", { status: 202 });
};

// ---------------------------------------------------------------- one variation (provider-agnostic)
async function generateOne(provider, ctx) {
  const key = `${ctx.id}/v${ctx.idx}`;
  if (provider === "seedance") {
    const remoteUrl = await seedanceRedesign(ctx.seedanceKey, ctx.originalUrl, ctx.style, ctx.idx);
    // download the result and persist in Blobs so it's served from our own domain
    const r = await fetch(remoteUrl);
    if (!r.ok) throw new Error(`Seedance image fetch ${r.status}`);
    const bytes = Buffer.from(await r.arrayBuffer());
    const ct = r.headers.get("content-type") || "image/png";
    await ctx.images.set(key, bytes, { metadata: { contentType: ct } });
  } else {
    const out = await geminiRedesign(ctx.geminiKey, ctx.image, ctx.mimeType, ctx.style, ctx.idx, ctx.model);
    await ctx.images.set(key, Buffer.from(out.data, "base64"), { metadata: { contentType: out.mimeType } });
  }
  return `/.netlify/functions/img?key=${encodeURIComponent(key)}`;
}

// ---------------------------------------------------------------- Gemini
async function geminiRedesign(geminiKey, base64, mimeType, styleKey, idx = 0, model = MODEL) {
  const style = STYLES[styleKey] || STYLES.minimalist;
  const variation = VARIATIONS[idx % VARIATIONS.length];
  const prompt = `${BASE_INSTRUCTION}\n\nTarget style — ${style.name}: ${style.prompt}\n\n${variation}`;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;

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

// ---------------------------------------------------------------- Seedance (Seedream image-to-image)
//
// NOTE: api.seedance2.ai publicly documents only its VIDEO API. The image
// ("AI Image" / Seedream) endpoint is assumed here to mirror that pattern.
// All of these can be overridden by env vars without a code change:
//   SEEDANCE_API_BASE       (default https://api.seedance2.ai)
//   SEEDANCE_IMAGE_ENDPOINT (default /v1/images/generations)
//   SEEDANCE_IMAGE_MODEL    (default seedream-4-0)
// On any mismatch the real API error is surfaced into the job's `error`.
async function seedanceRedesign(apiKey, imageUrl, styleKey, idx) {
  const style = STYLES[styleKey] || STYLES.minimalist;
  const prompt = `${BASE_INSTRUCTION}\n\nTarget style — ${style.name}: ${style.prompt}\n\n${VARIATIONS[idx % VARIATIONS.length]}`;

  const apiBase = process.env.SEEDANCE_API_BASE || "https://api.seedance2.ai";
  const endpoint = process.env.SEEDANCE_IMAGE_ENDPOINT || "/v1/images/generations";
  const model = process.env.SEEDANCE_IMAGE_MODEL || "seedream-4-0";

  const submit = await fetch(apiBase + endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      input: { prompt, generation_type: "image-to-image", image_urls: [imageUrl], aspect_ratio: "adaptive" },
    }),
  });
  if (!submit.ok) throw new Error(`Seedance submit ${submit.status}: ${(await submit.text()).slice(0, 300)}`);
  const submitData = await submit.json();

  // some APIs return the image synchronously; otherwise poll the task
  const direct = extractImageUrl(submitData);
  if (direct) return direct;

  const taskId = submitData.taskId || submitData.id || submitData.task_id || submitData?.data?.id;
  if (!taskId) throw new Error("Seedance: no image and no taskId in response: " + JSON.stringify(submitData).slice(0, 200));

  for (let i = 0; i < 80; i++) {
    await sleep(3000);
    const st = await fetch(`${apiBase}/v1/tasks/${taskId}`, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!st.ok) continue;
    const sd = await st.json();
    const status = (sd.status || sd?.data?.status || "").toLowerCase();
    if (["completed", "succeeded", "success", "done"].includes(status)) {
      const u = extractImageUrl(sd);
      if (u) return u;
      throw new Error("Seedance task completed but no image URL found: " + JSON.stringify(sd).slice(0, 200));
    }
    if (["failed", "error", "canceled", "cancelled"].includes(status)) {
      throw new Error("Seedance task failed: " + JSON.stringify(sd).slice(0, 200));
    }
  }
  throw new Error("Seedance task timed out");
}

function extractImageUrl(o) {
  const arr = o?.data?.results || o?.results || o?.data?.images || o?.images || o?.output || o?.data?.output;
  if (Array.isArray(arr) && arr.length) {
    const f = arr[0];
    return typeof f === "string" ? f : (f.url || f.image_url || f.imageUrl || null);
  }
  if (typeof o?.data?.url === "string") return o.data.url;
  if (typeof o?.url === "string") return o.url;
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- floor-tile swap (Gemini multi-image)
async function resolveTile(t, origin, images) {
  if (t && t.type === "upload" && t.key) {
    const blob = await images.getWithMetadata(t.key, { type: "arrayBuffer" });
    if (!blob || !blob.data) throw new Error(`uploaded tile not found: ${t.key}`);
    return { name: t.name || "自定义", base64: Buffer.from(blob.data).toString("base64"), mime: (blob.metadata && blob.metadata.contentType) || "image/jpeg" };
  }
  // preset — served as a static asset
  const r = await fetch(`${origin}/assets/tiles/${t.id}.jpg`);
  if (!r.ok) throw new Error(`tile preset ${t.id} fetch ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  return { name: t.name || t.id, base64: buf.toString("base64"), mime: r.headers.get("content-type") || "image/jpeg" };
}

async function geminiFloorSwap(geminiKey, roomB64, roomMime, tileB64, tileMime, model = MODEL) {
  const prompt =
    "You are given two images. IMAGE 1 is a photo of a room interior. IMAGE 2 is a flooring / floor-tile sample. " +
    "Replace ONLY the floor in IMAGE 1 with the flooring shown in IMAGE 2, laid across the floor with realistic " +
    "perspective, scale, lighting and subtle reflections. Keep EVERYTHING ELSE identical — walls, ceiling, windows, " +
    "doors, furniture, decor, objects, camera angle and composition must NOT change. " +
    "Output a photorealistic image of the same room with only the floor changed.";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [
        { inlineData: { mimeType: roomMime, data: roomB64 } },
        { inlineData: { mimeType: tileMime, data: tileB64 } },
        { text: prompt },
      ] }],
      generationConfig: { responseModalities: ["IMAGE"] },
    }),
  });
  if (!res.ok) throw new Error(`Gemini tile ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const ip = parts.find((p) => p.inlineData || p.inline_data);
  const inline = ip?.inlineData || ip?.inline_data;
  if (!inline?.data) throw new Error("Gemini tile: no image (" + (data?.candidates?.[0]?.finishReason || "?") + ")");
  return { data: inline.data, mimeType: inline.mimeType || inline.mime_type || "image/png" };
}

// ---------------------------------------------------------------- lookbook
// store EVERY result image (designs + each tile combo) as its own history
// entry so the lookbook shows the full generation history and any image can
// be reopened without regenerating.
async function pushRecent(results, info) {
  try {
    const store = metaStore();
    const list = (await store.get("recent", { type: "json" })) || [];
    const entries = results.map((r) => ({
      url: r.url, label: r.label || "", style: info.style, original_url: info.original_url, ts: info.ts,
    }));
    const merged = [...entries, ...(Array.isArray(list) ? list : [])].slice(0, 30);
    await store.setJSON("recent", merged);
  } catch (e) {
    console.error("pushRecent failed:", e);
  }
}
