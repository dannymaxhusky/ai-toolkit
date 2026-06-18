/** Streams a generated image out of Netlify Blobs. */
import { getStore } from "@netlify/blobs";

export default async (req) => {
  const key = new URL(req.url).searchParams.get("key");
  if (!key) return new Response("missing key", { status: 400 });

  try {
    const images = getStore({ name: "images", consistency: "strong" });
    const { data, metadata } = await images.getWithMetadata(key, { type: "arrayBuffer" });
    if (!data) return new Response("not found", { status: 404 });
    return new Response(data, {
      headers: {
        "Content-Type": (metadata && metadata.contentType) || "image/png",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (err) {
    return new Response("error: " + String(err.message || err), { status: 500 });
  }
};
