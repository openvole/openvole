/** Inline HTML/CSS/JS for the dashboard — zero external dependencies */
export function getDashboardHtml(wsPort: number): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" type="image/x-icon" href="/favicon.ico">
<title>OpenVole Dashboard</title>
<style>
  :root {
    --bg: #0a0a0f;
    --surface: #12121a;
    --surface-hover: #181825;
    --border: #1e1e2e;
    --text: #c9d1d9;
    --text-dim: #6e7681;
    --accent: #58a6ff;
    --green: #3fb950;
    --red: #f85149;
    --yellow: #d29922;
    --orange: #db6d28;
    --mono: 'SF Mono', 'Fira Code', 'JetBrains Mono', monospace;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { height: 100%; overflow: hidden; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: var(--bg);
    color: var(--text);
    line-height: 1.5;
    display: flex;
    flex-direction: column;
  }
  header {
    border-bottom: 1px solid var(--border);
    padding: 12px 24px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
  }
  .logo-group {
    display: flex;
    align-items: center;
  }
  .logo-link {
    display: flex;
    align-items: center;
    gap: 12px;
    text-decoration: none;
    color: inherit;
  }
  .logo-link:hover h1 { opacity: 0.8; }
  .logo-group img {
    width: 32px;
    height: 32px;
    border-radius: 8px;
  }
  header h1 {
    font-size: 17px;
    font-weight: 600;
    letter-spacing: -0.02em;
  }
  header h1 span { color: var(--accent); }
  .header-right {
    display: flex;
    align-items: center;
    gap: 20px;
  }
  .stats {
    display: flex;
    gap: 16px;
    font-size: 12px;
    font-family: var(--mono);
    color: var(--text-dim);
  }
  .stat-val { color: var(--accent); font-weight: 600; }
  .stat-val.stat-green { color: var(--green); }
  .stat-val.stat-blue { color: var(--accent); }
  .stat-val.stat-yellow { color: var(--yellow); }
  .stat-val.stat-red { color: var(--red); }
  .stat-sep { color: var(--border); margin: 0 2px; }
  .btn-restart {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-dim);
    font-size: 11px;
    padding: 3px 10px;
    border-radius: 4px;
    cursor: pointer;
    font-family: var(--mono);
    transition: border-color 0.15s, color 0.15s;
  }
  .btn-restart:hover {
    border-color: var(--text-dim);
    color: var(--text);
  }
  .status {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--text-dim);
  }
  .status-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--red);
  }
  .status-dot.connected { background: var(--green); }

  /* Tab Navigation */
  .tab-bar {
    display: flex;
    gap: 0;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
    flex-shrink: 0;
    padding: 0 24px;
  }
  .tab-btn {
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--text-dim);
    font-size: 11px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 10px 16px 8px;
    cursor: pointer;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    transition: color 0.15s, border-color 0.15s;
  }
  .tab-btn:hover {
    color: var(--text);
  }
  .tab-btn.active {
    color: var(--accent);
    border-bottom-color: var(--accent);
  }
  .tab-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .main {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .grid {
    flex: 1;
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    grid-template-rows: 1fr 1fr;
    gap: 1px;
    background: var(--border);
    overflow: hidden;
  }
  .panel.span-2 {
    grid-column: span 2;
  }
  .panel {
    background: var(--surface);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .panel-header {
    padding: 12px 16px 8px;
    flex-shrink: 0;
  }
  .panel-header h2 {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-dim);
    font-weight: 500;
  }
  .panel-header h2 .count {
    color: var(--accent);
    font-family: var(--mono);
  }
  .panel-body {
    flex: 1;
    overflow-y: auto;
    padding: 0 16px 12px;
  }
  .panel-body::-webkit-scrollbar { width: 6px; }
  .panel-body::-webkit-scrollbar-track { background: var(--bg); }
  .panel-body::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }
  .panel-body::-webkit-scrollbar-thumb:hover { background: #555; }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  th {
    text-align: left;
    font-weight: 500;
    color: var(--text-dim);
    padding: 4px 8px 4px 0;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    position: sticky;
    top: 0;
    background: var(--surface);
    z-index: 1;
  }
  td {
    padding: 4px 8px 4px 0;
    font-family: var(--mono);
    font-size: 11px;
    border-top: 1px solid var(--border);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 200px;
  }
  .tag {
    display: inline-block;
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 10px;
    font-family: var(--mono);
  }
  .tag-green { background: #1b3a2a; color: var(--green); }
  .tag-red { background: #3a1b1b; color: var(--red); }
  .tag-yellow { background: #3a2e1b; color: var(--yellow); }
  .tag-blue { background: #1b2a3a; color: var(--accent); }
  .tag-orange { background: #3a2a1b; color: var(--orange); }
  .tag-purple { background: #2a1b3a; color: #c084fc; }
  .group-header td { border-top: 1px solid var(--border); padding: 8px 12px; background: var(--surface); }
  .events-bar {
    background: var(--surface);
    border-top: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    height: 200px;
    flex-shrink: 0;
  }
  .events-header {
    padding: 8px 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
  }
  .events-header h2 {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-dim);
    font-weight: 500;
  }
  .events-header button {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-dim);
    font-size: 10px;
    padding: 2px 8px;
    border-radius: 3px;
    cursor: pointer;
    font-family: var(--mono);
  }
  .events-header button:hover { border-color: var(--text-dim); }
  .events-body {
    flex: 1;
    overflow-y: auto;
    padding: 0 16px 8px;
  }
  .events-body::-webkit-scrollbar { width: 6px; }
  .events-body::-webkit-scrollbar-track { background: var(--bg); }
  .events-body::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }
  .events-body::-webkit-scrollbar-thumb:hover { background: #555; }
  .event-line {
    font-family: var(--mono);
    font-size: 11px;
    padding: 2px 0;
    color: var(--text-dim);
    border-bottom: 1px solid #111118;
    display: flex;
    gap: 8px;
  }
  .event-line .time { color: #444; flex-shrink: 0; }
  .event-line .name { color: var(--accent); flex-shrink: 0; }
  .event-line .data { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .event-line.rate-limited .name { color: var(--orange); }
  .event-line.task-failed .name { color: var(--red); }
  .empty { color: var(--text-dim); font-style: italic; font-size: 12px; padding: 8px 0; }
  footer {
    background: var(--surface);
    border-top: 1px solid var(--border);
    padding: 8px 16px;
    text-align: center;
    font-size: 11px;
    font-family: var(--mono);
    flex-shrink: 0;
  }
  footer a { color: var(--accent); text-decoration: none; }
  footer a:hover { text-decoration: underline; }
  .footer-sep { color: var(--border); margin: 0 6px; }

  /* Config Page */
  .config-page {
    flex: 1;
    overflow-y: auto;
    padding: 24px;
    max-width: 920px;
    width: 100%;
    margin: 0 auto;
    display: flex;
    gap: 20px;
    align-items: flex-start;
  }
  .config-nav {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 0 0 168px;
    position: sticky;
    top: 0;
  }
  .config-nav-item {
    text-align: left;
    padding: 8px 12px;
    border-radius: 6px;
    background: transparent;
    border: 1px solid transparent;
    color: var(--text-dim);
    font-size: 13px;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }
  .config-nav-item:hover { background: var(--surface-hover); color: var(--text); }
  .config-nav-item.active {
    background: var(--surface);
    border-color: var(--border);
    color: var(--text);
    font-weight: 600;
  }
  .config-content { flex: 1; min-width: 0; }
  .config-page::-webkit-scrollbar { width: 6px; }
  .config-page::-webkit-scrollbar-track { background: var(--bg); }
  .config-page::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }
  .config-page::-webkit-scrollbar-thumb:hover { background: #555; }
  .config-section {
    border: 1px solid var(--border);
    border-radius: 6px;
    margin-bottom: 12px;
    background: var(--surface);
    overflow: hidden;
    display: none;
  }
  .config-section.active-section {
    display: block;
  }
  .config-section-header {
    padding: 10px 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    cursor: default;
    user-select: none;
    background: var(--surface);
    transition: background 0.15s;
  }
  .config-section-header:hover {
    background: var(--surface-hover);
  }
  .config-section-header h3 {
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
  }
  .config-section-header .docs-link {
    font-size: 10px;
    color: var(--text-dim);
    text-decoration: none;
    margin-left: 10px;
    font-weight: 400;
  }
  .config-section-header .docs-link:hover {
    color: var(--accent);
    text-decoration: underline;
  }
  .config-section-arrow {
    display: none;
  }
  .config-section.collapsed .config-section-arrow {
    transform: rotate(-90deg);
  }
  .config-section.collapsed .config-section-body {
    display: none;
  }
  .config-section-body {
    padding: 12px 16px 16px;
    border-top: 1px solid var(--border);
  }
  .form-field {
    margin-bottom: 14px;
  }
  .form-field:last-child {
    margin-bottom: 0;
  }
  .form-label {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    font-weight: 500;
    color: var(--text);
    margin-bottom: 4px;
    font-family: var(--mono);
  }
  .form-help {
    font-size: 11px;
    color: var(--text-dim);
    margin-bottom: 6px;
    line-height: 1.4;
  }
  .form-input {
    width: 100%;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text);
    font-size: 12px;
    padding: 6px 10px;
    font-family: var(--mono);
    outline: none;
    transition: border-color 0.15s;
  }
  .form-input:focus {
    border-color: var(--accent);
  }
  .form-input[type="number"] {
    width: 140px;
  }
  .form-select {
    width: 180px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text);
    font-size: 12px;
    padding: 6px 10px;
    font-family: var(--mono);
    outline: none;
    transition: border-color 0.15s;
    cursor: pointer;
  }
  .form-select:focus {
    border-color: var(--accent);
  }
  .form-textarea {
    width: 100%;
    min-height: 120px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text);
    font-size: 12px;
    padding: 8px 10px;
    font-family: var(--mono);
    outline: none;
    resize: vertical;
    line-height: 1.5;
    transition: border-color 0.15s;
  }
  .form-textarea:focus {
    border-color: var(--accent);
  }
  .form-checkbox-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .form-checkbox {
    width: 16px;
    height: 16px;
    accent-color: var(--accent);
    cursor: pointer;
  }
  .form-checkbox-label {
    font-size: 12px;
    color: var(--text);
    font-family: var(--mono);
    cursor: pointer;
  }
  .btn-primary {
    background: var(--accent);
    color: #000;
    border: none;
    border-radius: 4px;
    padding: 8px 20px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    font-family: var(--mono);
    transition: opacity 0.15s;
  }
  .btn-primary:hover {
    opacity: 0.85;
  }
  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .btn-danger {
    background: var(--red);
    color: #fff;
    border: none;
    border-radius: 4px;
    padding: 8px 20px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    font-family: var(--mono);
    transition: opacity 0.15s;
  }
  .btn-danger:hover {
    opacity: 0.85;
  }
  .btn-subtle {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-dim);
    border-radius: 4px;
    padding: 8px 20px;
    font-size: 12px;
    cursor: pointer;
    font-family: var(--mono);
    transition: border-color 0.15s, color 0.15s;
  }
  .btn-subtle:hover {
    border-color: var(--text-dim);
    color: var(--text);
  }
  .config-save-row {
    margin-top: 20px;
    display: flex;
    justify-content: flex-end;
  }

  /* Identity Page */
  .identity-page {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    padding: 24px;
    max-width: 900px;
    width: 100%;
    margin: 0 auto;
  }
  .identity-file-tabs {
    display: flex;
    gap: 0;
    margin-bottom: 16px;
    flex-shrink: 0;
    border-bottom: 1px solid var(--border);
  }
  .identity-file-btn {
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--text-dim);
    font-size: 11px;
    font-weight: 500;
    font-family: var(--mono);
    padding: 8px 14px 6px;
    cursor: pointer;
    transition: color 0.15s, border-color 0.15s;
  }
  .identity-file-btn:hover {
    color: var(--text);
  }
  .identity-file-btn.active {
    color: var(--accent);
    border-bottom-color: var(--accent);
  }
  .identity-description {
    font-size: 12px;
    color: var(--text-dim);
    margin-bottom: 12px;
    flex-shrink: 0;
    line-height: 1.5;
  }
  .identity-textarea {
    flex: 1;
    width: 100%;
    min-height: 500px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    font-size: 13px;
    padding: 16px;
    font-family: var(--mono);
    outline: none;
    resize: none;
    line-height: 1.6;
    transition: border-color 0.15s;
  }
  .identity-textarea:focus {
    border-color: var(--accent);
  }
  .identity-save-row {
    margin-top: 12px;
    display: flex;
    justify-content: flex-end;
    flex-shrink: 0;
  }

  /* Toast Notifications */
  .toast-container {
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 9999;
    display: flex;
    flex-direction: column;
    gap: 8px;
    pointer-events: none;
  }
  .toast {
    padding: 10px 18px;
    border-radius: 6px;
    font-size: 12px;
    font-family: var(--mono);
    color: #fff;
    pointer-events: auto;
    animation: toast-in 0.25s ease-out;
    opacity: 1;
    transition: opacity 0.3s;
  }
  .toast.toast-success {
    background: var(--green);
    color: #000;
  }
  .toast.toast-error {
    background: var(--red);
    color: #fff;
  }
  .toast.toast-out {
    opacity: 0;
  }
  @keyframes toast-in {
    from {
      opacity: 0;
      transform: translateY(12px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @media (max-width: 1000px) {
    .grid { grid-template-columns: 1fr 1fr; }
    .panel.span-2 { grid-column: span 2; }
  }
  @media (max-width: 600px) {
    .grid { grid-template-columns: 1fr; }
    .panel.span-2 { grid-column: span 1; }
    .panel { min-height: 150px; }
  }

  /* ── Chat tab ── */
  .chat-page { display: flex; flex-direction: column; max-width: 860px; width: 100%; margin: 0 auto; padding: 16px 24px; height: calc(100vh - 210px); min-height: 320px; }
  .chat-toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
  .chat-messages { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; padding: 4px; min-height: 0; }
  .chat-msg { max-width: 78%; padding: 10px 14px; border-radius: 12px; font-size: 13px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
  .chat-msg-user { align-self: flex-end; background: var(--accent); color: #fff; border-bottom-right-radius: 4px; }
  .chat-msg-brain { align-self: flex-start; background: var(--surface); border: 1px solid var(--border); color: var(--text); border-bottom-left-radius: 4px; }
  .chat-msg-error { align-self: flex-start; background: rgba(255,80,80,0.12); border: 1px solid var(--red); color: var(--text); border-bottom-left-radius: 4px; }
  .chat-msg-pending { color: var(--text-dim); font-style: italic; }
  .chat-composer { display: flex; gap: 8px; margin-top: 10px; }
  .chat-empty { color: var(--text-dim); text-align: center; margin-top: 40px; font-size: 13px; }
  .chat-md { white-space: normal; }
  .chat-md .md-pre { background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 8px 10px; overflow-x: auto; margin: 6px 0; font-size: 12px; white-space: pre; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .chat-md .md-code { background: var(--bg); border: 1px solid var(--border); border-radius: 4px; padding: 0 4px; font-size: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .chat-md .md-h { font-weight: 700; margin: 8px 0 4px; }
  .chat-md .md-h1 { font-size: 15px; }
  .chat-md .md-h2 { font-size: 14px; }
  .chat-md .md-h3, .chat-md .md-h4 { font-size: 13px; }
  .chat-md .md-ul { margin: 4px 0 4px 18px; padding: 0; }
  .chat-md .md-ul li { margin: 2px 0; list-style: disc; }
  .chat-md .md-bq { border-left: 3px solid var(--border); padding-left: 8px; color: var(--text-dim); margin: 4px 0; }
  .chat-md .md-hr { border: none; border-top: 1px solid var(--border); margin: 8px 0; }
  .chat-md .md-gap { height: 6px; }
  .chat-md a { color: var(--accent); }

  /* ── Spaces launcher + view switching ── */
  body[data-view="spaces"] .tab-bar,
  body[data-view="spaces"] .main,
  body[data-view="spaces"] #header-space,
  body[data-view="spaces"] .header-right .stats,
  body[data-view="spaces"] #btn-restart { display: none !important; }
  body[data-view="dashboard"] #view-spaces { display: none !important; }

  .header-space { display: flex; align-items: center; gap: 10px; margin-right: 12px; }
  .btn-back { background: transparent; border: 1px solid var(--border); color: var(--text-dim); padding: 5px 10px; border-radius: 6px; cursor: pointer; font-size: 12px; }
  .btn-back:hover { color: var(--text); border-color: var(--text-dim); }
  .header-space-name { font-weight: 600; color: var(--text); font-size: 14px; }

  .view-spaces { flex: 1; overflow-y: auto; padding: 40px 24px; max-width: 1000px; width: 100%; margin: 0 auto; }
  .spaces-hero { margin-bottom: 28px; }
  .spaces-hero h1 { font-size: 26px; font-weight: 700; color: var(--text); margin-bottom: 8px; }
  .spaces-hero p { color: var(--text-dim); font-size: 14px; max-width: 620px; margin-bottom: 16px; line-height: 1.5; }
  .spaces-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 16px; }
  .spaces-empty { color: var(--text-dim); padding: 40px; text-align: center; border: 1px dashed var(--border); border-radius: 10px; grid-column: 1 / -1; }
  .space-card { border: 1px solid var(--border); border-radius: 10px; background: var(--surface); padding: 16px; display: flex; flex-direction: column; gap: 10px; transition: border-color 0.15s, transform 0.15s; }
  .space-card:hover { border-color: var(--accent); transform: translateY(-1px); }
  .space-card-head { display: flex; align-items: center; justify-content: space-between; }
  .space-card-name { font-weight: 600; font-size: 15px; color: var(--text); }
  .space-card-meta { color: var(--text-dim); font-size: 11px; font-family: ui-monospace, monospace; }
  .space-card-actions { display: flex; gap: 8px; margin-top: 4px; }
  .space-status { font-size: 10px; padding: 2px 8px; border-radius: 999px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
  .space-status-running { background: rgba(0,200,100,0.15); color: var(--green); }
  .space-status-stopped { background: var(--surface-hover); color: var(--text-dim); }
  .space-btn { background: var(--surface-hover); border: 1px solid var(--border); color: var(--text); padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; }
  .space-btn:hover { border-color: var(--text-dim); }
  .space-btn-danger:hover { color: var(--red); border-color: var(--red); }
</style>
</head>
<body data-view="spaces">
<header>
  <div class="logo-group">
    <a href="https://github.com/openvole/openvole" target="_blank" class="logo-link">
      <img src="/assets/vole.png" alt="OpenVole" onerror="this.style.display='none'">
      <h1><span>Open</span>Vole</h1>
    </a>
  </div>
  <div class="header-right">
    <div class="header-space" id="header-space">
      <button class="btn-back" onclick="showSpacesView()" title="Back to spaces">&#8592; Spaces</button>
      <span class="header-space-name" id="header-space-name"></span>
      <span class="space-status" id="header-space-status"></span>
      <button class="btn-restart" id="btn-space-start" title="Start space" onclick="spaceAction('start_space')">Start</button>
      <button class="btn-restart" id="btn-space-stop" title="Stop space" onclick="spaceAction('stop_space')">Stop</button>
    </div>
    <div class="stats">
      <span><span class="stat-val" id="stat-paws">0</span> paws</span>
      <span><span class="stat-val" id="stat-tools">0</span> tools</span>
      <span><span class="stat-val" id="stat-skills">0</span> skills</span>
      <span class="stat-sep">|</span>
      <span><span class="stat-val stat-green" id="stat-completed">0</span> completed</span>
      <span><span class="stat-val stat-blue" id="stat-running">0</span> running</span>
      <span><span class="stat-val stat-yellow" id="stat-queued">0</span> queued</span>
      <span><span class="stat-val stat-red" id="stat-failed">0</span> failed</span>
    </div>
    <button class="btn-restart" id="btn-restart" title="Restart engine">Restart</button>
    <div class="status">
      <div class="status-dot" id="ws-dot"></div>
      <span id="ws-status">Connecting...</span>
    </div>
  </div>
</header>

<div id="view-spaces" class="view-spaces">
  <div class="spaces-hero">
    <h1>Your Spaces</h1>
    <p>Each space is an isolated agent — its own brain, paws, memory, and identity. Open one to manage it, or create a new one.</p>
    <button class="btn-primary" onclick="createSpacePrompt()">+ New space</button>
  </div>
  <div class="spaces-grid" id="spaces-grid"></div>
</div>

<div class="tab-bar">
  <button class="tab-btn active" data-tab="overview" onclick="switchTab('overview')">Overview</button>
  <button class="tab-btn" data-tab="chat" onclick="switchTab('chat')">Chat</button>
  <button class="tab-btn" data-tab="config" onclick="switchTab('config')">Config</button>
  <button class="tab-btn" data-tab="identity" onclick="switchTab('identity')">Identity</button>
</div>

<div class="main">
  <div id="tab-overview" class="tab-content">
    <div class="grid">
      <div class="panel">
        <div class="panel-header"><h2>Paws <span class="count" id="paws-count">0</span></h2></div>
        <div class="panel-body">
          <table id="paws-table">
            <thead><tr><th>Name</th><th>Category</th><th>Tools</th><th>Health</th></tr></thead>
            <tbody></tbody>
          </table>
        </div>
      </div>
      <div class="panel">
        <div class="panel-header"><h2>Tools <span class="count" id="tools-count">0</span></h2></div>
        <div class="panel-body">
          <table id="tools-table">
            <thead><tr><th>Name</th><th>Paw</th><th>Type</th></tr></thead>
            <tbody></tbody>
          </table>
        </div>
      </div>
      <div class="panel">
        <div class="panel-header"><h2>Skills <span class="count" id="skills-count">0</span></h2></div>
        <div class="panel-body">
          <table id="skills-table">
            <thead><tr><th>Name</th><th>Status</th><th>Missing</th></tr></thead>
            <tbody></tbody>
          </table>
        </div>
      </div>
      <div class="panel span-2">
        <div class="panel-header"><h2>Tasks <span class="count" id="tasks-count">0</span></h2></div>
        <div class="panel-body">
          <table id="tasks-table">
            <thead><tr><th>ID</th><th>Source</th><th>Input</th><th>Status</th><th>Time</th><th>Cost</th></tr></thead>
            <tbody></tbody>
          </table>
        </div>
      </div>
      <div class="panel">
        <div class="panel-header"><h2>Schedules <span class="count" id="schedules-count">0</span></h2></div>
        <div class="panel-body">
          <table id="schedules-table">
            <thead><tr><th>ID</th><th>Input</th><th>Cron</th><th>Next Run</th></tr></thead>
            <tbody></tbody>
          </table>
        </div>
      </div>
      <div class="panel" id="volenet-panel" style="display:none">
        <div class="panel-header"><h2>VoleNet</h2></div>
        <div class="panel-body">
          <div id="volenet-status"></div>
          <table id="volenet-peers-table" style="margin-top:8px">
            <thead><tr><th>Peer</th><th>Role</th><th>Capabilities</th><th>Last Seen</th></tr></thead>
            <tbody></tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="events-bar">
      <div class="events-header">
        <h2>Live Events</h2>
        <button onclick="document.getElementById('event-log').innerHTML=''">Clear</button>
      </div>
      <div class="events-body" id="event-log"></div>
    </div>
  </div>

  <div id="tab-chat" class="tab-content" style="display:none">
    <div class="chat-page">
      <div class="chat-toolbar">
        <span style="color:var(--text-dim);font-size:12px">Session</span>
        <select class="form-select" id="chat-session" onchange="onChatSessionChange()" style="width:auto"></select>
        <button class="btn-restart" type="button" onclick="newChatSession()" title="Start a fresh conversation">+ New session</button>
        <button class="btn-restart" type="button" id="btn-chat-clear" onclick="clearChatSession()" title="Delete this session's transcript">Clear</button>
        <span id="chat-note" style="color:var(--text-dim);font-size:11px"></span>
      </div>
      <div class="chat-messages" id="chat-messages"></div>
      <div class="chat-composer">
        <input type="text" class="form-input" id="chat-input" placeholder="Message the brain&hellip;" onkeydown="if(event.key==='Enter'){sendChat();}">
        <button class="btn-primary" id="chat-send" onclick="sendChat()">Send</button>
      </div>
    </div>
  </div>

  <div id="tab-config" class="tab-content" style="display:none">
    <div class="config-page" id="config-page">
      <nav class="config-nav" id="config-nav"></nav>
      <div class="config-content" id="config-content">
      <div class="config-sections" id="config-sections">

      <div class="config-section">
        <div class="config-section-header" onclick="toggleSection(this)">
          <h3>Brain <a class="docs-link" href="https://openvole.github.io/openvole/paws-brain" target="_blank" onclick="event.stopPropagation()">docs</a></h3>
          <span class="config-section-arrow">&#9660;</span>
        </div>
        <div class="config-section-body">
          <div class="form-field">
            <label class="form-label">brain</label>
            <div class="form-help">Which paw handles the Think phase. Choose a brain-type paw you've added in Paws.</div>
            <select class="form-select" id="cfg-brain"></select>
          </div>
        </div>
      </div>

      <div class="config-section">
        <div class="config-section-header" onclick="toggleSection(this)">
          <h3>Heartbeat <a class="docs-link" href="https://openvole.github.io/openvole/configuration#heartbeat" target="_blank" onclick="event.stopPropagation()">docs</a></h3>
          <span class="config-section-arrow">&#9660;</span>
        </div>
        <div class="config-section-body">
          <div class="form-field">
            <div class="form-help">Enable periodic autonomous wake-up.</div>
            <div class="form-checkbox-row">
              <input type="checkbox" class="form-checkbox" id="cfg-heartbeat-enabled">
              <label class="form-checkbox-label" for="cfg-heartbeat-enabled">heartbeat.enabled</label>
            </div>
          </div>
          <div class="form-field">
            <label class="form-label">heartbeat.intervalMinutes</label>
            <div class="form-help">Minutes between heartbeat wake-ups.</div>
            <input type="number" class="form-input" id="cfg-heartbeat-intervalMinutes" value="30" min="1">
          </div>
          <div class="form-field">
            <div class="form-help">Run a heartbeat immediately on startup.</div>
            <div class="form-checkbox-row">
              <input type="checkbox" class="form-checkbox" id="cfg-heartbeat-runOnStart">
              <label class="form-checkbox-label" for="cfg-heartbeat-runOnStart">heartbeat.runOnStart</label>
            </div>
          </div>
        </div>
      </div>

      <div class="config-section">
        <div class="config-section-header" onclick="toggleSection(this)">
          <h3>Loop <a class="docs-link" href="https://openvole.github.io/openvole/configuration#loop" target="_blank" onclick="event.stopPropagation()">docs</a></h3>
          <span class="config-section-arrow">&#9660;</span>
        </div>
        <div class="config-section-body">
          <div class="form-field">
            <label class="form-label">loop.maxIterations</label>
            <div class="form-help">Maximum loop iterations per task. Resets on successful tool execution.</div>
            <input type="number" class="form-input" id="cfg-loop-maxIterations" value="10" min="1">
          </div>
          <div class="form-field">
            <div class="form-help">Ask user confirmation before executing tools.</div>
            <div class="form-checkbox-row">
              <input type="checkbox" class="form-checkbox" id="cfg-loop-confirmBeforeAct">
              <label class="form-checkbox-label" for="cfg-loop-confirmBeforeAct">loop.confirmBeforeAct</label>
            </div>
          </div>
          <div class="form-field">
            <label class="form-label">loop.taskConcurrency</label>
            <div class="form-help">Max tasks running in parallel.</div>
            <input type="number" class="form-input" id="cfg-loop-taskConcurrency" value="1" min="1">
          </div>
          <div class="form-field">
            <label class="form-label">loop.compactThreshold</label>
            <div class="form-help">Message count before triggering context compaction. 0 to disable.</div>
            <input type="number" class="form-input" id="cfg-loop-compactThreshold" value="50" min="0">
          </div>
          <div class="form-field">
            <div class="form-help">Brain starts with core tools only, discovers others via discover_tools.</div>
            <div class="form-checkbox-row">
              <input type="checkbox" class="form-checkbox" id="cfg-loop-toolHorizon" checked>
              <label class="form-checkbox-label" for="cfg-loop-toolHorizon">loop.toolHorizon</label>
            </div>
          </div>
          <div class="form-field">
            <label class="form-label">loop.maxContextTokens</label>
            <div class="form-help">Max context window in tokens. Core trims by priority to fit.</div>
            <input type="number" class="form-input" id="cfg-loop-maxContextTokens" value="128000" min="1000">
          </div>
          <div class="form-field">
            <label class="form-label">loop.responseReserve</label>
            <div class="form-help">Tokens reserved for the Brain's response output.</div>
            <input type="number" class="form-input" id="cfg-loop-responseReserve" value="4000" min="100">
          </div>
          <div class="form-field">
            <label class="form-label">loop.costTracking</label>
            <div class="form-help">auto: track for cloud. enabled: always track. disabled: off.</div>
            <select class="form-select" id="cfg-loop-costTracking">
              <option value="auto" selected>auto</option>
              <option value="enabled">enabled</option>
              <option value="disabled">disabled</option>
            </select>
          </div>
          <div class="form-field">
            <label class="form-label">loop.costAlertThreshold</label>
            <div class="form-help">Warn when a single task exceeds this USD amount.</div>
            <input type="number" class="form-input" id="cfg-loop-costAlertThreshold" placeholder="(optional)" step="0.01" min="0">
          </div>
          <div class="form-field">
            <label class="form-label">loop.rateLimits.llmCallsPerMinute</label>
            <div class="form-help">Max LLM calls per minute. Empty = unlimited.</div>
            <input type="number" class="form-input" id="cfg-rl-llmPerMin" placeholder="(unlimited)" min="1">
          </div>
          <div class="form-field">
            <label class="form-label">loop.rateLimits.llmCallsPerHour</label>
            <div class="form-help">Max LLM calls per hour. Empty = unlimited.</div>
            <input type="number" class="form-input" id="cfg-rl-llmPerHour" placeholder="(unlimited)" min="1">
          </div>
          <div class="form-field">
            <label class="form-label">loop.rateLimits.toolExecutionsPerTask</label>
            <div class="form-help">Max tool executions per task. Empty = unlimited.</div>
            <input type="number" class="form-input" id="cfg-rl-toolPerTask" placeholder="(unlimited)" min="1">
          </div>
          <div class="form-field">
            <label class="form-label">loop.rateLimits.tasksPerHour</label>
            <div class="form-help">Per-source max tasks per hour (e.g. cli, telegram, heartbeat).</div>
            <div id="rl-tph-rows"></div>
            <button class="btn-restart" type="button" onclick="addTphRow('', '')" style="margin-top:6px">+ Add source limit</button>
            <datalist id="rl-source-options">
              <option value="cli"></option>
              <option value="user"></option>
              <option value="heartbeat"></option>
              <option value="schedule"></option>
              <option value="telegram"></option>
              <option value="slack"></option>
              <option value="discord"></option>
            </datalist>
          </div>
        </div>
      </div>

      <div class="config-section">
        <div class="config-section-header" onclick="toggleSection(this)">
          <h3>Security <a class="docs-link" href="https://openvole.github.io/openvole/configuration#security" target="_blank" onclick="event.stopPropagation()">docs</a></h3>
          <span class="config-section-arrow">&#9660;</span>
        </div>
        <div class="config-section-body">
          <div class="form-field">
            <div class="form-help">Enable Node.js --permission sandbox for paw subprocesses.</div>
            <div class="form-checkbox-row">
              <input type="checkbox" class="form-checkbox" id="cfg-security-sandboxFilesystem" checked>
              <label class="form-checkbox-label" for="cfg-security-sandboxFilesystem">security.sandboxFilesystem</label>
            </div>
          </div>
          <div class="form-field">
            <label class="form-label">security.allowedPaths (global)</label>
            <div class="form-help">Extra paths ALL paws may read/write. Prefer per-paw paths below.</div>
            <div id="sec-global-paths"></div>
            <button class="btn-restart" type="button" onclick="addPathRow(document.getElementById('sec-global-paths'), '')" style="margin-top:6px">+ Add path</button>
          </div>
          <div class="form-field">
            <label class="form-label">Per-paw filesystem paths</label>
            <div class="form-help">Each paw's allow.filesystem — extra paths only that paw may read/write. Saved into the Paws config.</div>
            <div id="sec-paw-paths"></div>
          </div>
          <div class="form-field">
            <label class="form-label">Docker Sandbox</label>
            <div class="form-help">Optional container-level isolation. Note: not yet enforced by the engine — stored for future use.</div>
            <div class="form-checkbox-row">
              <input type="checkbox" class="form-checkbox" id="cfg-docker-enabled">
              <label class="form-checkbox-label" for="cfg-docker-enabled">docker.enabled</label>
            </div>
          </div>
          <div class="form-field">
            <label class="form-label">docker.image</label>
            <input type="text" class="form-input" id="cfg-docker-image" placeholder="node:20-slim">
          </div>
          <div class="form-field">
            <label class="form-label">docker.memory</label>
            <input type="text" class="form-input" id="cfg-docker-memory" placeholder="512m">
          </div>
          <div class="form-field">
            <label class="form-label">docker.cpus</label>
            <input type="text" class="form-input" id="cfg-docker-cpus" placeholder="1.0">
          </div>
          <div class="form-field">
            <label class="form-label">docker.scope</label>
            <select class="form-select" id="cfg-docker-scope">
              <option value="session" selected>session</option>
              <option value="shared">shared</option>
            </select>
          </div>
          <div class="form-field">
            <label class="form-label">docker.network</label>
            <select class="form-select" id="cfg-docker-network">
              <option value="none" selected>none</option>
              <option value="bridge">bridge</option>
              <option value="host">host</option>
            </select>
          </div>
          <div class="form-field">
            <label class="form-label">docker.allowedDomains</label>
            <div class="form-help">Comma-separated outbound domains when network=bridge.</div>
            <input type="text" class="form-input" id="cfg-docker-domains" placeholder="api.example.com, registry.npmjs.org">
          </div>
        </div>
      </div>

      <div class="config-section">
        <div class="config-section-header" onclick="toggleSection(this)">
          <h3>Paws <a class="docs-link" href="https://openvole.github.io/openvole/paws" target="_blank" onclick="event.stopPropagation()">docs</a></h3>
          <span class="config-section-arrow">&#9660;</span>
        </div>
        <div class="config-section-body">
          <div class="form-field">
            <div class="form-help">Array of paw configurations. Each entry is a string or { name, allow: { network, listen, filesystem, env, childProcess } }</div>
            <textarea class="form-textarea" id="cfg-paws" rows="8" placeholder='["@openvole/paw-brain"]'>[]</textarea>
            <button class="btn-restart" type="button" id="btn-browse-paws" onclick="browsePaws()" style="margin-top:8px">Browse official paws</button>
            <div id="paw-catalog" style="margin-top:8px"></div>
          </div>
        </div>
      </div>

      <div class="config-section">
        <div class="config-section-header" onclick="toggleSection(this)">
          <h3>Tool Profiles <a class="docs-link" href="https://openvole.github.io/openvole/configuration#toolprofiles" target="_blank" onclick="event.stopPropagation()">docs</a></h3>
          <span class="config-section-arrow">&#9660;</span>
        </div>
        <div class="config-section-body">
          <div class="form-field">
            <div class="form-help">Restrict which tools each task source may use. Allow = only these tools (empty = all); Deny = always blocked. Exact tool names — no wildcards. Suggestions come from the tools loaded in this space.</div>
            <div id="tp-blocks"></div>
            <button class="btn-restart" type="button" onclick="addTpBlock('', {})" style="margin-top:6px">+ Add source profile</button>
            <datalist id="tool-name-options"></datalist>
          </div>
        </div>
      </div>

      <div class="config-section">
        <div class="config-section-header" onclick="toggleSection(this)">
          <h3>Agents <a class="docs-link" href="https://openvole.github.io/openvole/configuration#agents" target="_blank" onclick="event.stopPropagation()">docs</a></h3>
          <span class="config-section-arrow">&#9660;</span>
        </div>
        <div class="config-section-body">
          <div class="form-field">
            <div class="form-help">Named agent profiles for sub-agent spawning. Each has role, instructions, allowTools, denyTools, maxIterations.</div>
            <textarea class="form-textarea" id="cfg-agents" rows="8" placeholder='{"researcher": {"role": "...", "instructions": "..."}}'>{}</textarea>
          </div>
        </div>
      </div>

      <div class="config-section">
        <div class="config-section-header" onclick="toggleSection(this)">
          <h3>Net (VoleNet) <a class="docs-link" href="https://openvole.github.io/openvole/volenet" target="_blank" onclick="event.stopPropagation()">docs</a></h3>
          <span class="config-section-arrow">&#9660;</span>
        </div>
        <div class="config-section-body">
          <div class="form-field">
            <div class="form-help">VoleNet distributed networking config. See docs for architecture patterns.</div>
            <textarea class="form-textarea" id="cfg-net" rows="8" placeholder='{"enabled": false}'>{}</textarea>
          </div>
        </div>
      </div>

      </div>
      <div class="config-save-row">
        <button class="btn-primary" id="btn-save-config" onclick="saveConfig()">Save Config</button>
      </div>
      </div>

    </div>
  </div>

  <div id="tab-identity" class="tab-content" style="display:none">
    <div class="identity-page" id="identity-page">
      <div class="identity-file-tabs" id="identity-file-tabs">
        <button class="identity-file-btn active" data-file="SOUL.md" onclick="switchIdentityFile('SOUL.md')">SOUL.md</button>
        <button class="identity-file-btn" data-file="USER.md" onclick="switchIdentityFile('USER.md')">USER.md</button>
        <button class="identity-file-btn" data-file="AGENT.md" onclick="switchIdentityFile('AGENT.md')">AGENT.md</button>
        <button class="identity-file-btn" data-file="HEARTBEAT.md" onclick="switchIdentityFile('HEARTBEAT.md')">HEARTBEAT.md</button>
        <button class="identity-file-btn" data-file="BRAIN.md" onclick="switchIdentityFile('BRAIN.md')">BRAIN.md</button>
      </div>
      <div class="identity-description" id="identity-description">Agent personality, tone, and identity. Shapes how the agent communicates.</div>
      <textarea class="identity-textarea" id="identity-editor" spellcheck="false"></textarea>
      <div class="identity-save-row">
        <button class="btn-primary" id="btn-save-identity" onclick="saveIdentity()">Save File</button>
      </div>
    </div>
  </div>

  <footer>
    <a href="https://github.com/openvole/openvole" target="_blank">GitHub</a>
    <span class="footer-sep">&middot;</span>
    <a href="https://github.com/openvole/pawhub" target="_blank">PawHub</a>
    <span class="footer-sep">&middot;</span>
    <a href="https://www.npmjs.com/package/openvole" target="_blank">npm</a>
    <span class="footer-sep">&middot;</span>
    <a href="https://openvole.github.io/openvole/" target="_blank">Docs</a>
    <span class="footer-sep">&middot;</span>
    <a href="https://volehub.dev" target="_blank">VoleHub</a>
    <span class="footer-sep">&middot;</span>
    <a href="https://clawhub.ai" target="_blank">ClawHub Skills</a>
  </footer>
</div>

<div class="toast-container" id="toast-container"></div>

<script>
const ws = new WebSocket('ws://' + location.hostname + ':' + ${wsPort} + '/ws');
const dot = document.getElementById('ws-dot');
const statusText = document.getElementById('ws-status');
const eventLog = document.getElementById('event-log');
const MAX_EVENTS = 500;

/* ── Command / Response Protocol ── */
const pendingCommands = new Map();
let cmdIdCounter = 0;

function sendCommand(type, params, timeoutMs) {
  return new Promise(function(resolve, reject) {
    const id = 'cmd-' + (++cmdIdCounter) + '-' + Math.random().toString(36).substring(2, 8);
    const timeout = setTimeout(function() {
      pendingCommands.delete(id);
      reject(new Error('Command timed out: ' + type));
    }, timeoutMs || 10000);
    pendingCommands.set(id, { resolve: resolve, reject: reject, timeout: timeout });
    ws.send(JSON.stringify({ type: type, id: id, params: params || {} }));
  });
}

/* ── Spaces (control-plane mode) ── */
var currentSpaceId = null;
var lastSpaces = [];
var lastStatePaws = [];
var lastStateTools = [];

/* ── View switching: spaces launcher  <->  selected-space dashboard ── */
function showSpacesView() {
  currentSpaceId = null;
  document.body.dataset.view = 'spaces';
  sendCommand('list_spaces').then(renderSpaces).catch(function() {});
}
function showDashboardView() {
  document.body.dataset.view = 'dashboard';
}
function openSpace(id) {
  showDashboardView();
  selectSpace(id);
  switchTab('overview');
}

/* ── Spaces launcher (cards) ── */
function renderSpaces(spaces) {
  lastSpaces = spaces || [];
  var grid = document.getElementById('spaces-grid');
  if (grid) {
    if (lastSpaces.length === 0) {
      grid.innerHTML = '<div class="spaces-empty">No spaces yet. Click <b>+ New space</b> to create your first agent.</div>';
    } else {
      grid.innerHTML = lastSpaces.map(spaceCardHtml).join('');
      wireSpaceCards();
    }
  }
  if (currentSpaceId) updateSpaceHeader();
}
function spaceCardHtml(s) {
  var running = s.state === 'running';
  return '<div class="space-card">'
    + '<div class="space-card-head">'
    + '<span class="space-card-name">' + esc(s.name) + '</span>'
    + '<span class="space-status space-status-' + (running ? 'running' : 'stopped') + '">' + (running ? 'running' : 'stopped') + '</span>'
    + '</div>'
    + '<div class="space-card-meta">' + esc(s.id) + (s.pid ? ' &middot; pid ' + s.pid : '') + '</div>'
    + '<div class="space-card-actions">'
    + '<button class="btn-primary" data-act="open" data-id="' + esc(s.id) + '">Open</button>'
    + '<button class="space-btn" data-act="' + (running ? 'stop_space' : 'start_space') + '" data-id="' + esc(s.id) + '">' + (running ? 'Stop' : 'Start') + '</button>'
    + '<button class="space-btn space-btn-danger" data-act="remove" data-id="' + esc(s.id) + '">Remove</button>'
    + '</div></div>';
}
function wireSpaceCards() {
  var btns = document.querySelectorAll('#spaces-grid button[data-act]');
  for (var i = 0; i < btns.length; i++) {
    btns[i].addEventListener('click', function() {
      var act = this.getAttribute('data-act');
      var id = this.getAttribute('data-id');
      if (act === 'open') { openSpace(id); return; }
      if (act === 'remove') { removeSpaceById(id); return; }
      sendCommand(act, { spaceId: id })
        .then(function() { return sendCommand('list_spaces'); })
        .then(renderSpaces)
        .catch(function(e) { showToast(e.message, 'error'); });
    });
  }
}
function createSpacePrompt() {
  var name = prompt('New space name:');
  if (!name) return;
  sendCommand('create_space', { name: name })
    .then(function() { return sendCommand('list_spaces'); })
    .then(function(spaces) { renderSpaces(spaces); showToast('Created space "' + name + '"', 'success'); })
    .catch(function(e) { showToast(e.message, 'error'); });
}
function removeSpaceById(id) {
  if (!confirm('Remove space "' + id + '"? (its files are kept on disk)')) return;
  sendCommand('remove_space', { spaceId: id })
    .then(function() {
      showToast('Removed space "' + id + '"', 'success');
      if (currentSpaceId === id) { showSpacesView(); }
      else { sendCommand('list_spaces').then(renderSpaces).catch(function() {}); }
    })
    .catch(function(e) { showToast(e.message, 'error'); });
}

/* ── Selected-space header + dashboard ── */
function updateSpaceHeader() {
  var s = lastSpaces.filter(function(x) { return x.id === currentSpaceId; })[0];
  var running = s && s.state === 'running';
  var nameEl = document.getElementById('header-space-name');
  var stEl = document.getElementById('header-space-status');
  if (nameEl) nameEl.textContent = s ? s.name : (currentSpaceId || '');
  if (stEl) {
    stEl.textContent = running ? 'running' : 'stopped';
    stEl.className = 'space-status space-status-' + (running ? 'running' : 'stopped');
  }
  document.getElementById('btn-space-start').style.display = (s && !running) ? '' : 'none';
  document.getElementById('btn-space-stop').style.display = (s && running) ? '' : 'none';
}
function selectSpace(id) {
  if (!id) { currentSpaceId = null; clearPanels(); return; }
  var changed = currentSpaceId !== id;
  currentSpaceId = id;
  if (changed) resetChat();
  updateSpaceHeader();
  sendCommand('select_space', { spaceId: id })
    .then(function(state) { renderState(state || {}); })
    .catch(function() { clearPanels(); });
}
function clearPanels() {
  renderState({ paws: [], tools: [], skills: [], tasks: [], schedules: [], volenet: { enabled: false } });
}
function spaceAction(cmd) {
  if (!currentSpaceId) return;
  var id = currentSpaceId;
  sendCommand(cmd, { spaceId: id })
    .then(function() { return sendCommand('list_spaces'); })
    .then(function(spaces) {
      renderSpaces(spaces);
      if (cmd === 'start_space') selectSpace(id);
      else clearPanels();
    })
    .catch(function(e) { showToast(e.message, 'error'); });
}

/* ── Chat (per-space brain conversation via paw-session sessions) ── */
var chatSessionId = 'dashboard';
var chatLoadedKey = null;
var pendingChats = {}; // taskId -> { el, spaceId }

function resetChat() {
  chatSessionId = 'dashboard';
  chatLoadedKey = null;
  pendingChats = {};
  localChatSessions = [];
  var box = document.getElementById('chat-messages');
  if (box) box.innerHTML = '';
  if (currentTab === 'chat') initChatTab();
}
function initChatTab() {
  if (!currentSpaceId) return;
  var key = currentSpaceId + ':' + chatSessionId;
  if (chatLoadedKey === key) return;
  loadChatSessions();
  loadChatHistory();
}
var localChatSessions = []; // created this page, not yet persisted by paw-session
function loadChatSessions() {
  sendCommand('chat_sessions').then(function(res) {
    var sel = document.getElementById('chat-session');
    var note = document.getElementById('chat-note');
    var opts = ['<option value="dashboard">dashboard</option>'];
    var seen = { dashboard: true };
    if (res && res.ok && res.sessions) {
      for (var i = 0; i < res.sessions.length; i++) {
        var s = res.sessions[i];
        if (seen[s.sessionId]) continue;
        seen[s.sessionId] = true;
        var label = s.sessionId + (s.source ? ' (' + s.source + ')' : '') + ' — ' + (s.messageCount || 0) + ' msgs';
        opts.push('<option value="' + esc(s.sessionId) + '">' + esc(label) + '</option>');
      }
      note.textContent = '';
    } else {
      note.textContent = "paw-session not loaded — history won't persist";
    }
    for (var j = 0; j < localChatSessions.length; j++) {
      if (!seen[localChatSessions[j]]) {
        opts.push('<option value="' + esc(localChatSessions[j]) + '">' + esc(localChatSessions[j]) + ' — new</option>');
      }
    }
    sel.innerHTML = opts.join('');
    sel.value = chatSessionId;
    if (sel.value !== chatSessionId) { sel.value = 'dashboard'; chatSessionId = 'dashboard'; }
  }).catch(function() {});
}
function newChatSession() {
  var d = new Date();
  var pad = function(x) { return (x < 10 ? '0' : '') + x; };
  var id = 'dashboard:' + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
  localChatSessions.push(id);
  chatSessionId = id;
  chatLoadedKey = currentSpaceId + ':' + id;
  document.getElementById('chat-messages').innerHTML = '<div class="chat-empty">New session — say hi to the brain.</div>';
  document.getElementById('chat-note').textContent = '';
  loadChatSessions();
}
function clearChatSession() {
  if (!confirm('Delete the transcript of session "' + chatSessionId + '"?')) return;
  sendCommand('chat_clear', { sessionId: chatSessionId }).then(function(res) {
    if (res && res.ok === false) { showToast(res.error || 'Could not clear session', 'error'); return; }
    showToast('Cleared session "' + chatSessionId + '"', 'success');
    chatLoadedKey = null;
    loadChatSessions();
    loadChatHistory();
  }).catch(function(e) { showToast(e.message, 'error'); });
}
function onChatSessionChange() {
  chatSessionId = document.getElementById('chat-session').value || 'dashboard';
  chatLoadedKey = null;
  document.getElementById('chat-messages').innerHTML = '';
  var note = document.getElementById('chat-note');
  note.textContent = chatSessionId === 'dashboard' ? '' : 'channel session — replies appear here, not on the channel';
  loadChatHistory();
}
function loadChatHistory() {
  var box = document.getElementById('chat-messages');
  box.innerHTML = '<div class="chat-empty">Loading&hellip;</div>';
  var key = currentSpaceId + ':' + chatSessionId;
  sendCommand('chat_history', { sessionId: chatSessionId }).then(function(res) {
    chatLoadedKey = key;
    box.innerHTML = '';
    var added = 0;
    var h = (res && res.ok !== false) ? res.history : null;
    if (Array.isArray(h)) {
      // paw-session >= 2.1: messages [{ts, role, content}] with newlines preserved
      for (var i = 0; i < h.length; i++) {
        var role = h[i].role;
        if (role === 'user') { addChatBubble('user', h[i].content); added++; }
        else if (role === 'brain') { setBubbleMarkdown(addChatBubble('brain', ''), h[i].content); added++; }
        // tool:* entries are skipped — chat shows the conversation only
      }
    } else if (h) {
      // older paw-session: flattened text lines
      var lines = String(h).split('\\n');
      for (var j = 0; j < lines.length; j++) {
        var m = lines[j].match(/^\\[(\\d\\d:\\d\\d:\\d\\d)\\] (\\w+): (.*)$/);
        if (!m) continue;
        if (m[2] === 'user') {
          addChatBubble('user', m[3]);
        } else {
          setBubbleMarkdown(addChatBubble('brain', ''), m[3]);
        }
        added++;
      }
    }
    if (!added) box.innerHTML = '<div class="chat-empty">No messages yet — say hi to the brain.</div>';
    box.scrollTop = box.scrollHeight;
  }).catch(function() {
    chatLoadedKey = key;
    box.innerHTML = '<div class="chat-empty">No history available (paw-session not loaded). Messages still work.</div>';
  });
}
/* ── Minimal safe markdown renderer for brain bubbles (escape first, then transform) ── */
function mdEscape(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function renderMarkdown(src) {
  var text = String(src || '');
  var blocks = [];
  text = text.replace(/\\u0060\\u0060\\u0060([a-zA-Z0-9_-]*)\\n?([\\s\\S]*?)\\u0060\\u0060\\u0060/g, function(_m, _lang, code) {
    blocks.push('<pre class="md-pre"><code>' + mdEscape(code.replace(/\\n$/, '')) + '</code></pre>');
    return '\\u0000B' + (blocks.length - 1) + '\\u0000';
  });
  text = mdEscape(text);
  text = text.replace(/\\u0060([^\\u0060\\n]+)\\u0060/g, function(_m, c) { return '<code class="md-code">' + c + '</code>'; });
  text = text.replace(/\\[([^\\]]+)\\]\\((https?:\\/\\/[^)\\s]+)\\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  text = text.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');
  text = text.replace(/(^|[^*])\\*([^*\\n]+)\\*/g, '$1<em>$2</em>');
  var lines = text.split('\\n');
  var out = [];
  var inList = false;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var li = line.match(/^\\s*(?:[-*+]|\\d+\\.)\\s+(.*)$/);
    if (li) {
      if (!inList) { out.push('<ul class="md-ul">'); inList = true; }
      out.push('<li>' + li[1] + '</li>');
      continue;
    }
    if (inList) { out.push('</ul>'); inList = false; }
    var h = line.match(/^(#{1,4})\\s+(.*)$/);
    if (h) { out.push('<div class="md-h md-h' + h[1].length + '">' + h[2] + '</div>'); continue; }
    if (/^\\s*(?:---+|\\*\\*\\*+)\\s*$/.test(line)) { out.push('<hr class="md-hr">'); continue; }
    var bq = line.match(/^&gt;\\s?(.*)$/);
    if (bq) { out.push('<div class="md-bq">' + bq[1] + '</div>'); continue; }
    if (line.replace(/\\s/g, '') === '') { out.push('<div class="md-gap"></div>'); continue; }
    out.push('<div>' + line + '</div>');
  }
  if (inList) out.push('</ul>');
  return out.join('').replace(/\\u0000B(\\d+)\\u0000/g, function(_m, idx) { return blocks[idx]; });
}
function setBubbleMarkdown(el, text) {
  el.classList.add('chat-md');
  el.innerHTML = renderMarkdown(text);
}
function addChatBubble(kind, text, extraClass) {
  var box = document.getElementById('chat-messages');
  var empty = box.querySelector('.chat-empty');
  if (empty) empty.remove();
  var el = document.createElement('div');
  el.className = 'chat-msg chat-msg-' + kind + (extraClass ? ' ' + extraClass : '');
  el.textContent = text;
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
  return el;
}
function sendChat() {
  var input = document.getElementById('chat-input');
  var text = input.value.trim();
  if (!text || !currentSpaceId) return;
  input.value = '';
  addChatBubble('user', text);
  var pendingEl = addChatBubble('brain', 'queued…', 'chat-msg-pending');
  sendCommand('submit', { input: text, sessionId: chatSessionId }).then(function(res) {
    if (res && res.taskId) {
      pendingChats[res.taskId] = { el: pendingEl, spaceId: currentSpaceId };
    } else {
      pendingEl.classList.remove('chat-msg-pending');
      pendingEl.textContent = '(submitted)';
    }
  }).catch(function(e) {
    pendingEl.className = 'chat-msg chat-msg-error';
    pendingEl.textContent = 'Failed to submit: ' + e.message;
  });
}
function chatOnTaskEvent(event, data, spaceId) {
  var p = data && data.taskId ? pendingChats[data.taskId] : null;
  if (!p) return;
  if (spaceId !== undefined && p.spaceId !== spaceId) return;
  if (event === 'task:started') {
    p.el.textContent = 'thinking…';
    return;
  }
  if (event === 'task:completed') {
    p.el.classList.remove('chat-msg-pending');
    setBubbleMarkdown(p.el, data.result || '(no response)');
  } else if (event === 'task:failed' || event === 'task:cancelled') {
    p.el.className = 'chat-msg chat-msg-error';
    p.el.textContent = data && (data.result || data.error) ? String(data.result || data.error) : 'Task failed';
  } else {
    return;
  }
  delete pendingChats[data.taskId];
  var box = document.getElementById('chat-messages');
  box.scrollTop = box.scrollHeight;
}

/* ── Render aggregated engine state ── */
function renderState(d) {
  lastStatePaws = d.paws || [];
  lastStateTools = d.tools || [];
  refreshToolNameOptions();
  renderPaws(d.paws || []);
  refreshBrainOptions();
  renderTools(d.tools || []);
  renderSkills(d.skills || []);
  renderTasks(d.tasks || []);
  renderSchedules(d.schedules || []);
  renderVoleNet(d.volenet || { enabled: false });
  document.getElementById('stat-paws').textContent = (d.paws || []).length;
  document.getElementById('stat-tools').textContent = (d.tools || []).length;
  document.getElementById('stat-skills').textContent = (d.skills || []).length;
  var tasks = d.tasks || [];
  document.getElementById('stat-completed').textContent = tasks.filter(function(t) { return t.status === 'completed'; }).length;
  document.getElementById('stat-running').textContent = tasks.filter(function(t) { return t.status === 'running'; }).length;
  document.getElementById('stat-queued').textContent = tasks.filter(function(t) { return t.status === 'queued'; }).length;
  document.getElementById('stat-failed').textContent = tasks.filter(function(t) { return t.status === 'failed' || t.status === 'cancelled'; }).length;
}

/* ── Toast Notifications ── */
function showToast(message, type) {
  var container = document.getElementById('toast-container');
  var el = document.createElement('div');
  el.className = 'toast toast-' + (type || 'success');
  el.textContent = message;
  container.appendChild(el);
  setTimeout(function() {
    el.classList.add('toast-out');
    setTimeout(function() {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 300);
  }, 3000);
}

/* ── Tab Navigation ── */
var currentTab = 'overview';
var configLoaded = false;
var identityLoaded = false;

function switchTab(tabName) {
  currentTab = tabName;
  var tabs = document.querySelectorAll('.tab-btn');
  for (var i = 0; i < tabs.length; i++) {
    tabs[i].classList.toggle('active', tabs[i].getAttribute('data-tab') === tabName);
  }
  document.getElementById('tab-overview').style.display = tabName === 'overview' ? '' : 'none';
  document.getElementById('tab-chat').style.display = tabName === 'chat' ? '' : 'none';
  document.getElementById('tab-config').style.display = tabName === 'config' ? '' : 'none';
  document.getElementById('tab-identity').style.display = tabName === 'identity' ? '' : 'none';

  if (tabName === 'chat') {
    initChatTab();
  }
  if (tabName === 'config') {
    if (!configNavReady) { initConfigNav(); configNavReady = true; }
    if (!configLoaded) loadConfig();
  }
  if (tabName === 'identity' && !identityLoaded) {
    loadIdentity();
  }
}

/* ── Config sections as vertical tabs ── */
function toggleSection() { /* sections are vertical tabs now; the left nav controls visibility */ }
var configNavReady = false;
function initConfigNav() {
  var sections = document.querySelectorAll('#config-sections .config-section');
  var nav = document.getElementById('config-nav');
  if (!nav) return;
  nav.innerHTML = '';
  for (var i = 0; i < sections.length; i++) {
    (function(idx, sec) {
      var h3 = sec.querySelector('h3');
      var title = (h3 && h3.childNodes[0]) ? h3.childNodes[0].textContent.trim() : ('Section ' + (idx + 1));
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'config-nav-item' + (idx === 0 ? ' active' : '');
      btn.textContent = title;
      btn.addEventListener('click', function() { switchConfigSection(idx); });
      nav.appendChild(btn);
      sec.classList.toggle('active-section', idx === 0);
    })(i, sections[i]);
  }
}
function switchConfigSection(i) {
  var sections = document.querySelectorAll('#config-sections .config-section');
  var items = document.querySelectorAll('#config-nav .config-nav-item');
  for (var a = 0; a < sections.length; a++) sections[a].classList.toggle('active-section', a === i);
  for (var b = 0; b < items.length; b++) items[b].classList.toggle('active', b === i);
}

/* ── Config Page ── */
var cachedConfig = null;

var lastCatalog = [];
function browsePaws() {
  var cat = document.getElementById('paw-catalog');
  cat.innerHTML = '<div style="opacity:0.7">Loading official paws…</div>';
  sendCommand('list_available_paws').then(function(paws) {
    renderPawCatalog(paws || []);
  }).catch(function(e) {
    cat.innerHTML = '<div style="color:var(--red)">Could not load paws: ' + esc(e.message) + '</div>';
  });
}
function currentConfiguredPaws() {
  try {
    return JSON.parse(document.getElementById('cfg-paws').value || '[]').map(function(p) {
      return typeof p === 'string' ? p : (p && p.name);
    });
  } catch (e) { return []; }
}
function renderPawCatalog(paws) {
  lastCatalog = paws;
  var cat = document.getElementById('paw-catalog');
  if (!paws.length) { cat.innerHTML = '<div style="opacity:0.7">No official paws found.</div>'; return; }
  var have = currentConfiguredPaws();
  cat.innerHTML = paws.map(function(p) {
    var added = have.indexOf(p.name) >= 0;
    return '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">'
      + '<div><div style="font-weight:600">' + esc(p.name) + ' <span style="opacity:0.6;font-weight:400">' + esc(p.version || '') + '</span></div>'
      + '<div style="opacity:0.7;font-size:0.85em">' + esc(p.description || '') + '</div></div>'
      + '<button class="btn-restart" type="button" data-paw="' + esc(p.name) + '"' + (added ? ' disabled' : '') + '>' + (added ? 'Added' : 'Add') + '</button>'
      + '</div>';
  }).join('');
  var btns = cat.querySelectorAll('button[data-paw]');
  for (var i = 0; i < btns.length; i++) {
    btns[i].addEventListener('click', function() { installPawIntoSpace(this.getAttribute('data-paw'), this); });
  }
}
function installPawIntoSpace(name, btn) {
  if (!currentSpaceId) { showToast('Select a running space first', 'error'); return; }
  if (btn) { btn.disabled = true; btn.textContent = 'Installing…'; }
  showToast('Installing ' + name + '… (npm install can take a moment)', 'success');
  sendCommand('install_paw', { name: name }, 180000).then(function(info) {
    var v = info && info.version ? '@' + info.version : '';
    showToast('Installed ' + name + v + ' — Restart the space to load it', 'success');
    if (btn) { btn.textContent = 'Added'; btn.disabled = true; }
    loadConfig(); // reload Config tab so the new { name, allow } shows
  }).catch(function(e) {
    showToast('Install failed: ' + e.message, 'error');
    if (btn) { btn.textContent = 'Add'; btn.disabled = false; }
  });
}
function loadConfig() {
  sendCommand('read_config').then(function(data) {
    cachedConfig = data || {};
    populateConfig(cachedConfig);
    configLoaded = true;
    showToast('Config loaded', 'success');
  }).catch(function(err) {
    showToast('Failed to load config: ' + err.message, 'error');
  });
}

function refreshBrainOptions(desired) {
  var sel = document.getElementById('cfg-brain');
  if (!sel) return;
  var current = (desired !== undefined && desired !== null)
    ? desired
    : (sel.value || (cachedConfig && cachedConfig.brain) || '');
  var brains = (lastStatePaws || [])
    .filter(function(p) { return p && p.category === 'brain'; })
    .map(function(p) { return p.name; });
  if (current && brains.indexOf(current) < 0) brains.unshift(current);
  var opts = ['<option value="">(none)</option>'];
  for (var i = 0; i < brains.length; i++) {
    opts.push('<option value="' + esc(brains[i]) + '">' + esc(brains[i]) + '</option>');
  }
  sel.innerHTML = opts.join('');
  sel.value = current;
}
function populateConfig(cfg) {
  refreshBrainOptions(cfg.brain || '');

  var loop = cfg.loop || {};
  document.getElementById('cfg-loop-maxIterations').value = loop.maxIterations != null ? loop.maxIterations : 10;
  document.getElementById('cfg-loop-confirmBeforeAct').checked = !!loop.confirmBeforeAct;
  document.getElementById('cfg-loop-taskConcurrency').value = loop.taskConcurrency != null ? loop.taskConcurrency : 1;
  document.getElementById('cfg-loop-compactThreshold').value = loop.compactThreshold != null ? loop.compactThreshold : 50;
  document.getElementById('cfg-loop-toolHorizon').checked = loop.toolHorizon != null ? loop.toolHorizon : true;
  document.getElementById('cfg-loop-maxContextTokens').value = loop.maxContextTokens != null ? loop.maxContextTokens : 128000;
  document.getElementById('cfg-loop-responseReserve').value = loop.responseReserve != null ? loop.responseReserve : 4000;
  document.getElementById('cfg-loop-costTracking').value = loop.costTracking || 'auto';
  document.getElementById('cfg-loop-costAlertThreshold').value = loop.costAlertThreshold != null ? loop.costAlertThreshold : '';
  populateRateLimits(loop.rateLimits || {});

  var hb = cfg.heartbeat || {};
  document.getElementById('cfg-heartbeat-enabled').checked = !!hb.enabled;
  document.getElementById('cfg-heartbeat-intervalMinutes').value = hb.intervalMinutes != null ? hb.intervalMinutes : 30;
  document.getElementById('cfg-heartbeat-runOnStart').checked = !!hb.runOnStart;

  var sec = cfg.security || {};
  document.getElementById('cfg-security-sandboxFilesystem').checked = sec.sandboxFilesystem != null ? sec.sandboxFilesystem : true;
  populateGlobalPaths(sec.allowedPaths || []);
  populateDocker(sec.docker || {});

  document.getElementById('cfg-paws').value = JSON.stringify(cfg.paws || [], null, 2);
  populatePawPaths(cfg.paws || []);
  populateToolProfiles(cfg.toolProfiles || {});
  document.getElementById('cfg-agents').value = JSON.stringify(cfg.agents || {}, null, 2);
  document.getElementById('cfg-net').value = JSON.stringify(cfg.net || {}, null, 2);
}

/* ── Rate limits (structured fields, schema = core RateLimits) ── */
function populateRateLimits(rl) {
  rl = rl || {};
  document.getElementById('cfg-rl-llmPerMin').value = rl.llmCallsPerMinute != null ? rl.llmCallsPerMinute : '';
  document.getElementById('cfg-rl-llmPerHour').value = rl.llmCallsPerHour != null ? rl.llmCallsPerHour : '';
  document.getElementById('cfg-rl-toolPerTask').value = rl.toolExecutionsPerTask != null ? rl.toolExecutionsPerTask : '';
  document.getElementById('rl-tph-rows').innerHTML = '';
  var tph = rl.tasksPerHour || {};
  for (var k in tph) addTphRow(k, tph[k]);
}
function addTphRow(source, limit) {
  var row = document.createElement('div');
  row.className = 'rl-tph-row';
  row.style.cssText = 'display:flex;gap:8px;margin-top:6px;align-items:center';
  row.innerHTML = '<input type="text" class="form-input" style="flex:1" placeholder="source (e.g. cli)" list="rl-source-options" value="' + esc(String(source || '')) + '">'
    + '<input type="number" class="form-input" style="width:110px" placeholder="limit" min="1" value="' + esc(limit != null && limit !== '' ? String(limit) : '') + '">'
    + '<button class="space-btn space-btn-danger" type="button" title="Remove">&times;</button>';
  row.querySelector('button').addEventListener('click', function() { row.remove(); });
  document.getElementById('rl-tph-rows').appendChild(row);
}
function readRateLimitsFromForm() {
  var rl = {};
  // Preserve any keys this form doesn't know about (forward compat).
  var prev = (cachedConfig && cachedConfig.loop && cachedConfig.loop.rateLimits) || {};
  for (var k in prev) {
    if (['llmCallsPerMinute', 'llmCallsPerHour', 'toolExecutionsPerTask', 'tasksPerHour'].indexOf(k) < 0) rl[k] = prev[k];
  }
  var perMin = parseInt(document.getElementById('cfg-rl-llmPerMin').value, 10);
  if (!isNaN(perMin)) rl.llmCallsPerMinute = perMin;
  var perHour = parseInt(document.getElementById('cfg-rl-llmPerHour').value, 10);
  if (!isNaN(perHour)) rl.llmCallsPerHour = perHour;
  var perTask = parseInt(document.getElementById('cfg-rl-toolPerTask').value, 10);
  if (!isNaN(perTask)) rl.toolExecutionsPerTask = perTask;
  var tph = {};
  var rows = document.querySelectorAll('#rl-tph-rows .rl-tph-row');
  for (var i = 0; i < rows.length; i++) {
    var src = rows[i].querySelector('input[type="text"]').value.trim();
    var lim = parseInt(rows[i].querySelector('input[type="number"]').value, 10);
    if (src && !isNaN(lim)) tph[src] = lim;
  }
  if (Object.keys(tph).length > 0) rl.tasksPerHour = tph;
  return rl;
}

/* ── Security: path rows + per-paw filesystem + docker fields ── */
function addPathRow(container, value) {
  var row = document.createElement('div');
  row.className = 'path-row';
  row.style.cssText = 'display:flex;gap:8px;margin-top:6px;align-items:center';
  row.innerHTML = '<input type="text" class="form-input" style="flex:1" placeholder="./data or /abs/path" value="' + esc(String(value || '')) + '">'
    + '<button class="space-btn space-btn-danger" type="button" title="Remove">&times;</button>';
  row.querySelector('button').addEventListener('click', function() { row.remove(); });
  container.appendChild(row);
}
function readPathRows(container) {
  var out = [];
  var inputs = container.querySelectorAll('.path-row input');
  for (var i = 0; i < inputs.length; i++) {
    var v = inputs[i].value.trim();
    if (v) out.push(v);
  }
  return out;
}
function populateGlobalPaths(paths) {
  var c = document.getElementById('sec-global-paths');
  c.innerHTML = '';
  for (var i = 0; i < (paths || []).length; i++) addPathRow(c, paths[i]);
}
function populatePawPaths(paws) {
  var wrap = document.getElementById('sec-paw-paths');
  wrap.innerHTML = '';
  paws = Array.isArray(paws) ? paws : [];
  if (paws.length === 0) {
    wrap.innerHTML = '<div class="form-help">No paws configured yet — add paws first.</div>';
    return;
  }
  for (var i = 0; i < paws.length; i++) {
    var p = paws[i];
    var name = typeof p === 'string' ? p : ((p && p.name) || '');
    if (!name) continue;
    var fsPaths = (p && p.allow && p.allow.filesystem) || [];
    var block = document.createElement('div');
    block.className = 'pp-paw-block';
    block.setAttribute('data-paw', name);
    block.style.cssText = 'border:1px solid var(--border);border-radius:6px;padding:10px;margin-top:8px';
    var title = document.createElement('div');
    title.textContent = name;
    title.style.cssText = 'font-weight:600;font-size:12px';
    var rows = document.createElement('div');
    rows.className = 'pp-paths';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-restart';
    btn.textContent = '+ Add path';
    btn.style.marginTop = '6px';
    (function(rowsEl) {
      btn.addEventListener('click', function() { addPathRow(rowsEl, ''); });
    })(rows);
    block.appendChild(title);
    block.appendChild(rows);
    block.appendChild(btn);
    wrap.appendChild(block);
    for (var j = 0; j < fsPaths.length; j++) addPathRow(rows, fsPaths[j]);
  }
}
function populateDocker(d) {
  d = d || {};
  document.getElementById('cfg-docker-enabled').checked = !!d.enabled;
  document.getElementById('cfg-docker-image').value = d.image || '';
  document.getElementById('cfg-docker-memory').value = d.memory || '';
  document.getElementById('cfg-docker-cpus').value = d.cpus || '';
  document.getElementById('cfg-docker-scope').value = d.scope || 'session';
  document.getElementById('cfg-docker-network').value = d.network || 'none';
  document.getElementById('cfg-docker-domains').value = (d.allowedDomains || []).join(', ');
}
function readDockerFromForm() {
  var d = {};
  // Preserve any keys this form doesn't know about (forward compat).
  var prev = (cachedConfig && cachedConfig.security && cachedConfig.security.docker) || {};
  for (var k in prev) {
    if (['enabled', 'image', 'memory', 'cpus', 'scope', 'network', 'allowedDomains'].indexOf(k) < 0) d[k] = prev[k];
  }
  if (document.getElementById('cfg-docker-enabled').checked) d.enabled = true;
  var image = document.getElementById('cfg-docker-image').value.trim();
  if (image) d.image = image;
  var memory = document.getElementById('cfg-docker-memory').value.trim();
  if (memory) d.memory = memory;
  var cpus = document.getElementById('cfg-docker-cpus').value.trim();
  if (cpus) d.cpus = cpus;
  var scope = document.getElementById('cfg-docker-scope').value;
  if (scope !== 'session') d.scope = scope;
  var network = document.getElementById('cfg-docker-network').value;
  if (network !== 'none') d.network = network;
  var domains = document.getElementById('cfg-docker-domains').value
    .split(',').map(function(s) { return s.trim(); }).filter(Boolean);
  if (domains.length > 0) d.allowedDomains = domains;
  return d;
}

/* ── Tool profiles (per-source allow/deny, names suggested from loaded tools) ── */
function refreshToolNameOptions() {
  var dl = document.getElementById('tool-name-options');
  if (!dl) return;
  var names = (lastStateTools || []).map(function(t) { return t.name; }).sort();
  dl.innerHTML = names.map(function(n) { return '<option value="' + esc(n) + '"></option>'; }).join('');
}
function populateToolProfiles(tp) {
  document.getElementById('tp-blocks').innerHTML = '';
  tp = tp || {};
  for (var src in tp) addTpBlock(src, tp[src]);
}
function addTpBlock(source, profile) {
  profile = profile || {};
  var block = document.createElement('div');
  block.className = 'tp-block';
  block.style.cssText = 'border:1px solid var(--border);border-radius:6px;padding:10px;margin-top:8px';
  var head = document.createElement('div');
  head.style.cssText = 'display:flex;gap:8px;align-items:center';
  head.innerHTML = '<input type="text" class="form-input tp-source" style="flex:1" placeholder="source (e.g. cli)" list="rl-source-options" value="' + esc(String(source || '')) + '">'
    + '<button class="space-btn space-btn-danger" type="button" title="Remove profile">&times;</button>';
  head.querySelector('button').addEventListener('click', function() { block.remove(); });
  var cols = document.createElement('div');
  cols.style.cssText = 'display:flex;gap:12px;margin-top:8px';
  cols.appendChild(buildToolListCol('Allow (empty = all tools)', 'tp-allow', profile.allow || []));
  cols.appendChild(buildToolListCol('Deny', 'tp-deny', profile.deny || []));
  block.appendChild(head);
  block.appendChild(cols);
  document.getElementById('tp-blocks').appendChild(block);
}
function buildToolListCol(label, cls, tools) {
  var col = document.createElement('div');
  col.style.cssText = 'flex:1;min-width:0';
  var lab = document.createElement('div');
  lab.textContent = label;
  lab.style.cssText = 'font-size:11px;color:var(--text-dim);margin-bottom:2px';
  var rows = document.createElement('div');
  rows.className = cls;
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn-restart';
  btn.textContent = '+ Add tool';
  btn.style.marginTop = '6px';
  btn.addEventListener('click', function() { addToolRow(rows, ''); });
  col.appendChild(lab);
  col.appendChild(rows);
  col.appendChild(btn);
  for (var i = 0; i < tools.length; i++) addToolRow(rows, tools[i]);
  return col;
}
function addToolRow(container, value) {
  var row = document.createElement('div');
  row.className = 'tool-row';
  row.style.cssText = 'display:flex;gap:8px;margin-top:6px;align-items:center';
  row.innerHTML = '<input type="text" class="form-input" style="flex:1" placeholder="tool name" list="tool-name-options" value="' + esc(String(value || '')) + '">'
    + '<button class="space-btn space-btn-danger" type="button" title="Remove">&times;</button>';
  row.querySelector('button').addEventListener('click', function() { row.remove(); });
  container.appendChild(row);
}
function readToolRows(container) {
  var out = [];
  var inputs = container.querySelectorAll('.tool-row input');
  for (var i = 0; i < inputs.length; i++) {
    var v = inputs[i].value.trim();
    if (v) out.push(v);
  }
  return out;
}
function readToolProfilesFromForm() {
  var tp = {};
  var blocks = document.querySelectorAll('#tp-blocks .tp-block');
  for (var i = 0; i < blocks.length; i++) {
    var src = blocks[i].querySelector('.tp-source').value.trim();
    if (!src) continue;
    var allow = readToolRows(blocks[i].querySelector('.tp-allow'));
    var deny = readToolRows(blocks[i].querySelector('.tp-deny'));
    var prof = {};
    if (allow.length > 0) prof.allow = allow;
    if (deny.length > 0) prof.deny = deny;
    if (Object.keys(prof).length > 0) tp[src] = prof;
  }
  return tp;
}

function readConfigFromForm() {
  var cfg = {};

  var brain = document.getElementById('cfg-brain').value.trim();
  if (brain) cfg.brain = brain;

  cfg.loop = {};
  var maxIter = parseInt(document.getElementById('cfg-loop-maxIterations').value, 10);
  if (!isNaN(maxIter)) cfg.loop.maxIterations = maxIter;
  cfg.loop.confirmBeforeAct = document.getElementById('cfg-loop-confirmBeforeAct').checked;
  var taskConc = parseInt(document.getElementById('cfg-loop-taskConcurrency').value, 10);
  if (!isNaN(taskConc)) cfg.loop.taskConcurrency = taskConc;
  var compThresh = parseInt(document.getElementById('cfg-loop-compactThreshold').value, 10);
  if (!isNaN(compThresh)) cfg.loop.compactThreshold = compThresh;
  cfg.loop.toolHorizon = document.getElementById('cfg-loop-toolHorizon').checked;
  var maxCtx = parseInt(document.getElementById('cfg-loop-maxContextTokens').value, 10);
  if (!isNaN(maxCtx)) cfg.loop.maxContextTokens = maxCtx;
  var resReserve = parseInt(document.getElementById('cfg-loop-responseReserve').value, 10);
  if (!isNaN(resReserve)) cfg.loop.responseReserve = resReserve;
  cfg.loop.costTracking = document.getElementById('cfg-loop-costTracking').value;
  var costAlert = parseFloat(document.getElementById('cfg-loop-costAlertThreshold').value);
  if (!isNaN(costAlert)) cfg.loop.costAlertThreshold = costAlert;
  var rl = readRateLimitsFromForm();
  if (Object.keys(rl).length > 0) cfg.loop.rateLimits = rl;

  cfg.heartbeat = {};
  cfg.heartbeat.enabled = document.getElementById('cfg-heartbeat-enabled').checked;
  var hbInt = parseInt(document.getElementById('cfg-heartbeat-intervalMinutes').value, 10);
  if (!isNaN(hbInt)) cfg.heartbeat.intervalMinutes = hbInt;
  cfg.heartbeat.runOnStart = document.getElementById('cfg-heartbeat-runOnStart').checked;

  cfg.security = {};
  cfg.security.sandboxFilesystem = document.getElementById('cfg-security-sandboxFilesystem').checked;
  var globalPaths = readPathRows(document.getElementById('sec-global-paths'));
  if (globalPaths.length > 0) cfg.security.allowedPaths = globalPaths;
  var docker = readDockerFromForm();
  if (Object.keys(docker).length > 0) cfg.security.docker = docker;

  try {
    cfg.paws = JSON.parse(document.getElementById('cfg-paws').value);
  } catch (e) {
    throw new Error('Invalid JSON in Paws');
  }

  // Overlay per-paw filesystem paths (Security section) onto the paws config, matched by name.
  if (Array.isArray(cfg.paws)) {
    var blocks = document.querySelectorAll('#sec-paw-paths .pp-paw-block');
    for (var bi = 0; bi < blocks.length; bi++) {
      var pawName = blocks[bi].getAttribute('data-paw');
      var pawPaths = readPathRows(blocks[bi].querySelector('.pp-paths'));
      for (var pi = 0; pi < cfg.paws.length; pi++) {
        var entry = cfg.paws[pi];
        var n = typeof entry === 'string' ? entry : (entry && entry.name);
        if (n !== pawName) continue;
        if (pawPaths.length > 0) {
          if (typeof entry === 'string') { entry = { name: entry }; cfg.paws[pi] = entry; }
          entry.allow = entry.allow || {};
          entry.allow.filesystem = pawPaths;
        } else if (entry && typeof entry === 'object' && entry.allow && entry.allow.filesystem) {
          delete entry.allow.filesystem;
        }
        break;
      }
    }
  }

  var tp = readToolProfilesFromForm();
  if (Object.keys(tp).length > 0) cfg.toolProfiles = tp;

  try {
    cfg.agents = JSON.parse(document.getElementById('cfg-agents').value);
  } catch (e) {
    throw new Error('Invalid JSON in Agents');
  }

  try {
    cfg.net = JSON.parse(document.getElementById('cfg-net').value);
  } catch (e) {
    throw new Error('Invalid JSON in Net (VoleNet)');
  }

  return cfg;
}

function saveConfig() {
  var cfg;
  try {
    cfg = readConfigFromForm();
  } catch (e) {
    showToast(e.message, 'error');
    return;
  }

  var btn = document.getElementById('btn-save-config');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  sendCommand('write_config', { config: cfg }).then(function() {
    showToast('Config saved successfully', 'success');
    cachedConfig = cfg;
  }).catch(function(err) {
    showToast('Failed to save config: ' + err.message, 'error');
  }).finally(function() {
    btn.disabled = false;
    btn.textContent = 'Save Config';
  });
}

/* ── Identity Page ── */
var identityFiles = {
  'SOUL.md': '',
  'USER.md': '',
  'AGENT.md': '',
  'HEARTBEAT.md': '',
  'BRAIN.md': ''
};
var currentIdentityFile = 'SOUL.md';

var identityDescriptions = {
  'SOUL.md': 'Agent personality, tone, and identity. Shapes how the agent communicates.',
  'USER.md': 'User profile and preferences. Helps the agent tailor responses.',
  'AGENT.md': 'Operating rules and behavioral constraints. The agent follows these strictly.',
  'HEARTBEAT.md': 'Recurring job definitions. The agent reads this on each heartbeat wake-up and acts on the instructions.',
  'BRAIN.md': 'Custom system prompt. Overrides the default prompt entirely. Use with care.'
};

function switchIdentityFile(filename) {
  // Save current editor content to cache before switching
  identityFiles[currentIdentityFile] = document.getElementById('identity-editor').value;

  currentIdentityFile = filename;
  var btns = document.querySelectorAll('.identity-file-btn');
  for (var i = 0; i < btns.length; i++) {
    btns[i].classList.toggle('active', btns[i].getAttribute('data-file') === filename);
  }
  document.getElementById('identity-description').textContent = identityDescriptions[filename] || '';
  document.getElementById('identity-editor').value = identityFiles[filename] || '';
}

function loadIdentity() {
  sendCommand('read_identity').then(function(data) {
    if (data && typeof data === 'object') {
      var keys = Object.keys(data);
      for (var i = 0; i < keys.length; i++) {
        if (identityFiles.hasOwnProperty(keys[i])) {
          identityFiles[keys[i]] = data[keys[i]] || '';
        }
      }
    }
    identityLoaded = true;
    document.getElementById('identity-editor').value = identityFiles[currentIdentityFile] || '';
    showToast('Identity files loaded', 'success');
  }).catch(function(err) {
    showToast('Failed to load identity files: ' + err.message, 'error');
  });
}

function saveIdentity() {
  var filename = currentIdentityFile;
  var content = document.getElementById('identity-editor').value;
  identityFiles[filename] = content;

  var btn = document.getElementById('btn-save-identity');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  sendCommand('write_identity', { filename: filename, content: content }).then(function() {
    showToast(filename + ' saved successfully', 'success');
  }).catch(function(err) {
    showToast('Failed to save ' + filename + ': ' + err.message, 'error');
  }).finally(function() {
    btn.disabled = false;
    btn.textContent = 'Save File';
  });
}

/* ── Restart Button ── */
document.getElementById('btn-restart').addEventListener('click', function() {
  if (confirm('Are you sure you want to restart the engine?')) {
    sendCommand('restart_engine').then(function() {
      showToast('Restarting...', 'success');
    }).catch(function(err) {
      showToast('Failed to restart: ' + err.message, 'error');
    });
  }
});

/* ── WebSocket Handlers ── */
ws.onopen = function() {
  dot.classList.add('connected');
  statusText.textContent = 'Connected';
};
ws.onclose = function() {
  dot.classList.remove('connected');
  statusText.textContent = 'Disconnected';
  setTimeout(function() { location.reload(); }, 3000);
};

ws.onmessage = function(evt) {
  var msg = JSON.parse(evt.data);

  // Handle command responses
  if (msg.type === 'response' && msg.id) {
    var pending = pendingCommands.get(msg.id);
    if (pending) {
      clearTimeout(pending.timeout);
      pendingCommands.delete(msg.id);
      if (msg.error) {
        pending.reject(new Error(msg.error));
      } else {
        pending.resolve(msg.data);
      }
    }
    return;
  }

  if (msg.type === 'spaces') {
    renderSpaces(msg.data || []);
    return;
  }

  if (msg.type === 'state') {
    // In control-plane mode, ignore state for spaces other than the selected one.
    if (msg.spaceId && msg.spaceId !== currentSpaceId) return;
    renderState(msg.data || {});
  } else if (msg.type === 'event') {
    if (msg.event && msg.event.indexOf('task:') === 0) {
      chatOnTaskEvent(msg.event, msg.data, msg.spaceId);
    }
    if (!currentSpaceId || msg.spaceId === undefined || msg.spaceId === currentSpaceId) {
      addEvent(msg.event, msg.data);
    }
  }
};

function categoryTag(cat) {
  var colors = { brain: 'tag-purple', channel: 'tag-green', tool: 'tag-blue', infrastructure: 'tag-yellow' };
  return '<span class="tag ' + (colors[cat] || 'tag-blue') + '">' + esc(cat || 'tool') + '</span>';
}

function renderPaws(paws) {
  document.getElementById('paws-count').textContent = paws.length;
  var tbody = document.querySelector('#paws-table tbody');
  if (paws.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty">No paws loaded</td></tr>';
    return;
  }

  // Group by category, ordered: brain -> channel -> tool -> infrastructure
  var order = ['brain', 'channel', 'tool', 'infrastructure'];
  var grouped = {};
  for (var i = 0; i < order.length; i++) grouped[order[i]] = [];
  for (var j = 0; j < paws.length; j++) {
    var cat = paws[j].category || 'tool';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(paws[j]);
  }

  var html = '';
  for (var k = 0; k < order.length; k++) {
    var catName = order[k];
    var items = grouped[catName];
    if (!items || items.length === 0) continue;
    html += '<tr class="group-header"><td colspan="4">'
      + '<strong>' + catName.charAt(0).toUpperCase() + catName.slice(1)
      + '</strong> (' + items.length + ')</td></tr>';
    for (var m = 0; m < items.length; m++) {
      var p = items[m];
      html += '<tr>'
        + '<td title="' + esc(p.name) + '">' + esc(p.name.replace('@openvole/', '')) + '</td>'
        + '<td>' + categoryTag(catName) + '</td>'
        + '<td>' + (p.toolCount != null ? p.toolCount : 0) + '</td>'
        + '<td>' + (p.healthy ? '<span class="tag tag-green">ok</span>' : '<span class="tag tag-red">down</span>') + '</td>'
        + '</tr>';
    }
  }
  tbody.innerHTML = html;
}

function renderTools(tools) {
  document.getElementById('tools-count').textContent = tools.length;
  var tbody = document.querySelector('#tools-table tbody');
  tbody.innerHTML = tools.length === 0
    ? '<tr><td colspan="3" class="empty">No tools registered</td></tr>'
    : tools.map(function(t) { return '<tr>'
      + '<td title="' + esc(t.name) + '">' + esc(t.name) + '</td>'
      + '<td title="' + esc(t.pawName) + '">' + esc(t.pawName) + '</td>'
      + '<td><span class="tag tag-blue">' + (t.inProcess ? 'in-process' : 'subprocess') + '</span></td>'
      + '</tr>'; }).join('');
}

function renderSkills(skills) {
  document.getElementById('skills-count').textContent = skills.length;
  var tbody = document.querySelector('#skills-table tbody');
  tbody.innerHTML = skills.length === 0
    ? '<tr><td colspan="3" class="empty">No skills loaded</td></tr>'
    : skills.map(function(s) { return '<tr>'
      + '<td title="' + esc(s.name) + '">' + esc(s.name) + '</td>'
      + '<td>' + (s.active ? '<span class="tag tag-green">active</span>' : '<span class="tag tag-red">inactive</span>') + '</td>'
      + '<td>' + (s.missingTools && s.missingTools.length ? esc(s.missingTools.join(', ')) : '\\u2014') + '</td>'
      + '</tr>'; }).join('');
}

function renderTasks(tasks) {
  // Sort: running first, then queued, then completed/failed (most recent first)
  var sorted = tasks.slice().sort(function(a, b) {
    var orderMap = { running: 0, queued: 1, completed: 2, failed: 3, cancelled: 4 };
    var oa = orderMap[a.status] != null ? orderMap[a.status] : 5;
    var ob = orderMap[b.status] != null ? orderMap[b.status] : 5;
    if (oa !== ob) return oa - ob;
    return (b.createdAt || 0) - (a.createdAt || 0);
  });
  document.getElementById('tasks-count').textContent = tasks.length;
  var tbody = document.querySelector('#tasks-table tbody');
  tbody.innerHTML = sorted.length === 0
    ? '<tr><td colspan="6" class="empty">No tasks</td></tr>'
    : sorted.map(function(t) {
      var elapsed = formatElapsed(t);
      var sTag = sourceClass(t.source);
      return '<tr>'
        + '<td>' + esc(t.id ? t.id.substring(0, 8) : '') + '</td>'
        + '<td><span class="tag ' + sTag + '">' + esc(t.source) + '</span></td>'
        + '<td title="' + esc(t.input || '') + '">' + esc((t.input || '').substring(0, 50)) + '</td>'
        + '<td><span class="tag ' + statusClass(t.status) + '">' + esc(t.status) + '</span></td>'
        + '<td>' + elapsed + '</td>'
        + '<td>' + formatCost(t) + '</td>'
        + '</tr>';
    }).join('');
}

function sourceClass(s) {
  if (s === 'user') return 'tag-blue';
  if (s === 'paw') return 'tag-green';
  if (s === 'heartbeat') return 'tag-yellow';
  if (s === 'schedule') return 'tag-orange';
  return 'tag-blue';
}

function formatElapsed(t) {
  if (t.status === 'running' && t.startedAt) {
    var ms = Date.now() - t.startedAt;
    return formatMs(ms) + '...';
  }
  if (t.completedAt && t.startedAt) {
    return formatMs(t.completedAt - t.startedAt);
  }
  if (t.status === 'queued') return 'waiting';
  return '\\u2014';
}

function formatCost(t) {
  var cost = t.metadata ? t.metadata.cost : null;
  if (!cost) return '\\u2014';
  var total = cost.totalCost;
  if (total === 0) return 'free';
  var tokens = (cost.totalInputTokens || 0) + (cost.totalOutputTokens || 0);
  var tokensStr = tokens > 1000 ? (tokens / 1000).toFixed(1) + 'K' : tokens;
  if (total < 0.001) return tokensStr + ' tok';
  return '$' + total.toFixed(4) + ' (' + tokensStr + ' tok)';
}

function formatMs(ms) {
  if (ms < 1000) return ms + 'ms';
  if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
  return (ms / 60000).toFixed(1) + 'm';
}

function renderSchedules(schedules) {
  document.getElementById('schedules-count').textContent = schedules.length;
  var tbody = document.querySelector('#schedules-table tbody');
  tbody.innerHTML = schedules.length === 0
    ? '<tr><td colspan="4" class="empty">No active schedules</td></tr>'
    : schedules.map(function(s) {
      var nextRun = s.nextRun ? new Date(s.nextRun).toLocaleString() : '\\u2014';
      return '<tr>'
        + '<td>' + esc(s.id) + '</td>'
        + '<td title="' + esc(s.input) + '">' + esc((s.input || '').substring(0, 40)) + '</td>'
        + '<td><span class="tag tag-yellow">' + esc(s.cron) + '</span></td>'
        + '<td>' + nextRun + '</td>'
        + '</tr>';
    }).join('');
}

function renderVoleNet(data) {
  var panel = document.getElementById('volenet-panel');
  if (!data || !data.enabled) {
    panel.style.display = 'none';
    return;
  }
  panel.style.display = '';

  var status = document.getElementById('volenet-status');
  var leaderBadge = data.isLeader
    ? '<span class="tag tag-green">leader</span>'
    : '<span class="tag tag-blue">follower</span>';
  var leaderInfo = data.leaderState && data.leaderState.leaderName
    ? ' \\u2014 leader: ' + esc(data.leaderState.leaderName)
    : '';

  status.innerHTML = '<strong>' + esc(data.instanceName || 'vole') + '</strong> '
    + '<span class="tag tag-purple">' + esc(data.instanceId || '') + '</span> '
    + leaderBadge
    + ' \\u2014 ' + (data.peers ? data.peers.length : 0) + ' peer(s), '
    + (data.remoteTools || 0) + ' remote tool(s)'
    + leaderInfo;

  var peers = data.peers || [];
  var tbody = document.querySelector('#volenet-peers-table tbody');
  tbody.innerHTML = peers.length === 0
    ? '<tr><td colspan="4" class="empty">No peers connected</td></tr>'
    : peers.map(function(p) {
      var roleTag = p.role === 'coordinator'
        ? '<span class="tag tag-yellow">coordinator</span>'
        : p.role === 'worker'
          ? '<span class="tag tag-blue">worker</span>'
          : '<span class="tag tag-green">peer</span>';
      var ago = p.lastSeen ? Math.round((Date.now() - p.lastSeen) / 1000) + 's ago' : '\\u2014';
      return '<tr>'
        + '<td><strong>' + esc(p.name) + '</strong> <span class="tag tag-purple">' + esc(p.id) + '</span></td>'
        + '<td>' + roleTag + '</td>'
        + '<td>' + (p.capabilities || 0) + '</td>'
        + '<td>' + ago + '</td>'
        + '</tr>';
    }).join('');
}

function statusClass(s) {
  if (s === 'completed') return 'tag-green';
  if (s === 'running') return 'tag-blue';
  if (s === 'failed' || s === 'cancelled') return 'tag-red';
  return 'tag-yellow';
}

function addEvent(name, data) {
  var el = document.createElement('div');
  el.className = 'event-line';
  if (name === 'rate:limited') el.className += ' rate-limited';
  if (name === 'task:failed') el.className += ' task-failed';
  var time = new Date().toLocaleTimeString();
  var dataStr = typeof data === 'object' ? JSON.stringify(data) : String(data || '');
  el.innerHTML = '<span class="time">' + time + '</span>'
    + '<span class="name">' + esc(name) + '</span>'
    + '<span class="data">' + esc(dataStr) + '</span>';
  eventLog.prepend(el);
  while (eventLog.children.length > MAX_EVENTS) eventLog.lastChild.remove();
}

function esc(s) {
  if (!s) return '';
  var d = document.createElement('div');
  d.textContent = String(s);
  return d.innerHTML;
}
</script>
</body>
</html>`
}
