import { useEffect, useRef, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { ArrowDownToLine } from "lucide-react";
import "./UpdateNotice.css";

const FIRST_CHECK_MS = 4000;
const CHECK_EVERY_MS = 30 * 60 * 1000;

type State =
  | { kind: "none" }
  | { kind: "available"; update: Update }
  | { kind: "downloading"; version: string; progress: number | null }
  | { kind: "installing"; version: string }
  | { kind: "error"; update: Update; message: string };

// Top left: shows up only when GitHub has a newer signed release. One click downloads, installs, restarts.
function UpdateNotice() {
  const [state, setState] = useState<State>({ kind: "none" });
  const busy = useRef(false);

  useEffect(() => {
    let alive = true;
    const look = async () => {
      if (busy.current) return;
      try {
        const update = await check();
        if (alive && update) setState((s) => (s.kind === "none" ? { kind: "available", update } : s));
      } catch {
        // offline or no release yet: stay quiet, try again later
      }
    };
    const first = window.setTimeout(look, FIRST_CHECK_MS);
    const every = window.setInterval(look, CHECK_EVERY_MS);
    return () => {
      alive = false;
      window.clearTimeout(first);
      window.clearInterval(every);
    };
  }, []);

  async function install(update: Update) {
    if (busy.current) return;
    busy.current = true;
    let total = 0;
    let received = 0;
    setState({ kind: "downloading", version: update.version, progress: null });
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data.contentLength ?? 0;
        if (event.event === "Progress") {
          received += event.data.chunkLength;
          setState({ kind: "downloading", version: update.version, progress: total ? received / total : null });
        }
        if (event.event === "Finished") setState({ kind: "installing", version: update.version });
      });
      await relaunch();
    } catch (e) {
      busy.current = false;
      setState({ kind: "error", update, message: String(e) });
    }
  }

  if (state.kind === "none") return null;

  let title = "";
  let sub = "";
  let progress: number | null = null;
  switch (state.kind) {
    case "available":
      title = `Update ${state.update.version}`;
      sub = "Click to install";
      break;
    case "downloading":
      title = `Update ${state.version}`;
      progress = state.progress;
      sub = progress === null ? "Downloading…" : `Downloading ${Math.floor(progress * 100)}%`;
      break;
    case "installing":
      title = `Update ${state.version}`;
      sub = "Installing, restarting…";
      break;
    case "error":
      title = "Update failed";
      sub = "Click to try again";
      break;
  }
  const clickable = state.kind === "available" || state.kind === "error";

  return (
    <button
      className={"update-notice" + (clickable ? "" : " is-busy") + (state.kind === "error" ? " is-error" : "")}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={() => clickable && void install(state.update)}
      title={state.kind === "error" ? state.message : undefined}
      disabled={!clickable}
    >
      <span className="update-notice-icon">
        <ArrowDownToLine size={18} strokeWidth={2} />
      </span>
      <span className="update-notice-text">
        <span className="update-notice-title">{title}</span>
        <span className="update-notice-sub">{sub}</span>
      </span>
      {(state.kind === "downloading" || state.kind === "installing") && (
        <span className={"update-notice-bar" + (progress === null ? " is-waiting" : "")}>
          <span style={progress === null ? undefined : { transform: `scaleX(${progress})` }} />
        </span>
      )}
    </button>
  );
}

export default UpdateNotice;
