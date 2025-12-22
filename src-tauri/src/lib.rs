mod api;
mod commands;
mod crypto;
mod image_processing;
mod storage;

use tauri::Manager;
use commands::{
    // Settings
    load_settings, save_settings, test_connection, clear_settings, get_default_output_dir,
    // Generation
    generate_image, prepare_reference_image,
    // Gallery
    get_gallery, search_gallery, get_image_detail, delete_gallery_image,
    // Files
    read_image_file, read_image_raw, open_folder, open_file, path_exists, ensure_directory, get_file_info,
    // Projects
    create_project, get_projects, get_project, update_project, delete_project,
    // Assets
    create_asset, get_assets, update_asset, delete_asset,
    // Videos
    generate_video, poll_video_task, get_videos, get_video_detail, get_pending_videos, delete_video,
    // State
    AppState, DbState,
};
use storage::{ConfigStore, Database};
use std::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            // Get app data directory
            let app_data_dir = app.path().app_data_dir()
                .expect("Failed to get app data directory");

            // Initialize config store
            let config_store = ConfigStore::new(app_data_dir.clone())
                .expect("Failed to initialize config store");

            // Initialize database
            let database = Database::new(app_data_dir)
                .expect("Failed to initialize database");

            // Manage state
            app.manage(AppState {
                config_store: Mutex::new(config_store),
            });
            app.manage(DbState {
                database: Mutex::new(database),
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Settings
            load_settings,
            save_settings,
            test_connection,
            clear_settings,
            get_default_output_dir,
            // Generation
            generate_image,
            prepare_reference_image,
            // Gallery
            get_gallery,
            search_gallery,
            get_image_detail,
            delete_gallery_image,
            // Files
            read_image_file,
            read_image_raw,
            open_folder,
            open_file,
            path_exists,
            ensure_directory,
            get_file_info,
            // Projects
            create_project,
            get_projects,
            get_project,
            update_project,
            delete_project,
            // Assets
            create_asset,
            get_assets,
            update_asset,
            delete_asset,
            // Videos
            generate_video,
            poll_video_task,
            get_videos,
            get_video_detail,
            get_pending_videos,
            delete_video,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
