#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            self_deploy_tauri_core::commands::invoke_channel
        ])
        .run(tauri::generate_context!())
        .expect("failed to run SelfDeploy");
}
