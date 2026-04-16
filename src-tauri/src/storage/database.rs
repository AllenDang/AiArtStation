use crate::crypto::{decrypt, derive_key, encrypt};
use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

const DB_FILE: &str = "data.db";
const CONFIG_KEY: &str = "app_config";
const DEFAULT_PASSWORD: &str = "ai-artstation-default";

// ============================================================================
// Config Structure
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub base_url: String,
    pub api_token: String,
    pub image_model: String,
    pub video_model: String,
    pub output_directory: String,
    pub output_format: String,
    pub default_size: String,
    pub default_aspect_ratio: String,
    pub watermark: bool,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            base_url: String::new(),
            api_token: String::new(),
            image_model: String::new(),
            video_model: String::new(),
            output_directory: get_default_output_dir(),
            output_format: "jpeg".to_string(),
            default_size: "2K".to_string(),
            default_aspect_ratio: "1:1".to_string(),
            watermark: false,
        }
    }
}

fn get_default_output_dir() -> String {
    dirs::picture_dir()
        .map(|p| p.join("AI-ArtStation"))
        .unwrap_or_else(|| PathBuf::from("./AI-ArtStation"))
        .to_string_lossy()
        .to_string()
}

// ============================================================================
// Data Structures
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectRecord {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssetRecord {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub asset_type: String, // "character", "background", "style", "prop"
    pub tags: Vec<String>,
    pub file_path: String,
    pub thumbnail: Option<String>, // Base64 thumbnail
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageRecord {
    pub id: String,
    pub project_id: Option<String>,
    pub batch_id: Option<String>, // Groups sequential images together
    pub file_path: String,
    pub thumbnail: Option<String>, // Pre-generated base64 thumbnail for fast loading
    pub prompt: String,
    pub model: String,
    pub size: String,
    pub aspect_ratio: String,
    pub generation_type: String, // "text-to-image", "image-to-image", "multi-fusion"
    pub reference_images: Vec<String>,
    pub tokens_used: i64,
    pub created_at: DateTime<Utc>,
    pub asset_types: Vec<String>, // ["character", "background", "style", "prop"] - for filtering, multiple allowed
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoRecord {
    pub id: String,
    pub project_id: Option<String>,
    pub task_id: String,           // API task ID for polling
    pub file_path: Option<String>, // Local path after download
    pub first_frame_thumbnail: Option<String>, // Base64 thumbnail of first frame
    pub last_frame_thumbnail: Option<String>,  // Base64 thumbnail of last frame
    pub first_frame_path: Option<String>,      // Full-res first frame image path
    pub last_frame_path: Option<String>,       // Full-res last frame image path
    pub vocals_path: Option<String>,           // Separated vocals audio path
    pub bgm_path: Option<String>,              // Separated BGM/accompaniment audio path
    pub prompt: String,
    pub model: String,
    pub generation_type: String, // "text-to-video", "image-to-video-first", "image-to-video-both"
    pub source_image_id: Option<String>,
    pub resolution: Option<String>,
    pub duration: Option<f64>,
    pub fps: Option<i32>,
    pub aspect_ratio: Option<String>,
    pub status: String, // "pending", "processing", "completed", "failed"
    pub error_message: Option<String>,
    pub tokens_used: Option<i64>,
    pub created_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
    pub asset_types: Vec<String>, // ["character", "background", "style", "prop"] - for filtering
}

#[derive(Debug, Default)]
pub struct VideoStatusUpdate<'a> {
    pub status: &'a str,
    pub file_path: Option<&'a str>,
    pub first_frame_thumbnail: Option<&'a str>,
    pub last_frame_thumbnail: Option<&'a str>,
    pub first_frame_path: Option<&'a str>,
    pub last_frame_path: Option<&'a str>,
    pub vocals_path: Option<&'a str>,
    pub bgm_path: Option<&'a str>,
    pub resolution: Option<&'a str>,
    pub duration: Option<f64>,
    pub fps: Option<i32>,
    pub tokens_used: Option<i64>,
    pub error_message: Option<&'a str>,
}

pub struct Database {
    conn: Connection,
}

impl Database {
    pub fn new(app_data_dir: PathBuf) -> Result<Self> {
        std::fs::create_dir_all(&app_data_dir)
            .context("Failed to create app data directory")?;

        let db_path = app_data_dir.join(DB_FILE);
        let conn = Connection::open(&db_path)
            .context("Failed to open database")?;

        let db = Self { conn };
        db.init_tables()?;
        Ok(db)
    }

    fn init_tables(&self) -> Result<()> {
        // Config table (key-value store for encrypted config)
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS config (
                key TEXT PRIMARY KEY,
                value BLOB NOT NULL
            )",
            [],
        ).context("Failed to create config table")?;

        // Projects table
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )",
            [],
        ).context("Failed to create projects table")?;

        // Assets table
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS assets (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                name TEXT NOT NULL,
                asset_type TEXT NOT NULL,
                tags TEXT NOT NULL,
                file_path TEXT NOT NULL,
                thumbnail TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
            )",
            [],
        ).context("Failed to create assets table")?;

        // Images table
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS images (
                id TEXT PRIMARY KEY,
                project_id TEXT,
                file_path TEXT NOT NULL,
                prompt TEXT NOT NULL,
                model TEXT NOT NULL,
                size TEXT NOT NULL,
                aspect_ratio TEXT NOT NULL,
                generation_type TEXT NOT NULL,
                reference_images TEXT NOT NULL,
                tokens_used INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
            )",
            [],
        ).context("Failed to create images table")?;

        // Videos table
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS videos (
                id TEXT PRIMARY KEY,
                project_id TEXT,
                task_id TEXT NOT NULL,
                file_path TEXT,
                prompt TEXT NOT NULL,
                model TEXT NOT NULL,
                generation_type TEXT NOT NULL,
                source_image_id TEXT,
                resolution TEXT,
                duration REAL,
                fps INTEGER,
                aspect_ratio TEXT,
                status TEXT NOT NULL,
                error_message TEXT,
                tokens_used INTEGER,
                created_at TEXT NOT NULL,
                completed_at TEXT,
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
                FOREIGN KEY (source_image_id) REFERENCES images(id) ON DELETE SET NULL
            )",
            [],
        ).context("Failed to create videos table")?;

        // Run migrations for existing databases
        self.run_migrations()?;

        // Create indexes for faster queries
        self.conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_images_created_at ON images(created_at DESC)",
            [],
        ).context("Failed to create images index")?;

        self.conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_images_project_id ON images(project_id)",
            [],
        ).context("Failed to create images project index")?;

        self.conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_assets_project_id ON assets(project_id)",
            [],
        ).context("Failed to create assets index")?;

        self.conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_videos_project_id ON videos(project_id)",
            [],
        ).context("Failed to create videos project index")?;

        self.conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(status)",
            [],
        ).context("Failed to create videos status index")?;

        Ok(())
    }

    fn run_migrations(&self) -> Result<()> {
        // Migration: Add project_id column to images table if it doesn't exist
        let columns: Vec<String> = self.conn
            .prepare("PRAGMA table_info(images)")?
            .query_map([], |row| row.get::<_, String>(1))?
            .filter_map(|r| r.ok())
            .collect();

        if !columns.contains(&"project_id".to_string()) {
            self.conn.execute(
                "ALTER TABLE images ADD COLUMN project_id TEXT REFERENCES projects(id)",
                [],
            ).context("Failed to add project_id to images table")?;
        }

        // Migration: Add batch_id column to images table for grouping sequential images
        if !columns.contains(&"batch_id".to_string()) {
            self.conn.execute(
                "ALTER TABLE images ADD COLUMN batch_id TEXT",
                [],
            ).context("Failed to add batch_id to images table")?;

            // Create index for batch_id queries
            self.conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_images_batch_id ON images(batch_id)",
                [],
            ).context("Failed to create batch_id index")?;
        }

        // Migration: Add thumbnail column to images table for fast loading
        if !columns.contains(&"thumbnail".to_string()) {
            self.conn.execute(
                "ALTER TABLE images ADD COLUMN thumbnail TEXT",
                [],
            ).context("Failed to add thumbnail to images table")?;
        }

        // Migration: Add asset_type column to images table for categorization/filtering (legacy)
        if !columns.contains(&"asset_type".to_string()) {
            self.conn.execute(
                "ALTER TABLE images ADD COLUMN asset_type TEXT",
                [],
            ).context("Failed to add asset_type to images table")?;
        }

        // Migration: Add asset_types column (JSON array) for multiple tags per image
        if !columns.contains(&"asset_types".to_string()) {
            self.conn.execute(
                "ALTER TABLE images ADD COLUMN asset_types TEXT NOT NULL DEFAULT '[]'",
                [],
            ).context("Failed to add asset_types to images table")?;

            // Migrate existing asset_type data to asset_types array
            self.conn.execute(
                "UPDATE images SET asset_types = json_array(asset_type) WHERE asset_type IS NOT NULL AND asset_type != ''",
                [],
            ).context("Failed to migrate asset_type to asset_types")?;
        }

        // Migration: Video frame columns
        let video_columns: Vec<String> = self.conn
            .prepare("PRAGMA table_info(videos)")?
            .query_map([], |row| row.get::<_, String>(1))?
            .filter_map(|r| r.ok())
            .collect();

        // Migration: Rename thumbnail to first_frame_thumbnail (SQLite doesn't support RENAME COLUMN in older versions)
        // So we add new column and copy data if old column exists
        if video_columns.contains(&"thumbnail".to_string()) && !video_columns.contains(&"first_frame_thumbnail".to_string()) {
            self.conn.execute(
                "ALTER TABLE videos ADD COLUMN first_frame_thumbnail TEXT",
                [],
            ).context("Failed to add first_frame_thumbnail to videos table")?;
            // Copy existing thumbnail data to first_frame_thumbnail
            self.conn.execute(
                "UPDATE videos SET first_frame_thumbnail = thumbnail WHERE thumbnail IS NOT NULL",
                [],
            ).context("Failed to migrate thumbnail to first_frame_thumbnail")?;
        } else if !video_columns.contains(&"first_frame_thumbnail".to_string()) {
            self.conn.execute(
                "ALTER TABLE videos ADD COLUMN first_frame_thumbnail TEXT",
                [],
            ).context("Failed to add first_frame_thumbnail to videos table")?;
        }

        // Migration: Add last_frame_thumbnail column
        if !video_columns.contains(&"last_frame_thumbnail".to_string()) {
            self.conn.execute(
                "ALTER TABLE videos ADD COLUMN last_frame_thumbnail TEXT",
                [],
            ).context("Failed to add last_frame_thumbnail to videos table")?;
        }

        // Migration: Add first_frame_path column
        if !video_columns.contains(&"first_frame_path".to_string()) {
            self.conn.execute(
                "ALTER TABLE videos ADD COLUMN first_frame_path TEXT",
                [],
            ).context("Failed to add first_frame_path to videos table")?;
        }

        // Migration: Add last_frame_path column
        if !video_columns.contains(&"last_frame_path".to_string()) {
            self.conn.execute(
                "ALTER TABLE videos ADD COLUMN last_frame_path TEXT",
                [],
            ).context("Failed to add last_frame_path to videos table")?;
        }

        // Migration: Add vocals_path column for separated vocals audio
        if !video_columns.contains(&"vocals_path".to_string()) {
            self.conn.execute(
                "ALTER TABLE videos ADD COLUMN vocals_path TEXT",
                [],
            ).context("Failed to add vocals_path to videos table")?;
        }

        // Migration: Add bgm_path column for separated BGM audio
        if !video_columns.contains(&"bgm_path".to_string()) {
            self.conn.execute(
                "ALTER TABLE videos ADD COLUMN bgm_path TEXT",
                [],
            ).context("Failed to add bgm_path to videos table")?;
        }

        // Migration: Add asset_types column to videos (JSON array for tags)
        if !video_columns.contains(&"asset_types".to_string()) {
            self.conn.execute(
                "ALTER TABLE videos ADD COLUMN asset_types TEXT NOT NULL DEFAULT '[]'",
                [],
            ).context("Failed to add asset_types to videos table")?;
        }

        Ok(())
    }

    // ========================================================================
    // Config Methods
    // ========================================================================

    /// Save config to database (encrypted)
    pub fn save_config(&self, config: &AppConfig) -> Result<()> {
        let json = serde_json::to_string(config)
            .context("Failed to serialize config")?;

        let key = derive_key(DEFAULT_PASSWORD);
        let encrypted = encrypt(json.as_bytes(), &key)
            .context("Failed to encrypt config")?;

        self.conn.execute(
            "INSERT OR REPLACE INTO config (key, value) VALUES (?1, ?2)",
            params![CONFIG_KEY, encrypted],
        ).context("Failed to save config")?;

        Ok(())
    }

    /// Load config from database (decrypted)
    pub fn load_config(&self) -> Result<AppConfig> {
        let result: rusqlite::Result<Vec<u8>> = self.conn.query_row(
            "SELECT value FROM config WHERE key = ?1",
            params![CONFIG_KEY],
            |row| row.get(0),
        );

        match result {
            Ok(encrypted) => {
                let key = derive_key(DEFAULT_PASSWORD);
                let decrypted = decrypt(&encrypted, &key)
                    .context("Failed to decrypt config")?;

                let json = String::from_utf8(decrypted)
                    .context("Invalid UTF-8 in config")?;

                serde_json::from_str(&json)
                    .context("Failed to parse config JSON")
            }
            Err(rusqlite::Error::QueryReturnedNoRows) => {
                Ok(AppConfig::default())
            }
            Err(e) => Err(e.into()),
        }
    }

    /// Delete config from database
    pub fn delete_config(&self) -> Result<()> {
        self.conn.execute(
            "DELETE FROM config WHERE key = ?1",
            params![CONFIG_KEY],
        ).context("Failed to delete config")?;
        Ok(())
    }

    // ========================================================================
    // Project Methods
    // ========================================================================

    pub fn insert_project(&self, record: &ProjectRecord) -> Result<()> {
        self.conn.execute(
            "INSERT INTO projects (id, name, description, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                record.id,
                record.name,
                record.description,
                record.created_at.to_rfc3339(),
                record.updated_at.to_rfc3339(),
            ],
        ).context("Failed to insert project")?;
        Ok(())
    }

    pub fn get_projects(&self) -> Result<Vec<ProjectRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, description, created_at, updated_at
             FROM projects ORDER BY updated_at DESC"
        )?;

        let rows = stmt.query_map([], |row| {
            let created_at_str: String = row.get(3)?;
            let updated_at_str: String = row.get(4)?;
            Ok(ProjectRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                created_at: DateTime::parse_from_rfc3339(&created_at_str)
                    .map(|dt| dt.with_timezone(&Utc))
                    .unwrap_or_else(|_| Utc::now()),
                updated_at: DateTime::parse_from_rfc3339(&updated_at_str)
                    .map(|dt| dt.with_timezone(&Utc))
                    .unwrap_or_else(|_| Utc::now()),
            })
        })?;

        rows.collect::<Result<Vec<_>, _>>().context("Failed to get projects")
    }

    pub fn get_project_by_id(&self, id: &str) -> Result<Option<ProjectRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, description, created_at, updated_at FROM projects WHERE id = ?1"
        )?;

        let mut rows = stmt.query_map(params![id], |row| {
            let created_at_str: String = row.get(3)?;
            let updated_at_str: String = row.get(4)?;
            Ok(ProjectRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                created_at: DateTime::parse_from_rfc3339(&created_at_str)
                    .map(|dt| dt.with_timezone(&Utc))
                    .unwrap_or_else(|_| Utc::now()),
                updated_at: DateTime::parse_from_rfc3339(&updated_at_str)
                    .map(|dt| dt.with_timezone(&Utc))
                    .unwrap_or_else(|_| Utc::now()),
            })
        })?;

        match rows.next() {
            Some(Ok(record)) => Ok(Some(record)),
            Some(Err(e)) => Err(e.into()),
            None => Ok(None),
        }
    }

    pub fn update_project(&self, id: &str, name: &str, description: Option<&str>) -> Result<bool> {
        let rows = self.conn.execute(
            "UPDATE projects SET name = ?1, description = ?2, updated_at = ?3 WHERE id = ?4",
            params![name, description, Utc::now().to_rfc3339(), id],
        )?;
        Ok(rows > 0)
    }

    pub fn delete_project(&self, id: &str) -> Result<bool> {
        let rows = self.conn.execute("DELETE FROM projects WHERE id = ?1", params![id])?;
        Ok(rows > 0)
    }

    // ========================================================================
    // Asset Methods
    // ========================================================================

    pub fn insert_asset(&self, record: &AssetRecord) -> Result<()> {
        let tags_json = serde_json::to_string(&record.tags)?;
        self.conn.execute(
            "INSERT INTO assets (id, project_id, name, asset_type, tags, file_path, thumbnail, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                record.id,
                record.project_id,
                record.name,
                record.asset_type,
                tags_json,
                record.file_path,
                record.thumbnail,
                record.created_at.to_rfc3339(),
            ],
        ).context("Failed to insert asset")?;
        Ok(())
    }

    pub fn get_assets_by_project(&self, project_id: &str) -> Result<Vec<AssetRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, project_id, name, asset_type, tags, file_path, thumbnail, created_at
             FROM assets WHERE project_id = ?1 ORDER BY asset_type, name"
        )?;

        let rows = stmt.query_map(params![project_id], |row| {
            let tags_json: String = row.get(4)?;
            let created_at_str: String = row.get(7)?;
            Ok(AssetRecord {
                id: row.get(0)?,
                project_id: row.get(1)?,
                name: row.get(2)?,
                asset_type: row.get(3)?,
                tags: serde_json::from_str(&tags_json).unwrap_or_default(),
                file_path: row.get(5)?,
                thumbnail: row.get(6)?,
                created_at: DateTime::parse_from_rfc3339(&created_at_str)
                    .map(|dt| dt.with_timezone(&Utc))
                    .unwrap_or_else(|_| Utc::now()),
            })
        })?;

        rows.collect::<Result<Vec<_>, _>>().context("Failed to get assets")
    }

    pub fn get_asset_by_id(&self, id: &str) -> Result<Option<AssetRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, project_id, name, asset_type, tags, file_path, thumbnail, created_at
             FROM assets WHERE id = ?1"
        )?;

        let mut rows = stmt.query_map(params![id], |row| {
            let tags_json: String = row.get(4)?;
            let created_at_str: String = row.get(7)?;
            Ok(AssetRecord {
                id: row.get(0)?,
                project_id: row.get(1)?,
                name: row.get(2)?,
                asset_type: row.get(3)?,
                tags: serde_json::from_str(&tags_json).unwrap_or_default(),
                file_path: row.get(5)?,
                thumbnail: row.get(6)?,
                created_at: DateTime::parse_from_rfc3339(&created_at_str)
                    .map(|dt| dt.with_timezone(&Utc))
                    .unwrap_or_else(|_| Utc::now()),
            })
        })?;

        match rows.next() {
            Some(Ok(record)) => Ok(Some(record)),
            Some(Err(e)) => Err(e.into()),
            None => Ok(None),
        }
    }

    pub fn update_asset(&self, id: &str, name: &str, asset_type: &str, tags: &[String]) -> Result<bool> {
        let tags_json = serde_json::to_string(tags)?;
        let rows = self.conn.execute(
            "UPDATE assets SET name = ?1, asset_type = ?2, tags = ?3 WHERE id = ?4",
            params![name, asset_type, tags_json, id],
        )?;
        Ok(rows > 0)
    }

    pub fn delete_asset(&self, id: &str) -> Result<bool> {
        let rows = self.conn.execute("DELETE FROM assets WHERE id = ?1", params![id])?;
        Ok(rows > 0)
    }

    // ========================================================================
    // Image Methods
    // ========================================================================

    pub fn insert_image(&self, record: &ImageRecord) -> Result<()> {
        let reference_json = serde_json::to_string(&record.reference_images)?;
        let asset_types_json = serde_json::to_string(&record.asset_types)?;

        self.conn.execute(
            "INSERT INTO images (id, project_id, batch_id, file_path, thumbnail, prompt, model, size, aspect_ratio, generation_type, reference_images, tokens_used, created_at, asset_types)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            params![
                record.id,
                record.project_id,
                record.batch_id,
                record.file_path,
                record.thumbnail,
                record.prompt,
                record.model,
                record.size,
                record.aspect_ratio,
                record.generation_type,
                reference_json,
                record.tokens_used,
                record.created_at.to_rfc3339(),
                asset_types_json,
            ],
        ).context("Failed to insert image record")?;

        Ok(())
    }

    pub fn get_images_by_project(&self, project_id: &str, limit: i64, offset: i64) -> Result<Vec<ImageRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, project_id, batch_id, file_path, thumbnail, prompt, model, size, aspect_ratio, generation_type, reference_images, tokens_used, created_at, asset_types
             FROM images
             WHERE project_id = ?1
             ORDER BY created_at DESC
             LIMIT ?2 OFFSET ?3"
        )?;

        let rows = stmt.query_map(params![project_id, limit, offset], Self::map_image_row)?;
        rows.collect::<Result<Vec<_>, _>>().context("Failed to get images by project")
    }

    pub fn get_image_by_id(&self, id: &str) -> Result<Option<ImageRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, project_id, batch_id, file_path, thumbnail, prompt, model, size, aspect_ratio, generation_type, reference_images, tokens_used, created_at, asset_types
             FROM images WHERE id = ?1"
        )?;

        let mut rows = stmt.query_map(params![id], Self::map_image_row)?;
        match rows.next() {
            Some(Ok(record)) => Ok(Some(record)),
            Some(Err(e)) => Err(e.into()),
            None => Ok(None),
        }
    }

    pub fn search_images(&self, query: &str, limit: i64) -> Result<Vec<ImageRecord>> {
        let search_pattern = format!("%{}%", query);
        let mut stmt = self.conn.prepare(
            "SELECT id, project_id, batch_id, file_path, thumbnail, prompt, model, size, aspect_ratio, generation_type, reference_images, tokens_used, created_at, asset_types
             FROM images
             WHERE prompt LIKE ?1
             ORDER BY created_at DESC
             LIMIT ?2"
        )?;

        let rows = stmt.query_map(params![search_pattern, limit], Self::map_image_row)?;
        rows.collect::<Result<Vec<_>, _>>().context("Failed to search images")
    }

    pub fn delete_image(&self, id: &str) -> Result<bool> {
        let rows_affected = self.conn.execute("DELETE FROM images WHERE id = ?1", params![id])?;
        Ok(rows_affected > 0)
    }

    /// Update the thumbnail for an existing image
    pub fn update_image_thumbnail(&self, id: &str, thumbnail: &str) -> Result<bool> {
        let rows = self.conn.execute(
            "UPDATE images SET thumbnail = ?1 WHERE id = ?2",
            params![thumbnail, id],
        )?;
        Ok(rows > 0)
    }

    /// Get images that don't have thumbnails cached
    pub fn get_images_without_thumbnails(&self, limit: i64) -> Result<Vec<ImageRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, project_id, batch_id, file_path, thumbnail, prompt, model, size, aspect_ratio, generation_type, reference_images, tokens_used, created_at, asset_types
             FROM images
             WHERE thumbnail IS NULL
             LIMIT ?1"
        )?;

        let rows = stmt.query_map(params![limit], Self::map_image_row)?;
        rows.collect::<Result<Vec<_>, _>>().context("Failed to get images without thumbnails")
    }

    pub fn get_image_count(&self, project_id: Option<&str>) -> Result<i64> {
        let count: i64 = match project_id {
            Some(pid) => self.conn.query_row(
                "SELECT COUNT(*) FROM images WHERE project_id = ?1",
                params![pid],
                |row| row.get(0),
            )?,
            None => self.conn.query_row("SELECT COUNT(*) FROM images", [], |row| row.get(0))?,
        };
        Ok(count)
    }

    /// Add an asset type tag to an image
    pub fn add_image_asset_type(&self, id: &str, asset_type: &str) -> Result<bool> {
        // Get current asset_types
        let current: String = self.conn.query_row(
            "SELECT asset_types FROM images WHERE id = ?1",
            params![id],
            |row| row.get(0),
        ).unwrap_or_else(|_| "[]".to_string());

        let mut types: Vec<String> = serde_json::from_str(&current).unwrap_or_default();

        // Only add if not already present
        if !types.contains(&asset_type.to_string()) {
            types.push(asset_type.to_string());
            let new_json = serde_json::to_string(&types)?;
            let rows = self.conn.execute(
                "UPDATE images SET asset_types = ?1 WHERE id = ?2",
                params![new_json, id],
            )?;
            Ok(rows > 0)
        } else {
            Ok(false) // Already tagged
        }
    }

    /// Remove an asset type tag from an image
    pub fn remove_image_asset_type(&self, id: &str, asset_type: &str) -> Result<bool> {
        // Get current asset_types
        let current: String = self.conn.query_row(
            "SELECT asset_types FROM images WHERE id = ?1",
            params![id],
            |row| row.get(0),
        ).unwrap_or_else(|_| "[]".to_string());

        let mut types: Vec<String> = serde_json::from_str(&current).unwrap_or_default();

        // Remove if present
        let original_len = types.len();
        types.retain(|t| t != asset_type);

        if types.len() != original_len {
            let new_json = serde_json::to_string(&types)?;
            let rows = self.conn.execute(
                "UPDATE images SET asset_types = ?1 WHERE id = ?2",
                params![new_json, id],
            )?;
            Ok(rows > 0)
        } else {
            Ok(false) // Wasn't tagged
        }
    }

    /// Add an asset type tag to a video
    pub fn add_video_asset_type(&self, id: &str, asset_type: &str) -> Result<bool> {
        // Get current asset_types
        let current: String = self.conn.query_row(
            "SELECT asset_types FROM videos WHERE id = ?1",
            params![id],
            |row| row.get(0),
        ).unwrap_or_else(|_| "[]".to_string());

        let mut types: Vec<String> = serde_json::from_str(&current).unwrap_or_default();

        // Only add if not already present
        if !types.contains(&asset_type.to_string()) {
            types.push(asset_type.to_string());
            let new_json = serde_json::to_string(&types)?;
            let rows = self.conn.execute(
                "UPDATE videos SET asset_types = ?1 WHERE id = ?2",
                params![new_json, id],
            )?;
            Ok(rows > 0)
        } else {
            Ok(false) // Already tagged
        }
    }

    /// Remove an asset type tag from a video
    pub fn remove_video_asset_type(&self, id: &str, asset_type: &str) -> Result<bool> {
        // Get current asset_types
        let current: String = self.conn.query_row(
            "SELECT asset_types FROM videos WHERE id = ?1",
            params![id],
            |row| row.get(0),
        ).unwrap_or_else(|_| "[]".to_string());

        let mut types: Vec<String> = serde_json::from_str(&current).unwrap_or_default();

        // Remove if present
        let original_len = types.len();
        types.retain(|t| t != asset_type);

        if types.len() != original_len {
            let new_json = serde_json::to_string(&types)?;
            let rows = self.conn.execute(
                "UPDATE videos SET asset_types = ?1 WHERE id = ?2",
                params![new_json, id],
            )?;
            Ok(rows > 0)
        } else {
            Ok(false) // Wasn't tagged
        }
    }

    /// Get counts of images and videos by asset_type for a project
    pub fn get_asset_type_counts(&self, project_id: &str) -> Result<Vec<(String, i64)>> {
        // Count images and videos that contain each asset type in their JSON array
        let asset_types = ["character", "background", "style", "prop"];
        let mut counts = Vec::new();

        for asset_type in asset_types {
            let pattern = format!("%\"{}\"%" , asset_type);
            // Count images
            let image_count: i64 = self.conn.query_row(
                "SELECT COUNT(*) FROM images WHERE project_id = ?1 AND asset_types LIKE ?2",
                params![project_id, pattern],
                |row| row.get(0),
            )?;
            // Count videos
            let video_count: i64 = self.conn.query_row(
                "SELECT COUNT(*) FROM videos WHERE project_id = ?1 AND asset_types LIKE ?2",
                params![project_id, pattern],
                |row| row.get(0),
            )?;
            let total = image_count + video_count;
            if total > 0 {
                counts.push((asset_type.to_string(), total));
            }
        }

        Ok(counts)
    }

    /// Get images filtered by asset_type (images that have this type in their array)
    pub fn get_images_by_asset_type(&self, project_id: &str, asset_type: &str, limit: i64, offset: i64) -> Result<Vec<ImageRecord>> {
        let pattern = format!("%\"{}\"%" , asset_type);
        let mut stmt = self.conn.prepare(
            "SELECT id, project_id, batch_id, file_path, thumbnail, prompt, model, size, aspect_ratio, generation_type, reference_images, tokens_used, created_at, asset_types
             FROM images
             WHERE project_id = ?1 AND asset_types LIKE ?2
             ORDER BY created_at DESC
             LIMIT ?3 OFFSET ?4"
        )?;

        let rows = stmt.query_map(params![project_id, pattern, limit, offset], Self::map_image_row)?;
        rows.collect::<Result<Vec<_>, _>>().context("Failed to get images by asset type")
    }

    fn map_image_row(row: &rusqlite::Row) -> rusqlite::Result<ImageRecord> {
        let reference_json: String = row.get(10)?;
        let created_at_str: String = row.get(12)?;
        let asset_types_json: String = row.get::<_, Option<String>>(13)?.unwrap_or_else(|| "[]".to_string());
        Ok(ImageRecord {
            id: row.get(0)?,
            project_id: row.get(1)?,
            batch_id: row.get(2)?,
            file_path: row.get(3)?,
            thumbnail: row.get(4)?,
            prompt: row.get(5)?,
            model: row.get(6)?,
            size: row.get(7)?,
            aspect_ratio: row.get(8)?,
            generation_type: row.get(9)?,
            reference_images: serde_json::from_str(&reference_json).unwrap_or_default(),
            tokens_used: row.get(11)?,
            created_at: DateTime::parse_from_rfc3339(&created_at_str)
                .map(|dt| dt.with_timezone(&Utc))
                .unwrap_or_else(|_| Utc::now()),
            asset_types: serde_json::from_str(&asset_types_json).unwrap_or_default(),
        })
    }

    // ========================================================================
    // Video Methods
    // ========================================================================

    pub fn insert_video(&self, record: &VideoRecord) -> Result<()> {
        let asset_types_json = serde_json::to_string(&record.asset_types)?;
        self.conn.execute(
            "INSERT INTO videos (id, project_id, task_id, file_path, first_frame_thumbnail, last_frame_thumbnail, first_frame_path, last_frame_path, vocals_path, bgm_path, prompt, model, generation_type, source_image_id, resolution, duration, fps, aspect_ratio, status, error_message, tokens_used, created_at, completed_at, asset_types)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24)",
            params![
                record.id,
                record.project_id,
                record.task_id,
                record.file_path,
                record.first_frame_thumbnail,
                record.last_frame_thumbnail,
                record.first_frame_path,
                record.last_frame_path,
                record.vocals_path,
                record.bgm_path,
                record.prompt,
                record.model,
                record.generation_type,
                record.source_image_id,
                record.resolution,
                record.duration,
                record.fps,
                record.aspect_ratio,
                record.status,
                record.error_message,
                record.tokens_used,
                record.created_at.to_rfc3339(),
                record.completed_at.map(|dt| dt.to_rfc3339()),
                asset_types_json,
            ],
        ).context("Failed to insert video")?;
        Ok(())
    }

    pub fn get_videos_by_project(&self, project_id: &str, limit: i64, offset: i64) -> Result<Vec<VideoRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, project_id, task_id, file_path, first_frame_thumbnail, last_frame_thumbnail, first_frame_path, last_frame_path, vocals_path, bgm_path, prompt, model, generation_type, source_image_id, resolution, duration, fps, aspect_ratio, status, error_message, tokens_used, created_at, completed_at, asset_types
             FROM videos
             WHERE project_id = ?1
             ORDER BY created_at DESC
             LIMIT ?2 OFFSET ?3"
        )?;

        let rows = stmt.query_map(params![project_id, limit, offset], Self::map_video_row)?;
        rows.collect::<Result<Vec<_>, _>>().context("Failed to get videos by project")
    }

    pub fn get_videos_by_asset_type(&self, project_id: &str, asset_type: &str, limit: i64, offset: i64) -> Result<Vec<VideoRecord>> {
        // SQLite JSON query: asset_types contains the given type
        let pattern = format!("%\"{}%", asset_type);
        let mut stmt = self.conn.prepare(
            "SELECT id, project_id, task_id, file_path, first_frame_thumbnail, last_frame_thumbnail, first_frame_path, last_frame_path, vocals_path, bgm_path, prompt, model, generation_type, source_image_id, resolution, duration, fps, aspect_ratio, status, error_message, tokens_used, created_at, completed_at, asset_types
             FROM videos
             WHERE project_id = ?1 AND asset_types LIKE ?2
             ORDER BY created_at DESC
             LIMIT ?3 OFFSET ?4"
        )?;

        let rows = stmt.query_map(params![project_id, pattern, limit, offset], Self::map_video_row)?;
        rows.collect::<Result<Vec<_>, _>>().context("Failed to get videos by asset type")
    }

    pub fn get_video_count_by_asset_type(&self, project_id: &str, asset_type: &str) -> Result<i64> {
        let pattern = format!("%\"{}%", asset_type);
        let count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM videos WHERE project_id = ?1 AND asset_types LIKE ?2",
            params![project_id, pattern],
            |row| row.get(0),
        )?;
        Ok(count)
    }

    pub fn get_video_by_id(&self, id: &str) -> Result<Option<VideoRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, project_id, task_id, file_path, first_frame_thumbnail, last_frame_thumbnail, first_frame_path, last_frame_path, vocals_path, bgm_path, prompt, model, generation_type, source_image_id, resolution, duration, fps, aspect_ratio, status, error_message, tokens_used, created_at, completed_at, asset_types
             FROM videos WHERE id = ?1"
        )?;

        let mut rows = stmt.query_map(params![id], Self::map_video_row)?;
        match rows.next() {
            Some(Ok(record)) => Ok(Some(record)),
            Some(Err(e)) => Err(e.into()),
            None => Ok(None),
        }
    }

    pub fn get_pending_videos(&self) -> Result<Vec<VideoRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, project_id, task_id, file_path, first_frame_thumbnail, last_frame_thumbnail, first_frame_path, last_frame_path, vocals_path, bgm_path, prompt, model, generation_type, source_image_id, resolution, duration, fps, aspect_ratio, status, error_message, tokens_used, created_at, completed_at, asset_types
             FROM videos
             WHERE status IN ('pending', 'processing')
             ORDER BY created_at ASC"
        )?;

        let rows = stmt.query_map([], Self::map_video_row)?;
        rows.collect::<Result<Vec<_>, _>>().context("Failed to get pending videos")
    }

    pub fn update_video_status(&self, id: &str, update: &VideoStatusUpdate) -> Result<bool> {
        let completed_at = if update.status == "completed" || update.status == "failed" {
            Some(Utc::now().to_rfc3339())
        } else {
            None
        };

        let rows = self.conn.execute(
            "UPDATE videos SET status = ?1, file_path = COALESCE(?2, file_path), first_frame_thumbnail = COALESCE(?3, first_frame_thumbnail), last_frame_thumbnail = COALESCE(?4, last_frame_thumbnail), first_frame_path = COALESCE(?5, first_frame_path), last_frame_path = COALESCE(?6, last_frame_path), vocals_path = COALESCE(?7, vocals_path), bgm_path = COALESCE(?8, bgm_path), resolution = COALESCE(?9, resolution), duration = COALESCE(?10, duration), fps = COALESCE(?11, fps), tokens_used = COALESCE(?12, tokens_used), error_message = ?13, completed_at = COALESCE(?14, completed_at) WHERE id = ?15",
            params![update.status, update.file_path, update.first_frame_thumbnail, update.last_frame_thumbnail, update.first_frame_path, update.last_frame_path, update.vocals_path, update.bgm_path, update.resolution, update.duration, update.fps, update.tokens_used, update.error_message, completed_at, id],
        )?;
        Ok(rows > 0)
    }

    pub fn delete_video(&self, id: &str) -> Result<bool> {
        let rows = self.conn.execute("DELETE FROM videos WHERE id = ?1", params![id])?;
        Ok(rows > 0)
    }

    pub fn get_video_count(&self, project_id: Option<&str>) -> Result<i64> {
        let count: i64 = match project_id {
            Some(pid) => self.conn.query_row(
                "SELECT COUNT(*) FROM videos WHERE project_id = ?1",
                params![pid],
                |row| row.get(0),
            )?,
            None => self.conn.query_row("SELECT COUNT(*) FROM videos", [], |row| row.get(0))?,
        };
        Ok(count)
    }

    fn map_video_row(row: &rusqlite::Row) -> rusqlite::Result<VideoRecord> {
        let created_at_str: String = row.get(21)?;
        let completed_at_str: Option<String> = row.get(22)?;
        let asset_types_json: String = row.get::<_, Option<String>>(23)?.unwrap_or_else(|| "[]".to_string());
        Ok(VideoRecord {
            id: row.get(0)?,
            project_id: row.get(1)?,
            task_id: row.get(2)?,
            file_path: row.get(3)?,
            first_frame_thumbnail: row.get(4)?,
            last_frame_thumbnail: row.get(5)?,
            first_frame_path: row.get(6)?,
            last_frame_path: row.get(7)?,
            vocals_path: row.get(8)?,
            bgm_path: row.get(9)?,
            prompt: row.get(10)?,
            model: row.get(11)?,
            generation_type: row.get(12)?,
            source_image_id: row.get(13)?,
            resolution: row.get(14)?,
            duration: row.get(15)?,
            fps: row.get(16)?,
            aspect_ratio: row.get(17)?,
            status: row.get(18)?,
            error_message: row.get(19)?,
            tokens_used: row.get(20)?,
            created_at: DateTime::parse_from_rfc3339(&created_at_str)
                .map(|dt| dt.with_timezone(&Utc))
                .unwrap_or_else(|_| Utc::now()),
            completed_at: completed_at_str.and_then(|s| {
                DateTime::parse_from_rfc3339(&s)
                    .map(|dt| dt.with_timezone(&Utc))
                    .ok()
            }),
            asset_types: serde_json::from_str(&asset_types_json).unwrap_or_default(),
        })
    }

    // ========================================================================
    // Cleanup Methods
    // ========================================================================

    /// Remove database records for files that no longer exist on disk
    pub fn cleanup_missing_files(&self) -> Result<(usize, usize)> {
        let mut images_removed = 0;
        let mut videos_removed = 0;

        // Cleanup images
        let mut stmt = self.conn.prepare("SELECT id, file_path FROM images")?;
        let image_rows: Vec<(String, String)> = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
            .filter_map(|r| r.ok())
            .collect();

        for (id, file_path) in image_rows {
            if !std::path::Path::new(&file_path).exists() && self.delete_image(&id)? {
                images_removed += 1;
            }
        }

        // Cleanup videos (only completed ones with file_path)
        // Also fetch frame and audio paths so we can delete them
        struct VideoCleanupRow {
            id: String,
            file_path: String,
            first_frame_path: Option<String>,
            last_frame_path: Option<String>,
            vocals_path: Option<String>,
            bgm_path: Option<String>,
        }
        let mut stmt = self.conn.prepare(
            "SELECT id, file_path, first_frame_path, last_frame_path, vocals_path, bgm_path FROM videos WHERE file_path IS NOT NULL"
        )?;
        let video_rows: Vec<VideoCleanupRow> = stmt
            .query_map([], |row| Ok(VideoCleanupRow {
                id: row.get(0)?,
                file_path: row.get(1)?,
                first_frame_path: row.get(2)?,
                last_frame_path: row.get(3)?,
                vocals_path: row.get(4)?,
                bgm_path: row.get(5)?,
            }))?
            .filter_map(|r| r.ok())
            .collect();

        for VideoCleanupRow { id, file_path, first_frame_path, last_frame_path, vocals_path, bgm_path } in video_rows {
            if !std::path::Path::new(&file_path).exists() {
                // Delete frame files if they exist
                if let Some(first_path) = first_frame_path {
                    let _ = std::fs::remove_file(&first_path);
                }
                if let Some(last_path) = last_frame_path {
                    let _ = std::fs::remove_file(&last_path);
                }
                // Delete separated audio files if they exist
                if let Some(vocals) = vocals_path {
                    let _ = std::fs::remove_file(&vocals);
                }
                if let Some(bgm) = bgm_path {
                    let _ = std::fs::remove_file(&bgm);
                }
                // Delete database record
                if self.delete_video(&id)? {
                    videos_removed += 1;
                }
            }
        }

        Ok((images_removed, videos_removed))
    }
}
