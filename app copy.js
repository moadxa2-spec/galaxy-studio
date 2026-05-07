// ═══════════════════════════════════════════
//  Galaxy Studio — app.js
// ═══════════════════════════════════════════

// ── STATE ──
let messages = [];
let currentCode = '';
let currentFiles = {};   // { 'index.html': '...', 'styles.css': '...', 'app.js': '...' }
let activeFile = '';     // currently selected file tab
let isStreaming = false;
let activeTab = 'preview';
let versions = [];       // [{files, prompt, timestamp}]
let currentVersion = -1;
let consoleLines = [];
let phase = 'planning';  // 'planning' | 'building' | 'refining'
let thinkingTimer = null;
let thinkingStartTime = 0;
let currentPlan = null;  // stores the plan text
let skillsIndex = {};    // loaded from skills-index.json

// ── DOM REFS ──
const $ = id => document.getElementById(id);
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

// ── LOAD SAVED CONFIG ──
const cfg = {
  provider: localStorage.getItem('gs_provider') || 'ollama-local',
  url: localStorage.getItem('gs_url') || 'http://localhost:11434',
  apiKey: localStorage.getItem('gs_apikey') || '',
  model: localStorage.getItem('gs_model') || ''
};
providerSelect.value = cfg.provider;
ollamaUrlInput.value = cfg.url;
apiKeyInput.value = cfg.apiKey;

// ═══════════ SETTINGS MODAL ═══════════
$('btnSettings').onclick = () => openModal('settingsOverlay');
$('providerPill').onclick = () => openModal('settingsOverlay');
$('modelPill').onclick = () => openModal('settingsOverlay');
$('settingsClose').onclick = () => closeModal('settingsOverlay');
$('settingsSave').onclick = saveSettings;

function openModal(id) { $(id).classList.remove('hidden'); }
function closeModal(id) { $(id).classList.add('hidden'); }

// ═══════════ THEME TOGGLE ═══════════
function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('gs_theme', theme);
  const icon = $('themeIcon');
  if (theme === 'light') {
    icon.innerHTML = '<path d="M13 8A5 5 0 113.5 5.5 4 4 0 0013 8z"/>';
  } else {
    icon.innerHTML = '<circle cx="8" cy="8" r="3.5"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.3 3.3l1.4 1.4M11.3 11.3l1.4 1.4M3.3 12.7l1.4-1.4M11.3 4.7l1.4-1.4"/>';
  }
}
$('btnTheme').onclick = () => {
  const current = document.documentElement.getAttribute('data-theme');
  setTheme(current === 'light' ? 'dark' : 'light');
};
// Restore saved theme
const savedTheme = localStorage.getItem('gs_theme') || 'dark';
if (savedTheme === 'light') setTheme('light');

$('settingsOverlay').addEventListener('click', e => {
  if (e.target === $('settingsOverlay')) closeModal('settingsOverlay');
});
$('shortcutsOverlay').addEventListener('click', e => {
  if (e.target === $('shortcutsOverlay')) closeModal('shortcutsOverlay');
});

providerSelect.addEventListener('change', updateSettingsUI);

modelSelect.addEventListener('change', () => {
  if (modelSelect.value === 'custom') {
    modelInput.classList.remove('hidden');
    modelSelect.classList.add('hidden');
    modelInput.focus();
  }
});
modelInput.addEventListener('blur', () => {
  if (!modelInput.value.trim()) {
    modelInput.classList.add('hidden');
    modelSelect.classList.remove('hidden');
  }
});
modelInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') modelInput.blur();
  if (e.key === 'Escape') { modelInput.value = ''; modelInput.blur(); }
});

function updateSettingsUI() {
  const p = providerSelect.value;
  $('settingHost').classList.toggle('hidden', p !== 'ollama-local');
  $('settingApiKey').classList.toggle('hidden', p === 'ollama-local');
  $('apiKeyHint').textContent = p === 'gemini' ? 'Get your key from Google AI Studio' : 'Your Ollama Cloud API key';
  fetchBtn.classList.toggle('hidden', p === 'gemini');

  if (p === 'gemini') {
    modelSelect.innerHTML = `
      <option value="gemini-2.5-flash">gemini-2.5-flash</option>
      <option value="gemini-2.5-pro">gemini-2.5-pro</option>
      <option value="gemini-2.0-flash">gemini-2.0-flash</option>
      <option value="gemini-1.5-pro">gemini-1.5-pro</option>
      <option value="custom">✏ Custom model...</option>`;
    modelSelect.value = cfg.model || 'gemini-2.5-flash';
  } else if (p === 'ollama-cloud') {
    modelSelect.innerHTML = `
      <option value="">— select —</option>
      <option value="llama3.3">llama3.3</option>
      <option value="gemma3">gemma3</option>
      <option value="qwen2.5-coder">qwen2.5-coder</option>
      <option value="deepseek-r1">deepseek-r1</option>
      <option value="mistral">mistral</option>
      <option value="phi4">phi4</option>
      <option value="custom">✏ Custom model...</option>`;
    if (cfg.model) modelSelect.value = cfg.model;
  } else {
    modelSelect.innerHTML = '<option value="">— fetch models —</option><option value="custom">✏ Custom...</option>';
    if (cfg.model) {
      const o = document.createElement('option');
      o.value = cfg.model; o.textContent = cfg.model;
      modelSelect.insertBefore(o, modelSelect.lastChild);
      modelSelect.value = cfg.model;
    }
  }
  modelInput.classList.add('hidden');
  modelSelect.classList.remove('hidden');
}

function saveSettings() {
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
}

