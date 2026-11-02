import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Plus, Unlink } from "lucide-react";
import PentagonSmile from "./icons/PentagonSmile";
import PackageBox from "./icons/PackageBox";
import Bell from "./icons/Bell";
import HexagonSlash from "./icons/HexagonSlash";
import MicrosoftLogo from "./icons/MicrosoftLogo";
import Face from "./Face";
import {
  cancelMicrosoftLogin,
  startMicrosoftLogin,
  type Account,
} from "./auth";
import { SIGN_IN_AGAIN, type LaunchStatus } from "./launcher";
import type { Instance } from "./instanceData";
import "./Dock.css";

export type View = "home" | "instances" | "notifications" | "settings";

type NavItem = { id: View; label: string; Icon: typeof PentagonSmile };

const left: NavItem[] = [
  { id: "home", label: "Home", Icon: PentagonSmile },
  { id: "instances", label: "Instances", Icon: PackageBox },
];
const right: NavItem[] = [
  { id: "notifications", label: "Notifications", Icon: Bell },
  { id: "settings", label: "Settings", Icon: HexagonSlash },
];

const UNDERLINE_WIDTH = 22;
const PANEL_CLOSE_MS = 170;

type LoginStatus =
  { kind: "idle" } | { kind: "waiting" } | { kind: "error"; message: string };
type PanelState = "closed" | "open" | "closing";
/** What the panel above the dock shows */
type PanelKind = "accounts" | "instances" | "message";

type Props = {
  view: View;
  onNavigate: (view: View) => void;
  accounts: Account[];
  activeId: string | null;
  onLogin: (account: Account) => void;
  onSelect: (uuid: string) => void;
  onLogout: (uuid: string) => void;
  instances: Instance[];
  instanceId: string | null;
  onSelectInstance: (id: string) => void;
  launch: LaunchStatus;
  onLaunch: () => void;
  onDismissError: () => void;
};

