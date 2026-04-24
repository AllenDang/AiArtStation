mod commands;
mod crypto;
mod image_processing;
mod providers;
mod storage;

use commands::{
    // State
    AppState,
    add_image_tag,
    add_video_tag,
    // Stem model management
    check_stem_model_status,
    combine_image_with_mask,
    // Assets
    create_asset,
    // Projects
    create_project,
    delete_asset,
    delete_gallery_image,
    delete_project,
    delete_provider,
    delete_stem_model,
    delete_video,
    download_stem_model,
    ensure_directory,
    // Generation
    generate_image,
    // Videos
    generate_video,
    get_asset_type_counts,
    get_assets,
    get_default_output_dir,
    get_file_info,
    // Gallery
    get_gallery,
    get_gallery_by_asset_type,
    get_image_detail,
    get_pending_videos,
    get_project,
    get_projects,
    get_video_detail,
    get_videos,
    get_videos_by_asset_type,
    // Settings / providers
    list_provider_types,
    list_providers,
    load_app_settings,
    open_file,
    open_folder,
    path_exists,
    poll_video_task,
    prepare_reference_image,
    // Files
    read_image_file,
    read_image_raw,
    read_media_file,
    regenerate_thumbnails,
    remove_image_tag,
    remove_video_tag,
    reveal_file,
    save_app_settings,
    save_provider,
    search_gallery,
    test_provider_connection,
    update_asset,
    update_project,
};
use providers::ProviderRegistry;
use std::path::PathBuf;
use std::sync::Mutex;
use storage::Database;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|_app| {
            let output_dir = dirs::picture_dir()
                .map(|p| p.join("AI-ArtStation"))
                .unwrap_or_else(|| PathBuf::from("./AI-ArtStation"));

            let database = Database::new(output_dir).expect("Failed to initialize database");

            if let Ok((images, videos)) = database.cleanup_missing_files()
                && (images > 0 || videos > 0)
            {
                println!(
                    "Cleanup: removed {} images and {} videos with missing files",
                    images, videos
                );
            }

            _app.manage(AppState {
                db: Mutex::new(database),
                registry: ProviderRegistry::new(),
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Settings / providers
            list_provider_types,
            list_providers,
            save_provider,
            delete_provider,
            test_provider_connection,
            load_app_settings,
            save_app_settings,
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
            // Stem model management
            check_stem_model_status,
            download_stem_model,
            delete_stem_model,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