function updateTopbar() {
  const names = { 'ollama-local': 'Local Ollama', 'ollama-cloud': 'Ollama Cloud', 'gemini': 'Gemini API' };
  providerLabel.textContent = names[cfg.provider] || cfg.provider;
  modelLabel.textContent = cfg.model || 'No Model';
}

// ── FETCH MODELS ──
fetchBtn.onclick = fetchModels;
async function fetchModels() {
  fetchBtn.disabled = true; fetchBtn.textContent = '...';
  setStatus('busy');
  // Read LIVE values from the form (user may not have saved yet)
  const liveProvider = providerSelect.value;
  const liveUrl = ollamaUrlInput.value.trim() || 'http://localhost:11434';
  const liveApiKey = apiKeyInput.value.trim();
  try {
    let url, headers = {};
    if (liveProvider === 'ollama-cloud') {
      url = '/proxy/ollama/api/tags';
      if (liveApiKey) headers['Authorization'] = `Bearer ${liveApiKey}`;
      else {
        alert('Please enter your Ollama Cloud API key first.\n\nGet one at: https://ollama.com/settings/keys');
        setStatus('err');
        return;
      }
    } else {
      url = `${liveUrl.replace(/\/$/, '')}/api/tags`;
    }
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${errText.slice(0, 200)}`);
    }
    const data = await res.json();
    const models = data.models || [];
    if (!models.length) { alert('No models found. Check your API key or Ollama instance.'); setStatus('err'); return; }

    modelSelect.innerHTML = '<option value="">— select —</option>';
    models.forEach(m => {
      const o = document.createElement('option');
      o.value = m.name; o.textContent = m.name;
      modelSelect.appendChild(o);
    });
    const co = document.createElement('option');
    co.value = 'custom'; co.textContent = '✏ Custom...';
    modelSelect.appendChild(co);

    modelSelect.value = models[0].name;
    cfg.model = models[0].name;
    // Auto-save the working config
    cfg.provider = liveProvider;
    cfg.url = liveUrl;
    cfg.apiKey = liveApiKey;
    localStorage.setItem('gs_provider', cfg.provider);
    localStorage.setItem('gs_url', cfg.url);
    localStorage.setItem('gs_apikey', cfg.apiKey);
    localStorage.setItem('gs_model', cfg.model);
    updateTopbar();
    setStatus('ok');
  } catch (err) {
    setStatus('err');
    const hint = liveProvider === 'ollama-cloud'
      ? 'Check your API key and internet connection.\nGet a key at: https://ollama.com/settings/keys'
      : 'Make sure Ollama is running with CORS enabled:\n  OLLAMA_ORIGINS="*" ollama serve';
    alert(`Could not fetch models.\n\n${err.message}\n\n${hint}`);
  } finally { fetchBtn.disabled = false; fetchBtn.textContent = '↻ Fetch'; }
}

function setStatus(s) {
  statusDot.className = 'provider-dot' + (s === 'ok' ? ' ok' : s === 'err' ? ' err' : s === 'busy' ? ' busy' : '');
}

// ═══════════ SHORTCUTS MODAL ═══════════
$('btnShortcuts').onclick = () => openModal('shortcutsOverlay');
$('shortcutsClose').onclick = () => closeModal('shortcutsOverlay');

// ═══════════ TABS ═══════════
document.querySelectorAll('.tab').forEach(t => {
  t.addEventListener('click', () => {
    activeTab = t.dataset.tab;
    document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === t));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'panel' + cap(activeTab)));
  });
});
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// ═══════════ DEVICE TOGGLES ═══════════
document.querySelectorAll('.device-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.device-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const iframe = $('previewFrame');
    const w = btn.dataset.width;
    iframe.style.width = w;
    iframe.style.maxWidth = w === '100%' ? 'none' : w;
  });
});

// ═══════════ TEMPLATES ═══════════
document.querySelectorAll('.template-card').forEach(card => {
  card.addEventListener('click', () => {
    promptEl.value = card.dataset.prompt;
    promptEl.focus();
  });
});

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
      <div class="thinking-step" id="thinkingStep">${THINKING_STEPS[phase][0]}</div>
    </div>`;
  chatHistory.appendChild(div);
  chatHistory.scrollTop = chatHistory.scrollHeight;
  // Start timer
  thinkingStartTime = Date.now();
  let stepIdx = 0;
  const steps = THINKING_STEPS[phase];
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
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ═══════════ SEND MESSAGE ═══════════
promptEl.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});
sendBtn.onclick = sendMessage;

const PROMPT_PLANNING = `You are Galaxy Studio, a senior product designer and developer. The user has described an app idea. Your job is to UNDERSTAND what they really want by asking smart clarifying questions, then create a detailed plan.

RESPOND IN THIS EXACT FORMAT (plain text, no markdown fences):

QUESTIONS:
1. [Your first clarifying question]
2. [Your second clarifying question]
3. [Your third clarifying question]
4. [Optional fourth question]

Do NOT generate code. Do NOT create a plan yet. ONLY ask questions to understand the project better. Keep questions focused and practical. Ask about: target audience, key features, design preferences (colors, style), functionality details, and any specific requirements.`;

const PROMPT_CREATE_PLAN = `You are Galaxy Studio. Based on the conversation so far, create a detailed project plan.

RESPOND IN THIS EXACT FORMAT (plain text, no markdown fences, no code):

PLAN:
App Name: [name]
Description: [1-2 sentence description]

Features:
- [feature 1]
- [feature 2]
- [feature 3]
- [feature 4]
- [feature 5]

Design:
- Style: [e.g., Modern minimalist, Glassmorphism, Retro neon]
- Colors: [primary and accent colors]
- Font: [suggested Google Font]

Technical:
- [any technical approach notes]

Do NOT generate any code. Only output the plan in the format above.`;

