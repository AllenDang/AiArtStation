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
    get_gallery, search_gallery, get_image_detail, delete_gallery_image, regenerate_thumbnails,
    add_image_tag, remove_image_tag, get_asset_type_counts, get_gallery_by_asset_type, combine_image_with_mask,
    // Files
    read_image_file, read_image_raw, open_folder, open_file, reveal_file, path_exists, ensure_directory, get_file_info,
    // Projects
    create_project, get_projects, get_project, update_project, delete_project,
    // Assets
    create_asset, get_assets, update_asset, delete_asset,
    // Videos
    generate_video, poll_video_task, get_videos, get_video_detail, get_pending_videos, delete_video, add_video_tag, remove_video_tag,
    // State
    AppState, DbState,
};
use storage::{ConfigStore, Database};
use std::path::PathBuf;
use std::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            // Get app data directory for config storage
            let app_data_dir = app.path().app_data_dir()
                .expect("Failed to get app data directory");

            // Initialize config store
            let config_store = ConfigStore::new(app_data_dir.clone())
                .expect("Failed to initialize config store");

            // Load config to get output directory for database
            let config = config_store.load().unwrap_or_default();
            let output_dir = if config.output_directory.is_empty() {
                // Use default if not configured
                dirs::picture_dir()
                    .map(|p| p.join("AI-ArtStation"))
                    .unwrap_or_else(|| PathBuf::from("./AI-ArtStation"))
            } else {
                PathBuf::from(&config.output_directory)
            };

            // Initialize database in output directory
            let database = Database::new(output_dir)
                .expect("Failed to initialize database");

            // Cleanup missing files on startup
            if let Ok((images, videos)) = database.cleanup_missing_files() {
                if images > 0 || videos > 0 {
                    println!("Cleanup: removed {} images and {} videos with missing files", images, videos);
                }
            }

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
            regenerate_thumbnails,
            add_image_tag,
            remove_image_tag,
            get_asset_type_counts,
            get_gallery_by_asset_type,
            combine_image_with_mask,
            // Files
            read_image_file,
            read_image_raw,
            open_folder,
            open_file,
            reveal_file,
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
            add_video_tag,
            remove_video_tag,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
