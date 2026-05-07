// ═══════════════════════════════════════════
//  Galaxy Studio — ui.js
//  DOM manipulation and rendering
// ═══════════════════════════════════════════

const $ = id => document.getElementById(id);
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// ── DOM REFS ──
const providerSelect = $('providerSelect');
const ollamaUrlInput = $('ollamaUrl');
const apiKeyInput = $('apiKey');
const modelSelect = $('modelSelect');
const modelInput = $('modelInput');
const fetchBtn = $('fetchBtn');
const statusDot = $('statusDot');
const providerLabel = $('providerLabel');
const modelLabel = $('modelLabel');
const chatHistory = $('chatHistory');
const emptyChat = $('emptyChat');
const promptEl = $('prompt');
const sendBtn = $('sendBtn');

function openModal(id) { $(id).classList.remove('hidden'); }
function closeModal(id) { $(id).classList.add('hidden'); }

function setStatus(s) {
  statusDot.className = 'provider-dot' + (s === 'ok' ? ' ok' : s === 'err' ? ' err' : s === 'busy' ? ' busy' : '');
}

// ═══════════ CHAT UI ═══════════
function appendMsg(role, content) {
  emptyChat.classList.add('hidden');
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  const label = role === 'user' ? 'You' : (cfg.model || 'AI');
  div.innerHTML = `<div class="msg-role">${esc(label)}</div><div class="msg-bubble formatted">${esc(content)}</div>`;
  chatHistory.appendChild(div);
  chatHistory.scrollTop = chatHistory.scrollHeight;
  return div;
}

const THINKING_STEPS = {
  planning: ['Understanding your idea...', 'Analyzing requirements...', 'Preparing questions...', 'Thinking about features...'],
  building: ['Analyzing the plan...', 'Designing layout...', 'Writing HTML structure...', 'Adding styles & CSS...', 'Implementing JavaScript...', 'Adding animations...', 'Polishing details...'],
  refining: ['Reading your feedback...', 'Analyzing the issue...', 'Updating the code...', 'Testing changes...']
};

function appendThinking() {
  const div = document.createElement('div');
  div.className = 'msg assistant'; div.id = 'thinkingBubble';
  const phaseLabel = phase === 'planning' ? '🤔 Planning' : phase === 'building' ? '🏗️ Building' : '🔧 Refining';
  div.innerHTML = `<div class="msg-role">${esc(cfg.model || 'AI')}</div>
    <div class="thinking-rich">
      <div class="thinking-header">
        <div class="thinking-dots"><span></span><span></span><span></span></div>
        <span class="thinking-phase">${phaseLabel}</span>
        <span class="thinking-timer" id="thinkingTime">0s</span>
      </div>
      <div class="thinking-step" id="thinkingStep">${THINKING_STEPS[phase]?.[0] || 'Thinking...'}</div>
    </div>`;
  chatHistory.appendChild(div);
  chatHistory.scrollTop = chatHistory.scrollHeight;
  
  // Start timer
  thinkingStartTime = Date.now();
  let stepIdx = 0;
  const steps = THINKING_STEPS[phase] || ['Thinking...'];
  thinkingTimer = setInterval(() => {
    const elapsed = Math.round((Date.now() - thinkingStartTime) / 1000);
    const timeEl = $('thinkingTime');
    const stepEl = $('thinkingStep');
    if (timeEl) timeEl.textContent = elapsed + 's';
    if (stepEl && elapsed > 0 && elapsed % 4 === 0) {
      stepIdx = Math.min(stepIdx + 1, steps.length - 1);
      stepEl.textContent = steps[stepIdx];
    }
    chatHistory.scrollTop = chatHistory.scrollHeight;
  }, 1000);
}

function removeThinking() {
  if (thinkingTimer) { clearInterval(thinkingTimer); thinkingTimer = null; }
  const el = $('thinkingBubble'); if (el) el.remove();
}

