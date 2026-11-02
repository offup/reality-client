//! Starting Minecraft with Fabric.
//!
//! 1. Fresh Minecraft session from the stored Microsoft refresh token
//! 2. Version file from Mojang, Fabric loader profile from meta.fabricmc.net
//! 3. Java runtime from Mojang (the exact one the version asks for)
//! 4. Client jar, libraries, assets, logging config (only what is missing gets downloaded)
//! 5. Build the command line and start the game; the frontend hears about progress and exit via events
//!
//! Everything lives in the app data folder: shared files (runtime, libraries, assets, versions)
//! next to the game folder "minecraft" (saves, mods, options).

use crate::auth::{self, TokenStore};
use futures::stream::{self, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha1::{Digest, Sha1};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

const VERSION_MANIFEST: &str = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
const JAVA_MANIFEST: &str = "https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json";
const FABRIC_META: &str = "https://meta.fabricmc.net/v2";
const ASSET_BASE: &str = "https://resources.download.minecraft.net";
const PARALLEL_DOWNLOADS: usize = 16;
const LAUNCHER_NAME: &str = "reality-client";
const LAUNCHER_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Default)]
pub struct LaunchState {
    pub running: Arc<AtomicBool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchOptions {
    pub uuid: String,
    /// The instance whose folder the game runs in
    pub instance_id: String,
    pub version: String,
    pub memory_mb: u32,
}

#[derive(Serialize, Clone)]
struct ProgressEvent {
    stage: String,
    done: u64,
    total: u64,
}

#[derive(Serialize, Clone)]
struct ExitEvent {
    code: Option<i32>,
    /// Exited within the first seconds: almost certainly a crash on start
    early: bool,
}

// ---------------------------------------------------------------- folders

pub fn data_root(app: &AppHandle) -> Result<PathBuf, String> {
    real_path(&app.path().app_data_dir().map_err(|e| e.to_string())?)
}

/// The folder as Windows really stores it. When the launcher itself runs inside a packaged app
/// (e.g. started from a dev tool), AppData is silently redirected; Java would then see the jars under
/// another path than the one on the class path, and Fabric refuses to load ("target class loader").
fn real_path(path: &Path) -> Result<PathBuf, String> {
    fs::create_dir_all(path).map_err(|e| e.to_string())?;
    let canonical = fs::canonicalize(path).map_err(|e| e.to_string())?;
    let text = canonical.to_string_lossy();
    // canonicalize returns "\\?\C:\..."; plain "C:\..." is what Java expects
    Ok(match text.strip_prefix(r"\\?\") {
        Some(rest) if !rest.starts_with("UNC") => PathBuf::from(rest),
        _ => canonical,
    })
}

/// Paths from Mojang/Fabric use "/"; keep everything in Windows form so every tool sees the same string
fn native(rel: &str) -> String {
    rel.replace('/', "\\")
}

/// Every instance has its own game folder (saves, mods, options); runtime, libraries and assets are shared
pub fn instance_dir(app: &AppHandle, instance_id: &str) -> Result<PathBuf, String> {
    let valid = !instance_id.is_empty()
        && instance_id.len() <= 64
        && instance_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-');
    if !valid {
        return Err("Invalid instance".into());
    }
    Ok(data_root(app)?.join("instances").join(instance_id))
}

/// Deletes an instance folder with everything in it (worlds, mods, settings)
pub fn delete_instance(app: &AppHandle, instance_id: &str) -> Result<(), String> {
    let dir = instance_dir(app, instance_id)?;
    if dir.exists() {
        fs::remove_dir_all(&dir)
            .map_err(|e| format!("Could not delete the instance folder: {e}"))?;
    }
    Ok(())
}

// ---------------------------------------------------------------- progress

/// Sends "launch-progress" events, at most every 80 ms so the UI is not flooded
struct Reporter {
    send: Box<dyn Fn(ProgressEvent) + Send + Sync>,
    stage: Mutex<String>,
    done: AtomicU64,
    total: AtomicU64,
    last: Mutex<Instant>,
}

impl Reporter {
    fn new(app: AppHandle) -> Self {
        Self::with(Box::new(move |event| {
            let _ = app.emit("launch-progress", event);
        }))
    }

