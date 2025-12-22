use crate::crypto::{decrypt, derive_key, encrypt};
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

const CONFIG_FILE: &str = "config.enc";
const DEFAULT_PASSWORD: &str = "ai-artstation-default";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub base_url: String,
    pub api_token: String,
    pub image_model: String,
    pub video_model: String,
    pub output_directory: String,
    pub output_format: String,
    pub organize_by_date: bool,
    pub save_metadata: bool,
    pub default_size: String,
    pub default_aspect_ratio: String,
    pub watermark: bool,
}

pub struct ConfigStore {
    config_path: PathBuf,
    password: String,
}

impl ConfigStore {
    pub fn new(app_data_dir: PathBuf) -> Result<Self> {
        fs::create_dir_all(&app_data_dir)
            .context("Failed to create app data directory")?;

        Ok(Self {
            config_path: app_data_dir.join(CONFIG_FILE),
            password: DEFAULT_PASSWORD.to_string(),
        })
    }

    /// Save config to encrypted file.
    pub fn save(&self, config: &AppConfig) -> Result<()> {
        let json = serde_json::to_string(config)
            .context("Failed to serialize config")?;

        let key = derive_key(&self.password);
        let encrypted = encrypt(json.as_bytes(), &key)
            .context("Failed to encrypt config")?;

        fs::write(&self.config_path, encrypted)
            .context("Failed to write config file")?;

        Ok(())
    }

    /// Load config from encrypted file
    pub fn load(&self) -> Result<AppConfig> {
        if !self.config_path.exists() {
            return Ok(AppConfig::default());
        }

        let encrypted = fs::read(&self.config_path)
            .context("Failed to read config file")?;

        let key = derive_key(&self.password);
        let decrypted = decrypt(&encrypted, &key)
            .context("Failed to decrypt config")?;

        let json = String::from_utf8(decrypted)
            .context("Invalid UTF-8 in config")?;

        serde_json::from_str(&json)
            .context("Failed to parse config JSON")
    }

    /// Delete config file.
    pub fn delete(&self) -> Result<()> {
        if self.config_path.exists() {
            fs::remove_file(&self.config_path)
                .context("Failed to delete config file")?;
        }
        Ok(())
    }
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
            organize_by_date: true,
            save_metadata: true,
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

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_save_load_config() {
        let dir = tempdir().unwrap();
        let store = ConfigStore::new(dir.path().to_path_buf()).unwrap();

        let config = AppConfig {
            base_url: "https://api.example.com".to_string(),
            api_token: "secret-token".to_string(),
            image_model: "test-model".to_string(),
            ..Default::default()
        };

        store.save(&config).unwrap();
        let loaded = store.load().unwrap();

        assert_eq!(config.base_url, loaded.base_url);
        assert_eq!(config.api_token, loaded.api_token);
        assert_eq!(config.image_model, loaded.image_model);
    }
}