// ═══════════ PLAN & QUESTIONS UI ═══════════
function parseQuestions(text) {
  const cleaned = text.replace(/QUESTIONS:\n?/i, '').trim();
  const lines = cleaned.split('\n').filter(l => l.trim());
  const questions = [];
  let current = null;
  for (const line of lines) {
    const match = line.match(/^\d+\.\s*(.+)/);
    if (match) {
      if (current) questions.push(current);
      current = { text: match[1].trim(), options: [] };
      const optMatch = match[1].match(/\((?:e\.g\.?,?\s*)?([^)]+)\)/i);
      if (optMatch) {
        current.options = optMatch[1].split(/,\s*/).map(o => o.trim()).filter(o => o.length > 0 && o.length < 40);
        current.text = match[1].replace(/\s*\([^)]+\)/g, '').replace(/\?\s*$/, '').trim() + '?';
      }
    } else if (current) {
      current.text += ' ' + line.trim();
    }
  }
  if (current) questions.push(current);
  return questions;
}

function renderQuestions(text, secs, tokens) {
  const questions = parseQuestions(text);
  const div = document.createElement('div');
  div.className = 'msg assistant';

  let qHtml = '<div class="q-list">';
  questions.forEach((q, i) => {
    qHtml += `<div class="q-item">
      <div class="q-num">${i + 1}</div>
      <div class="q-text">${esc(q.text)}`;
    if (q.options.length > 0) {
      qHtml += '<div class="q-options">';
      q.options.forEach(opt => {
        qHtml += `<button class="q-chip" data-qnum="${i+1}" data-value="${esc(opt)}">${esc(opt)}</button>`;
      });
      qHtml += '</div>';
    }
    qHtml += '</div></div>';
  });
  qHtml += '</div>';

  div.innerHTML = `<div class="msg-role">${esc(cfg.model || 'AI')}</div>
    <div class="plan-card">
      <div class="plan-header"><span>🤔</span> Clarifying Questions <span class="plan-meta">${secs}s${tokens ? ' · '+tokens+' tokens' : ''}</span></div>
      <div class="plan-body">${qHtml}</div>
      <div class="plan-hint">💡 Click the chips to select, or type your own answers below.</div>
    </div>`;

  // Add chip click handlers
  div.querySelectorAll('.q-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const val = chip.dataset.value;
      const num = chip.dataset.qnum;
      const current = promptEl.value;
      const prefix = current ? current + '\n' : '';
      promptEl.value = prefix + num + '. ' + val;
      promptEl.focus();
      chip.style.background = 'var(--accent-glow)';
      chip.style.borderColor = 'var(--accent)';
      chip.style.color = 'var(--accent2)';
    });
  });

  chatHistory.appendChild(div);
  chatHistory.scrollTop = chatHistory.scrollHeight;
}

function formatPlanBody(text) {
  const cleaned = text.replace(/PLAN:\n?/i, '').trim();
  const lines = cleaned.split('\n');
  let html = '';
  let inSection = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { if (inSection) html += '</div>'; inSection = false; continue; }
    if (/^(Features|Design|Technical|App Name|Description):?/i.test(trimmed)) {
      if (inSection) html += '</div>';
      const colonIdx = trimmed.indexOf(':');
      const key = trimmed.slice(0, colonIdx).trim();
      const val = trimmed.slice(colonIdx + 1).trim();
      if (val) {
        html += `<div class="plan-field"><strong>${esc(key)}:</strong> ${esc(val)}</div>`;
        inSection = false;
      } else {
        html += `<div class="plan-section"><div class="plan-section-title">${esc(key)}</div>`;
        inSection = true;
      }
    } else if (trimmed.startsWith('-')) {
      html += `<div class="plan-feature">${esc(trimmed.slice(1).trim())}</div>`;
    } else {
      html += `<div class="plan-field">${esc(trimmed)}</div>`;
    }
  }
  if (inSection) html += '</div>';
  return html;
}

function renderPlanCard(text, secs, tokens) {
  const div = document.createElement('div');
  div.className = 'msg assistant';
  const bodyHtml = formatPlanBody(text);
  div.innerHTML = `<div class="msg-role">${esc(cfg.model || 'AI')}</div>
    <div class="plan-card">
      <div class="plan-header"><span>📋</span> Project Plan <span class="plan-meta">${secs}s${tokens ? ' · '+tokens+' tokens' : ''}</span></div>
      <div class="plan-body">${bodyHtml}</div>
      <div class="plan-actions">
        <button class="plan-btn plan-btn-approve" onclick="approvePlan()">✅ Approve & Build</button>
        <button class="plan-btn plan-btn-modify" onclick="modifyPlan()">✏️ Modify Plan</button>
      </div>
    </div>`;
  chatHistory.appendChild(div);
  chatHistory.scrollTop = chatHistory.scrollHeight;
}