    fn with(send: Box<dyn Fn(ProgressEvent) + Send + Sync>) -> Self {
        Self {
            send,
            stage: Mutex::new(String::new()),
            done: AtomicU64::new(0),
            total: AtomicU64::new(0),
            last: Mutex::new(Instant::now() - Duration::from_secs(1)),
        }
    }

    fn stage(&self, stage: &str, total: u64) {
        *self.stage.lock().unwrap() = stage.to_string();
        self.done.store(0, Ordering::Relaxed);
        self.total.store(total, Ordering::Relaxed);
        self.emit(true);
    }

    fn tick(&self) {
        self.done.fetch_add(1, Ordering::Relaxed);
        self.emit(false);
    }

    fn emit(&self, force: bool) {
        let mut last = self.last.lock().unwrap();
        let done = self.done.load(Ordering::Relaxed);
        let total = self.total.load(Ordering::Relaxed);
        if !force && done < total && last.elapsed() < Duration::from_millis(80) {
            return;
        }
        *last = Instant::now();
        let stage = self.stage.lock().unwrap().clone();
        (self.send)(ProgressEvent { stage, done, total });
    }
}

// ---------------------------------------------------------------- downloads

struct FileTask {
    url: String,
    path: PathBuf,
    sha1: Option<String>,
    size: Option<u64>,
}

fn sha1_hex(bytes: &[u8]) -> String {
    Sha1::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Present = exists with the expected size (hashes are checked right after downloading)
fn is_present(task: &FileTask) -> bool {
    match fs::metadata(&task.path) {
        Ok(meta) => task.size.map_or(meta.len() > 0, |size| meta.len() == size),
        Err(_) => false,
    }
}

async fn fetch_file(client: &reqwest::Client, task: &FileTask) -> Result<(), String> {
    let mut last_error = String::new();
    for _ in 0..3 {
        let bytes = match client
            .get(&task.url)
            .send()
            .await
            .and_then(|r| r.error_for_status())
        {
            Ok(response) => match response.bytes().await {
                Ok(bytes) => bytes,
                Err(e) => {
                    last_error = e.to_string();
                    continue;
                }
            },
            Err(e) => {
                last_error = e.to_string();
                continue;
            }
        };
        if let Some(expected) = &task.sha1 {
            if !sha1_hex(&bytes).eq_ignore_ascii_case(expected) {
                last_error = "checksum mismatch".into();
                continue;
            }
        }
        if let Some(dir) = task.path.parent() {
            fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let mut temp = task.path.clone().into_os_string();
        temp.push(".part");
        fs::write(&temp, &bytes).map_err(|e| e.to_string())?;
        fs::rename(&temp, &task.path).map_err(|e| e.to_string())?;
        return Ok(());
    }
    Err(format!("Download failed: {} ({last_error})", task.url))
}

/// Downloads every missing file, 16 at a time (each future owns its data, so it is Send + 'static)
async fn download_all(
    client: &reqwest::Client,
    tasks: Vec<FileTask>,
    reporter: &Arc<Reporter>,
    stage: &str,
) -> Result<(), String> {
    let missing: Vec<FileTask> = tasks.into_iter().filter(|t| !is_present(t)).collect();
    reporter.stage(stage, missing.len() as u64);
    let futures = missing.into_iter().map(|task| {
        let client = client.clone();
        let reporter = reporter.clone();
        async move {
            let result = fetch_file(&client, &task).await;
            reporter.tick();
            result
        }
    });
    let results: Vec<Result<(), String>> = stream::iter(futures)
        .buffer_unordered(PARALLEL_DOWNLOADS)
        .collect()
        .await;
    results.into_iter().collect()
}

async fn get_json(client: &reqwest::Client, url: &str) -> Result<Value, String> {
    client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("No connection ({e})"))?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())
}

// ---------------------------------------------------------------- versions

/// Minecraft versions Fabric supports (stable releases, newest first)
pub async fn list_versions() -> Result<Vec<String>, String> {
    let client = reqwest::Client::new();
    let games = get_json(&client, &format!("{FABRIC_META}/versions/game")).await?;
    Ok(games
        .as_array()
        .map(|list| {
            list.iter()
                .filter(|g| g["stable"].as_bool() == Some(true))
                .filter_map(|g| g["version"].as_str().map(String::from))
                .filter(|v| is_supported(v))
                .take(15)
                .collect()
        })
        .unwrap_or_default())
}

/// Reality Client supports Minecraft 26.x and newer only
pub const MIN_MAJOR: u32 = 26;

fn is_supported(version: &str) -> bool {
    version.split('.').next().and_then(|major| major.parse::<u32>().ok()).is_some_and(|major| major >= MIN_MAJOR)
}

async fn vanilla_version(client: &reqwest::Client, root: &Path, id: &str) -> Result<Value, String> {
    let manifest = get_json(client, VERSION_MANIFEST).await?;
    let url = manifest["versions"]
        .as_array()
        .and_then(|list| list.iter().find(|v| v["id"].as_str() == Some(id)))
        .and_then(|v| v["url"].as_str())
        .ok_or(format!("Minecraft {id} not found"))?;
    let json = get_json(client, url).await?;
    let dir = root.join("versions").join(id);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    fs::write(dir.join(format!("{id}.json")), json.to_string()).map_err(|e| e.to_string())?;
    Ok(json)
}

async fn fabric_profile(client: &reqwest::Client, game: &str) -> Result<Value, String> {
    let loaders = get_json(client, &format!("{FABRIC_META}/versions/loader/{game}")).await?;
    let list = loaders
        .as_array()
        .ok_or("Fabric has no loader for this version")?;
    let pick = list
        .iter()
        .find(|l| l["loader"]["stable"].as_bool() == Some(true))
        .or_else(|| list.first())
        .and_then(|l| l["loader"]["version"].as_str())
        .ok_or("Fabric has no loader for this version")?;
    get_json(
        client,
        &format!("{FABRIC_META}/versions/loader/{game}/{pick}/profile/json"),
    )
    .await
}

// ---------------------------------------------------------------- rules

/// Mojang's rule lists: the last rule that applies decides. We run on 64-bit Windows and
/// enable no optional features (demo, custom resolution, quick play).
fn rules_allow(rules: Option<&Value>) -> bool {
    let Some(rules) = rules.and_then(|r| r.as_array()) else {
        return true;
    };
    let mut allowed = false;
    for rule in rules {
        let allow = rule["action"].as_str() == Some("allow");
        let features_apply = rule
            .get("features")
            .and_then(|f| f.as_object())
            .map_or(true, |features| {
                features.values().all(|v| v.as_bool() == Some(false))
            });
        let os_applies = rule.get("os").map_or(true, |os| {
            os["name"].as_str().map_or(true, |name| name == "windows")
                && os["arch"].as_str() != Some("x86")
        });
        if features_apply && os_applies {
            allowed = allow;
        }
    }
    allowed
}

/// "group:artifact:version[:classifier]" → maven path
fn maven_path(name: &str) -> Option<String> {
    let parts: Vec<&str> = name.split(':').collect();
    let (group, artifact, version) = (parts.first()?, parts.get(1)?, parts.get(2)?);
    let classifier = parts.get(3).map(|c| format!("-{c}")).unwrap_or_default();
    Some(format!(
        "{}/{artifact}/{version}/{artifact}-{version}{classifier}.jar",
        group.replace('.', "/")
    ))
}

/// Same library in another version → the same key, so Fabric's copy can replace the vanilla one
fn library_key(name: &str) -> String {
    let parts: Vec<&str> = name.split(':').collect();
    match parts.as_slice() {
        [group, artifact, _, classifier, ..] => format!("{group}:{artifact}:{classifier}"),
        [group, artifact, ..] => format!("{group}:{artifact}"),
        _ => name.to_string(),
    }
}

fn libraries(vanilla: &Value, fabric: &Value, lib_dir: &Path) -> Result<Vec<FileTask>, String> {
    let mut order: Vec<String> = Vec::new();
    let mut by_key: HashMap<String, FileTask> = HashMap::new();
    let mut add = |name: &str, task: FileTask| {
        let key = library_key(name);
        if !by_key.contains_key(&key) {
            order.push(key.clone());
        }
        by_key.insert(key, task);
    };

    for lib in vanilla["libraries"].as_array().into_iter().flatten() {
        if !rules_allow(lib.get("rules")) {
            continue;
        }
        if lib.get("natives").is_some() {
            return Err("This Minecraft version is too old for Reality Client".into());
        }
        let Some(artifact) = lib["downloads"].get("artifact") else {
            continue;
        };
        let (Some(path), Some(url)) = (artifact["path"].as_str(), artifact["url"].as_str()) else {
            continue;
        };
        add(
            lib["name"].as_str().unwrap_or(path),
            FileTask {
                url: url.to_string(),
                path: lib_dir.join(native(path)),
                sha1: artifact["sha1"].as_str().map(String::from),
                size: artifact["size"].as_u64(),
            },
        );
    }

    for lib in fabric["libraries"].as_array().into_iter().flatten() {
        let Some(name) = lib["name"].as_str() else {
            continue;
        };
        let Some(path) = maven_path(name) else {
            continue;
        };
        let base = lib["url"].as_str().unwrap_or("https://maven.fabricmc.net/");
        add(
            name,
            FileTask {
                url: format!("{}/{path}", base.trim_end_matches('/')),
                path: lib_dir.join(native(&path)),
                sha1: lib["sha1"].as_str().map(String::from),
                size: lib["size"].as_u64(),
            },
        );
    }

    Ok(order
        .into_iter()
        .filter_map(|key| by_key.remove(&key))
        .collect())
}

/// Argument lists: plain strings, or { rules, value } objects whose value is a string or a list
fn collect_args(list: Option<&Value>) -> Vec<String> {
    let mut out = Vec::new();
    for item in list.and_then(|l| l.as_array()).into_iter().flatten() {
        match item {
            Value::String(s) => out.push(s.clone()),
            Value::Object(_) if rules_allow(item.get("rules")) => match &item["value"] {
                Value::String(s) => out.push(s.clone()),
                Value::Array(values) => {
                    out.extend(values.iter().filter_map(|v| v.as_str().map(String::from)))
                }
                _ => {}
            },
            _ => {}
        }
    }
    out
}

fn fill(arg: &str, vars: &HashMap<&str, String>) -> String {
    let mut out = arg.to_string();
    for (key, value) in vars {
        out = out.replace(&format!("${{{key}}}"), value);
    }
    out
}

// ---------------------------------------------------------------- java

/// Mojang's own Java runtime for this version (e.g. java-runtime-epsilon = Java 25)
async fn ensure_java(
    client: &reqwest::Client,
    root: &Path,
    component: &str,
    reporter: &Arc<Reporter>,
) -> Result<PathBuf, String> {
    reporter.stage("Checking Java", 0);
    let all = get_json(client, JAVA_MANIFEST).await?;
    let entry = all["windows-x64"][component]
        .as_array()
        .and_then(|list| list.first())
        .ok_or(format!("No Java runtime \"{component}\" for Windows"))?;
    let manifest_url = entry["manifest"]["url"]
        .as_str()
        .ok_or("Java manifest missing")?;
    let manifest_sha1 = entry["manifest"]["sha1"].as_str().unwrap_or_default();

    let dir = root.join("runtime").join(component);
    let javaw = dir.join("bin").join("javaw.exe");
    let marker = dir.join(".installed");
    if javaw.exists() && fs::read_to_string(&marker).ok().as_deref() == Some(manifest_sha1) {
        return Ok(javaw);
    }

    let manifest = get_json(client, manifest_url).await?;
    let mut tasks = Vec::new();
    for (rel, info) in manifest["files"].as_object().into_iter().flatten() {
        let path = dir.join(native(rel));
        match info["type"].as_str() {
            Some("directory") => fs::create_dir_all(&path).map_err(|e| e.to_string())?,
            Some("file") => {
                let raw = &info["downloads"]["raw"];
                if let Some(url) = raw["url"].as_str() {
                    tasks.push(FileTask {
                        url: url.to_string(),
                        path,
                        sha1: raw["sha1"].as_str().map(String::from),
                        size: raw["size"].as_u64(),
                    });
                }
            }
            _ => {}
        }
    }
    download_all(client, tasks, reporter, "Downloading Java").await?;
    if !javaw.exists() {
        return Err("Java could not be installed".into());
    }
    fs::write(&marker, manifest_sha1).map_err(|e| e.to_string())?;
    Ok(javaw)
}

// ---------------------------------------------------------------- launch

pub async fn launch(
    app: AppHandle,
    store: &TokenStore,
    running: Arc<AtomicBool>,
    options: LaunchOptions,
) -> Result<(), String> {
    if running.swap(true, Ordering::SeqCst) {
        return Err("Minecraft is already running".into());
    }
    let result = prepare_and_start(&app, store, running.clone(), options).await;
    if result.is_err() {
        running.store(false, Ordering::SeqCst);
    }
    result
}

async fn prepare_and_start(
    app: &AppHandle,
    store: &TokenStore,
    running: Arc<AtomicBool>,
    options: LaunchOptions,
) -> Result<(), String> {
    let reporter = Arc::new(Reporter::new(app.clone()));
    let client = http_client()?;
    let root = data_root(app)?;
    let game = instance_dir(app, &options.instance_id)?;

    if !is_supported(&options.version) {
        return Err(format!("Minecraft {} is not supported, Reality Client runs on {MIN_MAJOR}.x and newer", options.version));
    }

    // 1. Account
    reporter.stage("Signing in", 0);
    let session = auth::launch_session(store, &options.uuid).await?;

    let (javaw, args) = prepare(
        &client,
        &root,
        &game,
        &options.version,
        options.memory_mb,
        &session,
        &reporter,
    )
    .await?;
    let mut child = spawn_game(&javaw, &args, &game)?;

    let _ = app.emit("game-started", ());
    let started = Instant::now();
    let app = app.clone();
    std::thread::spawn(move || {
        let code = child.wait().ok().and_then(|status| status.code());
        running.store(false, Ordering::SeqCst);
        let early = started.elapsed() < Duration::from_secs(20) && code != Some(0);
        let _ = app.emit("game-exited", ExitEvent { code, early });
    });
    Ok(())
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(format!("{LAUNCHER_NAME}/{LAUNCHER_VERSION}"))
        .connect_timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())
}

