import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { current, longest } = await req.json();
    const cur = Math.max(0, Math.min(9999, Number(current) || 0));
    const lon = Math.max(0, Math.min(9999, Number(longest) || 0));

    const W = 1080, H = 1080;
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0a0a0f"/>
      <stop offset="100%" stop-color="#1a0f2e"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="38%" r="55%">
      <stop offset="0%" stop-color="#a855f7" stop-opacity="0.55"/>
      <stop offset="60%" stop-color="#6366f1" stop-opacity="0.15"/>
      <stop offset="100%" stop-color="#000" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="num" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#f0abfc"/>
      <stop offset="100%" stop-color="#a855f7"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>

  <g transform="translate(540 320)" text-anchor="middle">
    <text font-family="-apple-system, system-ui, sans-serif" font-size="44" fill="#a78bfa" font-weight="600" letter-spacing="6">DAYDRAFT</text>
  </g>

  <g transform="translate(540 380)" text-anchor="middle">
    <text font-family="-apple-system, system-ui, sans-serif" font-size="320" font-weight="800" fill="url(#num)">${cur}</text>
  </g>

  <g transform="translate(540 740)" text-anchor="middle">
    <text font-family="-apple-system, system-ui, sans-serif" font-size="56" fill="#ffffff" font-weight="600">day streak 🔥</text>
  </g>

  <g transform="translate(540 850)" text-anchor="middle">
    <text font-family="-apple-system, system-ui, sans-serif" font-size="32" fill="#9ca3af" font-weight="500">Longest: ${lon} days</text>
  </g>

  <g transform="translate(540 980)" text-anchor="middle">
    <text font-family="-apple-system, system-ui, sans-serif" font-size="28" fill="#a78bfa" font-weight="500" letter-spacing="2">draft your day · daydraft.app</text>
  </g>
</svg>`;
    const b64 = btoa(unescape(encodeURIComponent(svg)));
    const image = `data:image/svg+xml;base64,${b64}`;
    return new Response(JSON.stringify({ image }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});