// ═══════════ PROJECT SIDEBAR ═══════════
function renderProjectSidebar(projects) {
  const listEl = $('projectList');
  if (!listEl) return;
  
  if (projects.length === 0) {
    listEl.innerHTML = '<div class="sidebar-empty">No projects yet</div>';
    return;
  }

  listEl.innerHTML = projects.map(p => `
    <div class="project-item ${currentProjectId === p.id ? 'active' : ''}" data-id="${p.id}">
      <div class="project-item-title">${esc(p.name)}</div>
      <div class="project-item-meta">${p.fileCount} files · ${new Date(p.updatedAt).toLocaleDateString()}</div>
      <button class="project-item-delete" title="Delete Project">×</button>
    </div>
  `).join('');

  listEl.querySelectorAll('.project-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('project-item-delete')) {
        e.stopPropagation();
        if (confirm('Delete this project?')) {
          deleteProject(item.dataset.id);
          if (currentProjectId === item.dataset.id) {
            newProject();
          } else {
            renderProjectSidebar(listProjects());
          }
        }
        return;
      }
      switchProject(item.dataset.id);
    });
  });
}

// ═══════════ LIVE CODE VIEW ═══════════
function renderLiveCode(path, content, done) {
  const codeEl = $('codeDisplay');
  const tabsEl = $('fileTabs');
  
  // Create or update tab if it doesn't exist
  if (!tabsEl.querySelector(`[data-file="${esc(path)}"]`)) {
    const icon = getFileIcon(path);
    const tabHtml = `<button class="file-tab active" data-file="${esc(path)}">
      <span class="file-tab-icon">${icon}</span>
      <span class="file-tab-name">${esc(path)}</span>
      ${!done ? '<span class="streaming-dot"></span>' : ''}
    </button>`;
    
    // Deactivate others
    tabsEl.querySelectorAll('.file-tab').forEach(t => t.classList.remove('active'));
    tabsEl.insertAdjacentHTML('beforeend', tabHtml);
    
    // Add click handler to new tab
    const newTab = tabsEl.lastElementChild;
    newTab.addEventListener('click', () => {
      activeFile = newTab.dataset.file;
      updateCodeDisplay(currentFiles);
    });
  }

  // Auto-switch to the file being written
  activeFile = path;
  tabsEl.querySelectorAll('.file-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.file === path);
  });

  // Switch to Code tab
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x.dataset.tab === 'code'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'panelCode'));
  
  const lang = getPrismLang(path);
  codeEl.className = `language-${lang}`;
  
  // Show blinking cursor if not done
  let displayContent = content;
  if (!done) {
    displayContent += '▍';
  }
  
  codeEl.textContent = displayContent;
  
  if (done && window.Prism) {
    safeHighlight(codeEl);
  }
  
  // Auto-scroll
  const pre = codeEl.parentElement;
  if (pre) {
    pre.scrollTop = pre.scrollHeight;
  }
}

// ═══════════ PREVIEW ═══════════
const CONSOLE_INJECT = `<script>
(function(){var O={log:console.log,error:console.error,warn:console.warn,info:console.info};
['log','error','warn','info'].forEach(function(m){console[m]=function(){O[m].apply(console,arguments);
try{window.parent.postMessage({type:'gs-console',method:m,args:Array.prototype.slice.call(arguments).map(function(a){return typeof a==='object'?JSON.stringify(a):String(a)})},'*')}catch(e){}}});
window.addEventListener('error',function(e){window.parent.postMessage({type:'gs-console',method:'error',args:[e.message+' (line '+e.lineno+')']},'*')})})();
<\/script>`;

let _previewBlobUrl = null;

