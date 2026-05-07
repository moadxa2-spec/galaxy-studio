// ═══════════════════════════════════════════
//  Galaxy Studio — api.js
//  Streaming API calls with abort support
// ═══════════════════════════════════════════

let _abortController = null;

/**
 * Abort the current API request, if any.
 */
function abortCurrentRequest() {
  if (_abortController) {
    _abortController.abort();
    _abortController = null;
  }
}

/**
 * Create a fresh AbortController for the next request.
 */
function newAbortSignal() {
  _abortController = new AbortController();
  return _abortController.signal;
}

/**
 * Stream a Gemini API response.
 * @param {object} opts - { model, apiKey, systemPrompt, messages, maxTokens }
 * @param {function} onToken - called with each text chunk: onToken(text)
 * @returns {Promise<{text: string, tokens: number|null}>}
 */
async function callGeminiStream(opts, onToken) {
  if (!opts.apiKey) throw new Error('API Key required. Open Settings to add it.');
  const signal = newAbortSignal();

  const res = await fetch(`/proxy/gemini/v1beta/models/${opts.model}:streamGenerateContent?alt=sse&key=${opts.apiKey}`, {
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
        if (part) {
          text += part;
          if (onToken) onToken(part);
        }
        if (j.usageMetadata?.totalTokenCount) tokens = j.usageMetadata.totalTokenCount;
      } catch { /* skip malformed SSE chunks */ }
    }
  }
  return { text, tokens };
}

/**
 * Stream an Ollama API response (auto-detects cloud vs local).
 * @param {object} opts - { provider, url, apiKey, model, systemPrompt, messages, maxTokens }
 * @param {function} onToken - called with each text chunk
 * @returns {Promise<{text: string, tokens: number|null}>}
 */
async function callOllamaStream(opts, onToken) {
  const isCloud = opts.provider === 'ollama-cloud';
  const baseUrl = isCloud ? '/proxy/ollama' : opts.url.replace(/\/$/, '');
  const headers = { 'Content-Type': 'application/json' };
  if (isCloud) {
    if (!opts.apiKey) throw new Error('Ollama Cloud API key required. Open Settings to add it.\n\nGet one at: https://ollama.com/settings/keys');
    headers['Authorization'] = `Bearer ${opts.apiKey}`;
  }

  if (isCloud) {
    return callOllamaNative(baseUrl, headers, opts, onToken);
  } else {
    return callOllamaOpenAI(baseUrl, headers, opts, onToken);
  }
}

// ═══════════ NATIVE OLLAMA (/api/chat) ═══════════
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
    if (res.status === 403) throw new Error('403 Forbidden — Your Ollama API key was rejected.\n\n• Check your key at: https://ollama.com/settings/keys');
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
        if (content) {
          text += content;
          if (onToken) onToken(content);
        }
        if (j.eval_count) tokens = j.eval_count;
      } catch { /* skip malformed chunks */ }
    }
  }
  return { text, tokens };
}

// ═══════════ OPENAI-COMPATIBLE (/v1/chat/completions) ═══════════
async function callOllamaOpenAI(baseUrl, headers, opts, onToken) {
  const signal = newAbortSignal();
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST', headers,
    body: JSON.stringify({
      model: opts.model, stream: true, max_tokens: opts.maxTokens || 64000,
      messages: [{ role: 'system', content: opts.systemPrompt }, ...opts.messages]
    }),
    signal
  });

  if (!res.ok) {
    const t = await res.text().catch(() => '');
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
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') continue;
      try {
        const j = JSON.parse(data);
        const delta = j.choices?.[0]?.delta?.content || '';
        if (delta) {
          text += delta;
          if (onToken) onToken(delta);
        }
        if (j.usage) tokens = j.usage.total_tokens;
      } catch { /* skip malformed chunks */ }
    }
  }
  return { text, tokens };
}

function parseApiErr(text, status) {
  try {
    const j = JSON.parse(text);
    return j.error?.message || j.message || `HTTP ${status}`;
  } catch {
    return `HTTP ${status}`;
  }
}

console.log('✦ api.js loaded');
