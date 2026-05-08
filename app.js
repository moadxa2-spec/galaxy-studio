// ═══════════════════════════════════════════
//  Galaxy Studio — app.js (Orchestrator v2)
//  Merged Galaxy + Gemma Chat engine
// ═══════════════════════════════════════════

// ── STATE ──
let currentProjectId = null;
let messages = [];
let currentCode = '';
let currentFiles = {};
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
let chatMode = 'build'; // 'build' | 'chat'
let lastUserMessage = ''; // for regenerate

// ── CONFIG ──
const cfg = {
  provider: localStorage.getItem('gs_provider') || 'gemini',
  url: localStorage.getItem('gs_url') || 'http://localhost:11434',
  apiKey: localStorage.getItem('gs_apikey') || '',
  model: localStorage.getItem('gs_model') || 'gemini-2.5-flash-preview-04-17'
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
- Clean JavaScript, no jQuery
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
- You may use web_search or fetch_url to look up anything you need.

TOOLS:
${renderToolHelp()}
`;

const PROMPT_CHAT = `You are Galaxy Studio, a helpful AI assistant specializing in web development. You are in CHAT mode — answer questions, explain concepts, review code, give advice. Do NOT write or modify project files unless explicitly asked. Respond in clear markdown.`;

// ── ORCHESTRATION ──

function getMaxRounds() {
  return chatMode === 'chat' ? MAX_AGENT_ROUNDS_CHAT : MAX_AGENT_ROUNDS_CODE;
}

function estimateTokens() {
  const allText = messages.map(m => m.content).join(' ').toLowerCase();
  const fileCount = Object.keys(currentFiles).length;
  if (fileCount > 5 || allText.includes('full') || allText.includes('complex')) return 100000;
  if (allText.includes('extension') || allText.includes('ecommerce')) return 64000;
  return 32000;
}

function getSystemPrompt() {
  if (chatMode === 'chat') return PROMPT_CHAT;
  if (phase === 'planning') {
    const aiAskedQuestions = messages.some(m => m.role === 'assistant' && m.content.includes('QUESTIONS:'));
    const userAnswered = aiAskedQuestions && messages.filter(m => m.role === 'user').length >= 2;
    return userAnswered ? PROMPT_CREATE_PLAN : PROMPT_PLANNING;
  }
  const basePrompt = phase === 'building' ? PROMPT_BUILD : PROMPT_REFINE;
  return basePrompt + '\n\n' + SKILLS_WEB;
}

function handleBuildResult(text, tokens, userText, secs) {
  if (text.includes('===FILE:') || text.includes('\`\`\`html')) {
    const extracted = extractProject(text);
    if (Object.keys(extracted).length > 0) Object.assign(currentFiles, extracted);
  }

  currentCode = Object.values(currentFiles).join('\n');
  messages.push({ role: 'assistant', content: text });

  const versionData = { files: { ...currentFiles }, prompt: userText, timestamp: Date.now(), model: cfg.model, tokens };
  versions.push(versionData);
  currentVersion = versions.length - 1;
  updateVersionNav();

  // Persist version to Supabase
  persistVersion(currentProjectId, currentVersion, versionData);

  const totalLines = Object.values(currentFiles).reduce((s, c) => s + c.split('\n').length, 0);
  const fileCount = Object.keys(currentFiles).length;
  let summary = `Built in ${secs}s — ${fileCount} files, ${totalLines} lines`;
  if (tokens) summary += ` · ${tokens} tokens`;

  appendMsg('assistant', summary);
  updatePreview(currentFiles);
  updateCodeDisplay(currentFiles);
  if (tokens) showTokenBadge(tokens);

  phase = 'refining';
  updatePhaseUI();
  saveCurrentProject();
  if (tokens) logUsage(cfg.provider, cfg.model, 0, tokens);
}

function approvePlan() {
  if (isStreaming) return;
  phase = 'building';
  updatePhaseUI();
  promptEl.value = `Build the app exactly as described in the plan above.`;
  sendMessage();
}

function modifyPlan() {
  if (isStreaming) return;
  promptEl.value = 'I want to change the plan: ';
  promptEl.focus();
  promptEl.selectionStart = promptEl.selectionEnd = promptEl.value.length;
}

function regenerateLast() {
  if (isStreaming || !lastUserMessage) return;
  // Remove last assistant message from messages array
  while (messages.length > 0 && messages[messages.length - 1].role === 'assistant') {
    messages.pop();
  }
  promptEl.value = lastUserMessage;
  sendMessage();
}

// ── MAIN AGENT LOOP ──
async function sendMessage() {
  if (isStreaming) return;
  if (!cfg.model) { openModal('settingsOverlay'); return; }
  const userText = promptEl.value.trim();
  if (!userText) return;

  // Warn if streaming will navigate away
  window._pendingStream = true;

  promptEl.value = '';
  lastUserMessage = userText;
  isStreaming = true;

  sendBtn.classList.add('hidden');
  const stopBtn = $('stopBtn');
  if (stopBtn) stopBtn.classList.remove('hidden');

  setStatus('busy');
  appendMsg('user', userText);
  appendThinking();
  messages.push({ role: 'user', content: userText });
  persistMessage(currentProjectId, { role: 'user', content: userText, model: cfg.model });

  const isToolMode = chatMode === 'build' && (phase === 'building' || phase === 'refining');
  let roundCount = 0;

  const ctx = {
    files: currentFiles,
    onFileWrite: (path, content, done) => { renderLiveCode(path, content, done); }
  };

  try {
    while (roundCount < getMaxRounds() && isStreaming) {
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

      // Create streaming bubble
      const replyDiv = document.createElement('div');
      replyDiv.className = 'msg assistant tool-round';
      replyDiv.innerHTML = `<div class="msg-role">${esc(cfg.model || 'AI')}</div><div class="msg-bubble formatted markdown-body"></div>`;
      const bubble = replyDiv.querySelector('.msg-bubble');
      chatHistory.appendChild(replyDiv);

      // Tool activity badge container (shown after reply, once thinking bubble is gone)
      const activityBar = document.createElement('div');
      activityBar.className = 'tool-activity-bar';
      replyDiv.appendChild(activityBar);

      function showActivity(text) {
        // Show in thinking bubble while it's still visible (during initial stream)
        updateThinkingStep(text);
        // Also show in activity bar below the reply (after thinking bubble removed)
        activityBar.innerHTML = `<span class="tool-badge running">${esc(text)}</span>`;
        chatHistory.scrollTop = chatHistory.scrollHeight;
      }
      function clearActivity() {
        updateThinkingStep('');
        activityBar.innerHTML = '';
      }

      const res = await streamChat(opts, (chunk) => {
        if (chunk.type === 'token') {
          currentResponse += chunk.data;

          if (isToolMode) {
            const safeLen = emitSafeBoundary(currentResponse, lastRenderedLength);
            if (safeLen > lastRenderedLength) {
              const safeText = currentResponse.slice(lastRenderedLength, safeLen);
              renderMarkdownChunk(bubble, safeText);
              lastRenderedLength = safeLen;
              chatHistory.scrollTop = chatHistory.scrollHeight;
            }

            // Live-write: stream file content as model writes it
            const incompleteAction = findNextAction(currentResponse, 0);
            if (incompleteAction === 'incomplete') {
              const openTag = currentResponse.match(/<action\s+name\s*=\s*["']?write_file["']?\s*>/i);
              const pathMatch = currentResponse.match(/<path>([\s\S]*?)<\/path>/i);
              const contentOpen = currentResponse.lastIndexOf('<content>');
              if (openTag && pathMatch && contentOpen > openTag.index) {
                const filePath = normalizePath(pathMatch[1]);
                const rawContent = currentResponse.slice(contentOpen + 9);
                const displayContent = rawContent.replace(/<\/content>[\s\S]*$/, '');
                showActivity(`writing ${filePath}...`);
                ctx.onFileWrite(filePath, displayContent, false);
              }
            }
          } else {
            // Planning / chat mode: stream markdown directly
            bubble.innerHTML = renderMarkdown(currentResponse);
            chatHistory.scrollTop = chatHistory.scrollHeight;
          }
        } else if (chunk.type === 'activity') {
          showActivity(chunk.data);
        } else if (chunk.type === 'done') {
          totalTokens = chunk.data?.tokens || totalTokens;
        }
      });

      totalTokens = res?.tokens || totalTokens;
      clearActivity();

      // ── POST-STREAM TOOL PROCESSING ──
      if (isToolMode) {
        let searchFrom = 0;
        let toolsExecuted = 0;

        while (true) {
          const actionData = findNextAction(currentResponse, searchFrom);
          if (!actionData || actionData === 'incomplete') break;

          showActivity(`${actionData.name}(${actionData.args.path || actionData.args.query || ''})`);

          let result;
          const tool = TOOLS[actionData.name];
          if (tool?.run?.constructor?.name === 'AsyncFunction') {
            result = await TOOLS[actionData.name].run(actionData.args, ctx);
          } else {
            result = runTool(actionData.name, actionData.args, ctx);
          }

          // Mark file done
          if ((actionData.name === 'write_file' || actionData.name === 'edit_file') && actionData.args.path) {
            const fp = normalizePath(actionData.args.path);
            if (ctx.files[fp]) ctx.onFileWrite(fp, ctx.files[fp], true);
          }

          const resultShort = String(result).slice(0, 120);
          const badge = document.createElement('div');
          badge.className = 'tool-result';
          badge.innerHTML = `<span class="tool-badge done">${esc(actionData.name)}</span> <span class="tool-result-text">${esc(resultShort)}</span>`;
          replyDiv.appendChild(badge);
          toolsExecuted++;
          searchFrom = actionData.end;
        }

        clearActivity();

        if (toolsExecuted > 0) {
          messages.push({ role: 'assistant', content: currentResponse });
          messages.push({ role: 'user', content: `Tool results processed (${toolsExecuted} action(s)). Continue with any remaining files or tasks.` });
          continue;
        }
      }

      // ── RESPONSE COMPLETE ──
      removeThinking();
      const secs = Math.round((Date.now() - thinkingStartTime) / 1000);

      // Final markdown render (replace partial streaming render with full clean render)
      bubble.innerHTML = renderMarkdown(currentResponse.replace(/<action[\s\S]*?<\/action>/gi, '').trim());

      if (chatMode === 'chat') {
        messages.push({ role: 'assistant', content: currentResponse });
        persistMessage(currentProjectId, { role: 'assistant', content: currentResponse, model: cfg.model });
        if (totalTokens) showTokenBadge(totalTokens);
      } else if (phase === 'planning') {
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

      break;
    }

    if (roundCount >= getMaxRounds()) {
      appendMsg('assistant', 'Max agent rounds reached. The model may need more specific instructions.');
    }

    setStatus('ok');
  } catch (err) {
    if (err.name === 'AbortError' || err.message?.includes('abort')) {
      appendMsg('assistant', 'Generation stopped.');
      setStatus('ok');
    } else {
      setStatus('err');
      appendMsg('assistant', 'Error: ' + err.message);
      console.error(err);
    }
  } finally {
    removeThinking();
    isStreaming = false;
    window._pendingStream = false;
    _hiddenWhileStreaming = false;
    if (stopBtn) stopBtn.classList.add('hidden');
    sendBtn.classList.remove('hidden');
    sendBtn.disabled = false;
  }
}

// ── MARKDOWN RENDERING ──
function renderMarkdown(text) {
  if (window.marked) {
    try {
      return window.marked.parse(text, { breaks: true, gfm: true });
    } catch { /* fall through */ }
  }
  return esc(text).replace(/\n/g, '<br>');
}

function renderMarkdownChunk(el, chunk) {
  // Append raw text and re-render whole bubble content for streaming
  el.dataset.raw = (el.dataset.raw || '') + chunk;
  el.innerHTML = renderMarkdown(el.dataset.raw);
}

// ═══════════ PROJECT MANAGEMENT ═══════════

async function saveCurrentProject() {
  const name = $('projectBadge')?.textContent || 'Untitled';
  await saveProject(currentProjectId, {
    messages, versions, currentVersion, currentCode, currentFiles,
    phase, name, description: ''
  });
  const list = await listProjects();
  renderProjectSidebar(list);
}

function newProject() {
  if (isStreaming) return;
  if (messages.length > 0 && !confirm('Start new project? Current conversation will be cleared.')) return;

  currentProjectId = generateProjectId();
  messages = []; currentCode = ''; currentFiles = {}; activeFile = '';
  versions = []; currentVersion = -1; consoleLines = [];
  phase = 'planning'; currentPlan = null; chatMode = 'build';

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
  updateModeToggle();
  setStatus('');
  saveCurrentProject();
  loadAndRenderTemplates();
}

async function switchProject(id) {
  if (isStreaming) return;

  let p;
  if (typeof id === 'object' && id !== null) {
    // Called with a project data object directly
    p = id;
    id = p.id;
  } else {
    p = await loadProjectById(id);
  }
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

  chatHistory.innerHTML = '';
  emptyChat.classList.toggle('hidden', messages.length > 0);
  if (messages.length === 0) chatHistory.appendChild(emptyChat);

  messages.forEach(m => {
    if (m.role === 'user' || m.role === 'assistant') {
      let content = m.content;
      if (m.role === 'assistant' && content.length > 2000) {
        content = content.slice(0, 1000) + '\n\n...[code generation hidden for readability]...\n\n' + content.slice(-500);
      }
      appendMsg(m.role, content, true);
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
  updateModeToggle();
  const list = await listProjects();
  renderProjectSidebar(list);
}

// ═══════════ DOWNLOAD / EXPORT ═══════════

async function downloadProject() {
  const names = Object.keys(currentFiles);
  if (names.length === 0) { showToast('No files to download yet.', 'error'); return; }

  if (names.length === 1) {
    const name = names[0];
    const blob = new Blob([currentFiles[name]], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
    return;
  }

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
    const htmlFile = names.find(n => n.endsWith('.html')) || names[0];
    const blob = new Blob([currentFiles[htmlFile]], { type: 'text/html' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = htmlFile;
    a.click();
    URL.revokeObjectURL(a.href);
  }
}

// ═══════════ SHARE ═══════════

async function toggleShareProject() {
  const proj = await loadProjectById(currentProjectId);
  if (!proj) return;
  const newIsPublic = !proj.isPublic;
  const slug = await setProjectPublic(currentProjectId, newIsPublic);
  if (newIsPublic && slug) {
    const shareUrl = `${window.location.origin}/p/${slug}`;
    await navigator.clipboard.writeText(shareUrl).catch(() => {});
    showToast('Share link copied: ' + shareUrl);
  } else {
    showToast('Project is now private.');
  }
  saveCurrentProject();
}

// ═══════════ TEMPLATES ═══════════

async function loadAndRenderTemplates() {
  const templateGrid = $('templateGrid');
  if (!templateGrid) return;

  const templates = await loadTemplates();
  if (!templates || templates.length === 0) return;

  templateGrid.innerHTML = templates.map(t => `
    <button class="template-card" data-prompt="${esc(t.prompt || t.name)}">
      <span class="template-icon">${esc(t.icon || '✦')}</span>
      <span class="template-label">${esc(t.name)}</span>
    </button>
  `).join('');

  templateGrid.querySelectorAll('.template-card').forEach(card => {
    card.addEventListener('click', () => {
      const prompt = card.dataset.prompt;
      if (prompt) { promptEl.value = prompt; promptEl.focus(); }
    });
  });
}

// ═══════════ MODELS ═══════════

async function fetchModels() {
  const p = providerSelect.value;
  fetchBtn.textContent = '…';
  fetchBtn.disabled = true;
  try {
    const models = await fetchAvailableModels(p, apiKeyInput.value.trim(), ollamaUrlInput.value.trim());
    if (models.length === 0) throw new Error('No models found');
    populateModelSelect(models);
  } catch (e) {
    showToast('Could not fetch models: ' + e.message, 'error');
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
  if (cfg.model && models.includes(cfg.model)) modelSelect.value = cfg.model;
  modelSelect.classList.remove('hidden');
  modelInput.classList.add('hidden');
}

// ═══════════ SETTINGS UI ═══════════

function updateSettingsUI() {
  const p = providerSelect.value;
  $('settingHost').classList.toggle('hidden', p !== 'ollama-local');
  $('settingApiKey').classList.toggle('hidden', p === 'ollama-local');

  const hints = {
    gemini: 'Get a free key at aistudio.google.com',
    'ollama-cloud': 'Your Ollama Cloud API key — ollama.com/settings/keys',
    anthropic: 'Your Anthropic key — console.anthropic.com',
    openai: 'Your OpenAI API key — platform.openai.com',
    openrouter: 'Your OpenRouter key — openrouter.ai/keys'
  };
  const modelInputs = {
    gemini: 'e.g. gemini-2.5-flash-preview-04-17',
    anthropic: 'e.g. claude-sonnet-4-5',
    openai: 'e.g. gpt-4o',
    openrouter: 'e.g. openai/gpt-4o'
  };

  $('apiKeyHint') && ($('apiKeyHint').textContent = hints[p] || 'Your API key');

  if (p === 'gemini' || p === 'anthropic' || p === 'openai') {
    modelInput.placeholder = modelInputs[p] || '';
    // Show both select and input — prefetch or allow manual entry
  }
}

// ═══════════ MODE TOGGLE ═══════════

function updateModeToggle() {
  const btn = $('modeToggle');
  if (!btn) return;
  btn.dataset.mode = chatMode;
  btn.textContent = chatMode === 'chat' ? 'Chat Mode' : 'Build Mode';
  btn.classList.toggle('chat-mode', chatMode === 'chat');
}

function toggleChatMode() {
  chatMode = chatMode === 'build' ? 'chat' : 'build';
  updateModeToggle();
  updatePhaseUI();
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

  const countEl = $('consoleCount');
  countEl.textContent = consoleLines.length;
  countEl.classList.remove('hidden');
});

// ═══════════ BEFOREUNLOAD (page close/navigate only) ═══════════

window.addEventListener('beforeunload', e => {
  // Only warn on actual page unload, not tab switches
  if (isStreaming) {
    e.preventDefault();
    e.returnValue = 'Generation is still running. Leave anyway?';
  }
});

// ═══════════ VISIBILITY CHANGE (tab switch) ═══════════
// Chrome may throttle streaming fetches when the tab is hidden.
// When returning to the tab, if the stream silently died, show a retry prompt.
let _hiddenWhileStreaming = false;

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && isStreaming) {
    _hiddenWhileStreaming = true;
  }
  if (document.visibilityState === 'visible' && _hiddenWhileStreaming) {
    _hiddenWhileStreaming = false;
    // If streaming already cleaned up (AbortError was swallowed), offer retry
    if (!isStreaming) {
      const retryBar = document.createElement('div');
      retryBar.className = 'stream-interrupted-bar';
      retryBar.innerHTML = `
        <span>Generation may have been interrupted while the tab was in the background.</span>
        <button onclick="regenerateLast(); this.parentElement.remove()">Retry</button>
        <button onclick="this.parentElement.remove()">Dismiss</button>`;
      chatHistory.appendChild(retryBar);
      chatHistory.scrollTop = chatHistory.scrollHeight;
    }
  }
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

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.tab;
    activeTab = target;
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === target));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'panel' + target.charAt(0).toUpperCase() + target.slice(1)));
  });
});

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

$('btnCopy').onclick = () => {
  const file = currentFiles[activeFile] || Object.values(currentFiles)[0] || currentCode;
  if (!file) return;
  navigator.clipboard.writeText(file).then(() => {
    const btn = $('btnCopy');
    const orig = btn.querySelector('span').textContent;
    btn.querySelector('span').textContent = 'Copied!';
    setTimeout(() => { btn.querySelector('span').textContent = orig; }, 1500);
  }).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = file;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  });
};

$('btnDownload').onclick = downloadProject;

$('consoleClear').onclick = () => {
  consoleLines = [];
  $('consoleOutput').innerHTML = '<div class="console-empty">No console output yet.</div>';
  $('consoleCount').classList.add('hidden');
};

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

// Keyboard shortcuts
document.addEventListener('keydown', e => {
  if (e.ctrlKey && e.key === 's') { e.preventDefault(); downloadProject(); }
  if (e.ctrlKey && e.shiftKey && e.key === 'C') { e.preventDefault(); $('btnCopy').click(); }
  if (e.ctrlKey && e.shiftKey && e.key === 'N') { e.preventDefault(); newProject(); }
  if (e.ctrlKey && e.key === ',') { e.preventDefault(); openModal('settingsOverlay'); }
  if (e.ctrlKey && e.key === '/') { e.preventDefault(); openModal('shortcutsOverlay'); }
  if (e.ctrlKey && e.key === '[') { e.preventDefault(); $('verPrev').click(); }
  if (e.ctrlKey && e.key === ']') { e.preventDefault(); $('verNext').click(); }
  if (e.ctrlKey && e.shiftKey && e.key === 'R') { e.preventDefault(); regenerateLast(); }
  if (e.key === 'Escape') {
    closeModal('settingsOverlay');
    closeModal('shortcutsOverlay');
    closeModal('authOverlay');
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

$('settingsSave').onclick = async () => {
  cfg.provider = providerSelect.value;
  cfg.url = ollamaUrlInput.value.trim() || 'http://localhost:11434';
  cfg.apiKey = apiKeyInput.value.trim();
  cfg.model = modelInput.classList.contains('hidden') ? modelSelect.value : modelInput.value.trim();
  localStorage.setItem('gs_provider', cfg.provider);
  localStorage.setItem('gs_url', cfg.url);
  localStorage.setItem('gs_apikey', cfg.apiKey);
  localStorage.setItem('gs_model', cfg.model);
  await saveUserSettings({ provider: cfg.provider, model: cfg.model });
  updateTopbar();
  closeModal('settingsOverlay');
};

$('providerPill').onclick = () => openModal('settingsOverlay');
$('modelPill').onclick = () => openModal('settingsOverlay');
$('settingsClose').onclick = () => closeModal('settingsOverlay');

function updateTopbar() {
  const names = {
    'ollama-local': 'Local Ollama',
    'ollama-cloud': 'Ollama Cloud',
    'gemini': 'Gemini',
    'anthropic': 'Claude',
    'openai': 'OpenAI',
    'openrouter': 'OpenRouter'
  };
  providerLabel.textContent = names[cfg.provider] || cfg.provider;
  modelLabel.textContent = cfg.model || 'No Model';
}

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

// Add new provider options if not present
(function patchProviderSelect() {
  const existing = Array.from(providerSelect.options).map(o => o.value);
  const toAdd = [
    ['anthropic', 'Anthropic Claude'],
    ['openai', 'OpenAI'],
    ['openrouter', 'OpenRouter']
  ];
  toAdd.forEach(([val, label]) => {
    if (!existing.includes(val)) {
      const o = document.createElement('option');
      o.value = val; o.textContent = label;
      providerSelect.appendChild(o);
    }
  });
  providerSelect.value = cfg.provider;
})();

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

// Share button (wired in HTML; also wire here as fallback)
const btnShare = $('btnShare');
if (btnShare) btnShare.onclick = toggleShareProject;

// Regenerate button
const btnRegen = $('btnRegen');
if (btnRegen) btnRegen.onclick = regenerateLast;

// Mode toggle
const modeToggle = $('modeToggle');
if (modeToggle) modeToggle.onclick = toggleChatMode;

// User menu
const userMenuBtn = $('userMenuBtn');
if (userMenuBtn) userMenuBtn.onclick = toggleUserMenu;

// Auth form wiring
const loginForm = $('loginForm');
if (loginForm) loginForm.onsubmit = authSignIn;
const signupForm = $('signupForm');
if (signupForm) signupForm.onsubmit = authSignUp;
const forgotLink = $('forgotLink');
if (forgotLink) forgotLink.onclick = e => { e.preventDefault(); authForgotPassword(); };
const signOutBtn = $('signOutBtn');
if (signOutBtn) signOutBtn.onclick = authSignOut;
document.querySelectorAll('.auth-tab-btn').forEach(b => {
  b.onclick = () => showAuthTab(b.dataset.tab);
});

// Handle share URL on load: /p/<slug>
async function handleShareRoute() {
  const path = window.location.pathname;
  const slugMatch = path.match(/^\/p\/([a-z0-9]+)$/);
  if (!slugMatch) return false;
  const slug = slugMatch[1];
  const proj = await loadPublicProject(slug);
  if (!proj) {
    appendMsg('assistant', 'Project not found or is private.');
    return true;
  }
  $('projectBadge').textContent = proj.name;
  currentFiles = proj.files || {};
  currentCode = Object.values(currentFiles).join('\n');
  if (Object.keys(currentFiles).length > 0) {
    updatePreview(currentFiles);
    updateCodeDisplay(currentFiles);
  }
  appendMsg('assistant', `Viewing shared project: **${proj.name}**`);
  return true;
}

// ══════════════════════════════════
//  WINDOW INIT
// ══════════════════════════════════
window.onload = async () => {
  updateTopbar();
  loadAndRenderTemplates();

  // Check if this is a share URL — load public project without auth
  const isShareRoute = await handleShareRoute();
  if (isShareRoute) return;

  // Init Supabase Auth
  await initAuth(async (user) => {
    if (user) {
      await onUserSignedIn(user);
    } else {
      // No session — show auth modal
      showAuthModal('login');
    }
  });

  fetch('/skills-index.json').then(r => r.json()).then(d => { skillsIndex = d; }).catch(() => {});
};

console.log('✦ app.js loaded (v2 — Galaxy + Gemma merged)');
