import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import type { AfterLaunch } from "./launcher";
import BackgroundCards from "./BackgroundCards";
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
export const COLOR_PRESETS = [
  "#16222e",
  "#1f1633",
  "#0f2a1f",
  "#2a1818",
  "#2a2410",
  "#89cff0",
];
export const DEFAULT_EFFECT_COLOR = COLOR_PRESETS[0];


// Memory for the game (MB); 4 GB is plenty for Fabric with a few mods
export const MEMORY_MIN = 2048;
export const MEMORY_MAX = 16384;
export const MEMORY_DEFAULT = 4096;

type Tab = "background" | "game";

type Props = {
  background: BackgroundId;
  onBackground: (id: BackgroundId) => void;
  gridMoving: boolean;
  onGridMoving: (on: boolean) => void;
  colors: EffectColors;
  onColor: (id: ColoredId, color: string) => void;
  memoryMb: number;
  onMemoryMb: (value: number) => void;
  afterLaunch: AfterLaunch;
  onAfterLaunch: (value: AfterLaunch) => void;
};

// Settings: Background tab with the cards (each with its own color button), Game tab with the rows
function Settings({
  background,
  onBackground,
  gridMoving,
  onGridMoving,
  colors,
  onColor,
  memoryMb,
  onMemoryMb,
  afterLaunch,
  onAfterLaunch,
}: Props) {
  const [tab, setTab] = useState<Tab>("background");
  const [appVersion, setAppVersion] = useState("");

  useEffect(() => {
    getVersion()
      .then(setAppVersion)
      .catch(() => setAppVersion("dev"));
  }, []);
  const memoryFill =
    ((memoryMb - MEMORY_MIN) / (MEMORY_MAX - MEMORY_MIN)) * 100;

  return (
    <div
      className="settings"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <header className="settings-tabs">
        <button
          className={tab === "background" ? "is-active" : ""}
          onClick={() => setTab("background")}
        >
          Background
        </button>
        <button
          className={tab === "game" ? "is-active" : ""}
          onClick={() => setTab("game")}
        >
          Game
        </button>
      </header>

      {tab === "game" && (
        <div className="settings-list">
          <div className="settings-list-row">
            <div className="settings-list-text">
              <span className="settings-list-title">Memory</span>
              <span className="settings-list-sub">
                How much RAM Minecraft may use
              </span>
            </div>
            <div className="settings-list-control">
              <input
                className="settings-slider"
                type="range"
                min={MEMORY_MIN}
                max={MEMORY_MAX}
                step={512}
                value={memoryMb}
                aria-label="Memory"
                style={{ "--fill": `${memoryFill}%` } as React.CSSProperties}
                onChange={(e) => onMemoryMb(Number(e.target.value))}
                onDoubleClick={() => onMemoryMb(MEMORY_DEFAULT)}
                title="Double-click to reset"
              />
              <span className="settings-slider-value">
                {(memoryMb / 1024).toFixed(memoryMb % 1024 ? 1 : 0)} GB
              </span>
            </div>
          </div>
          <div className="settings-list-row">
            <div className="settings-list-text">
              <span className="settings-list-title">When the game starts</span>
              <span className="settings-list-sub">
                What the launcher does while you play
              </span>
            </div>
            <div className="settings-segments">
              <button
                className={afterLaunch === "keep" ? "is-active" : ""}
                onClick={() => onAfterLaunch("keep")}
              >
                Keep open
              </button>
              <button
                className={afterLaunch === "minimize" ? "is-active" : ""}
                onClick={() => onAfterLaunch("minimize")}
              >
                Minimize
              </button>
            </div>
          </div>
          <div className="settings-list-row">
            <div className="settings-list-text">
              <span className="settings-list-title">Mod loader</span>
              <span className="settings-list-sub">
                Every instance runs on Fabric
              </span>
            </div>
            <span className="settings-list-value">Fabric</span>
          </div>
          <div className="settings-list-row">
            <div className="settings-list-text">
              <span className="settings-list-title">Launcher version</span>
              <span className="settings-list-sub">
                Updates install from the notice at the top left
              </span>
            </div>
            <span className="settings-list-value">{appVersion}</span>
          </div>
        </div>
      )}

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
    </div>
  );
}

export default Settings;
