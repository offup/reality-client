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
}

impl TokenStore {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            lock: Mutex::new(()),
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
    state: String,
    url: String,
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
    let mc: McToken = client
        .post("https://api.minecraftservices.com/authentication/login_with_xbox")
        .json(&json!({ "identityToken": format!("XBL3.0 x={};{}", uhs, xsts.token) }))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|_| {
            "Minecraft sign-in failed (is the Azure app approved for the Minecraft API?)"
                .to_string()
        })?
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

    let active_skin = profile.skins.iter().find(|s| s.state == "ACTIVE");
    let skin = match active_skin {
        Some(s) => fetch_as_data_url(&client, &s.url).await?,
        None => String::new(),
    };
    let model = match active_skin.map(|s| s.variant.as_str()) {
        Some("SLIM") => "slim",
        _ => "default",
    }
    .to_string();
    let cape = match profile.capes.iter().find(|c| c.state == "ACTIVE") {
        Some(c) => Some(fetch_as_data_url(&client, &c.url).await?),
        None => None,
    };

    Ok(Account {
        uuid: profile.id,
        name: profile.name,
        skin,
        model,
        cape,
    })
}

/// Error text the frontend recognises: the account has to be added again (no or expired token)
pub const SIGN_IN_AGAIN: &str = "SIGN_IN_AGAIN";

/// Fresh Minecraft session for starting the game, from the stored refresh token
pub async fn launch_session(store: &TokenStore, uuid: &str) -> Result<Session, String> {
    let refresh = store.get(uuid).ok_or(SIGN_IN_AGAIN)?;
    let client = reqwest::Client::new();
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
