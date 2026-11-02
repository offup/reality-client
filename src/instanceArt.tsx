import type { ReactElement } from "react";

// Pixel art made from an instance's id: a small icon and a landscape cover.
// Same id → same picture, so every instance keeps its own look.

function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Small seeded random generator (mulberry32) */
function seeded(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Each instance gets its own hue */
export function instanceHue(id: string): number {
  return hashString(id) % 360;
}

const hsl = (h: number, s: number, l: number) => `hsl(${Math.round(h)} ${s}% ${l}%)`;

/** 8×8 mirrored pixel icon, like a block face */
export function InstanceIcon({ id, size = 36 }: { id: string; size?: number }) {
  const rand = seeded(hashString(id));
  const hue = instanceHue(id);
  const shades = [hsl(hue, 45, 22), hsl(hue, 50, 34), hsl(hue, 55, 48), hsl(hue, 60, 64)];
  const cells: ReactElement[] = [];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 4; x++) {
      const color = shades[Math.floor(rand() * shades.length)];
      cells.push(<rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={color} />);
      cells.push(<rect key={`m${x}-${y}`} x={7 - x} y={y} width={1} height={1} fill={color} />);
    }
  }
  return (
    <svg className="instance-icon-art" width={size} height={size} viewBox="0 0 8 8" shapeRendering="crispEdges">
      {cells}
    </svg>
  );
}

const COLS = 120;
const ROWS = 72;

/** Night landscape in pixels: stars, a moon, hills with grass, dirt and stone, a few trees */
export function InstanceCover({ id }: { id: string }) {
  const rand = seeded(hashString(id) ^ 0x9e3779b9);
  const hue = instanceHue(id);
  const rects: ReactElement[] = [];
  const px = (x: number, y: number, fill: string, key: string, w = 1, h = 1, opacity?: number) =>
    rects.push(<rect key={key} x={x} y={y} width={w} height={h} fill={fill} opacity={opacity} />);

  // Stars and moon
  for (let i = 0; i < 90; i++) {
    px(Math.floor(rand() * COLS), Math.floor(rand() * 34), "#fff", `s${i}`, 1, 1, 0.12 + rand() * 0.6);
  }
  const moonX = 10 + Math.floor(rand() * (COLS - 24));
  px(moonX, 7, "#ece9dc", "moon", 6, 6);
  px(moonX + 3, 8, "#d3cfbd", "moon-a", 2, 2);
  px(moonX + 1, 11, "#d3cfbd", "moon-b", 1, 1);

  // Two hill layers: far (dim) and near (full detail)
  const heights = (base: number, range: number) => {
    const out: number[] = [];
    let h = base + rand() * range;
    for (let x = 0; x < COLS; x++) {
      h += (rand() - 0.5) * 1.6;
      h = Math.max(base, Math.min(base + range, h));
      out.push(Math.round(h));
    }
    return out;
  };
  const far = heights(32, 12);
  far.forEach((top, x) => px(x, top, hsl(hue, 30, 14), `f${x}`, 1, ROWS - top));

  const near = heights(44, 10);
  near.forEach((top, x) => {
    px(x, top, hsl(hue, 55, 42 + rand() * 8), `g${x}`);
    for (let y = top + 1; y < ROWS; y++) {
      const depth = y - top;
      const color =
        depth < 2
          ? hsl(hue, 45, 30 + rand() * 6) // grass side
          : depth < 7
          ? hsl(28, 32, 20 + rand() * 6) // dirt
          : rand() < 0.03
            ? hsl(hue, 70, 60) // ore
            : hsl(0, 0, 18 + rand() * 8); // stone
      px(x, y, color, `d${x}-${y}`);
    }
  });

  // Trees on some of the near hills
  for (let x = 4; x < COLS - 4; x++) {
    if (rand() > 0.05) continue;
    const top = near[x];
    const trunk = 4 + Math.floor(rand() * 3);
    px(x, top - trunk, hsl(28, 35, 22), `t${x}`, 1, trunk);
    px(x - 2, top - trunk - 4, hsl(hue, 48, 26), `l${x}`, 5, 4);
    px(x - 1, top - trunk - 6, hsl(hue, 50, 31), `lt${x}`, 3, 2);
    px(x - 1, top - trunk - 3, hsl(hue, 50, 33), `lh${x}`, 1, 1);
    x += 7;
  }

  return (
    <svg className="instance-cover-art" viewBox={`0 0 ${COLS} ${ROWS}`} preserveAspectRatio="xMidYMax slice" shapeRendering="crispEdges">
      <defs>
        <linearGradient id={`sky-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={hsl(hue, 35, 5)} />
          <stop offset="1" stopColor={hsl(hue, 40, 14)} />
        </linearGradient>
      </defs>
      <rect width={COLS} height={ROWS} fill={`url(#sky-${id})`} />
      {rects}
    </svg>
  );
}