/// Everything but the account: Java, files, Fabric. Returns javaw.exe and the full argument list.
async fn prepare(
    client: &reqwest::Client,
    root: &Path,
    game: &Path,
    version: &str,
    memory_mb: u32,
    session: &auth::Session,
    reporter: &Arc<Reporter>,
) -> Result<(PathBuf, Vec<String>), String> {
    fs::create_dir_all(game.join("mods")).map_err(|e| e.to_string())?;

    // 2. Version files
    reporter.stage("Loading version", 0);
    let vanilla = vanilla_version(client, root, &version).await?;
    let fabric = fabric_profile(client, &version).await?;
    let version_id = fabric["id"].as_str().unwrap_or(&version).to_string();

    // 3. Java
    let component = vanilla["javaVersion"]["component"]
        .as_str()
        .unwrap_or("java-runtime-delta");
    let javaw = ensure_java(client, root, component, &reporter).await?;

    // 4. Game files
    let lib_dir = root.join("libraries");
    let libs = libraries(&vanilla, &fabric, &lib_dir)?;
    let mut classpath: Vec<PathBuf> = libs.iter().map(|t| t.path.clone()).collect();

    let client_jar = root
        .join("versions")
        .join(&version)
        .join(format!("{}.jar", version));
    let client_download = &vanilla["downloads"]["client"];
    let mut files = libs;
    files.push(FileTask {
        url: client_download["url"]
            .as_str()
            .ok_or("Client download missing")?
            .to_string(),
        path: client_jar.clone(),
        sha1: client_download["sha1"].as_str().map(String::from),
        size: client_download["size"].as_u64(),
    });
    classpath.push(client_jar);

    let mut logging_arg: Option<String> = None;
    let logging = &vanilla["logging"]["client"];
    if let (Some(argument), Some(id), Some(url)) = (
        logging["argument"].as_str(),
        logging["file"]["id"].as_str(),
        logging["file"]["url"].as_str(),
    ) {
        let path = root.join("assets").join("log_configs").join(id);
        logging_arg = Some(argument.replace("${path}", &path.to_string_lossy()));
        files.push(FileTask {
            url: url.to_string(),
            path,
            sha1: logging["file"]["sha1"].as_str().map(String::from),
            size: logging["file"]["size"].as_u64(),
        });
    }
    download_all(client, files, &reporter, "Downloading game").await?;

    // Assets: index, then every object it lists
    let asset_index = &vanilla["assetIndex"];
    let index_id = asset_index["id"]
        .as_str()
        .ok_or("Asset index missing")?
        .to_string();
    let assets_dir = root.join("assets");
    let index_path = assets_dir.join("indexes").join(format!("{index_id}.json"));
    let index_task = FileTask {
        url: asset_index["url"]
            .as_str()
            .ok_or("Asset index missing")?
            .to_string(),
        path: index_path.clone(),
        sha1: asset_index["sha1"].as_str().map(String::from),
        size: asset_index["size"].as_u64(),
    };
    if !is_present(&index_task) {
        fetch_file(client, &index_task).await?;
    }
    let index: Value =
        serde_json::from_str(&fs::read_to_string(&index_path).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    let mut seen = std::collections::HashSet::new();
    let mut asset_tasks = Vec::new();
    for object in index["objects"]
        .as_object()
        .into_iter()
        .flat_map(|o| o.values())
    {
        let Some(hash) = object["hash"].as_str() else {
            continue;
        };
        if !seen.insert(hash.to_string()) {
            continue;
        }
        let prefix = &hash[..2];
        asset_tasks.push(FileTask {
            url: format!("{ASSET_BASE}/{prefix}/{hash}"),
            path: assets_dir.join("objects").join(prefix).join(hash),
            sha1: Some(hash.to_string()),
            size: object["size"].as_u64(),
        });
    }
    download_all(client, asset_tasks, &reporter, "Downloading assets").await?;

    // 5. Command line
    reporter.stage("Starting", 0);
    let natives = root.join("natives").join(&version);
    for sub in ["java", "jna", "lwjgl", "netty"] {
        fs::create_dir_all(natives.join(sub)).map_err(|e| e.to_string())?;
    }
    let classpath = classpath
        .iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join(";");
    let vars: HashMap<&str, String> = HashMap::from([
        ("auth_player_name", session.name.clone()),
        ("version_name", version_id.clone()),
        ("game_directory", game.to_string_lossy().into_owned()),
        ("assets_root", assets_dir.to_string_lossy().into_owned()),
        ("assets_index_name", index_id.clone()),
        ("auth_uuid", session.uuid.clone()),
        ("auth_access_token", session.access_token.clone()),
        ("clientid", auth::CLIENT_ID.to_string()),
        ("auth_xuid", session.xuid.clone()),
        ("user_type", "msa".to_string()),
        ("version_type", "release".to_string()),
        ("natives_directory", natives.to_string_lossy().into_owned()),
        ("launcher_name", LAUNCHER_NAME.to_string()),
        ("launcher_version", LAUNCHER_VERSION.to_string()),
        ("classpath", classpath),
        ("classpath_separator", ";".to_string()),
        ("library_directory", lib_dir.to_string_lossy().into_owned()),
    ]);

    let mut args: Vec<String> = vec![format!("-Xmx{}M", memory_mb.clamp(1024, 32768))];
    args.extend(logging_arg);
    args.extend(collect_args(fabric["arguments"].get("jvm")));
    args.extend(collect_args(vanilla["arguments"].get("jvm")));
    args.push(
        fabric["mainClass"]
            .as_str()
            .ok_or("Fabric main class missing")?
            .to_string(),
    );
    args.extend(collect_args(vanilla["arguments"].get("game")));
    args.extend(collect_args(fabric["arguments"].get("game")));
    let args: Vec<String> = args.iter().map(|a| fill(a, &vars)).collect();

    Ok((javaw, args))
}

/// Starts Java; the game output goes to a log file in the instance folder, handy when something goes wrong
fn spawn_game(javaw: &Path, args: &[String], game: &Path) -> Result<std::process::Child, String> {
    let log = fs::File::create(game.join("launcher_output.log")).map_err(|e| e.to_string())?;
    let log_err = log.try_clone().map_err(|e| e.to_string())?;
    Command::new(javaw)
        .args(args)
        .current_dir(game)
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(log_err))
        .spawn()
        .map_err(|e| format!("Could not start Java: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Real end-to-end check without an account: downloads Java, game files and Fabric into the app's
    /// data folder (so the first real launch is quick), starts the game with a test name, waits until
    /// Fabric has loaded Minecraft and the window is up, then closes it again.
    /// Run with: cargo test real_launch -- --ignored --nocapture
    #[test]
    #[ignore]
    fn real_launch() {
        let version = std::env::var("REALITY_TEST_VERSION").unwrap_or_else(|_| "26.3".into());
        let root =
            real_path(&PathBuf::from(std::env::var("APPDATA").unwrap()).join("com.reality.client"))
                .unwrap();
        let game = root.join("instances").join("launch-test");
        let session = auth::Session {
            uuid: "00000000000000000000000000000000".into(),
            name: "RealityTest".into(),
            access_token: "0".into(),
            xuid: "0".into(),
        };
        let reporter = Arc::new(Reporter::with(Box::new(|e: ProgressEvent| {
            if e.total == 0 || e.done == e.total {
                println!("[progress] {} {}/{}", e.stage, e.done, e.total);
            }
        })));
        let started = Instant::now();
        let (javaw, args) = tauri::async_runtime::block_on(async {
            let client = http_client().unwrap();
            prepare(&client, &root, &game, &version, 4096, &session, &reporter).await
        })
        .expect("prepare failed");
        println!(
            "prepared in {:?}, {} args, java {}",
            started.elapsed(),
            args.len(),
            javaw.display()
        );

        let mut child = spawn_game(&javaw, &args, &game).expect("spawn failed");
        let log_path = game.join("launcher_output.log");
        let deadline = Instant::now() + Duration::from_secs(240);
        let mut loaded = false;
        let mut window = false;
        while Instant::now() < deadline {
            std::thread::sleep(Duration::from_secs(2));
            let log = fs::read_to_string(&log_path).unwrap_or_default();
            loaded |= log.contains("with Fabric Loader");
            window |= log.contains("Backend library")
                || log.contains("OpenAL initialized")
                || log.contains("Sound engine started");
            if let Ok(Some(status)) = child.try_wait() {
                println!("--- game exited early: {status}\n{}", tail(&log, 60));
                panic!("game exited");
            }
            if loaded && window {
                break;
            }
        }
        let log = fs::read_to_string(&log_path).unwrap_or_default();
        let _ = child.kill();
        let _ = child.wait();
        println!("--- log tail\n{}", tail(&log, 25));
        assert!(loaded, "Fabric never loaded Minecraft");
        assert!(window, "the game window never came up");
        let _ = fs::remove_dir_all(&game);
    }

    fn tail(text: &str, lines: usize) -> String {
        let all: Vec<&str> = text.lines().collect();
        all[all.len().saturating_sub(lines)..].join("\n")
    }
}