const SKILLS_WEB = `
WEB APP BEST PRACTICES:
- Semantic HTML5: use <header>, <nav>, <main>, <section>, <article>, <footer>
- Accessible: proper ARIA labels, keyboard navigation, focus indicators, color contrast 4.5:1+
- Responsive: mobile-first, flexbox/grid, proper meta viewport
- Typography: use Google Fonts (Inter, Poppins, Space Grotesk, Outfit) — never browser defaults
- Colors: curated palettes with HSL, never plain red/blue/green. Use CSS custom properties.
- Performance: lazy-load images, minimize DOM depth, use CSS transitions over JS animations
- Modern CSS: gradients, box-shadows, border-radius, backdrop-filter, smooth transitions, micro-animations
- Hover/focus effects on all interactive elements
`;

const SKILLS_EXTENSION = `
CHROME EXTENSION RULES (Manifest V3 ONLY):
- manifest_version MUST be 3 — version 2 is blocked by Chrome
- Background: use "background": { "service_worker": "background.js" } — NOT "scripts"
- Popup: "action": { "default_popup": "popup.html" }
- Permissions: only request what you need in "permissions" array
- Content scripts: "content_scripts": [{ "matches": ["<all_urls>"], "js": ["content.js"] }]
- Do NOT use chrome.browserAction — use chrome.action
- Do NOT use chrome.extension.getURL — use chrome.runtime.getURL
- Service workers CANNOT access DOM — use chrome.runtime.sendMessage for communication
- Do NOT reference icon files unless you actually create them
- Every file referenced in manifest.json MUST exist as a ===FILE: block
`;

const FILE_FORMAT_RULES = `
CRITICAL OUTPUT FORMAT — You MUST follow this EXACTLY:
Each file starts with ===FILE: filename.ext=== on its own line, followed by the file contents.
Do NOT wrap code in markdown fences. Do NOT add any explanation text.
Start your ENTIRE response with the first ===FILE: line.

EXAMPLE for a website:
===FILE: index.html===
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My App</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <h1>Hello</h1>
  <script src="app.js"><\/script>
</body>
</html>
===FILE: styles.css===
h1 { color: blue; }
===FILE: app.js===
console.log('hello');

EXAMPLE for an extension:
===FILE: manifest.json===
{"manifest_version":3,"name":"My Ext","version":"1.0","action":{"default_popup":"popup.html"}}
===FILE: popup.html===
<!DOCTYPE html><html><body><h1>Popup</h1><script src="popup.js"><\/script></body></html>
===FILE: popup.js===
console.log('popup loaded');
`;

const PROMPT_BUILD = `You are Galaxy Studio, an expert full-stack developer. Build the complete application as SEPARATE FILES.

${FILE_FORMAT_RULES}

RULES:
- ALWAYS separate HTML, CSS, and JS into their own files — NEVER put CSS or JS inline in HTML
- HTML links to CSS via <link rel="stylesheet" href="styles.css"> and JS via <script src="app.js"><\/script>
- Create as many files as the project needs
- You can create ANY file type: .html, .css, .js, .json, .php, .py, .md, .svg, .txt, etc.
- Follow the plan EXACTLY — implement every feature listed
- Start your response with ===FILE: immediately — no preamble`;

const PROMPT_REFINE = `You are Galaxy Studio. The user wants changes to the existing application.

${FILE_FORMAT_RULES}

RULES:
- Output ALL project files — the system replaces everything
- You can add new files if needed
- Preserve ALL existing functionality unless the user says to remove it
- Apply the user's requested changes carefully
- Start your response with ===FILE: immediately — no preamble`;

function matchSkills() {
  // Match conversation text against skills index keywords
  const allText = messages.map(m => m.content).join(' ').toLowerCase();
  const matched = [];
  for (const [skillId, skill] of Object.entries(skillsIndex)) {
    const hits = skill.keywords.filter(kw => allText.includes(kw)).length;
    if (hits > 0) matched.push({ id: skillId, hits, knowledge: skill.knowledge });
  }
  // Sort by relevance (most keyword hits first)
  matched.sort((a, b) => b.hits - a.hits);
  // Also check hardcoded fallbacks for extension
  if (matched.length === 0) {
    if (allText.includes('extension') || allText.includes('chrome') || allText.includes('addon')) {
      return [{ id: 'chrome-extension', knowledge: SKILLS_EXTENSION }];
    }
    return [{ id: 'web-frontend', knowledge: SKILLS_WEB }];
  }
  return matched.slice(0, 3); // Top 3 most relevant skills
}

function estimateTokens() {
  // Estimate needed output tokens based on project complexity
  const allText = messages.map(m => m.content).join(' ').toLowerCase();
  const fileCount = Object.keys(currentFiles).length;
  // Complex projects need more tokens
  if (fileCount > 5 || allText.includes('full application') || allText.includes('complex') || allText.includes('complete')) return 100000;
  if (allText.includes('extension') || allText.includes('dashboard') || allText.includes('ecommerce') || allText.includes('game')) return 64000;
  if (allText.includes('landing') || allText.includes('simple') || allText.includes('basic')) return 32000;
  return 64000; // Default
}

function getSystemPrompt() {
  if (phase === 'planning') {
    const aiAskedQuestions = messages.some(m => m.role === 'assistant' && m.content.includes('QUESTIONS:'));
    const userAnswered = aiAskedQuestions && messages.filter(m => m.role === 'user').length >= 2;
    return userAnswered ? PROMPT_CREATE_PLAN : PROMPT_PLANNING;
  }
  // Fetch and inject matched skills
  const skills = matchSkills();
  const skillsBlock = skills.map(s => s.knowledge).join('\n\n');
  const basePrompt = phase === 'building' ? PROMPT_BUILD : PROMPT_REFINE;
  return basePrompt + '\n\n' + skillsBlock;
}

