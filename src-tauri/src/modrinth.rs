//! Mods from Modrinth for an instance.
//!
//! Search is filtered to Fabric and the instance's Minecraft version. Installing picks the newest
//! matching version, downloads its primary file into `<instance>/mods` (checked against its sha1) and
//! pulls in every required dependency the same way. What was installed is remembered in
//! `<instance>/reality-mods.json`; disabled mods are renamed to `.jar.disabled` like other launchers do.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha1::{Digest, Sha1};
use std::collections::{HashMap, HashSet, VecDeque};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

const API: &str = "https://api.modrinth.com/v2";
const USER_AGENT: &str = concat!(
    "offup/reality-client/",
    env!("CARGO_PKG_VERSION"),
    " (github.com/offup/reality-client-releases)"
);
const META_FILE: &str = "reality-mods.json";
const DISABLED: &str = ".disabled";

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .connect_timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())
}

async fn get_json(client: &reqwest::Client, url: &str) -> Result<Value, String> {
    let response = client.get(url).send().await.map_err(|e| format!("No connection to Modrinth ({e})"))?;
    if !response.status().is_success() {
        return Err(format!("Modrinth answered {}", response.status()));
    }
    response.json().await.map_err(|e| e.to_string())
}

fn encode(value: &str) -> String {
    let mut out = String::new();
    for b in value.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

// ---------------------------------------------------------------- search

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub id: String,
    pub slug: String,
    pub title: String,
    pub description: String,
    pub icon_url: Option<String>,
    pub downloads: u64,
    pub author: String,
    pub categories: Vec<String>,
}

#[derive(Serialize)]
pub struct SearchResult {
    pub hits: Vec<SearchHit>,
    pub total: u64,
}

/// `sort`: "relevance" | "downloads" | "updated" | "newest"; `category` e.g. "optimization"
pub async fn search(query: &str, game_version: &str, category: Option<&str>, sort: &str, offset: u32) -> Result<SearchResult, String> {
    let mut facets = vec![
        vec!["project_type:mod".to_string()],
        vec!["categories:fabric".to_string()],
        vec![format!("versions:{game_version}")],
    ];
    if let Some(category) = category.filter(|c| !c.is_empty()) {
        facets.push(vec![format!("categories:{category}")]);
    }
    let index = match sort {
        "downloads" | "updated" | "newest" | "follows" => sort,
        _ if query.trim().is_empty() => "downloads",
        _ => "relevance",
    };
    let facets = serde_json::to_string(&facets).map_err(|e| e.to_string())?;
    let url = format!(
        "{API}/search?query={}&facets={}&index={index}&limit=20&offset={offset}",
        encode(query.trim()),
        encode(&facets)
    );
    let json = get_json(&client()?, &url).await?;
    let hits = json["hits"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|h| SearchHit {
            id: h["project_id"].as_str().unwrap_or_default().to_string(),
            slug: h["slug"].as_str().unwrap_or_default().to_string(),
            title: h["title"].as_str().unwrap_or_default().to_string(),
            description: h["description"].as_str().unwrap_or_default().to_string(),
            icon_url: h["icon_url"].as_str().filter(|s| !s.is_empty()).map(String::from),
            downloads: h["downloads"].as_u64().unwrap_or(0),
            author: h["author"].as_str().unwrap_or_default().to_string(),
            categories: h["display_categories"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|c| c.as_str().map(String::from))
                .filter(|c| c != "fabric")
                .collect(),
        })
        .collect();
    Ok(SearchResult { hits, total: json["total_hits"].as_u64().unwrap_or(0) })
}

// ---------------------------------------------------------------- installed mods

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InstalledMod {
    /// Empty for jars that were put into the folder by hand
    pub project_id: String,
    pub version_id: String,
    pub version_number: String,
    pub title: String,
    /// File name of the enabled jar (the disabled one carries an extra ".disabled")
    pub filename: String,
    pub icon_url: Option<String>,
    pub enabled: bool,
    /// Pulled in automatically as a dependency of another mod
    pub dependency: bool,
}

fn mods_dir(instance: &Path) -> PathBuf {
    instance.join("mods")
}

