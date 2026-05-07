// ═══════════════════════════════════════════
//  Galaxy Studio — storage.js
//  Supabase-backed multi-user persistence
//  Falls back to localStorage when offline
// ═══════════════════════════════════════════

// ── SUPABASE CLIENT ──
// Loaded from CDN in index.html before this script
let _sb = null;
function getSB() {
  if (!_sb && window.__supabase) {
    _sb = window.__supabase.createClient(
      window.GS_CONFIG.supabaseUrl,
      window.GS_CONFIG.supabaseAnonKey
    );
  }
  return _sb;
}

// ── LOCAL CACHE ──
const LC = {
  get(key) { try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : null; } catch { return null; } },
  set(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} },
  del(key) { try { localStorage.removeItem(key); } catch {} }
};

// ── AUTH STATE ──
let _currentUser = null;
function setCurrentUser(user) { _currentUser = user; }
function getCurrentUser() { return _currentUser; }

// ── HELPERS ──
function generateId() {
  return 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

function generateSlug() {
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
}

// ═══════════════════════════════════════════
//  PROJECT LIST
// ═══════════════════════════════════════════

async function listProjects() {
  const sb = getSB();
  if (!sb || !_currentUser) {
    // Offline fallback
    return LC.get('gs_project_list') || [];
  }
  try {
    const { data, error } = await sb
      .from('projects')
      .select('id, name, description, phase, current_version, is_public, share_slug, created_at, updated_at')
      .eq('user_id', _currentUser.id)
      .order('updated_at', { ascending: false });
    if (error) throw error;
    const list = (data || []).map(p => ({
      id: p.id,
      name: p.name,
      phase: p.phase,
      fileCount: 0, // not loaded here
      updatedAt: new Date(p.updated_at).getTime(),
      isPublic: p.is_public,
      shareSlug: p.share_slug
    }));
    LC.set('gs_project_list', list);
    return list;
  } catch (e) {
    console.warn('listProjects fallback:', e.message);
    return LC.get('gs_project_list') || [];
  }
}

// ═══════════════════════════════════════════
//  LOAD PROJECT
// ═══════════════════════════════════════════

async function loadProjectById(id) {
  if (!id) return null;
  const sb = getSB();

  // Try local cache first for speed
  const cached = LC.get('gs_proj_' + id);

  if (!sb || !_currentUser) return cached;

  try {
    const [projRes, filesRes, msgsRes, versRes] = await Promise.all([
      sb.from('projects').select('*').eq('id', id).maybeSingle(),
      sb.from('project_files').select('path, content').eq('project_id', id),
      sb.from('messages').select('*').eq('project_id', id).order('created_at', { ascending: true }),
      sb.from('versions').select('*').eq('project_id', id).order('version_number', { ascending: true })
    ]);

    if (projRes.error || !projRes.data) return cached;

    const p = projRes.data;
    const files = {};
    (filesRes.data || []).forEach(f => { files[f.path] = f.content; });

    const versions = (versRes.data || []).map(v => ({
      files: v.files_snapshot,
      prompt: v.prompt,
      timestamp: new Date(v.created_at).getTime(),
      model: v.model,
      tokens: v.tokens_used
    }));

    const messages = (msgsRes.data || []).map(m => ({
      role: m.role,
      content: m.content,
      toolCalls: m.tool_calls,
      activity: m.activity,
      model: m.model
    }));

    const project = {
      id: p.id,
      name: p.name,
      description: p.description,
      phase: p.phase,
      currentVersion: p.current_version,
      currentFiles: files,
      currentCode: Object.values(files).join('\n'),
      versions,
      messages,
      isPublic: p.is_public,
      shareSlug: p.share_slug,
      updatedAt: new Date(p.updated_at).getTime()
    };

    LC.set('gs_proj_' + id, project);
    return project;
  } catch (e) {
    console.warn('loadProjectById fallback:', e.message);
    return cached;
  }
}

// ═══════════════════════════════════════════
//  SAVE PROJECT
// ═══════════════════════════════════════════

async function saveProject(id, data) {
  if (!id) return;
  const project = {
    id,
    name: data.name || 'Untitled',
    description: data.description || '',
    messages: data.messages || [],
    versions: data.versions || [],
    currentVersion: data.currentVersion ?? -1,
    currentCode: data.currentCode || '',
    currentFiles: data.currentFiles || {},
    phase: data.phase || 'planning',
    currentPlan: data.currentPlan || null,
    isPublic: data.isPublic || false,
    shareSlug: data.shareSlug || null,
    updatedAt: Date.now()
  };

  // Always write to local cache immediately for responsiveness
  LC.set('gs_proj_' + id, project);

  // Update local project list cache
  const list = LC.get('gs_project_list') || [];
  const idx = list.findIndex(p => p.id === id);
  const meta = {
    id,
    name: project.name,
    phase: project.phase,
    fileCount: Object.keys(project.currentFiles).length,
    updatedAt: project.updatedAt,
    isPublic: project.isPublic,
    shareSlug: project.shareSlug
  };
  if (idx >= 0) list[idx] = meta; else list.unshift(meta);
  LC.set('gs_project_list', list);

  const sb = getSB();
  if (!sb || !_currentUser) return;

  try {
    // Upsert the project row
    const { error: projErr } = await sb.from('projects').upsert({
      id,
      user_id: _currentUser.id,
      name: project.name,
      description: project.description,
      phase: project.phase,
      current_version: project.currentVersion,
      is_public: project.isPublic,
      share_slug: project.shareSlug,
      updated_at: new Date().toISOString()
    }, { onConflict: 'id' });
    if (projErr) throw projErr;

    // Upsert all files
    if (Object.keys(project.currentFiles).length > 0) {
      const fileRows = Object.entries(project.currentFiles).map(([path, content]) => ({
        project_id: id,
        path,
        content,
        updated_at: new Date().toISOString()
      }));
      const { error: fileErr } = await sb.from('project_files').upsert(fileRows, { onConflict: 'project_id,path' });
      if (fileErr) console.warn('saveProject files error:', fileErr.message);
    }
  } catch (e) {
    console.warn('saveProject remote error:', e.message);
  }
}

// ═══════════════════════════════════════════
//  ADD MESSAGE
// ═══════════════════════════════════════════

async function persistMessage(projectId, msg) {
  const sb = getSB();
  if (!sb || !_currentUser || !projectId) return;
  try {
    await sb.from('messages').insert({
      project_id: projectId,
      role: msg.role,
      content: msg.content || '',
      tool_calls: msg.toolCalls || [],
      activity: msg.activity || '',
      model: msg.model || ''
    });
  } catch (e) {
    console.warn('persistMessage error:', e.message);
  }
}

// ═══════════════════════════════════════════
//  ADD VERSION
// ═══════════════════════════════════════════

async function persistVersion(projectId, versionNumber, versionData) {
  const sb = getSB();
  if (!sb || !_currentUser || !projectId) return;
  try {
    await sb.from('versions').upsert({
      project_id: projectId,
      version_number: versionNumber,
      files_snapshot: versionData.files || {},
      prompt: versionData.prompt || '',
      tokens_used: versionData.tokens || 0,
      model: versionData.model || ''
    }, { onConflict: 'project_id,version_number' });
  } catch (e) {
    console.warn('persistVersion error:', e.message);
  }
}

// ═══════════════════════════════════════════
//  DELETE PROJECT
// ═══════════════════════════════════════════

async function deleteProject(id) {
  LC.del('gs_proj_' + id);
  const list = (LC.get('gs_project_list') || []).filter(p => p.id !== id);
  LC.set('gs_project_list', list);

  const sb = getSB();
  if (!sb || !_currentUser) return;
  try {
    await sb.from('projects').delete().eq('id', id).eq('user_id', _currentUser.id);
  } catch (e) {
    console.warn('deleteProject remote error:', e.message);
  }
}

// ═══════════════════════════════════════════
//  USER SETTINGS
// ═══════════════════════════════════════════

async function loadUserSettings() {
  const sb = getSB();
  const defaults = {
    provider: localStorage.getItem('gs_provider') || 'gemini',
    url: localStorage.getItem('gs_url') || 'http://localhost:11434',
    model: localStorage.getItem('gs_model') || 'gemini-2.5-flash-preview-04-17',
    maxTokens: 64000
  };
  if (!sb || !_currentUser) return defaults;
  try {
    const { data } = await sb
      .from('user_settings')
      .select('provider, model, max_tokens, encrypted_api_keys')
      .eq('user_id', _currentUser.id)
      .maybeSingle();
    if (!data) return defaults;
    return {
      provider: data.provider || defaults.provider,
      model: data.model || defaults.model,
      maxTokens: data.max_tokens || defaults.maxTokens,
      encryptedKeys: data.encrypted_api_keys || {}
    };
  } catch {
    return defaults;
  }
}

async function saveUserSettings(settings) {
  const sb = getSB();
  // Always persist provider+model to localStorage for instant load
  localStorage.setItem('gs_provider', settings.provider || '');
  localStorage.setItem('gs_model', settings.model || '');

  if (!sb || !_currentUser) return;
  try {
    await sb.from('user_settings').upsert({
      user_id: _currentUser.id,
      provider: settings.provider,
      model: settings.model,
      max_tokens: settings.maxTokens || 64000,
      encrypted_api_keys: settings.encryptedKeys || {},
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });
  } catch (e) {
    console.warn('saveUserSettings error:', e.message);
  }
}

// ═══════════════════════════════════════════
//  TEMPLATES
// ═══════════════════════════════════════════

async function loadTemplates() {
  const sb = getSB();
  if (!sb) return [];
  try {
    const { data } = await sb
      .from('templates')
      .select('id, name, description, category, icon, prompt, sort_order')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });
    return data || [];
  } catch {
    return [];
  }
}