async function sendMessage() {
  if (isStreaming) return;
  if (!cfg.model) { openModal('settingsOverlay'); return; }
  const userText = promptEl.value.trim();
  if (!userText) return;

  promptEl.value = '';
  isStreaming = true;
  sendBtn.disabled = true;
  setStatus('busy');
  appendMsg('user', userText);
  appendThinking();
  messages.push({ role: 'user', content: userText });

  let fullReply = '';
  let tokenInfo = null;
  const elapsed = () => Math.round((Date.now() - thinkingStartTime) / 1000);

  try {
    const r = cfg.provider === 'gemini' ? await callGeminiStream() : await callOllamaStream();
    fullReply = r.text; tokenInfo = r.tokens;
    const secs = elapsed();
    removeThinking();

    if (phase === 'planning') {
      // Check if this is a plan response or questions
      if (fullReply.includes('PLAN:')) {
        currentPlan = fullReply;
        messages.push({ role: 'assistant', content: fullReply });
        renderPlanCard(fullReply, secs, tokenInfo);
      } else {
        // AI asked questions — show them and wait for user answers
        messages.push({ role: 'assistant', content: fullReply });
        renderQuestions(fullReply, secs, tokenInfo);
      }
    } else {
      // Building or Refining — extract project files
      const files = extractProject(fullReply);
      currentFiles = files;
      currentCode = Object.values(files).join('\n');
      messages.push({ role: 'assistant', content: fullReply });
      versions.push({ files: {...files}, prompt: userText, timestamp: Date.now() });
      currentVersion = versions.length - 1;
      updateVersionNav();
      const totalLines = Object.values(files).reduce((s,c) => s + c.split('\n').length, 0);
      const fileCount = Object.keys(files).length;
      let summary = `✓ Built in ${secs}s — ${fileCount} files, ${totalLines} lines`;
      if (tokenInfo) summary += ` · ${tokenInfo} tokens`;
      appendMsg('assistant', summary);
      updatePreview(files);
      updateCodeDisplay(files);
      if (tokenInfo) showTokenBadge(tokenInfo);
      phase = 'refining';
      updatePhaseUI();
    }
    setStatus('ok');
    saveProject();
  } catch (err) {
    removeThinking();
    setStatus('err');
    appendMsg('assistant', '⚠ Error: ' + err.message);
    console.error(err);
  }

  isStreaming = false;
  sendBtn.disabled = false;
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
      // Extract options from (e.g., option1, option2, option3)
      const optMatch = match[1].match(/\((?:e\.g\.?,?\s*)?([^)]+)\)/i);
      if (optMatch) {
        current.options = optMatch[1].split(/,\s*/).map(o => o.trim()).filter(o => o.length > 0 && o.length < 40);
        // Clean question text — remove the parenthetical
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
      // Visual feedback
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
    // Section headers: Features:, Design:, Technical:
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

function approvePlan() {
  phase = 'building';
  updatePhaseUI();
  messages.push({ role: 'user', content: 'I approve this plan. Please build the complete application now.' });
  appendMsg('user', '✅ Plan approved — Build it!');
  appendThinking();
  isStreaming = true;
  sendBtn.disabled = true;
  setStatus('busy');

  (async () => {
    try {
      const r = cfg.provider === 'gemini' ? await callGeminiStream() : await callOllamaStream();
      const secs = Math.round((Date.now() - thinkingStartTime) / 1000);
      removeThinking();
      const files = extractProject(r.text);
      currentFiles = files;
      currentCode = Object.values(files).join('\n');
      messages.push({ role: 'assistant', content: r.text });
      versions.push({ files: {...files}, prompt: 'Build from plan', timestamp: Date.now() });
      currentVersion = versions.length - 1;
      updateVersionNav();
      const totalLines = Object.values(files).reduce((s,c) => s + c.split('\n').length, 0);
      const fileCount = Object.keys(files).length;
      let summary = `✓ Built in ${secs}s — ${fileCount} files, ${totalLines} lines`;
      if (r.tokens) summary += ` · ${r.tokens} tokens`;
      appendMsg('assistant', summary);
      updatePreview(files);
      updateCodeDisplay(files);
      if (r.tokens) showTokenBadge(r.tokens);
      phase = 'refining';
      updatePhaseUI();
      setStatus('ok');
      saveProject();
    } catch (err) {
      removeThinking();
      setStatus('err');
      appendMsg('assistant', '⚠ Error: ' + err.message);
    }
    isStreaming = false;
    sendBtn.disabled = false;
  })();
}

function modifyPlan() {
  promptEl.value = 'I want to change the plan: ';
  promptEl.focus();
  promptEl.setSelectionRange(promptEl.value.length, promptEl.value.length);
}

function updatePhaseUI() {
  const labels = { planning: '🤔 Planning', building: '🏗️ Building', refining: '💬 Refining' };
  const badge = $('projectBadge');
  // Add phase indicator
  let phaseEl = $('phaseBadge');
  if (!phaseEl) {
    phaseEl = document.createElement('div');
    phaseEl.id = 'phaseBadge';
    phaseEl.className = 'phase-badge';
    badge.parentElement.insertBefore(phaseEl, badge);
  }
  phaseEl.textContent = labels[phase] || '';
  phaseEl.className = 'phase-badge phase-' + phase;
  // Update send button text
  const btnLabel = sendBtn.querySelector('span');
  if (phase === 'planning') btnLabel.textContent = 'Send';
  else if (phase === 'building') btnLabel.textContent = 'Build';
  else btnLabel.textContent = 'Refine';
}

// ═══════════ OLLAMA STREAMING ═══════════
async function callOllamaStream() {
  const isCloud = cfg.provider === 'ollama-cloud';
  const baseUrl = isCloud ? '/proxy/ollama' : cfg.url.replace(/\/$/, '');
  const headers = { 'Content-Type': 'application/json' };
  if (isCloud) {
    if (!cfg.apiKey) throw new Error('Ollama Cloud API key required. Open Settings to add it.\n\nGet one at: https://ollama.com/settings/keys');
    headers['Authorization'] = `Bearer ${cfg.apiKey}`;
  }

  // Cloud uses native /api/chat, local uses OpenAI-compatible /v1/chat/completions
  if (isCloud) {
    return callOllamaNative(baseUrl, headers);
  } else {
    return callOllamaOpenAI(baseUrl, headers);
  }
}

// Native Ollama API (/api/chat) — used for Cloud
async function callOllamaNative(baseUrl, headers) {
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST', headers,
    body: JSON.stringify({
      model: cfg.model, stream: true,
      options: { num_predict: estimateTokens() },
      messages: [{ role: 'system', content: getSystemPrompt() }, ...messages]
    })
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    if (res.status === 403) throw new Error('403 Forbidden — Your Ollama API key was rejected.\n\n• Check your key at: https://ollama.com/settings/keys\n• Make sure the key is active and has not expired');
    if (res.status === 401) throw new Error('401 Unauthorized — Invalid API key.\n\nGet a new key at: https://ollama.com/settings/keys');
    throw new Error(parseErr(t, res.status));
  }

  // Native API streams NDJSON (one JSON object per line)
  let text = '', tokens = null;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const j = JSON.parse(line);
        const content = j.message?.content || '';
        if (content) text += content;
        if (j.eval_count) tokens = j.eval_count;
      } catch {}
    }
  }
  return { text, tokens };
}

