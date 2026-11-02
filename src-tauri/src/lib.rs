mod auth;
mod launcher;

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
            delete_instance
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