function updatePreview(filesOrHtml) {
  $('previewEmpty').classList.add('hidden');
  $('previewToolbar').classList.remove('hidden');
  const frame = $('previewFrame');
  frame.classList.remove('hidden');

  let html = '';
  if (typeof filesOrHtml === 'string') {
    html = filesOrHtml;
  } else {
    const files = filesOrHtml;
    const names = Object.keys(files);
    const htmlFile = names.find(f => f === 'index.html')
      || names.find(f => f === 'popup.html')
      || names.find(f => f.endsWith('.html'));

    if (!htmlFile || !files[htmlFile] || !files[htmlFile].includes('<')) {
      html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
        <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',system-ui,sans-serif;background:#0f0f1a;color:#e0e0e0;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
        .card{background:#1a1a2e;border:1px solid #2a2a4a;border-radius:16px;padding:32px;max-width:480px;width:100%}.title{font-size:20px;font-weight:600;margin-bottom:16px;color:#a78bfa}
        .files{list-style:none;margin:0;padding:0}.file{display:flex;align-items:center;gap:10px;padding:8px 12px;margin:4px 0;background:#252542;border-radius:8px;font-family:'JetBrains Mono',monospace;font-size:13px}
        .icon{font-size:16px}.size{margin-left:auto;color:#666;font-size:11px}.hint{margin-top:16px;color:#888;font-size:12px;text-align:center}</style></head>
        <body><div class="card"><div class="title">📁 Project Files (\${names.length})</div><ul class="files">`;
      names.forEach(name => {
        const icon = getFileIcon(name);
        const lines = files[name].split('\\n').length;
        html += `<li class="file"><span class="icon">\${icon}</span>\${name}<span class="size">\${lines} lines</span></li>`;
      });
      html += `</ul><p class="hint">⬇ Download the project ZIP to use these files</p></div></body></html>`;
    } else {
      html = files[htmlFile] || '';
      // Inject CSS
      const cssFiles = Object.entries(files).filter(([f]) => f.endsWith('.css'));
      if (cssFiles.length > 0) {
        const cssBlock = cssFiles.map(([name, content]) => `<style>/* \${name} */\\n\${content}</style>`).join('\\n');
        cssFiles.forEach(([name]) => {
          const linkRe = new RegExp(`<link[^>]*href=["']\${name.replace('.','\\\\.')}["'][^>]*/?>`, 'gi');
          html = html.replace(linkRe, '');
        });
        html = html.replace('</head>', cssBlock + '\\n</head>');
      }
      // Inject JS
      const jsFiles = Object.entries(files).filter(([f]) => f.endsWith('.js'));
      if (jsFiles.length > 0) {
        const jsBlock = jsFiles.map(([name, content]) => `<script>/* \${name} */\\n\${content}<\/script>`).join('\\n');
        jsFiles.forEach(([name]) => {
          const scriptRe = new RegExp(`<script[^>]*src=["']\${name.replace('.','\\\\.')}["'][^>]*>\\\\s*</script>`, 'gi');
          html = html.replace(scriptRe, '');
        });
        html = html.replace('</body>', jsBlock + '\\n</body>');
      }
    }
  }

  // Inject console capture
  const headIdx = html.indexOf('<head');
  if (headIdx >= 0) {
    const closeHead = html.indexOf('>', headIdx);
    if (closeHead >= 0) html = html.slice(0, closeHead + 1) + CONSOLE_INJECT + html.slice(closeHead + 1);
  }

  if (_previewBlobUrl) {
    URL.revokeObjectURL(_previewBlobUrl);
  }
  const blob = new Blob([html], { type: 'text/html' });
  _previewBlobUrl = URL.createObjectURL(blob);
  frame.src = _previewBlobUrl;
}

// ═══════════ CODE DISPLAY ═══════════
const FILE_ICONS = {
  html: '🌐', css: '🎨', js: '⚡', json: '📦', php: '🐘', py: '🐍',
  md: '📝', svg: '🖼️', txt: '📄', xml: '📋', yml: '⚙️', yaml: '⚙️',
  ts: '💎', tsx: '💎', jsx: '⚛️', sh: '🔧', bash: '🔧', sql: '🗄️',
  env: '🔒', toml: '⚙️', ini: '⚙️', default: '📄'
};
const PRISM_LANG = {
  html: 'markup', css: 'css', js: 'javascript', json: 'json',
  php: 'php', py: 'python', md: 'markdown', sh: 'bash',
  bash: 'bash', ts: 'javascript', tsx: 'javascript', jsx: 'javascript',
  sql: 'sql', xml: 'markup', svg: 'markup', default: 'markup'
};

function getFileExt(name) { return name.split('.').pop().toLowerCase(); }
function getFileIcon(name) { return FILE_ICONS[getFileExt(name)] || FILE_ICONS.default; }
function getPrismLang(name) { return PRISM_LANG[getFileExt(name)] || PRISM_LANG.default; }
function safeHighlight(el) {
  try { if (window.Prism) Prism.highlightElement(el); } catch (e) { console.warn('Prism error:', e.message); }
}

function updateCodeDisplay(filesOrCode) {
  const tabsEl = $('fileTabs');
  const codeEl = $('codeDisplay');
  const treeEl = $('explorerTree');

  if (typeof filesOrCode === 'string') {
    tabsEl.innerHTML = '';
    if (treeEl) treeEl.innerHTML = '<div class="explorer-empty">No files yet</div>';
    codeEl.className = 'language-html';
    codeEl.textContent = filesOrCode;
    if (window.Prism) safeHighlight(codeEl);
    return;
  }

  const files = filesOrCode;
  const names = Object.keys(files);
  if (names.length === 0) {
    tabsEl.innerHTML = '';
    if (treeEl) treeEl.innerHTML = '<div class="explorer-empty">No files yet</div>';
    codeEl.textContent = '';
    return;
  }

  if (!activeFile || !files[activeFile]) activeFile = names[0];

  if (treeEl) {
    treeEl.innerHTML = names.map(name => {
      const icon = getFileIcon(name);
      const lines = files[name].split('\\n').length;
      const isActive = name === activeFile ? 'active' : '';
      return `<div class="explorer-item \${isActive}" data-file="\${esc(name)}">
        <span class="explorer-item-icon">\${icon}</span>
        <span class="explorer-item-name">\${esc(name)}</span>
        <span class="explorer-item-lines">\${lines}L</span>
      </div>`;
    }).join('');

    treeEl.querySelectorAll('.explorer-item').forEach(item => {
      item.addEventListener('click', () => {
        activeFile = item.dataset.file;
        updateCodeDisplay(currentFiles);
      });
    });
  }

  tabsEl.innerHTML = names.map(name => {
    const icon = getFileIcon(name);
    const size = files[name].split('\\n').length;
    const isActive = name === activeFile ? 'active' : '';
    return `<button class="file-tab \${isActive}" data-file="\${esc(name)}">
      <span class="file-tab-icon">\${icon}</span>
      <span class="file-tab-name">\${esc(name)}</span>
      <span class="file-tab-size">\${size}L</span>
    </button>`;
  }).join('');

  tabsEl.querySelectorAll('.file-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      activeFile = tab.dataset.file;
      updateCodeDisplay(currentFiles);
    });
  });

  const lang = getPrismLang(activeFile);
  codeEl.className = `language-\${lang}`;
  codeEl.textContent = files[activeFile] || '';
  if (window.Prism) safeHighlight(codeEl);
}

