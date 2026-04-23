import { useEffect, useState } from "react";
import { Cloud, CalendarDays } from "lucide-react";

/**
 * Lightweight context strip: meeting count + (optional) weather.
 * Weather uses Open-Meteo (no API key) when geolocation is granted; otherwise hidden.
 */
export const ContextStrip = ({ meetings = 0 }: { meetings?: number }) => {
  const [temp, setTemp] = useState<number | null>(null);

  useEffect(() => {
    if (!("geolocation" in navigator)) return;
    const cached = sessionStorage.getItem("dd_weather");
    if (cached) {
      try {
        const { t, ts } = JSON.parse(cached);
        if (Date.now() - ts < 30 * 60 * 1000) { setTemp(t); return; }
      } catch { /* ignore */ }
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const r = await fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${pos.coords.latitude}&longitude=${pos.coords.longitude}&current=temperature_2m`,
          );
          const j = await r.json();
          const t = Math.round(j?.current?.temperature_2m);
          if (Number.isFinite(t)) {
            setTemp(t);
            sessionStorage.setItem("dd_weather", JSON.stringify({ t, ts: Date.now() }));
          }
        } catch { /* silent */ }
      },
      () => {/* user denied — silent */},
      { timeout: 4000, maximumAge: 30 * 60 * 1000 },
    );
  }, []);

  if (temp == null && meetings === 0) return null;

  return (
    <div className="flex items-center gap-3 text-[11px] text-secondary-fg">
      {temp != null && (
        <span className="inline-flex items-center gap-1">
          <Cloud className="h-3 w-3" />
          {temp}°
        </span>
      )}
      {meetings > 0 && (
        <span className="inline-flex items-center gap-1">
          <CalendarDays className="h-3 w-3" />
          {meetings} {meetings === 1 ? "meeting" : "meetings"} today
        </span>
      )}
    </div>
  );
};