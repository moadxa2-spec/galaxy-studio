// ═══════════════════════════════════════════
//  Galaxy Studio — tools.js
//  Agent tool system (inspired by Gemma Chat)
// ═══════════════════════════════════════════

const MAX_AGENT_ROUNDS = 15;

/**
 * Tool definitions. Each tool operates on the in-memory currentFiles object.
 * Tools are called by the AI via XML <action> tags.
 */
const TOOLS = {
  write_file: {
    name: 'write_file',
    description: 'Create or overwrite a file. Use this to generate code, HTML, CSS, JSON, etc.',
    params: [
      { name: 'path', description: 'file path (e.g. index.html)', required: true },
      { name: 'content', description: 'full file text', required: true, multiline: true }
    ],
    example: '<action name="write_file">\n<path>index.html</path>\n<content>\n<!doctype html>\n<html><body>Hello</body></html>\n</content>\n</action>',
    run(args, ctx) {
      const p = normalizePath(String(args.path || '').trim());
      const raw = typeof args.content === 'string' ? args.content : '';
      if (!p) return 'Error: missing <path>';
      const content = cleanFileContent(raw, p);
      ctx.files[p] = content;
      const lines = content.split('\n').length;
      if (ctx.onFileWrite) ctx.onFileWrite(p, content, false);
      return `Wrote ${p} (${content.length} bytes, ${lines} lines).`;
    }
  },

  edit_file: {
    name: 'edit_file',
    description: 'Replace a snippet in an existing file. old_string must match exactly.',
    params: [
      { name: 'path', description: 'file path', required: true },
      { name: 'old_string', description: 'exact text to find', required: true, multiline: true },
      { name: 'new_string', description: 'replacement text', required: true, multiline: true }
    ],
    example: '<action name="edit_file">\n<path>index.html</path>\n<old_string>Hello</old_string>\n<new_string>Hello World</new_string>\n</action>',
    run(args, ctx) {
      const p = normalizePath(String(args.path || '').trim());
      const oldStr = typeof args.old_string === 'string' ? args.old_string : '';
      const newStr = typeof args.new_string === 'string' ? args.new_string : '';
      if (!p) return 'Error: missing <path>';
      if (!oldStr) return 'Error: missing <old_string>';
      if (!ctx.files[p]) return `Error: file "${p}" not found. Use write_file to create it first.`;
      
      const content = ctx.files[p];
      const idx = content.indexOf(oldStr);
      if (idx < 0) return `Error: old_string not found in ${p}. Make sure it matches exactly.`;
      
      ctx.files[p] = content.slice(0, idx) + newStr + content.slice(idx + oldStr.length);
      if (ctx.onFileWrite) ctx.onFileWrite(p, ctx.files[p], false);
      return `Edited ${p} (1 replacement).`;
    }
  },

  read_file: {
    name: 'read_file',
    description: 'Read a file from the project.',
    params: [
      { name: 'path', description: 'file path', required: true }
    ],
    example: '<action name="read_file">\n<path>index.html</path>\n</action>',
    run(args, ctx) {
      const p = normalizePath(String(args.path || '').trim());
      if (!p) return 'Error: missing <path>';
      if (!ctx.files[p]) return `Error: file "${p}" not found. Available files: ${Object.keys(ctx.files).join(', ') || '(none)'}`;
      const content = ctx.files[p];
      if (content.length > 20000) return content.slice(0, 20000) + '\n[…truncated]';
      return content;
    }
  },

  list_files: {
    name: 'list_files',
    description: 'List all files in the project.',
    params: [],
    example: '<action name="list_files"></action>',
    run(_args, ctx) {
      const names = Object.keys(ctx.files);
      if (names.length === 0) return '(project is empty)';
      return names.map(n => {
        const lines = ctx.files[n].split('\n').length;
        const size = ctx.files[n].length;
        return `${n} (${size}B, ${lines} lines)`;
      }).join('\n');
    }
  },

  delete_file: {
    name: 'delete_file',
    description: 'Delete a file from the project.',
    params: [
      { name: 'path', description: 'file path', required: true }
    ],
    example: '<action name="delete_file">\n<path>old.html</path>\n</action>',
    run(args, ctx) {
      const p = normalizePath(String(args.path || '').trim());
      if (!p) return 'Error: missing <path>';
      if (!ctx.files[p]) return `Error: file "${p}" not found.`;
      delete ctx.files[p];
      return `Deleted ${p}.`;
    }
  }
};

