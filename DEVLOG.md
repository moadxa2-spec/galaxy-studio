# Galaxy Studio — Development Log

> Full conversation history of building Galaxy Studio from a prototype single-file HTML builder into a professional multi-file AI-powered development environment.

---

## Session Overview

- **Date**: May 6–7, 2026
- **Project**: Galaxy Studio (AI App Builder)
- **Stack**: Vanilla HTML/CSS/JS + Node.js proxy + Gemini/Ollama APIs
- **Location**: `c:\Users\Setup Game\Downloads\Galaxy studio\`

---

## Phase 1: Initial Assessment & Planning

### User Request
> "Give me a plan of what we should add next and what's the weak spots on the app."

### Identified Weak Spots
1. No planning phase — AI jumped straight to code without understanding the user's needs
2. Single HTML output — everything was dumped into one file
3. No skills/knowledge injection — AI had no best practices to follow
4. No version history — no way to go back
5. No project persistence — refreshing lost everything
6. Basic UI — no thinking indicators, no progress feedback

### Plan Created
- Add a 3-phase workflow: Planning → Building → Refining
- Add clarifying questions before building
- Add a plan approval step
- Add version history with navigation
- Add project persistence via localStorage
- Add thinking/timing indicators
- Add skills knowledge injection

**User approved all features.**

---

## Phase 2: Planning Workflow

### Changes Made
- Added `phase` state: `planning` → `building` → `refining`
- Created `PROMPT_PLANNING` — asks 3–4 clarifying questions
- Created `PROMPT_CREATE_PLAN` — generates structured plan
- Created `PROMPT_BUILD` — builds from approved plan
- Created `PROMPT_REFINE` — modifies existing code
- Added clickable question chips with options
- Added plan card UI with "Approve & Build" button
- Added thinking timer showing elapsed time
- Added phase badge in the UI header

### Files Modified
- `app.js` — All prompt/phase/workflow logic
- `styles.css` — Question chips, plan cards, phase badges
- `index.html` — Phase badge container

---

## Phase 3: Multi-File Architecture

### User Request
> "The studio should not just create the HTML file — it should create other files that the app needs like PHP, Python, and other types. Should be tabs, every code in its file and in its tab."

### Changes Made

#### File Parsing (`parseMultiFile`)
- Regex-based parser for `===FILE: filename.ext===` markers
- Allows AI to output distinct files (index.html, styles.css, app.js, api.php, etc.)

#### Tabbed Code Panel
- File tabs with language-appropriate icons (🌐 HTML, 🎨 CSS, ⚡ JS, 🐘 PHP, 🐍 Python, etc.)
- Tab switching updates the code display with correct syntax highlighting
- Line count shown per file tab

#### Preview Aggregation
- `updatePreview()` programmatically combines files:
  - CSS files → injected as `<style>` blocks
  - JS files → injected as `<script>` blocks
  - All merged into the HTML for live preview

#### ZIP Export
- Integrated JSZip for multi-file download
- Files stored at ZIP root (not in subfolder) for direct use
- Download button renamed from "Download HTML" → "Download Project"

### Dependencies Added
- `JSZip` CDN for ZIP bundling
- Expanded PrismJS languages: HTML, CSS, JS, Python, PHP, JSON, Bash
- Added `prism-markup-templating.min.js` (required by PHP highlighting)

---

## Phase 4: Skills Integration

### User Request
> "I added a folder called skills — look at it. It contains all the skills that the studio needs for every task."

### Changes Made
- Read the skills library structure
- Extracted key best practices and injected into `SKILLS_KNOWLEDGE`:
  - Semantic HTML5
  - Accessibility (ARIA, keyboard nav, contrast)
  - Responsive design (mobile-first, flexbox/grid)
  - Typography (Google Fonts)
  - Color palettes (HSL, CSS custom properties)
  - Performance (lazy loading, CSS transitions)
  - Security (input sanitization, CSP patterns)
  - Modern CSS (gradients, backdrop-filter, micro-animations)

---

## Phase 5: Extension Support & Bug Fixes

### Bug: PrismJS Crash
- **Error**: `Cannot read properties of undefined (reading 'tokenizePlaceholders')`
- **Cause**: `prism-php.min.js` requires `prism-markup-templating.min.js` loaded first
- **Fix**: Added the missing CDN dependency + created `safeHighlight()` wrapper with try-catch

### Bug: Extensions Not Loading
- **Error**: "Impossible de charger le script d'arrière-plan" (Can't load background script)
- **Cause**: AI generated Manifest V2 (`background.scripts`) instead of V3 (`background.service_worker`)
- **Fix**: Added Chrome Extension Manifest V3 rules to the skills knowledge

### Bug: ZIP Folder Nesting
- **Cause**: Files were inside a subfolder in the ZIP → Chrome couldn't find `manifest.json`
- **Fix**: Changed ZIP to put files at root level

---

## Phase 6: Smart Skills System

### User Request
> "The AI should fetch and search for the skill based on the request."

### Changes Made

#### Skills Index (`skills-index.json`)
Created a searchable JSON index with 8 skill domains:

| Domain | Keywords |
|--------|----------|
| `web-frontend` | website, landing page, dashboard, portfolio |
| `web-fullstack` | api, backend, server, database, authentication |
| `chrome-extension` | extension, chrome, manifest, popup |
| `python` | python, flask, django, pip |
| `php` | php, wordpress, laravel, mysql |
| `mobile-app` | mobile, pwa, react native, flutter |
| `game` | game, canvas, sprite, physics |
| `ecommerce` | shop, cart, checkout, payment |

#### Skill Matching (`matchSkills()`)
- Scans conversation text against all skill keyword lists
- Ranks by relevance (most keyword hits first)
- Injects top 3 matching skills into the system prompt
- Falls back to web-frontend if no matches

#### Dynamic Token Estimation (`estimateTokens()`)
- Simple landing page → 32K tokens
- Extension/dashboard/game → 64K tokens
- Complex full application → 100K tokens
- Default → 64K tokens

---

## Phase 7: File Explorer Sidebar

### User Request
> "Add a left sidebar file explorer with folders and files in a tree structure in code tab."

### Changes Made

#### HTML Structure
```html
<div class="code-layout">
  <div class="file-explorer">
    <div class="explorer-header">📁 EXPLORER</div>
    <div class="explorer-tree"></div>
  </div>
  <div class="code-main">
    <div class="file-tabs"></div>
    <div class="code-view">...</div>
  </div>