function Dock({
  view,
  onNavigate,
  accounts,
  activeId,
  onLogin,
  onSelect,
  onLogout,
  instances,
  instanceId,
  onSelectInstance,
  launch,
  onLaunch,
  onDismissError,
}: Props) {
  const active = view;
  const [panel, setPanel] = useState<PanelState>("closed");
  const [panelKind, setPanelKind] = useState<PanelKind>("accounts");
  // The error stays visible while the panel animates closed, even after the status is reset
  const [shownError, setShownError] = useState("");
  const [login, setLogin] = useState<LoginStatus>({ kind: "idle" });
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({});
  const nav = useRef<HTMLElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const [underlineX, setUnderlineX] = useState<number | null>(null);
  const current = accounts.find((a) => a.uuid === activeId) ?? null;
  const instance = instances.find((i) => i.id === instanceId) ?? null;

  // Keep the underline centered under the active button, even when the dock layout changes
  useLayoutEffect(() => {
    const update = () => {
      const el = buttons.current[active];
      if (el)
        setUnderlineX(el.offsetLeft + (el.offsetWidth - UNDERLINE_WIDTH) / 2);
    };
    update();
    const observer = new ResizeObserver(update);
    if (nav.current) observer.observe(nav.current);
    return () => observer.disconnect();
  }, [active]);

  // Panel opens at once, closes with a short animation before it unmounts
  function openPanel(kind: PanelKind) {
    window.clearTimeout(closeTimer.current);
    setPanelKind(kind);
    setPanel("open");
  }
  function togglePanel(kind: PanelKind) {
    if (panel === "open" && panelKind === kind) closePanel();
    else openPanel(kind);
  }
  function closePanel() {
    if (panelKind === "message") onDismissError();
    setPanel((p) => (p === "open" ? "closing" : p));
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(
      () => setPanel("closed"),
      PANEL_CLOSE_MS,
    );
  }
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  // A launch error opens the panel with the message
  useEffect(() => {
    if (launch.kind !== "error") return;
    setShownError(launch.message);
    openPanel("message");
  }, [launch]);

  // A click outside the dock closes the panel
  // (mousedown inside the dock never reaches here because the dock stops it)
  useEffect(() => {
    if (panel !== "open") return;
    document.addEventListener("mousedown", closePanel);
    return () => document.removeEventListener("mousedown", closePanel);
  }, [panel, panelKind]);

  const cancelledByUs = useRef(false);
  const resetTimer = useRef<number | undefined>(undefined);

  async function handleLogin() {
    window.clearTimeout(resetTimer.current);
    cancelledByUs.current = false;
    setLogin({ kind: "waiting" });
    try {
      const account = await startMicrosoftLogin();
      setLogin({ kind: "idle" });
      closePanel();
      onLogin(account);
    } catch (e) {
      // Cancelled via our own button: already back to idle, nothing to show
      if (cancelledByUs.current) return;
      const message = String(e);
      setLogin({ kind: "error", message });
      // Cancelled on Microsoft's page: show it briefly, then back to normal
      if (/cancell?ed/i.test(message)) {
        resetTimer.current = window.setTimeout(
          () => setLogin({ kind: "idle" }),
          3000,
        );
      }
    }
  }

  function handleCancel() {
    cancelledByUs.current = true;
    void cancelMicrosoftLogin();
    setLogin({ kind: "idle" });
  }

  useEffect(() => () => window.clearTimeout(resetTimer.current), []);

  // Without an account the Launch button opens the account panel instead
  function handleLaunchClick() {
    if (!current) openPanel("accounts");
    else if (!instance) onNavigate("instances");
    else onLaunch();
  }

  // "Sign in again" from the error message: switch to the account panel and start the sign-in
  function signInAgain() {
    onDismissError();
    setPanelKind("accounts");
    void handleLogin();
  }

  const item = ({ id, label, Icon }: NavItem) => (
    <button
      key={id}
      ref={(el) => {
        buttons.current[id] = el;
      }}
      className={"dock-item" + (active === id ? " is-active" : "")}
      aria-label={label}
      title={label}
      onClick={() => onNavigate(id)}
    >
      <span className="dock-icon">
        <Icon size={22} strokeWidth={1.75} />
      </span>
    </button>
  );

  // The "add" row, or its waiting / error state
  const addRow = () => {
    switch (login.kind) {
      case "waiting":
        return (
          <div className="dock-account-add-state">
            <div className="dock-login-status">
              <span className="dock-spinner" />
              <span>Browser opened, waiting for Microsoft…</span>
            </div>
            <button
              className="dock-login dock-login-ghost"
              onClick={handleCancel}
            >
              Cancel
            </button>
          </div>
        );
      case "error":
        return (
          <div className="dock-account-add-state">
            <div className="dock-login-status is-error">{login.message}</div>
            <button
              className="dock-login dock-login-ghost"
              onClick={handleLogin}
            >
              Try again
            </button>
          </div>
        );
      default:
        // Same button as the first login, just a different label once accounts exist
        return (
          <button className="dock-login" onClick={handleLogin}>
            <MicrosoftLogo size={14} />
            <span>{accounts.length === 0 ? "Login" : "Add account"}</span>
          </button>
        );
    }
  };

  // If the last row has a free slot, "Add account" takes it instead of its own row
  const addInGrid = login.kind === "idle" && accounts.length % 2 === 1;

  const accountsPanel = (
    <>
      {accounts.length > 0 && (
        <div className="dock-accounts">
          {accounts.map((a) => (
            <div
              key={a.uuid}
              className={
                "dock-account" + (a.uuid === activeId ? " is-active" : "")
              }
            >
              <button
                className="dock-account-main"
                onClick={() => {
                  onSelect(a.uuid);
                  closePanel();
                }}
              >
                <Face skin={a.skin} size={28} />
                <span className="dock-account-name">{a.name}</span>
                {a.uuid === activeId && (
                  <span className="dock-account-check">
                    <Check size={16} strokeWidth={2.25} />
                  </span>
                )}
              </button>
              <button
                className="dock-account-logout"
                aria-label={`Remove ${a.name}`}
                title="Remove account"
                onClick={() => onLogout(a.uuid)}
              >
                <Unlink size={15} strokeWidth={1.75} />
              </button>
            </div>
          ))}
          {addInGrid && (
            <button
              className="dock-login dock-account-add-cell"
              onClick={handleLogin}
            >
              <MicrosoftLogo size={14} />
              <span>Add account</span>
            </button>
          )}
        </div>
      )}
      {!addInGrid && addRow()}
    </>
  );

  const instancesPanel = (
    <>
      <div className="dock-instances">
        {instances.map((i) => (
          <button
            key={i.id}
            className={
              "dock-instance" + (i.id === instanceId ? " is-active" : "")
            }
            onClick={() => {
              onSelectInstance(i.id);
              closePanel();
            }}
          >
            <span className="dock-instance-name">{i.name}</span>
            <span className="dock-instance-version">Fabric {i.version}</span>
            {i.id === instanceId && (
              <span className="dock-account-check">
                <Check size={16} strokeWidth={2.25} />
              </span>
            )}
          </button>
        ))}
      </div>
      <button
        className="dock-login dock-login-ghost dock-instances-manage"
        onClick={() => {
          closePanel();
          onNavigate("instances");
        }}
      >
        Manage instances
      </button>
    </>
  );

  const signInAgainError = shownError === SIGN_IN_AGAIN;
  const messagePanel = (
    <div className="dock-account-add-state">
      <div className="dock-login-status is-error">
        {signInAgainError
          ? "Your sign-in has expired. Sign in again to play."
          : shownError}
      </div>
      {signInAgainError ? (
        <button className="dock-login dock-login-ghost" onClick={signInAgain}>
          <MicrosoftLogo size={14} />
          <span>Sign in again</span>
        </button>
      ) : (
        <button className="dock-login dock-login-ghost" onClick={closePanel}>
          OK
        </button>
      )}
    </div>
  );

  // Launch button: title + small line below, a progress bar while preparing
  const busy = launch.kind === "preparing" || launch.kind === "running";
  let title = "Launch";
  // The default name already contains the version, so it is not repeated
  let sub = !instance
    ? "Create an instance"
    : instance.name === `Fabric ${instance.version}`
      ? instance.name
      : `${instance.name} · ${instance.version}`;
  let progress: number | null = null;
  if (launch.kind === "preparing") {
    const { stage, done, total } = launch.progress;
    progress = total > 0 ? done / total : null;
    title = "Launching";
    sub = progress === null ? stage : `${stage} ${Math.floor(progress * 100)}%`;
  } else if (launch.kind === "running") {
    title = "Running";
  }

  // On pages with their own content (settings, instances) the page dims behind an open panel,
  // so the panel clearly stands out; clicking the dimmed area closes it
  const backdropHost =
    typeof document !== "undefined" ? document.querySelector(".app") : null;
  const backdrop =
    view !== "home" && panel !== "closed" && backdropHost
      ? createPortal(
          <div
            className={
              "dock-backdrop" + (panel === "closing" ? " is-closing" : "")
            }
            onMouseDown={(e) => {
              e.stopPropagation();
              closePanel();
            }}
          />,
          backdropHost,
        )
      : null;

  return (
    // Don't let mousedown bubble up, otherwise the window drag starts
    <>
      {backdrop}
      <nav ref={nav} className="dock" onMouseDown={(e) => e.stopPropagation()}>
        {panel !== "closed" && (
          <div
            className={
              "dock-popover" + (panel === "closing" ? " is-closing" : "")
            }
          >
            {panelKind === "accounts" && accountsPanel}
            {panelKind === "instances" && instancesPanel}
            {panelKind === "message" && messagePanel}
          </div>
        )}
        {underlineX !== null && (
          <span
            className="dock-underline"
            style={{ transform: `translateX(${underlineX}px)` }}
          />
        )}
        {left.map(item)}
        <div className="dock-launch">
          <button
            className={
              "dock-add-account" +
              (panel === "open" && panelKind === "accounts" ? " is-open" : "") +
              (current ? " has-account" : "")
            }
            aria-label={current ? `Account: ${current.name}` : "Add account"}
            title={current ? current.name : "Add account"}
            aria-expanded={panel === "open" && panelKind === "accounts"}
            onClick={() => togglePanel("accounts")}
          >
            <span className="dock-add-account-box">
              {current ? (
                <Face skin={current.skin} size={32} />
              ) : (
                <Plus size={18} strokeWidth={1.75} />
              )}
            </span>
          </button>
          <button
            className={"dock-launch-main" + (busy ? " is-busy" : "")}
            onClick={handleLaunchClick}
            disabled={busy}
          >
            <span className="dock-launch-title">{title}</span>
            <span className="dock-launch-sub">{sub}</span>
            {launch.kind === "preparing" && (
              <span
                className={
                  "dock-launch-progress" +
                  (progress === null ? " is-waiting" : "")
                }
              >
                <span
                  style={
                    progress === null
                      ? undefined
                      : { transform: `scaleX(${progress})` }
                  }
                />
              </span>
            )}
          </button>
          <button
            className={
              "dock-launch-arrow" +
              (panel === "open" && panelKind === "instances" ? " is-open" : "")
            }
            aria-label="Choose instance"
            title="Choose instance"
            disabled={busy}
            onClick={() => togglePanel("instances")}
          >
            <ChevronDown size={20} strokeWidth={2} />
          </button>
        </div>
        {right.map(item)}
      </nav>
    </>
  );
}

export default Dock;
