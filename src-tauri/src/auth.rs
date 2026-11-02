//! Microsoft sign-in for Minecraft: Java Edition.
//!
//! Flow: the browser opens the Microsoft sign-in → redirect back to a local port →
//! Microsoft token → Xbox Live → XSTS → Minecraft token → profile (name, skin, cape).

use base64::Engine;
use rand::Rng;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Application (client) ID of the Azure app. Public, not a secret.
pub const CLIENT_ID: &str = "92c82112-8d60-4203-b4e1-7d0111e0bbb7";

const SCOPE: &str = "XboxLive.signin offline_access";
const LOGIN_TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Serialize, Clone, Debug)]
pub struct Account {
    pub uuid: String,
    pub name: String,
    /// Skin as a data: URL so WebGL can load it without CORS trouble
    pub skin: String,
    /// "default" or "slim"
    pub model: String,
    pub cape: Option<String>,
}

#[derive(Default)]
pub struct LoginState {
    pub cancel: Arc<AtomicBool>,
}

fn random_string(len: usize) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
    let mut rng = rand::thread_rng();
    (0..len)
        .map(|_| CHARS[rng.gen_range(0..CHARS.len())] as char)
        .collect()
}

fn pkce_challenge(verifier: &str) -> String {
    let hash = Sha256::digest(verifier.as_bytes());
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(hash)
}

/// Waits for the redirect from Microsoft and returns `code` and `state` from the URL.
fn wait_for_redirect(
    listener: TcpListener,
    cancel: Arc<AtomicBool>,
) -> Result<(String, String), String> {
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let started = Instant::now();
    loop {
        match listener.accept() {
            Ok((mut stream, _)) => {
                let mut buf = [0u8; 4096];
                let n = stream.read(&mut buf).unwrap_or(0);
                let request = String::from_utf8_lossy(&buf[..n]);
                let path = request
                    .lines()
                    .next()
                    .and_then(|l| l.split_whitespace().nth(1))
                    .unwrap_or("/");
                let query = path.split_once('?').map(|(_, q)| q).unwrap_or("");
                let get = |key: &str| {
                    query
                        .split('&')
                        .find_map(|kv| kv.strip_prefix(&format!("{key}=")))
                        .map(urldecode)
                };
                let (ok, body, error) = match (get("code"), get("error")) {
                    (Some(_), _) => (
                        true,
                        "Signed in. You can close this window and go back to Reality Client.",
                        "",
                    ),
                    (_, Some(err)) if err == "access_denied" => {
                        (false, "Sign-in cancelled.", "Sign-in cancelled")
                    }
                    (_, Some(_)) => (false, "Sign-in failed.", "Sign-in failed"),
                    _ => (false, "Invalid redirect.", "Invalid redirect"),
                };
                let html = format!(
                    "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><title>Reality Client</title>\
                     <body style=\"margin:0;background:#0a0a0a;color:#fff;font-family:Segoe UI,system-ui,sans-serif;\
                     display:flex;align-items:center;justify-content:center;height:100vh\">\
                     <p style=\"font-size:18px\">{body}</p></body></html>"
                );
                let _ = write!(
                    stream,
                    "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    html.len(),
                    html
                );
                let _ = stream.flush();
                if ok {
                    return Ok((
                        get("code").unwrap_or_default(),
                        get("state").unwrap_or_default(),
                    ));
                }
                return Err(error.to_string());
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                if cancel.load(Ordering::Relaxed) {
                    return Err("Sign-in cancelled".into());
                }
                if started.elapsed() > LOGIN_TIMEOUT {
                    return Err("Timed out, please try again".into());
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(e) => return Err(e.to_string()),
        }
    }
}

#[derive(Deserialize)]
struct MsToken {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
}

/// Microsoft refresh tokens per account (uuid → token), kept in the app data folder so the
/// launcher can get a fresh Minecraft token when the game starts. Never sent anywhere but Microsoft.
pub struct TokenStore {
    path: PathBuf,
    lock: Mutex<()>,
    /// One sign-in at a time, a second request then uses the cached token
    signing_in: tauri::async_runtime::Mutex<()>,
}

/// Minecraft tokens last 24 hours; renew well before that. They are kept in sessions.json
/// so not every action and restart signs in again (Minecraft allows only a few per minute).
const SESSION_MAX_AGE_SECS: u64 = 20 * 60 * 60;

fn unix_now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

#[derive(Serialize, Deserialize, Clone)]
struct SavedSession {
    token: String,
    /// Unix seconds when the token was issued
    since: u64,
}

impl TokenStore {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            lock: Mutex::new(()),
            signing_in: tauri::async_runtime::Mutex::new(()),
        }
    }

    fn sessions_path(&self) -> PathBuf {
        self.path.with_file_name("sessions.json")
    }

    fn load_sessions(&self) -> HashMap<String, SavedSession> {
        std::fs::read_to_string(self.sessions_path())
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default()
    }

    fn cached_session(&self, uuid: &str) -> Option<String> {
        let _guard = self.lock.lock().ok()?;
        let saved = self.load_sessions().remove(uuid)?;
        (unix_now().saturating_sub(saved.since) < SESSION_MAX_AGE_SECS).then_some(saved.token)
    }

    fn cache_session(&self, uuid: &str, token: Option<&str>) {
        let Ok(_guard) = self.lock.lock() else { return };
        let mut sessions = self.load_sessions();
        match token {
            Some(token) => sessions.insert(uuid.to_string(), SavedSession { token: token.to_string(), since: unix_now() }),
            None => sessions.remove(uuid),
        };
        if let Ok(text) = serde_json::to_string(&sessions) {
            let _ = std::fs::write(self.sessions_path(), text);
        }
    }

    fn load(&self) -> HashMap<String, String> {
        std::fs::read_to_string(&self.path)
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default()
    }

    fn save(&self, tokens: &HashMap<String, String>) -> Result<(), String> {
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let text = serde_json::to_string(tokens).map_err(|e| e.to_string())?;
        std::fs::write(&self.path, text).map_err(|e| e.to_string())
    }

    pub fn get(&self, uuid: &str) -> Option<String> {
        let _guard = self.lock.lock().ok()?;
        self.load().get(uuid).cloned()
    }

    pub fn set(&self, uuid: &str, token: &str) -> Result<(), String> {
        let _guard = self.lock.lock().map_err(|e| e.to_string())?;
        let mut tokens = self.load();
        tokens.insert(uuid.to_string(), token.to_string());
        self.save(&tokens)
    }

    pub fn remove(&self, uuid: &str) -> Result<(), String> {
        self.cache_session(uuid, None);
        let _guard = self.lock.lock().map_err(|e| e.to_string())?;
        let mut tokens = self.load();
        if tokens.remove(uuid).is_some() {
            self.save(&tokens)?;
        }
        Ok(())
    }
}

