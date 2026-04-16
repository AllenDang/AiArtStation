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
    read_image_file, read_image_raw, read_media_file, open_folder, open_file, reveal_file, path_exists, ensure_directory, get_file_info,
    // Projects
    create_project, get_projects, get_project, update_project, delete_project,
    // Assets
    create_asset, get_assets, update_asset, delete_asset,
    // Videos
    generate_video, poll_video_task, get_videos, get_videos_by_asset_type, get_video_detail, get_pending_videos, delete_video, add_video_tag, remove_video_tag,
    // State
    DbState,
};
use storage::Database;
use std::path::PathBuf;
use std::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|_app| {
            // Use default output directory for database
            // Config is stored in the database itself
            let output_dir = dirs::picture_dir()
                .map(|p| p.join("AI-ArtStation"))
                .unwrap_or_else(|| PathBuf::from("./AI-ArtStation"));

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
            _app.manage(DbState {
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
            read_media_file,
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
            get_videos_by_asset_type,
            get_video_detail,
            get_pending_videos,
            delete_video,
            add_video_tag,
            remove_video_tag,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
