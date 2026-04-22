export const isIOS = () => {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && (navigator as any).maxTouchPoints > 1);
};

export const mapsUrl = (location: string, lat?: number | null, lng?: number | null) => {
  const dest = lat != null && lng != null ? `${lat},${lng}` : location;
  const enc = encodeURIComponent(dest);
  if (isIOS()) return `https://maps.apple.com/?daddr=${enc}&dirflg=d`;
  return `https://www.google.com/maps/dir/?api=1&destination=${enc}`;
};