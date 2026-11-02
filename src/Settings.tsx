import { useState } from "react";
import BackgroundCards from "./BackgroundCards";
import Profile from "./Profile";
import type { Account } from "./auth";
import "./Settings.css";

export type BackgroundId =
  | "grid"
  | "lightning"
  | "ascii"
  | "ghostfibers"
  | "pixelsnow"
  | "lightrays"
  | "lightfall"
  | "fluxlines";

export const BACKGROUNDS: { id: BackgroundId; label: string }[] = [
  { id: "grid", label: "Grid" },
  { id: "lightning", label: "Lightning" },
  { id: "ascii", label: "ASCII" },
  { id: "ghostfibers", label: "Ghost fibers" },
  { id: "pixelsnow", label: "Pixel snow" },
  { id: "lightrays", label: "Light rays" },
  { id: "lightfall", label: "Lightfall" },
  { id: "fluxlines", label: "Flux lines" },
];

export const DEFAULT_BACKGROUND: BackgroundId = "grid";

export function isBackgroundId(value: string): value is BackgroundId {
  return BACKGROUNDS.some((b) => b.id === value);
}

/** Backgrounds with their own color (each one remembers its own) */
export type ColoredId = Exclude<BackgroundId, "grid">;
export type EffectColors = Record<ColoredId, string>;
export const COLORED_BACKGROUNDS: ColoredId[] = [
  "lightning",
  "ascii",
  "ghostfibers",
  "pixelsnow",
  "lightrays",
  "lightfall",
  "fluxlines",
];

export function isColoredBackground(id: BackgroundId): id is ColoredId {
  return (COLORED_BACKGROUNDS as BackgroundId[]).includes(id);
}

// Preset colors for the colored backgrounds; the last swatch is a free color picker
export const COLOR_PRESETS = ["#16222e", "#1f1633", "#0f2a1f", "#2a1818", "#2a2410", "#89cff0"];
export const DEFAULT_EFFECT_COLOR = COLOR_PRESETS[0];

// Memory for the game (MB); 4 GB is plenty for Fabric with a few mods
export const MEMORY_MIN = 2048;
export const MEMORY_MAX = 16384;
export const MEMORY_DEFAULT = 4096;

type Tab = "background" | "profile";

type Props = {
  background: BackgroundId;
  onBackground: (id: BackgroundId) => void;
  gridMoving: boolean;
  onGridMoving: (on: boolean) => void;
  colors: EffectColors;
  onColor: (id: ColoredId, color: string) => void;
  /** The signed-in account, if any; the profile tab changes its skin and cape */
  account: Account | null;
  onAccount: (account: Account) => void;
};

// Settings: Background (cards with live previews) and Profile (skin and cape)
function Settings({ background, onBackground, gridMoving, onGridMoving, colors, onColor, account, onAccount }: Props) {
  const [tab, setTab] = useState<Tab>("background");

  return (
    <div className="settings" onMouseDown={(e) => e.stopPropagation()}>
      <header className="settings-tabs">
        <button className={tab === "background" ? "is-active" : ""} onClick={() => setTab("background")}>
          Background
        </button>
        <button className={tab === "profile" ? "is-active" : ""} onClick={() => setTab("profile")}>
          Profile
        </button>
      </header>

      {tab === "background" && (
        <BackgroundCards
          background={background}
          onBackground={onBackground}
          gridMoving={gridMoving}
          onGridMoving={onGridMoving}
          colors={colors}
          onColor={onColor}
        />
      )}

      {tab === "profile" && <Profile account={account} onAccount={onAccount} />}
    </div>
  );
}

export default Settings;
