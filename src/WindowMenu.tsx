import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Square, X } from "lucide-react";
import "./WindowMenu.css";

const appWindow = getCurrentWindow();

// Corner notch top right: minimize, maximize/restore (taskbar stays visible), close
function WindowMenu() {
  const [maximized, setMaximized] = useState(false);

  // Keep the icon in sync, also when Windows maximizes/restores the window (Win+↑/↓, snapping)
  useEffect(() => {
    void appWindow.isMaximized().then(setMaximized);
    const unlisten = appWindow.onResized(() => void appWindow.isMaximized().then(setMaximized));
    return () => void unlisten.then((fn) => fn());
  }, []);

  return (
    <div className="window-notch" onMouseDown={(e) => e.stopPropagation()}>
      <div className="window-notch-inner">
        <button aria-label="Minimize" onClick={() => void appWindow.minimize()}>
          <Minus size={18} strokeWidth={1.75} />
        </button>
        <button aria-label={maximized ? "Restore" : "Maximize"} onClick={() => void appWindow.toggleMaximize()}>
          {maximized ? (
            <Copy size={15} strokeWidth={1.75} style={{ transform: "scaleX(-1)" }} />
          ) : (
            <Square size={15} strokeWidth={1.75} />
          )}
        </button>
        <button aria-label="Close" className="is-close" onClick={() => void appWindow.close()}>
          <X size={18} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
}

export default WindowMenu;
