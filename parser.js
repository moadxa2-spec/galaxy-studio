// ═══════════════════════════════════════════
//  Galaxy Studio — parser.js
//  File extraction & content cleaning
// ═══════════════════════════════════════════

/**
 * Strip <think>...</think> blocks from AI output (DeepSeek-R1, etc.)
 * Also strips text before first ===FILE: if present.
 */
function stripThinkingBlocks(text) {
  // Remove <think>...</think> blocks
  let cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
  // Remove everything before the first ===FILE: marker if present
  const firstFile = cleaned.indexOf('===FILE:');
  if (firstFile > 0) {
    // Only strip if the content before is non-code (explanatory text)
    const before = cleaned.slice(0, firstFile).trim();
    if (!before.includes('<!DOCTYPE') && !before.includes('<html')) {
      cleaned = cleaned.slice(firstFile);
    }
  }
  return cleaned.trim();
}

/**
 * Clean file content — strips markdown fences and post-file commentary.
 * Adopted from Gemma Chat's cleanFileContent.
 */
function cleanFileContent(raw, filePath) {
  let s = raw;

  // Case 1: fully wrapped in ```lang ... ```
  const full = s.trim().match(/^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```[\s\S]*$/);
  if (full) {
    s = full[1];
  } else {
    // Case 2: just a leading fence ```lang\n
    const lead = s.match(/^\s*```[a-zA-Z0-9_-]*\n/);
    if (lead) {
      s = s.slice(lead[0].length);
      const trail = s.search(/\n```(?:\s|$)/);
      if (trail >= 0) s = s.slice(0, trail);
    }
  }

  // Case 3: file-type-aware truncation of post-file commentary
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.html') || lower.endsWith('.htm')) {
    const end = s.toLowerCase().lastIndexOf('</html>');
    if (end >= 0) s = s.slice(0, end + '</html>'.length) + '\n';
  } else if (lower.endsWith('.svg')) {
    const end = s.toLowerCase().lastIndexOf('</svg>');
    if (end >= 0) s = s.slice(0, end + '</svg>'.length) + '\n';
  } else if (lower.endsWith('.json')) {
    const trimmed = s.trim();
    const lastBrace = Math.max(trimmed.lastIndexOf('}'), trimmed.lastIndexOf(']'));
    if (lastBrace >= 0) s = trimmed.slice(0, lastBrace + 1) + '\n';
  }

  return s;
}

/**
 * Normalize a file path from AI output.
 * Strips leading ./ and normalizes separators.
 */
function normalizePath(p) {
  return p.trim()
    .replace(/^\.\//, '')       // strip leading ./
    .replace(/\\/g, '/')        // normalize backslashes
    .replace(/\/+/g, '/')       // collapse double slashes
    .replace(/^\//, '');         // strip leading /
}

// ═══════════ FILE PARSING ═══════════

function parseMultiFile(text) {
  const files = {};
  const parts = text.split(/^===FILE:\s*(.+?)===$/gm);
  if (parts.length >= 3) {
    for (let i = 1; i < parts.length; i += 2) {
      const name = normalizePath(parts[i]);
      const content = (parts[i + 1] || '').trim();
      if (name && content) files[name] = cleanFileContent(content, name);
    }
  }
  return files;
}

function extractFromCodeFences(text) {
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
      cleaned = cleaned.replace('</body>', '  <script src="app.js"><\/script>\n</body>');
    }
    files['app.js'] = jsContent.trim();
  }

  files['index.html'] = cleaned.trim();
  return files;
}

function extractProject(text) {
  // Pre-process: strip thinking blocks
  const cleaned = stripThinkingBlocks(text);

  // 1. Try ===FILE: format first (ideal)
  if (cleaned.includes('===FILE:')) {
    const files = parseMultiFile(cleaned);
    if (Object.keys(files).length > 0) return files;
  }

  // 2. Try markdown code fences with language hints
  const fenceFiles = extractFromCodeFences(cleaned);
  if (Object.keys(fenceFiles).length >= 2) return fenceFiles;

  // 3. Fallback: extract raw HTML and split inline styles/scripts out
  let html = cleaned;
  const fm = cleaned.match(/```html\s*([\s\S]*?)```/);
  if (fm) html = fm[1].trim();
  else {
    const fm2 = cleaned.match(/```\s*(<!DOCTYPE[\s\S]*?)```/i);
    if (fm2) html = fm2[1].trim();
    else {
      const t = cleaned.trim();
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

  return splitInlineHTML(html);
}

console.log('✦ parser.js loaded');
