use crate::commands::generation::AppState;
use crate::storage::ProjectRecord;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub image_count: i64,
    pub video_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateProjectRequest {
    pub name: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateProjectRequest {
    pub name: String,
    pub description: Option<String>,
}

#[tauri::command]
pub async fn create_project(
    state: State<'_, AppState>,
    request: CreateProjectRequest,
) -> Result<Project, String> {
    let now = Utc::now();
    let record = ProjectRecord {
        id: Uuid::new_v4().to_string(),
        name: request.name,
        description: request.description,
        created_at: now,
        updated_at: now,
    };

    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.insert_project(&record).map_err(|e| e.to_string())?;

    Ok(Project {
        id: record.id,
        name: record.name,
        description: record.description,
        created_at: record.created_at.to_rfc3339(),
        updated_at: record.updated_at.to_rfc3339(),
        image_count: 0,
        video_count: 0,
    })
}

#[tauri::command]
pub async fn get_projects(state: State<'_, AppState>) -> Result<Vec<Project>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let records = db.get_projects().map_err(|e| e.to_string())?;

    let mut projects = Vec::new();
    for record in records {
        let image_count = db
            .get_image_count(Some(&record.id))
            .map_err(|e| e.to_string())?;
        let video_count = db
            .get_video_count(Some(&record.id))
            .map_err(|e| e.to_string())?;

        projects.push(Project {
            id: record.id,
            name: record.name,
            description: record.description,
            created_at: record.created_at.to_rfc3339(),
            updated_at: record.updated_at.to_rfc3339(),
            image_count,
            video_count,
        });
    }

    Ok(projects)
}

#[tauri::command]
pub async fn get_project(
    state: State<'_, AppState>,
    id: String,
) -> Result<Option<Project>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let record = db.get_project_by_id(&id).map_err(|e| e.to_string())?;

    match record {
        Some(record) => {
            let image_count = db
                .get_image_count(Some(&record.id))
                .map_err(|e| e.to_string())?;
            let video_count = db
                .get_video_count(Some(&record.id))
                .map_err(|e| e.to_string())?;

            Ok(Some(Project {
                id: record.id,
                name: record.name,
                description: record.description,
                created_at: record.created_at.to_rfc3339(),
                updated_at: record.updated_at.to_rfc3339(),
                image_count,
                video_count,
            }))
        }
        None => Ok(None),
    }
}

#[tauri::command]
pub async fn update_project(
    state: State<'_, AppState>,
    id: String,
    request: UpdateProjectRequest,
) -> Result<bool, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.update_project(&id, &request.name, request.description.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_project(state: State<'_, AppState>, id: String) -> Result<bool, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.delete_project(&id).map_err(|e| e.to_string())
}
