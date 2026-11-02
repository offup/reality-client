import type { ComponentType } from "react";
import type { ColoredId } from "../Settings";
import Lightning from "./Lightning";
import GradientAscii from "./GradientAscii";
import GhostFibers from "./GhostFibers";
import PixelSnow from "./PixelSnow";
import LightRays from "./LightRays";
import Lightfall from "./Lightfall";
import FluxLines from "./FluxLines";

/** Every animated background, by id; each takes the color chosen for it */
export const EFFECTS: Record<ColoredId, ComponentType<{ color: string }>> = {
  lightning: Lightning,
  ascii: GradientAscii,
  ghostfibers: GhostFibers,
  pixelsnow: PixelSnow,
  lightrays: LightRays,
  lightfall: Lightfall,
  fluxlines: FluxLines,
};
