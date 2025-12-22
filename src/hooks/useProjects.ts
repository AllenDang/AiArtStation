import { invoke } from "@tauri-apps/api/core";
import { useState, useCallback, useEffect } from "react";
import type { Project, CreateProjectRequest, UpdateProjectRequest } from "../types";

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadProjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<Project[]>("get_projects");
      setProjects(result);
      return result;
    } catch (e) {
      setError(String(e));
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  const createProject = useCallback(async (request: CreateProjectRequest) => {
    setError(null);
    try {
      const project = await invoke<Project>("create_project", { request });
      setProjects((prev) => [project, ...prev]);
      return project;
    } catch (e) {
      setError(String(e));
      throw e;
    }
  }, []);

  const updateProject = useCallback(async (id: string, request: UpdateProjectRequest) => {
    setError(null);
    try {
      await invoke<boolean>("update_project", { id, request });
      // Refresh projects to get updated data
      await loadProjects();
    } catch (e) {
      setError(String(e));
      throw e;
    }
  }, [loadProjects]);

  const deleteProject = useCallback(async (id: string) => {
    setError(null);
    try {
      await invoke<boolean>("delete_project", { id });
      setProjects((prev) => prev.filter((p) => p.id !== id));
      if (currentProject?.id === id) {
        setCurrentProject(null);
      }
    } catch (e) {
      setError(String(e));
      throw e;
    }
  }, [currentProject]);

  const selectProject = useCallback((project: Project | null) => {
    setCurrentProject(project);
  }, []);

  // Load projects on mount and auto-select the first one
  useEffect(() => {
    loadProjects().then((result) => {
      // Auto-select the first project (most recently updated) if none selected
      if (result && result.length > 0 && !currentProject) {
        setCurrentProject(result[0]);
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    projects,
    currentProject,
    loading,
    error,
    loadProjects,
    createProject,
    updateProject,
    deleteProject,
    selectProject,
  };
}
