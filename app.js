// ═══════════════════════════════════════════
//  Galaxy Studio — app.js (Orchestrator)
// ═══════════════════════════════════════════

// ── STATE ──
let currentProjectId = null;
let messages = [];
let currentCode = '';
let currentFiles = {};   // { 'index.html': '...', 'styles.css': '...' }
let activeFile = '';
let isStreaming = false;
let activeTab = 'preview';
let versions = [];
let currentVersion = -1;
let consoleLines = [];
let phase = 'planning';
let thinkingTimer = null;
let thinkingStartTime = 0;
let currentPlan = null;
let skillsIndex = {};

// ── CONFIG ──
const cfg = {
  provider: localStorage.getItem('gs_provider') || 'ollama-local',
  url: localStorage.getItem('gs_url') || 'http://localhost:11434',
  apiKey: localStorage.getItem('gs_apikey') || '',
  model: localStorage.getItem('gs_model') || ''
};

// ── PROMPTS ──
const PROMPT_PLANNING = `You are Galaxy Studio, a senior product designer and developer. The user has described an app idea. Your job is to UNDERSTAND what they really want by asking smart clarifying questions.

RESPOND IN THIS EXACT FORMAT (plain text, no markdown fences):

QUESTIONS:
1. [Your first clarifying question]
2. [Your second clarifying question]
3. [Your third clarifying question]
4. [Optional fourth question]

Do NOT generate code. ONLY ask questions to understand the project better.`;

const PROMPT_CREATE_PLAN = `You are Galaxy Studio. Based on the conversation so far, create a detailed project plan.

RESPOND IN THIS EXACT FORMAT (plain text, no markdown fences, no code):

PLAN:
App Name: [name]
Description: [description]

Features:
- [feature 1]
- [feature 2]

Design:
- Style: [style]
- Colors: [colors]

Technical:
- [tech notes]

Do NOT generate code. Only output the plan in the format above.`;

const SKILLS_WEB = `
WEB APP BEST PRACTICES:
- Semantic HTML5, accessible, responsive
- Modern CSS (flexbox/grid, custom properties, smooth transitions)
- Clean JavaScript
`;

const PROMPT_BUILD = `You are Galaxy Studio, an expert full-stack developer. Build the complete application.

RULES:
- Separate HTML, CSS, and JS into their own files.
- HTML links to CSS via <link rel="stylesheet" href="styles.css"> and JS via <script src="app.js"></script>

TOOLS:
You have tools to interact with the file system. Use them!
${renderToolHelp()}

CRITICAL:
- To write a file, you MUST use the <action name="write_file"> tag.
- To edit a file, you MUST use the <action name="edit_file"> tag.
- DO NOT wrap the action in markdown code fences. Just output the raw XML.
- You can execute multiple tools one after another.

Example:
<action name="write_file">
  <path>index.html</path>
  <content>
<!DOCTYPE html>
<html>...</html>
  </content>
</action>
`;

const PROMPT_REFINE = `You are Galaxy Studio. The user wants changes to the existing application.

RULES:
- Preserve ALL existing functionality unless the user says to remove it.
- Use <action name="edit_file"> to make targeted changes to specific files.
- Use <action name="write_file"> if creating a new file or completely rewriting one.
- Use <action name="read_file"> to inspect a file before editing it if you need context.

TOOLS:
${renderToolHelp()}
`;

// ── ORCHESTRATION ──

function estimateTokens() {
  const allText = messages.map(m => m.content).join(' ').toLowerCase();
  const fileCount = Object.keys(currentFiles).length;
  if (fileCount > 5 || allText.includes('full') || allText.includes('complex')) return 100000;
  if (allText.includes('extension') || allText.includes('ecommerce')) return 64000;
  return 32000;
}

