/**
 * Manage the lookbook history (Netlify Blobs "meta" -> "recent").
 *   POST { action: "clear" }            -> empty the whole history
 *   POST { action: "delete", url: "…" } -> remove one entry (+ its image blob)
 */
import { getStore } from "@netlify/blobs";

export default async (req) => {
  let body;
  try { body = await req.json(); } catch { body = {}; }

  const meta = getStore({ name: "meta", consistency: "strong" });
  const images = getStore({ name: "images", consistency: "strong" });

  if (body.action === "clear") {
    await meta.setJSON("recent", []);
    return json({ ok: true, cleared: true });
  }

  if (body.action === "delete" && body.url) {
    const list = (await meta.get("recent", { type: "json" })) || [];
    const remaining = (Array.isArray(list) ? list : []).filter((e) => (e.url || e.result_url) !== body.url);
    await meta.setJSON("recent", remaining);
    // best-effort: delete the underlying image blob too
    try {
      const key = new URL(body.url, "http://x").searchParams.get("key");
      if (key) await images.delete(key);
    } catch (_) { /* ignore */ }
    return json({ ok: true, remaining: remaining.length });
  }

  return json({ error: "bad action" }, 400);
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