fn read_meta(instance: &Path) -> Vec<InstalledMod> {
    fs::read_to_string(instance.join(META_FILE))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn write_meta(instance: &Path, mods: &[InstalledMod]) -> Result<(), String> {
    let text = serde_json::to_string_pretty(mods).map_err(|e| e.to_string())?;
    fs::write(instance.join(META_FILE), text).map_err(|e| e.to_string())
}

/// The mod list as it really is on disk: entries whose file is gone are dropped, jars without an
/// entry (added by hand) show up with their file name, and enabled/disabled follows the file name.
pub fn list(instance: &Path) -> Result<Vec<InstalledMod>, String> {
    let dir = mods_dir(instance);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut on_disk: HashMap<String, bool> = HashMap::new();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if let Some(base) = name.strip_suffix(DISABLED) {
            if base.ends_with(".jar") {
                on_disk.insert(base.to_string(), false);
            }
        } else if name.ends_with(".jar") {
            on_disk.insert(name, true);
        }
    }

    let mut mods: Vec<InstalledMod> = read_meta(instance)
        .into_iter()
        .filter_map(|mut m| {
            let enabled = *on_disk.get(&m.filename)?;
            m.enabled = enabled;
            Some(m)
        })
        .collect();
    let known: HashSet<String> = mods.iter().map(|m| m.filename.clone()).collect();
    let mut manual: Vec<InstalledMod> = on_disk
        .iter()
        .filter(|(name, _)| !known.contains(*name))
        .map(|(name, enabled)| InstalledMod {
            project_id: String::new(),
            version_id: String::new(),
            version_number: String::new(),
            title: name.trim_end_matches(".jar").to_string(),
            filename: name.clone(),
            icon_url: None,
            enabled: *enabled,
            dependency: false,
        })
        .collect();
    manual.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));
    mods.extend(manual);
    write_meta(instance, &mods.iter().filter(|m| !m.project_id.is_empty()).cloned().collect::<Vec<_>>())?;
    Ok(mods)
}

/// A file name from Modrinth, reduced to something safe to put into the mods folder
fn safe_filename(name: &str) -> Option<String> {
    let base = name.rsplit(['/', '\\']).next()?.trim();
    if base.is_empty() || base.starts_with('.') || !base.ends_with(".jar") {
        return None;
    }
    Some(base.to_string())
}

/// Newest Fabric version of a project for this Minecraft version (releases preferred)
async fn pick_version(client: &reqwest::Client, project_id: &str, game_version: &str) -> Result<Value, String> {
    let url = format!(
        "{API}/project/{}/version?loaders={}&game_versions={}",
        encode(project_id),
        encode("[\"fabric\"]"),
        encode(&format!("[\"{game_version}\"]"))
    );
    let versions = get_json(client, &url).await?;
    let list = versions.as_array().cloned().unwrap_or_default();
    list.iter()
        .find(|v| v["version_type"].as_str() == Some("release"))
        .or_else(|| list.first())
        .cloned()
        .ok_or_else(|| format!("No Fabric version for Minecraft {game_version}"))
}

async fn download(client: &reqwest::Client, url: &str, sha1: Option<&str>, path: &Path) -> Result<(), String> {
    let bytes = client
        .get(url)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("Download failed ({e})"))?
        .bytes()
        .await
        .map_err(|e| e.to_string())?;
    if let Some(expected) = sha1 {
        let got: String = Sha1::digest(&bytes).iter().map(|b| format!("{b:02x}")).collect();
        if !got.eq_ignore_ascii_case(expected) {
            return Err("Download was corrupted, please try again".into());
        }
    }
    let mut temp = path.as_os_str().to_owned();
    temp.push(".part");
    fs::write(&temp, &bytes).map_err(|e| e.to_string())?;
    fs::rename(&temp, path).map_err(|e| e.to_string())
}

