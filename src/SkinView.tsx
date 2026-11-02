import { useEffect, useRef, useState } from "react";
import { IdleAnimation, SkinViewer, type PlayerObject } from "skinview3d";
import "./SkinView.css";

// Rest pose: slightly turned so the cape edge shows on the right
const REST_ROTATION = -0.55;
const SWAP_MS = 220;

// Idle animation plus: cape hangs a bit off the back, legs and arms dangle like floating
// (the body itself stays in place)
class FloatAnimation extends IdleAnimation {
  protected override animate(player: PlayerObject): void {
    super.animate(player);
    const t = this.progress * 1.3;
    const { leftArm, rightArm, leftLeg, rightLeg } = player.skin;
    player.cape.rotation.x += 0.07;
    // Legs swing against each other
    leftLeg.rotation.x = Math.sin(t) * 0.1;
    rightLeg.rotation.x = Math.sin(t + Math.PI) * 0.1;
    // Arms: held slightly forward, swing against the legs a bit slower,
    // plus a slow outward "breathing" so it doesn't look mechanical
    const sway = 0.07;
    const breathe = Math.sin(t * 0.55) * 0.03;
    leftArm.rotation.x = 0.1 + Math.sin(t * 0.85 + Math.PI) * sway;
    rightArm.rotation.x = 0.1 + Math.sin(t * 0.85) * sway;
    leftArm.rotation.z += 0.05 + breathe;
    rightArm.rotation.z -= 0.05 + breathe;
  }
}

type Props = {
  skin: string;
  cape?: string;
  name?: string;
  model?: "default" | "slim";
  width?: number;
  height?: number;
};

// 3D player with skin and cape, rotates left/right only, eases back after release.
// Skin changes fade out, swap and fade back in instead of popping.
function SkinView({ skin, cape, name, model = "default", width = 420, height = 560 }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const viewerRef = useRef<SkinViewer | null>(null);
  const [swapping, setSwapping] = useState(false);
  const [shownName, setShownName] = useState(name);
  const firstLoad = useRef(true);

  // Create the viewer once; pose, lights and drag handling live here
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const viewer = new SkinViewer({ canvas: el, width, height });
    viewerRef.current = viewer;
    viewer.animation = new FloatAnimation();
    // Model height ≈ canvas height × zoom, keeps some air above and below
    viewer.zoom = 0.78;
    // Built-in camera controls off, we only turn the model around its vertical axis
    viewer.controls.enabled = false;
    const wrapper = viewer.playerWrapper;
    wrapper.rotation.y = REST_ROTATION;
    // Legs slightly apart
    viewer.playerObject.skin.leftLeg.rotation.z = 0.1;
    viewer.playerObject.skin.rightLeg.rotation.z = -0.1;

    // Drag: only the mouse's X movement counts. Release: ease back to the rest pose.
    let dragging = false;
    let lastX = 0;
    let frame = 0;

    const RETURN_MS = 1100;
    // ease in, ease out
    const easeOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
    const returnToRest = () => {
      // Shortest way back: drop full turns, otherwise it would unwind all of them
      const twoPi = Math.PI * 2;
      let diff = (wrapper.rotation.y - REST_ROTATION) % twoPi;
      if (diff > Math.PI) diff -= twoPi;
      if (diff < -Math.PI) diff += twoPi;
      wrapper.rotation.y = REST_ROTATION + diff; // same angle, just without the turns
      const from = wrapper.rotation.y;
      const start = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / RETURN_MS);
        wrapper.rotation.y = from + (REST_ROTATION - from) * easeOut(t);
        if (t < 1) frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      e.stopPropagation(); // otherwise Tauri drags the window
      cancelAnimationFrame(frame);
      dragging = true;
      lastX = e.clientX;
      el.setPointerCapture(e.pointerId);
      el.classList.add("is-dragging");
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      wrapper.rotation.y += (e.clientX - lastX) * 0.012;
      lastX = e.clientX;
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      el.classList.remove("is-dragging");
      returnToRest();
    };
    const stop = (e: Event) => e.stopPropagation();

    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("mousedown", stop); // keep the app root's React handler out of it

    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("mousedown", stop);
      viewer.dispose();
      viewerRef.current = null;
    };
  }, [width, height]);

  // Skin / cape / model change: fade out, load the new textures, fade back in
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    let cancelled = false;
    const load = async () => {
      await viewer.loadSkin(skin, { model });
      if (cancelled) return;
      if (cape) await viewer.loadCape(cape);
      else viewer.loadCape(null);
    };
    if (firstLoad.current) {
      firstLoad.current = false;
      setShownName(name);
      void load();
      return;
    }
    setSwapping(true);
    const timer = window.setTimeout(async () => {
      await load();
      if (cancelled) return;
      setShownName(name);
      setSwapping(false);
    }, SWAP_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [skin, cape, model, name]);

  return (
    <div className={"skin-view" + (swapping ? " is-swapping" : "")} style={{ width, height }}>
      {shownName && <div className="skin-name">{shownName}</div>}
      <canvas ref={canvas} width={width} height={height} />
    </div>
  );
}

export default SkinView;
