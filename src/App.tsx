import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import Dock, { type View } from "./Dock";
import SkinView from "./SkinView";
import WindowMenu from "./WindowMenu";
import UpdateNotice from "./UpdateNotice";
import Instances from "./Instances";
import { createInstance, type Instance } from "./instanceData";
import Settings, {
  DEFAULT_BACKGROUND,
  DEFAULT_EFFECT_COLOR,
  MEMORY_DEFAULT,
  MEMORY_MAX,
  MEMORY_MIN,
  COLORED_BACKGROUNDS,
  isBackgroundId,
  isColoredBackground,
  type BackgroundId,
  type ColoredId,
  type EffectColors,
} from "./Settings";
import { EFFECTS } from "./effects";
import LiveEffect from "./effects/LiveEffect";
import type { Account } from "./auth";
import {
  SIGN_IN_AGAIN,
  deleteInstanceFolder,
  forgetAccount,
  launchGame,
  listVersions,
  onGameExited,
  onLaunchProgress,
  type AfterLaunch,
  type LaunchStatus,
} from "./launcher";
import "./Background.css";

const appWindow = getCurrentWindow();
const STORAGE_KEY = "reality.accounts.v2";
const BACKGROUND_KEY = "reality.background";
const GRID_MOVING_KEY = "reality.gridMoving";
const EFFECT_COLOR_KEY = "reality.effectColor"; // old: one color for all, used as the start value
const EFFECT_COLORS_KEY = "reality.effectColors";
const INSTANCES_KEY = "reality.instances";
const MEMORY_KEY = "reality.memoryMb";
const AFTER_LAUNCH_KEY = "reality.afterLaunch";

// Without an account: guest skin, no name
const GUEST: Account = { uuid: "", name: "", skin: "/skins/guest.png", model: "default", cape: null };

type Stored = { accounts: Account[]; activeId: string | null };
type StoredInstances = { instances: Instance[]; activeId: string | null };

function loadInstances(): StoredInstances {
  try {
    const raw = read(INSTANCES_KEY);
    if (raw) return JSON.parse(raw) as StoredInstances;
  } catch {
    // broken data: start empty, a fresh instance gets created
  }
  return { instances: [], activeId: null };
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage unavailable: session only
  }
}

