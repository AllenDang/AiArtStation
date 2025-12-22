use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

const DB_FILE: &str = "data.db";

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
    pub prompt: String,
    pub model: String,
    pub size: String,
    pub aspect_ratio: String,
    pub generation_type: String, // "text-to-image", "image-to-image", "multi-fusion"
    pub reference_images: Vec<String>,
    pub tokens_used: i64,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoRecord {
    pub id: String,
    pub project_id: Option<String>,
    pub task_id: String,           // API task ID for polling
    pub file_path: Option<String>, // Local path after download
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
}

#[derive(Debug, Default)]
pub struct VideoStatusUpdate<'a> {
    pub status: &'a str,
    pub file_path: Option<&'a str>,
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

        self.conn.execute(
            "INSERT INTO images (id, project_id, batch_id, file_path, prompt, model, size, aspect_ratio, generation_type, reference_images, tokens_used, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                record.id,
                record.project_id,
                record.batch_id,
                record.file_path,
                record.prompt,
                record.model,
                record.size,
                record.aspect_ratio,
                record.generation_type,
                reference_json,
                record.tokens_used,
                record.created_at.to_rfc3339(),
            ],
        ).context("Failed to insert image record")?;

        Ok(())
    }

    pub fn get_images_by_project(&self, project_id: &str, limit: i64, offset: i64) -> Result<Vec<ImageRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, project_id, batch_id, file_path, prompt, model, size, aspect_ratio, generation_type, reference_images, tokens_used, created_at
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
            "SELECT id, project_id, batch_id, file_path, prompt, model, size, aspect_ratio, generation_type, reference_images, tokens_used, created_at
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
            "SELECT id, project_id, batch_id, file_path, prompt, model, size, aspect_ratio, generation_type, reference_images, tokens_used, created_at
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

    fn map_image_row(row: &rusqlite::Row) -> rusqlite::Result<ImageRecord> {
        let reference_json: String = row.get(9)?;
        let created_at_str: String = row.get(11)?;
        Ok(ImageRecord {
            id: row.get(0)?,
            project_id: row.get(1)?,
            batch_id: row.get(2)?,
            file_path: row.get(3)?,
            prompt: row.get(4)?,
            model: row.get(5)?,
            size: row.get(6)?,
            aspect_ratio: row.get(7)?,
            generation_type: row.get(8)?,
            reference_images: serde_json::from_str(&reference_json).unwrap_or_default(),
            tokens_used: row.get(10)?,
            created_at: DateTime::parse_from_rfc3339(&created_at_str)
                .map(|dt| dt.with_timezone(&Utc))
                .unwrap_or_else(|_| Utc::now()),
        })
    }

    // ========================================================================
    // Video Methods
    // ========================================================================

    pub fn insert_video(&self, record: &VideoRecord) -> Result<()> {
        self.conn.execute(
            "INSERT INTO videos (id, project_id, task_id, file_path, prompt, model, generation_type, source_image_id, resolution, duration, fps, aspect_ratio, status, error_message, tokens_used, created_at, completed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
            params![
                record.id,
                record.project_id,
                record.task_id,
                record.file_path,
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
            ],
        ).context("Failed to insert video")?;
        Ok(())
    }

    pub fn get_videos_by_project(&self, project_id: &str, limit: i64, offset: i64) -> Result<Vec<VideoRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, project_id, task_id, file_path, prompt, model, generation_type, source_image_id, resolution, duration, fps, aspect_ratio, status, error_message, tokens_used, created_at, completed_at
             FROM videos
             WHERE project_id = ?1
             ORDER BY created_at DESC
             LIMIT ?2 OFFSET ?3"
        )?;

        let rows = stmt.query_map(params![project_id, limit, offset], Self::map_video_row)?;
        rows.collect::<Result<Vec<_>, _>>().context("Failed to get videos by project")
    }

    pub fn get_video_by_id(&self, id: &str) -> Result<Option<VideoRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, project_id, task_id, file_path, prompt, model, generation_type, source_image_id, resolution, duration, fps, aspect_ratio, status, error_message, tokens_used, created_at, completed_at
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
            "SELECT id, project_id, task_id, file_path, prompt, model, generation_type, source_image_id, resolution, duration, fps, aspect_ratio, status, error_message, tokens_used, created_at, completed_at
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
            "UPDATE videos SET status = ?1, file_path = COALESCE(?2, file_path), resolution = COALESCE(?3, resolution), duration = COALESCE(?4, duration), fps = COALESCE(?5, fps), tokens_used = COALESCE(?6, tokens_used), error_message = ?7, completed_at = COALESCE(?8, completed_at) WHERE id = ?9",
            params![update.status, update.file_path, update.resolution, update.duration, update.fps, update.tokens_used, update.error_message, completed_at, id],
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
        let created_at_str: String = row.get(15)?;
        let completed_at_str: Option<String> = row.get(16)?;
        Ok(VideoRecord {
            id: row.get(0)?,
            project_id: row.get(1)?,
            task_id: row.get(2)?,
            file_path: row.get(3)?,
            prompt: row.get(4)?,
            model: row.get(5)?,
            generation_type: row.get(6)?,
            source_image_id: row.get(7)?,
            resolution: row.get(8)?,
            duration: row.get(9)?,
            fps: row.get(10)?,
            aspect_ratio: row.get(11)?,
            status: row.get(12)?,
            error_message: row.get(13)?,
            tokens_used: row.get(14)?,
            created_at: DateTime::parse_from_rfc3339(&created_at_str)
                .map(|dt| dt.with_timezone(&Utc))
                .unwrap_or_else(|_| Utc::now()),
            completed_at: completed_at_str.and_then(|s| {
                DateTime::parse_from_rfc3339(&s)
                    .map(|dt| dt.with_timezone(&Utc))
                    .ok()
            }),
        })
    }
}