// OpenAI-compatible API (/v1/chat/completions) — used for Local
async function callOllamaOpenAI(baseUrl, headers) {
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST', headers,
    body: JSON.stringify({
      model: cfg.model, stream: true, max_tokens: estimateTokens(),
      messages: [{ role: 'system', content: getSystemPrompt() }, ...messages]
    })
  });
  if (!res.ok) { const t = await res.text().catch(() => ''); throw new Error(parseErr(t, res.status)); }

  let text = '', tokens = null;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') continue;
      try {
        const j = JSON.parse(data);
        const delta = j.choices?.[0]?.delta?.content || '';
        if (delta) text += delta;
        if (j.usage) tokens = j.usage.total_tokens;
      } catch {}
    }
  }
  return { text, tokens };
}

// ═══════════ GEMINI STREAMING ═══════════
async function callGeminiStream() {
  if (!cfg.apiKey) throw new Error('API Key required. Open Settings to add it.');
  const res = await fetch(`/proxy/gemini/v1beta/models/${cfg.model}:streamGenerateContent?alt=sse&key=${cfg.apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: getSystemPrompt() }] },
      contents: messages.map(m => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.content }]
      }))
    })
  });
  if (!res.ok) { const t = await res.text().catch(()=>''); throw new Error(`Gemini Error: ${parseErr(t, res.status)}`); }

  let text = '', tokens = null;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try {
        const j = JSON.parse(line.slice(6));
        const part = j.candidates?.[0]?.content?.parts?.[0]?.text || '';
        if (part) text += part;
        if (j.usageMetadata?.totalTokenCount) tokens = j.usageMetadata.totalTokenCount;
      } catch {}
    }
  }
  return { text, tokens };
}

function parseErr(text, status) {
  try { const j = JSON.parse(text); return j.error?.message || j.message || `HTTP ${status}`; }
  catch { return `HTTP ${status}`; }
}

// ═══════════ PROJECT EXTRACTION ═══════════
function parseMultiFile(text) {
  const files = {};
  const parts = text.split(/^===FILE:\s*(.+?)===$/gm);
  if (parts.length >= 3) {
    for (let i = 1; i < parts.length; i += 2) {
      const name = parts[i].trim();
      const content = (parts[i + 1] || '').trim();
      if (name && content) files[name] = content;
    }
  }
  return files;
}

function extractFromCodeFences(text) {
  // Fallback: try to extract multiple markdown code fences
  const files = {};
  const fenceRe = /```(\w+)?\s*\n([\s\S]*?)```/g;
  let match;
  let htmlContent = '', cssContent = '', jsContent = '';
  while ((match = fenceRe.exec(text)) !== null) {
    const lang = (match[1] || '').toLowerCase();
    const code = match[2].trim();
    if (lang === 'html' || code.includes('<!DOCTYPE') || code.includes('<html')) htmlContent = code;
    else if (lang === 'css') cssContent = code;
    else if (lang === 'javascript' || lang === 'js') jsContent = code;
    else if (lang === 'json' && code.includes('manifest_version')) files['manifest.json'] = code;
    else if (lang === 'json') files['data.json'] = code;
    else if (lang === 'php') files['index.php'] = code;
    else if (lang === 'python' || lang === 'py') files['main.py'] = code;
  }
  if (htmlContent) files['index.html'] = htmlContent;
  if (cssContent) files['styles.css'] = cssContent;
  if (jsContent) files['app.js'] = jsContent;
  return files;
}

function splitInlineHTML(html) {
  // If the AI put everything inline, extract <style> and <script> into separate files
  const files = {};
  let cleaned = html;

  // Extract <style> blocks
  const styleRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let styleContent = '';
  let styleMatch;
  while ((styleMatch = styleRe.exec(html)) !== null) {
    styleContent += styleMatch[1].trim() + '\n';
  }
  if (styleContent.trim().length > 50) {
    cleaned = cleaned.replace(styleRe, '');
    // Add link tag if not present
    if (!cleaned.includes('href="styles.css"')) {
      cleaned = cleaned.replace('</head>', '  <link rel="stylesheet" href="styles.css">\n</head>');
    }
    files['styles.css'] = styleContent.trim();
  }

  // Extract <script> blocks (not CDN ones)
  const scriptRe = /<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi;
  let jsContent = '';
  let scriptMatch;
  while ((scriptMatch = scriptRe.exec(cleaned)) !== null) {
    const content = scriptMatch[1].trim();
    // Skip very short scripts (like analytics) and console inject
    if (content.length > 50 && !content.includes('gs-console')) {
      jsContent += content + '\n';
    }
  }
  if (jsContent.trim().length > 50) {
    cleaned = cleaned.replace(/<script(?![^>]*src=)[^>]*>[\s\S]*?<\/script>/gi, (m) => {
      const inner = m.replace(/<\/?script[^>]*>/gi, '').trim();
      if (inner.length > 50 && !inner.includes('gs-console')) return '';
      return m;
    });
    if (!cleaned.includes('src="app.js"')) {
      cleaned = cleaned.replace('</body>', '  <script src="app.js"></script>\n</body>');
    }
    files['app.js'] = jsContent.trim();
  }

  files['index.html'] = cleaned.trim();
  return files;
}

function extractProject(text) {
  // 1. Try ===FILE: format first (ideal)
  if (text.includes('===FILE:')) {
    const files = parseMultiFile(text);
    if (Object.keys(files).length > 0) return files;
  }

  // 2. Try markdown code fences with language hints
  const fenceFiles = extractFromCodeFences(text);
  if (Object.keys(fenceFiles).length >= 2) return fenceFiles;

  // 3. Fallback: extract raw HTML and split inline styles/scripts out
  let html = text;
  const fm = text.match(/```html\s*([\s\S]*?)```/);
  if (fm) html = fm[1].trim();
  else {
    const fm2 = text.match(/```\s*(<!DOCTYPE[\s\S]*?)```/i);
    if (fm2) html = fm2[1].trim();
    else {
      const t = text.trim();
      if (t.startsWith('<!DOCTYPE') || t.startsWith('<html')) html = t;
      else {
        const idx = t.indexOf('<!DOCTYPE');
        if (idx >= 0) html = t.slice(idx);
        else {
          const j = t.indexOf('<html');
          if (j >= 0) html = t.slice(j);
          else html = t;
        }
      }
    }
  }

  // Auto-split if the AI inlined everything
  return splitInlineHTML(html);
}

// ═══════════ PREVIEW ═══════════
const CONSOLE_INJECT = `<script>
(function(){var O={log:console.log,error:console.error,warn:console.warn,info:console.info};
['log','error','warn','info'].forEach(function(m){console[m]=function(){O[m].apply(console,arguments);
try{window.parent.postMessage({type:'gs-console',method:m,args:Array.prototype.slice.call(arguments).map(function(a){return typeof a==='object'?JSON.stringify(a):String(a)})},'*')}catch(e){}}});
window.addEventListener('error',function(e){window.parent.postMessage({type:'gs-console',method:'error',args:[e.message+' (line '+e.lineno+')']},'*')})})();
<\/script>`;

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
    // Find the best HTML file for preview
    const htmlFile = names.find(f => f === 'index.html')
      || names.find(f => f === 'popup.html')
      || names.find(f => f.endsWith('.html'));

    if (!htmlFile || !files[htmlFile] || !files[htmlFile].includes('<')) {
      // No previewable HTML — show a project summary card
      html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
        <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',system-ui,sans-serif;background:#0f0f1a;color:#e0e0e0;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
        .card{background:#1a1a2e;border:1px solid #2a2a4a;border-radius:16px;padding:32px;max-width:480px;width:100%}.title{font-size:20px;font-weight:600;margin-bottom:16px;color:#a78bfa}
        .files{list-style:none;margin:0;padding:0}.file{display:flex;align-items:center;gap:10px;padding:8px 12px;margin:4px 0;background:#252542;border-radius:8px;font-family:'JetBrains Mono',monospace;font-size:13px}
        .icon{font-size:16px}.size{margin-left:auto;color:#666;font-size:11px}.hint{margin-top:16px;color:#888;font-size:12px;text-align:center}</style></head>
        <body><div class="card"><div class="title">📁 Project Files (${names.length})</div><ul class="files">`;
      names.forEach(name => {
        const ext = name.split('.').pop().toLowerCase();
        const icons = {html:'🌐',css:'🎨',js:'⚡',json:'📦',php:'🐘',py:'🐍',md:'📝',svg:'🖼️',txt:'📄'};
        const icon = icons[ext] || '📄';
        const lines = files[name].split('\n').length;
        html += `<li class="file"><span class="icon">${icon}</span>${name}<span class="size">${lines} lines</span></li>`;
      });
      html += `</ul><p class="hint">⬇ Download the project ZIP to use these files</p></div></body></html>`;
      const blob = new Blob([html], { type: 'text/html' });
      frame.src = URL.createObjectURL(blob);
      return;
    }

    html = files[htmlFile] || '';
    // Inject CSS files as <style> before </head>
    const cssFiles = Object.entries(files).filter(([f]) => f.endsWith('.css'));
    if (cssFiles.length > 0) {
      const cssBlock = cssFiles.map(([name, content]) => `<style>/* ${name} */\n${content}</style>`).join('\n');
      cssFiles.forEach(([name]) => {
        const linkRe = new RegExp(`<link[^>]*href=["']${name.replace('.','\\.')}["'][^>]*/?>`, 'gi');
        html = html.replace(linkRe, '');
      });
      html = html.replace('</head>', cssBlock + '\n</head>');
    }
    // Inject JS files as <script> before </body>
    const jsFiles = Object.entries(files).filter(([f]) => f.endsWith('.js'));
    if (jsFiles.length > 0) {
      const jsBlock = jsFiles.map(([name, content]) => `<script>/* ${name} */\n${content}<\/script>`).join('\n');
      jsFiles.forEach(([name]) => {
        const scriptRe = new RegExp(`<script[^>]*src=["']${name.replace('.','\\.')}["'][^>]*>\\s*</script>`, 'gi');
        html = html.replace(scriptRe, '');
      });
      html = html.replace('</body>', jsBlock + '\n</body>');
    }
  }

  // Inject console capture
  const headIdx = html.indexOf('<head');
  if (headIdx >= 0) {
    const closeHead = html.indexOf('>', headIdx);
    if (closeHead >= 0) html = html.slice(0, closeHead + 1) + CONSOLE_INJECT + html.slice(closeHead + 1);
  }
  const blob = new Blob([html], { type: 'text/html' });
  frame.src = URL.createObjectURL(blob);
}

