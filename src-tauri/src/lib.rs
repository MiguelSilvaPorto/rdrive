mod explorer;
mod rclone;
mod transfers;

use explorer::{
    create_cloud_folder, create_share_link, delete_cloud_paths, download_cloud_file,
    empty_cloud_trash, list_cloud_files, list_cloud_files_stream, list_shared_drives,
    preview_cloud_file, transfer_cloud_path, untrash_cloud_paths,
};
use rclone::{
    check_system_environment, create_remote_oauth, delete_remote, get_remote_about,
    install_rclone, list_oauth_providers, list_remotes, mount_remote, unmount_remote, AppState,
};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Manager, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use transfers::{
    cancel_transfer, list_transfers, load_persisted_jobs, pause_transfer, start_transfer,
    TransferState,
};

/// Updates the tray icon's hover tooltip with live transfer speed/total.
/// This is the closest a regular Linux app can get to a "status bar" —
/// desktop panels don't let ordinary applications draw text into them,
/// that's reserved for panel widgets/applets, so the tooltip is the
/// honest, achievable equivalent.
#[tauri::command]
fn update_tray_status(tray: tauri::State<'_, tauri::tray::TrayIcon>, text: String) -> Result<(), String> {
    let tooltip = if text.trim().is_empty() {
        "Rdrive".to_string()
    } else {
        format!("Rdrive\n{text}")
    };
    tray.set_tooltip(Some(&tooltip)).map_err(|e| e.to_string())
}

fn toggle_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        toggle_main_window(app);
                    }
                })
                .build(),
        )
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
            list_cloud_files_stream,
            delete_cloud_paths,
            transfer_cloud_path,
            create_cloud_folder,
            create_share_link,
            download_cloud_file,
            preview_cloud_file,
            empty_cloud_trash,
            list_shared_drives,
            untrash_cloud_paths,
            update_tray_status,
        ])
        .setup(|app| {
            let toggle_shortcut = Shortcut::new(Some(Modifiers::SHIFT | Modifiers::ALT), Code::KeyD);
            if let Err(e) = app.global_shortcut().register(toggle_shortcut) {
                eprintln!("[Rdrive] Falha ao registrar atalho global Shift+Alt+D: {e}");
            }

            let show_item = MenuItem::with_id(app, "show", "Mostrar Rdrive", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            let tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Rdrive")
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
                        toggle_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            app.manage(tray);

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