function getSystemPrompt() {
  if (phase === 'planning') {
    const aiAskedQuestions = messages.some(m => m.role === 'assistant' && m.content.includes('QUESTIONS:'));
    const userAnswered = aiAskedQuestions && messages.filter(m => m.role === 'user').length >= 2;
    return userAnswered ? PROMPT_CREATE_PLAN : PROMPT_PLANNING;
  }
  const basePrompt = phase === 'building' ? PROMPT_BUILD : PROMPT_REFINE;
  return basePrompt + '\n\n' + SKILLS_WEB;
}

/**
 * Handle the result of a build/refine generation round
 */
function handleBuildResult(text, tokens, userText, secs) {
  // If the AI completely ignored tools and used the old ===FILE: format,
  // or wrapped everything in code fences, fallback to parser.js
  if (text.includes('===FILE:') || text.includes('\`\`\`html')) {
    const extracted = extractProject(text);
    if (Object.keys(extracted).length > 0) {
      Object.assign(currentFiles, extracted);
    }
  }

  currentCode = Object.values(currentFiles).join('\n');
  messages.push({ role: 'assistant', content: text });
  versions.push({ files: {...currentFiles}, prompt: userText, timestamp: Date.now() });
  currentVersion = versions.length - 1;
  updateVersionNav();

  const totalLines = Object.values(currentFiles).reduce((s,c) => s + c.split('\n').length, 0);
  const fileCount = Object.keys(currentFiles).length;
  let summary = `✓ Built in ${secs}s — ${fileCount} files, ${totalLines} lines`;
  if (tokens) summary += ` · ${tokens} tokens`;

  appendMsg('assistant', summary);
  updatePreview(currentFiles);
  updateCodeDisplay(currentFiles);
  if (tokens) showTokenBadge(tokens);

  phase = 'refining';
  updatePhaseUI();
  saveCurrentProject();
}

/**
 * Plan approval — triggered by Approve & Build button in plan card
 */
function approvePlan() {
  if (isStreaming) return;
  phase = 'building';
  updatePhaseUI();
  promptEl.value = `Build the app exactly as described in the plan above.`;
  sendMessage();
}

/**
 * Plan modification — triggered by Modify Plan button in plan card
 */
function modifyPlan() {
  if (isStreaming) return;
  promptEl.value = 'I want to change the plan: ';
  promptEl.focus();
  // Move cursor to end
  promptEl.selectionStart = promptEl.selectionEnd = promptEl.value.length;
}

/**
 * Main Agent Tool Loop — fixed to run tools AFTER stream completes, not inside callback
 */
