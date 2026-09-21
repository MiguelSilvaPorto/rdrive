mod explorer;
mod rclone;
mod transfers;

use explorer::{create_cloud_folder, delete_cloud_paths, list_cloud_files, transfer_cloud_path};
use rclone::{
    check_system_environment, create_remote_oauth, delete_remote, get_remote_about,
    install_rclone, list_oauth_providers, list_remotes, mount_remote, unmount_remote, AppState,
};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Manager, WindowEvent};
use transfers::{
    cancel_transfer, list_transfers, load_persisted_jobs, pause_transfer, start_transfer,
    TransferState,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::default())
        .manage(TransferState {
            jobs: std::sync::Mutex::new(load_persisted_jobs()),
            pids: Default::default(),
        })
        .invoke_handler(tauri::generate_handler![
            check_system_environment,
            list_remotes,
            mount_remote,
            unmount_remote,
            list_oauth_providers,
            create_remote_oauth,
            delete_remote,
            get_remote_about,
            install_rclone,
            start_transfer,
            list_transfers,
            pause_transfer,
            cancel_transfer,
            list_cloud_files,
            delete_cloud_paths,
            transfer_cloud_path,
            create_cloud_folder,
        ])
        .setup(|app| {
            let show_item = MenuItem::with_id(app, "show", "Mostrar Rdrive", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        if let Some(state) = app.try_state::<AppState>() {
                            rclone::unmount_all(&state);
                        }
                        if let Some(state) = app.try_state::<TransferState>() {
                            transfers::interrupt_all(&state);
                        }
                        app.exit(0);
                    }
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        button_state: tauri::tray::MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the window just hides it: mounts and transfers keep running
            // in the background, reachable again from the tray icon.
            if let WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .build(tauri::generate_context!())
        .expect("erro ao inicializar aplicação Rdrive")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = app_handle.try_state::<AppState>() {
                    rclone::unmount_all(&state);
                }
                if let Some(state) = app_handle.try_state::<TransferState>() {
                    transfers::interrupt_all(&state);
                }
            }
        });
}