</div>
```

#### CSS Styles
- VS Code-style left sidebar (180px wide)
- File items with icon, name, line count
- Active file highlighted with accent glow
- Scrollable tree view
- Responsive layout with `min-width: 0` on code-main

#### JavaScript
- `updateCodeDisplay()` now renders both explorer tree AND file tabs
- Clicking a file in the explorer activates it in both views
- Empty state shows "No files yet" message

---

## Phase 8: Critical Bug Fixes

### Bug: Syntax Error (line 553)
- **Error**: `Uncaught SyntaxError: Unexpected token '==='`
- **Cause**: `</script>` inside template literals caused the HTML parser to close the `<script>` tag early
- **Fix**: Escaped all instances as `<\/script>` in template strings

### Bug: Ollama Cloud 403 Forbidden
- **Error**: `Failed to load resource: 403`
- **Cause**: Ollama Cloud rejects the OpenAI-compatible `/v1/chat/completions` endpoint
- **Fix**: Split into two API paths:
  - **Cloud** → Native `/api/chat` (NDJSON streaming)
  - **Local** → OpenAI `/v1/chat/completions` (SSE streaming)
- Added specific error messages for 403/401 with links to key management

### Bug: Fetch Models Reads Stale Config
- **Cause**: `fetchModels()` read from `cfg` object instead of live input values
- **Fix**: Now reads directly from form inputs and auto-saves on success

### Fix: iframe Sandbox Warning
- **Warning**: "iframe with allow-scripts and allow-same-origin can escape sandboxing"
- **Fix**: Removed `allow-same-origin`, added `allow-popups`

### Fix: Password Field Warning
- **Warning**: "Password field not contained in a form"
- **Fix**: Wrapped settings inputs in `<form autocomplete="off">`

---

## Phase 9: 3-Layer File Extraction

### Problem
AI sometimes ignores the `===FILE:` format and outputs:
- Single HTML with inline CSS/JS
- Markdown code fences per language
- Mixed formats

### Solution: `extractProject()` with 3 fallback layers

```
Layer 1: ===FILE: markers (ideal)
       ↓ fallback
