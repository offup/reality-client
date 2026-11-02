import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { hexToHue, hueToHex } from "./effects/color";
import { EFFECTS } from "./effects";
import LiveEffect from "./effects/LiveEffect";
import {
  BACKGROUNDS,
  COLOR_PRESETS,
  DEFAULT_EFFECT_COLOR,
  isColoredBackground,
  type BackgroundId,
  type ColoredId,
  type EffectColors,
} from "./Settings";
import "./BackgroundCards.css";

type Props = {
  background: BackgroundId;
  onBackground: (id: BackgroundId) => void;
  gridMoving: boolean;
  onGridMoving: (on: boolean) => void;
  colors: EffectColors;
  onColor: (id: ColoredId, color: string) => void;
};

// Background cards, two per row (the area scrolls). Colored ones carry their own color button, Grid its "moving" switch.
function BackgroundCards({ background, onBackground, gridMoving, onGridMoving, colors, onColor }: Props) {
  const [paletteFor, setPaletteFor] = useState<ColoredId | null>(null);
  const paletteRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  // Only cards on screen play their animation; the browser allows just a few live WebGL canvases
  const [onScreen, setOnScreen] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const observer = new IntersectionObserver(
      (entries) =>
        setOnScreen((current) => {
          const next = new Set(current);
          for (const entry of entries) {
            const id = (entry.target as HTMLElement).dataset.id ?? "";
            if (entry.isIntersecting) next.add(id);
            else next.delete(id);
          }
          return next;
        }),
      { root: grid, rootMargin: "40px 0px" },
    );
    grid.querySelectorAll<HTMLElement>(".bgc-card").forEach((card) => observer.observe(card));
    return () => observer.disconnect();
  }, []);

  // A click anywhere outside the palette (and its button) closes it.
  // Capture phase, because the settings page stops mousedown from bubbling up.
  useEffect(() => {
    if (!paletteFor) return;
    const close = (e: MouseEvent) => {
      const target = e.target as Node;
      if (paletteRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setPaletteFor(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPaletteFor(null);
    document.addEventListener("mousedown", close, true);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [paletteFor]);

  return (
    <div className="bgc-grid" ref={gridRef}>
      {BACKGROUNDS.map(({ id, label }) => {
        const selected = background === id;
        const colored = isColoredBackground(id);
        const color = colored ? (colors[id] ?? DEFAULT_EFFECT_COLOR) : "";
        const custom = colored && !COLOR_PRESETS.includes(color);
        return (
          <div
            key={id}
            data-id={id}
            role="button"
            tabIndex={0}
            className={"bgc-card" + (selected ? " is-selected" : "")}
            onClick={() => onBackground(id)}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onBackground(id)}
          >
            {colored ? (
              <div className="bgc-preview bgc-live">
                {onScreen.has(id) &&
                  (() => {
                    const Effect = EFFECTS[id];
                    return (
                      <LiveEffect>
                        <Effect color={color} />
                      </LiveEffect>
                    );
                  })()}
              </div>
            ) : (
              <span
                className={`bgc-preview settings-tile-preview bg-${id}${id === "grid" && gridMoving ? " is-moving" : ""}`}
              />
            )}
            <span className="bgc-shade" />
            {selected && (
              <span className="bgc-check">
                <Check size={13} strokeWidth={2.5} />
              </span>
            )}
            <span className="bgc-name">{label}</span>

            <div className="bgc-controls" onClick={(e) => e.stopPropagation()}>
              {colored ? (
                <button
                  ref={paletteFor === id ? buttonRef : undefined}
                  className={"bgc-toggle bgc-hex" + (paletteFor === id ? " is-open" : "")}
                  aria-label={`${label} color`}
                  aria-expanded={paletteFor === id}
                  onClick={() => setPaletteFor((open) => (open === id ? null : id))}
                >
                  <span className="bgc-hex-swatch" style={{ background: color }} />
                  <span className="bgc-hex-code">{color.toUpperCase()}</span>
                </button>
              ) : (
                <button
                  className={"bgc-toggle" + (gridMoving ? " is-on" : "")}
                  role="switch"
                  aria-checked={gridMoving}
                  onClick={() => onGridMoving(!gridMoving)}
                >
                  <span>Moving</span>
                  <span className="bgc-switch" />
                </button>
              )}
            </div>

            {colored && paletteFor === id && (
              <div className="bgc-palette" ref={paletteRef} onClick={(e) => e.stopPropagation()}>
                <span className="bgc-palette-title">{label} color</span>
                <div className="bgc-swatches">
                  {COLOR_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      className={"bgc-swatch" + (color === preset ? " is-selected" : "")}
                      style={{ background: preset }}
                      aria-label={preset}
                      onClick={() => onColor(id, preset)}
                    />
                  ))}
                  <label
                    className={"bgc-swatch bgc-swatch-custom" + (custom ? " is-selected" : "")}
                    title="Pick any color"
                    style={{ background: custom ? color : undefined }}
                  >
                    <input type="color" value={color} onChange={(e) => onColor(id, e.target.value)} />
                    {!custom && <span>+</span>}
                  </label>
                </div>
                <input
                  className="settings-hue bgc-hue"
                  type="range"
                  min={0}
                  max={359}
                  step={1}
                  value={Math.round(hexToHue(color))}
                  aria-label={`${label} hue`}
                  onChange={(e) => onColor(id, hueToHex(Number(e.target.value)))}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default BackgroundCards;