async function sendMessage() {
  if (isStreaming) return;
  if (!cfg.model) { openModal('settingsOverlay'); return; }
  const userText = promptEl.value.trim();
  if (!userText) return;

  promptEl.value = '';
  isStreaming = true;

  // Show Stop Button
  sendBtn.classList.add('hidden');
  const stopBtn = $('stopBtn');
  if (stopBtn) stopBtn.classList.remove('hidden');

  setStatus('busy');
  appendMsg('user', userText);
  appendThinking();
  messages.push({ role: 'user', content: userText });

  const isToolMode = (phase === 'building' || phase === 'refining');
  let roundCount = 0;

  const ctx = {
    files: currentFiles,
    onFileWrite: (path, content, done) => {
      renderLiveCode(path, content, done);
    }
  };

  try {
    while (roundCount < MAX_AGENT_ROUNDS && isStreaming) {
      roundCount++;
      const opts = {
        provider: cfg.provider,
        url: cfg.url,
        apiKey: cfg.apiKey,
        model: cfg.model,
        systemPrompt: getSystemPrompt(),
        messages,
        maxTokens: estimateTokens()
      };

      let currentResponse = '';
      let totalTokens = 0;
      let lastRenderedLength = 0;
      let actionFoundMidStream = false;

      // The bubble for the current AI response
      const replyDiv = document.createElement('div');
      replyDiv.className = 'msg assistant tool-round';
      replyDiv.innerHTML = `<div class="msg-role">${esc(cfg.model || 'AI')}</div><div class="msg-bubble formatted"></div>`;
      const bubble = replyDiv.querySelector('.msg-bubble');
      chatHistory.appendChild(replyDiv);

      const streamFn = cfg.provider === 'gemini' ? callGeminiStream : callOllamaStream;

      // Stream the full response — tools are NOT run inside this callback.
      // We collect everything, then process actions after the stream ends.
      const res = await streamFn(opts, (chunk) => {
        currentResponse += chunk;

        if (isToolMode) {
          // Stream visible text up to the start of any forming <action> tag
          const safeLen = emitSafeBoundary(currentResponse, lastRenderedLength);
          if (safeLen > lastRenderedLength) {
            const safeChunk = currentResponse.slice(lastRenderedLength, safeLen);
            bubble.textContent += safeChunk;
            lastRenderedLength = safeLen;
            chatHistory.scrollTop = chatHistory.scrollHeight;
          }

          // While streaming a write_file action, pipe content to the live code view
          const incompleteAction = findNextAction(currentResponse, 0);
          if (incompleteAction === 'incomplete') {
            const openTag = currentResponse.match(/<action\s+name\s*=\s*["']?write_file["']?\s*>/i);
            const pathMatch = currentResponse.match(/<path>([\s\S]*?)<\/path>/i);
            const contentOpen = currentResponse.lastIndexOf('<content>');
            if (openTag && pathMatch && contentOpen > openTag.index) {
              const path = normalizePath(pathMatch[1]);
              const rawContent = currentResponse.slice(contentOpen + 9);
              const displayContent = rawContent.replace(/<\/content>[\s\S]*$/, '');
              ctx.onFileWrite(path, displayContent, false);
            }
          }
        } else {
          // Planning mode: stream text directly
          bubble.textContent += chunk;
          chatHistory.scrollTop = chatHistory.scrollHeight;
        }
      });

      totalTokens = res?.tokens || totalTokens;

      // ── POST-STREAM TOOL PROCESSING ──
      // Now that the stream is complete, scan for all actions and execute them in order.
      if (isToolMode) {
        let searchFrom = 0;
        let toolsExecuted = 0;

        while (true) {
          const actionData = findNextAction(currentResponse, searchFrom);
          if (!actionData || actionData === 'incomplete') break;

          const result = runTool(actionData.name, actionData.args, ctx);

          // Mark live file as done rendering
          if (actionData.name === 'write_file' || actionData.name === 'edit_file') {
            const p = actionData.args.path;
            if (p && ctx.files[p]) ctx.onFileWrite(p, ctx.files[p], true);
          }

          bubble.innerHTML += `<div class="tool-result">🔨 ${actionData.name}(${actionData.args.path || ''}) → ${esc(String(result).slice(0, 80))}</div>`;
          toolsExecuted++;
          actionFoundMidStream = true;

          // Advance past the processed action so we don't re-run it
          searchFrom = actionData.end;
        }

        if (toolsExecuted > 0) {
          // Push assistant response and tool results, then loop for next round
          messages.push({ role: 'assistant', content: currentResponse });
          messages.push({ role: 'user', content: `Tool results processed (${toolsExecuted} action(s)). Continue generating remaining files or respond with any follow-up.` });
          continue;
        }
      }

      // No tool actions found — response is complete
      removeThinking();
      const secs = Math.round((Date.now() - thinkingStartTime) / 1000);

      if (phase === 'planning') {
        if (currentResponse.includes('PLAN:')) {
          currentPlan = currentResponse;
          messages.push({ role: 'assistant', content: currentResponse });
          renderPlanCard(currentResponse, secs, totalTokens);
        } else {
          messages.push({ role: 'assistant', content: currentResponse });
          renderQuestions(currentResponse, secs, totalTokens);
        }
      } else {
        handleBuildResult(currentResponse, totalTokens, userText, secs);
      }

      break; // Exit the while loop
    }

    if (roundCount >= MAX_AGENT_ROUNDS) {
      appendMsg('assistant', '⚠ Max agent rounds reached.');
    }

    setStatus('ok');
  } catch (err) {
    if (err.name === 'AbortError' || err.message.includes('abort')) {
      appendMsg('assistant', '🛑 Generation cancelled by user.');
      setStatus('ok');
    } else {
      setStatus('err');
      appendMsg('assistant', '⚠ Error: ' + err.message);
      console.error(err);
    }
  } finally {
    removeThinking();
    isStreaming = false;
    if (stopBtn) stopBtn.classList.add('hidden');
    sendBtn.classList.remove('hidden');
    sendBtn.disabled = false;
  }
}

// ═══════════ PROJECT MANAGEMENT ═══════════

function saveCurrentProject() {
  saveProject(currentProjectId, {
    messages, versions, currentVersion, currentCode, currentFiles,
    phase, provider: cfg.provider, model: cfg.model,
    name: $('projectBadge').textContent
  });
  renderProjectSidebar(listProjects());
}

function newProject() {
  if (isStreaming) return;
  if (messages.length > 0 && !confirm('Start new project? Current conversation will be cleared.')) return;

  currentProjectId = generateProjectId();
  messages = []; currentCode = ''; currentFiles = {}; activeFile = '';
  versions = []; currentVersion = -1; consoleLines = [];
  phase = 'planning'; currentPlan = null;

  $('fileTabs').innerHTML = '';
  chatHistory.innerHTML = '';
  chatHistory.appendChild(emptyChat);
  emptyChat.classList.remove('hidden');
  $('previewEmpty').classList.remove('hidden');
  $('previewToolbar').classList.add('hidden');
  $('previewFrame').classList.add('hidden');
  if ($('previewFrame').src) $('previewFrame').src = '';
  $('codeDisplay').textContent = '';
  $('versionNav').classList.add('hidden');
  $('tokenBadge').classList.add('hidden');
  $('consoleOutput').innerHTML = '<div class="console-empty">No console output yet.</div>';
  $('consoleCount').classList.add('hidden');
  $('projectBadge').textContent = 'Untitled';

  updatePhaseUI();
  setStatus('');
  saveCurrentProject();
}

function switchProject(id) {
  if (isStreaming) return;
  const p = loadProjectById(id);
  if (!p) return;

  currentProjectId = p.id;
  messages = p.messages || [];
  versions = p.versions || [];
  currentVersion = p.currentVersion ?? -1;
  currentCode = p.currentCode || '';
  currentFiles = p.currentFiles || (currentCode ? { 'index.html': currentCode } : {});
  activeFile = Object.keys(currentFiles)[0] || '';
  phase = p.phase || (currentCode ? 'refining' : 'planning');
  $('projectBadge').textContent = p.name || 'Untitled';

  // UI Resets
  chatHistory.innerHTML = '';
  emptyChat.classList.toggle('hidden', messages.length > 0);
  if (messages.length === 0) chatHistory.appendChild(emptyChat);

  // Replay chat (truncate long code blocks for readability)
  messages.forEach(m => {
    if (m.role === 'user' || m.role === 'assistant') {
      let content = m.content;
      if (m.role === 'assistant' && content.length > 2000) {
         content = content.slice(0, 1000) + '\n\n...[code generation hidden for readability]...\n\n' + content.slice(-500);
      }
      appendMsg(m.role, content);
    }
  });

  if (Object.keys(currentFiles).length > 0) {
    updatePreview(currentFiles);
    updateCodeDisplay(currentFiles);
  } else if (currentCode) {
    updatePreview(currentCode);
    updateCodeDisplay(currentCode);
  }

  updateVersionNav();
  updatePhaseUI();
  renderProjectSidebar(listProjects());
}

// ═══════════ DOWNLOAD HELPER ═══════════

async function downloadProject() {
  const names = Object.keys(currentFiles);
  if (names.length === 0) { alert('No files to download yet.'); return; }

  if (names.length === 1) {
    // Single file — plain download
    const name = names[0];
    const blob = new Blob([currentFiles[name]], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
    return;
  }

  // Multiple files — zip via JSZip if available
  if (window.JSZip) {
    const zip = new JSZip();
    names.forEach(n => zip.file(n, currentFiles[n]));
    const blob = await zip.generateAsync({ type: 'blob' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = ($('projectBadge').textContent || 'project').replace(/\s+/g, '_') + '.zip';
    a.click();
    URL.revokeObjectURL(a.href);
  } else {
    // Fallback: download just the HTML file
    const htmlFile = names.find(n => n.endsWith('.html')) || names[0];
    const blob = new Blob([currentFiles[htmlFile]], { type: 'text/html' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = htmlFile;
    a.click();
    URL.revokeObjectURL(a.href);
  }
}

// ═══════════ FETCH MODELS ═══════════

async function fetchModels() {
  const p = providerSelect.value;
  fetchBtn.textContent = '…';
  fetchBtn.disabled = true;

  try {
    if (p === 'gemini') {
      // Gemini model list via proxy or hardcoded defaults
      const models = [
        'gemini-2.0-flash-exp',
        'gemini-1.5-pro',
        'gemini-1.5-flash',
        'gemini-1.0-pro'
      ];
      populateModelSelect(models);
    } else {
      // Ollama: GET /api/tags
      const baseUrl = ollamaUrlInput.value.trim() || 'http://localhost:11434';
      const proxyBase = window.location.origin;
      const targetUrl = `${baseUrl}/api/tags`;
      const res = await fetch(`${proxyBase}/proxy?url=${encodeURIComponent(targetUrl)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const models = (data.models || []).map(m => m.name).filter(Boolean);
      if (models.length === 0) throw new Error('No models found');
      populateModelSelect(models);
    }
  } catch (e) {
    alert('Could not fetch models: ' + e.message);
  } finally {
    fetchBtn.textContent = '↻ Fetch';
    fetchBtn.disabled = false;
  }
}

function populateModelSelect(models) {
  modelSelect.innerHTML = '<option value="">— select model —</option>';
  models.forEach(name => {
    const o = document.createElement('option');
    o.value = name; o.textContent = name;
    modelSelect.appendChild(o);
  });
  if (cfg.model && models.includes(cfg.model)) {
    modelSelect.value = cfg.model;
  }
  modelSelect.classList.remove('hidden');
  modelInput.classList.add('hidden');
}

// ═══════════ SETTINGS UI ═══════════

function updateSettingsUI() {
  const p = providerSelect.value;
  $('settingHost').classList.toggle('hidden', p !== 'ollama-local');
  $('settingApiKey').classList.toggle('hidden', p === 'ollama-local');

  if (p === 'gemini') {
    $('apiKeyHint') && ($('apiKeyHint').textContent = 'Get your key at aistudio.google.com');
    modelSelect.classList.add('hidden');
    modelInput.classList.remove('hidden');
    modelInput.placeholder = 'e.g. gemini-2.0-flash-exp';
  } else if (p === 'ollama-cloud') {
    $('apiKeyHint') && ($('apiKeyHint').textContent = 'Your Ollama Cloud API key');
    modelSelect.classList.remove('hidden');
    modelInput.classList.add('hidden');
  } else {
    modelSelect.classList.remove('hidden');
    modelInput.classList.add('hidden');
  }
}

// ═══════════ CONSOLE CAPTURE ═══════════

window.addEventListener('message', (e) => {
  if (!e.data || e.data.type !== 'gs-console') return;
  const { method, args } = e.data;

  consoleLines.push({ method, args, time: Date.now() });

  const out = $('consoleOutput');
  const emptyEl = out.querySelector('.console-empty');
  if (emptyEl) emptyEl.remove();

  const line = document.createElement('div');
  line.className = `console-line console-${method}`;
  const timeStr = new Date().toLocaleTimeString('en', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  line.innerHTML = `<span class="console-time">${timeStr}</span><span class="console-method">${esc(method.toUpperCase())}</span><span class="console-text">${esc(args.join(' '))}</span>`;
  out.appendChild(line);
  out.scrollTop = out.scrollHeight;

  // Update badge count
  const countEl = $('consoleCount');
  countEl.textContent = consoleLines.length;
  countEl.classList.remove('hidden');
});

// ═══════════ EVENT LISTENERS ═══════════

promptEl.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});
sendBtn.onclick = sendMessage;

const stopBtn = $('stopBtn');
if (stopBtn) {
  stopBtn.onclick = () => {
    abortCurrentRequest();
    isStreaming = false;
  };
}

// Tab switching
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.tab;
    activeTab = target;
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === target));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'panel' + target.charAt(0).toUpperCase() + target.slice(1)));
  });
});

// Template card click — auto-fill prompt
document.querySelectorAll('.template-card').forEach(card => {
  card.addEventListener('click', () => {
    const prompt = card.dataset.prompt;
    if (prompt) {
      promptEl.value = prompt;
      promptEl.focus();
    }
  });
});

// Device toggle buttons
document.querySelectorAll('.device-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.device-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const width = btn.dataset.width;
    const wrap = $('previewFrameWrap');
    const frame = $('previewFrame');
    if (width === '100%') {
      wrap.style.maxWidth = '';
      frame.style.maxWidth = '';
    } else {
      wrap.style.maxWidth = width;
      frame.style.maxWidth = width;
    }
  });
});

// Copy button
$('btnCopy').onclick = () => {
  const file = currentFiles[activeFile] || Object.values(currentFiles)[0] || currentCode;
  if (!file) return;
  navigator.clipboard.writeText(file).then(() => {
    const btn = $('btnCopy');
    const orig = btn.querySelector('span').textContent;
    btn.querySelector('span').textContent = 'Copied!';
    setTimeout(() => { btn.querySelector('span').textContent = orig; }, 1500);
  }).catch(() => {
    // Fallback for older browsers
    const ta = document.createElement('textarea');
    ta.value = file;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  });
};

// Download button
$('btnDownload').onclick = downloadProject;

// Console clear
$('consoleClear').onclick = () => {
  consoleLines = [];
  $('consoleOutput').innerHTML = '<div class="console-empty">No console output yet.</div>';
  $('consoleCount').classList.add('hidden');
};

// Version navigation
$('verPrev').onclick = () => {
  if (currentVersion > 0) {
    currentVersion--;
    const v = versions[currentVersion];
    currentFiles = { ...v.files };
    activeFile = Object.keys(currentFiles)[0] || '';
    updateVersionNav();
    updatePreview(currentFiles);
    updateCodeDisplay(currentFiles);
  }
};
$('verNext').onclick = () => {
  if (currentVersion < versions.length - 1) {
    currentVersion++;
    const v = versions[currentVersion];
    currentFiles = { ...v.files };
    activeFile = Object.keys(currentFiles)[0] || '';
    updateVersionNav();
    updatePreview(currentFiles);
    updateCodeDisplay(currentFiles);
  }
};

// Fetch models button
fetchBtn.onclick = fetchModels;

// Resizable panels
const handle = $('resizeHandle');
const leftPanel = $('leftPanel');
let isResizing = false;

handle.addEventListener('mousedown', e => {
  isResizing = true;
  handle.classList.add('active');
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  e.preventDefault();
});
document.addEventListener('mousemove', e => {
  if (!isResizing) return;
  const x = e.clientX;
  const min = 280, max = window.innerWidth - 400;
  leftPanel.style.width = Math.min(max, Math.max(min, x)) + 'px';
});
document.addEventListener('mouseup', () => {
  if (isResizing) {
    isResizing = false;
    handle.classList.remove('active');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }
});

// Shortcuts
document.addEventListener('keydown', e => {
  if (e.ctrlKey && e.key === 's') { e.preventDefault(); downloadProject(); }
  if (e.ctrlKey && e.shiftKey && e.key === 'C') { e.preventDefault(); $('btnCopy').click(); }
  if (e.ctrlKey && e.shiftKey && e.key === 'N') { e.preventDefault(); newProject(); }
  if (e.ctrlKey && e.key === ',') { e.preventDefault(); openModal('settingsOverlay'); }
  if (e.ctrlKey && e.key === '/') { e.preventDefault(); openModal('shortcutsOverlay'); }
  if (e.ctrlKey && e.key === '[') { e.preventDefault(); $('verPrev').click(); }
  if (e.ctrlKey && e.key === ']') { e.preventDefault(); $('verNext').click(); }
  if (e.key === 'Escape') {
    closeModal('settingsOverlay');
    closeModal('shortcutsOverlay');
    if (isStreaming) abortCurrentRequest();
  }
});

$('projectBadge').addEventListener('click', () => {
  const name = prompt('Rename project:', $('projectBadge').textContent);
  if (name?.trim()) { $('projectBadge').textContent = name.trim(); saveCurrentProject(); }
});

$('btnNew').onclick = newProject;
$('btnSettings').onclick = () => openModal('settingsOverlay');
$('btnShortcuts').onclick = () => openModal('shortcutsOverlay');
$('shortcutsClose').onclick = () => closeModal('shortcutsOverlay');

$('settingsSave').onclick = () => {
  cfg.provider = providerSelect.value;
  cfg.url = ollamaUrlInput.value.trim() || 'http://localhost:11434';
  cfg.apiKey = apiKeyInput.value.trim();
  cfg.model = modelInput.classList.contains('hidden') ? modelSelect.value : modelInput.value.trim();
  localStorage.setItem('gs_provider', cfg.provider);
  localStorage.setItem('gs_url', cfg.url);
  localStorage.setItem('gs_apikey', cfg.apiKey);
  localStorage.setItem('gs_model', cfg.model);
  updateTopbar();
  closeModal('settingsOverlay');
};
$('providerPill').onclick = () => openModal('settingsOverlay');
$('modelPill').onclick = () => openModal('settingsOverlay');
$('settingsClose').onclick = () => closeModal('settingsOverlay');

function updateTopbar() {
  const names = { 'ollama-local': 'Local Ollama', 'ollama-cloud': 'Ollama Cloud', 'gemini': 'Gemini API' };
  providerLabel.textContent = names[cfg.provider] || cfg.provider;
  modelLabel.textContent = cfg.model || 'No Model';
}

// Settings UI init
providerSelect.value = cfg.provider;
ollamaUrlInput.value = cfg.url;
apiKeyInput.value = cfg.apiKey;
if (cfg.model) {
  const o = document.createElement('option');
  o.value = cfg.model; o.textContent = cfg.model;
  modelSelect.insertBefore(o, modelSelect.lastChild);
  modelSelect.value = cfg.model;
}
providerSelect.addEventListener('change', updateSettingsUI);
updateSettingsUI();

// Theme
$('btnTheme').onclick = () => {
  const current = document.documentElement.getAttribute('data-theme');
  const theme = current === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('gs_theme', theme);
};
if (localStorage.getItem('gs_theme') === 'light') {
  document.documentElement.setAttribute('data-theme', 'light');
}

// Window init
window.onload = () => {
  updateTopbar();

  const migratedId = migrateOldProject();
  if (migratedId) {
    switchProject(migratedId);
  } else {
    const list = listProjects();
    if (list.length > 0) {
      switchProject(list[0].id);
    } else {
      newProject();
    }
  }

  renderProjectSidebar(listProjects());
  fetch('/skills-index.json').then(r => r.json()).then(d => { skillsIndex = d; }).catch(() => {});
};
