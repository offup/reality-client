import { useEffect, useRef, type ReactNode } from "react";

/**
 * Wraps a WebGL background. When it really leaves the page, its graphics contexts are handed back
 * right away instead of waiting for garbage collection; the browser only allows a handful of live
 * contexts, and with several previews they would otherwise run out (white card with a sad face).
 *
 * React's dev mode unmounts and remounts effects in place; those canvases stay in the document,
 * so they are skipped (releasing them would kill a canvas that is still being shown).
 */
function LiveEffect({ children }: { children: ReactNode }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = host.current;
    return () => {
      const canvases = element ? Array.from(element.querySelectorAll("canvas")) : [];
      window.setTimeout(() => {
        for (const canvas of canvases) {
          if (canvas.isConnected) continue;
          const gl =
            (canvas.getContext("webgl2") as WebGL2RenderingContext | null) ??
            (canvas.getContext("webgl") as WebGLRenderingContext | null);
          gl?.getExtension("WEBGL_lose_context")?.loseContext();
        }
      }, 0);
    };
  }, []);

  return (
    <div ref={host} className="effect-host">
      {children}
    </div>
  );
}

export default LiveEffect;