function loadStored(): Stored {
  try {
    const raw = read(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Stored;
  } catch {
    // broken data: start without an account
  }
  return { accounts: [], activeId: null };
}

function loadBackground(): BackgroundId {
  const raw = read(BACKGROUND_KEY);
  if (raw === "ferrofluid") return "ghostfibers"; // Ferrofluid was replaced by Ghost fibers
  return raw && isBackgroundId(raw) ? raw : DEFAULT_BACKGROUND;
}

// Any "#rrggbb" works (presets or the custom picker)
function loadEffectColors(): EffectColors {
  const isHex = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
  const old = read(EFFECT_COLOR_KEY);
  const fallback = isHex(old) ? old : DEFAULT_EFFECT_COLOR;
  let saved: Partial<Record<ColoredId, unknown>> = {};
  try {
    saved = JSON.parse(read(EFFECT_COLORS_KEY) ?? "{}");
  } catch {
    // broken data: start from the fallback
  }
  const colors = {} as EffectColors;
  for (const id of COLORED_BACKGROUNDS) {
    const value = saved[id];
    colors[id] = isHex(value) ? value : fallback;
  }
  return colors;
}

function loadNumber(key: string, min: number, max: number, fallback: number): number {
  const raw = Number(read(key) ?? fallback);
  return Number.isFinite(raw) && raw >= min && raw <= max ? raw : fallback;
}

/** Friendly text for errors coming back from the launcher */
function launchErrorText(error: unknown): string {
  const message = String(error);
  if (message.includes(SIGN_IN_AGAIN)) return SIGN_IN_AGAIN;
  return message;
}

function App() {
  const [view, setView] = useState<View>("home");
  const [background, setBackground] = useState<BackgroundId>(loadBackground);
  const [gridMoving, setGridMoving] = useState<boolean>(() => read(GRID_MOVING_KEY) === "1");
  const [effectColors, setEffectColors] = useState<EffectColors>(loadEffectColors);
  const [{ accounts, activeId }, setStored] = useState<Stored>(loadStored);
  const [versions, setVersions] = useState<string[]>([]);
  const [{ instances, activeId: instanceId }, setInstanceStore] = useState<StoredInstances>(loadInstances);
  const [memoryMb, setMemoryMb] = useState<number>(() =>
    loadNumber(MEMORY_KEY, MEMORY_MIN, MEMORY_MAX, MEMORY_DEFAULT),
  );
  const [afterLaunch, setAfterLaunch] = useState<AfterLaunch>(() =>
    read(AFTER_LAUNCH_KEY) === "minimize" ? "minimize" : "keep",
  );
  const [launch, setLaunch] = useState<LaunchStatus>({ kind: "idle" });
  const current = accounts.find((a) => a.uuid === activeId) ?? null;
  const player = current ?? GUEST;
  const instance = instances.find((i) => i.id === instanceId) ?? null;

  // Remember settings locally so they survive a restart (sign-in tokens live in the Rust side)
  useEffect(() => write(STORAGE_KEY, JSON.stringify({ accounts, activeId })), [accounts, activeId]);
  useEffect(() => write(BACKGROUND_KEY, background), [background]);
  useEffect(() => write(GRID_MOVING_KEY, gridMoving ? "1" : "0"), [gridMoving]);
  useEffect(() => write(EFFECT_COLORS_KEY, JSON.stringify(effectColors)), [effectColors]);
  useEffect(() => write(MEMORY_KEY, String(memoryMb)), [memoryMb]);
  useEffect(() => write(AFTER_LAUNCH_KEY, afterLaunch), [afterLaunch]);
  useEffect(() => write(INSTANCES_KEY, JSON.stringify({ instances, activeId: instanceId })), [instances, instanceId]);

  // Versions Fabric supports (26.x and newer); no instance is created automatically
  useEffect(() => {
    listVersions()
      .then(setVersions)
      .catch(() => {
        // offline: instances keep their saved versions
      });
  }, []);

  // Progress while preparing, and back to normal when the game closes
  useEffect(() => {
    const progress = onLaunchProgress((p) =>
      setLaunch((s) => (s.kind === "preparing" ? { kind: "preparing", progress: p } : s)),
    );
    const exited = onGameExited(({ early, code }) => {
      setLaunch(
        early
          ? {
              kind: "error",
              message: `Minecraft closed right after starting (code ${code ?? "?"}). The details are in launcher_output.log in the game folder.`,
            }
          : { kind: "idle" },
      );
      void appWindow.unminimize();
    });
    return () => {
      void progress.then((off) => off());
      void exited.then((off) => off());
    };
  }, []);

  /** Starts the given instance (default: the selected one) with the active account */
  async function startGame(target: Instance | null = instance) {
    if (!current || !target || launch.kind === "preparing" || launch.kind === "running") return;
    setLaunch({ kind: "preparing", progress: { stage: "Preparing", done: 0, total: 0 } });
    try {
      await launchGame({ uuid: current.uuid, instanceId: target.id, version: target.version, memoryMb });
      updateInstance(target.id, { lastPlayed: Date.now() });
      setLaunch({ kind: "running" });
      if (afterLaunch === "minimize") void appWindow.minimize();
    } catch (e) {
      setLaunch({ kind: "error", message: launchErrorText(e) });
    }
  }

  function addInstance(name: string, version: string, id?: string) {
    const created = createInstance(name, version, id);
    setInstanceStore((s) => ({ instances: [created, ...s.instances], activeId: created.id }));
  }

  function updateInstance(id: string, change: Partial<Instance>) {
    setInstanceStore((s) => ({ ...s, instances: s.instances.map((i) => (i.id === id ? { ...i, ...change } : i)) }));
  }

  function selectInstance(id: string) {
    setInstanceStore((s) => ({ ...s, activeId: id }));
  }

  /** Deletes the folder first; the instance only disappears from the list when that worked */
  async function removeInstance(id: string) {
    await deleteInstanceFolder(id);
    setInstanceStore((s) => {
      const left = s.instances.filter((i) => i.id !== id);
      return { instances: left, activeId: s.activeId === id ? (left[0]?.id ?? null) : s.activeId };
    });
  }

  function addAccount(account: Account) {
    setStored((s) => ({
      accounts: [...s.accounts.filter((a) => a.uuid !== account.uuid), account],
      activeId: account.uuid,
    }));
    // A fresh sign-in fixes a "sign in again" error
    setLaunch((s) => (s.kind === "error" && s.message === SIGN_IN_AGAIN ? { kind: "idle" } : s));
  }

  function selectAccount(uuid: string) {
    setStored((s) => ({ ...s, activeId: uuid }));
  }

  function logoutAccount(uuid: string) {
    void forgetAccount(uuid);
    setStored((s) => {
      const accounts = s.accounts.filter((a) => a.uuid !== uuid);
      const activeId = s.activeId === uuid ? (accounts[0]?.uuid ?? null) : s.activeId;
      return { accounts, activeId };
    });
  }

  // Hold the left mouse button anywhere in the window to move it.
  // Deliberately no data-tauri-drag-region, because double-click would maximize there.
  function onMouseDown(e: React.MouseEvent) {
    if (e.button === 0) appWindow.startDragging();
  }

  const showPlayer = view === "home";
  // In settings the background fades out, the cards show the previews instead
  const backgroundClass =
    `background bg-${background}` +
    (background === "grid" && gridMoving ? " is-moving" : "") +
    (view === "settings" || view === "instances" ? " is-hidden" : "");

  // The big animated background runs only where it can be seen: the settings play their own
  // small previews, and the instances page covers it
  const backgroundShown = view !== "settings" && view !== "instances";
  const MainEffect = backgroundShown && isColoredBackground(background) ? EFFECTS[background] : null;
  const mainColor = isColoredBackground(background) ? (effectColors[background] ?? DEFAULT_EFFECT_COLOR) : "";

  return (
    <main className="app" onMouseDown={onMouseDown}>
      <div className={backgroundClass}>
        {MainEffect && (
          <LiveEffect key={background}>
            <MainEffect color={mainColor} />
          </LiveEffect>
        )}
      </div>
      <div className={"player-stage" + (showPlayer ? "" : " is-hidden")}>
        <SkinView skin={player.skin} cape={player.cape ?? undefined} model={player.model} name={player.name} />
      </div>
      {view === "instances" && (
        <Instances
          instances={instances}
          activeId={instanceId}
          versions={versions}
          running={launch.kind === "preparing" || launch.kind === "running"}
          onSelect={selectInstance}
          onCreate={addInstance}
          onRename={(id, name) => updateInstance(id, { name })}
          onDelete={removeInstance}
          onPlay={(id) => {
            selectInstance(id);
            setView("home");
            void startGame(instances.find((i) => i.id === id) ?? null);
          }}
        />
      )}
      {view === "settings" && (
        <Settings
          background={background}
          onBackground={setBackground}
          gridMoving={gridMoving}
          onGridMoving={setGridMoving}
          colors={effectColors}
          onColor={(id, color) => setEffectColors((c) => ({ ...c, [id]: color }))}
          memoryMb={memoryMb}
          onMemoryMb={setMemoryMb}
          afterLaunch={afterLaunch}
          onAfterLaunch={setAfterLaunch}
        />
      )}
      <UpdateNotice />
      <WindowMenu />
      <Dock
        view={view}
        onNavigate={setView}
        accounts={accounts}
        activeId={activeId}
        onLogin={addAccount}
        onSelect={selectAccount}
        onLogout={logoutAccount}
        instances={instances}
        instanceId={instanceId}
        onSelectInstance={selectInstance}
        launch={launch}
        onLaunch={() => void startGame()}
        onDismissError={() => setLaunch({ kind: "idle" })}
      />
    </main>
  );
}

export default App;
