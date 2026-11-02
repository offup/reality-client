import { useEffect, useMemo, useRef, useState } from "react";
import { FolderOpen, Pencil, Plus, Trash2, X } from "lucide-react";
import { openInstanceFolder } from "./launcher";
import { newInstanceId, playedAgo, type Instance } from "./instanceData";
import { InstanceCover, InstanceIcon } from "./instanceArt";
import "./Instances.css";

type Props = {
  instances: Instance[];
  activeId: string | null;
  versions: string[];
  /** A game is starting or running: playing and deleting are blocked then */
  running: boolean;
  onSelect: (id: string) => void;
  onCreate: (name: string, version: string, id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => Promise<void>;
  onPlay: (id: string) => void;
};

const CONFIRM_MS = 3000;

// Instances: the selected one big on the left (pixel cover, Play), all of them as a list on the right
function Instances({ instances, activeId, versions, running, onSelect, onCreate, onRename, onDelete, onPlay }: Props) {
  const selected = instances.find((i) => i.id === activeId) ?? instances[0] ?? null;
  const [creating, setCreating] = useState(instances.length === 0);
  const [draftId, setDraftId] = useState(newInstanceId);
  const [name, setName] = useState("");
  const [version, setVersion] = useState(versions[0] ?? "");
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");
  const confirmTimer = useRef<number | undefined>(undefined);

  // Versions arrive a moment after start; preselect the newest
  useEffect(() => {
    if (!version && versions[0]) setVersion(versions[0]);
  }, [versions, version]);

  useEffect(() => () => window.clearTimeout(confirmTimer.current), []);

  // Leaving rename / delete confirmation when another instance gets selected
  useEffect(() => {
    setRenaming(false);
    setConfirmDelete(false);
  }, [activeId]);

  function startCreate() {
    setDraftId(newInstanceId());
    setName("");
    setVersion(versions[0] ?? "");
    setCreating(true);
  }

  function create() {
    if (!version) return;
    onCreate(name, version, draftId);
    setCreating(false);
  }

  // First click arms the button, the second one (within 3 s) deletes
  async function handleDelete() {
    if (!selected) return;
    window.clearTimeout(confirmTimer.current);
    if (!confirmDelete) {
      setConfirmDelete(true);
      confirmTimer.current = window.setTimeout(() => setConfirmDelete(false), CONFIRM_MS);
      return;
    }
    setConfirmDelete(false);
    try {
      setError("");
      await onDelete(selected.id);
    } catch (e) {
      setError(String(e));
    }
  }

  const placeholder = version ? `Fabric ${version}` : "Name";
  const shownVersions = useMemo(() => versions.slice(0, 15), [versions]);

  const createHero = (
    <section className="inst-hero">
      <div className="inst-cover">
        <InstanceCover id={draftId} />
        <div className="inst-cover-shade" />
        <div className="inst-cover-text">
          <span className="inst-chip">New instance</span>
          <input
            className="inst-name-input"
            value={name}
            maxLength={32}
            placeholder={placeholder}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
            autoFocus
          />
        </div>
        {instances.length > 0 && (
          <button className="inst-cover-close" aria-label="Cancel" onClick={() => setCreating(false)}>
            <X size={18} strokeWidth={2} />
          </button>
        )}
      </div>
      <div className="inst-versions">
        {shownVersions.length === 0 && <span className="inst-muted">Loading versions…</span>}
        {shownVersions.map((v) => (
          <button key={v} className={"inst-version" + (v === version ? " is-active" : "")} onClick={() => setVersion(v)}>
            {v}
          </button>
        ))}
      </div>
      <div className="inst-bar">
        <button className="inst-play" onClick={create} disabled={!version}>
          <span className="inst-play-title">Create</span>
          <span className="inst-play-sub">Fabric {version}</span>
        </button>
      </div>
    </section>
  );

  const selectedHero = selected && (
    <section className="inst-hero">
      <div className="inst-cover">
        <InstanceCover id={selected.id} />
        <div className="inst-cover-shade" />
        <div className="inst-cover-text">
          <span className="inst-chip">Fabric {selected.version}</span>
          {renaming ? (
            <input
              className="inst-name-input"
              defaultValue={selected.name}
              maxLength={32}
              autoFocus
              onBlur={(e) => {
                if (e.target.value.trim()) onRename(selected.id, e.target.value.trim());
                setRenaming(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") setRenaming(false);
              }}
            />
          ) : (
            <h3 className="inst-name" onDoubleClick={() => setRenaming(true)}>
              {selected.name}
            </h3>
          )}
          <span className="inst-played">{playedAgo(selected.lastPlayed)}</span>
        </div>
      </div>
      <div className="inst-bar">
        <button className="inst-play" onClick={() => onPlay(selected.id)} disabled={running}>
          <span className="inst-play-title">{running ? "Running" : "Play"}</span>
          <span className="inst-play-sub">{selected.version}</span>
        </button>
        <button className="inst-tool" title="Open folder" onClick={() => void openInstanceFolder(selected.id)}>
          <FolderOpen size={18} strokeWidth={1.75} />
        </button>
        <button className="inst-tool" title="Rename" onClick={() => setRenaming(true)}>
          <Pencil size={17} strokeWidth={1.75} />
        </button>
        <button
          className={"inst-tool inst-delete" + (confirmDelete ? " is-armed" : "")}
          title={running ? "Close Minecraft first" : "Delete"}
          disabled={running}
          onClick={() => void handleDelete()}
        >
          {confirmDelete ? <span>Delete?</span> : <Trash2 size={17} strokeWidth={1.75} />}
        </button>
      </div>
      {error && <div className="inst-error">{error}</div>}
    </section>
  );

  return (
    <div className="instances" onMouseDown={(e) => e.stopPropagation()}>
      {creating || !selected ? createHero : selectedHero}

      <aside className="inst-side">
        <div className="inst-side-head">
          <span>Instances</span>
          <span className="inst-count">{instances.length}</span>
        </div>
        <div className="inst-list">
          {instances.map((i) => (
            <button
              key={i.id}
              className={"inst-row" + (!creating && i.id === selected?.id ? " is-active" : "")}
              onClick={() => {
                setCreating(false);
                onSelect(i.id);
              }}
            >
              <InstanceIcon id={i.id} size={36} />
              <span className="inst-row-text">
                <span className="inst-row-name">{i.name}</span>
                <span className="inst-row-version">Fabric {i.version}</span>
              </span>
            </button>
          ))}
        </div>
        <button className={"inst-new" + (creating ? " is-active" : "")} onClick={startCreate}>
          <Plus size={16} strokeWidth={2} />
          <span>New instance</span>
        </button>
      </aside>
    </div>
  );
}

export default Instances;
