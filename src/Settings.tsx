import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { Check } from "lucide-react";
import type { AfterLaunch } from "./launcher";
import "./Settings.css";

export type BackgroundId =
  "grid" | "gradient" | "lightning" | "ascii" | "ghostfibers";

export const BACKGROUNDS: { id: BackgroundId; label: string }[] = [
  { id: "grid", label: "Grid" },
  { id: "gradient", label: "Gradient" },
  { id: "lightning", label: "Lightning" },
  { id: "ascii", label: "ASCII" },
  { id: "ghostfibers", label: "Ghost fibers" },
];

export const DEFAULT_BACKGROUND: BackgroundId = "grid";

export function isBackgroundId(value: string): value is BackgroundId {
  return BACKGROUNDS.some((b) => b.id === value);
}

/** Backgrounds that use the color setting */
export const COLORED_BACKGROUNDS: BackgroundId[] = [
  "gradient",
  "lightning",
  "ascii",
  "ghostfibers",
];

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

// Strength = brightness of the whole background, 1 is the normal look
export const STRENGTH_MIN = 0.25;
export const STRENGTH_MAX = 2;

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
  effectColor: string;
  onEffectColor: (color: string) => void;
  strength: number;
  onStrength: (value: number) => void;
  memoryMb: number;
  onMemoryMb: (value: number) => void;
  afterLaunch: AfterLaunch;
  onAfterLaunch: (value: AfterLaunch) => void;
};

// Settings: big background cards, options for grid, strength and color below
function Settings({
  background,
  onBackground,
  gridMoving,
  onGridMoving,
  effectColor,
  onEffectColor,
  strength,
  onStrength,
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
  const fill =
    ((strength - STRENGTH_MIN) / (STRENGTH_MAX - STRENGTH_MIN)) * 100;
  const colorEnabled = COLORED_BACKGROUNDS.includes(background);
  const customColor = !COLOR_PRESETS.includes(effectColor);

  return (
    <div
      className="settings"
      style={
        {
          "--effect-color": effectColor,
          "--effect-strength": strength,
        } as React.CSSProperties
      }
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
        <>
          <div className="settings-cards">
            {BACKGROUNDS.map(({ id, label }) => (
              <button
                key={id}
                className={
                  "settings-card" + (background === id ? " is-selected" : "")
                }
                onClick={() => onBackground(id)}
              >
                <span className="settings-card-preview">
                  <span
                    className={`settings-tile-preview bg-${id}${id === "grid" && gridMoving ? " is-moving" : ""}`}
                  />
                  {background === id && (
                    <span className="settings-card-check">
                      <Check size={13} strokeWidth={2.5} />
                    </span>
                  )}
                </span>
                <span className="settings-card-name">{label}</span>
              </button>
            ))}
          </div>

          {/* Toolbar in dock style; only the options the selected background uses are shown */}
          <div className="settings-toolbar">
            {background === "grid" && (
              <div className="settings-tool">
                <span className="settings-tool-label">Moving grid</span>
                <button
                  className={"settings-switch" + (gridMoving ? " is-on" : "")}
                  role="switch"
                  aria-checked={gridMoving}
                  aria-label="Moving grid"
                  onClick={() => onGridMoving(!gridMoving)}
                >
                  <span className="settings-switch-knob" />
                </button>
              </div>
            )}

            <div className="settings-tool">
              <span className="settings-tool-label">Strength</span>
              <input
                className="settings-slider"
                type="range"
                min={STRENGTH_MIN}
                max={STRENGTH_MAX}
                step={0.05}
                value={strength}
                aria-label="Strength"
                style={{ "--fill": `${fill}%` } as React.CSSProperties}
                onChange={(e) => onStrength(Number(e.target.value))}
                onDoubleClick={() => onStrength(1)}
                title="Double-click to reset"
              />
              <span className="settings-slider-value">
                {Math.round(strength * 100)}%
              </span>
            </div>

            {colorEnabled && (
              <div className="settings-tool">
                <div className="settings-swatches">
                  {COLOR_PRESETS.map((color) => (
                    <button
                      key={color}
                      className={
                        "settings-swatch" +
                        (effectColor === color ? " is-selected" : "")
                      }
                      style={{ background: color }}
                      aria-label={color}
                      onClick={() => onEffectColor(color)}
                    />
                  ))}
                  <label
                    className={
                      "settings-swatch settings-swatch-custom" +
                      (customColor ? " is-selected" : "")
                    }
                    title="Pick any color"
                    style={{
                      background: customColor ? effectColor : undefined,
                    }}
                  >
                    <input
                      type="color"
                      value={effectColor}
                      onChange={(e) => onEffectColor(e.target.value)}
                    />
                    {!customColor && <span>+</span>}
                  </label>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default Settings;