/// What the game needs from the account to start
pub struct Session {
    pub uuid: String,
    pub name: String,
    pub access_token: String,
    pub xuid: String,
}

#[derive(Deserialize)]
struct XboxToken {
    #[serde(rename = "Token")]
    token: String,
    #[serde(rename = "DisplayClaims")]
    display_claims: XboxClaims,
}

#[derive(Deserialize)]
struct XboxClaims {
    xui: Vec<XboxUser>,
}

#[derive(Deserialize)]
struct XboxUser {
    uhs: String,
}

#[derive(Deserialize)]
struct McToken {
    access_token: String,
}

#[derive(Deserialize)]
struct Profile {
    id: String,
    name: String,
    #[serde(default)]
    skins: Vec<ProfileSkin>,
    #[serde(default)]
    capes: Vec<ProfileCape>,
}

#[derive(Deserialize)]
struct ProfileSkin {
    state: String,
    url: String,
    variant: String,
}

#[derive(Deserialize)]
struct ProfileCape {
    #[serde(default)]
    id: String,
    state: String,
    url: String,
    #[serde(default)]
    alias: String,
}

async fn fetch_as_data_url(client: &reqwest::Client, url: &str) -> Result<String, String> {
    let bytes = client
        .get(url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .bytes()
        .await
        .map_err(|e| e.to_string())?;
    Ok(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

/// Microsoft token → Xbox Live → XSTS → Minecraft token
async fn minecraft_token(
    client: &reqwest::Client,
    ms_access_token: &str,
) -> Result<String, String> {
    // 3. Xbox Live
    let xbl: XboxToken = client
        .post("https://user.auth.xboxlive.com/user/authenticate")
        .json(&json!({
            "Properties": { "AuthMethod": "RPS", "SiteName": "user.auth.xboxlive.com", "RpsTicket": format!("d={}", ms_access_token) },
            "RelyingParty": "http://auth.xboxlive.com",
            "TokenType": "JWT"
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|_| "Xbox Live sign-in failed".to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let uhs = xbl
        .display_claims
        .xui
        .first()
        .map(|u| u.uhs.clone())
        .ok_or("Xbox response without a user")?;

    // 4. XSTS
    let xsts_response = client
        .post("https://xsts.auth.xboxlive.com/xsts/authorize")
        .json(&json!({
            "Properties": { "SandboxId": "RETAIL", "UserTokens": [xbl.token] },
            "RelyingParty": "rp://api.minecraftservices.com/",
            "TokenType": "JWT"
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if xsts_response.status() == 401 {
        let body: serde_json::Value = xsts_response.json().await.unwrap_or_default();
        return Err(match body.get("XErr").and_then(|v| v.as_u64()) {
            Some(2148916233) => "This Microsoft account has no Xbox profile yet. Sign in once at xbox.com, then try again.".into(),
            Some(2148916238) => "Child account: an adult has to add it to a family group first.".into(),
            Some(2148916235) => "Xbox Live is not available in your country.".into(),
            _ => "Xbox sign-in was rejected".into(),
        });
    }
    let xsts: XboxToken = xsts_response
        .error_for_status()
        .map_err(|_| "XSTS sign-in failed".to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    // 5. Minecraft token
    let mc_response = client
        .post("https://api.minecraftservices.com/authentication/login_with_xbox")
        .json(&json!({ "identityToken": format!("XBL3.0 x={};{}", uhs, xsts.token) }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    match mc_response.status().as_u16() {
        200..=299 => {}
        429 => return Err("Minecraft is limiting sign-ins right now. Wait a minute and try again.".into()),
        403 => return Err("Minecraft sign-in failed (is the Azure app approved for the Minecraft API?)".into()),
        code => return Err(format!("Minecraft sign-in failed ({code})")),
    }
    let mc: McToken = mc_response
        .json()
        .await
        .map_err(|e| e.to_string())?;

    Ok(mc.access_token)
}

async fn fetch_profile(client: &reqwest::Client, mc_token: &str) -> Result<Profile, String> {
    // 6. Profile
    let profile_response = client
        .get("https://api.minecraftservices.com/minecraft/profile")
        .bearer_auth(mc_token)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if profile_response.status() == 404 {
        return Err("This Microsoft account does not own Minecraft: Java Edition".into());
    }
    profile_response
        .error_for_status()
        .map_err(|_| "Could not load the profile".to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())
}

pub async fn microsoft_login(
    cancel: Arc<AtomicBool>,
    store: &TokenStore,
) -> Result<Account, String> {
    if CLIENT_ID.is_empty() {
        return Err("Microsoft client ID is missing (src-tauri/src/auth.rs)".into());
    }

    // 1. Open a local port for the redirect and launch the browser
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect_uri = format!("http://localhost:{port}");
    let verifier = random_string(64);
    let state = random_string(24);
    let authorize_url = format!(
        "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize\
         ?client_id={CLIENT_ID}&response_type=code&redirect_uri={redirect}&scope={scope}\
         &code_challenge={challenge}&code_challenge_method=S256&state={state}&prompt=select_account",
        redirect = urlencode(&redirect_uri),
        scope = urlencode(SCOPE),
        challenge = pkce_challenge(&verifier),
    );
    open::that(&authorize_url).map_err(|e| format!("Could not open the browser: {e}"))?;

    let (code, returned_state) =
        tauri::async_runtime::spawn_blocking(move || wait_for_redirect(listener, cancel))
            .await
            .map_err(|e| e.to_string())??;
    if returned_state != state {
        return Err("Redirect does not match this sign-in".into());
    }

    let client = reqwest::Client::new();

    // 2. Exchange the code for a Microsoft token
    let token_response = client
        .post("https://login.microsoftonline.com/consumers/oauth2/v2.0/token")
        .form(&[
            ("client_id", CLIENT_ID),
            ("grant_type", "authorization_code"),
            ("code", code.as_str()),
            ("redirect_uri", redirect_uri.as_str()),
            ("code_verifier", verifier.as_str()),
            ("scope", SCOPE),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !token_response.status().is_success() {
        let body: serde_json::Value = token_response.json().await.unwrap_or_default();
        let description = body
            .get("error_description")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        eprintln!("[auth] token exchange rejected: {body}");
        let code = description.split(':').next().unwrap_or("").trim();
        let hint = match code {
            "AADSTS7000218" => {
                "Azure expects a secret: enable \"Allow public client flows\" and register http://localhost under \"Mobile and desktop applications\" (not \"Web\")."
            }
            "AADSTS50011" => {
                "The redirect URI http://localhost is missing in Azure under \"Mobile and desktop applications\"."
            }
            "AADSTS700016" => "The client ID is unknown in this directory.",
            "AADSTS70000" | "AADSTS54005" => {
                "The sign-in code expired or was already used, please sign in again."
            }
            _ => "Microsoft rejected the token.",
        };
        return Err(if code.is_empty() {
            hint.to_string()
        } else {
            format!("{hint} ({code})")
        });
    }
    let ms: MsToken = token_response.json().await.map_err(|e| e.to_string())?;

    let mc_token = minecraft_token(&client, &ms.access_token).await?;
    let profile = fetch_profile(&client, &mc_token).await?;

    // Keep the refresh token so the game can be started later without signing in again
    if let Some(refresh) = &ms.refresh_token {
        store.set(&profile.id, refresh)?;
    }

    account_from_profile(&client, &profile).await
}

/// Name, active skin (as data URL), model and active cape of a Minecraft profile
async fn account_from_profile(client: &reqwest::Client, profile: &Profile) -> Result<Account, String> {
    let active_skin = profile.skins.iter().find(|s| s.state == "ACTIVE");
    let skin = match active_skin {
        Some(s) => fetch_as_data_url(client, &s.url).await?,
        None => String::new(),
    };
    let model = match active_skin.map(|s| s.variant.as_str()) {
        Some("SLIM") => "slim",
        _ => "default",
    }
    .to_string();
    let cape = match profile.capes.iter().find(|c| c.state == "ACTIVE") {
        Some(c) => Some(fetch_as_data_url(client, &c.url).await?),
        None => None,
    };
    Ok(Account { uuid: profile.id.clone(), name: profile.name.clone(), skin, model, cape })
}

/// Error text the frontend recognises: the account has to be added again (no or expired token)
pub const SIGN_IN_AGAIN: &str = "SIGN_IN_AGAIN";

/// Fresh Minecraft session for starting the game, from the stored refresh token
pub async fn launch_session(store: &TokenStore, uuid: &str) -> Result<Session, String> {
    let _one_at_a_time = store.signing_in.lock().await;
    let client = reqwest::Client::new();

    // A token from earlier in this run is enough while Minecraft still accepts it
    if let Some(access_token) = store.cached_session(uuid) {
        if let Ok(profile) = fetch_profile(&client, &access_token).await {
            let xuid = xuid_from_token(&access_token).unwrap_or_else(|| "0".into());
            return Ok(Session { uuid: profile.id, name: profile.name, access_token, xuid });
        }
        store.cache_session(uuid, None);
    }

    let refresh = store.get(uuid).ok_or(SIGN_IN_AGAIN)?;
    let response = client
        .post("https://login.microsoftonline.com/consumers/oauth2/v2.0/token")
        .form(&[
            ("client_id", CLIENT_ID),
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh.as_str()),
            ("scope", SCOPE),
        ])
        .send()
        .await
        .map_err(|e| format!("No connection to Microsoft ({e})"))?;
    if !response.status().is_success() {
        // Expired or revoked: forget it, the user has to sign in again
        let body: serde_json::Value = response.json().await.unwrap_or_default();
        eprintln!("[auth] refresh rejected: {body}");
        let _ = store.remove(uuid);
        return Err(SIGN_IN_AGAIN.into());
    }
    let ms: MsToken = response.json().await.map_err(|e| e.to_string())?;
    if let Some(new_refresh) = &ms.refresh_token {
        store.set(uuid, new_refresh)?;
    }
    let access_token = minecraft_token(&client, &ms.access_token).await?;
    let profile = fetch_profile(&client, &access_token).await?;
    store.cache_session(uuid, Some(&access_token));
    let xuid = xuid_from_token(&access_token).unwrap_or_else(|| "0".into());
    Ok(Session {
        uuid: profile.id,
        name: profile.name,
        access_token,
        xuid,
    })
}

/// The Minecraft token is a JWT; its payload carries the Xbox user id ("xuid")
fn xuid_from_token(token: &str) -> Option<String> {
    let payload = token.split('.').nth(1)?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload.trim_end_matches('='))
        .ok()?;
    let json: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    match json.get("xuid")? {
        serde_json::Value::String(s) => Some(s.clone()),
        serde_json::Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

fn urldecode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                    out.push(v);
                    i += 3;
                    continue;
                }
                out.push(b'%');
                i += 1;
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn urlencode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

// ---------------------------------------------------------------- profile page

/// A cape the account owns
#[derive(Serialize, Clone)]
pub struct CapeInfo {
    pub id: String,
    pub name: String,
    /// The cape texture as data URL (64×32, the front is the 10×16 area at 1,1)
    pub texture: String,
    pub active: bool,
}

#[derive(Serialize)]
pub struct ProfileDetails {
    pub account: Account,
    pub capes: Vec<CapeInfo>,
}

const PROFILE_API: &str = "https://api.minecraftservices.com/minecraft/profile";

async fn details(client: &reqwest::Client, token: &str) -> Result<ProfileDetails, String> {
    let profile = fetch_profile(client, token).await?;
    let account = account_from_profile(client, &profile).await?;
    let mut capes = Vec::new();
    for cape in &profile.capes {
        capes.push(CapeInfo {
            id: cape.id.clone(),
            name: if cape.alias.is_empty() { "Cape".into() } else { cape.alias.clone() },
            texture: fetch_as_data_url(client, &cape.url).await?,
            active: cape.state == "ACTIVE",
        });
    }
    Ok(ProfileDetails { account, capes })
}

/// Current skin, model and all capes of the account
pub async fn profile_details(store: &TokenStore, uuid: &str) -> Result<ProfileDetails, String> {
    let session = launch_session(store, uuid).await?;
    details(&reqwest::Client::new(), &session.access_token).await
}

/// Width and height from a PNG header, without decoding the image
fn png_size(bytes: &[u8]) -> Option<(u32, u32)> {
    const SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
    if bytes.len() < 24 || bytes[..8] != SIGNATURE || &bytes[12..16] != b"IHDR" {
        return None;
    }
    let w = u32::from_be_bytes([bytes[16], bytes[17], bytes[18], bytes[19]]);
    let h = u32::from_be_bytes([bytes[20], bytes[21], bytes[22], bytes[23]]);
    Some((w, h))
}

/// Uploads a skin PNG (64×64 or legacy 64×32) as the account's new skin
pub async fn upload_skin(store: &TokenStore, uuid: &str, png: Vec<u8>, slim: bool) -> Result<ProfileDetails, String> {
    match png_size(&png) {
        Some((64, 64)) | Some((64, 32)) => {}
        Some((w, h)) => return Err(format!("A skin has to be 64×64 pixels, this one is {w}×{h}")),
        None => return Err("That file is not a PNG image".into()),
    }
    let session = launch_session(store, uuid).await?;
    let client = reqwest::Client::new();
    let part = reqwest::multipart::Part::bytes(png).file_name("skin.png").mime_str("image/png").map_err(|e| e.to_string())?;
    let form = reqwest::multipart::Form::new().text("variant", if slim { "slim" } else { "classic" }).part("file", part);
    let response = client
        .post(format!("{PROFILE_API}/skins"))
        .bearer_auth(&session.access_token)
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("No connection to Minecraft ({e})"))?;
    match response.status().as_u16() {
        200..=299 => {}
        429 => return Err("Too many skin changes, wait a minute and try again".into()),
        400 => return Err("Minecraft rejected this skin file".into()),
        code => return Err(format!("Skin upload failed ({code})")),
    }
    details(&client, &session.access_token).await
}

/// Shows the given cape, or none
pub async fn set_cape(store: &TokenStore, uuid: &str, cape_id: Option<String>) -> Result<ProfileDetails, String> {
    let session = launch_session(store, uuid).await?;
    let client = reqwest::Client::new();
    let url = format!("{PROFILE_API}/capes/active");
    let request = match &cape_id {
        Some(id) => client.put(&url).json(&json!({ "capeId": id })),
        None => client.delete(&url),
    };
    let response = request
        .bearer_auth(&session.access_token)
        .send()
        .await
        .map_err(|e| format!("No connection to Minecraft ({e})"))?;
    match response.status().as_u16() {
        200..=299 => {}
        429 => return Err("Too many changes, wait a minute and try again".into()),
        code => return Err(format!("Could not change the cape ({code})")),
    }
    details(&client, &session.access_token).await
}
