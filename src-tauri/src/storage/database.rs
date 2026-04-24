use crate::crypto::{decrypt, derive_key, encrypt};
use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

const DB_FILE: &str = "data.db";
const DEFAULT_PASSWORD: &str = "ai-artstation-default";

// ============================================================================
// App Settings (non-provider preferences)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub output_directory: String,
    pub output_format: String,
    pub default_image_provider_type: Option<String>,
    pub default_video_provider_type: Option<String>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            output_directory: get_default_output_dir(),
            output_format: "jpeg".to_string(),
            default_image_provider_type: None,
            default_video_provider_type: None,
        }
    }
}

pub fn get_default_output_dir() -> String {
    dirs::picture_dir()
        .map(|p| p.join("AI-ArtStation"))
        .unwrap_or_else(|| PathBuf::from("./AI-ArtStation"))
        .to_string_lossy()
        .to_string()
}

// ============================================================================
// Provider Record
// ============================================================================

/// Single-instance-per-type. provider_type is the primary key; there is no
/// separate id/name.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderRecord {
    pub provider_type: String,
    pub credentials: HashMap<String, String>,
    pub image_model: Option<String>,
    pub video_model: Option<String>,
    /// When true, HTTP requests for this provider bypass any system proxy.
    /// Useful for in-country relays where the system proxy is routing traffic
    /// through a VPN that has its own timeout.
    pub no_proxy: bool,
    pub created_at: DateTime<Utc>,
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
    /// Snapshot of provider type at generation time (may be deleted later).
    pub provider_type: Option<String>,
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
    pub task_id: String,                       // API task ID for polling
    pub file_path: Option<String>,             // Local path after download
    pub first_frame_thumbnail: Option<String>, // Base64 thumbnail of first frame
    pub last_frame_thumbnail: Option<String>,  // Base64 thumbnail of last frame
    pub first_frame_path: Option<String>,      // Full-res first frame image path
    pub last_frame_path: Option<String>,       // Full-res last frame image path
    pub vocals_path: Option<String>,           // Separated vocals audio path
    pub bgm_path: Option<String>,              // Separated BGM/accompaniment audio path
    pub prompt: String,
    /// Snapshot of provider type used (kept so task isolation works even if provider is deleted).
    pub provider_type: String,
    /// Snapshot of credentials used at submission time (encrypted JSON). Enables polling
    /// after the user has edited or removed the provider.
    pub credentials_snapshot: HashMap<String, String>,
    /// Snapshot of the provider's no_proxy flag at submission time so polling
    /// keeps using the same HTTP routing it used to submit.
    pub no_proxy: bool,
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
        std::fs::create_dir_all(&app_data_dir).context("Failed to create app data directory")?;

        let db_path = app_data_dir.join(DB_FILE);
        let conn = Connection::open(&db_path).context("Failed to open database")?;

        let db = Self { conn };
        db.init_tables()?;
        Ok(db)
    }

    fn init_tables(&self) -> Result<()> {
        // Drop legacy config table — replaced by providers + app_settings.
        // (User explicitly opted out of backward compatibility.)
        self.conn
            .execute("DROP TABLE IF EXISTS config", [])
            .context("Failed to drop legacy config table")?;

        // Drop an older providers schema (id PK + name + default_*_model) so
        // CREATE IF NOT EXISTS below can build the current shape. Users were
        // warned this migration is destructive.
        let legacy_provider_cols: Vec<String> = self
            .conn
            .prepare("PRAGMA table_info(providers)")?
            .query_map([], |row| row.get::<_, String>(1))?
            .filter_map(|r| r.ok())
            .collect();
        let has_legacy_provider_shape = legacy_provider_cols.iter().any(|c| {
            c == "id" || c == "name" || c == "default_image_model" || c == "default_video_model"
        });
        if has_legacy_provider_shape {
            self.conn
                .execute("DROP TABLE IF EXISTS providers", [])
                .context("Failed to drop legacy providers table")?;
        }

        // Key-value store for non-provider app preferences.
        self.conn
            .execute(
                "CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )",
                [],
            )
            .context("Failed to create app_settings table")?;

        // Clear stale default_*_provider_id keys left by older schema versions
        // so the UI does not look up providers by ids that no longer exist.
        self.conn
            .execute(
                "DELETE FROM app_settings WHERE key IN ('default_image_provider_id', 'default_video_provider_id')",
                [],
            )
            .ok();

        // Providers table (credentials encrypted as blob).
        // Single-instance-per-type — provider_type is the primary key.
        self.conn
            .execute(
                "CREATE TABLE IF NOT EXISTS providers (
                provider_type TEXT PRIMARY KEY,
                credentials BLOB NOT NULL,
                image_model TEXT,
                video_model TEXT,
                no_proxy INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            )",
                [],
            )
            .context("Failed to create providers table")?;

        // Projects table
        self.conn
            .execute(
                "CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )",
                [],
            )
            .context("Failed to create projects table")?;

        // Assets table
        self.conn
            .execute(
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
            )
            .context("Failed to create assets table")?;

        // Images table
        self.conn
            .execute(
                "CREATE TABLE IF NOT EXISTS images (
                id TEXT PRIMARY KEY,
                project_id TEXT,
                file_path TEXT NOT NULL,
                prompt TEXT NOT NULL,
                provider_type TEXT,
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
            )
            .context("Failed to create images table")?;

        // Videos table (credentials_snapshot encrypted so polling survives provider edits)
        self.conn
            .execute(
                "CREATE TABLE IF NOT EXISTS videos (
                id TEXT PRIMARY KEY,
                project_id TEXT,
                task_id TEXT NOT NULL,
                file_path TEXT,
                prompt TEXT NOT NULL,
                provider_type TEXT NOT NULL,
                credentials_snapshot BLOB NOT NULL,
                no_proxy INTEGER NOT NULL DEFAULT 0,
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
            )
            .context("Failed to create videos table")?;

        // Run migrations for existing databases
        self.run_migrations()?;

        // Indexes
        self.conn
            .execute(
                "CREATE INDEX IF NOT EXISTS idx_images_created_at ON images(created_at DESC)",
                [],
            )
            .context("Failed to create images index")?;
        self.conn
            .execute(
                "CREATE INDEX IF NOT EXISTS idx_images_project_id ON images(project_id)",
                [],
            )
            .context("Failed to create images project index")?;
        self.conn
            .execute(
                "CREATE INDEX IF NOT EXISTS idx_assets_project_id ON assets(project_id)",
                [],
            )
            .context("Failed to create assets index")?;
        self.conn
            .execute(
                "CREATE INDEX IF NOT EXISTS idx_videos_project_id ON videos(project_id)",
                [],
            )
            .context("Failed to create videos project index")?;
        self.conn
            .execute(
                "CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(status)",
                [],
            )
            .context("Failed to create videos status index")?;

        Ok(())
    }

    fn run_migrations(&self) -> Result<()> {
        // Migrations for installs that are upgrading from the single-provider schema.
        // Schema history kept below; all new columns are added with safe defaults.

        let provider_columns: Vec<String> = self
            .conn
            .prepare("PRAGMA table_info(providers)")?
            .query_map([], |row| row.get::<_, String>(1))?
            .filter_map(|r| r.ok())
            .collect();
        if !provider_columns.contains(&"no_proxy".to_string()) {
            self.conn.execute(
                "ALTER TABLE providers ADD COLUMN no_proxy INTEGER NOT NULL DEFAULT 0",
                [],
            )?;
        }

        let image_columns: Vec<String> = self
            .conn
            .prepare("PRAGMA table_info(images)")?
            .query_map([], |row| row.get::<_, String>(1))?
            .filter_map(|r| r.ok())
            .collect();

        if !image_columns.contains(&"batch_id".to_string()) {
            self.conn
                .execute("ALTER TABLE images ADD COLUMN batch_id TEXT", [])
                .context("Failed to add batch_id")?;
            self.conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_images_batch_id ON images(batch_id)",
                [],
            )?;
        }
        if !image_columns.contains(&"thumbnail".to_string()) {
            self.conn
                .execute("ALTER TABLE images ADD COLUMN thumbnail TEXT", [])?;
        }
        if !image_columns.contains(&"asset_types".to_string()) {
            self.conn.execute(
                "ALTER TABLE images ADD COLUMN asset_types TEXT NOT NULL DEFAULT '[]'",
                [],
            )?;
        }
        if !image_columns.contains(&"provider_type".to_string()) {
            self.conn
                .execute("ALTER TABLE images ADD COLUMN provider_type TEXT", [])?;
        }

        let video_columns: Vec<String> = self
            .conn
            .prepare("PRAGMA table_info(videos)")?
            .query_map([], |row| row.get::<_, String>(1))?
            .filter_map(|r| r.ok())
            .collect();

        for (col, ddl) in [
            (
                "first_frame_thumbnail",
                "ALTER TABLE videos ADD COLUMN first_frame_thumbnail TEXT",
            ),
            (
                "last_frame_thumbnail",
                "ALTER TABLE videos ADD COLUMN last_frame_thumbnail TEXT",
            ),
            (
                "first_frame_path",
                "ALTER TABLE videos ADD COLUMN first_frame_path TEXT",
            ),
            (
                "last_frame_path",
                "ALTER TABLE videos ADD COLUMN last_frame_path TEXT",
            ),
            (
                "vocals_path",
                "ALTER TABLE videos ADD COLUMN vocals_path TEXT",
            ),
            ("bgm_path", "ALTER TABLE videos ADD COLUMN bgm_path TEXT"),
            (
                "asset_types",
                "ALTER TABLE videos ADD COLUMN asset_types TEXT NOT NULL DEFAULT '[]'",
            ),
            (
                "provider_type",
                "ALTER TABLE videos ADD COLUMN provider_type TEXT NOT NULL DEFAULT ''",
            ),
            (
                "credentials_snapshot",
                "ALTER TABLE videos ADD COLUMN credentials_snapshot BLOB NOT NULL DEFAULT x''",
            ),
            (
                "no_proxy",
                "ALTER TABLE videos ADD COLUMN no_proxy INTEGER NOT NULL DEFAULT 0",
            ),
        ] {
            if !video_columns.contains(&col.to_string()) {
                self.conn
                    .execute(ddl, [])
                    .with_context(|| format!("Failed to add column {} to videos", col))?;
            }
        }

        Ok(())
    }

    // ========================================================================
    // App Settings Methods (plain key-value)
    // ========================================================================

    pub fn load_app_settings(&self) -> Result<AppSettings> {
        let mut settings = AppSettings::default();
        let mut stmt = self.conn.prepare("SELECT key, value FROM app_settings")?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        for row in rows.flatten() {
            match row.0.as_str() {
                "output_directory" => settings.output_directory = row.1,
                "output_format" => settings.output_format = row.1,
                "default_image_provider_type" => settings.default_image_provider_type = Some(row.1),
                "default_video_provider_type" => settings.default_video_provider_type = Some(row.1),
                _ => {}
            }
        }
        Ok(settings)
    }

    pub fn save_app_settings(&self, settings: &AppSettings) -> Result<()> {
        let pairs: Vec<(&str, Option<&str>)> = vec![
            ("output_directory", Some(&settings.output_directory)),
            ("output_format", Some(&settings.output_format)),
            (
                "default_image_provider_type",
                settings.default_image_provider_type.as_deref(),
            ),
            (
                "default_video_provider_type",
                settings.default_video_provider_type.as_deref(),
            ),
        ];
        for (k, v) in pairs {
            match v {
                Some(val) => {
                    self.conn.execute(
                        "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?1, ?2)",
                        params![k, val],
                    )?;
                }
                None => {
                    self.conn
                        .execute("DELETE FROM app_settings WHERE key = ?1", params![k])?;
                }
            }
        }
        Ok(())
    }

    // ========================================================================
    // Provider Methods (credentials encrypted at rest)
    // ========================================================================

    /// Upsert a provider by type. created_at is set on first insert; subsequent
    /// saves preserve it.
    pub fn save_provider(&self, record: &ProviderRecord) -> Result<()> {
        let creds_json = serde_json::to_string(&record.credentials)
            .context("Failed to serialize credentials")?;
        let key = derive_key(DEFAULT_PASSWORD);
        let encrypted =
            encrypt(creds_json.as_bytes(), &key).context("Failed to encrypt credentials")?;
        self.conn.execute(
            "INSERT INTO providers (provider_type, credentials, image_model, video_model, no_proxy, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(provider_type) DO UPDATE SET
                credentials = excluded.credentials,
                image_model = excluded.image_model,
                video_model = excluded.video_model,
                no_proxy = excluded.no_proxy",
            params![
                record.provider_type,
                encrypted,
                record.image_model,
                record.video_model,
                record.no_proxy as i32,
                record.created_at.to_rfc3339(),
            ],
        ).context("Failed to save provider")?;
        Ok(())
    }

    pub fn delete_provider(&self, provider_type: &str) -> Result<bool> {
        let rows = self.conn.execute(
            "DELETE FROM providers WHERE provider_type = ?1",
            params![provider_type],
        )?;
        // Clear as default if this provider was the default in app_settings.
        self.conn.execute(
            "DELETE FROM app_settings WHERE (key = 'default_image_provider_type' OR key = 'default_video_provider_type') AND value = ?1",
            params![provider_type],
        )?;
        Ok(rows > 0)
    }

    pub fn list_providers(&self) -> Result<Vec<ProviderRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT provider_type, credentials, image_model, video_model, no_proxy, created_at
             FROM providers ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map([], Self::map_provider_row)?;
        rows.collect::<Result<Vec<_>, _>>()
            .context("Failed to list providers")
    }

    pub fn get_provider(&self, provider_type: &str) -> Result<Option<ProviderRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT provider_type, credentials, image_model, video_model, no_proxy, created_at
             FROM providers WHERE provider_type = ?1",
        )?;
        let mut rows = stmt.query_map(params![provider_type], Self::map_provider_row)?;
        match rows.next() {
            Some(Ok(r)) => Ok(Some(r)),
            Some(Err(e)) => Err(e.into()),
            None => Ok(None),
        }
    }

    fn map_provider_row(row: &rusqlite::Row) -> rusqlite::Result<ProviderRecord> {
        let encrypted: Vec<u8> = row.get(1)?;
        let no_proxy_int: i64 = row.get(4)?;
        let created_at_str: String = row.get(5)?;
        let key = derive_key(DEFAULT_PASSWORD);
        let credentials: HashMap<String, String> = decrypt(&encrypted, &key)
            .ok()
            .and_then(|bytes| String::from_utf8(bytes).ok())
            .and_then(|json| serde_json::from_str(&json).ok())
            .unwrap_or_default();
        Ok(ProviderRecord {
            provider_type: row.get(0)?,
            credentials,
            image_model: row.get(2)?,
            video_model: row.get(3)?,
            no_proxy: no_proxy_int != 0,
            created_at: DateTime::parse_from_rfc3339(&created_at_str)
                .map(|dt| dt.with_timezone(&Utc))
                .unwrap_or_else(|_| Utc::now()),
        })
    }

    /// Encrypt a credentials map (used for video task snapshots).
    pub fn encrypt_credentials(credentials: &HashMap<String, String>) -> Result<Vec<u8>> {
        let json = serde_json::to_string(credentials)?;
        let key = derive_key(DEFAULT_PASSWORD);
        encrypt(json.as_bytes(), &key).context("Failed to encrypt credentials")
    }

    /// Decrypt a credentials blob.
    pub fn decrypt_credentials(blob: &[u8]) -> Result<HashMap<String, String>> {
        let key = derive_key(DEFAULT_PASSWORD);
        let bytes = decrypt(blob, &key).context("Failed to decrypt credentials")?;
        let json = String::from_utf8(bytes)?;
        Ok(serde_json::from_str(&json)?)
    }

    // ========================================================================
    // Project Methods
    // ========================================================================

    pub fn insert_project(&self, record: &ProjectRecord) -> Result<()> {
        self.conn
            .execute(
                "INSERT INTO projects (id, name, description, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    record.id,
                    record.name,
                    record.description,
                    record.created_at.to_rfc3339(),
                    record.updated_at.to_rfc3339(),
                ],
            )
            .context("Failed to insert project")?;
        Ok(())
    }

    pub fn get_projects(&self) -> Result<Vec<ProjectRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, description, created_at, updated_at
             FROM projects ORDER BY updated_at DESC",
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

        rows.collect::<Result<Vec<_>, _>>()
            .context("Failed to get projects")
    }

    pub fn get_project_by_id(&self, id: &str) -> Result<Option<ProjectRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, description, created_at, updated_at FROM projects WHERE id = ?1",
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
        let rows = self
            .conn
            .execute("DELETE FROM projects WHERE id = ?1", params![id])?;
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
             FROM assets WHERE project_id = ?1 ORDER BY asset_type, name",
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

        rows.collect::<Result<Vec<_>, _>>()
            .context("Failed to get assets")
    }

    pub fn get_asset_by_id(&self, id: &str) -> Result<Option<AssetRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, project_id, name, asset_type, tags, file_path, thumbnail, created_at
             FROM assets WHERE id = ?1",
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

    pub fn update_asset(
        &self,
        id: &str,
        name: &str,
        asset_type: &str,
        tags: &[String],
    ) -> Result<bool> {
        let tags_json = serde_json::to_string(tags)?;
        let rows = self.conn.execute(
            "UPDATE assets SET name = ?1, asset_type = ?2, tags = ?3 WHERE id = ?4",
            params![name, asset_type, tags_json, id],
        )?;
        Ok(rows > 0)
    }

    pub fn delete_asset(&self, id: &str) -> Result<bool> {
        let rows = self
            .conn
            .execute("DELETE FROM assets WHERE id = ?1", params![id])?;
        Ok(rows > 0)
    }

    // ========================================================================
    // Image Methods
    // ========================================================================

    pub fn insert_image(&self, record: &ImageRecord) -> Result<()> {
        let reference_json = serde_json::to_string(&record.reference_images)?;
        let asset_types_json = serde_json::to_string(&record.asset_types)?;

        self.conn.execute(
            "INSERT INTO images (id, project_id, batch_id, file_path, thumbnail, prompt, provider_type, model, size, aspect_ratio, generation_type, reference_images, tokens_used, created_at, asset_types)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
            params![
                record.id,
                record.project_id,
                record.batch_id,
                record.file_path,
                record.thumbnail,
                record.prompt,
                record.provider_type,
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

    pub fn get_images_by_project(
        &self,
        project_id: &str,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<ImageRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, project_id, batch_id, file_path, thumbnail, prompt, provider_type, model, size, aspect_ratio, generation_type, reference_images, tokens_used, created_at, asset_types
             FROM images
             WHERE project_id = ?1
             ORDER BY created_at DESC
             LIMIT ?2 OFFSET ?3"
        )?;

        let rows = stmt.query_map(params![project_id, limit, offset], Self::map_image_row)?;
        rows.collect::<Result<Vec<_>, _>>()
            .context("Failed to get images by project")
    }

    pub fn get_image_by_id(&self, id: &str) -> Result<Option<ImageRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, project_id, batch_id, file_path, thumbnail, prompt, provider_type, model, size, aspect_ratio, generation_type, reference_images, tokens_used, created_at, asset_types
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
            "SELECT id, project_id, batch_id, file_path, thumbnail, prompt, provider_type, model, size, aspect_ratio, generation_type, reference_images, tokens_used, created_at, asset_types
             FROM images
             WHERE prompt LIKE ?1
             ORDER BY created_at DESC
             LIMIT ?2"
        )?;

        let rows = stmt.query_map(params![search_pattern, limit], Self::map_image_row)?;
        rows.collect::<Result<Vec<_>, _>>()
            .context("Failed to search images")
    }

    pub fn delete_image(&self, id: &str) -> Result<bool> {
        let rows_affected = self
            .conn
            .execute("DELETE FROM images WHERE id = ?1", params![id])?;
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
            "SELECT id, project_id, batch_id, file_path, thumbnail, prompt, provider_type, model, size, aspect_ratio, generation_type, reference_images, tokens_used, created_at, asset_types
             FROM images
             WHERE thumbnail IS NULL
             LIMIT ?1"
        )?;

        let rows = stmt.query_map(params![limit], Self::map_image_row)?;
        rows.collect::<Result<Vec<_>, _>>()
            .context("Failed to get images without thumbnails")
    }

    pub fn get_image_count(&self, project_id: Option<&str>) -> Result<i64> {
        let count: i64 = match project_id {
            Some(pid) => self.conn.query_row(
                "SELECT COUNT(*) FROM images WHERE project_id = ?1",
                params![pid],
                |row| row.get(0),
            )?,
            None => self
                .conn
                .query_row("SELECT COUNT(*) FROM images", [], |row| row.get(0))?,
        };
        Ok(count)
    }

    /// Add an asset type tag to an image
    pub fn add_image_asset_type(&self, id: &str, asset_type: &str) -> Result<bool> {
        // Get current asset_types
        let current: String = self
            .conn
            .query_row(
                "SELECT asset_types FROM images WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .unwrap_or_else(|_| "[]".to_string());

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
        let current: String = self
            .conn
            .query_row(
                "SELECT asset_types FROM images WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .unwrap_or_else(|_| "[]".to_string());

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
        let current: String = self
            .conn
            .query_row(
                "SELECT asset_types FROM videos WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .unwrap_or_else(|_| "[]".to_string());

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
        let current: String = self
            .conn
            .query_row(
                "SELECT asset_types FROM videos WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .unwrap_or_else(|_| "[]".to_string());

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
            let pattern = format!("%\"{}\"%", asset_type);
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
    pub fn get_images_by_asset_type(
        &self,
        project_id: &str,
        asset_type: &str,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<ImageRecord>> {
        let pattern = format!("%\"{}\"%", asset_type);
        let mut stmt = self.conn.prepare(
            "SELECT id, project_id, batch_id, file_path, thumbnail, prompt, provider_type, model, size, aspect_ratio, generation_type, reference_images, tokens_used, created_at, asset_types
             FROM images
             WHERE project_id = ?1 AND asset_types LIKE ?2
             ORDER BY created_at DESC
             LIMIT ?3 OFFSET ?4"
        )?;

        let rows = stmt.query_map(
            params![project_id, pattern, limit, offset],
            Self::map_image_row,
        )?;
        rows.collect::<Result<Vec<_>, _>>()
            .context("Failed to get images by asset type")
    }

    fn map_image_row(row: &rusqlite::Row) -> rusqlite::Result<ImageRecord> {
        // Columns: 0 id, 1 project_id, 2 batch_id, 3 file_path, 4 thumbnail, 5 prompt,
        //  6 provider_type, 7 model, 8 size, 9 aspect_ratio, 10 generation_type,
        //  11 reference_images, 12 tokens_used, 13 created_at, 14 asset_types
        let reference_json: String = row.get(11)?;
        let created_at_str: String = row.get(13)?;
        let asset_types_json: String = row
            .get::<_, Option<String>>(14)?
            .unwrap_or_else(|| "[]".to_string());
        Ok(ImageRecord {
            id: row.get(0)?,
            project_id: row.get(1)?,
            batch_id: row.get(2)?,
            file_path: row.get(3)?,
            thumbnail: row.get(4)?,
            prompt: row.get(5)?,
            provider_type: row.get(6)?,
            model: row.get(7)?,
            size: row.get(8)?,
            aspect_ratio: row.get(9)?,
            generation_type: row.get(10)?,
            reference_images: serde_json::from_str(&reference_json).unwrap_or_default(),
            tokens_used: row.get(12)?,
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
        let creds_blob = Self::encrypt_credentials(&record.credentials_snapshot)?;
        self.conn.execute(
            "INSERT INTO videos (id, project_id, task_id, file_path, first_frame_thumbnail, last_frame_thumbnail, first_frame_path, last_frame_path, vocals_path, bgm_path, prompt, provider_type, credentials_snapshot, no_proxy, model, generation_type, source_image_id, resolution, duration, fps, aspect_ratio, status, error_message, tokens_used, created_at, completed_at, asset_types)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27)",
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
                record.provider_type,
                creds_blob,
                record.no_proxy as i32,
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

    pub fn get_videos_by_project(
        &self,
        project_id: &str,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<VideoRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, project_id, task_id, file_path, first_frame_thumbnail, last_frame_thumbnail, first_frame_path, last_frame_path, vocals_path, bgm_path, prompt, provider_type, credentials_snapshot, no_proxy, model, generation_type, source_image_id, resolution, duration, fps, aspect_ratio, status, error_message, tokens_used, created_at, completed_at, asset_types
             FROM videos
             WHERE project_id = ?1
             ORDER BY created_at DESC
             LIMIT ?2 OFFSET ?3"
        )?;

        let rows = stmt.query_map(params![project_id, limit, offset], Self::map_video_row)?;
        rows.collect::<Result<Vec<_>, _>>()
            .context("Failed to get videos by project")
    }

    pub fn get_videos_by_asset_type(
        &self,
        project_id: &str,
        asset_type: &str,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<VideoRecord>> {
        // SQLite JSON query: asset_types contains the given type
        let pattern = format!("%\"{}%", asset_type);
        let mut stmt = self.conn.prepare(
            "SELECT id, project_id, task_id, file_path, first_frame_thumbnail, last_frame_thumbnail, first_frame_path, last_frame_path, vocals_path, bgm_path, prompt, provider_type, credentials_snapshot, no_proxy, model, generation_type, source_image_id, resolution, duration, fps, aspect_ratio, status, error_message, tokens_used, created_at, completed_at, asset_types
             FROM videos
             WHERE project_id = ?1 AND asset_types LIKE ?2
             ORDER BY created_at DESC
             LIMIT ?3 OFFSET ?4"
        )?;

        let rows = stmt.query_map(
            params![project_id, pattern, limit, offset],
            Self::map_video_row,
        )?;
        rows.collect::<Result<Vec<_>, _>>()
            .context("Failed to get videos by asset type")
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
            "SELECT id, project_id, task_id, file_path, first_frame_thumbnail, last_frame_thumbnail, first_frame_path, last_frame_path, vocals_path, bgm_path, prompt, provider_type, credentials_snapshot, no_proxy, model, generation_type, source_image_id, resolution, duration, fps, aspect_ratio, status, error_message, tokens_used, created_at, completed_at, asset_types
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
            "SELECT id, project_id, task_id, file_path, first_frame_thumbnail, last_frame_thumbnail, first_frame_path, last_frame_path, vocals_path, bgm_path, prompt, provider_type, credentials_snapshot, no_proxy, model, generation_type, source_image_id, resolution, duration, fps, aspect_ratio, status, error_message, tokens_used, created_at, completed_at, asset_types
             FROM videos
             WHERE status IN ('pending', 'processing')
             ORDER BY created_at ASC"
        )?;

        let rows = stmt.query_map([], Self::map_video_row)?;
        rows.collect::<Result<Vec<_>, _>>()
            .context("Failed to get pending videos")
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
        let rows = self
            .conn
            .execute("DELETE FROM videos WHERE id = ?1", params![id])?;
        Ok(rows > 0)
    }

    pub fn get_video_count(&self, project_id: Option<&str>) -> Result<i64> {
        let count: i64 = match project_id {
            Some(pid) => self.conn.query_row(
                "SELECT COUNT(*) FROM videos WHERE project_id = ?1",
                params![pid],
                |row| row.get(0),
            )?,
            None => self
                .conn
                .query_row("SELECT COUNT(*) FROM videos", [], |row| row.get(0))?,
        };
        Ok(count)
    }

    fn map_video_row(row: &rusqlite::Row) -> rusqlite::Result<VideoRecord> {
        // Columns: 0 id, 1 project_id, 2 task_id, 3 file_path,
        //          4 first_frame_thumbnail, 5 last_frame_thumbnail,
        //          6 first_frame_path, 7 last_frame_path,
        //          8 vocals_path, 9 bgm_path, 10 prompt,
        //          11 provider_type, 12 credentials_snapshot, 13 no_proxy,
        //          14 model, 15 generation_type, 16 source_image_id,
        //          17 resolution, 18 duration, 19 fps, 20 aspect_ratio,
        //          21 status, 22 error_message, 23 tokens_used,
        //          24 created_at, 25 completed_at, 26 asset_types
        let creds_blob: Vec<u8> = row.get(12)?;
        let credentials_snapshot = Self::decrypt_credentials(&creds_blob).unwrap_or_default();
        let no_proxy_int: i64 = row.get(13)?;
        let created_at_str: String = row.get(24)?;
        let completed_at_str: Option<String> = row.get(25)?;
        let asset_types_json: String = row
            .get::<_, Option<String>>(26)?
            .unwrap_or_else(|| "[]".to_string());
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
            provider_type: row.get(11)?,
            credentials_snapshot,
            no_proxy: no_proxy_int != 0,
            model: row.get(14)?,
            generation_type: row.get(15)?,
            source_image_id: row.get(16)?,
            resolution: row.get(17)?,
            duration: row.get(18)?,
            fps: row.get(19)?,
            aspect_ratio: row.get(20)?,
            status: row.get(21)?,
            error_message: row.get(22)?,
            tokens_used: row.get(23)?,
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
            .query_map([], |row| {
                Ok(VideoCleanupRow {
                    id: row.get(0)?,
                    file_path: row.get(1)?,
                    first_frame_path: row.get(2)?,
                    last_frame_path: row.get(3)?,
                    vocals_path: row.get(4)?,
                    bgm_path: row.get(5)?,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();

        for VideoCleanupRow {
            id,
            file_path,
            first_frame_path,
            last_frame_path,
            vocals_path,
            bgm_path,
        } in video_rows
        {
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
