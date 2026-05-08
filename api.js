// ═══════════════════════════════════════════
//  Galaxy Studio — api.js
//  Streaming API calls — all providers
// ═══════════════════════════════════════════

let _abortController = null;

function abortCurrentRequest() {
  if (_abortController) { _abortController.abort(); _abortController = null; }
}

function newAbortSignal() {
  _abortController = new AbortController();
  return _abortController.signal;
}

// ═══════════════════════════════════════════
//  UNIFIED STREAM DISPATCHER
// ═══════════════════════════════════════════

/**
 * Unified streaming entry point. Dispatches to the correct provider.
 * @param {object} opts - { provider, url, apiKey, model, systemPrompt, messages, maxTokens }
 * @param {function} onChunk - called with StreamChunk: { type, data }
 * @returns {Promise<{text: string, tokens: number|null}>}
 */
async function streamChat(opts, onChunk) {
  function emit(type, data) { if (onChunk) onChunk({ type, data }); }

  const provider = opts.provider;
  emit('activity', `Connecting to ${provider}...`);

  let result;
  if (provider === 'gemini') {
    result = await callGeminiStream(opts, text => emit('token', text));
  } else if (provider === 'anthropic') {
    result = await callAnthropicStream(opts, text => emit('token', text));
  } else if (provider === 'openai' || provider === 'openrouter') {
    result = await callOpenAIStream(opts, text => emit('token', text));
  } else {
    // ollama-local or ollama-cloud
    result = await callOllamaStream(opts, text => emit('token', text));
  }

  emit('done', result);
  return result;
}

// ═══════════════════════════════════════════
//  GEMINI
// ═══════════════════════════════════════════

async function callGeminiStream(opts, onToken) {
  if (!opts.apiKey) throw new Error('Gemini API key required. Open Settings to add it.\n\nGet one free at: https://aistudio.google.com');
  const signal = newAbortSignal();

  // Key goes in URL query param — no Authorization header needed
  const res = await fetch(`/proxy/gemini/v1beta/models/${opts.model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(opts.apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: opts.systemPrompt }] },
      generationConfig: { maxOutputTokens: opts.maxTokens || 64000 },
      contents: opts.messages.map(m => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.content }]
      }))
    }),
    signal
  });

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Gemini Error: ${parseApiErr(t, res.status)}`);
  }

  return readSSE(res, line => {
    const j = JSON.parse(line);
    const part = j.candidates?.[0]?.content?.parts?.[0]?.text || '';
    let tokens = null;
    if (j.usageMetadata?.totalTokenCount) tokens = j.usageMetadata.totalTokenCount;
    return { text: part, tokens };
  }, onToken);
}

// ═══════════════════════════════════════════
//  ANTHROPIC (Claude)
// ═══════════════════════════════════════════

async function callAnthropicStream(opts, onToken) {
  if (!opts.apiKey) throw new Error('Anthropic API key required. Open Settings to add it.\n\nGet one at: https://console.anthropic.com');
  const signal = newAbortSignal();

  const apiMessages = opts.messages.map(m => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: m.content
  }));

  // Server detects api.anthropic.com and converts Authorization: Bearer → x-api-key
  const res = await fetch('/proxy/anthropic/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${opts.apiKey}`
    },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: opts.maxTokens || 16000,
      system: opts.systemPrompt,
      stream: true,
      messages: apiMessages
    }),
    signal
  });

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Anthropic Error: ${parseApiErr(t, res.status)}`);
  }

  return readSSE(res, line => {
    const j = JSON.parse(line);
    if (j.type === 'content_block_delta') {
      return { text: j.delta?.text || '', tokens: null };
    }
    if (j.type === 'message_delta' && j.usage) {
      return { text: '', tokens: j.usage.output_tokens };
    }
    return { text: '', tokens: null };
  }, onToken);
}

// ═══════════════════════════════════════════
//  OPENAI / OPENROUTER
// ═══════════════════════════════════════════

async function callOpenAIStream(opts, onToken) {
  if (!opts.apiKey) throw new Error('OpenAI API key required. Open Settings to add it.');
  const signal = newAbortSignal();
  const baseRoute = opts.provider === 'openrouter' ? '/proxy/openrouter' : '/proxy/openai';

  const res = await fetch(`${baseRoute}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${opts.apiKey}`
    },
    body: JSON.stringify({
      model: opts.model,
      stream: true,
      max_tokens: opts.maxTokens || 16000,
      messages: [{ role: 'system', content: opts.systemPrompt }, ...opts.messages]
    }),
    signal
  });

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`OpenAI Error: ${parseApiErr(t, res.status)}`);
  }

  return readSSE(res, line => {
    if (line === '[DONE]') return null;
    const j = JSON.parse(line);
    const delta = j.choices?.[0]?.delta?.content || '';
    let tokens = null;
    if (j.usage) tokens = j.usage.total_tokens;
    return { text: delta, tokens };
  }, onToken);
}

// ═══════════════════════════════════════════
//  OLLAMA (Cloud + Local)
// ═══════════════════════════════════════════

async function callOllamaStream(opts, onToken) {
  const isCloud = opts.provider === 'ollama-cloud';

  if (isCloud) {
    if (!opts.apiKey) throw new Error('Ollama Cloud API key required. Open Settings.\n\nGet one at: https://ollama.com/settings/keys');
    // Cloud uses OpenAI-compatible /v1/chat/completions endpoint
    return callOllamaCloudStream(opts, onToken);
  } else {
    // Local: call localhost directly (server can't reach user's machine)
    // Requires Ollama to be started with: OLLAMA_ORIGINS="*" ollama serve
    const base = (opts.url || 'http://localhost:11434').replace(/\/$/, '');
    return callOllamaNative(base, {
      'Content-Type': 'application/json'
    }, opts, onToken);
  }
}

async function callOllamaCloudStream(opts, onToken) {
  const signal = newAbortSignal();
  const res = await fetch('/proxy/ollama/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${opts.apiKey}`
    },
    body: JSON.stringify({
      model: opts.model,
      stream: true,
      max_tokens: opts.maxTokens || 64000,
      messages: [{ role: 'system', content: opts.systemPrompt }, ...opts.messages]
    }),
    signal
  });

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    if (res.status === 401) throw new Error('401 Unauthorized — Invalid Ollama Cloud API key.\n\nGet a new key at: https://ollama.com/settings/keys');
    if (res.status === 403) throw new Error('403 Forbidden — Ollama Cloud API key was rejected.\n\nCheck your key at: https://ollama.com/settings/keys');
    throw new Error(parseApiErr(t, res.status));
  }

  return readSSE(res, line => {
    if (line === '[DONE]') return null;
    const j = JSON.parse(line);
    const delta = j.choices?.[0]?.delta?.content || '';
    return { text: delta, tokens: j.usage?.total_tokens || null };
  }, onToken);
}

