/** "#rrggbb" → [r, g, b] in 0..1 */
export function hexToRgb01(hex: string): [number, number, number] {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return [0.1, 0.1, 0.1];
  return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
}

/**
 * How colorful the effects should be for this color, 0..1. Based on HSV saturation (so the dark presets
 * still count as colorful), boosted a bit. Grey, white and black give 0, so the effect turns neutral.
 */
export function hexToVividness(hex: string): number {
  const [r, g, b] = hexToRgb01(hex);
  const max = Math.max(r, g, b);
  if (max === 0) return 0;
  return Math.min(1, ((max - Math.min(r, g, b)) / max) * 1.6);
}

/** "#rrggbb" → hue in degrees (0..360) */
export function hexToHue(hex: string): number {
  const [r, g, b] = hexToRgb01(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  let h = 0;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return h * 60;
}
