/** Returns the most recent finished designs for the lookbook strip. */
exports.handler = async () => {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.SUPABASE_PROJECT_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) return json(200, []);

  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/redesigns?status=eq.done&select=style,result_url,created_at&order=created_at.desc&limit=12`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
    );
    const rows = await res.json();
    return json(200, Array.isArray(rows) ? rows : []);
  } catch {
    return json(200, []);
  }
};

function json(statusCode, obj) {
  return { statusCode, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(obj) };
}