// ═══════════ PHASE & TOKENS ═══════════
function updatePhaseUI() {
  const labels = { planning: '🤔 Planning', building: '🏗️ Building', refining: '💬 Refining' };
  const badge = $('projectBadge');
  let phaseEl = $('phaseBadge');
  if (!phaseEl) {
    phaseEl = document.createElement('div');
    phaseEl.id = 'phaseBadge';
    phaseEl.className = 'phase-badge';
    badge.parentElement.insertBefore(phaseEl, badge);
  }
  phaseEl.textContent = labels[phase] || '';
  phaseEl.className = 'phase-badge phase-' + phase;
  
  const btnLabel = sendBtn.querySelector('span');
  if (phase === 'planning') btnLabel.textContent = 'Send';
  else if (phase === 'building') btnLabel.textContent = 'Build';
  else btnLabel.textContent = 'Refine';
}

function showTokenBadge(tokens) {
  const badge = $('tokenBadge');
  badge.textContent = `\${tokens} tokens`;
  badge.classList.remove('hidden');
}

// ═══════════ VERSION NAVIGATION ═══════════
function updateVersionNav() {
  const nav = $('versionNav');
  if (versions.length < 1) { nav.classList.add('hidden'); return; }
  nav.classList.remove('hidden');
  $('verLabel').textContent = `v${currentVersion + 1}/${versions.length}`;
  $('verPrev').disabled = currentVersion <= 0;
  $('verNext').disabled = currentVersion >= versions.length - 1;
}

console.log('✦ ui.js loaded');
