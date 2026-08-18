# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Auto Login Helper** — a Chrome Extension (Manifest V3) that auto-fills login forms on configured sites. Users define site configs (URL + credentials + CSS selectors) in the popup; when a matching URL loads, the content script fills the username/password, optionally checks an agreement box, and clicks login.

Vanilla HTML/CSS/JavaScript. **No build step, no bundler, no TypeScript, no framework.**

## Commands

There is **no build, lint, or test step**. The extension is loaded directly into Chrome from source.

- Install dev deps (only `sharp` is declared, used for icon processing — not required for extension runtime): `pnpm install`
- Load extension: open `chrome://extensions/`, enable "Developer mode", click "Load unpacked", select this folder.
- Reload after edits: click the refresh icon on the extension card in `chrome://extensions/`.
- Debug:
  - Service worker logs: `chrome://extensions/` → "Service worker" link.
  - Content script logs: DevTools on the target page (filter by `[Auto Login]`).
  - Popup logs: right-click the popup icon → "Inspect".

## Architecture

Three scripts collaborate via `chrome.runtime.sendMessage` and shared `chrome.storage.local` state.

### `manifest.json` (Manifest V3)
- Permissions: `storage`, `activeTab`, `scripting`.
- `content_scripts` match `<all_urls>`, run at `document_idle`, injecting only `content.js`.
- `background.service_worker` is `background.js` (not a background page).

### `background.js` — Service Worker
Stateless coordinator. Holds one piece of in-memory state: `pendingPick = { field, tabId }`.

Responsibilities:
- `chrome.tabs.onUpdated` → broadcast `URL_CHANGED` to the tab's content script when status becomes `complete`.
- Routes messages: `GET_CURRENT_TAB_URL`, `REINJECT_CONTENT_SCRIPT`, `START_PICK`, `SELECTOR_PICKED`, `PICK_CANCELLED`, `CANCEL_PICK`.
- For `START_PICK`: tries `chrome.tabs.sendMessage` first; if the content script isn't injected, falls back to `chrome.scripting.executeScript` then retries with a 200ms delay.
- Stores picked selectors in `pickedResults` keyed by field name, then broadcasts to popup.
- `chrome.runtime.onInstalled` initializes `sites = []` in storage if missing.

### `content.js` — Injected into every page
Wrapped in an IIFE with `'use strict'`. Uses ES5 style (`var`, `function` declarations) throughout.

Three major subsystems in one file:
1. **Picker mode** (`startPickerMode`): adds a hover overlay, tooltip, and banner. `generateSelector(element)` produces a selector by trying ID → `name` attribute → common data/aria attrs → filtered class chain → path with `:nth-child` fallbacks. Click or ESC ends the mode and posts `SELECTOR_PICKED` / `PICK_CANCELLED` to background.
2. **Draggable dialog** (`createDragDialog` / `showDragDialog`): an alternative to the popup for adding sites directly on-page. Built with inline `style.cssText`. Triggered by `OPEN_SIDE_PANEL` message from popup. Saves the resulting site directly to `chrome.storage.local`.
3. **Auto-login** (`autoLogin` + `init`): on load, iterates `sites`, finds one matching the current URL via `urlMatches`, then waits for each element with `waitForElement` (uses `MutationObserver`, default 10s timeout), fills via `simulateInput` (calls native `HTMLInputElement.prototype.value` setter to trigger React/Vue/Angular reactivity), and dispatches a real `MouseEvent` chain (`mousedown`/`mouseup`/`click`). Random 500–1500ms startup delay before acting.

Listens for messages: `START_PICKER`, `STOP_PICKER`, `OPEN_SIDE_PANEL`, `URL_CHANGED`, `SELECTOR_PICKED`, `PICK_CANCELLED`.

### `popup.html` + `popup.css` + `popup.js` — Extension popup
Fixed size 420×520. Uses modern JS (`const`, arrow functions, async/await).

- Renders site cards with favicon (Google's `s2/favicons` service), enable/disable toggle, edit, delete.
- Modal form for add/edit; separate confirm overlay for delete.
- "Side panel" button posts `OPEN_SIDE_PANEL` to the active tab (with the same content-script-not-injected fallback as background) and closes the popup.
- "测试当前页" button posts `REINJECT_CONTENT_SCRIPT` to manually re-trigger auto-login.
- Pick flow: each selector input has a "🎯" pick button → posts `START_PICK` to background → background coordinates with content script → popup reopens itself on click of extension icon and reads back `pickedResults` from storage to auto-fill the form (using `pendingPickUrl` to preserve the original URL across the reopen).
- Listens for `SELECTOR_PICKED` / `PICK_CANCELLED` to update the form and pick banner live.

### `index.html`
Static landing page with install instructions. Not part of the extension itself — just a user-facing download/install guide.

## Storage Schema (`chrome.storage.local`)

| Key | Shape | Owner |
|---|---|---|
| `sites` | `Array<Site>` | background (init), popup (CRUD), content (read on init) |
| `pickedResults` | `{ [field]: selector }` | background writes, popup reads |
| `pendingPickField` | `string` | popup sets, background clears |
| `pendingPickUrl` | `string` | background sets on pick start, popup reads |

**Site shape** (popup.js form data + content.js saveSiteFromDragDialog):
```
{ id, url, username, password, usernameSelector, passwordSelector,
  loginButtonSelector, agreementSelector, enabled, createdAt }
```

## URL Matching (`urlMatches` in content.js)

Both the pattern and the current URL are first stripped of query string and fragment (`?…`, `#…`), so `https://example.com/login` matches `https://example.com/login?redirect=/home`. Then tries, in order:
1. Exact equality.
2. Prefix (`currentUrl.startsWith(pattern)`).
3. Wildcard regex: `*` → `.*`, anchored with `^…$`, after escaping regex meta-characters in the pattern.

The popup's "网址" hint says wildcard works like `https://*.example.com/*` — keep this contract when changing the matcher.

## Conventions

- **No build/transpile.** Don't introduce a bundler, TS, JSX, or frameworks. If a dependency is needed, add it via `<script>` tag or document a manual include.
- **`'use strict'` at the top of every script.**
- **`popup.js` uses modern JS** (const/let, arrow fns, async/await, template literals). **`content.js` uses ES5 style** (var, function decls, `function(){}` callbacks). Match the local style when editing each file.
- **UI text is Chinese (zh-CN).** Don't translate existing strings to English; new user-facing strings should also be Chinese to stay consistent.
- **Inline styles** in `content.js` dialog DOM (set via `style.cssText` on injected elements). Don't extract to a CSS file — content scripts can't load extension stylesheets easily and inline keeps the dialog self-contained.
- **DOM IDs prefixed `__auto_login_picker_*` or `drag-*` / `auto-login-*`** for the content-script-injected UI. The picker mouseover handler ignores elements with IDs starting `__auto_login_picker` to avoid self-hover loops.
- **Console logging** uses the `[Auto Login]` prefix in content.js for easy filtering.
- **Storage I/O**: prefer the existing `chrome.storage.local.get/set/remove` patterns; do not introduce `chrome.storage.sync` (configs contain passwords).