// ═══════════ XML ACTION PARSING (from Gemma Chat) ═══════════

/**
 * Find the next <action> tag in the buffer starting from `from`.
 * Returns:
 *  - ParsedAction object if a complete action is found
 *  - 'incomplete' if an action is started but not closed
 *  - null if no action found
 */
function findNextAction(text, from) {
  const openRe = /<action\s+name\s*=\s*["']?([a-zA-Z_][\w]*)["']?\s*>/gi;
  openRe.lastIndex = from || 0;
  const open = openRe.exec(text);
  if (!open) return null;

  const name = open[1];
  const bodyStart = open.index + open[0].length;
  const closeMatch = text.slice(bodyStart).match(/<\/action\s*>/i);
  if (!closeMatch || closeMatch.index === undefined) return 'incomplete';

  const closeIdx = bodyStart + closeMatch.index;
  const body = text.slice(bodyStart, closeIdx);
  const args = parseActionBody(body);

  return {
    name,
    args,
    raw: text.slice(open.index, closeIdx + closeMatch[0].length),
    start: open.index,
    end: closeIdx + closeMatch[0].length
  };
}

/**
 * Parse the body of an <action> tag to extract parameters.
 * Handles <content>...</content> specially (uses last </content> to survive nesting).
 */
function parseActionBody(body) {
  const args = {};

  // Special-case <content>…</content> — use the LAST </content> to survive nested close-tags
  const contentOpen = body.indexOf('<content>');
  let outside = body;
  if (contentOpen >= 0) {
    const contentCloseRel = body.lastIndexOf('</content>');
    if (contentCloseRel > contentOpen) {
      let content = body.slice(contentOpen + '<content>'.length, contentCloseRel);
      content = content.replace(/^\n/, '');
      content = content.replace(/\n[ \t]*$/, '');
      args.content = content;
      outside = body.slice(0, contentOpen) + body.slice(contentCloseRel + '</content>'.length);
    }
  }

  const tagRe = /<([a-zA-Z_][\w-]*)>([\s\S]*?)<\/\1>/g;
  let m;
  while ((m = tagRe.exec(outside)) !== null) {
    const key = m[1];
    if (key === 'content') continue;
    const raw = m[2];
    const trimmed = raw.trim();
    if (trimmed === 'true') args[key] = true;
    else if (trimmed === 'false') args[key] = false;
    else if (/^-?\d+$/.test(trimmed)) args[key] = Number(trimmed);
    else args[key] = raw.replace(/^\n/, '').replace(/\n[ \t]*$/, '');
  }
  return args;
}

/**
 * Return the largest safe index to emit text up to,
 * ensuring we don't cut into a forming <action tag.
 */
function emitSafeBoundary(buffer, from) {
  for (let i = buffer.length - 1; i >= from; i--) {
    if (buffer[i] !== '<') continue;
    const tail = buffer.slice(i).toLowerCase();
    if (tail.length < 8) {
      if ('<action'.startsWith(tail)) return i;
      continue;
    }
    if (tail.startsWith('<action') && /\s/.test(tail[7])) return i;
  }
  return buffer.length;
}

/**
 * Build the tool-help section for the system prompt.
 */
function renderToolHelp() {
  const lines = [];
  for (const t of Object.values(TOOLS)) {
    lines.push(`### ${t.name}`);
    lines.push(t.description);
    if (t.params.length) {
      lines.push('Parameters:');
      for (const p of t.params) {
        const req = p.required ? ' (required)' : '';
        const multi = p.multiline ? ' — multi-line OK' : '';
        lines.push(`  <${p.name}>: ${p.description}${req}${multi}`);
      }
    } else {
      lines.push('No parameters.');
    }
    lines.push('Example:');
    lines.push(t.example);
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * Execute a tool by name with the given args and context.
 */
function runTool(name, args, ctx) {
  const tool = TOOLS[name];
  if (!tool) return `Error: unknown tool "${name}". Available: ${Object.keys(TOOLS).join(', ')}`;
  try {
    return tool.run(args, ctx);
  } catch (e) {
    return `Error running ${name}: ${e.message}`;
  }
}

console.log('✦ tools.js loaded');