/// Installs a project plus all its required dependencies; returns the new mod list
pub async fn install(instance: &Path, project_id: &str, game_version: &str) -> Result<Vec<InstalledMod>, String> {
    let client = client()?;
    let dir = mods_dir(instance);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut mods = list(instance)?;
    let mut have: HashSet<String> = mods.iter().map(|m| m.project_id.clone()).filter(|p| !p.is_empty()).collect();

    let mut queue: VecDeque<(String, bool)> = VecDeque::from([(project_id.to_string(), false)]);
    let mut fresh: Vec<InstalledMod> = Vec::new();
    while let Some((project, dependency)) = queue.pop_front() {
        if !have.insert(project.clone()) {
            continue;
        }
        let version = pick_version(&client, &project, game_version).await?;
        let files = version["files"].as_array().cloned().unwrap_or_default();
        let file = files
            .iter()
            .find(|f| f["primary"].as_bool() == Some(true))
            .or_else(|| files.first())
            .ok_or("This mod has no file to download")?;
        let filename = file["filename"].as_str().and_then(safe_filename).ok_or("This mod has an unusable file name")?;
        let url = file["url"].as_str().ok_or("This mod has no download link")?;
        download(&client, url, file["hashes"]["sha1"].as_str(), &dir.join(&filename)).await?;

        fresh.push(InstalledMod {
            project_id: project.clone(),
            version_id: version["id"].as_str().unwrap_or_default().to_string(),
            version_number: version["version_number"].as_str().unwrap_or_default().to_string(),
            title: String::new(),
            filename,
            icon_url: None,
            enabled: true,
            dependency,
        });

        for dep in version["dependencies"].as_array().into_iter().flatten() {
            if dep["dependency_type"].as_str() != Some("required") {
                continue;
            }
            let dep_project = match dep["project_id"].as_str() {
                Some(id) => id.to_string(),
                None => match dep["version_id"].as_str() {
                    Some(version_id) => get_json(&client, &format!("{API}/version/{}", encode(version_id))).await?["project_id"]
                        .as_str()
                        .unwrap_or_default()
                        .to_string(),
                    None => continue,
                },
            };
            if !dep_project.is_empty() && !have.contains(&dep_project) {
                queue.push_back((dep_project, true));
            }
        }
    }

    // Titles and icons for everything new, in one request
    if !fresh.is_empty() {
        let ids: Vec<&str> = fresh.iter().map(|m| m.project_id.as_str()).collect();
        let ids = serde_json::to_string(&ids).map_err(|e| e.to_string())?;
        let projects = get_json(&client, &format!("{API}/projects?ids={}", encode(&ids))).await.unwrap_or(Value::Null);
        for m in &mut fresh {
            let project = projects
                .as_array()
                .and_then(|list| list.iter().find(|p| p["id"].as_str() == Some(m.project_id.as_str())));
            m.title = project
                .and_then(|p| p["title"].as_str())
                .map(String::from)
                .unwrap_or_else(|| m.filename.trim_end_matches(".jar").to_string());
            m.icon_url = project.and_then(|p| p["icon_url"].as_str()).filter(|s| !s.is_empty()).map(String::from);
        }
    }

    // A jar that was there by hand with the same name is now known
    let fresh_names: HashSet<String> = fresh.iter().map(|m| m.filename.clone()).collect();
    mods.retain(|m| !fresh_names.contains(&m.filename));
    mods.extend(fresh);
    write_meta(instance, &mods.iter().filter(|m| !m.project_id.is_empty()).cloned().collect::<Vec<_>>())?;
    list(instance)
}

/// Switches a mod on or off by renaming its file
pub fn set_enabled(instance: &Path, filename: &str, enabled: bool) -> Result<Vec<InstalledMod>, String> {
    let name = safe_filename(filename).ok_or("Invalid mod file")?;
    let dir = mods_dir(instance);
    let on = dir.join(&name);
    let off = dir.join(format!("{name}{DISABLED}"));
    let (from, to) = if enabled { (off, on) } else { (on, off) };
    if from.exists() {
        fs::rename(&from, &to).map_err(|e| e.to_string())?;
    }
    list(instance)
}

/// Deletes a mod file (enabled or disabled) and forgets it
pub fn remove(instance: &Path, filename: &str) -> Result<Vec<InstalledMod>, String> {
    let name = safe_filename(filename).ok_or("Invalid mod file")?;
    let dir = mods_dir(instance);
    for path in [dir.join(&name), dir.join(format!("{name}{DISABLED}"))] {
        if path.exists() {
            fs::remove_file(&path).map_err(|e| format!("Could not delete the mod: {e}"))?;
        }
    }
    let mods: Vec<InstalledMod> = read_meta(instance).into_iter().filter(|m| m.filename != name).collect();
    write_meta(instance, &mods)?;
    list(instance)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Real API check: search, install Sodium (pulls nothing) and Mod Menu (pulls Fabric API),
    /// disable, enable, remove. Run with: cargo test modrinth_flow -- --ignored --nocapture
    #[test]
    #[ignore]
    fn modrinth_flow() {
        let version = std::env::var("REALITY_TEST_VERSION").unwrap_or_else(|_| "26.3".into());
        let dir = std::env::temp_dir().join("reality-modrinth-test");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        tauri::async_runtime::block_on(async {
            let found = search("mod menu", &version, None, "relevance", 0).await.expect("search");
            println!("search: {} hits, first: {:?}", found.total, found.hits.first().map(|h| &h.title));
            let modmenu = found.hits.iter().find(|h| h.slug == "modmenu").expect("Mod Menu in results");
            let mods = install(&dir, &modmenu.id, &version).await.expect("install");
            for m in &mods {
                println!("installed: {} {} dep={} file={}", m.title, m.version_number, m.dependency, m.filename);
            }
            assert!(mods.iter().any(|m| m.title.contains("Fabric API")), "Fabric API should come along");
            let file = mods[0].filename.clone();
            let off = set_enabled(&dir, &file, false).expect("disable");
            assert!(!off.iter().find(|m| m.filename == file).unwrap().enabled);
            let on = set_enabled(&dir, &file, true).expect("enable");
            assert!(on.iter().find(|m| m.filename == file).unwrap().enabled);
            let left = remove(&dir, &file).expect("remove");
            assert!(!left.iter().any(|m| m.filename == file));
            println!("ok, {} mods left", left.len());
        });
        let _ = fs::remove_dir_all(&dir);
    }
}