// ═══════════ CODE DISPLAY WITH FILE TABS ═══════════
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
  try {
    if (window.Prism) Prism.highlightElement(el);
  } catch (e) {
    console.warn('Prism highlight failed:', e.message);
  }
}

function updateCodeDisplay(filesOrCode) {
  const tabsEl = $('fileTabs');
  const codeEl = $('codeDisplay');
  const treeEl = $('explorerTree');

  if (typeof filesOrCode === 'string') {
    // Legacy single string
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

  // Set default active file
  if (!activeFile || !files[activeFile]) activeFile = names[0];

  // Build file explorer tree
  if (treeEl) {
    treeEl.innerHTML = names.map(name => {
      const icon = getFileIcon(name);
      const lines = files[name].split('\n').length;
      const isActive = name === activeFile ? 'active' : '';
      return `<div class="explorer-item ${isActive}" data-file="${esc(name)}">
        <span class="explorer-item-icon">${icon}</span>
        <span class="explorer-item-name">${esc(name)}</span>
        <span class="explorer-item-lines">${lines}L</span>
      </div>`;
    }).join('');

    // Explorer click handlers
    treeEl.querySelectorAll('.explorer-item').forEach(item => {
      item.addEventListener('click', () => {
        activeFile = item.dataset.file;
        updateCodeDisplay(currentFiles);
      });
    });
  }

  // Build file tabs
  tabsEl.innerHTML = names.map(name => {
    const icon = getFileIcon(name);
    const size = files[name].split('\n').length;
    const isActive = name === activeFile ? 'active' : '';
    return `<button class="file-tab ${isActive}" data-file="${esc(name)}">
      <span class="file-tab-icon">${icon}</span>
      <span class="file-tab-name">${esc(name)}</span>
      <span class="file-tab-size">${size}L</span>
    </button>`;
  }).join('');

  // Show active file content
  const lang = getPrismLang(activeFile);
  codeEl.className = `language-${lang}`;
  codeEl.textContent = files[activeFile];
  if (window.Prism) safeHighlight(codeEl);

  // Tab click handlers
  tabsEl.querySelectorAll('.file-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      activeFile = tab.dataset.file;
      updateCodeDisplay(currentFiles);
    });
  });
}