Layer 2: Markdown code fences (```html, ```css, ```js)
       ↓ fallback
Layer 3: Auto-split inline HTML:
         • <style> blocks → styles.css
         • <script> blocks → app.js
         • Clean HTML → index.html
```

### Functions Added
- `parseMultiFile()` — parses `===FILE:` markers
- `extractFromCodeFences()` — parses markdown fences
- `splitInlineHTML()` — extracts `<style>` and `<script>` from monolithic HTML

---

## File Structure

```
Galaxy studio/
├── index.html          # Main app shell
├── styles.css          # All styles (dark/light theme, explorer, tabs)
├── app.js              # Core logic (1400+ lines)
├── proxy.js            # Node.js proxy server (Ollama + Gemini)
├── skills-index.json   # Searchable skill domains for AI
├── DEVLOG.md           # This file
└── skills/             # Skills library (agents, engineering, etc.)
    ├── GEMINI.md
    ├── agents/
    ├── engineering/
    ├── engineering-team/
    └── ...
```

---

## Running the App

```bash
# Start the server
node proxy.js

# Open in browser
http://localhost:8000
```

### Requirements
- Node.js (any recent version)
- An API key for either:
  - **Gemini API** — from Google AI Studio
  - **Ollama Cloud** — from ollama.com/settings/keys
  - **Local Ollama** — running at localhost:11434

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  Browser (index.html)            │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │ Chat     │  │ Preview  │  │ Code          │  │
│  │ Panel    │  │ (iframe) │  │ Explorer+Tabs │  │
│  └────┬─────┘  └──────────┘  └───────────────┘  │
│       │                                          │
│  ┌────▼──────────────────────────────────────┐   │
│  │ app.js                                    │   │
│  │ • Phase management (plan→build→refine)    │   │
│  │ • Skills matching (skills-index.json)     │   │
│  │ • File extraction (3-layer parser)        │   │
│  │ • Preview aggregation (CSS+JS injection)  │   │
│  │ • ZIP bundling (JSZip)                    │   │
│  │ • Version history & persistence           │   │
│  └────┬──────────────────────────────────────┘   │
│       │                                          │
└───────┼──────────────────────────────────────────┘
        │ fetch()
┌───────▼──────────────────────────────────────────┐
│ proxy.js (Node.js :8000)                         │
│ • /proxy/ollama/*  → https://ollama.com/*        │
│ • /proxy/gemini/*  → googleapis.com/*            │
│ • Static file server                             │
└──────────────────────────────────────────────────┘
```

---

## Key Design Decisions

1. **No framework** — Pure vanilla HTML/CSS/JS for zero dependencies and instant loading
2. **Proxy server** — Avoids CORS issues and keeps API keys off the client
3. **3-layer extraction** — Handles any AI output format gracefully
4. **Skills matching** — AI gets relevant knowledge without overwhelming the context
5. **Dynamic tokens** — Simple projects get less, complex ones get more
6. **Flat ZIP** — Files at root for direct use (especially important for Chrome extensions)
7. **Native Ollama API for Cloud** — The OpenAI-compatible endpoint has auth issues on cloud

---

## Known Issues & Future Work

### Known Issues
- Some Ollama Cloud models may still return 403 if the model isn't available in the user's region
- Very large projects may hit token limits even with 100K estimation

### Future Improvements
1. **Agentic routing** — Auto-detect the best model/persona based on project type
2. **File-level refinement** — Update only the changed file instead of regenerating all files
3. **Drag & drop** — Upload existing files to modify
4. **Electron wrapper** — For local file system access
5. **Git integration** — Track changes with real version control
6. **Collaborative editing** — Multiple users on the same project
7. **Template library** — Pre-built starter templates for common project types

---

*Generated by Antigravity Studio — May 7, 2026*
