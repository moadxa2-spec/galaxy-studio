// ═══════════════════════════════════════════
//  Galaxy Studio — storage.js
//  Multi-project persistence
// ═══════════════════════════════════════════

const STORAGE_PREFIX = 'gs_proj_';
const STORAGE_LIST_KEY = 'gs_project_list';

/**
 * Generate a unique project ID.
 */
function generateProjectId() {
  return 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

/**
 * Get the list of project metadata (without full data).
 * Returns: [{ id, name, fileCount, updatedAt, phase }]
 */
function listProjects() {
  try {
    const raw = localStorage.getItem(STORAGE_LIST_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/**
 * Save the project list metadata.
 */
function saveProjectList(list) {
  try {
    localStorage.setItem(STORAGE_LIST_KEY, JSON.stringify(list));
  } catch (e) {
    console.warn('Failed to save project list:', e.message);
  }
}

/**
 * Save a project by ID with all its data.
 */
function saveProject(id, data) {
  if (!id) return;
  try {
    const project = {
      id,
      messages: data.messages || [],
      versions: data.versions || [],
      currentVersion: data.currentVersion ?? -1,
      currentCode: data.currentCode || '',
      currentFiles: data.currentFiles || {},
      phase: data.phase || 'planning',
      currentPlan: data.currentPlan || null,
      provider: data.provider || '',
      model: data.model || '',
      name: data.name || 'Untitled',
      updatedAt: Date.now()
    };
    localStorage.setItem(STORAGE_PREFIX + id, JSON.stringify(project));

    // Update the project list metadata
    const list = listProjects();
    const idx = list.findIndex(p => p.id === id);
    const meta = {
      id,
      name: project.name,
      fileCount: Object.keys(project.currentFiles).length,
      updatedAt: project.updatedAt,
      phase: project.phase
    };
    if (idx >= 0) {
      list[idx] = meta;
    } else {
      list.unshift(meta);
    }
    saveProjectList(list);
  } catch (e) {
    console.warn('Failed to save project:', e.message);
  }
}

/**
 * Load a project by ID. Returns the full project data or null.
 */
function loadProjectById(id) {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + id);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Delete a project by ID.
 */
function deleteProject(id) {
  localStorage.removeItem(STORAGE_PREFIX + id);
  const list = listProjects().filter(p => p.id !== id);
  saveProjectList(list);
}

/**
 * Export a project as a JSON blob for download.
 */
function exportProjectAsJSON(id) {
  const project = loadProjectById(id);
  if (!project) return null;
  return new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
}

/**
 * Import a project from a JSON string.
 * Returns the new project ID.
 */
function importProjectFromJSON(jsonStr) {
  try {
    const data = JSON.parse(jsonStr);
    const id = generateProjectId();
    data.id = id;
    saveProject(id, data);
    return id;
  } catch (e) {
    console.error('Import failed:', e.message);
    return null;
  }
}

/**
 * Migrate from old single-project format (gs_project) to new multi-project format.
 * Called once on startup.
 */
function migrateOldProject() {
  try {
    const old = localStorage.getItem('gs_project');
    if (!old) return null;
    const data = JSON.parse(old);
    if (!data.messages?.length && !data.currentCode && !Object.keys(data.currentFiles || {}).length) {
      return null; // Empty project, skip
    }

    // Create a new project from old data
    const id = generateProjectId();
    const project = {
      id,
      messages: data.messages || [],
      versions: data.versions || [],
      currentVersion: data.currentVersion ?? -1,
      currentCode: data.currentCode || '',
      currentFiles: data.currentFiles || {},
      phase: data.phase || 'planning',
      currentPlan: null,
      provider: data.provider || '',
      model: data.model || '',
      name: data.name || 'Migrated Project',
      updatedAt: data.updatedAt || Date.now()
    };

    localStorage.setItem(STORAGE_PREFIX + id, JSON.stringify(project));

    // Create project list with this entry
    const list = listProjects();
    list.unshift({
      id,
      name: project.name,
      fileCount: Object.keys(project.currentFiles).length,
      updatedAt: project.updatedAt,
      phase: project.phase
    });
    saveProjectList(list);

    // Remove old key
    localStorage.removeItem('gs_project');

    console.log('✦ Migrated old project to multi-project format:', id);
    return id;
  } catch (e) {
    console.warn('Migration failed:', e.message);
    return null;
  }
}

console.log('✦ storage.js loaded');