// ═══════════ VERSION HISTORY ═══════════
function updateVersionNav() {
  const nav = $('versionNav');
  if (versions.length < 1) { nav.classList.add('hidden'); return; }
  nav.classList.remove('hidden');
  $('verLabel').textContent = `v${currentVersion + 1}/${versions.length}`;
  $('verPrev').disabled = currentVersion <= 0;
  $('verNext').disabled = currentVersion >= versions.length - 1;
}
$('verPrev').onclick = () => {
  if (currentVersion > 0) { currentVersion--; loadVersion(); }
};
$('verNext').onclick = () => {
  if (currentVersion < versions.length - 1) { currentVersion++; loadVersion(); }
};
function loadVersion() {
  const v = versions[currentVersion];
  if (!v) return;
  if (v.files) {
    currentFiles = {...v.files};
    currentCode = Object.values(v.files).join('\n');
    updatePreview(v.files);
    updateCodeDisplay(v.files);
  } else if (v.code) {
    currentCode = v.code;
    currentFiles = { 'index.html': v.code };
    updatePreview(v.code);
    updateCodeDisplay(v.code);
  }
  updateVersionNav();
}

// ═══════════ TOKEN BADGE ═══════════
function showTokenBadge(tokens) {
  const badge = $('tokenBadge');
  badge.textContent = `${tokens} tokens`;
  badge.classList.remove('hidden');
}

// ═══════════ CONSOLE CAPTURE ═══════════
window.addEventListener('message', e => {
  if (e.data?.type !== 'gs-console') return;
  const { method, args } = e.data;
  consoleLines.push({ method, text: args.join(' '), time: new Date() });

  const output = $('consoleOutput');
  if (output.querySelector('.console-empty')) output.innerHTML = '';
  const line = document.createElement('div');
  line.className = `console-line ${method}`;
  line.innerHTML = `<span class="console-method">${method}</span><span>${esc(args.join(' '))}</span>`;
  output.appendChild(line);
  output.scrollTop = output.scrollHeight;

  const count = $('consoleCount');
  count.textContent = consoleLines.length;
  count.classList.remove('hidden');
});
$('consoleClear').onclick = () => {
  consoleLines = [];
  $('consoleOutput').innerHTML = '<div class="console-empty">Console cleared.</div>';
  $('consoleCount').classList.add('hidden');
};

