/** Returns the most recent finished designs for the lookbook strip. */
import { getStore } from "@netlify/blobs";

export default async () => {
  try {
    const meta = getStore({ name: "meta", consistency: "strong" });
    const list = (await meta.get("recent", { type: "json" })) || [];
    return json(Array.isArray(list) ? list : []);
  } catch {
    return json([]);
  }
};

function json(obj) {
  return new Response(JSON.stringify(obj), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
