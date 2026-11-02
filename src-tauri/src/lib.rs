mod auth;
mod launcher;
mod modrinth;

use std::sync::atomic::Ordering;
use tauri::Manager;

#[tauri::command]
async fn start_microsoft_login(
    state: tauri::State<'_, auth::LoginState>,
    store: tauri::State<'_, auth::TokenStore>,
) -> Result<auth::Account, String> {
    state.cancel.store(false, Ordering::Relaxed);
    auth::microsoft_login(state.cancel.clone(), &store).await
}

#[tauri::command]
fn cancel_microsoft_login(state: tauri::State<'_, auth::LoginState>) {
    state.cancel.store(true, Ordering::Relaxed);
}

/// Removing an account also deletes its stored refresh token
#[tauri::command]
fn forget_account(store: tauri::State<'_, auth::TokenStore>, uuid: String) -> Result<(), String> {
    store.remove(&uuid)
}

#[tauri::command]
async fn list_versions() -> Result<Vec<String>, String> {
    launcher::list_versions().await
}

/// Resolves once the game process is running; progress and exit arrive as events
#[tauri::command]
async fn launch_game(
    app: tauri::AppHandle,
    state: tauri::State<'_, launcher::LaunchState>,
    store: tauri::State<'_, auth::TokenStore>,
    options: launcher::LaunchOptions,
) -> Result<(), String> {
    launcher::launch(app, &store, state.running.clone(), options).await
}

#[tauri::command]
fn open_instance_folder(app: tauri::AppHandle, instance_id: String) -> Result<(), String> {
    let dir = launcher::instance_dir(&app, &instance_id)?;
    std::fs::create_dir_all(dir.join("mods")).map_err(|e| e.to_string())?;
    open::that(&dir).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_instance(
    app: tauri::AppHandle,
    state: tauri::State<'_, launcher::LaunchState>,
    instance_id: String,
) -> Result<(), String> {
    if state.running.load(Ordering::SeqCst) {
        return Err("Close Minecraft before deleting an instance".into());
    }
    launcher::delete_instance(&app, &instance_id)
}

// ---------------------------------------------------------------- profile (skin, cape)

#[tauri::command]
async fn profile_details(store: tauri::State<'_, auth::TokenStore>, uuid: String) -> Result<auth::ProfileDetails, String> {
    auth::profile_details(&store, &uuid).await
}

/// The PNG arrives base64 encoded from the file input in the page
#[tauri::command]
async fn profile_upload_skin(
    store: tauri::State<'_, auth::TokenStore>,
    uuid: String,
    png_base64: String,
    slim: bool,
) -> Result<auth::ProfileDetails, String> {
    use base64::Engine;
    let png = base64::engine::general_purpose::STANDARD.decode(png_base64.trim()).map_err(|_| "Could not read the file".to_string())?;
    auth::upload_skin(&store, &uuid, png, slim).await
}

#[tauri::command]
async fn profile_set_cape(
    store: tauri::State<'_, auth::TokenStore>,
    uuid: String,
    cape_id: Option<String>,
) -> Result<auth::ProfileDetails, String> {
    auth::set_cape(&store, &uuid, cape_id).await
}

// ---------------------------------------------------------------- mods (Modrinth)

#[tauri::command]
async fn modrinth_search(
    query: String,
    game_version: String,
    category: Option<String>,
    sort: Option<String>,
    offset: Option<u32>,
) -> Result<modrinth::SearchResult, String> {
    modrinth::search(&query, &game_version, category.as_deref(), sort.as_deref().unwrap_or("relevance"), offset.unwrap_or(0)).await
}

#[tauri::command]
fn mods_list(app: tauri::AppHandle, instance_id: String) -> Result<Vec<modrinth::InstalledMod>, String> {
    modrinth::list(&launcher::instance_dir(&app, &instance_id)?)
}

/// Installs a Modrinth project and its required dependencies into the instance
#[tauri::command]
async fn mods_install(
    app: tauri::AppHandle,
    instance_id: String,
    project_id: String,
    game_version: String,
) -> Result<Vec<modrinth::InstalledMod>, String> {
    modrinth::install(&launcher::instance_dir(&app, &instance_id)?, &project_id, &game_version).await
}

#[tauri::command]
fn mods_set_enabled(
    app: tauri::AppHandle,
    instance_id: String,
    filename: String,
    enabled: bool,
) -> Result<Vec<modrinth::InstalledMod>, String> {
    modrinth::set_enabled(&launcher::instance_dir(&app, &instance_id)?, &filename, enabled)
}

#[tauri::command]
fn mods_remove(app: tauri::AppHandle, instance_id: String, filename: String) -> Result<Vec<modrinth::InstalledMod>, String> {
    modrinth::remove(&launcher::instance_dir(&app, &instance_id)?, &filename)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(auth::LoginState::default())
        .manage(launcher::LaunchState::default())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            app.manage(auth::TokenStore::new(dir.join("accounts.json")));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_microsoft_login,
            cancel_microsoft_login,
            forget_account,
            list_versions,
            launch_game,
            open_instance_folder,
            delete_instance,
            modrinth_search,
            mods_list,
            mods_install,
            mods_set_enabled,
            mods_remove,
            profile_details,
            profile_upload_skin,
            profile_set_cape
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
