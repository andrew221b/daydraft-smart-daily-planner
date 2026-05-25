import { useEffect } from "react";
import { useMotionValue, useSpring } from "framer-motion";

/**
 * Captures device orientation (or mouse movement as a fallback) to provide
 * 3D rotation values (rotateX, rotateY) for parallax effects.
 * 
 * Returns motion values that smoothly interpolate to the target orientation.
 */
export function useGyroscopeParallax(intensity = 15) {
  // Raw target values
  const xTarget = useMotionValue(0);
  const yTarget = useMotionValue(0);

  // Smooth springs for fluid motion
  const rotateX = useSpring(xTarget, { stiffness: 150, damping: 20 });
  const rotateY = useSpring(yTarget, { stiffness: 150, damping: 20 });

  useEffect(() => {
    // Flag to ensure we don't apply mouse events on mobile if gyro works
    let hasGyro = false;

    const handleOrientation = (e: DeviceOrientationEvent) => {
      if (e.beta === null || e.gamma === null) return;
      hasGyro = true;
      
      // Beta: front-to-back tilt in degrees [-180, 180]
      // Gamma: left-to-right tilt in degrees [-90, 90]
      
      // We clamp and normalize the values
      // A typical resting phone is around beta 45deg
      const normalizedBeta = Math.max(-45, Math.min(45, (e.beta || 45) - 45)) / 45; 
      const normalizedGamma = Math.max(-45, Math.min(45, e.gamma || 0)) / 45;

      // Map to rotation degrees (inverted axes for natural feel)
      xTarget.set(normalizedBeta * -intensity);
      yTarget.set(normalizedGamma * intensity);
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (hasGyro) return; // Fallback only
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      
      const normalizedX = (e.clientX - cx) / cx;
      const normalizedY = (e.clientY - cy) / cy;

      xTarget.set(normalizedY * -intensity);
      yTarget.set(normalizedX * intensity);
    };

    const handleMouseLeave = () => {
      xTarget.set(0);
      yTarget.set(0);
    };

    // Request permissions for iOS 13+ devices if needed
    // In a real app this should be user-initiated, but we listen passively first
    if (typeof window !== "undefined" && window.DeviceOrientationEvent) {
      window.addEventListener("deviceorientation", handleOrientation);
    }
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseleave", handleMouseLeave);

    return () => {
      if (typeof window !== "undefined" && window.DeviceOrientationEvent) {
        window.removeEventListener("deviceorientation", handleOrientation);
      }
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, [intensity, xTarget, yTarget]);

  return { rotateX, rotateY };
}
