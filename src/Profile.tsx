import { useEffect, useRef, useState } from "react";
import { Check, Upload } from "lucide-react";
import SkinView from "./SkinView";
import type { Account } from "./auth";
import { SIGN_IN_AGAIN } from "./launcher";
import { dataUrlBase64, fileBase64, profileDetails, setCape, uploadSkin, type CapeInfo } from "./skins";
import "./Profile.css";

type Props = {
  account: Account | null;
  onAccount: (account: Account) => void;
};

function friendly(error: unknown): string {
  const text = String(error);
  return text.includes(SIGN_IN_AGAIN) ? "Your sign-in has expired. Remove the account and add it again." : text;
}

// Capes are remembered per account so the page shows them at once; Minecraft is asked quietly after
const capesKey = (uuid: string) => `reality.capes.${uuid}`;

function loadCapes(uuid: string | undefined): CapeInfo[] | null {
  if (!uuid) return null;
  try {
    const raw = localStorage.getItem(capesKey(uuid));
    return raw ? (JSON.parse(raw) as CapeInfo[]) : null;
  } catch {
    return null;
  }
}

function saveCapes(uuid: string, capes: CapeInfo[]) {
  try {
    localStorage.setItem(capesKey(uuid), JSON.stringify(capes));
  } catch {
    // storage full or blocked: the page still works, it just loads again next time
  }
}

// The face (plus hat layer) of a skin, drawn pixel-sharp
function Face({ skin, size }: { skin: string; size: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = canvas.current;
    if (!el || !skin) return;
    const img = new Image();
    img.onload = () => {
      const g = el.getContext("2d");
      if (!g) return;
      g.imageSmoothingEnabled = false;
      g.clearRect(0, 0, 8, 8);
      g.drawImage(img, 8, 8, 8, 8, 0, 0, 8, 8);
      g.drawImage(img, 40, 8, 8, 8, 0, 0, 8, 8);
    };
    img.src = skin;
  }, [skin]);
  return <canvas ref={canvas} className="profile-face" width={8} height={8} style={{ width: size, height: size }} />;
}

// The front of a cape (10×16 at 1,1 of the 64×32 texture), scaled up pixel-sharp
function CapeArt({ texture }: { texture: string | null }) {
  if (!texture) return <span className="profile-cape-art is-none" />;
  return <span className="profile-cape-art" style={{ backgroundImage: `url(${texture})` }} />;
}