// ═══════════════════════════════════════════
//  PUBLIC PROJECT (for share URLs)
// ═══════════════════════════════════════════

async function loadPublicProject(slug) {
  const sb = getSB();
  if (!sb) return null;
  try {
    const { data: proj } = await sb
      .from('projects')
      .select('id, name, description')
      .eq('share_slug', slug)
      .eq('is_public', true)
      .maybeSingle();
    if (!proj) return null;

    const { data: files } = await sb
      .from('project_files')
      .select('path, content')
      .eq('project_id', proj.id);

    const fileMap = {};
    (files || []).forEach(f => { fileMap[f.path] = f.content; });
    return { ...proj, files: fileMap };
  } catch {
    return null;
  }
}

async function setProjectPublic(id, isPublic) {
  const sb = getSB();
  if (!sb || !_currentUser) return null;
  try {
    const slug = isPublic ? generateSlug() : null;
    const { error } = await sb.from('projects')
      .update({ is_public: isPublic, share_slug: slug, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', _currentUser.id);
    if (error) throw error;
    return slug;
  } catch (e) {
    console.warn('setProjectPublic error:', e.message);
    return null;
  }
}

// ═══════════════════════════════════════════
//  USAGE LOG
// ═══════════════════════════════════════════

async function logUsage(provider, model, tokensIn, tokensOut) {
  const sb = getSB();
  if (!sb || !_currentUser) return;
  try {
    await sb.from('usage_logs').insert({
      user_id: _currentUser.id,
      provider,
      model,
      tokens_in: tokensIn || 0,
      tokens_out: tokensOut || 0,
      status: 'ok'
    });
  } catch {}
}

// ═══════════════════════════════════════════
//  FEEDBACK
// ═══════════════════════════════════════════

async function submitFeedback(type, message) {
  const sb = getSB();
  if (!sb || !_currentUser) return false;
  try {
    await sb.from('feedback').insert({
      user_id: _currentUser.id,
      type: type || 'bug',
      message
    });
    return true;
  } catch {
    return false;
  }
}

// ═══════════════════════════════════════════
//  LEGACY MIGRATION
// ═══════════════════════════════════════════

async function migrateOldProject() {
  try {
    const old = localStorage.getItem('gs_project');
    if (!old) return null;
    const data = JSON.parse(old);
    if (!data.messages?.length && !data.currentCode && !Object.keys(data.currentFiles || {}).length) {
      localStorage.removeItem('gs_project');
      return null;
    }
    const id = generateId();
    data.id = id;
    data.name = data.name || 'Migrated Project';
    await saveProject(id, data);
    localStorage.removeItem('gs_project');
    console.log('✦ Migrated old project:', id);
    return id;
  } catch (e) {
    console.warn('Migration failed:', e.message);
    return null;
  }
}

// generateProjectId kept for backwards compat with app.js
function generateProjectId() { return generateId(); }

console.log('✦ storage.js loaded (Supabase)');
