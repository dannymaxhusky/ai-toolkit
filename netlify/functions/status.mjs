/** Returns the current state of a redesign job (polled by the client). */
import { getStore } from "@netlify/blobs";

export default async (req) => {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return json({ error: "missing id" }, 400);

  try {
    const jobs = getStore({ name: "jobs", consistency: "strong" });
    const job = await jobs.get(id, { type: "json" });
    return json(job || { status: "unknown" });
  } catch (err) {
    return json({ status: "error", error: String(err.message || err) }, 500);
  }
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