// Profile: the player on the left; on the right a skin bar (face, name, model, upload)
// and the capes as a list. A PNG dropped anywhere on the page becomes the new skin.
// Changes show at once; Minecraft is updated in the background. Only a failed change says
// something, and then the old look comes back.
function Profile({ account, onAccount }: Props) {
  const [capes, setCapes] = useState<CapeInfo[] | null>(() => loadCapes(account?.uuid));
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  // Only the answer to the newest change counts, older ones may arrive later
  const latest = useRef(0);

  // Show the remembered capes right away and refresh skin and capes quietly
  useEffect(() => {
    if (!account) return;
    let alive = true;
    setCapes(loadCapes(account.uuid));
    setError(null);
    const request = latest.current;
    profileDetails(account.uuid)
      .then((details) => {
        if (!alive || request !== latest.current) return;
        setCapes(details.capes);
        saveCapes(account.uuid, details.capes);
        onAccount(details.account);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [account?.uuid]);

  // A failure note goes away by itself
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(timer);
  }, [error]);

  if (!account) {
    return (
      <div className="profile-empty">
        <Face skin="/skins/guest.png" size={56} />
        <span className="profile-empty-title">No account</span>
        <span className="profile-empty-text">Sign in with the box left of Launch to change your skin and cape.</span>
      </div>
    );
  }

  /** Shows the new look now, sends it, and goes back to the old look if Minecraft says no */
  async function change(look: Account, lookCapes: CapeInfo[] | null, action: () => Promise<{ account: Account; capes: CapeInfo[] }>) {
    if (!account) return;
    const before = { account, capes };
    const request = ++latest.current;
    setError(null);
    onAccount(look);
    if (lookCapes) setCapes(lookCapes);
    try {
      const details = await action();
      if (request !== latest.current) return;
      setCapes(details.capes);
      saveCapes(details.account.uuid, details.capes);
      onAccount(details.account);
    } catch (e) {
      if (request !== latest.current) return;
      onAccount(before.account);
      setCapes(before.capes);
      setError(friendly(e));
    }
  }

  async function onFile(file: File | undefined) {
    if (!file || !account) return;
    if (file.type && file.type !== "image/png") {
      setError("A skin has to be a PNG file");
      return;
    }
    const png = await fileBase64(file);
    const slim = account.model === "slim";
    void change({ ...account, skin: `data:image/png;base64,${png}` }, null, () => uploadSkin(account.uuid, png, slim));
  }

  // The arm width only changes by uploading the current skin again with the other model
  function setModel(slim: boolean) {
    if (!account || (account.model === "slim") === slim || !account.skin.startsWith("data:")) return;
    const png = dataUrlBase64(account.skin);
    void change({ ...account, model: slim ? "slim" : "default" }, null, () => uploadSkin(account.uuid, png, slim));
  }

  function chooseCape(id: string | null) {
    if (!account || capes === null) return;
    if ((capes.find((c) => c.active)?.id ?? null) === id) return;
    const next = capes.map((c) => ({ ...c, active: c.id === id }));
    const texture = next.find((c) => c.active)?.texture ?? null;
    void change({ ...account, cape: texture }, next, () => setCape(account.uuid, id));
  }

  const slim = account.model === "slim";
  const activeId = capes?.find((c) => c.active)?.id ?? null;
  const rows: { id: string | null; name: string; texture: string | null }[] = capes
    ? [{ id: null, name: "No cape", texture: null }, ...capes.map((c) => ({ id: c.id, name: c.name, texture: c.texture }))]
    : [];

  return (
    <div
      className={"profile" + (dragging ? " is-dragging" : "")}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void onFile(e.dataTransfer.files[0]);
      }}
    >
      <div className="profile-stage">
        <div className="profile-floor" />
        <SkinView skin={account.skin} cape={account.cape ?? undefined} model={account.model} width={360} height={470} />
        {dragging && (
          <div className="profile-dropping">
            <Upload size={22} strokeWidth={2} />
            <span>Drop to use this skin</span>
          </div>
        )}
      </div>

      <div className="profile-side">
        <header className="profile-bar">
          <div className="profile-who">
            <Face skin={account.skin} size={40} />
            <div className="profile-who-text">
              <span className="profile-name">{account.name}</span>
              <span className="profile-sub">Drop a PNG anywhere here · 64×64</span>
            </div>
          </div>
          <div className="profile-bar-actions">
            <div className="profile-segments" role="radiogroup" aria-label="Arm width">
              <button role="radio" aria-checked={!slim} className={!slim ? "is-active" : ""} onClick={() => setModel(false)}>
                Classic
              </button>
              <button role="radio" aria-checked={slim} className={slim ? "is-active" : ""} onClick={() => setModel(true)}>
                Slim
              </button>
            </div>
            <button className="profile-upload" onClick={() => fileInput.current?.click()}>
              <Upload size={15} strokeWidth={2.2} />
              <span>Upload</span>
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="image/png"
              hidden
              onChange={(e) => {
                void onFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>
        </header>

        <section className="profile-list">
          {rows.map((row) => {
                const active = row.id === activeId;
                return (
                  <button
                    key={row.id ?? "none"}
                    className={"profile-row" + (active ? " is-active" : "")}
                   
                    onClick={() => chooseCape(row.id)}
                  >
                    <CapeArt texture={row.texture} />
                    <span className="profile-row-text">
                      <span className="profile-row-name">{row.name}</span>
                      <span className="profile-row-sub">{active ? "Shown in game" : row.id ? "Owned" : "Nothing on your back"}</span>
                    </span>
                    <span className={"profile-row-action" + (active ? " is-active" : "")}>
                      {active ? (
                        <>
                          <Check size={13} strokeWidth={3} />
                          Active
                        </>
                      ) : (
                        "Equip"
                      )}
                    </span>
                  </button>
            );
          })}
          {capes !== null && capes.length === 0 && <span className="profile-list-empty">This account owns no capes yet.</span>}
        </section>

        {error && <div className="profile-toast is-error">{error}</div>}
      </div>
    </div>
  );
}

export default Profile;