async function callOllamaNative(baseUrl, headers, opts, onToken) {
  const signal = newAbortSignal();
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST', headers,
    body: JSON.stringify({
      model: opts.model, stream: true,
      options: { num_predict: opts.maxTokens || 64000 },
      messages: [{ role: 'system', content: opts.systemPrompt }, ...opts.messages]
    }),
    signal
  });

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    if (res.status === 403) throw new Error('403 Forbidden — Ollama API key was rejected.\n\nCheck your key at: https://ollama.com/settings/keys');
    if (res.status === 401) throw new Error('401 Unauthorized — Invalid API key.\n\nGet a new key at: https://ollama.com/settings/keys');
    throw new Error(parseApiErr(t, res.status));
  }

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
        if (content) { text += content; if (onToken) onToken(content); }
        if (j.eval_count) tokens = j.eval_count;
      } catch { /* skip malformed */ }
    }
  }
  return { text, tokens };
}

// ═══════════════════════════════════════════
//  SSE READER (shared)
// ═══════════════════════════════════════════

async function readSSE(res, parseLine, onToken) {
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
      if (!data) continue;
      try {
        const result = parseLine(data);
        if (!result) continue;
        if (result.text) { text += result.text; if (onToken) onToken(result.text); }
        if (result.tokens) tokens = result.tokens;
      } catch { /* skip malformed SSE */ }
    }
  }
  return { text, tokens };
}

// ═══════════════════════════════════════════
//  FETCH MODELS
// ═══════════════════════════════════════════

async function fetchAvailableModels(provider, apiKey, url) {
  if (provider === 'gemini') {
    return [
      'gemini-2.5-flash-preview-04-17',
      'gemini-2.5-pro-preview-05-06',
      'gemini-2.0-flash',
      'gemini-2.0-flash-exp',
      'gemini-1.5-pro',
      'gemini-1.5-flash'
    ];
  }
  if (provider === 'anthropic') {
    return [
      'claude-opus-4-5',
      'claude-sonnet-4-5',
      'claude-haiku-4-5',
      'claude-3-7-sonnet-20250219',
      'claude-3-5-haiku-20241022'
    ];
  }
  if (provider === 'openai') {
    return ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o4-mini', 'o3-mini', 'o1-mini'];
  }
  if (provider === 'openrouter') {
    try {
      const res = await fetch('/proxy/openrouter/api/v1/models', {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      return (data.data || []).map(m => m.id).filter(Boolean).slice(0, 60);
    } catch {
      return ['anthropic/claude-3.5-sonnet', 'openai/gpt-4o', 'google/gemini-flash-1.5'];
    }
  }
  if (provider === 'ollama-cloud') {
    try {
      const res = await fetch('/proxy/ollama/v1/models', {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      // OpenAI-compatible format: { data: [{ id: "model-name" }] }
      // Also handle native format: { models: [{ name: "model-name" }] }
      const models = data.data || data.models || [];
      return models.map(m => m.id || m.name).filter(Boolean);
    } catch { return []; }
  }
  // ollama-local — call localhost directly (tags fetch is same-machine, no CORS issue in settings)
  try {
    const base = (url || 'http://localhost:11434').replace(/\/$/, '');
    const res = await fetch(`${base}/api/tags`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    return (data.models || []).map(m => m.name).filter(Boolean);
  } catch { return []; }
}

// ═══════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════

function parseApiErr(text, status) {
  try {
    const j = JSON.parse(text);
    return j.error?.message || j.message || j.error || `HTTP ${status}`;
  } catch {
    return `HTTP ${status}`;
  }
}

console.log('✦ api.js loaded');
