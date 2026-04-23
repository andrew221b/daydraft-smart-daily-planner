import { forwardRef } from "react";

export const Blobs = forwardRef<HTMLDivElement>((_, ref) => (
  <div ref={ref} className="absolute inset-0 overflow-hidden pointer-events-none">
    <div className="blob bg-primary/40" style={{ width: 320, height: 320, top: -80, left: -60 }} />
    <div className="blob bg-[hsl(258,90%,60%)]/40" style={{ width: 280, height: 280, top: 120, right: -80, animationDelay: "3s" }} />
    <div className="blob bg-primary/30" style={{ width: 240, height: 240, bottom: -60, left: 60, animationDelay: "6s" }} />
  </div>
));
Blobs.displayName = "Blobs";
