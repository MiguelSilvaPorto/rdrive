mod rclone;

use rclone::{
    check_system_environment, create_remote_oauth, delete_remote, install_rclone,
    list_oauth_providers, list_remotes, mount_remote, unmount_remote, AppState,
};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            check_system_environment,
            list_remotes,
            mount_remote,
            unmount_remote,
            list_oauth_providers,
            create_remote_oauth,
            delete_remote,
            install_rclone,
        ])
        .build(tauri::generate_context!())
        .expect("erro ao inicializar aplicação Rdrive")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = app_handle.try_state::<AppState>() {
                    rclone::unmount_all(&state);
                }
            }
        });
}
