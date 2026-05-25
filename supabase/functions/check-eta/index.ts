import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { origin, destination, arrival_time } = await req.json();
    if (!origin || !destination) {
      return json({ error: "origin and destination required" }, 400);
    }
    const key = Deno.env.get("GOOGLE_MAPS_API_KEY");
    if (!key) return json({ error: "GOOGLE_MAPS_API_KEY not configured" }, 500);

    const url = new URL("https://maps.googleapis.com/maps/api/distancematrix/json");
    url.searchParams.set("origins", origin);
    url.searchParams.set("destinations", destination);
    url.searchParams.set("departure_time", "now");
    url.searchParams.set("mode", "driving");
    url.searchParams.set("key", key);

    const resp = await fetch(url);
    const data = await resp.json();
    const elem = data?.rows?.[0]?.elements?.[0];
    if (!elem || elem.status !== "OK") return json({ error: "no route", raw: data }, 200);

    const eta_sec: number = elem.duration_in_traffic?.value || elem.duration?.value;
    const baseline_sec: number = elem.duration?.value;
    const delay_min = Math.round((eta_sec - baseline_sec) / 60);
    const eta_min = Math.round(eta_sec / 60);

    let leave_by: string | null = null;
    if (arrival_time) {
      const [h, m] = String(arrival_time).split(":").map(Number);
      const arr = new Date(); arr.setHours(h, m, 0, 0);
      const leave = new Date(arr.getTime() - eta_sec * 1000);
      leave_by = `${String(leave.getHours()).padStart(2,"0")}:${String(leave.getMinutes()).padStart(2,"0")}`;
    }
    return json({ eta_min, delay_min, leave_by, distance_text: elem.distance?.text });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}