/**
 * Stores the uploaded room photo in Netlify Blobs and returns its key.
 *
 * This is a normal (synchronous) function, which accepts a larger request
 * body than a background function's trigger. The background job is then
 * kicked off with just the id, and reads the photo back from Blobs.
 */
import { getStore } from "@netlify/blobs";

export default async (req) => {
  let body;
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }

  const { id, image, mimeType } = body;
  if (!id || !image) return json({ error: "missing fields" }, 400);
  // optional key override (used for tile uploads, e.g. "tile/<id>/0"); default = room photo
  const key = typeof body.key === "string" && body.key ? body.key : `src/${id}`;

  try {
    const images = getStore({ name: "images", consistency: "strong" });
    await images.set(key, Buffer.from(image, "base64"), {
      metadata: { contentType: mimeType || "image/jpeg" },
    });
    return json({ ok: true, key });
  } catch (err) {
    return json({ error: String(err.message || err) }, 500);
  }
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