// ═══════════ COPY & DOWNLOAD ═══════════
$('btnCopy').onclick = () => {
  // Copy the active file content
  const content = activeFile && currentFiles[activeFile] ? currentFiles[activeFile] : currentCode;
  if (!content) return;
  navigator.clipboard.writeText(content).then(() => {
    const btn = $('btnCopy');
    btn.querySelector('span').textContent = 'Copied!';
    setTimeout(() => btn.querySelector('span').textContent = 'Copy', 2000);
  });
};
$('btnDownload').onclick = downloadProject;
function downloadProject() {
  const names = Object.keys(currentFiles);
  if (names.length === 0 && !currentCode) return;

  // Single file → download directly
  if (names.length <= 1 && !currentFiles['styles.css'] && !currentFiles['app.js']) {
    const content = currentFiles[names[0]] || currentCode;
    const blob = new Blob([content], { type: 'text/html' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = names[0] || 'app.html';
    a.click();
    return;
  }

  // Multi-file → ZIP download (files at root, not in subfolder)
  if (typeof JSZip === 'undefined') {
    alert('JSZip not loaded. Please refresh and try again.');
    return;
  }
  const zip = new JSZip();
  const projectName = ($('projectBadge').textContent || 'project').replace(/[^a-zA-Z0-9_-]/g, '_');
  for (const [name, content] of Object.entries(currentFiles)) {
    zip.file(name, content);
  }
  zip.generateAsync({ type: 'blob' }).then(blob => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = projectName + '.zip';
    a.click();
  });
}

// ═══════════ NEW PROJECT ═══════════
$('btnNew').onclick = newProject;
function newProject() {
  if (isStreaming) return;
  if (messages.length > 0 && !confirm('Start new project? Current conversation will be cleared.')) return;
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
  $('previewFrame').src = '';
  $('codeDisplay').textContent = '';
  $('versionNav').classList.add('hidden');
  $('tokenBadge').classList.add('hidden');
  $('consoleOutput').innerHTML = '<div class="console-empty">No console output yet.</div>';
  $('consoleCount').classList.add('hidden');
  $('projectBadge').textContent = 'Untitled';
  const phaseEl = $('phaseBadge'); if (phaseEl) phaseEl.remove();
  updatePhaseUI();
  setStatus('');
  saveProject();
}

// ═══════════ RESIZABLE PANELS ═══════════
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

// ═══════════ KEYBOARD SHORTCUTS ═══════════
document.addEventListener('keydown', e => {
  // Ctrl+S → download
  if (e.ctrlKey && e.key === 's') { e.preventDefault(); downloadProject(); }
  // Ctrl+Shift+C → copy code
  if (e.ctrlKey && e.shiftKey && e.key === 'C') { e.preventDefault(); $('btnCopy').click(); }
  // Ctrl+, → settings
  if (e.ctrlKey && e.key === ',') { e.preventDefault(); openModal('settingsOverlay'); }
  // Ctrl+/ → shortcuts
  if (e.ctrlKey && e.key === '/') { e.preventDefault(); openModal('shortcutsOverlay'); }
  // Ctrl+Shift+N → new project
  if (e.ctrlKey && e.shiftKey && e.key === 'N') { e.preventDefault(); newProject(); }
  // Ctrl+[ → prev version
  if (e.ctrlKey && e.key === '[') { e.preventDefault(); $('verPrev').click(); }
  // Ctrl+] → next version
  if (e.ctrlKey && e.key === ']') { e.preventDefault(); $('verNext').click(); }
  // Escape → close modals
  if (e.key === 'Escape') {
    closeModal('settingsOverlay');
    closeModal('shortcutsOverlay');
  }
});

// ═══════════ PROJECT PERSISTENCE ═══════════
function saveProject() {
  const project = {
    messages, versions, currentVersion, currentCode, currentFiles, phase,
    provider: cfg.provider, model: cfg.model,
    name: $('projectBadge').textContent,
    updatedAt: Date.now()
  };
  localStorage.setItem('gs_project', JSON.stringify(project));
}

function loadProject() {
  try {
    const raw = localStorage.getItem('gs_project');
    if (!raw) return;
    const p = JSON.parse(raw);
    if (!p.messages?.length) return;
    messages = p.messages || [];
    versions = p.versions || [];
    currentVersion = p.currentVersion ?? -1;
    currentCode = p.currentCode || '';
    currentFiles = p.currentFiles || (currentCode ? { 'index.html': currentCode } : {});
    activeFile = Object.keys(currentFiles)[0] || '';
    phase = p.phase || (currentCode ? 'refining' : 'planning');
    if (p.name) $('projectBadge').textContent = p.name;

    // Replay chat
    emptyChat.classList.add('hidden');
    messages.forEach(m => {
      if (m.role === 'user' || m.role === 'assistant') {
        const content = m.role === 'assistant' ? '✓ (restored)' : m.content;
        appendMsg(m.role, m.role === 'user' ? m.content : content);
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
  } catch {}
}

// Project rename
$('projectBadge').addEventListener('click', () => {
  const name = prompt('Rename project:', $('projectBadge').textContent);
  if (name?.trim()) { $('projectBadge').textContent = name.trim(); saveProject(); }
});

// ═══════════ INIT ═══════════
updateSettingsUI();
updateTopbar();
loadProject();
updatePhaseUI();

// Load skills index
fetch('/skills-index.json')
  .then(r => r.ok ? r.json() : {})
  .then(data => { skillsIndex = data; console.log(`✦ Loaded ${Object.keys(data).length} skill domains`); })
  .catch(() => console.warn('Skills index not found, using defaults'));
