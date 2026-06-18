/** Returns the current state of a redesign job. Polled by the client. */
exports.handler = async (event) => {
  const id = event.queryStringParameters && event.queryStringParameters.id;
  if (!id) return json(400, { error: "missing id" });

  const supabaseUrl = process.env.SUPABASE_URL || process.env.SUPABASE_PROJECT_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) return json(500, { status: "error", error: "server not configured" });

  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/redesigns?id=eq.${id}&select=id,style,status,result_url,original_url,error`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
    );
    const rows = await res.json();
    return json(200, (Array.isArray(rows) && rows[0]) || { status: "unknown" });
  } catch (err) {
    return json(500, { status: "error", error: String(err.message || err) });
  }
};

function json(statusCode, obj) {
  return { statusCode, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(obj) };
}
