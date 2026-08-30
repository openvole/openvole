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

  /* ── Overview: compact summary cards ── */
  .ov { flex: 1; overflow: hidden; display: flex; flex-direction: column; }
  .sum-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
    gap: 12px;
    padding: 16px;
    flex-shrink: 0;
  }
  .sumcard { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; display: flex; flex-direction: column; }
  .sumcard-head {
    display: flex; align-items: center; justify-content: space-between;
    padding: 8px 12px; cursor: pointer; border-bottom: 1px solid var(--border);
    background: var(--sc-tint, var(--surface)); transition: filter .12s;
  }
  .sumcard-head:hover { filter: brightness(1.08); }
  .sumcard-head h3 { margin: 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text); font-weight: 600; display: flex; align-items: center; gap: 6px; }
  .sumcard-head .sc-arrow { color: var(--text-dim); font-size: 15px; line-height: 1; }
  .sumcard-body { padding: 12px; flex: 1; }
  .sumcard-metric { font-size: 24px; font-weight: 700; color: var(--text); font-family: var(--mono); line-height: 1.1; }
  .sumcard-metric small { font-size: 13px; color: var(--text-dim); font-weight: 500; }
  .sumcard-sub { font-size: 11px; color: var(--text-dim); margin-top: 6px; line-height: 1.4; }
  .sc-chip { display: inline-block; font-size: 10px; padding: 1px 7px; border-radius: 999px; background: var(--bg); border: 1px solid var(--border); color: var(--text-dim); margin: 3px 3px 0 0; }
  .sc-chip b { color: var(--text); font-weight: 600; }
  .sc-chip-off { opacity: .5; border-style: dashed; }
  .sumcard.paws    { --sc-tint: color-mix(in srgb, var(--accent) 9%, var(--surface)); }
  .sumcard.tools   { --sc-tint: color-mix(in srgb, #5aa9ff 11%, var(--surface)); }
  .sumcard.skills  { --sc-tint: color-mix(in srgb, var(--green) 12%, var(--surface)); }
  .sumcard.volenet { --sc-tint: color-mix(in srgb, var(--accent3, #d2a8ff) 15%, var(--surface)); }
  .sumcard.sched   { --sc-tint: color-mix(in srgb, var(--yellow) 13%, var(--surface)); }
  .tasks-panel { margin: 0 16px 16px; border: 1px solid var(--border); border-radius: 10px; overflow: hidden; flex-shrink: 0; }
  .tasks-panel .panel-header { border-bottom: 1px solid var(--border); background: color-mix(in srgb, var(--accent) 7%, var(--surface)); }
  /* Fixed height: the list must not grow as tasks arrive, or it eats the Live Events pane below. */
  .tasks-panel .panel-body { height: 260px; }
  .tasks-panel td.task-when { color: var(--text-dim); }

  /* ── Detail drawer ── */
  .drawer-scrim { position: fixed; inset: 0; background: rgba(0,0,0,0.45); opacity: 0; pointer-events: none; transition: opacity .2s; z-index: 60; }
  .drawer-scrim.open { opacity: 1; pointer-events: auto; }
  .drawer { position: fixed; top: 0; right: 0; height: 100%; width: min(500px, 94vw); background: var(--surface); border-left: 1px solid var(--border); transform: translateX(100%); transition: transform .22s ease; z-index: 61; display: flex; flex-direction: column; box-shadow: -8px 0 24px rgba(0,0,0,0.25); }
  .drawer.open { transform: translateX(0); }
  .drawer-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
  .drawer-head h3 { margin: 0; font-size: 14px; text-transform: uppercase; letter-spacing: 0.06em; }
  .drawer-close { background: none; border: none; color: var(--text-dim); font-size: 22px; cursor: pointer; line-height: 1; padding: 0 4px; }
  .drawer-close:hover { color: var(--text); }
  .drawer-body { flex: 1; overflow-y: auto; padding: 12px 18px 24px; }
  .kv { display: grid; grid-template-columns: auto 1fr; gap: 4px 14px; font-size: 12px; margin: 4px 0 10px; }
  .kv dt { color: var(--text-dim); }
  .kv dd { margin: 0; color: var(--text); word-break: break-word; }

  /* ── Responsive: nav + overview + drawer ── */
  @media (max-width: 680px) {
    .tab-bar { padding: 0 8px; overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none; }
    .tab-bar::-webkit-scrollbar { display: none; }
    .tab-btn { flex-shrink: 0; padding: 11px 12px 9px; }
    .sum-grid { grid-template-columns: 1fr 1fr; gap: 8px; padding: 10px; }
    .tasks-panel { margin: 0 10px 10px; }
    .tasks-panel .panel-body { height: 200px; }
    .ov { overflow-y: auto; }
    .events-bar { flex: 0 0 auto; min-height: 220px; }
    .drawer { width: 100vw; }
  }
  @media (max-width: 400px) { .sum-grid { grid-template-columns: 1fr; } }
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
    flex: 1 1 0;
    min-height: 120px;
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
  .event-line .data { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
  /* Expanded: the whole payload, wrapped and selectable. The one-line form is a preview, not
     the record — nothing is dropped, so a click always shows everything the event carried. */
  .event-line.expanded { display: block; }
  .event-line.expanded .data {
    display: block;
    white-space: pre-wrap;
    word-break: break-word;
    overflow: visible;
    text-overflow: clip;
    color: var(--text);
    background: #0d0d13;
    border-left: 2px solid var(--accent);
    padding: 6px 8px;
    margin-top: 4px;
    max-height: 40vh;
    overflow-y: auto;
    cursor: text;
    user-select: text;
  }
  .event-line.rate-limited .name { color: var(--orange); }
  .event-line.task-failed .name { color: var(--red); }
  .events-day {
    background: var(--bg); color: var(--text-dim); border: 1px solid var(--border);
    border-radius: 4px; font-family: var(--mono); font-size: 10px; padding: 1px 4px;
    max-width: 130px;
  }
  .events-raw { color: var(--accent); font-family: var(--mono); font-size: 10px; text-decoration: none; }
  .events-raw:hover { text-decoration: underline; }
  .events-raw.off { color: #444; pointer-events: none; }
  .events-note { color: var(--text-dim); font-family: var(--mono); font-size: 10px; padding: 2px 0 4px; }
  .empty { color: var(--text-dim); font-style: italic; font-size: 12px; padding: 8px 0; }

  /* --- Projects & tasks --- */
  .proj-layout { display: grid; grid-template-columns: 260px minmax(0,1fr); gap: 16px; align-items: start; }
  .proj-list-pane { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 12px; }
  .proj-list-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
  .proj-list-head h3 { margin: 0; font-size: 13px; }
  .btn-sm { padding: 3px 10px; font-size: 11px; }
  .proj-item { padding: 8px 10px; border-radius: 6px; cursor: pointer; border: 1px solid transparent; margin-bottom: 4px; }
  .proj-item:hover { background: var(--surface-hover); }
  .proj-item.active { background: var(--surface-hover); border-color: var(--accent); }
  .proj-item-name { font-size: 13px; font-weight: 500; display: flex; align-items: center; gap: 6px; }
  /* A report routed to this project's chat while you were elsewhere. */
  .proj-unread { font-size: 10px; font-family: var(--mono); line-height: 1; padding: 2px 6px; border-radius: 999px; background: var(--accent); color: var(--bg); flex-shrink: 0; }
  .proj-item-meta { font-size: 11px; color: var(--text-dim); margin-top: 2px; display: flex; gap: 6px; }
  .proj-archived .proj-item-name { color: var(--text-dim); }
  .proj-showall { display: block; margin-top: 10px; font-size: 11px; color: var(--text-dim); cursor: pointer; }
  .proj-detail-pane { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 16px; min-height: 240px; }
  .proj-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  .proj-title { margin: 0 0 4px; font-size: 16px; }
  .proj-sub { font-size: 12px; color: var(--text-dim); word-break: break-all; }
  .proj-actions { display: flex; gap: 6px; flex-wrap: wrap; }
  .proj-context-line { display: flex; align-items: center; gap: 6px; margin: 12px 0 0; font-size: 11px; color: var(--text-dim); cursor: pointer; user-select: none; }
  .proj-context-line:hover { color: var(--text); }
  .proj-context-caret { display: inline-block; width: 8px; flex-shrink: 0; }
  .proj-context-gist { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .proj-context-none { margin: 12px 0 0; font-size: 11px; color: var(--text-dim); }
  .proj-context { margin: 8px 0 0; padding: 10px 12px; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; font-size: 12px; white-space: pre-wrap; max-height: 40vh; overflow: auto; color: var(--text-dim); }
  .proj-board { display: grid; gap: 14px; margin-top: 14px; }
  .board-col-title { font-size: 11px; text-transform: uppercase; letter-spacing: .07em; color: var(--text-dim); margin-bottom: 6px; display: flex; align-items: center; gap: 6px; }
  .board-dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }
  .task-row { border: 1px solid var(--border); border-radius: 6px; padding: 9px 11px; margin-bottom: 6px; background: var(--bg); }
  .task-goal { font-size: 13px; }
  .task-meta { font-size: 11px; color: var(--text-dim); margin-top: 4px; }
  .task-next { display: inline-block; font-size: 10px; padding: 1px 6px; border-radius: 999px; background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--accent); margin-left: 6px; }
  /* Task lifecycle: one summary line, expanding to the full trail of state changes. */
  .task-life { display: flex; align-items: center; gap: 5px; margin-top: 4px; font-size: 11px; color: var(--text-dim); user-select: none; }
  .task-life[onclick] { cursor: pointer; }
  .task-life[onclick]:hover { color: var(--text); }
  .task-life-caret { display: inline-block; width: 8px; flex-shrink: 0; }
  .task-life-caret-off { opacity: .45; }
  .task-life-dim { opacity: .7; }
  .task-life-trail { margin: 4px 0 0 13px; padding-left: 9px; border-left: 1px solid var(--border); }
  .task-life-row { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--text-dim); padding: 2px 0; }
  .task-life-state { min-width: 76px; color: var(--text); }
  .task-life-at { font-family: var(--mono); font-size: 10px; }
  .task-life-note { color: var(--orange); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .task-note { font-size: 11px; color: var(--orange); margin-top: 4px; }
  .task-crit { font-size: 11px; color: var(--text-dim); margin-top: 4px; padding-left: 12px; }
  .task-actions { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 7px; }
  .task-actions button { padding: 2px 8px; font-size: 10px; }
  .path-row { display: flex; gap: 6px; }
  .path-row .form-input { flex: 1; min-width: 0; }
  .dir-crumb { font-size: 11px; color: var(--text-dim); word-break: break-all; margin-bottom: 8px; }
  .dir-list { max-height: 260px; overflow: auto; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); }
  .dir-entry { padding: 6px 10px; font-size: 12px; cursor: pointer; display: flex; align-items: center; gap: 7px; }
  .dir-entry:hover { background: var(--surface-hover); }
  .dir-up { color: var(--text-dim); }
  .dir-grant { margin-top: 10px; font-size: 11px; padding: 8px 10px; border-radius: 6px; border: 1px solid var(--orange); background: rgba(219,109,40,.08); }
  .dir-ok { margin-top: 10px; font-size: 11px; color: var(--green); }
  .draft-row { display: flex; gap: 6px; margin: 10px 0 6px; }
  .draft-row .form-input { flex: 1; min-width: 0; }
  .draft-help { font-size: 11px; color: var(--text-dim); margin-bottom: 8px; min-height: 14px; }
  .draft-help.bad { color: var(--orange); }
  .proj-subtabs { display: flex; gap: 4px; margin: 14px 0 12px; border-bottom: 1px solid var(--border); }
  .proj-subtab { background: none; border: none; border-bottom: 2px solid transparent; color: var(--text-dim); font-size: 12px; padding: 6px 12px; cursor: pointer; }
  .proj-subtab:hover { color: var(--text); }
  .proj-subtab.active { color: var(--accent); border-bottom-color: var(--accent); }
  .pchat { display: flex; flex-direction: column; height: 46vh; min-height: 280px; }
  .pchat-messages { flex: 1; overflow-y: auto; padding: 4px 2px; display: flex; flex-direction: column; gap: 8px; }
  .pchat-composer { display: flex; gap: 6px; margin-top: 10px; }
  .pchat-composer textarea { flex: 1; resize: none; min-height: 40px; max-height: 140px; }
  .pchat-hint { font-size: 11px; color: var(--text-dim); flex: 1; min-width: 0; }
  .pchat-foot { display: flex; align-items: flex-start; gap: 10px; margin-top: 6px; }
  .pchat-actions { display: flex; gap: 6px; flex-shrink: 0; }
  .pchat-earlier { align-self: center; margin-bottom: 6px; }
  .task-assignee { display: inline-block; font-size: 10px; padding: 1px 6px; border-radius: 999px; border: 1px solid var(--accent-line, var(--border)); color: var(--accent); margin-left: 6px; }
  .pf-roots { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
  .pf-root { background: none; border: 1px solid var(--border); border-radius: 999px; color: var(--text-dim); font-size: 11px; padding: 3px 10px; cursor: pointer; }
  .pf-root.active { color: var(--accent); border-color: var(--accent); }
  .pf-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
  .pf-crumb { flex: 1; min-width: 0; font-family: var(--mono); font-size: 11px; color: var(--text-dim); overflow-wrap: anywhere; }
  .pf-crumb a { color: var(--accent); cursor: pointer; text-decoration: none; }
  .pf-crumb a:hover { text-decoration: underline; }
  .pf-abs { font-family: var(--mono); font-size: 10px; color: var(--text-dim); opacity: .7; margin-bottom: 8px; overflow-wrap: anywhere; }
  .pf-grid { display: grid; grid-template-columns: 1.1fr 1.4fr; gap: 12px; align-items: start; }
  .pf-list { border: 1px solid var(--border); border-radius: 6px; max-height: 52vh; overflow-y: auto; }
  .pf-row { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-bottom: 1px solid var(--border); font-size: 12px; }
  .pf-row:last-child { border-bottom: none; }
  .pf-row:hover { background: var(--surface-hover, rgba(127,127,127,.08)); }
  .pf-name { flex: 1; min-width: 0; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pf-name.dir { color: var(--accent); }
  .pf-name.open { font-weight: 600; }
  .pf-size { font-family: var(--mono); font-size: 10px; color: var(--text-dim); flex-shrink: 0; }
  .pf-row-actions { display: flex; gap: 4px; opacity: 0; flex-shrink: 0; }
  .pf-row:hover .pf-row-actions { opacity: 1; }
  .pf-row-actions button { background: none; border: none; color: var(--text-dim); cursor: pointer; font-size: 11px; padding: 0 3px; }
  .pf-row-actions button:hover { color: var(--text); }
  .pf-lock { font-size: 10px; color: var(--text-dim); flex-shrink: 0; }
  .pf-edit { border: 1px solid var(--border); border-radius: 6px; padding: 10px; }
  .pf-edit-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .pf-edit-name { flex: 1; min-width: 0; font-family: var(--mono); font-size: 11px; overflow-wrap: anywhere; }
  .pf-edit textarea { width: 100%; min-height: 44vh; font-family: var(--mono); font-size: 12px; resize: vertical; }
  .pf-dirty { color: var(--orange); font-size: 10px; }
  .pf-listwrap { position: relative; }
  .pf-drop { position: absolute; inset: 0; display: none; align-items: center; justify-content: center; background: color-mix(in srgb, var(--accent) 14%, transparent); border: 2px dashed var(--accent); border-radius: 6px; color: var(--accent); font-size: 12px; pointer-events: none; z-index: 2; }
  .pf-listwrap.dragging .pf-drop { display: flex; }
  .pf-uploads { margin-top: 8px; display: flex; flex-direction: column; gap: 4px; }
  .pf-upload { display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--text-dim); }
  .pf-upload-bar { flex: 1; height: 3px; background: var(--border); border-radius: 2px; overflow: hidden; }
  .pf-upload-bar i { display: block; height: 100%; width: 0; background: var(--accent); transition: width .15s linear; }
  .pf-upload.bad { color: var(--red, var(--orange)); }
  @media (max-width: 760px) {
    .proj-layout { grid-template-columns: 1fr; }
    .proj-list-pane { order: -1; }
    .pf-grid { grid-template-columns: 1fr; }
    .pf-list { max-height: 34vh; }
    .pf-row-actions { opacity: 1; }
  }
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
  .switch {
    position: relative;
    display: inline-block;
    width: 40px;
    height: 22px;
    flex: 0 0 auto;
  }
  .switch input {
    opacity: 0;
    width: 0;
    height: 0;
  }
  .switch-slider {
    position: absolute;
    inset: 0;
    background: var(--surface-hover);
    border: 1px solid var(--border);
    border-radius: 999px;
    transition: 0.15s;
    cursor: pointer;
  }
  .switch-slider::before {
    content: '';
    position: absolute;
    height: 16px;
    width: 16px;
    left: 2px;
    top: 2px;
    background: var(--text-dim);
    border-radius: 50%;
    transition: 0.15s;
  }
  .switch input:checked + .switch-slider {
    background: var(--accent);
    border-color: var(--accent);
  }
  .switch input:checked + .switch-slider::before {
    transform: translateX(18px);
    background: #fff;
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

  /* Paws editor (per-paw grant cards) */
  .paws-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 10px; }
  .paws-raw-toggle { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-dim); white-space: nowrap; cursor: pointer; }
  .paw-card { border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px; margin-top: 10px; background: var(--surface); }
  .paw-card-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; cursor: pointer; }
  .paw-card-title { display: flex; align-items: center; gap: 8px; min-width: 0; flex-wrap: wrap; }
  .paw-card-arrow { display: inline-block; color: var(--text-dim); font-size: 10px; transition: transform 0.15s; }
  .paw-card:not(.collapsed) .paw-card-arrow { transform: rotate(90deg); }
  .paw-card.collapsed .paw-card-body { display: none; }
  .paw-card-summary { font-size: 11px; color: var(--text-dim); font-family: var(--mono); }
  .paw-card-title .paw-name { font-weight: 600; font-size: 13px; word-break: break-all; }
  .paw-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .paw-dot.ok { background: var(--green, #3fb950); }
  .paw-dot.bad { background: var(--text-dim); }
  .paw-badge { font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-dim); border: 1px solid var(--border); border-radius: 4px; padding: 1px 5px; }
  .paw-note { margin-top: 6px; font-style: italic; }
  .paw-card-body { margin-top: 10px; display: flex; flex-direction: column; gap: 14px; }
  .paw-field-label { font-size: 12px; font-weight: 600; margin-bottom: 4px; }
  .paw-env-grid { display: flex; flex-wrap: wrap; gap: 6px 16px; margin-top: 4px; }
  .paw-env-item { display: flex; align-items: center; gap: 6px; font-size: 12px; font-family: var(--mono); }
  .paw-row { display: flex; gap: 8px; margin-top: 6px; align-items: center; }
  .paw-row .form-input { flex: 1; }
  .paw-adv-summary { cursor: pointer; font-size: 12px; color: var(--text-dim); user-select: none; }
  .paw-adv-summary:hover { color: var(--text); }

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
  /* Sidebar + thread, the shape every chat client has: the list is the navigation, not a
     dropdown you have to open to find out what is in it. */
  .chat-shell { display: grid; grid-template-columns: 250px 1fr; gap: 16px; max-width: 1100px; width: 100%; margin: 0 auto; padding: 16px 24px; height: calc(100vh - 210px); min-height: 320px; }
  .chat-side { display: flex; flex-direction: column; min-height: 0; border-right: 1px solid var(--border); padding-right: 14px; }
  .chat-side-head { display: flex; gap: 6px; margin-bottom: 8px; }
  .chat-side-toggle { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--text-dim); cursor: pointer; padding: 4px 0 8px; user-select: none; }
  .chat-side-toggle:hover { color: var(--text); }
  .chat-side-list { flex: 1; overflow-y: auto; min-height: 0; display: flex; flex-direction: column; gap: 2px; }
  .chat-side-note { font-size: 10px; color: var(--text-dim); padding-top: 8px; }
  .chat-item { text-align: left; background: none; border: 1px solid transparent; border-radius: 6px; padding: 7px 9px; cursor: pointer; color: var(--text); font: inherit; display: flex; flex-direction: column; gap: 2px; }
  .chat-item:hover { background: var(--surface-hover); }
  .chat-item.active { background: var(--surface-hover); border-color: var(--accent); }
  .chat-item-top { display: flex; align-items: center; gap: 6px; }
  .chat-item-name { font-size: 12px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
  .chat-item-when { font-size: 10px; color: var(--text-dim); font-family: var(--mono); flex-shrink: 0; }
  .chat-item-sub { font-size: 10px; color: var(--text-dim); }
  .chat-item-unread { font-size: 10px; font-family: var(--mono); line-height: 1; padding: 2px 6px; border-radius: 999px; background: var(--accent); color: var(--bg); flex-shrink: 0; }
  .chat-main { display: flex; flex-direction: column; min-height: 0; }
  .chat-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
  .chat-head-title { font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chat-readonly { font-size: 11px; color: var(--text-dim); text-align: center; padding: 10px; border-top: 1px solid var(--border); margin-top: 10px; }
  @media (max-width: 760px) { .chat-shell { grid-template-columns: 1fr; } .chat-side { border-right: none; border-bottom: 1px solid var(--border); padding-right: 0; padding-bottom: 10px; max-height: 34vh; } }
  .chat-messages { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; padding: 4px; min-height: 0; }
  .chat-msg { max-width: 78%; padding: 10px 14px; border-radius: 12px; font-size: 13px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
  .chat-msg-user { align-self: flex-end; background: var(--accent); color: #fff; border-bottom-right-radius: 4px; }
  .chat-msg-brain { align-self: flex-start; background: var(--surface); border: 1px solid var(--border); color: var(--text); border-bottom-left-radius: 4px; }
  .chat-msg-error { align-self: flex-start; background: rgba(255,80,80,0.12); border: 1px solid var(--red); color: var(--text); border-bottom-left-radius: 4px; }
  .chat-msg-pending { color: var(--text-dim); font-style: italic; }
  /* Wraps a bubble so the stamp sits under it without joining the bubble's own text flow. */
  .chat-row { display: flex; flex-direction: column; gap: 3px; max-width: 78%; }
  .chat-row-user { align-self: flex-end; align-items: flex-end; }
  .chat-row-brain, .chat-row-error { align-self: flex-start; align-items: flex-start; }
  .chat-row .chat-msg { max-width: 100%; }
  .chat-meta { font-size: 10px; color: var(--text-dim); font-family: var(--mono); padding: 0 4px; display: flex; gap: 6px; }
  .chat-meta-who { font-family: var(--font); font-weight: 500; }
  .chat-composer { display: flex; gap: 8px; margin-top: 10px; }
  .chat-empty { color: var(--text-dim); text-align: center; margin-top: 40px; font-size: 13px; }
  #tab-panel { padding: 0; }
  .apps-layout { display: flex; height: calc(100vh - 150px); min-height: 360px; }
  .apps-nav { flex: 0 0 180px; border-right: 1px solid var(--border); padding: 12px 8px; display: flex; flex-direction: column; gap: 2px; overflow-y: auto; }
  .apps-nav-item { text-align: left; padding: 8px 12px; border-radius: 6px; background: transparent; border: 1px solid transparent; color: var(--text-dim); font-size: 13px; cursor: pointer; transition: background 0.15s, color 0.15s; }
  .apps-nav-item:hover { background: var(--surface-hover); color: var(--text); }
  .apps-nav-item.active { background: var(--surface); border-color: var(--border); color: var(--text); font-weight: 600; }
  .apps-empty { color: var(--text-dim); padding: 40px; }
  #panel-frame { flex: 1; min-width: 0; width: 100%; height: 100%; border: 0; background: var(--bg); display: block; }
  .apps-empty-state { height: calc(100vh - 150px); min-height: 360px; display: flex; align-items: center; justify-content: center; padding: 24px; }
  .apps-empty-inner { max-width: 460px; text-align: center; }
  .apps-empty-title { font-size: 15px; font-weight: 600; color: var(--text); margin-bottom: 8px; }
  .apps-empty-text { font-size: 13px; color: var(--text-dim); line-height: 1.6; }
  .apps-empty-text code { background: var(--bg); border: 1px solid var(--border); border-radius: 4px; padding: 1px 5px; font-size: 12px; font-family: var(--mono); }
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
  /* ── VoleNet tab ── */
  .vn-statuscard { max-width: 1100px; margin: 12px auto 0; width: 100%; border: 1px solid var(--border); border-radius: 10px; padding: 12px 16px; background: color-mix(in srgb, var(--accent3, #d2a8ff) 9%, var(--surface)); flex-shrink: 0; }
  .vn-sc-main { font-size: 14px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .vn-sc-stats { display: flex; gap: 18px; flex-wrap: wrap; margin-top: 8px; font-size: 12px; color: var(--text-dim); }
  .vn-sc-stats b { color: var(--text); font-family: var(--mono); }
  .vn-sc-off { color: var(--text-dim); font-size: 13px; }
  .vn-page { display: flex; flex: 1 1 auto; min-height: 300px; max-width: 1100px; margin: 12px auto 0; width: 100%; overflow: hidden; }
  .vn-peers { flex: 0 0 240px; border-right: 1px solid var(--border); overflow-y: auto; padding: 8px; display: flex; flex-direction: column; gap: 2px; }
  .vn-peers-head { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text); font-weight: 600; padding: 8px 10px; margin: -8px -8px 6px; background: color-mix(in srgb, var(--accent3, #d2a8ff) 12%, var(--surface)); border-bottom: 1px solid var(--border); position: sticky; top: -8px; }
  @media (max-width: 680px) {
    .vn-page { flex-direction: column; margin-top: 8px; }
    .vn-peers { flex: 0 0 auto; max-height: 190px; border-right: none; border-bottom: 1px solid var(--border); }
    .vn-statuscard { margin: 8px 10px 0; }
    .vn-sc-stats { gap: 12px; }
  }
  .vn-peer { text-align: left; padding: 8px 10px; border-radius: 6px; background: transparent; border: 1px solid transparent; color: var(--text); font-size: 13px; cursor: pointer; display: flex; align-items: center; gap: 8px; }
  .vn-peer:hover { background: var(--surface-hover); }
  .vn-peer.active { background: var(--surface); border-color: var(--border); font-weight: 600; }
  .vn-dot { width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto; background: var(--text-dim); }
  .vn-dot.online { background: var(--green); }
  .vn-peer-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .vn-group-head { font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-dim); padding: 12px 10px 4px; }
  .vn-group-head:first-child { padding-top: 4px; }
  .vn-dot.relay { background: transparent; border: 1.5px solid var(--accent3, #d2a8ff); box-sizing: border-box; }
  .vn-dot.relay.online { background: var(--accent3, #d2a8ff); }
  .vn-relay-tag { font-size: 9px; color: var(--accent3, #d2a8ff); border: 1px solid var(--accent3, #d2a8ff); border-radius: 999px; padding: 0 4px; letter-spacing: 0.04em; flex: 0 0 auto; }
  .vn-relay-tag.vn-tag-wait { color: var(--text-dim); border-color: var(--border); }
  .vn-relay-tag.vn-tag-new { color: var(--accent); border-color: var(--accent); }
  .vn-info { flex: 0 0 auto; color: var(--text-dim); cursor: pointer; font-size: 13px; padding: 0 2px; }
  .vn-info:hover { color: var(--accent); }
  .vn-msg-relayed { font-size: 10px; color: var(--accent3, #d2a8ff); margin: 0 0 2px 2px; }
  .vn-connect-toggle { float: right; font-size: 10px; padding: 1px 8px; border-radius: 6px; border: 1px solid var(--accent); background: none; color: var(--accent); cursor: pointer; }
  .vn-connect-toggle:hover { background: var(--accent); color: #fff; }
  #vn-connect-panel { border: 1px solid var(--border); border-radius: 8px; padding: 10px; margin-bottom: 10px; display: flex; flex-direction: column; gap: 6px; font-size: 12px; }
  .vn-connect-row { display: flex; gap: 12px; color: var(--text-dim); font-size: 11px; }
  .vn-connect-row label { display: flex; align-items: center; gap: 4px; cursor: pointer; }
  .vn-connect-actions { display: flex; gap: 6px; }
  #vn-connect-result { font-size: 11px; color: var(--text-dim); word-break: break-all; }
  .vn-fingerprint { font-family: monospace; color: var(--accent3, #d2a8ff); margin: 2px 0; }
  .vn-file-bubble { border: 1px dashed var(--border); }
  .vn-file-note { font-size: 12px; margin-top: 4px; }
  .vn-attach-chip { display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--text-dim); border: 1px dashed var(--border); border-radius: 8px; padding: 4px 10px; margin: 0 0 6px; }
  .vn-attach-chip button { border: none; background: none; color: var(--text-dim); cursor: pointer; font-size: 14px; line-height: 1; }
  .vn-attach-chip button:hover { color: var(--red, #f85149); }
  .vn-file-state { font-size: 11px; color: var(--text-dim); margin-top: 3px; word-break: break-all; }
  .vn-file-actions { display: flex; gap: 6px; margin-top: 6px; }
  .vn-file-actions button { font-size: 11px; padding: 3px 10px; }
  .vn-group-req { color: var(--accent); }
  .vn-req { margin: 2px 6px 8px; padding: 8px 10px; border: 1px solid var(--accent3, #d2a8ff); border-radius: 8px; background: color-mix(in srgb, var(--accent3, #d2a8ff) 8%, transparent); }
  .vn-req-top { display: flex; align-items: baseline; gap: 6px; }
  .vn-req-via { font-size: 10px; color: var(--text-dim); }
  .vn-req-note { font-size: 11px; color: var(--text-dim); margin: 4px 0 0; word-break: break-word; }
  .vn-req-actions { display: flex; gap: 6px; margin-top: 8px; }
  .vn-req-ok, .vn-req-no { flex: 1; font-size: 11px; border-radius: 6px; padding: 4px 0; cursor: pointer; border: 1px solid var(--border); background: var(--bg); color: var(--text); }
  .vn-req-ok { background: var(--accent); border-color: var(--accent); color: #fff; }
  .vn-req-ok:hover { filter: brightness(1.08); }
  .vn-req-no:hover { border-color: var(--text-dim); }
  .vn-connect { max-width: 420px; margin: 24px auto; text-align: center; color: var(--text-dim); font-size: 13px; line-height: 1.5; }
  .vn-connect-title { font-size: 15px; font-weight: 600; color: var(--text); margin-bottom: 8px; }
  .vn-connect b { color: var(--text); }
  .vn-connect-btn { margin-top: 14px; font-size: 13px; padding: 8px 18px; border-radius: 8px; border: 1px solid var(--accent); background: var(--accent); color: #fff; cursor: pointer; }
  .vn-connect-btn:hover { filter: brightness(1.08); }
  .vn-badge { background: var(--accent); color: #fff; font-size: 10px; border-radius: 9px; padding: 1px 6px; min-width: 16px; text-align: center; }
  .tab-btn .vn-badge, .agent-card-name .vn-badge { margin-left: 6px; display: inline-block; }
  .vn-chat { flex: 1; min-width: 0; display: flex; flex-direction: column; padding: 12px 16px; }
  .vn-chat-head { font-size: 13px; font-weight: 600; color: var(--text); padding-bottom: 8px; border-bottom: 1px solid var(--border); margin-bottom: 8px; display: flex; align-items: center; gap: 8px; }
  .vn-empty { color: var(--text-dim); text-align: center; margin-top: 60px; font-size: 13px; }

  /* ── Agents launcher + view switching ── */
  body[data-view="agents"] .tab-bar,
  body[data-view="agents"] .main,
  body[data-view="agents"] #header-agent,
  body[data-view="agents"] .header-right .stats,
  body[data-view="agents"] #btn-restart { display: none !important; }
  body[data-view="dashboard"] #view-agents { display: none !important; }

  .header-agent { display: flex; align-items: center; gap: 10px; margin-right: 12px; }
  .btn-back { background: transparent; border: 1px solid var(--border); color: var(--text-dim); padding: 5px 10px; border-radius: 6px; cursor: pointer; font-size: 12px; }
  .btn-back:hover { color: var(--text); border-color: var(--text-dim); }
  .header-agent-name { font-weight: 600; color: var(--text); font-size: 14px; }

  .view-agents { flex: 1; overflow-y: auto; padding: 40px 24px; max-width: 1000px; width: 100%; margin: 0 auto; }
  .agents-hero { margin-bottom: 28px; }
  .agents-hero h1 { font-size: 26px; font-weight: 700; color: var(--text); margin-bottom: 8px; }
  .agents-hero p { color: var(--text-dim); font-size: 14px; max-width: 620px; margin-bottom: 16px; line-height: 1.5; }
  .agents-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 16px; }
  .agents-empty { color: var(--text-dim); padding: 40px; text-align: center; border: 1px dashed var(--border); border-radius: 10px; grid-column: 1 / -1; }
  .agent-card { border: 1px solid var(--border); border-radius: 10px; background: var(--surface); padding: 16px; display: flex; flex-direction: column; gap: 10px; transition: border-color 0.15s, transform 0.15s; }
  .agent-card:hover { border-color: var(--accent); transform: translateY(-1px); }
  .agent-card-head { display: flex; align-items: center; justify-content: space-between; }
  .agent-card-name { font-weight: 600; font-size: 15px; color: var(--text); }
  .agent-orch-badge { font-size: 10px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.04em; color: var(--accent); border: 1px solid var(--accent); border-radius: 4px; padding: 1px 5px; margin-left: 6px; vertical-align: middle; }
  .agent-card-meta { color: var(--text-dim); font-size: 11px; font-family: ui-monospace, monospace; }
  .agent-card-actions { display: flex; gap: 8px; margin-top: 4px; }
  .agent-status { font-size: 10px; padding: 2px 8px; border-radius: 999px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
  .agent-status-running { background: rgba(0,200,100,0.15); color: var(--green); }
  .agent-status-stopped { background: var(--surface-hover); color: var(--text-dim); }
  .agent-btn { background: var(--surface-hover); border: 1px solid var(--border); color: var(--text); padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; }
  .agent-btn:hover { border-color: var(--text-dim); }
  .agent-btn-danger:hover { color: var(--red); border-color: var(--red); }
  /* ── Modal (create agent + onboarding) ── */
  .modal-overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.55); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 16px; }
  .modal-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 24px; width: 460px; max-width: 100%; max-height: calc(100vh - 48px); overflow-y: auto; box-shadow: 0 16px 48px rgba(0, 0, 0, 0.45); }
  .modal-title { font-size: 18px; font-weight: 600; margin: 0 0 4px; }
  .modal-sub { font-size: 13px; color: var(--text-dim); margin: 0 0 18px; line-height: 1.5; }
  .modal-input { width: 100%; box-sizing: border-box; padding: 10px 12px; font-size: 14px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-family: var(--mono); }
  .modal-input:focus { border-color: var(--accent); outline: none; }
  .modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
  .onboard-item { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px; margin-top: 8px; cursor: pointer; }
  .onboard-item:hover { border-color: var(--accent); }
  .onboard-item input { margin-top: 3px; flex: 0 0 auto; accent-color: var(--accent); cursor: pointer; }
  .onboard-name { font-weight: 600; font-size: 13px; }
  .onboard-pkg { opacity: 0.6; font-weight: 400; font-size: 11px; font-family: var(--mono); }
  .onboard-desc { font-size: 12px; color: var(--text-dim); margin-top: 2px; line-height: 1.4; }
</style>
</head>
<body data-view="agents">
<header>
  <div class="logo-group">
    <a href="https://openvole.com" target="_blank" class="logo-link">
      <img src="/assets/vole.png" alt="OpenVole" onerror="this.style.display='none'">
      <h1><span>Open</span>Vole</h1>
    </a>
  </div>
  <div class="header-right">
    <div class="header-agent" id="header-agent">
      <button class="btn-back" onclick="showAgentsView()" title="Back to agents">&#8592; Agents</button>
      <span class="header-agent-name" id="header-agent-name"></span>
      <span class="agent-status" id="header-agent-status"></span>
      <button class="btn-restart" id="btn-agent-start" title="Start agent" onclick="agentAction('start_agent')">Start</button>
      <button class="btn-restart" id="btn-agent-stop" title="Stop agent" onclick="agentAction('stop_agent')">Stop</button>
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

<div id="view-agents" class="view-agents">
  <div class="agents-hero">
    <h1>Your Agents</h1>
    <p>Each agent is fully isolated — its own brain, paws, memory, and identity. Open one to manage it, or create a new one.</p>
    <button class="btn-primary" onclick="createAgentPrompt()">+ New agent</button>
  </div>
  <div class="agents-grid" id="agents-grid"></div>
</div>

<div class="tab-bar">
  <button class="tab-btn active" data-tab="overview" onclick="switchTab('overview')">Overview</button>
  <button class="tab-btn" data-tab="chat" onclick="switchTab('chat')">&#129504; Chat</button>
  <button class="tab-btn" data-tab="projects" onclick="switchTab('projects')">Projects</button>
  <button class="tab-btn" data-tab="apps" id="tab-btn-apps" onclick="switchTab('apps')" style="display:none">Apps</button>
  <button class="tab-btn" data-tab="config" onclick="switchTab('config')">Config</button>
  <button class="tab-btn" data-tab="identity" onclick="switchTab('identity')">Identity</button>
  <button class="tab-btn" data-tab="volenet" onclick="switchTab('volenet')">VoleNet</button>
</div>

<div class="main">
  <div id="tab-overview" class="tab-content">
    <div class="ov">
      <div class="sum-grid">
        <div class="sumcard paws">
          <div class="sumcard-head" onclick="openDetail('paws')" title="View all paws"><h3>Paws</h3><span class="sc-arrow">&#8250;</span></div>
          <div class="sumcard-body" id="sum-paws"></div>
        </div>
        <div class="sumcard tools">
          <div class="sumcard-head" onclick="openDetail('tools')" title="View all tools"><h3>Tools</h3><span class="sc-arrow">&#8250;</span></div>
          <div class="sumcard-body" id="sum-tools"></div>
        </div>
        <div class="sumcard skills">
          <div class="sumcard-head" onclick="openDetail('skills')" title="View all skills"><h3>Skills</h3><span class="sc-arrow">&#8250;</span></div>
          <div class="sumcard-body" id="sum-skills"></div>
        </div>
        <div class="sumcard volenet" id="sum-volenet-card" style="display:none">
          <div class="sumcard-head" onclick="switchTab('volenet')" title="Open the VoleNet tab"><h3>VoleNet</h3><span class="sc-arrow">&#8250;</span></div>
          <div class="sumcard-body" id="sum-volenet"></div>
        </div>
        <div class="sumcard sched">
          <div class="sumcard-head" onclick="openDetail('schedules')" title="View all schedules"><h3>Schedules</h3><span class="sc-arrow">&#8250;</span></div>
          <div class="sumcard-body" id="sum-schedules"></div>
        </div>
      </div>

      <div class="tasks-panel">
        <div class="panel-header"><h2>Tasks <span class="count" id="tasks-count">0</span></h2></div>
        <div class="panel-body">
          <table id="tasks-table">
            <thead><tr><th>ID</th><th>Source</th><th>Input</th><th>Status</th><th>When</th><th>Took</th><th>Cost</th></tr></thead>
            <tbody></tbody>
          </table>
        </div>
      </div>

      <div class="events-bar">
        <div class="events-header">
          <h2>Live Events</h2>
          <select class="events-day" id="events-day" onchange="eventsDayChange()" title="Live feed, or a day from the saved log"></select>
          <a class="events-raw" id="events-raw" href="#" target="_blank" rel="noopener" title="Open the raw JSONL log for this day">raw</a>
          <button onclick="eventsClear()">Clear</button>
        </div>
        <div class="events-note" id="events-note"></div>
        <div class="events-body" id="event-log"></div>
      </div>
    </div>
  </div>

  <div class="drawer-scrim" id="drawer-scrim" onclick="closeDetail()"></div>
  <div class="drawer" id="detail-drawer" role="dialog" aria-modal="true">
    <div class="drawer-head"><h3 id="drawer-title">Detail</h3><button class="drawer-close" onclick="closeDetail()" aria-label="Close">&times;</button></div>
    <div class="drawer-body" id="drawer-body"></div>
  </div>

  <div id="tab-chat" class="tab-content" style="display:none">
    <div class="chat-shell">
      <aside class="chat-side">
        <div class="chat-side-head">
          <button class="btn-restart btn-sm" type="button" onclick="newChatSession()" title="Start a fresh conversation">+ New</button>
          <button class="btn-restart btn-sm" id="btn-chat-read-all" style="display:none" onclick="chatMarkAllRead()" title="Clear unread on every session of this agent">Mark read</button>
        </div>
        <label class="chat-side-toggle" title="Conversations between this agent and its siblings. Read-only — you are not a participant.">
          <input type="checkbox" id="chat-show-agents" onchange="chatToggleAgents()">
          <span>Inter-agent chats</span>
        </label>
        <div class="chat-side-list" id="chat-side-list"></div>
        <div class="chat-side-note" id="chat-note"></div>
      </aside>
      <div class="chat-main">
        <div class="chat-head">
          <div class="chat-head-title" id="chat-head-title">dashboard</div>
          <button class="btn-restart btn-sm" type="button" id="btn-chat-clear" onclick="clearChatSession()" title="Delete this session's transcript">Clear</button>
        </div>
        <div class="chat-messages" id="chat-messages"></div>
        <div class="chat-composer" id="chat-composer">
          <input type="text" class="form-input" id="chat-input" placeholder="Message the brain&hellip;" onkeydown="if(event.key==='Enter'){sendChat();}">
          <button class="btn-primary" id="chat-send" onclick="sendChat()">Send</button>
        </div>
        <div class="chat-readonly" id="chat-readonly" style="display:none">
          You are reading a conversation between two agents. Only they can post here.
        </div>
      </div>
    </div>
  </div>

  <div id="tab-projects" class="tab-content" style="display:none">
    <div class="proj-layout">
      <div class="proj-list-pane">
        <div class="proj-list-head">
          <h3>Projects</h3>
          <button class="btn-primary btn-sm" onclick="openCreateProject()">New</button>
        </div>
        <div id="proj-list"></div>
        <label class="proj-showall"><input type="checkbox" id="proj-show-archived" onchange="loadProjects()"> show archived</label>
      </div>
      <div class="proj-detail-pane" id="proj-detail">
        <div class="empty">Select a project, or create one.</div>
      </div>
    </div>
  </div>

  <div id="tab-volenet" class="tab-content" style="display:none">
    <div class="vn-statuscard" id="vn-statuscard"></div>
    <div class="vn-page">
      <div class="vn-peers">
        <div class="vn-peers-head">Connected nodes <button class="vn-connect-toggle" onclick="vnToggleConnect()" title="Pair with a node or join a public hub">+ Connect</button></div>
        <div id="vn-connect-panel" style="display:none">
          <input type="text" class="form-input" id="vn-connect-url" placeholder="http://host:9700 or hub URL">
          <div class="vn-connect-row">
            <label><input type="radio" name="vn-connect-mode" value="pair" checked> Pair (a node you operate)</label>
            <label><input type="radio" name="vn-connect-mode" value="join"> Join (public hub)</label>
          </div>
          <input type="text" class="form-input" id="vn-connect-note" placeholder="note for the other operator (optional)">
          <div id="vn-connect-result"></div>
          <div class="vn-connect-actions">
            <button class="btn-primary" id="vn-connect-go" onclick="vnConnectGo()">Check</button>
            <button class="btn-restart" onclick="vnToggleConnect()">Cancel</button>
          </div>
        </div>
        <div id="vn-peer-list"></div>
      </div>
      <div class="vn-chat">
        <div class="vn-chat-head" id="vn-chat-head">Select a node to chat</div>
        <div class="chat-messages" id="vn-messages"><div class="vn-empty">Pick a node on the left to start chatting.</div></div>
        <div class="chat-composer" id="vn-composer" style="display:none">
          <button class="btn-restart" id="vn-attach" title="Send a file (VoleDrop)" onclick="document.getElementById('vn-file').click()">&#128206;</button>
          <input type="file" id="vn-file" style="display:none" onchange="uploadVnFile(this)">
          <input type="text" class="form-input" id="vn-input" placeholder="Message this node&hellip;" onkeydown="if(event.key==='Enter'){sendVolenetChat();}">
          <button class="btn-primary" id="vn-send" onclick="sendVolenetChat()">Send</button>
        </div>
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
          <h3>Brain <a class="docs-link" href="https://openvole.com/openvole/paws-brain" target="_blank" onclick="event.stopPropagation()">docs</a></h3>
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
          <h3>Heartbeat <a class="docs-link" href="https://openvole.com/openvole/configuration#heartbeat" target="_blank" onclick="event.stopPropagation()">docs</a></h3>
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
          <h3>Loop <a class="docs-link" href="https://openvole.com/openvole/configuration#loop" target="_blank" onclick="event.stopPropagation()">docs</a></h3>
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
          <h3>Security <a class="docs-link" href="https://openvole.com/openvole/configuration#security" target="_blank" onclick="event.stopPropagation()">docs</a></h3>
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
            <div class="form-help">Edited per paw in the <b>Paws</b> section below — each paw's allow.filesystem.</div>
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
          <h3>Paws <a class="docs-link" href="https://openvole.com/openvole/paws" target="_blank" onclick="event.stopPropagation()">docs</a></h3>
          <span class="config-section-arrow">&#9660;</span>
        </div>
        <div class="config-section-body">
          <div class="form-field">
            <div class="paws-head">
              <div class="form-help">Grant each paw only the permissions its manifest requests. Toggle a permission to allow it; leave it off to withhold. Effective access is always the paw's request &cap; what you grant.</div>
              <label class="paws-raw-toggle"><input type="checkbox" id="cfg-paws-rawmode" onchange="togglePawsRaw(this.checked)"> Raw JSON</label>
            </div>
            <div id="cfg-paws-form"></div>
            <div id="cfg-paws-raw-wrap" style="display:none">
              <div class="form-help">Array of paw configs. Each entry is a string or { name, allow: { network, listen, filesystem, env, childProcess }, hooks }.</div>
              <textarea class="form-textarea" id="cfg-paws" rows="10" placeholder='["@openvole/paw-brain"]'>[]</textarea>
            </div>
            <button class="btn-restart" type="button" id="btn-browse-paws" onclick="browsePaws()" style="margin-top:8px">Browse official paws</button>
            <div id="paw-catalog" style="margin-top:8px"></div>
          </div>
        </div>
      </div>

      <div class="config-section">
        <div class="config-section-header" onclick="toggleSection(this)">
          <h3>Tool Profiles <a class="docs-link" href="https://openvole.com/openvole/configuration#toolprofiles" target="_blank" onclick="event.stopPropagation()">docs</a></h3>
          <span class="config-section-arrow">&#9660;</span>
        </div>
        <div class="config-section-body">
          <div class="form-field">
            <div class="form-help">Restrict which tools each task source may use. Allow = only these tools (empty = all); Deny = always blocked. Exact tool names — no wildcards. Suggestions come from the tools loaded in this agent.</div>
            <div id="tp-blocks"></div>
            <button class="btn-restart" type="button" onclick="addTpBlock('', {})" style="margin-top:6px">+ Add source profile</button>
            <datalist id="tool-name-options"></datalist>
          </div>
        </div>
      </div>

      <div class="config-section">
        <div class="config-section-header" onclick="toggleSection(this)">
          <h3>Sub-agents <a class="docs-link" href="https://openvole.com/openvole/configuration#agents" target="_blank" onclick="event.stopPropagation()">docs</a></h3>
          <span class="config-section-arrow">&#9660;</span>
        </div>
        <div class="config-section-body">
          <div class="form-field">
            <div class="form-help">Named agent profiles for sub-agent spawning. Each has a role, instructions, allow/deny tools, and a max-iterations cap. Tool suggestions come from the tools loaded in this agent.</div>
            <div id="ag-blocks"></div>
            <button class="btn-restart" type="button" onclick="addAgBlock('', {})" style="margin-top:6px">+ Add agent</button>
          </div>
        </div>
      </div>

      <div class="config-section">
        <div class="config-section-header" onclick="toggleSection(this)">
          <h3>Net (VoleNet) <a class="docs-link" href="https://openvole.com/openvole/volenet" target="_blank" onclick="event.stopPropagation()">docs</a></h3>
          <span class="config-section-arrow">&#9660;</span>
        </div>
        <div class="config-section-body">
          <div class="form-field">
            <div class="form-help">Distributed networking — connect instances into a mesh to share tools, memory, and brain. Off by default.</div>
            <div class="form-checkbox-row">
              <label class="switch"><input type="checkbox" id="cfg-net-enabled"><span class="switch-slider"></span></label>
              <label class="form-checkbox-label" for="cfg-net-enabled">net.enabled &mdash; turn VoleNet on/off</label>
            </div>
          </div>
          <div class="form-field">
            <label class="form-label">net.instanceName</label>
            <input type="text" class="form-input" id="cfg-net-instanceName" placeholder="(hostname)">
          </div>
          <div class="form-field">
            <label class="form-label">net.role</label>
            <select class="form-select" id="cfg-net-role">
              <option value="">(default)</option>
              <option value="coordinator">coordinator</option>
              <option value="worker">worker</option>
              <option value="peer">peer</option>
            </select>
          </div>
          <div class="form-field">
            <label class="form-label">net.port</label>
            <input type="number" class="form-input" id="cfg-net-port" placeholder="(default)" min="1" style="width:160px">
          </div>
          <div class="form-field">
            <label class="form-label">net.hostname</label>
            <div class="form-help">Host advertised to peers. Set to your public domain/IP when followers connect over the internet (also must match a TLS cert).</div>
            <input type="text" class="form-input" id="cfg-net-hostname" placeholder="(auto: first non-internal IPv4)">
          </div>
          <div class="form-field">
            <label class="form-label">net.publicUrl</label>
            <div class="form-help">Full endpoint advertised INSTEAD of hostname:port — for running behind a reverse proxy (e.g. https://club.example.com/mesh) so the raw VoleNet port never has to be exposed.</div>
            <input type="text" class="form-input" id="cfg-net-publicUrl" placeholder="(none — advertise hostname:port)">
          </div>
          <div class="form-field">
            <label class="form-label">net.keyPath</label>
            <input type="text" class="form-input" id="cfg-net-keyPath" placeholder="path to shared key">
          </div>
          <div class="form-field">
            <label class="form-label">net.peers</label>
            <div class="form-help">Other instances to connect to. trust: full | tool | read. allowTools empty = all.</div>
            <div id="net-peers"></div>
            <button class="btn-restart" type="button" onclick="addNetPeer({})" style="margin-top:6px">+ Add peer</button>
          </div>
          <div class="form-field">
            <label class="form-label">net.share</label>
            <div class="form-checkbox-row"><input type="checkbox" class="form-checkbox" id="cfg-net-share-tools"><label class="form-checkbox-label" for="cfg-net-share-tools">share.tools</label></div>
            <div class="form-checkbox-row" style="margin-top:6px"><input type="checkbox" class="form-checkbox" id="cfg-net-share-memory"><label class="form-checkbox-label" for="cfg-net-share-memory">share.memory</label></div>
            <div class="form-checkbox-row" style="margin-top:6px"><input type="checkbox" class="form-checkbox" id="cfg-net-share-session"><label class="form-checkbox-label" for="cfg-net-share-session">share.session</label></div>
          </div>
          <div class="form-field">
            <label class="form-label">net.brainSource</label>
            <div class="form-help">local | remote | &lt;instanceName&gt;</div>
            <input type="text" class="form-input" id="cfg-net-brainSource" placeholder="local">
          </div>
          <div class="form-field">
            <label class="form-label">net.discovery</label>
            <select class="form-select" id="cfg-net-discovery">
              <option value="">(default)</option>
              <option value="manual">manual</option>
              <option value="mdns">mdns</option>
            </select>
          </div>
          <div class="form-field">
            <label class="form-label">net.encrypt</label>
            <div class="form-help">Direct end-to-end encryption — seal messages to capable peers with the hybrid X25519 + ML-KEM-768 (post-quantum) KEM. Confidentiality independent of TLS; older peers still get plaintext.</div>
            <div class="form-checkbox-row"><input type="checkbox" class="form-checkbox" id="cfg-net-encrypt"><label class="form-checkbox-label" for="cfg-net-encrypt">encrypt direct messages</label></div>
          </div>
          <div class="form-field">
            <label class="form-label">net.publishNames</label>
            <div class="form-help">Include peer display names in the public /volenet/info response. Off by default (names are an enumeration surface). Turn on for a public hub whose members are meant to be seen.</div>
            <div class="form-checkbox-row"><input type="checkbox" class="form-checkbox" id="cfg-net-publishNames"><label class="form-checkbox-label" for="cfg-net-publishNames">publish peer names on /volenet/info</label></div>
          </div>
          <div class="form-field">
            <label class="form-label">net.leader</label>
            <div class="form-help">auto | &lt;instanceName&gt;</div>
            <input type="text" class="form-input" id="cfg-net-leader" placeholder="auto">
          </div>
          <div class="form-field">
            <label class="form-label">net.heartbeatMode</label>
            <select class="form-select" id="cfg-net-heartbeatMode">
              <option value="">(default)</option>
              <option value="leader">leader</option>
              <option value="independent">independent</option>
            </select>
          </div>
          <div class="form-field">
            <label class="form-label">net.brainMode</label>
            <select class="form-select" id="cfg-net-brainMode">
              <option value="">(default)</option>
              <option value="local">local</option>
              <option value="loadbalance">loadbalance</option>
            </select>
          </div>
          <div class="form-field">
            <label class="form-label">net.taskOverflow</label>
            <select class="form-select" id="cfg-net-taskOverflow">
              <option value="">(default)</option>
              <option value="reject">reject</option>
              <option value="forward">forward</option>
            </select>
          </div>
          <div class="form-field">
            <label class="form-label">net.maxQueuedTasks</label>
            <input type="number" class="form-input" id="cfg-net-maxQueuedTasks" placeholder="10" min="1" style="width:160px">
          </div>
          <div class="form-field">
            <label class="form-label">net.tls</label>
            <input type="text" class="form-input" id="cfg-net-tls-cert" placeholder="cert path" style="margin-bottom:6px">
            <input type="text" class="form-input" id="cfg-net-tls-key" placeholder="key path">
          </div>
          <div class="form-field">
            <label class="form-label">net.maxConnections</label>
            <div class="form-help">Max concurrent inbound WebSocket connections (DoS cap).</div>
            <input type="number" class="form-input" id="cfg-net-maxConnections" placeholder="1000" min="1" style="width:160px">
          </div>
          <div class="form-field">
            <label class="form-label">net.authTimeoutMs</label>
            <div class="form-help">Close inbound sockets that don't authenticate within this many ms.</div>
            <input type="number" class="form-input" id="cfg-net-authTimeoutMs" placeholder="10000" min="1000" style="width:160px">
          </div>
          <div class="form-field">
            <label class="form-label">net.maxMessagesPerSecond</label>
            <div class="form-help">Global inbound message ceiling across all sources (load shed).</div>
            <input type="number" class="form-input" id="cfg-net-maxMessagesPerSecond" placeholder="5000" min="1" style="width:160px">
          </div>
          <div class="form-field">
            <label class="form-label">net.relay</label>
            <div class="form-help">Blind relay (hub): forward sealed member-to-member envelopes the hub cannot read. v1 carries end-to-end encrypted chat only.</div>
            <div class="form-checkbox-row"><input type="checkbox" class="form-checkbox" id="cfg-net-relay-enabled"><label class="form-checkbox-label" for="cfg-net-relay-enabled">relay.enabled</label></div>
            <div class="form-grid-2">
              <input type="number" class="form-input" id="cfg-net-relay-maxPerMinutePerPair" placeholder="maxPerMinutePerPair (30)">
              <input type="number" class="form-input" id="cfg-net-relay-maxBytes" placeholder="maxBytes (65536)">
            </div>
            <div class="form-help" style="margin-top:8px">relay.acceptFrom — who may reach you over a relay. Blank = only peers you approve or already trust. <code>*</code> = any hub member. Or a comma-separated list of names / id-prefixes.</div>
            <input type="text" class="form-input" id="cfg-net-relay-acceptFrom" placeholder="acceptFrom (blank, * , or name,id-prefix,…)">
          </div>
          <div class="form-field">
            <label class="form-label">net.publicJoin</label>
            <div class="form-help">Let unknown peers self-register over HTTP. Off by default; guests never get 'full' trust.</div>
            <div class="form-checkbox-row"><input type="checkbox" class="form-checkbox" id="cfg-net-pj-enabled"><label class="form-checkbox-label" for="cfg-net-pj-enabled">publicJoin.enabled</label></div>
            <label class="form-label" style="margin-top:6px">trustLevel</label>
            <select class="form-select" id="cfg-net-pj-trustLevel">
              <option value="">(default: tool)</option>
              <option value="read">read</option>
              <option value="tool">tool</option>
            </select>
            <div class="form-checkbox-row" style="margin-top:6px"><input type="checkbox" class="form-checkbox" id="cfg-net-pj-allowBrain"><label class="form-checkbox-label" for="cfg-net-pj-allowBrain">allowBrain (guests use your brain &mdash; you pay)</label></div>
            <label class="form-label" style="margin-top:6px">maxPeers</label>
            <input type="number" class="form-input" id="cfg-net-pj-maxPeers" placeholder="200" min="1" style="width:160px">
            <label class="form-label" style="margin-top:6px">ratePerMinute</label>
            <input type="number" class="form-input" id="cfg-net-pj-ratePerMinute" placeholder="5" min="1" style="width:160px">
            <div class="form-checkbox-row" style="margin-top:6px"><input type="checkbox" class="form-checkbox" id="cfg-net-pj-requireApproval"><label class="form-checkbox-label" for="cfg-net-pj-requireApproval">requireApproval (queue joins for manual trust)</label></div>
          </div>
          <div class="form-field">
            <label class="form-label">net.chatRetention</label>
            <div class="form-help">Cap stored peer-chat history. maxMessages per peer; maxAgeDays prunes old sessions.</div>
            <label class="form-label" style="margin-top:6px">maxMessages</label>
            <input type="number" class="form-input" id="cfg-net-cr-maxMessages" placeholder="1000" min="1" style="width:160px">
            <label class="form-label" style="margin-top:6px">maxAgeDays</label>
            <input type="number" class="form-input" id="cfg-net-cr-maxAgeDays" placeholder="90" min="1" style="width:160px">
          </div>
          <div class="form-field">
            <label class="form-label">net.files (VoleDrop)</label>
            <div class="form-help">E2E-encrypted file transfer. acceptFrom auto-accepts offers (blank = every offer needs an explicit accept; use * or a name/id list for your own fleet). Files land in inboxDir, sha256-verified.</div>
            <div class="form-checkbox-row"><input type="checkbox" class="form-checkbox" id="cfg-net-files-enabled" checked><label class="form-checkbox-label" for="cfg-net-files-enabled">enabled</label></div>
            <label class="form-label" style="margin-top:6px">inboxDir</label>
            <input type="text" class="form-input" id="cfg-net-files-inboxDir" placeholder=".openvole/net/inbox">
            <label class="form-label" style="margin-top:6px">acceptFrom</label>
            <input type="text" class="form-input" id="cfg-net-files-acceptFrom" placeholder="acceptFrom (blank, * , or name,id-prefix,…)">
            <label class="form-label" style="margin-top:6px">maxBytes</label>
            <input type="number" class="form-input" id="cfg-net-files-maxBytes" placeholder="268435456" min="1" style="width:200px">
            <label class="form-label" style="margin-top:6px">relayQuotaBytes (hub) / relayTtlHours (hub)</label>
            <div style="display:flex;gap:8px">
              <input type="number" class="form-input" id="cfg-net-files-relayQuotaBytes" placeholder="536870912" min="1" style="width:200px">
              <input type="number" class="form-input" id="cfg-net-files-relayTtlHours" placeholder="24" min="1" style="width:120px">
            </div>
          </div>
          <div class="form-field">
            <label class="form-label">net.routing</label>
            <div class="form-help">Route patterns &rarr; target instance. key = pattern, value = instanceName.</div>
            <div id="net-routing"></div>
            <button class="btn-restart" type="button" onclick="addNetRoute('', '')" style="margin-top:6px">+ Add route</button>
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
      <div class="draft-row">
        <input class="form-input" id="identity-draft-prompt" placeholder="Describe it in a sentence and let the agent write the file&hellip;">
        <button class="btn-subtle btn-sm" id="identity-draft-btn" onclick="draftIdentityFile()">Draft</button>
      </div>
      <div class="draft-help" id="identity-draft-help"></div>
      <textarea class="identity-textarea" id="identity-editor" spellcheck="false"></textarea>
      <div class="identity-save-row">
        <button class="btn-primary" id="btn-save-identity" onclick="saveIdentity()">Save File</button>
      </div>
    </div>
  </div>

  <div id="tab-panel" class="tab-content" style="display:none">
    <div class="apps-layout" id="apps-layout">
      <nav class="apps-nav" id="apps-nav"></nav>
      <iframe id="panel-frame" title="Paw app" sandbox="allow-scripts"></iframe>
    </div>
    <div id="apps-empty" class="apps-empty-state" style="display:none"></div>
  </div>

  <footer>
    <a href="https://github.com/openvole/openvole" target="_blank">GitHub</a>
    <span class="footer-sep">&middot;</span>
    <a href="https://openvole.com/openvole/" target="_blank">Docs</a>
    <span class="footer-sep">&middot;</span>
    <a href="https://paw.openvole.com" target="_blank">PawHub</a>
    <span class="footer-sep">&middot;</span>
    <a href="https://hub.openvole.com" target="_blank">VoleHub</a>
    <span class="footer-sep">&middot;</span>
    <a href="https://net.openvole.com" target="_blank">VoleNet</a>
    <span class="footer-sep">&middot;</span>
    <a href="https://www.npmjs.com/package/openvole" target="_blank">npm</a>
  </footer>
</div>

<div class="toast-container" id="toast-container"></div>

<div class="modal-overlay" id="modal-overlay" style="display:none" onclick="if(event.target===this)closeModal()"><div class="modal-card" id="modal-card" role="dialog" aria-modal="true"></div></div>

<script>
const wsScheme = location.protocol === 'https:' ? 'wss://' : 'ws://';
const wsAuthority = location.host || (location.hostname + ':' + ${wsPort});
const ws = new WebSocket(wsScheme + wsAuthority + '/ws' + location.search);
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
    // Every command names its own target. The server otherwise falls back to the connection's
    // selected agent, which is only correct if select_agent always lands first — it doesn't,
    // and that race answered chat_history/read_config for the PREVIOUS agent. Callers that
    // deliberately address another agent (start/stop/select) pass agentId themselves and win.
    var p = params || {};
    if (p.agentId === undefined && currentAgentId) {
      p = Object.assign({}, p, { agentId: currentAgentId });
    }
    const timeout = setTimeout(function() {
      pendingCommands.delete(id);
      reject(new Error('Command timed out: ' + type));
    }, timeoutMs || 10000);
    pendingCommands.set(id, { resolve: resolve, reject: reject, timeout: timeout });
    ws.send(JSON.stringify({ type: type, id: id, params: p }));
  });
}

/**
 * View generation — bumped every time the selected agent changes.
 *
 * An in-flight response belongs to the agent that was selected when it was requested. Painting
 * it afterwards writes one agent's data into another's view: that is how the chat showed the
 * previous agent's history, and how the config form once offered to save the wrong agent's
 * settings. Any async load that renders agent-scoped data captures the epoch first and calls
 * viewChanged() before touching the DOM.
 */
var viewEpoch = 0;
function viewChanged(epoch) { return epoch !== viewEpoch; }

/* ── Agents (control-plane mode) ── */
var currentAgentId = null;
var lastAgents = [];
var lastStatePaws = [];
var lastStateTasks = [];
var lastStateTools = [];
var lastStateSkills = [];
var lastStateSchedules = [];
var lastStateVolenet = { enabled: false };
var drawerSection = null; // which section's detail drawer is open (null = closed)

/*
 * Where you were, remembered across a reload.
 *
 * The page reloads itself when the websocket drops (sleep, a network blip, a server restart), and
 * without this every one of those dumped you back on the agents list — reading as "the dashboard
 * randomly went home" rather than as a reconnect. sessionStorage rather than localStorage so two
 * browser tabs can sit on different agents without fighting over one slot.
 */
var VIEW_KEY = 'voleView';
var viewRestored = false;

function saveView() {
  try {
    if (!currentAgentId) { sessionStorage.removeItem(VIEW_KEY); return; }
    sessionStorage.setItem(VIEW_KEY, JSON.stringify({
      agentId: currentAgentId,
      tab: currentTab,
      projectId: currentProjectId || null
    }));
  } catch (e) { /* private mode, or a full quota — not worth failing the click over */ }
}

function readSavedView() {
  try { return JSON.parse(sessionStorage.getItem(VIEW_KEY) || 'null'); } catch (e) { return null; }
}

/**
 * Put the page back where it was. Called once the agent list has loaded, since a saved agent that
 * has since been deleted must fall back to the launcher rather than opening a dead view.
 */
function restoreView(agents) {
  var saved = readSavedView();
  if (!saved || !saved.agentId) return false;
  var exists = (agents || []).some(function(a) { return a.id === saved.agentId; });
  if (!exists) { saveViewClear(); return false; }

  showDashboardView();
  selectAgent(saved.agentId);
  switchTab(saved.tab || 'overview');
  if (saved.tab === 'projects' && saved.projectId) openProject(saved.projectId);
  return true;
}

function saveViewClear() {
  try { sessionStorage.removeItem(VIEW_KEY); } catch (e) {}
}

/* ── View switching: agents launcher  <->  selected-agent dashboard ── */
function showAgentsView() {
  currentAgentId = null;
  saveViewClear();
  document.body.dataset.view = 'agents';
  sendCommand('list_agents').then(renderAgents).catch(function() {});
}
function showDashboardView() {
  document.body.dataset.view = 'dashboard';
}
function openAgent(id) {
  showDashboardView();
  selectAgent(id);
  switchTab('overview');
  saveView();
}

/* ── Agents launcher (cards) ── */
function renderAgents(agents) {
  lastAgents = agents || [];
  var grid = document.getElementById('agents-grid');
  if (grid) {
    if (lastAgents.length === 0) {
      grid.innerHTML = '<div class="agents-empty">No agents yet. Click <b>+ New agent</b> to create your first agent.</div>';
    } else {
      grid.innerHTML = lastAgents.map(agentCardHtml).join('');
      wireAgentCards();
    }
  }
  if (currentAgentId) updateAgentHeader();
  updateUnreadBadges();
}
function agentCardHtml(s) {
  var running = s.state === 'running';
  return '<div class="agent-card">'
    + '<div class="agent-card-head">'
    + '<span class="agent-card-name">' + esc(s.name) + (s.orchestrator ? ' <span class="agent-orch-badge">orchestrator</span>' : '') + ' <span class="vn-badge" data-vn-unread="' + esc(s.id) + '" style="display:none" title="Unread VoleNet messages"></span></span>'
    + '<span class="agent-status agent-status-' + (running ? 'running' : 'stopped') + '">' + (running ? 'running' : 'stopped') + '</span>'
    + '</div>'
    + '<div class="agent-card-meta">' + esc(s.id) + (s.pid ? ' &middot; pid ' + s.pid : '') + '</div>'
    + '<div class="agent-card-actions">'
    + '<button class="btn-primary" data-act="open" data-id="' + esc(s.id) + '">Open</button>'
    + '<button class="agent-btn" data-act="' + (running ? 'stop_agent' : 'start_agent') + '" data-id="' + esc(s.id) + '">' + (running ? 'Stop' : 'Start') + '</button>'
    + '<button class="agent-btn" data-act="rename" data-id="' + esc(s.id) + '" data-name="' + esc(s.name) + '">Rename</button>'
    + '<button class="agent-btn agent-btn-danger" data-act="remove" data-id="' + esc(s.id) + '">Remove</button>'
    + '</div></div>';
}
function wireAgentCards() {
  var btns = document.querySelectorAll('#agents-grid button[data-act]');
  for (var i = 0; i < btns.length; i++) {
    btns[i].addEventListener('click', function() {
      var act = this.getAttribute('data-act');
      var id = this.getAttribute('data-id');
      if (act === 'open') { openAgent(id); return; }
      if (act === 'remove') { removeAgentById(id); return; }
      if (act === 'rename') { renameAgentById(id, this.getAttribute('data-name') || ''); return; }
      sendCommand(act, { agentId: id })
        .then(function() { return sendCommand('list_agents'); })
        .then(renderAgents)
        .catch(function(e) { showToast(e.message, 'error'); });
    });
  }
}
function openModal(html) {
  var card = document.getElementById('modal-card');
  if (!card) return;
  card.innerHTML = html;
  document.getElementById('modal-overlay').style.display = 'flex';
}
function closeModal() {
  var ov = document.getElementById('modal-overlay');
  if (!ov) return;
  ov.style.display = 'none';
  document.getElementById('modal-card').innerHTML = '';
}
document.addEventListener('keydown', function(e) {
  if (e.key !== 'Escape') return;
  var ov = document.getElementById('modal-overlay');
  if (ov && ov.style.display !== 'none') closeModal();
});
function createAgentPrompt() {
  openModal(
    '<h2 class="modal-title">New agent</h2>'
    + '<p class="modal-sub">An isolated agent with its own config, paws, identity, and data.</p>'
    + '<label class="form-label" for="new-agent-name">Name</label>'
    + '<input id="new-agent-name" class="modal-input" type="text" placeholder="e.g. Research, Trading, Personal" autocomplete="off" spellcheck="false">'
    + '<div id="new-agent-err" style="color:var(--red);font-size:12px;margin-top:8px;display:none"></div>'
    + '<div class="modal-actions">'
    +   '<button class="btn-restart" type="button" onclick="closeModal()">Cancel</button>'
    +   '<button class="btn-primary" type="button" id="new-agent-submit" onclick="submitNewAgent()">Create agent</button>'
    + '</div>'
  );
  var input = document.getElementById('new-agent-name');
  if (input) {
    input.focus();
    input.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); submitNewAgent(); } });
  }
}
function submitNewAgent() {
  var input = document.getElementById('new-agent-name');
  var err = document.getElementById('new-agent-err');
  var name = ((input && input.value) || '').trim();
  if (!name) { if (err) { err.textContent = 'Please enter a name.'; err.style.display = 'block'; } if (input) input.focus(); return; }
  var btn = document.getElementById('new-agent-submit');
  if (btn) { btn.disabled = true; btn.textContent = 'Creating…'; }
  sendCommand('create_agent', { name: name })
    .then(function(res) {
      return sendCommand('list_agents').then(function(agents) {
        renderAgents(agents);
        showToast('Created agent "' + name + '"', 'success');
        showOnboarding((res && res.id) || null, name);
      });
    })
    .catch(function(e) {
      if (err) { err.textContent = e.message; err.style.display = 'block'; }
      if (btn) { btn.disabled = false; btn.textContent = 'Create agent'; }
    });
}
var ESSENTIAL_PAWS = [
  { name: '@openvole/paw-brain', label: 'Brain', desc: 'LLM reasoning — runs the Think phase. An agent needs a brain to respond.' },
  { name: '@openvole/paw-session', label: 'Session', desc: 'Per-session transcript and metadata — powers the Chat tab history.' },
  { name: '@openvole/paw-memory', label: 'Memory', desc: 'Persistent markdown long-term and daily memory across runs.' },
  { name: '@openvole/paw-compact', label: 'Compact', desc: 'Summarizes old messages to free the context window automatically.' },
  { name: '@openvole/paw-shell', label: 'Shell', desc: 'Run shell commands with safety restrictions.' }
];
var onboardCtx = { id: null, name: '' };
function showOnboarding(agentId, name) {
  if (!agentId) { closeModal(); return; }
  onboardCtx = { id: agentId, name: name };
  var items = ESSENTIAL_PAWS.map(function(p) {
    return '<label class="onboard-item">'
      + '<input type="checkbox" data-paw="' + esc(p.name) + '" checked>'
      + '<div><div class="onboard-name">' + esc(p.label) + ' <span class="onboard-pkg">' + esc(p.name) + '</span></div>'
      + '<div class="onboard-desc">' + esc(p.desc) + '</div></div>'
      + '</label>';
  }).join('');
  openModal(
    '<h2 class="modal-title">Set up &ldquo;' + esc(name) + '&rdquo;</h2>'
    + '<p class="modal-sub">Install the essential paws to get a working agent. You can change these any time from the agent Config tab. Paws load after the agent is started.</p>'
    + items
    + '<div id="onboard-status" style="font-size:12px;color:var(--text-dim);margin-top:14px;display:none"></div>'
    + '<div class="modal-actions">'
    +   '<button class="btn-restart" type="button" id="onboard-skip" onclick="closeModal()">Skip for now</button>'
    +   '<button class="btn-primary" type="button" id="onboard-install" onclick="installEssentials()">Install selected</button>'
    + '</div>'
  );
}
function installEssentials() {
  var agentId = onboardCtx.id;
  if (!agentId) { closeModal(); return; }
  var checks = document.querySelectorAll('#modal-card input[data-paw]:checked');
  var names = [];
  for (var i = 0; i < checks.length; i++) names.push(checks[i].getAttribute('data-paw'));
  if (!names.length) { closeModal(); return; }
  var btn = document.getElementById('onboard-install');
  var skip = document.getElementById('onboard-skip');
  var status = document.getElementById('onboard-status');
  if (btn) { btn.disabled = true; btn.textContent = 'Installing…'; }
  if (skip) skip.disabled = true;
  if (status) status.style.display = 'block';
  var done = 0, failed = [];
  function step(i) {
    if (i >= names.length) {
      if (status) status.textContent = 'Installed ' + done + '/' + names.length + (failed.length ? ' · failed: ' + failed.join(', ') : '');
      if (skip) skip.style.display = 'none';
      if (btn) { btn.disabled = false; btn.textContent = 'Done'; btn.onclick = function() { closeModal(); sendCommand('list_agents').then(renderAgents); }; }
      showToast('Set up "' + onboardCtx.name + '": installed ' + done + ' paw' + (done === 1 ? '' : 's') + (failed.length ? ', ' + failed.length + ' failed' : ''), failed.length ? 'error' : 'success');
      return;
    }
    var n = names[i];
    if (status) status.textContent = 'Installing ' + n + '… (' + (i + 1) + '/' + names.length + ')';
    sendCommand('install_paw', { name: n, agentId: agentId }, 180000)
      .then(function() { done++; }, function() { failed.push(n); })
      .then(function() { step(i + 1); });
  }
  step(0);
}
/**
 * Rename an agent — its display name only.
 *
 * The id is deliberately left alone: it is the directory name, the running engine's
 * VOLE_AGENT_ID, this agent's MCP endpoint, and the key its chat history and unread counts are
 * filed under in this browser. Renaming that to fix a label would orphan all of it, so the form
 * says so rather than quietly doing half a job.
 */
function renameAgentById(id, current) {
  openModal(
    '<h2 class="modal-title">Rename agent</h2>'
    + '<p class="modal-sub">Changes the display name only. Its id stays <b>' + esc(id) + '</b> — that is its folder, its MCP endpoint, and how an orchestrator addresses it, so nothing needs restarting.</p>'
    + '<input type="text" class="form-input" id="rename-input" value="' + esc(current) + '" placeholder="New name" onkeydown="if(event.key===\\'Enter\\'){confirmRenameAgent(\\'' + esc(id) + '\\');}else if(event.key===\\'Escape\\'){closeModal();}">'
    + '<div class="modal-actions">'
    +   '<button class="btn-restart" type="button" onclick="closeModal()">Cancel</button>'
    +   '<button class="btn-primary" type="button" id="confirm-rename" onclick="confirmRenameAgent(\\'' + esc(id) + '\\')">Rename</button>'
    + '</div>'
  );
  var input = document.getElementById('rename-input');
  if (input) { input.focus(); input.select(); }
}
function confirmRenameAgent(id) {
  var input = document.getElementById('rename-input');
  var name = input ? input.value.trim() : '';
  if (!name) { showToast('Enter a name', 'error'); return; }
  var btn = document.getElementById('confirm-rename');
  if (btn) { btn.disabled = true; btn.textContent = 'Renaming…'; }
  sendCommand('rename_agent', { agentId: id, name: name })
    .then(function(res) {
      if (res && res.ok === false) throw new Error(res.error || 'Rename failed');
      closeModal();
      showToast('Renamed to "' + name + '"', 'success');
      return sendCommand('list_agents').then(renderAgents);
    })
    .then(function() { if (currentAgentId === id) updateAgentHeader(); })
    .catch(function(e) {
      if (btn) { btn.disabled = false; btn.textContent = 'Rename'; }
      showToast(e.message, 'error');
    });
}

function removeAgentById(id) {
  openModal(
    '<h2 class="modal-title">Delete agent</h2>'
    + '<p class="modal-sub">This permanently deletes <b>' + esc(id) + '</b> and all of its files on disk — config, identity, installed paws, and data. This cannot be undone.</p>'
    + '<div class="modal-actions">'
    +   '<button class="btn-restart" type="button" onclick="closeModal()">Cancel</button>'
    +   '<button class="btn-primary" type="button" id="confirm-delete" style="background:var(--red);border-color:var(--red)" onclick="confirmRemoveAgent(\\'' + esc(id) + '\\')">Delete permanently</button>'
    + '</div>'
  );
}
function confirmRemoveAgent(id) {
  var btn = document.getElementById('confirm-delete');
  if (btn) { btn.disabled = true; btn.textContent = 'Deleting…'; }
  sendCommand('remove_agent', { agentId: id })
    .then(function() {
      closeModal();
      showToast('Deleted agent "' + id + '"', 'success');
      if (currentAgentId === id) { showAgentsView(); }
      else { sendCommand('list_agents').then(renderAgents).catch(function() {}); }
    })
    .catch(function(e) {
      showToast(e.message, 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Delete permanently'; }
    });
}

/* ── Selected-agent header + dashboard ── */
function updateAgentHeader() {
  var s = lastAgents.filter(function(x) { return x.id === currentAgentId; })[0];
  var running = s && s.state === 'running';
  var nameEl = document.getElementById('header-agent-name');
  var stEl = document.getElementById('header-agent-status');
  if (nameEl) nameEl.textContent = s ? s.name : (currentAgentId || '');
  if (stEl) {
    stEl.textContent = running ? 'running' : 'stopped';
    stEl.className = 'agent-status agent-status-' + (running ? 'running' : 'stopped');
  }
  document.getElementById('btn-agent-start').style.display = (s && !running) ? '' : 'none';
  document.getElementById('btn-agent-stop').style.display = (s && running) ? '' : 'none';
}
function selectAgent(id) {
  if (!id) { currentAgentId = null; clearPanels(); return; }
  var changed = currentAgentId !== id;
  currentAgentId = id;
  // Invalidate anything already in flight for the previous agent before its response can land.
  if (changed) viewEpoch++;
  updateUnreadBadges();
  if (changed) {
    resetChat();
    resetVolenet();
    // The feed only accepts events for the selected agent, so leftover lines from the previous
    // one would be read as this agent's activity. (A saved day being reviewed is server-wide
    // and covers every agent — leave that alone.)
    if (eventsMode === 'live' && eventLog) { eventLog.innerHTML = ''; eventsLoadLive(); }
    // Config and Identity tabs load lazily and cache per (former) agent. Without resetting
    // here, switching agents leaves the previous agent's config/identity in the form — and
    // saving would write THOSE values to the newly-selected agent. Reset so the next view
    // reloads; the immediate reload (if we're on that tab) happens in the select_agent
    // callback below — it MUST run after the server records the new selection, or read_config
    // returns the OLD agent's config.
    configLoaded = false;
    cachedConfig = null;
    identityLoaded = false;
  }
  updateAgentHeader();
  sendCommand('select_agent', { agentId: id })
    .then(function(state) {
      renderState(state || {});
      // Chat, like config and identity, reloads only AFTER the server has recorded the new
      // selection. resetChat() used to reload inline, which put chat_history on the wire ahead
      // of select_agent — the server answered it for the old agent and the new agent's chat
      // showed the previous one's conversation (and cached it, so reopening kept showing it).
      if (changed && currentTab === 'chat') initChatTab();
      if (changed && currentTab === 'config') loadConfig();
      if (changed && currentTab === 'identity') loadIdentity();
    })
    .catch(function() { clearPanels(); });
}
function clearPanels() {
  renderState({ paws: [], tools: [], skills: [], tasks: [], schedules: [], volenet: { enabled: false } });
}
function agentAction(cmd) {
  if (!currentAgentId) return;
  var id = currentAgentId;
  sendCommand(cmd, { agentId: id })
    .then(function() { return sendCommand('list_agents'); })
    .then(function(agents) {
      renderAgents(agents);
      if (cmd === 'start_agent') selectAgent(id);
      else clearPanels();
    })
    .catch(function(e) { showToast(e.message, 'error'); });
}

/* ── Chat (per-agent brain conversation via paw-session sessions) ── */
var chatSessionId = 'dashboard';
var chatLoadedKey = null;
var pendingChats = {}; // taskId -> { el, agentId, timer }
// Friendly, rotating placeholders shown while the brain works — nicer than a bare "queued".
var CHAT_WAIT_PHRASES = [
  'thinking…', 'let me think on that…', 'pondering…', 'working on it…',
  'gathering my thoughts…', 'on it…', 'reasoning through this…', 'hmm, let me see…',
  'digging in…', 'one moment…', 'putting it together…', 'chewing on it…',
  'consulting my neurons…', 'almost there…'
];
function chatWaitPhrase() {
  return CHAT_WAIT_PHRASES[Math.floor(Math.random() * CHAT_WAIT_PHRASES.length)];
}
// Rotate the placeholder every few seconds so a long wait still feels alive.
function startChatWait(el) {
  el.textContent = chatWaitPhrase();
  return setInterval(function() {
    if (el.classList.contains('chat-msg-pending')) el.textContent = chatWaitPhrase();
  }, 2500);
}
function stopChatWait(entry) {
  if (entry && entry.timer) { clearInterval(entry.timer); entry.timer = null; }
}

/**
 * Clear chat state for an agent switch. Deliberately does NOT reload: the reload happens in
 * selectAgent's select_agent callback, once the server knows which agent we mean.
 */
function resetChat() {
  chatSessionId = 'dashboard';
  chatLoadedKey = null;
  pendingChats = {};
  localChatSessions = [];
  var box = document.getElementById('chat-messages');
  if (box) box.innerHTML = '';
}
function initChatTab() {
  if (!currentAgentId) return;
  // Opening the chat is "reading" it — clear before the early return below, or an
  // already-loaded chat would keep its badge forever.
  chatClearUnread(currentAgentId, chatSessionId);
  var key = currentAgentId + ':' + chatSessionId;
  chatApplyMode();
  if (chatLoadedKey === key) return;
  loadChatSessions();
  loadChatHistory();
}
var localChatSessions = []; // created this page, not yet persisted by paw-session
/** Show inter-agent threads instead of your own. Exclusive: one list or the other, never mixed. */
var chatShowAgents = false;

function chatToggleAgents() {
  chatShowAgents = !!document.getElementById('chat-show-agents').checked;
  // Leaving a set means leaving whatever was selected in it. Fall back to the default
  // conversation rather than showing a thread that is no longer in the visible list.
  if (chatShowAgents !== isAgentSession(chatSessionId)) {
    chatSelectSession(chatShowAgents ? '' : 'dashboard');
  }
  loadChatSessions();
}

function isAgentSession(id) {
  return String(id || '').indexOf('agent:') === 0;
}

/** Who the other side of an inter-agent thread is. */
function agentPeerOf(id) {
  return isAgentSession(id) ? String(id).slice('agent:'.length) : '';
}

function loadChatSessions() {
  var epoch = viewEpoch;
  sendCommand('chat_sessions').then(function(res) {
    if (viewChanged(epoch)) return;
    var list = document.getElementById('chat-side-list');
    var note = document.getElementById('chat-note');
    if (!list) return;

    var rows = [];
    var seen = {};
    if (res && res.ok && res.sessions) {
      for (var i = 0; i < res.sessions.length; i++) {
        var s = res.sessions[i];
        if (seen[s.sessionId]) continue;
        if (s.sessionId.indexOf('volenet:') === 0) continue;
        // Drafting runs are agent work, not a conversation to open.
        if (s.sessionId === DRAFT_SESSION) continue;
        // Project conversations live on the project page.
        if (s.sessionId.indexOf('project:') === 0) continue;
        seen[s.sessionId] = true;
        chatNoteTs(currentAgentId, s.sessionId, s.lastActive);
        rows.push({
          id: s.sessionId,
          count: s.messageCount || 0,
          source: s.source || '',
          at: tsMs(s.lastActive) || 0,
        });
      }
      note.textContent = '';
    } else {
      note.textContent = "paw-session not loaded — history won't persist";
    }
    // Sessions opened this page that paw-session has not written yet.
    for (var j = 0; j < localChatSessions.length; j++) {
      if (!seen[localChatSessions[j]]) {
        rows.push({ id: localChatSessions[j], count: 0, source: 'new', at: Date.now() });
        seen[localChatSessions[j]] = true;
      }
    }
    if (!chatShowAgents && !seen.dashboard) {
      rows.push({ id: 'dashboard', count: 0, source: '', at: 0 });
    }

    var mine = rows.filter(function(r) { return !isAgentSession(r.id); });
    var theirs = rows.filter(function(r) { return isAgentSession(r.id); });
    var shown = chatShowAgents ? theirs : mine;
    // Most recent first — the one you want is nearly always the one that just moved.
    shown.sort(function(a, b) { return b.at - a.at; });

    var toggle = document.getElementById('chat-show-agents');
    if (toggle) toggle.parentNode.title = theirs.length
      ? theirs.length + ' conversation(s) between this agent and its siblings — read-only'
      : 'No agent-to-agent conversations yet';

    if (!shown.length) {
      list.innerHTML = '<div class="chat-item-sub" style="padding:8px 9px">'
        + (chatShowAgents ? 'No agent-to-agent conversations yet.' : 'No conversations yet.')
        + '</div>';
    } else {
      var html = '';
      for (var k = 0; k < shown.length; k++) {
        var r = shown[k];
        var unread = chatUnreadFor(currentAgentId)[r.id] || 0;
        var name = isAgentSession(r.id) ? (agentName(currentAgentId) + ' ↔ ' + agentPeerOf(r.id)) : r.id;
        var sub = r.count + (r.count === 1 ? ' msg' : ' msgs') + (r.source ? ' · ' + r.source : '');
        html += '<button class="chat-item' + (r.id === chatSessionId ? ' active' : '') + '"'
          + ' onclick="chatSelectSession(this.dataset.id)" data-id="' + esc(r.id) + '">'
          + '<span class="chat-item-top">'
          + '<span class="chat-item-name">' + esc(name) + '</span>'
          + (unread ? '<span class="chat-item-unread">' + unread + '</span>' : '')
          + '<span class="chat-item-when">' + (r.at ? fmtStamp(r.at) : '') + '</span>'
          + '</span>'
          + '<span class="chat-item-sub">' + esc(sub) + '</span>'
          + '</button>';
      }
      list.innerHTML = html;
    }

    // Selected thread vanished from the visible set (agent switch, toggle) — fall back.
    if (shown.length && !shown.some(function(r) { return r.id === chatSessionId; })) {
      chatSelectSession(shown[0].id);
    }
  }).catch(function() {});
}

/** This agent's display name, for labelling its own side of an inter-agent thread. */
function agentName(id) {
  var a = (lastAgents || []).filter(function(x) { return x.id === id; })[0];
  return (a && a.name) || 'this agent';
}

function chatSelectSession(id) {
  chatSessionId = id || 'dashboard';
  chatLoadedKey = null;
  chatApplyMode();
  chatClearUnread(currentAgentId, chatSessionId);
  loadChatSessions();
  loadChatHistory();
}

/**
 * An inter-agent thread is somebody else's conversation. You can read it — that is the whole
 * point of surfacing it — but you are not a participant, so the composer goes away rather than
 * offering to post as one of them.
 */
function chatApplyMode() {
  var agent = isAgentSession(chatSessionId);
  var composer = document.getElementById('chat-composer');
  var readonly = document.getElementById('chat-readonly');
  var title = document.getElementById('chat-head-title');
  var clear = document.getElementById('btn-chat-clear');
  if (composer) composer.style.display = agent ? 'none' : '';
  if (readonly) readonly.style.display = agent ? '' : 'none';
  if (clear) clear.style.display = agent ? 'none' : '';
  if (title) {
    title.textContent = agent
      ? agentName(currentAgentId) + ' ↔ ' + agentPeerOf(chatSessionId)
      : chatSessionId;
  }
}

/**
 * Clear unread across every session of this agent.
 *
 * The per-session count is correct but not always reachable: unread can sit on a session you
 * never open (an old channel conversation, a session created before this agent's traffic was
 * classified), and the card badge sums them — so a number could hang there with no chat that
 * would clear it. This is the way out.
 */
function chatMarkAllRead() {
  if (!currentAgentId) return;
  var m = chatUnreadFor(currentAgentId);
  var ids = [];
  for (var k in m) ids.push(k);
  // Include every thread the sidebar is showing, not only the ones already carrying a badge —
  // "mark all read" should also settle a session whose count is about to arrive.
  var items = document.querySelectorAll('#chat-side-list .chat-item');
  for (var i = 0; i < items.length; i++) {
    var id = items[i].dataset.id;
    if (id && ids.indexOf(id) === -1) ids.push(id);
  }
  for (var j = 0; j < ids.length; j++) chatClearUnread(currentAgentId, ids[j]);
  chatSaveUnread();
  // The agent-card badge sums brain-chat AND VoleNet unread, so a button offering to clear
  // "all" has to clear both — otherwise it leaves a number behind and looks broken.
  var vm = vnUnreadFor(currentAgentId);
  var peers = [];
  for (var p in vm) peers.push(p);
  for (var q = 0; q < peers.length; q++) vnClearUnread(currentAgentId, peers[q]);
  refreshChatReadAllBtn();
  loadChatSessions();
}
function refreshChatReadAllBtn() {
  var btn = document.getElementById('btn-chat-read-all');
  if (!btn) return;
  var n = currentAgentId ? (chatAgentUnreadSum(currentAgentId) + vnAgentUnreadSum(currentAgentId)) : 0;
  btn.style.display = n ? '' : 'none';
  btn.textContent = 'Mark all read (' + n + ')';
  btn.title = 'Clear unread on every chat and VoleNet conversation of this agent';
}
function newChatSession() {
  var d = new Date();
  var pad = function(x) { return (x < 10 ? '0' : '') + x; };
  var id = 'dashboard:' + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
  localChatSessions.push(id);
  chatSessionId = id;
  chatLoadedKey = currentAgentId + ':' + id;
  // A new conversation is one of yours, so leave the inter-agent view if it is on — otherwise
  // the thing you just created is filtered out of the list the moment it exists.
  chatShowAgents = false;
  var toggle = document.getElementById('chat-show-agents');
  if (toggle) toggle.checked = false;
  chatApplyMode();
  document.getElementById('chat-messages').innerHTML = '<div class="chat-empty">New session — say hi to the brain.</div>';
  document.getElementById('chat-note').textContent = '';
  loadChatSessions();
}
function clearChatSession() {
  if (!confirm('Delete the transcript of session "' + chatSessionId + '"?')) return;
  var epoch = viewEpoch;
  sendCommand('chat_clear', { sessionId: chatSessionId }).then(function(res) {
    if (viewChanged(epoch)) return;
    if (res && res.ok === false) { showToast(res.error || 'Could not clear session', 'error'); return; }
    showToast('Cleared session "' + chatSessionId + '"', 'success');
    chatLoadedKey = null;
    loadChatSessions();
    loadChatHistory();
  }).catch(function(e) { showToast(e.message, 'error'); });
}

function loadChatHistory() {
  var box = document.getElementById('chat-messages');
  box.innerHTML = '<div class="chat-empty">Loading&hellip;</div>';
  var key = currentAgentId + ':' + chatSessionId;
  var epoch = viewEpoch;
  sendCommand('chat_history', { sessionId: chatSessionId }).then(function(res) {
    // Switched agents while this was in flight — drop it, the new agent's load owns the box.
    if (viewChanged(epoch)) return;
    chatLoadedKey = key;
    box.innerHTML = '';
    var added = 0;
    var h = (res && res.ok !== false) ? res.history : null;
    if (Array.isArray(h)) {
      // paw-session >= 2.1: messages [{ts, role, content}] with newlines preserved
      // In an inter-agent thread neither voice is yours: 'user' is the agent that wrote in, and
      // 'brain' is the agent whose transcript this is. Both get named.
      var agentThread = isAgentSession(chatSessionId);
      var themName = agentThread ? agentPeerOf(chatSessionId) : '';
      var usName = agentThread ? agentName(currentAgentId) : '';
      for (var i = 0; i < h.length; i++) {
        var role = h[i].role;
        if (role === 'user') {
          addChatBubble('user', h[i].content, '', h[i].ts, themName);
          added++;
        } else if (role === 'brain') {
          setBubbleMarkdown(addChatBubble('brain', '', '', h[i].ts, usName), h[i].content);
          added++;
        }
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
    // You have now literally seen every message in this transcript, so the watermark belongs at
    // the newest one. Anchoring it to task timestamps instead left the transcript's own entries
    // (stamped a moment later, when paw-session appended them) looking newer than the mark —
    // the recount then re-flagged them and the badge reappeared the instant you opened the chat.
    if (Array.isArray(h)) {
      for (var k = 0; k < h.length; k++) chatNoteTs(currentAgentId, chatSessionId, h[k].ts);
    }
    chatClearUnread(currentAgentId, chatSessionId);
    restorePendingChat();
    box.scrollTop = box.scrollHeight;
  }).catch(function() {
    chatLoadedKey = key;
    box.innerHTML = '<div class="chat-empty">No history available (paw-session not loaded). Messages still work.</div>';
    restorePendingChat();
  });
}

/**
 * Re-attach the "thinking…" bubble for a task that is still running in this session.
 * Reloading the chat wipes the DOM, which orphaned any pendingChats entry: the animation
 * vanished AND the eventual answer was written into a detached node, so it never appeared.
 * The task list already knows — this rebuilds the bubble and rebinds the pending entry.
 */
function restorePendingChat() {
  var box = document.getElementById('chat-messages');
  if (!box) return;
  var live = (lastStateTasks || []).filter(function(t) {
    return (t.status === 'running' || t.status === 'queued')
      && (t.sessionId || 'dashboard') === chatSessionId
      // Only a person's own messages get a placeholder — not heartbeats, schedules, orchestrator
      // briefs ('agent') or channel traffic ('paw').
      && (!t.source || t.source === 'user');
  });
  if (!live.length) return;
  live.sort(function(a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
  for (var i = 0; i < live.length; i++) {
    var t = live[i];
    // The user's own message is already in history; only add it if history missed it
    // (paw-session writes it as the task starts, so a queued task may not be there yet).
    var empty = box.querySelector('.chat-empty');
    if (empty) empty.remove();
    if (t.input && box.textContent.indexOf(t.input.slice(0, 40)) === -1) {
      addChatBubble('user', t.input);
    }
    var el = addChatBubble('brain', '', 'chat-msg-pending');
    var timer = startChatWait(el);
    var prev = pendingChats[t.id];
    if (prev && prev.timer) clearInterval(prev.timer);
    pendingChats[t.id] = { el: el, agentId: currentAgentId, timer: timer };
  }
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
/**
 * One message in the thread.
 *
 * The bubble is wrapped in a row so a timestamp can sit under it without joining the bubble's own
 * text — "when was this said" was previously unanswerable anywhere in chat, which made a
 * transcript impossible to line up against the event log or against what an agent claimed.
 *
 * The who argument names the speaker, which only matters when neither side is you: in an
 * inter-agent thread both roles are somebody else, and an unlabelled bubble gives no way to
 * tell them apart.
 */
function addChatBubble(kind, text, extraClass, ts, who) {
  var box = document.getElementById('chat-messages');
  var empty = box.querySelector('.chat-empty');
  if (empty) empty.remove();
  var row = document.createElement('div');
  row.className = 'chat-row chat-row-' + (kind === 'error' ? 'error' : kind);
  var el = document.createElement('div');
  el.className = 'chat-msg chat-msg-' + kind + (extraClass ? ' ' + extraClass : '');
  el.textContent = text;
  row.appendChild(el);
  var stamp = ts ? fmtStamp(tsMs(ts)) : '';
  if (stamp || who) {
    var meta = document.createElement('div');
    meta.className = 'chat-meta';
    if (who) {
      var w = document.createElement('span');
      w.className = 'chat-meta-who';
      w.textContent = who;
      meta.appendChild(w);
    }
    if (stamp) {
      var t = document.createElement('span');
      t.textContent = stamp;
      meta.appendChild(t);
    }
    row.appendChild(meta);
  }
  box.appendChild(row);
  box.scrollTop = box.scrollHeight;
  return el;
}
function sendChat() {
  var input = document.getElementById('chat-input');
  var text = input.value.trim();
  if (!text || !currentAgentId) return;
  input.value = '';
  addChatBubble('user', text);
  var pendingEl = addChatBubble('brain', '', 'chat-msg-pending');
  var waitTimer = startChatWait(pendingEl);
  var epoch = viewEpoch;
  sendCommand('submit', { input: text, sessionId: chatSessionId }).then(function(res) {
    // Switched agents before the ack came back. The bubble left with the old view, so don't
    // bind the task to it — the reply is still counted as unread for the agent it was sent to
    // (chatOnTaskEvent does that from the event's own agentId), and reopening that chat
    // re-attaches a live placeholder via restorePendingChat().
    if (viewChanged(epoch)) {
      clearInterval(waitTimer);
      return;
    }
    if (res && res.taskId) {
      pendingChats[res.taskId] = { el: pendingEl, agentId: currentAgentId, timer: waitTimer };
    } else {
      clearInterval(waitTimer);
      pendingEl.classList.remove('chat-msg-pending');
      pendingEl.textContent = '(submitted)';
    }
  }).catch(function(e) {
    clearInterval(waitTimer);
    if (viewChanged(epoch)) return;
    pendingEl.className = 'chat-msg chat-msg-error';
    pendingEl.textContent = 'Failed to submit: ' + e.message;
  });
}
function chatOnTaskEvent(event, data, agentId) {
  // Where the run said its report goes, which is not always a session it was a turn in: work
  // started from the task board or picked up by a heartbeat has no conversation of its own but
  // still reports into its project's. The sessionId is the fallback for an engine older than the
  // reply-address change.
  var addr = (data && (data.replyTo || data.sessionId)) || '';

  // Drafts are agent work, not conversation: they must not appear as chat or bump the unread
  // badge. Claim them here so the accounting below never sees them.
  if (addr === DRAFT_SESSION) {
    draftOnTaskEvent(event, data);
    return;
  }
  // Project conversations belong to the project page, not the central Chat tab: they must not
  // appear as sessions there or bump its unread badge.
  if (addr.indexOf('project:') === 0) {
    pchatOnTaskEvent(event, data, addr.slice('project:'.length), agentId);
    return;
  }
  // Unread accounting FIRST: a reply can land while you're on another tab or agent, and
  // there may be no pending bubble at all (page reloaded, or a different agent). Only
  // sessioned tasks are chat — heartbeat and schedule runs carry no sessionId.
  if ((event === 'task:completed' || event === 'task:failed') && data && data.sessionId
      && (!data.source || data.source === 'user')) {
    var target = agentId !== undefined ? agentId : currentAgentId;
    var viewing = currentTab === 'chat' && target === currentAgentId && data.sessionId === chatSessionId;
    if (viewing) {
      // Seen live — move the watermark so a later recount doesn't resurrect it.
      chatMarkRead(target, data.sessionId);
      chatSaveUnread();
    } else {
      chatBumpUnread(target, data.sessionId);
      var ag = (lastAgents || []).filter(function(a) { return a.id === target; })[0];
      var who = (ag && ag.name) || 'The agent';
      showToast('\\uD83E\\uDDE0 ' + who + ' replied'
        + (data.sessionId !== 'dashboard' ? ' in ' + data.sessionId : ''),
        event === 'task:failed' ? 'error' : 'success');
    }
  }

  var p = data && data.taskId ? pendingChats[data.taskId] : null;
  if (!p) return;
  if (agentId !== undefined && p.agentId !== agentId) return;
  if (event === 'task:started') {
    // Let the rotating placeholder keep going — it already reads as "working".
    return;
  }
  if (event === 'task:completed') {
    stopChatWait(p);
    p.el.classList.remove('chat-msg-pending');
    setBubbleMarkdown(p.el, data.result || '(no response)');
  } else if (event === 'task:failed' || event === 'task:cancelled') {
    stopChatWait(p);
    p.el.className = 'chat-msg chat-msg-error';
    p.el.textContent = data && (data.result || data.error) ? String(data.result || data.error) : 'Task failed';
  } else {
    return;
  }
  delete pendingChats[data.taskId];
  var box = document.getElementById('chat-messages');
  box.scrollTop = box.scrollHeight;
}

/* ── VoleNet tab (human-capable peer chat) ── */
var vnPeers = [];
var vnSelectedPeer = null;

/* Unread chat/file counts, kept PER AGENT so switching agents (or reloading) doesn't
   lose them — events for a non-selected agent still count toward its badges. */
var vnUnreadStore = {};
try { vnUnreadStore = JSON.parse(localStorage.getItem('vnUnread') || '{}') || {}; } catch (e) { vnUnreadStore = {}; }
function vnUnreadFor(agentId) {
  var key = agentId || 'default';
  if (!vnUnreadStore[key]) vnUnreadStore[key] = {};
  return vnUnreadStore[key];
}
function vnAgentUnreadSum(agentId) {
  var m = vnUnreadFor(agentId), sum = 0;
  for (var k in m) sum += m[k] || 0;
  return sum;
}
function vnBumpUnread(agentId, peerId) {
  if (!peerId) return;
  var m = vnUnreadFor(agentId);
  m[peerId] = (m[peerId] || 0) + 1;
  vnSaveUnread();
}
function vnClearUnread(agentId, peerId) {
  var m = vnUnreadFor(agentId);
  if (m[peerId]) { delete m[peerId]; vnSaveUnread(); }
}
function vnSaveUnread() {
  try { localStorage.setItem('vnUnread', JSON.stringify(vnUnreadStore)); } catch (e) {}
  updateUnreadBadges();
}
/* Brain-chat unread counts — same shape as the VoleNet ones, keyed by session, because
   the brain can answer long after you've moved to another tab or agent. */
var chatUnreadStore = {};
try { chatUnreadStore = JSON.parse(localStorage.getItem('chatUnread') || '{}') || {}; } catch (e) { chatUnreadStore = {}; }
function chatUnreadFor(agentId) {
  var key = agentId || 'default';
  if (!chatUnreadStore[key]) chatUnreadStore[key] = {};
  return chatUnreadStore[key];
}
function chatAgentUnreadSum(agentId) {
  var m = chatUnreadFor(agentId), sum = 0;
  for (var k in m) sum += m[k] || 0;
  return sum;
}
function chatBumpUnread(agentId, sessionId) {
  if (!sessionId) return;
  var m = chatUnreadFor(agentId);
  m[sessionId] = (m[sessionId] || 0) + 1;
  chatSaveUnread();
}
function chatClearUnread(agentId, sessionId) {
  chatMarkRead(agentId, sessionId);
  var m = chatUnreadFor(agentId);
  if (m[sessionId]) { delete m[sessionId]; }
  chatSaveUnread();
}
function chatSaveUnread() {
  try { localStorage.setItem('chatUnread', JSON.stringify(chatUnreadStore)); } catch (e) {}
  try { localStorage.setItem('chatReadAt', JSON.stringify(chatReadAt)); } catch (e) {}
  updateUnreadBadges();
}

/* Read watermarks: when you last LOOKED at a given chat. Live events only fire while the
   page is open, so replies that land with the browser closed would otherwise go unnoticed.
   On reconnect we recount from the agent's task list against these marks. */
var chatReadAt = {};
try { chatReadAt = JSON.parse(localStorage.getItem('chatReadAt') || '{}') || {}; } catch (e) { chatReadAt = {}; }
/* The newest engine-side timestamp seen for each chat, from ANY source: a task's completedAt,
   a transcript entry, a session's lastActive, a channel message. Not persisted — it is rebuilt
   from state and transcripts on load.

   It exists because those sources disagree by design. paw-session stamps a transcript entry
   when it APPENDS it, which is strictly after the task:completed that triggered it. Marking a
   chat read from task timestamps alone therefore always leaves the transcript entry looking
   newer than the watermark, and the transcript recount re-counted it as unread the moment you
   opened the chat — the badge that would not go away. */
/** How far a transcript entry may trail the task it records before it counts as new. */
var CHAT_TS_SKEW_MS = 5000;
var chatLatestTs = {};
function chatNoteTs(agentId, sessionId, ts) {
  var ms = tsMs(ts);
  if (!ms || !sessionId) return;
  var key = agentId || 'default';
  if (!chatLatestTs[key]) chatLatestTs[key] = {};
  if (!chatLatestTs[key][sessionId] || ms > chatLatestTs[key][sessionId]) {
    chatLatestTs[key][sessionId] = ms;
  }
}
function chatLatestFor(agentId, sessionId) {
  var m = chatLatestTs[agentId || 'default'];
  return (m && m[sessionId]) || 0;
}

function chatMarkRead(agentId, sessionId) {
  var key = agentId || 'default';
  if (!chatReadAt[key]) chatReadAt[key] = {};
  // Mark with the newest ENGINE-side timestamp known for this chat, never the browser clock:
  // the dashboard often runs on a different machine, and a skewed clock would either resurrect
  // read replies or silently swallow new ones.
  var newest = chatReadAt[key][sessionId] || 0;
  for (var i = 0; i < (lastStateTasks || []).length; i++) {
    var t = lastStateTasks[i];
    if (t.sessionId === sessionId && typeof t.completedAt === 'number' && t.completedAt > newest) {
      newest = t.completedAt;
    }
  }
  var latest = chatLatestFor(agentId, sessionId);
  if (latest > newest) newest = latest;
  chatReadAt[key][sessionId] = newest;
}

/**
 * Recount the CURRENT agent's unread chats from its task list (state carries sessionId +
 * completedAt). Authoritative for that agent, so it also corrects counts after a reload or
 * a closed browser. Other agents keep their event-driven counts — state only covers the
 * selected agent. Engine keeps its last 50 completed tasks, so a long-idle browser can
 * still miss older replies; opening the chat shows them regardless.
 */
function recomputeChatUnread() {
  if (!currentAgentId) return;
  if (!chatReadAt[currentAgentId]) chatReadAt[currentAgentId] = {};
  var marks = chatReadAt[currentAgentId];
  var counts = chatUnreadFor(currentAgentId);
  var tally = {};
  var withTasks = {};
  var firstSight = {};
  for (var i = 0; i < (lastStateTasks || []).length; i++) {
    var t = lastStateTasks[i];
    if (!t.sessionId || (t.status !== 'completed' && t.status !== 'failed')) continue;
    // Only work a person started here is "unread chat". Sibling briefs from an orchestrator
    // ('agent') and channel traffic ('paw' — telegram, slack) carry a sessionId too, and used
    // to raise badges on the dashboard for conversations nobody was ever going to open.
    if (t.source && t.source !== 'user') continue;
    var doneAt = typeof t.completedAt === 'number' ? t.completedAt : 0;
    if (!doneAt) continue;
    chatNoteTs(currentAgentId, t.sessionId, doneAt);
    withTasks[t.sessionId] = true;
    if (marks[t.sessionId] === undefined) {
      // Never seen this session on this browser — adopt its history as already read.
      // Without this, a fresh browser would badge every reply still in the task list.
      firstSight[t.sessionId] = Math.max(firstSight[t.sessionId] || 0, doneAt);
      continue;
    }
    if (doneAt > marks[t.sessionId]) tally[t.sessionId] = (tally[t.sessionId] || 0) + 1;
  }
  for (var s in firstSight) marks[s] = firstSight[s];
  // Only sessions the task list actually covers are rewritten. Replacing the whole map wiped
  // counts the transcript pass had computed for sessions with no task behind them (an
  // agent-initiated message), so the two passes overwrote each other on every state push.
  for (var sid in withTasks) {
    if (tally[sid]) counts[sid] = tally[sid];
    else delete counts[sid];
  }
  // Whatever you're looking at right now is read by definition.
  if (currentTab === 'chat' && counts[chatSessionId]) {
    delete counts[chatSessionId];
    chatMarkRead(currentAgentId, chatSessionId);
  }
  chatUnreadStore[currentAgentId] = counts;
  chatSaveUnread();
  // Tasks only cover replies. An agent-initiated message (paw-chat) has no task behind it, so
  // the transcript is the only record of it — recount from there too.
  recountChatFromTranscripts();
}

/** Engine-side timestamp → ms. paw-session writes ISO strings; tasks carry epoch numbers. */
function tsMs(v) {
  if (typeof v === 'number') return v;
  if (!v) return 0;
  var n = Date.parse(v);
  return isNaN(n) ? 0 : n;
}

/** Raise a session's read watermark to an engine-side timestamp. */
function chatMarkReadAt(agentId, sessionId, ts) {
  var key = agentId || 'default';
  if (!chatReadAt[key]) chatReadAt[key] = {};
  var ms = tsMs(ts);
  if (!ms) return;
  if (!chatReadAt[key][sessionId] || ms > chatReadAt[key][sessionId]) {
    chatReadAt[key][sessionId] = ms;
  }
}

/**
 * Recount unread from the session transcripts — the record that survives a closed browser and
 * covers messages with no task behind them (an agent starting a conversation through the chat
 * channel). Only sessions whose lastActive is newer than our watermark are fetched, so this is
 * one cheap call plus one per genuinely-changed chat. Sessions seen for the first time on this
 * browser adopt their history as read rather than badging all of it.
 */
function recountChatFromTranscripts() {
  if (!currentAgentId) return;
  var agent = currentAgentId;
  var epoch = viewEpoch;
  sendCommand('chat_sessions').then(function(res) {
    if (viewChanged(epoch)) return;
    var sessions = (res && res.sessions) || [];
    if (!sessions.length) return;
    if (!chatReadAt[agent]) chatReadAt[agent] = {};
    var marks = chatReadAt[agent];
    var todo = [];
    var known = {};
    for (var i = 0; i < sessions.length; i++) {
      var s = sessions[i];
      if (!s.sessionId || s.sessionId.indexOf('volenet:') === 0) continue;
      if (s.sessionId === DRAFT_SESSION) continue;
      if (s.sessionId.indexOf('project:') === 0) continue;
      // Sessions opened by machines (an orchestrator brief, a channel paw) are visible in the
      // dropdown but are not your unread mail.
      if (s.source && s.source !== 'user') continue;
      known[s.sessionId] = true;
      var last = tsMs(s.lastActive);
      if (!last) continue;
      chatNoteTs(agent, s.sessionId, last);
      if (marks[s.sessionId] === undefined) {
        // First sight on this browser — adopt as read, and drop any count carried over.
        marks[s.sessionId] = last;
        delete chatUnreadFor(agent)[s.sessionId];
        continue;
      }
      if (last > marks[s.sessionId]) {
        todo.push(s.sessionId);
      } else if (chatLatestFor(agent, s.sessionId) <= marks[s.sessionId] + CHAT_TS_SKEW_MS) {
        // Nothing known about this session — transcript, task, or channel message — is newer
        // than what you have read, so it has no unread. Say so: both passes only ever *set*
        // counts for sessions they examined, so a quiet session that picked up a bogus count
        // (from an older build, or a watermark taken from a task timestamp that the transcript
        // entry then beat by milliseconds) kept it forever — nothing recounted it, and you had
        // no reason to open it. That is what left a number on an agent with several old
        // sessions while an agent with only the chat you actually use looked fine.
        //
        // The chatLatestFor check matters: a reply's transcript entry is written a moment after
        // its task completes, so between the two a session's lastActive is stale. Without it,
        // this branch would delete a count the task pass had just correctly set.
        delete chatUnreadFor(agent)[s.sessionId];
      }
    }
    // Drop counts for sessions the agent no longer reports — a cleared or renamed session left
    // a number in localStorage that no chat could ever clear, so the card badge stuck forever.
    var stale = chatUnreadFor(agent);
    for (var sid in stale) { if (!known[sid]) delete stale[sid]; }
    if (!todo.length) { chatSaveUnread(); updateUnreadBadges(); return; }
    Promise.all(todo.map(function(sid) {
      return sendCommand('chat_history', { sessionId: sid })
        .then(function(h) { return { sid: sid, h: h }; })
        .catch(function() { return null; });
    })).then(function(results) {
      if (viewChanged(epoch)) return; // switched agents mid-flight
      var counts = chatUnreadStore[agent] || {};
      for (var i = 0; i < results.length; i++) {
        var r = results[i];
        if (!r || !r.h || r.h.ok === false) continue;
        var msgs = Array.isArray(r.h.history) ? r.h.history : null;
        if (!msgs) continue; // older paw-session returns flattened text — leave the task count alone
        var n = 0;
        var newest = marks[r.sid] || 0;
        for (var j = 0; j < msgs.length; j++) {
          chatNoteTs(agent, r.sid, msgs[j].ts);
          var mts = tsMs(msgs[j].ts);
          if (mts > newest) newest = mts;
          // CHAT_TS_SKEW_MS: a reply's transcript entry is stamped when paw-session appends it,
          // a moment AFTER the task:completed that the watermark may have come from. Without
          // this allowance, a chat you have read shows one phantom unread forever — and if it
          // is a session you never reopen, nothing ever recomputes it away.
          if (msgs[j].role === 'brain' && mts > marks[r.sid] + CHAT_TS_SKEW_MS) n++;
        }
        if (n) {
          counts[r.sid] = n;
        } else {
          // Resolved to zero: move the watermark past everything in the transcript so this
          // does not depend on the skew allowance again next time.
          delete counts[r.sid];
          if (newest > (marks[r.sid] || 0)) marks[r.sid] = newest;
        }
      }
      if (currentTab === 'chat' && counts[chatSessionId]) {
        delete counts[chatSessionId];
        chatMarkRead(agent, chatSessionId);
      }
      chatUnreadStore[agent] = counts;
      chatSaveUnread();
      updateUnreadBadges();
    });
  }).catch(function() {});
}

/**
 * A message the agent started itself, over the chat channel (paw-chat). Unlike a reply there is
 * no task and no pending bubble — a heartbeat or scheduled run reached out while nobody was
 * necessarily looking — so this is purely append + notify.
 */
function chatOnChannelMessage(data, agentId) {
  if (!data || data.channel !== 'chat') return;
  if (data.dir === 'in') return; // inbound already becomes a task, which chat renders
  var sessionId = data.sessionId || 'dashboard';
  var target = agentId !== undefined ? agentId : currentAgentId;
  chatNoteTs(target, sessionId, data.ts);
  var viewing = currentTab === 'chat' && target === currentAgentId && sessionId === chatSessionId;
  if (viewing) {
    setBubbleMarkdown(addChatBubble('brain', ''), data.text || '');
    var box = document.getElementById('chat-messages');
    if (box) box.scrollTop = box.scrollHeight;
    chatMarkReadAt(target, sessionId, data.ts);
    chatSaveUnread();
  } else {
    chatBumpUnread(target, sessionId);
    var ag = (lastAgents || []).filter(function(a) { return a.id === target; })[0];
    var who = (ag && ag.name) || 'An agent';
    showToast('\\uD83D\\uDCAC ' + who + ' messaged you'
      + (sessionId !== 'dashboard' ? ' in ' + sessionId : ''), 'success');
  }
  updateUnreadBadges();
}

/* Aggregate badges: the Chat and VoleNet tab buttons (current agent) + each agent card,
   whose badge sums BOTH kinds so a card lights up for either. */
function tabBadge(tab, count) {
  var btn = document.querySelector('.tab-btn[data-tab="' + tab + '"]');
  if (!btn) return;
  var badge = btn.querySelector('.vn-badge');
  if (count && !badge) {
    badge = document.createElement('span');
    badge.className = 'vn-badge';
    btn.appendChild(badge);
  }
  if (badge) {
    badge.textContent = count;
    badge.style.display = count ? '' : 'none';
  }
}
function updateUnreadBadges() {
  tabBadge('volenet', vnAgentUnreadSum(currentAgentId));
  tabBadge('chat', chatAgentUnreadSum(currentAgentId));
  if (typeof refreshChatReadAllBtn === 'function') refreshChatReadAllBtn();
  var cardBadges = document.querySelectorAll('[data-vn-unread]');
  for (var i = 0; i < cardBadges.length; i++) {
    var el = cardBadges[i];
    var id = el.getAttribute('data-vn-unread');
    var n = vnAgentUnreadSum(id) + chatAgentUnreadSum(id);
    el.textContent = n || '';
    el.style.display = n ? '' : 'none';
  }
}

function resetVolenet() {
  vnPeers = [];
  vnSelectedPeer = null;
  if (typeof vnClearStagedFile === 'function') vnClearStagedFile();
  var box = document.getElementById('vn-messages');
  if (box) box.innerHTML = '<div class="vn-empty">Pick a node on the left to start chatting.</div>';
  var head = document.getElementById('vn-chat-head');
  if (head) head.textContent = 'Select a node to chat';
  var comp = document.getElementById('vn-composer');
  if (comp) comp.style.display = 'none';
  renderVnPeerList();
}

var vnPairRequests = [];
function refreshVnPeers() {
  if (!currentAgentId) { renderVnPeerList(); return; }
  var epoch = viewEpoch;
  Promise.all([
    sendCommand('volenet_instances').catch(function() { return []; }),
    sendCommand('volenet_relay_members').catch(function() { return []; }),
    sendCommand('volenet_relay_requests').catch(function() { return []; }),
    sendCommand('net_pair_requests').catch(function() { return null; })
  ]).then(function(res) {
    if (viewChanged(epoch)) return; // another agent's peers must not land in this list
    var direct = Array.isArray(res[0]) ? res[0] : [];
    var relay = Array.isArray(res[1]) ? res[1] : [];
    var requests = Array.isArray(res[2]) ? res[2] : [];
    vnPairRequests = (res[3] && Array.isArray(res[3].requests)) ? res[3].requests : [];
    var reqById = {};
    requests.forEach(function(r) { reqById[r.id] = r; });
    var peers = direct.map(function(i) {
      return { id: i.id, name: i.name, role: i.role, lastSeen: i.lastSeen, kind: 'direct', accepted: true };
    });
    relay.forEach(function(m) {
      // "online" for a relay member is the hub's word: lastSeen stamped now when it says connected.
      // accepted/incoming/awaiting drive the consent handshake surface.
      peers.push({ id: m.id, name: m.name, kind: 'relay', viaHubName: m.viaHubName,
        accepted: !!m.accepted, incoming: !!m.incoming || !!reqById[m.id], awaiting: !!m.awaiting,
        note: reqById[m.id] ? reqById[m.id].note : undefined,
        lastSeen: m.connected ? Date.now() : 0 });
    });
    // A requester that dropped out of the roster still deserves an Approve/Deny row.
    requests.forEach(function(r) {
      if (!peers.some(function(p) { return p.id === r.id; })) {
        peers.push({ id: r.id, name: r.name, kind: 'relay', viaHubName: r.viaHubName,
          accepted: false, incoming: true, awaiting: false, note: r.note, lastSeen: 0 });
      }
    });
    vnPeers = peers;
    renderVnPeerList();
  });
}
var vnPollTimer = null;
/* === Projects & tasks ============================================================== */

/**
 * Mirrors TASK_TRANSITIONS in core (src/project/types.ts). Kept as a copy because the dashboard
 * has no build-time link to core's types — a test asserts the two stay identical, so a change in
 * core that is not reflected here fails the suite rather than silently offering illegal moves.
 */
var TASK_MOVES = {
  queued: ['running', 'cancelled'],
  running: ['verifying', 'blocked', 'failed', 'cancelled'],
  verifying: ['done', 'blocked', 'failed', 'cancelled'],
  waiting_approval: ['running', 'blocked', 'cancelled'],
  blocked: ['queued', 'running', 'cancelled'],
  done: [],
  failed: ['queued'],
  cancelled: []
};

var TASK_STATE_COLOR = {
  queued: 'var(--text-dim)',
  running: 'var(--accent)',
  verifying: 'var(--yellow)',
  waiting_approval: 'var(--text-dim)',
  blocked: 'var(--orange)',
  done: 'var(--green)',
  failed: 'var(--red)',
  cancelled: 'var(--text-dim)'
};

var BOARD_ORDER = ['running', 'verifying', 'blocked', 'waiting_approval', 'queued', 'done', 'failed', 'cancelled'];

var currentProjectId = null;

function loadProjects() {
  var showArchived = document.getElementById('proj-show-archived');
  var params = (showArchived && showArchived.checked) ? { status: 'all' } : {};
  var epoch = viewEpoch;
  sendCommand('project_list', params).then(function(res) {
    if (viewChanged(epoch)) return;
    renderProjectList((res && res.projects) || []);
  }).catch(function(err) {
    if (viewChanged(epoch)) return;
    document.getElementById('proj-list').innerHTML = '<div class="empty">' + esc(String(err && err.message || err)) + '</div>';
  });
}

function renderProjectList(projects) {
  var box = document.getElementById('proj-list');
  if (!projects.length) {
    box.innerHTML = '<div class="empty">No projects yet.</div>';
    document.getElementById('proj-detail').innerHTML = '<div class="empty">Create a project, or just ask this agent to work on something — it can set one up itself.</div>';
    return;
  }
  var html = '';
  for (var i = 0; i < projects.length; i++) {
    var p = projects[i];
    var cls = 'proj-item' + (p.id === currentProjectId ? ' active' : '') + (p.status === 'archived' ? ' proj-archived' : '');
    var open = p.openTasks === 1 ? '1 open' : (p.openTasks || 0) + ' open';
    var unread = projUnreadFor()[p.id] || 0;
    html += '<div class="' + cls + '" onclick="openProject(\\'' + esc(p.id) + '\\')">' +
      '<div class="proj-item-name">' + esc(p.name || p.id) +
      (unread ? '<span class="proj-unread" title="' + unread + ' new report' + (unread === 1 ? '' : 's') + ' in this project&rsquo;s chat">' + unread + '</span>' : '') +
      '</div>' +
      '<div class="proj-item-meta"><span>' + esc(p.kind) + '</span><span>&middot;</span><span>' + esc(open) + '</span>' +
      (p.status !== 'active' ? '<span>&middot;</span><span>' + esc(p.status) + '</span>' : '') +
      '</div></div>';
  }
  box.innerHTML = html;
  // Keep the open project in view across refreshes; drop it if it vanished.
  if (currentProjectId && !projects.some(function(p) { return p.id === currentProjectId; })) {
    currentProjectId = null;
    document.getElementById('proj-detail').innerHTML = '<div class="empty">Select a project.</div>';
  }
}

function openProject(id) {
  currentProjectId = id;
  saveView();
  var epoch = viewEpoch;
  sendCommand('project_open', { id: id }).then(function(res) {
    if (viewChanged(epoch) || currentProjectId !== id) return;
    renderProjectDetail(res);
    loadProjects();
  }).catch(function(err) {
    if (viewChanged(epoch)) return;
    document.getElementById('proj-detail').innerHTML = '<div class="empty">' + esc(String(err && err.message || err)) + '</div>';
  });
}

function renderProjectDetail(res) {
  var p = res.project || {};
  var tasks = res.tasks || [];
  var where = p.root ? esc(p.root) : 'self-contained — files live in the project folder';

  var html = '<div class="proj-head"><div>' +
    '<h3 class="proj-title">' + esc(p.name || p.id) + '</h3>' +
    '<div class="proj-sub">' + esc(p.kind) + ' &middot; ' + where + '</div>' +
    (p.stack && p.stack.length ? '<div class="proj-sub">' + esc(p.stack.join(', ')) + '</div>' : '') +
    '</div><div class="proj-actions">' +
    '<button class="btn-primary btn-sm" onclick="openAddTask(\\'' + esc(p.id) + '\\')">Add task</button>' +
    '<button class="btn-subtle btn-sm" onclick="openEditContext(\\'' + esc(p.id) + '\\')">Context</button>' +
    (p.status === 'archived' ? '' : '<button class="btn-subtle btn-sm" onclick="archiveProject(\\'' + esc(p.id) + '\\')">Archive</button>') +
    '</div></div>';

  // The docs are written for the agent, not for you — an always-open preview cost half the screen
  // above the board you actually came for. One line naming what is loaded, expandable.
  var docs = res.contextFiles || [];
  if (docs.length) {
    var names = docs.map(function(d) { return d.name; }).join(', ');
    var body = docs.map(function(d) { return '# ' + d.name + '\\n\\n' + d.body.trim(); }).join('\\n\\n');
    html += '<div class="proj-context-line" onclick="toggleProjContext()">' +
      '<span class="proj-context-caret" id="proj-context-caret">' + (projContextOpen ? '&#9662;' : '&#9656;') + '</span>' +
      '<span>Context</span>' +
      '<span class="proj-context-gist">' + esc(names) + '</span></div>' +
      '<div class="proj-context" id="proj-context" style="display:' + (projContextOpen ? '' : 'none') + '">' +
      esc(body) + '</div>';
  } else {
    html += '<div class="proj-context-none">No context docs yet — add a <strong>VOLE.md</strong> to this project and every run reads it. Any .md file in the project folder is loaded.</div>';
  }

  var byState = {};
  for (var i = 0; i < tasks.length; i++) {
    (byState[tasks[i].state] = byState[tasks[i].state] || []).push(tasks[i]);
  }

  var history = res.history || {};
  var board = '';
  for (var b = 0; b < BOARD_ORDER.length; b++) {
    var state = BOARD_ORDER[b];
    var group = byState[state];
    if (!group || !group.length) continue;
    // The queue's own order is priority-desc then oldest-first — that is what the agent will
    // actually pick up next, and it is information, so the card keeps its "next up" mark even
    // though the column below reads newest-first like everything else.
    var nextUp = state === 'queued' ? group.slice().sort(function(a, c) {
      return (c.priority || 0) - (a.priority || 0) || (a.createdAt || 0) - (c.createdAt || 0);
    })[0] : null;
    group = group.slice().sort(function(a, c) {
      return (c.updatedAt || c.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
    });
    board += '<div><div class="board-col-title"><span class="board-dot" style="background:' + TASK_STATE_COLOR[state] + '"></span>' +
      esc(state.replace('_', ' ')) + ' (' + group.length + ')</div>';
    for (var t = 0; t < group.length; t++) {
      board += renderTaskRow(p.id, group[t], history[group[t].id], nextUp && nextUp.id === group[t].id);
    }
    board += '</div>';
  }
  html += '<div class="proj-subtabs">' +
    '<button class="proj-subtab' + (projSubtab === 'board' ? ' active' : '') + '" onclick="switchProjSubtab(\\'board\\')">Board</button>' +
    '<button class="proj-subtab' + (projSubtab === 'chat' ? ' active' : '') + '" onclick="switchProjSubtab(\\'chat\\')">Chat</button>' +
    '<button class="proj-subtab' + (projSubtab === 'files' ? ' active' : '') + '" onclick="switchProjSubtab(\\'files\\')">Files</button>' +
    '</div>';

  html += '<div id="proj-board-view" style="display:' + (projSubtab === 'board' ? '' : 'none') + '">' +
    '<div class="proj-board">' + (board || '<div class="empty">No tasks yet — describe what you want in Chat and the agent will set them up.</div>') + '</div></div>';

  html += '<div id="proj-chat-view" style="display:' + (projSubtab === 'chat' ? '' : 'none') + '">' +
    '<div class="pchat"><div class="pchat-messages" id="pchat-messages"></div>' +
    '<div class="pchat-composer">' +
    '<textarea class="form-textarea" id="pchat-input" rows="2" placeholder="Talk about this project&hellip;" onkeydown="pchatKey(event)"></textarea>' +
    '<button class="btn-primary" onclick="pchatSend()">Send</button></div>' +
    '<div class="pchat-foot">' +
    '<div class="pchat-hint">This conversation runs in the project\\'s own context — its docs and open tasks are already loaded, and the agent can create and update tasks from here.</div>' +
    '<div class="pchat-actions">' +
    '<button class="btn-subtle btn-sm" id="pchat-compact" onclick="pchatCompact()" title="Summarize the older messages and keep the recent ones">Compact</button>' +
    '<button class="btn-subtle btn-sm" onclick="pchatClear()" title="Delete this project&rsquo;s conversation">Clear</button>' +
    '</div></div>' +
    '</div></div>';

  html += '<div id="proj-files-view" style="display:' + (projSubtab === 'files' ? '' : 'none') + '">' +
    '<div class="pf-roots" id="pf-roots"></div>' +
    '<div class="pf-bar">' +
    '<div class="pf-crumb" id="pf-crumb">Loading&hellip;</div>' +
    '<button class="btn-subtle btn-sm" onclick="pfNewFile()">New file</button>' +
    '<button class="btn-subtle btn-sm" onclick="pfNewFolder()">New folder</button>' +
    '<button class="btn-subtle btn-sm" onclick="pfPickUpload()">Add files</button>' +
    '<button class="btn-subtle btn-sm" onclick="pfRefresh()">Refresh</button>' +
    '</div>' +
    '<div class="pf-abs" id="pf-abs"></div>' +
    '<input type="file" id="pf-file-input" multiple style="display:none" onchange="pfFilesPicked(event)">' +
    '<div class="pf-grid">' +
    '<div class="pf-listwrap" id="pf-listwrap" ondragover="pfDragOver(event)" ondragleave="pfDragLeave(event)" ondrop="pfDrop(event)">' +
    '<div class="pf-drop">Drop files here to add them to this folder</div>' +
    '<div class="pf-list" id="pf-list"></div></div>' +
    '<div class="pf-edit" id="pf-edit"><div class="empty" style="padding:14px">Select a file to view or edit it.</div></div>' +
    '</div><div class="pf-uploads" id="pf-uploads"></div></div>';

  document.getElementById('proj-detail').innerHTML = html;
  if (projSubtab === 'chat') loadProjectChat(p.id);
  if (projSubtab === 'files') loadProjectFiles(p.id);
}

/**
 * One task card.
 *
 * The history argument is the task's lifecycle, newest first, rebuilt by the store from
 * tasks.jsonl — which has always recorded a line per change, so this is a view of data that
 * was already there rather
 * than new bookkeeping. Two timestamps on the record (created, updated) cannot say how long a task
 * sat in verifying or how many times it came back from blocked; the trail can.
 */
function renderTaskRow(projectId, t, history, isNextUp) {
  var html = '<div class="task-row"><div class="task-goal">' + esc(t.goal) +
    (isNextUp ? '<span class="task-next" title="The agent picks this one up next: highest priority, longest queued">next up</span>' : '') +
    (t.assignee ? '<span class="task-assignee">' + esc(t.assignee) + '</span>' : '') + '</div>';
  html += renderTaskLife(t, history);
  var meta = [];
  if (t.priority) meta.push('priority ' + t.priority);
  if (t.budget && t.budget.maxIterations) meta.push((t.iterationsUsed || 0) + '/' + t.budget.maxIterations + ' iterations');
  if (meta.length) html += '<div class="task-meta">' + esc(meta.join(' · ')) + '</div>';
  if (t.doneCriteria && t.doneCriteria.length) {
    for (var c = 0; c < t.doneCriteria.length; c++) {
      html += '<div class="task-crit">✓ ' + esc(t.doneCriteria[c]) + '</div>';
    }
  }
  if (t.note) html += '<div class="task-note">' + esc(t.note) + '</div>';

  var moves = TASK_MOVES[t.state] || [];
  var runnable = t.state === 'queued' || t.state === 'blocked';
  if (moves.length || runnable) {
    html += '<div class="task-actions">';
    // Run now is the primary action: a queued task otherwise waits for the agent's heartbeat,
    // and "I added a task and nothing happened" is the first thing anyone hits.
    if (runnable) {
      html += '<button class="btn-primary" onclick="runTaskNow(\\'' + esc(projectId) + '\\',\\'' + esc(t.id) + '\\')">Run now</button>';
    }
    for (var m = 0; m < moves.length; m++) {
      html += '<button class="btn-subtle" onclick="moveTask(\\'' + esc(projectId) + '\\',\\'' + esc(t.id) + '\\',\\'' + moves[m] + '\\')">' + esc(moves[m].replace('_', ' ')) + '</button>';
    }
    html += '</div>';
  }
  return html + '</div>';
}

/** Which task trails are expanded. Survives the re-render an incoming report triggers. */
var taskLifeOpen = {};

function toggleTaskLife(taskId) {
  taskLifeOpen[taskId] = !taskLifeOpen[taskId];
  var trail = document.getElementById('tl-' + taskId);
  var caret = document.getElementById('tlc-' + taskId);
  if (trail) trail.style.display = taskLifeOpen[taskId] ? '' : 'none';
  if (caret) caret.innerHTML = taskLifeOpen[taskId] ? '&#9662;' : '&#9656;';
}

function renderTaskLife(t, history) {
  var events = history || [];
  var open = !!taskLifeOpen[t.id];
  // The summary line carries the two stamps you always want: when it last moved, and when it
  // started existing. Everything between them is one click away rather than four lines on
  // every card.
  var latest = events.length ? events[0] : { state: t.state, at: t.updatedAt };
  var summary = esc(String(latest.state).replace('_', ' ')) + ' ' + fmtStamp(latest.at);
  if (t.createdAt && t.createdAt !== latest.at) {
    summary += '<span class="task-life-dim"> · created ' + fmtStamp(t.createdAt) + '</span>';
  }

  var many = events.length > 1;
  var html = '<div class="task-life"' + (many ? ' onclick="toggleTaskLife(\\'' + esc(t.id) + '\\')"' : '') + '>' +
    (many
      ? '<span class="task-life-caret" id="tlc-' + esc(t.id) + '">' + (open ? '&#9662;' : '&#9656;') + '</span>'
      : '<span class="task-life-caret task-life-caret-off">&#8226;</span>') +
    '<span>' + summary + '</span></div>';

  if (many) {
    var rows = '';
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      rows += '<div class="task-life-row">' +
        '<span class="board-dot" style="background:' + (TASK_STATE_COLOR[e.state] || 'var(--text-dim)') + '"></span>' +
        '<span class="task-life-state">' + esc(String(e.state).replace('_', ' ')) + '</span>' +
        '<span class="task-life-at" title="' + esc(new Date(e.at).toLocaleString()) + '">' + fmtStamp(e.at) + '</span>' +
        (e.note ? '<span class="task-life-note">' + esc(e.note) + '</span>' : '') +
        '</div>';
    }
    html += '<div class="task-life-trail" id="tl-' + esc(t.id) + '" style="display:' + (open ? '' : 'none') + '">' + rows + '</div>';
  }
  return html;
}

/* --- Per-project chat ---------------------------------------------------------------
 *
 * Each project talks in its own session named project:<id>, which does two things: the run
 * arrives already carrying that project's CONTEXT.md and open tasks, and these conversations
 * stay out of the central Chat tab — one flat list of unlabelled sessions is exactly the mess
 * this avoids.
 *
 * The point is that you should not have to fill in a task form: say what you want here and the
 * agent creates and updates the tasks itself. The board refreshes when a reply lands so they
 * appear without switching views.
 */

var projSubtab = 'board';
/** The context preview starts collapsed, and stays however you last left it. */
var projContextOpen = false;

function toggleProjContext() {
  projContextOpen = !projContextOpen;
  var box = document.getElementById('proj-context');
  var caret = document.getElementById('proj-context-caret');
  if (box) box.style.display = projContextOpen ? '' : 'none';
  if (caret) caret.innerHTML = projContextOpen ? '&#9662;' : '&#9656;';
}
var pchatPending = {}; // taskId -> { el, projectId }

function projectSessionId(projectId) {
  return 'project:' + projectId;
}

function switchProjSubtab(name) {
  projSubtab = name;
  var board = document.getElementById('proj-board-view');
  var chat = document.getElementById('proj-chat-view');
  var files = document.getElementById('proj-files-view');
  if (board) board.style.display = name === 'board' ? '' : 'none';
  if (chat) chat.style.display = name === 'chat' ? '' : 'none';
  if (files) files.style.display = name === 'files' ? '' : 'none';
  var btns = document.querySelectorAll('.proj-subtab');
  for (var i = 0; i < btns.length; i++) {
    btns[i].classList.toggle('active', btns[i].textContent.toLowerCase() === name);
  }
  if (name === 'chat' && currentProjectId) {
    loadProjectChat(currentProjectId);
    // Reading the conversation is what clears it — opening the project's board is not.
    if (projClearUnread(currentProjectId)) loadProjects();
  }
  if (name === 'files' && currentProjectId) loadProjectFiles(currentProjectId);
}

/**
 * How many messages the window shows at once.
 *
 * The transcript on disk is the record and stays whole; this is only what gets painted. A months-old
 * project conversation is thousands of messages, and rendering all of them to show the last three
 * is the kind of thing that makes a page feel broken.
 */
var PCHAT_WINDOW = 40;
var pchatAll = [];

function loadProjectChat(projectId) {
  var box = document.getElementById('pchat-messages');
  if (!box) return;
  var epoch = viewEpoch;
  sendCommand('chat_history', { sessionId: projectSessionId(projectId) }).then(function(res) {
    if (viewChanged(epoch) || currentProjectId !== projectId) return;
    pchatAll = ((res && res.history) || []).filter(function(m) {
      return m.role === 'user' || m.role === 'brain';
    });
    renderProjectChat(PCHAT_WINDOW);
  }).catch(function() {
    var target = document.getElementById('pchat-messages');
    if (target) target.innerHTML = '<div class="empty">Could not load this conversation.</div>';
  });
}

function renderProjectChat(show) {
  var target = document.getElementById('pchat-messages');
  if (!target) return;

  if (!pchatAll.length) {
    target.innerHTML = '<div class="empty">Nothing yet. Describe what you want done and the agent will work out the tasks.</div>';
    return;
  }

  var count = Math.min(show, pchatAll.length);
  var start = pchatAll.length - count;
  target.innerHTML = '';

  if (start > 0) {
    var more = document.createElement('button');
    more.className = 'btn-subtle btn-sm pchat-earlier';
    more.textContent = 'Show ' + Math.min(PCHAT_WINDOW, start) + ' earlier of ' + start;
    more.onclick = function() { renderProjectChat(count + PCHAT_WINDOW); };
    target.appendChild(more);
  }

  for (var i = start; i < pchatAll.length; i++) {
    appendProjectMessage(pchatAll[i].role, pchatAll[i].content);
  }
  target.scrollTop = target.scrollHeight;
}

function pchatClear() {
  var projectId = currentProjectId;
  if (!projectId) return;
  pfAsk({
    title: 'Clear this conversation?',
    sub: 'Deletes the transcript for this project. The project, its docs and its tasks are untouched.',
    confirmLabel: 'Clear',
    danger: true,
    onOk: function() {
      sendCommand('chat_clear', { sessionId: projectSessionId(projectId) }).then(function(res) {
        if (res && res.ok === false) { showToast(res.error || 'Could not clear', 'error'); return; }
        pchatAll = [];
        renderProjectChat(PCHAT_WINDOW);
        showToast('Conversation cleared', 'success');
      }).catch(function(e) { showToast(e.message, 'error'); });
    }
  });
}

/**
 * Replace the older messages with a summary the agent writes.
 *
 * The alternative to a long transcript should not be only "delete it": every run that loads this
 * conversation pays for its whole length, and what you want kept is what was decided, not the
 * back-and-forth that got there. The agent does the summarizing, so this needs it running and
 * takes as long as a reply does.
 */
function pchatCompact() {
  var projectId = currentProjectId;
  if (!projectId) return;
  if (!agentIsRunning()) {
    showToast('Start the agent first — it writes the summary itself.', 'error');
    return;
  }

  pfAsk({
    title: 'Compact this conversation?',
    sub: 'The agent summarizes everything except the last few messages, and the summary replaces them. This cannot be undone, and takes about as long as a reply.',
    confirmLabel: 'Compact',
    onOk: function() {
      var btn = document.getElementById('pchat-compact');
      if (btn) { btn.disabled = true; btn.textContent = 'Compacting…'; }
      sendCommand('chat_compact', { sessionId: projectSessionId(projectId), keepLast: 6 }, 600000)
        .then(function(res) {
          if (res && res.ok === false) { showToast(res.error || 'Could not compact', 'error'); return; }
          if (res && res.compacted === false) { showToast('Already short enough to leave alone', 'info'); return; }
          showToast('Summarized ' + res.summarized + ' messages, kept the last ' + res.kept, 'success');
          loadProjectChat(projectId);
        })
        .catch(function(e) { showToast(e.message, 'error'); })
        .then(function() {
          var b = document.getElementById('pchat-compact');
          if (b) { b.disabled = false; b.textContent = 'Compact'; }
        });
    }
  });
}

function appendProjectMessage(role, text) {
  var box = document.getElementById('pchat-messages');
  if (!box) return null;
  var empty = box.querySelector('.empty');
  if (empty) box.innerHTML = '';
  var el = document.createElement('div');
  el.className = 'chat-msg ' + (role === 'user' ? 'chat-msg-user' : 'chat-msg-brain');
  if (role === 'brain') setBubbleMarkdown(el, text);
  else el.textContent = text;
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
  return el;
}

function pchatKey(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    pchatSend();
  }
}

function pchatSend() {
  var input = document.getElementById('pchat-input');
  var text = (input.value || '').trim();
  if (!text) return;
  var projectId = currentProjectId;
  if (!projectId) return;
  if (!agentIsRunning()) {
    showToast('Start the agent first.', 'error');
    return;
  }

  appendProjectMessage('user', text);
  input.value = '';
  var pending = appendProjectMessage('brain', 'Thinking…');
  if (pending) pending.classList.add('chat-msg-pending');

  var epoch = viewEpoch;
  sendCommand('submit', { input: text, sessionId: projectSessionId(projectId) }).then(function(res) {
    if (viewChanged(epoch)) return;
    if (res && res.taskId) {
      pchatPending[res.taskId] = { el: pending, projectId: projectId };
    } else if (pending) {
      pending.classList.remove('chat-msg-pending');
      pending.textContent = '(submitted)';
    }
  }).catch(function(err) {
    if (pending) {
      pending.className = 'chat-msg chat-msg-error';
      pending.textContent = String(err && err.message || err);
    }
  });
}

/** Completion handler, claimed before the central chat sees the event. */
function pchatOnTaskEvent(event, data, projectId, agentId) {
  var p = data && data.taskId ? pchatPending[data.taskId] : null;
  var target = agentId !== undefined ? agentId : currentAgentId;

  // No pending bubble means nobody typed this: it is a report from work started on the board or
  // picked up by a heartbeat, now delivered to the project's conversation. It still has to be
  // visible — the whole point of routing it here is that you find it next to the project.
  if (!p) {
    if (event !== 'task:completed' && event !== 'task:failed') return false;
    if (!projectId) return false;
    var here = target === currentAgentId;
    if (here && currentProjectId === projectId) {
      // Re-rendering the detail pane reloads the conversation when it is the open sub-tab, so a
      // report you are looking at appears without a badge; on the board or in Files it is unread.
      openProject(projectId);
      if (projSubtab !== 'chat') projBumpUnread(projectId, target);
    } else {
      // A report for an agent you are not looking at still has to be counted against THAT agent,
      // or switching to it would show a clean list while its project chat holds unread work.
      projBumpUnread(projectId, target);
      var ag = (lastAgents || []).filter(function(a) { return a.id === target; })[0];
      showToast('\\uD83E\\uDDE0 ' + ((ag && ag.name) || 'The agent') + ' reported in ' + projectId,
        event === 'task:failed' ? 'error' : 'success');
    }
    return true;
  }

  if (event === 'task:started') return true;

  delete pchatPending[data.taskId];
  if (p.el) {
    p.el.classList.remove('chat-msg-pending');
    if (event === 'task:completed') {
      setBubbleMarkdown(p.el, data.result || '(no response)');
    } else {
      p.el.className = 'chat-msg chat-msg-error';
      p.el.textContent = String((data && (data.result || data.error)) || 'Task failed');
    }
  }
  // Tasks the agent just created or moved should show up without switching views.
  if (currentProjectId === p.projectId) openProject(p.projectId);
  return true;
}

/* --- Project unread ------------------------------------------------------------------
 *
 * Reports now land in the project they belong to instead of the general chat, which is only an
 * improvement if you can tell one arrived. Deliberately its own small store rather than the Chat
 * tab's: project sessions are filtered out of that list, so counting them there would badge a
 * conversation you cannot open from it.
 *
 * Per agent, so switching agents doesn't show you another one's unread projects.
 */
var projUnreadStore = {};
try { projUnreadStore = JSON.parse(localStorage.getItem('projUnread') || '{}') || {}; } catch (e) { projUnreadStore = {}; }

function projUnreadFor(agentId) {
  var key = agentId !== undefined && agentId !== null ? agentId : (currentAgentId || 'default');
  if (!projUnreadStore[key]) projUnreadStore[key] = {};
  return projUnreadStore[key];
}
function projSaveUnread() {
  try { localStorage.setItem('projUnread', JSON.stringify(projUnreadStore)); } catch (e) {}
}
function projBumpUnread(projectId, agentId) {
  var m = projUnreadFor(agentId);
  m[projectId] = (m[projectId] || 0) + 1;
  projSaveUnread();
  // Only the list you are actually looking at needs repainting.
  if ((agentId === undefined ? currentAgentId : agentId) === currentAgentId) loadProjects();
}
function projClearUnread(projectId) {
  var m = projUnreadFor();
  if (!m[projectId]) return false;
  delete m[projectId];
  projSaveUnread();
  return true;
}

/**
 * The project file browser and manager.
 *
 * A project has at most two places its files live — its own folder in the agent workspace, and the
 * root it is attached to when there is one — and this browses both. Without it, seeing what the
 * agent actually wrote means ssh-ing to the machine it runs on, which is the wrong shape for a
 * dashboard that otherwise runs the whole project.
 *
 * Entries are addressed by index into the last listing rather than by path. Paths interpolated
 * into onclick handlers have to survive two layers of escaping and a quote in a filename breaks
 * them; an integer cannot.
 */

var pfProject = null;
var pfRoots = [];
var pfRoot = 'workspace';
var pfPath = '';
var pfEntries = [];
var pfListing = null; // the last listing, kept so the list can re-render without refetching
var pfOpen = null; // { root, rel, name, dirty }

function loadProjectFiles(projectId) {
  // Switching projects starts at the top; coming back to the same one keeps your place.
  if (pfProject !== projectId) { pfRoot = 'workspace'; pfPath = ''; pfOpen = null; }
  // The whole detail pane is rebuilt whenever the project re-renders, which takes the editor with
  // it. pfOpen surviving that points at a textarea no longer on the page — Save would then read
  // nothing and quietly do nothing, which is worse than the button being absent.
  if (!document.getElementById('pf-dirty')) pfOpen = null;
  pfProject = projectId;
  pfBrowse(pfRoot, pfPath);
}

function pfJoin(base, name) {
  return base ? base + '/' + name : name;
}

/**
 * Run an action, asking first if it would discard an unsaved edit.
 *
 * Callback-shaped rather than returning a boolean because the question is now a modal, and a
 * modal cannot block — every navigation path therefore hands its work to this rather than
 * checking a flag and continuing.
 */
function pfGuard(action) {
  if (!pfOpen || !pfOpen.dirty) { action(); return; }
  pfAsk({
    title: 'Discard unsaved changes?',
    sub: pfOpen.rel + ' has edits you have not saved.',
    confirmLabel: 'Discard',
    danger: true,
    onOk: action
  });
}

/**
 * The file manager's dialogs.
 *
 * These replace prompt()/confirm(): those block the page, cannot be styled to match anything,
 * and browsers increasingly suppress them outright — a delete that silently never asks is worse
 * than one that asks badly. pfPending holds the callback plus whether an input was rendered, so
 * pfAskOk never has to infer either from the DOM.
 */
var pfPending = null;

function pfAsk(opts) {
  pfPending = { onOk: opts.onOk, input: !!opts.input };

  var html = '<div class="modal-title">' + esc(opts.title) + '</div>';
  if (opts.sub) html += '<div class="modal-sub">' + esc(opts.sub) + '</div>';
  if (opts.input) {
    html += '<div class="form-field"><label class="form-label">' + esc(opts.label || 'Name') + '</label>' +
      '<input class="form-input" id="pf-ask-input" spellcheck="false" onkeydown="pfAskKey(event)" placeholder="' +
      esc(opts.placeholder || '') + '"></div>';
  }
  html += '<div class="modal-actions">' +
    '<button class="btn-subtle" onclick="pfAskCancel()">Cancel</button>' +
    '<button class="' + (opts.danger ? 'btn-danger' : 'btn-primary') + '" onclick="pfAskOk()">' +
    esc(opts.confirmLabel || 'OK') + '</button></div>';

  openModal(html);

  var input = document.getElementById('pf-ask-input');
  if (input) {
    input.value = opts.value || '';
    input.focus();
    // Select the stem, not the extension — renaming report.md is almost never about the ".md".
    var dot = (opts.value || '').lastIndexOf('.');
    if (opts.selectStem && dot > 0) input.setSelectionRange(0, dot);
    else input.select();
  }
}

function pfAskKey(event) {
  if (event.key === 'Enter') { event.preventDefault(); pfAskOk(); }
}

function pfAskCancel() {
  pfPending = null;
  closeModal();
}

function pfAskOk() {
  var pending = pfPending;
  if (!pending) return;

  var value = '';
  if (pending.input) {
    var el = document.getElementById('pf-ask-input');
    value = el ? el.value.trim() : '';
    // An empty name is not a decision — leave the dialog up rather than doing nothing silently.
    if (!value) { if (el) el.focus(); return; }
  }

  pfPending = null;
  closeModal();
  pending.onOk(value);
}

function pfRefresh() { pfBrowse(pfRoot, pfPath); }

function pfBrowse(root, relPath) {
  var list = document.getElementById('pf-list');
  if (!list || !pfProject) return;
  var epoch = viewEpoch;

  sendCommand('project_files', { id: pfProject, op: 'list', args: { root: root, path: relPath || '' } })
    .then(function(res) {
      if (viewChanged(epoch)) return;
      var listing = res.listing || {};
      pfRoots = res.roots || [];
      pfRoot = listing.root || root;
      pfPath = listing.rel || '';
      pfEntries = listing.entries || [];
      pfListing = listing;

      pfRenderRoots();
      pfRenderCrumb(listing);
      pfRenderList();
    })
    .catch(function(err) {
      if (viewChanged(epoch)) return;
      list.innerHTML = '<div class="empty" style="padding:14px">' + esc(String(err && err.message || err)) + '</div>';
    });
}

function pfRenderRoots() {
  var box = document.getElementById('pf-roots');
  if (!box) return;
  if (pfRoots.length < 2) { box.innerHTML = ''; return; }
  var html = '';
  for (var i = 0; i < pfRoots.length; i++) {
    html += '<button class="pf-root' + (pfRoots[i].key === pfRoot ? ' active' : '') + '" onclick="pfSwitchRoot(' + i + ')">' +
      esc(pfRoots[i].label) + '</button>';
  }
  box.innerHTML = html;
}

function pfSwitchRoot(index) {
  var root = pfRoots[index];
  if (!root || root.key === pfRoot) return;
  pfGuard(function() {
    pfOpen = null;
    pfClearEditor('Select a file to view or edit it.');
    pfBrowse(root.key, '');
  });
}

function pfRenderCrumb(listing) {
  var crumb = document.getElementById('pf-crumb');
  var abs = document.getElementById('pf-abs');
  if (!crumb) return;

  var label = 'root';
  for (var r = 0; r < pfRoots.length; r++) if (pfRoots[r].key === pfRoot) label = pfRoots[r].label;

  var html = '<a onclick="pfCrumbTo(0)">' + esc(label) + '</a>';
  var parts = pfPath ? pfPath.split('/') : [];
  for (var i = 0; i < parts.length; i++) {
    html += ' / ' + (i === parts.length - 1
      ? esc(parts[i])
      : '<a onclick="pfCrumbTo(' + (i + 1) + ')">' + esc(parts[i]) + '</a>');
  }
  crumb.innerHTML = html;
  if (abs) abs.textContent = listing.path || '';
}

function pfCrumbTo(depth) {
  var parts = pfPath ? pfPath.split('/') : [];
  var target = parts.slice(0, depth).join('/');
  pfGuard(function() { pfBrowse(pfRoot, target); });
}

function pfRenderList() {
  var box = document.getElementById('pf-list');
  var listing = pfListing;
  if (!box || !listing) return;

  var html = '';
  if (listing.parent !== null && listing.parent !== undefined) {
    html += '<div class="pf-row"><span class="pf-name dir" onclick="pfUp()">&#8593; ..</span></div>';
  }

  for (var i = 0; i < pfEntries.length; i++) {
    var e = pfEntries[i];
    var isOpen = pfOpen && pfOpen.root === pfRoot && pfOpen.rel === pfJoin(pfPath, e.name);
    html += '<div class="pf-row">' +
      '<span class="pf-name' + (e.kind === 'dir' ? ' dir' : '') + (isOpen ? ' open' : '') + '" onclick="pfEnter(' + i + ')">' +
      (e.kind === 'dir' ? '&#128193; ' : '&#128196; ') + esc(e.name) + (e.link ? ' &#8599;' : '') + '</span>' +
      '<span class="pf-size">' + (e.kind === 'dir' ? '' : humanBytes(e.size)) + '</span>' +
      (e.reserved
        ? '<span class="pf-lock" title="Managed by the project — edited through the project form and the task board">managed</span>'
        : '<div class="pf-row-actions">' +
          '<button onclick="pfRename(' + i + ')" title="Rename or move">rename</button>' +
          '<button onclick="pfDelete(' + i + ')" title="Delete">delete</button></div>') +
      '</div>';
  }

  if (!pfEntries.length) html += '<div class="empty" style="padding:14px">Empty folder.</div>';
  if (listing.truncated) html += '<div class="empty" style="padding:8px">Listing truncated — this folder has more entries than can be shown.</div>';
  box.innerHTML = html;
}

function pfUp() {
  var parts = pfPath ? pfPath.split('/') : [];
  parts.pop();
  var target = parts.join('/');
  pfGuard(function() { pfBrowse(pfRoot, target); });
}

function pfEnter(index) {
  var e = pfEntries[index];
  if (!e) return;
  if (e.kind === 'dir') {
    var into = pfJoin(pfPath, e.name);
    pfGuard(function() { pfBrowse(pfRoot, into); });
    return;
  }
  pfOpenFile(index);
}

function pfOpenFile(index) {
  var e = pfEntries[index];
  if (!e) return;
  pfGuard(function() { pfReadInto(e, pfJoin(pfPath, e.name)); });
}

function pfReadInto(e, rel) {
  var epoch = viewEpoch;

  sendCommand('project_files', { id: pfProject, op: 'read', args: { root: pfRoot, path: rel } })
    .then(function(res) {
      if (viewChanged(epoch)) return;
      pfOpen = { root: pfRoot, rel: rel, name: e.name, dirty: false };
      pfRenderEditor(res.file || {}, !!e.reserved);
      // Re-render so the open file reads as selected. No refetch — the listing has not changed.
      pfRenderList();
    })
    .catch(function(err) {
      if (viewChanged(epoch)) return;
      showToast(String(err && err.message || err), 'error');
    });
}

function pfClearEditor(message) {
  var box = document.getElementById('pf-edit');
  if (box) box.innerHTML = '<div class="empty" style="padding:14px">' + esc(message) + '</div>';
}

function pfRenderEditor(file, reserved) {
  var box = document.getElementById('pf-edit');
  if (!box) return;

  var head = '<div class="pf-edit-head"><div class="pf-edit-name">' + esc(file.rel || '') + '</div>' +
    '<span class="pf-dirty" id="pf-dirty"></span>';

  if (file.binary || file.tooLarge) {
    box.innerHTML = head + '</div><div class="empty" style="padding:14px">' +
      (file.binary
        ? 'Binary file (' + humanBytes(file.size || 0) + ') — nothing sensible to show in an editor.'
        : 'Too large to edit here (' + humanBytes(file.size || 0) + ').') +
      '</div>';
    return;
  }

  box.innerHTML = head +
    (reserved
      ? '<span class="pf-lock">read-only</span>'
      : '<button class="btn-primary btn-sm" onclick="pfSave()">Save</button>') +
    '</div><textarea id="pf-content" spellcheck="false"' + (reserved ? ' readonly' : ' oninput="pfMarkDirty()"') + '></textarea>';

  // Set through .value, never innerHTML: file contents are arbitrary text and a textarea built by
  // string concatenation is one "</textarea>" in a file away from breaking the page.
  document.getElementById('pf-content').value = file.content || '';
}

function pfMarkDirty() {
  if (pfOpen) pfOpen.dirty = true;
  var flag = document.getElementById('pf-dirty');
  if (flag) flag.textContent = 'unsaved';
}

function pfSave() {
  var el = document.getElementById('pf-content');
  if (!el || !pfOpen) return;

  sendCommand('project_files', { id: pfProject, op: 'write', args: { root: pfOpen.root, path: pfOpen.rel, content: el.value } })
    .then(function() {
      pfOpen.dirty = false;
      var flag = document.getElementById('pf-dirty');
      if (flag) flag.textContent = 'saved';
      showToast('Saved ' + pfOpen.rel, 'success');
      pfBrowse(pfRoot, pfPath);
    })
    .catch(function(err) { showToast(String(err && err.message || err), 'error'); });
}

function pfNewFile() {
  pfAsk({
    title: 'New file',
    sub: 'A path with / creates the folders on the way.',
    label: 'Name',
    placeholder: 'notes.md',
    confirmLabel: 'Create',
    input: true,
    onOk: function(name) {
      var rel = pfJoin(pfPath, name);
      var dir = rel.split('/').slice(0, -1).join('/');

      // 'create' rather than an empty write: writing would truncate a file that already has that
      // name, and silently emptying someone's file is the one thing a New button must never do.
      sendCommand('project_files', { id: pfProject, op: 'create', args: { root: pfRoot, path: rel } })
        .then(function() {
          // Land in the folder that now holds it, with it open. A new file you cannot see is
          // indistinguishable from one that was never created.
          pfOpen = { root: pfRoot, rel: rel, name: rel.split('/').pop(), dirty: false };
          pfRenderEditor({ rel: rel, size: 0, content: '' }, false);
          pfBrowse(pfRoot, dir);
        })
        .catch(function(err) { showToast(String(err && err.message || err), 'error'); });
    }
  });
}

function pfNewFolder() {
  pfAsk({
    title: 'New folder',
    label: 'Name',
    placeholder: 'assets',
    confirmLabel: 'Create',
    input: true,
    onOk: function(name) {
      sendCommand('project_files', { id: pfProject, op: 'mkdir', args: { root: pfRoot, path: pfJoin(pfPath, name) } })
        .then(function() { pfBrowse(pfRoot, pfPath); })
        .catch(function(err) { showToast(String(err && err.message || err), 'error'); });
    }
  });
}

function pfRename(index) {
  var e = pfEntries[index];
  if (!e) return;

  pfAsk({
    title: 'Rename',
    sub: 'A path with / moves it into that folder.',
    label: 'New name',
    value: e.name,
    selectStem: true,
    confirmLabel: 'Rename',
    input: true,
    onOk: function(name) {
      if (name === e.name) return;
      var from = pfJoin(pfPath, e.name);
      sendCommand('project_files', { id: pfProject, op: 'rename', args: { root: pfRoot, path: from, to: pfJoin(pfPath, name) } })
        .then(function() {
          if (pfOpen && pfOpen.rel === from) { pfOpen = null; pfClearEditor('Select a file to view or edit it.'); }
          pfBrowse(pfRoot, pfPath);
        })
        .catch(function(err) { showToast(String(err && err.message || err), 'error'); });
    }
  });
}

function pfDelete(index) {
  var e = pfEntries[index];
  if (!e) return;

  pfAsk({
    title: 'Delete ' + e.name + '?',
    sub: e.kind === 'dir'
      ? 'The folder and everything inside it. This cannot be undone.'
      : 'This cannot be undone.',
    confirmLabel: 'Delete',
    danger: true,
    onOk: function() {
      var rel = pfJoin(pfPath, e.name);
      sendCommand('project_files', { id: pfProject, op: 'delete', args: { root: pfRoot, path: rel } })
        .then(function() {
          if (pfOpen && pfOpen.rel === rel) { pfOpen = null; pfClearEditor('Select a file to view or edit it.'); }
          pfBrowse(pfRoot, pfPath);
        })
        .catch(function(err) { showToast(String(err && err.message || err), 'error'); });
    }
  });
}

/**
 * Adding files that already exist somewhere else: drop them on the list, or use Add files.
 *
 * Uploads go over HTTP rather than the websocket — a websocket frame would mean base64 in memory
 * on both ends, and these are real files. The destination is resolved server-side inside the
 * project's roots, so the browser never names a path on disk.
 */
function pfDragOver(event) {
  // Without preventDefault the browser navigates to the dropped file and the page is gone.
  event.preventDefault();
  var wrap = document.getElementById('pf-listwrap');
  if (wrap) wrap.classList.add('dragging');
}

function pfDragLeave(event) {
  // dragleave also fires moving between children, so only clear when leaving the wrapper itself.
  var wrap = document.getElementById('pf-listwrap');
  if (!wrap || (event.relatedTarget && wrap.contains(event.relatedTarget))) return;
  wrap.classList.remove('dragging');
}

function pfDrop(event) {
  event.preventDefault();
  var wrap = document.getElementById('pf-listwrap');
  if (wrap) wrap.classList.remove('dragging');
  var files = event.dataTransfer && event.dataTransfer.files;
  if (files && files.length) pfUploadFiles(files);
}

function pfPickUpload() {
  var input = document.getElementById('pf-file-input');
  if (input) { input.value = ''; input.click(); }
}

function pfFilesPicked(event) {
  var files = event.target && event.target.files;
  if (files && files.length) pfUploadFiles(files);
}

function pfUploadFiles(files) {
  var box = document.getElementById('pf-uploads');
  if (!box || !pfProject) return;

  var token = new URLSearchParams(location.search).get('token') || '';
  // Pin the destination now: the upload is async and the operator may browse elsewhere while it
  // runs, and a file landing in whichever folder happened to be open when it finished is a bug.
  var agentId = currentAgentId || '';
  var project = pfProject;
  var root = pfRoot;
  var dir = pfPath;
  var epoch = viewEpoch;
  var remaining = files.length;

  for (var i = 0; i < files.length; i++) {
    (function(file) {
      var row = document.createElement('div');
      row.className = 'pf-upload';
      var name = document.createElement('span');
      name.textContent = file.name;
      var bar = document.createElement('div');
      bar.className = 'pf-upload-bar';
      var fill = document.createElement('i');
      bar.appendChild(fill);
      row.appendChild(name);
      row.appendChild(bar);
      box.appendChild(row);

      var url = '/project-upload/' + encodeURIComponent(agentId) +
        '?token=' + encodeURIComponent(token) +
        '&project=' + encodeURIComponent(project) +
        '&root=' + encodeURIComponent(root) +
        '&dir=' + encodeURIComponent(dir) +
        '&name=' + encodeURIComponent(file.name);

      // XHR rather than fetch: upload progress has no fetch equivalent, and a large file with no
      // feedback is indistinguishable from one that failed.
      var xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      xhr.upload.onprogress = function(e) {
        if (e.lengthComputable) fill.style.width = Math.round((e.loaded / e.total) * 100) + '%';
      };
      xhr.onload = function() {
        var res = null;
        try { res = JSON.parse(xhr.responseText); } catch (e) { /* handled below */ }
        if (!res || !res.ok) {
          row.className = 'pf-upload bad';
          name.textContent = file.name + ' — ' + ((res && res.error) || 'upload failed');
          bar.remove();
        } else {
          fill.style.width = '100%';
          // Say so when the server had to rename around a collision, rather than leaving the
          // operator looking for a name that is not there.
          if (res.name !== file.name) name.textContent = file.name + ' → ' + res.name;
          setTimeout(function() { row.remove(); }, 2500);
        }
        if (--remaining === 0 && !viewChanged(epoch) && pfRoot === root && pfPath === dir) {
          pfBrowse(root, dir);
        }
      };
      xhr.onerror = function() {
        row.className = 'pf-upload bad';
        name.textContent = file.name + ' — upload failed';
        bar.remove();
        if (--remaining === 0 && !viewChanged(epoch) && pfRoot === root && pfPath === dir) {
          pfBrowse(root, dir);
        }
      };
      xhr.send(file);
    })(files[i]);
  }
}

function moveTask(projectId, taskId, state) {
  // Blocking without a reason is what makes a board useless a week later.
  var note = (state === 'blocked') ? prompt('Why is this blocked?') : null;
  if (state === 'blocked' && note === null) return;
  sendCommand('task_update', { projectId: projectId, taskId: taskId, patch: { state: state, note: note || undefined } })
    .then(function() { openProject(projectId); })
    .catch(function(err) { showToast(String(err && err.message || err), 'error'); });
}

/**
 * Hand a queued task to the agent right now.
 *
 * Queued work is otherwise picked up by the agent's heartbeat, which may be an hour away — this
 * is the "do it now" path. The agent moves the task through running/verifying itself, so the
 * board updates as it goes rather than from here.
 */
function runTaskNow(projectId, taskId) {
  if (!agentIsRunning()) {
    showToast('Start the agent first — it has to be running to work on a task.', 'error');
    return;
  }
  sendCommand('task_run', { projectId: projectId, taskId: taskId }).then(function(res) {
    if (res && res.ok === false) {
      showToast(String(res.error || 'Could not start the task'), 'error');
      return;
    }
    showToast('Handed to the agent — watch Live Events', 'success');
    setTimeout(function() { openProject(projectId); }, 1200);
  }).catch(function(err) { showToast(String(err && err.message || err), 'error'); });
}

function archiveProject(id) {
  if (!confirm('Archive "' + id + '"? Files and task history are kept.')) return;
  sendCommand('project_archive', { id: id }).then(function() {
    showToast('Project archived', 'success');
    currentProjectId = null;
    document.getElementById('proj-detail').innerHTML = '<div class="empty">Select a project.</div>';
    loadProjects();
  }).catch(function(err) { showToast(String(err && err.message || err), 'error'); });
}

function openCreateProject() {
  openModal('<div class="modal-title">New project</div>' +
    '<div class="modal-sub">A project holds its own context, notes and task queue.</div>' +
    '<div class="form-field"><label class="form-label">Id</label>' +
    '<input class="form-input" id="np-id" placeholder="openvole-4.17" oninput="npSyncName()"></div>' +
    '<div class="form-field"><label class="form-label">Name</label>' +
    '<input class="form-input" id="np-name" placeholder="OpenVole 4.17"></div>' +
    '<div class="form-field"><label class="form-label">Kind</label>' +
    '<select class="form-select" id="np-kind"><option value="general">general</option><option value="code">code</option><option value="writing">writing</option><option value="media">media</option><option value="research">research</option></select></div>' +
    '<div class="form-field"><label class="form-label">Project files (optional)</label>' +
    '<div class="path-row"><input class="form-input" id="np-root" placeholder="leave empty for self-contained"><button class="btn-subtle btn-sm" onclick="openDirPicker()">Browse&hellip;</button></div>' +
    '<div class="form-help">A directory on the machine running this agent. Leave it empty and the project lives in its own workspace folder.</div></div>' +
    '<div id="np-scan" class="form-help"></div>' +
    '<div class="modal-actions">' +
    '<button class="btn-subtle" onclick="scanProjectRoot()">Scan</button>' +
    '<button class="btn-subtle" onclick="closeModal()">Cancel</button>' +
    '<button class="btn-primary" onclick="createProject()">Create</button></div>');
}

/** Fill a blank name from the id as it is typed, without clobbering anything typed by hand. */
function npSyncName() {
  var id = document.getElementById('np-id');
  var name = document.getElementById('np-name');
  if (!name.dataset.touched) name.value = id.value;
}

var npScanned = null;
function scanProjectRoot() {
  var root = document.getElementById('np-root').value.trim();
  var out = document.getElementById('np-scan');
  if (!root) { out.textContent = 'Enter a path to scan.'; return; }
  out.textContent = 'Scanning…';
  sendCommand('project_scan', { root: root }).then(function(res) {
    npScanned = res;
    out.textContent = res.summary + (res.readFirst && res.readFirst.length ? ' · docs: ' + res.readFirst.join(', ') : '');
    if (res.kind) document.getElementById('np-kind').value = res.kind;
    var id = document.getElementById('np-id');
    if (!id.value && res.name) { id.value = String(res.name).replace(/[^a-z0-9._-]+/gi, '-').toLowerCase(); npSyncName(); }
  }).catch(function(err) {
    npScanned = null;
    out.textContent = String(err && err.message || err);
  });
}

function createProject() {
  var project = {
    id: document.getElementById('np-id').value.trim(),
    name: document.getElementById('np-name').value.trim() || undefined,
    kind: document.getElementById('np-kind').value,
    root: document.getElementById('np-root').value.trim() || undefined
  };
  if (npScanned && npScanned.stack) project.stack = npScanned.stack;
  if (!project.id) { showToast('Give the project an id', 'error'); return; }
  sendCommand('project_create', { project: project }).then(function(res) {
    closeModal();
    npScanned = null;
    showToast('Project created', 'success');
    loadProjects();
    openProject(res.project.id);
  }).catch(function(err) { showToast(String(err && err.message || err), 'error'); });
}

function openAddTask(projectId) {
  openModal('<div class="modal-title">Add task</div>' +
    '<div class="modal-sub">Give it criteria you can check — the agent must verify them before it may finish.</div>' +
    '<div class="form-field"><label class="form-label">Goal</label>' +
    '<input class="form-input" id="nt-goal" placeholder="Port paw-database off better-sqlite3"></div>' +
    '<div class="form-field"><label class="form-label">Done when (one per line)</label>' +
    '<textarea class="form-textarea" id="nt-criteria" rows="3" placeholder="pnpm test passes&#10;no better-sqlite3 in any package.json"></textarea></div>' +
    '<div class="form-field"><label class="form-label">Priority</label>' +
    '<input class="form-input" id="nt-priority" type="number" value="0"></div>' +
    '<div class="modal-actions">' +
    '<button class="btn-subtle" onclick="closeModal()">Cancel</button>' +
    '<button class="btn-primary" onclick="addTask(\\'' + esc(projectId) + '\\')">Add</button></div>');
}

function addTask(projectId) {
  var goal = document.getElementById('nt-goal').value.trim();
  if (!goal) { showToast('Give the task a goal', 'error'); return; }
  var raw = document.getElementById('nt-criteria').value.split('\\n');
  var criteria = [];
  for (var i = 0; i < raw.length; i++) { if (raw[i].trim()) criteria.push(raw[i].trim()); }
  var priority = parseInt(document.getElementById('nt-priority').value, 10);
  sendCommand('task_add', { task: {
    projectId: projectId,
    goal: goal,
    doneCriteria: criteria,
    priority: isNaN(priority) ? 0 : priority
  } }).then(function() {
    closeModal();
    showToast('Task added', 'success');
    openProject(projectId);
  }).catch(function(err) { showToast(String(err && err.message || err), 'error'); });
}

/**
 * Directory picker.
 *
 * A browser cannot hand back an absolute path — webkitdirectory yields relative names and the
 * File System Access API an opaque handle — so this walks the filesystem of the machine the agent
 * runs on, server-side, and returns real paths.
 *
 * Entries are addressed by index rather than by interpolating the path into the onclick. Paths
 * contain spaces, quotes and backslashes, and this file is itself a template literal that eats
 * escape characters — an index has nothing to quote.
 */
var dirPickerPath = null;
var dirPickerAllowed = false;
var dirPickerEntries = [];
var dirPickerParent = null;

function openDirPicker() {
  openModal('<div class="modal-title">Choose project files</div>' +
    '<div class="modal-sub">Directories on the machine running this agent.</div>' +
    '<div id="dp-crumb" class="dir-crumb">Loading&hellip;</div>' +
    '<div id="dp-list" class="dir-list"></div>' +
    '<div id="dp-note"></div>' +
    '<div class="modal-actions">' +
    '<button class="btn-subtle" onclick="openCreateProjectAgain()">Cancel</button>' +
    '<button class="btn-primary" onclick="useDirPicked()">Use this folder</button></div>');
  var current = document.getElementById('np-root');
  browseDir(current && current.value.trim() ? current.value.trim() : undefined);
}

/** Navigate by index into the last listing: -1 is the parent, otherwise a sub-folder. */
function browseDirAt(index) {
  if (index < 0) { if (dirPickerParent) browseDir(dirPickerParent); return; }
  var entry = dirPickerEntries[index];
  if (entry) browseDir(entry);
}

function browseDir(dirPath) {
  sendCommand('list_directories', dirPath ? { path: dirPath } : {}).then(function(res) {
    dirPickerPath = res.path;
    dirPickerAllowed = !!res.allowed;
    dirPickerParent = res.parent;
    dirPickerEntries = [];

    document.getElementById('dp-crumb').textContent = res.path;

    var html = '';
    if (res.parent) html += '<div class="dir-entry dir-up" onclick="browseDirAt(-1)">&#8593; up</div>';
    for (var i = 0; i < res.dirs.length; i++) {
      dirPickerEntries.push(res.dirs[i].path);
      html += '<div class="dir-entry" onclick="browseDirAt(' + i + ')">&#128193; ' + esc(res.dirs[i].name) + '</div>';
    }
    if (!res.dirs.length) html += '<div class="empty" style="padding:10px">No sub-folders here.</div>';
    document.getElementById('dp-list').innerHTML = html;

    // Say plainly whether this path is already granted, and offer the grant if not — otherwise
    // creating the project just fails later with a message about editing vole.config.json.
    var note = document.getElementById('dp-note');
    if (res.allowed) {
      note.className = 'dir-ok';
      note.textContent = 'This folder is inside the agent’s allowed paths.';
    } else {
      note.className = 'dir-grant';
      note.innerHTML = 'This folder is <strong>outside</strong> the agent’s allowed paths, so it cannot ' +
        'use it yet. Granting adds it to <code>security.allowedPaths</code> in this agent’s config.' +
        '<div style="margin-top:6px"><label><input type="checkbox" id="dp-grant"> Grant access to this folder</label></div>';
    }
  }).catch(function(err) {
    document.getElementById('dp-crumb').textContent = String(err && err.message || err);
    document.getElementById('dp-list').innerHTML = '';
  });
}

function useDirPicked() {
  if (!dirPickerPath) return;
  var grant = document.getElementById('dp-grant');
  var picked = dirPickerPath;

  var finish = function(restartRequired) {
    closeModal();
    openCreateProject();
    document.getElementById('np-root').value = picked;
    if (restartRequired) showToast('Path granted — restart the agent for it to take effect', 'info');
    scanProjectRoot();
  };

  if (!dirPickerAllowed && grant && grant.checked) {
    sendCommand('grant_path', { path: picked }).then(function(res) {
      finish(res && res.restartRequired);
    }).catch(function(err) { showToast(String(err && err.message || err), 'error'); });
    return;
  }
  finish(false);
}

/** Cancelling the picker returns to the create form rather than dropping it entirely. */
function openCreateProjectAgain() {
  closeModal();
  openCreateProject();
}

/* === Brain-drafted files ============================================================
 *
 * Writing SOUL.md or a project CONTEXT.md from a blank page is the step people skip, and a
 * missing CONTEXT.md is what quietly sends an agent back to re-deriving the same things every
 * run. So: describe it in a sentence and let the agent write the file.
 *
 * Drafts run as a normal task under a reserved session id, which keeps them out of the chat
 * transcript and the unread badge while still being real, logged agent work. The result fills
 * the editor — it is never saved for you, because a draft you have not read is not identity.
 */

var DRAFT_SESSION = '__draft__';
var pendingDrafts = {}; // taskId -> { fill, btn, help, timer }

/** What each file is for, so the agent writes the right kind of thing. */
var DRAFT_BRIEFS = {
  'SOUL.md': 'your own personality, voice and manner — how you come across when you talk',
  'USER.md': 'a profile of the human you work for: who they are, how they work, what they prefer',
  'AGENT.md': 'your standing operating rules and constraints — the things you always or never do',
  'HEARTBEAT.md': 'the recurring jobs you should carry out each time you wake on a heartbeat',
  'BRAIN.md': 'your complete system prompt, which replaces the default one entirely'
};

function agentIsRunning() {
  var list = lastAgents || [];
  for (var i = 0; i < list.length; i++) {
    if (list[i].id === currentAgentId) return list[i].state === 'running';
  }
  return false;
}

/**
 * Ask the agent to write a file and hand the text back.
 *
 * opts.fill receives the finished text. Everything else here is about being honest while waiting:
 * a stopped agent has no brain to ask, and a draft can take a while, so the button stays
 * disabled and the help line says what is happening.
 */
function requestDraft(opts) {
  var help = document.getElementById(opts.helpId);
  var btn = document.getElementById(opts.btnId);

  if (!agentIsRunning()) {
    help.className = 'draft-help bad';
    help.textContent = 'Start the agent first — drafting needs its brain.';
    return;
  }

  var prompt = (document.getElementById(opts.promptId).value || '').trim();
  if (!prompt) {
    help.className = 'draft-help bad';
    help.textContent = 'Say what it should cover, even roughly.';
    return;
  }

  btn.disabled = true;
  var started = Date.now();
  help.className = 'draft-help';
  help.textContent = 'Drafting…';
  var timer = setInterval(function() {
    help.textContent = 'Drafting… ' + Math.round((Date.now() - started) / 1000) + 's';
  }, 1000);

  var epoch = viewEpoch;
  sendCommand('submit', { input: opts.instruction(prompt), sessionId: DRAFT_SESSION })
    .then(function(res) {
      if (viewChanged(epoch)) { clearInterval(timer); btn.disabled = false; return; }
      if (res && res.taskId) {
        pendingDrafts[res.taskId] = { fill: opts.fill, btn: btn, help: help, timer: timer };
      } else {
        clearInterval(timer);
        btn.disabled = false;
        help.className = 'draft-help bad';
        help.textContent = 'The agent did not accept the request.';
      }
    })
    .catch(function(err) {
      clearInterval(timer);
      btn.disabled = false;
      help.className = 'draft-help bad';
      help.textContent = String(err && err.message || err);
    });
}

/** Completion handler, called from the same task event stream chat uses. */
function draftOnTaskEvent(event, data) {
  var d = data && data.taskId ? pendingDrafts[data.taskId] : null;
  if (!d) return false;
  if (event === 'task:started') return true;

  clearInterval(d.timer);
  d.btn.disabled = false;
  delete pendingDrafts[data.taskId];

  if (event === 'task:completed') {
    var text = stripDraftFence(String(data.result || ''));
    if (!text) {
      d.help.className = 'draft-help bad';
      d.help.textContent = 'The agent returned nothing.';
      return true;
    }
    d.fill(text);
    d.help.className = 'draft-help';
    d.help.textContent = 'Draft ready — read it, edit it, then save.';
  } else {
    d.help.className = 'draft-help bad';
    d.help.textContent = (data && (data.error || data.result)) ? String(data.error || data.result) : 'Drafting failed.';
  }
  return true;
}

/** Models like to wrap a whole file in a fence even when told not to. Unwrap one if present. */
function stripDraftFence(text) {
  var trimmed = text.trim();
  // \\x60 is a backtick: writing one literally would close the template literal this file is.
  var fence = trimmed.match(/^\\x60{3}[a-z]*\\n([\\s\\S]*?)\\n?\\x60{3}$/i);
  return (fence ? fence[1] : trimmed).trim();
}

function draftIdentityFile() {
  var file = currentIdentityFile;
  requestDraft({
    promptId: 'identity-draft-prompt',
    btnId: 'identity-draft-btn',
    helpId: 'identity-draft-help',
    instruction: function(prompt) {
      return 'Write the full contents of ' + file + ' for yourself. This file holds ' +
        (DRAFT_BRIEFS[file] || 'this part of your configuration') + '.\\n\\n' +
        'What it should say: ' + prompt + '\\n\\n' +
        'Return ONLY the markdown for the file itself — no preamble, no explanation, no code fence. ' +
        'Write it in the second person addressed to yourself, concise and concrete. ' +
        'Do not save it anywhere; just return the text.';
    },
    fill: function(text) {
      var editor = document.getElementById('identity-editor');
      if (editor.value.trim() && !confirm('Replace the current contents of ' + file + ' with the draft?')) return;
      editor.value = text;
      identityFiles[file] = text;
    }
  });
}

function draftProjectContext(projectId) {
  requestDraft({
    promptId: 'pc-draft-prompt',
    btnId: 'pc-draft-btn',
    helpId: 'pc-draft-help',
    instruction: function(prompt) {
      return 'Write the full contents of CONTEXT.md for the project "' + projectId + '".\\n\\n' +
        'First call project_open on "' + projectId + '" to see what it is. If it has a root, look at ' +
        'the real files — read its VOLE.md, README or equivalent — so what you write is grounded ' +
        'in what is actually there rather than guessed.\\n\\n' +
        'What it should cover: ' + prompt + '\\n\\n' +
        'CONTEXT.md is what a future run of you reads to understand this project: what it is, how to ' +
        'work in it, conventions, commands that matter, anything you would otherwise re-derive. ' +
        'Return ONLY the markdown for the file — no preamble, no code fence. Do not save it; just return the text.';
    },
    fill: function(text) {
      var box = document.getElementById('pc-body');
      if (box.value.trim() && !confirm('Replace the current CONTEXT.md with the draft?')) return;
      box.value = text;
    }
  });
}

function openEditContext(projectId) {
  sendCommand('project_open', { id: projectId }).then(function(res) {
    openModal('<div class="modal-title">CONTEXT.md</div>' +
      '<div class="modal-sub">What a future run reads to understand this project. The agent keeps this current too.</div>' +
      '<div class="draft-row"><input class="form-input" id="pc-draft-prompt" placeholder="Describe the project and let the agent write this&hellip;">' +
      '<button class="btn-subtle btn-sm" id="pc-draft-btn" onclick="draftProjectContext(\\'' + esc(projectId) + '\\')">Draft</button></div>' +
      '<div class="draft-help" id="pc-draft-help"></div>' +
      '<div class="form-field"><textarea class="form-textarea" id="pc-body" rows="14">' + esc(res.context || '') + '</textarea></div>' +
      '<div class="modal-actions">' +
      '<button class="btn-subtle" onclick="closeModal()">Cancel</button>' +
      '<button class="btn-primary" onclick="saveContext(\\'' + esc(projectId) + '\\')">Save</button></div>');
  }).catch(function(err) { showToast(String(err && err.message || err), 'error'); });
}

function saveContext(projectId) {
  var body = document.getElementById('pc-body').value;
  sendCommand('project_update', { id: projectId, patch: { context: body } }).then(function() {
    closeModal();
    showToast('CONTEXT.md saved', 'success');
    openProject(projectId);
  }).catch(function(err) { showToast(String(err && err.message || err), 'error'); });
}

function initVolenetTab() {
  refreshVnPeers();
  // Peer connect/disconnect isn't a bus event, so poll while the tab is open to keep
  // the list live (dead peers drop, new peers appear, online dots stay fresh).
  if (!vnPollTimer) {
    vnPollTimer = setInterval(function() {
      if (currentTab === 'volenet' && currentAgentId) refreshVnPeers();
    }, 5000);
  }
}

function renderVolenetTab(volenet) {
  vnPeers = (volenet && volenet.enabled && volenet.peers) ? volenet.peers : [];
  renderVnStatus(volenet);
  renderVnPeerList();
}

function renderVnStatus(volenet) {
  var el = document.getElementById('vn-statuscard');
  if (!el) return;
  if (!volenet || !volenet.enabled) {
    el.innerHTML = '<div class="vn-sc-off">VoleNet is not enabled for this agent.</div>';
    return;
  }
  var peers = volenet.peers || [];
  var online = peers.filter(function(p) { return p.lastSeen && (Date.now() - p.lastSeen) < 30000; }).length;
  var leader = volenet.isLeader ? '<span class="tag tag-green">leader</span>' : '<span class="tag tag-blue">follower</span>';
  el.innerHTML = '<div class="vn-sc-main"><strong>' + esc(volenet.instanceName || 'vole') + '</strong>'
      + '<span class="tag tag-purple">' + esc(volenet.instanceId || '') + '</span>' + leader + '</div>'
    + '<div class="vn-sc-stats">'
      + '<span><b>' + peers.length + '</b> peers</span>'
      + '<span><b>' + online + '</b> online</span>'
      + '<span><b>' + (volenet.remoteTools || 0) + '</b> remote tools</span>'
      + (volenet.leaderState && volenet.leaderState.leaderName ? '<span>leader: <b>' + esc(volenet.leaderState.leaderName) + '</b></span>' : '')
    + '</div>';
}

/* ── Outbound connect (dashboard vole net pair / join) ── */
var vnProbed = null; // { url, publicKey, fingerprint, name } after a successful probe
function vnToggleConnect() {
  var panel = document.getElementById('vn-connect-panel');
  var open = panel.style.display !== 'none';
  panel.style.display = open ? 'none' : '';
  if (open) { vnProbed = null; document.getElementById('vn-connect-result').innerHTML = ''; document.getElementById('vn-connect-go').textContent = 'Check'; }
}
function vnConnectMode() {
  var r = document.querySelector('input[name="vn-connect-mode"]:checked');
  return r ? r.value : 'pair';
}
function vnConnectGo() {
  var url = document.getElementById('vn-connect-url').value.trim();
  var result = document.getElementById('vn-connect-result');
  var go = document.getElementById('vn-connect-go');
  if (!url) { result.textContent = 'Enter a URL first.'; return; }
  var mode = vnConnectMode();
  if (mode === 'join') {
    go.disabled = true; result.textContent = 'Joining…';
    sendCommand('net_join_hub', { url: url }, 20000).then(function(res) {
      go.disabled = false;
      if (!res || res.ok === false) { result.textContent = 'Join failed: ' + ((res && res.error) || 'unknown'); return; }
      result.textContent = res.pending ? 'Join queued — the hub requires manual approval.' : ('Joined ' + (res.hubName || 'hub') + ' ✓');
      showToast('Hub joined', 'success');
      refreshVnPeers();
    }).catch(function(e) { go.disabled = false; result.textContent = 'Join failed: ' + e.message; });
    return;
  }
  // Pair: two steps — probe (show fingerprint) then confirm (trust + request).
  if (!vnProbed || vnProbed.url !== url) {
    go.disabled = true; result.textContent = 'Fetching identity…';
    var probeEpoch = viewEpoch;
    sendCommand('net_pair_probe', { url: url }, 15000).then(function(res) {
      if (viewChanged(probeEpoch)) return; // a peer identity for the agent you left
      go.disabled = false;
      if (!res || res.ok === false) { result.textContent = 'Probe failed: ' + ((res && res.error) || 'unknown'); return; }
      vnProbed = { url: url, publicKey: res.publicKey, fingerprint: res.fingerprint, name: res.name };
      var div = document.createElement('div');
      var strong = document.createElement('div');
      strong.textContent = (res.name ? res.name : '(name not published)') + (res.alreadyTrusted ? ' — already trusted' : '');
      var fp = document.createElement('div');
      fp.className = 'vn-fingerprint';
      fp.textContent = 'fingerprint: ' + res.fingerprint;
      div.appendChild(strong); div.appendChild(fp);
      var warn = document.createElement('div');
      warn.textContent = 'Verify this fingerprint on the other node before confirming.';
      div.appendChild(warn);
      result.innerHTML = '';
      result.appendChild(div);
      go.textContent = 'Trust & send pair request';
    }).catch(function(e) { go.disabled = false; result.textContent = 'Probe failed: ' + e.message; });
    return;
  }
  go.disabled = true;
  sendCommand('net_pair_initiate', { url: vnProbed.url, publicKey: vnProbed.publicKey, note: document.getElementById('vn-connect-note').value.trim() || undefined }, 20000).then(function(res) {
    go.disabled = false;
    if (!res || res.ok === false) { document.getElementById('vn-connect-result').textContent = 'Pair failed: ' + ((res && res.error) || 'unknown'); return; }
    document.getElementById('vn-connect-result').textContent = res.alreadyTrusted
      ? 'Already paired ✓ — connecting…'
      : 'Pair request sent — waiting for the other operator to accept.';
    showToast('Pair request sent', 'success');
    go.textContent = 'Check'; vnProbed = null;
    refreshVnPeers();
  }).catch(function(e) { go.disabled = false; document.getElementById('vn-connect-result').textContent = 'Pair failed: ' + e.message; });
}

function pairReqRow(r) {
  return '<div class="vn-req">'
    + '<div class="vn-req-top"><span class="vn-peer-name">' + esc(r.name || r.id) + '</span>'
    + '<span class="vn-req-via">wants to pair</span></div>'
    + (r.note ? '<div class="vn-req-note">' + esc(r.note) + '</div>' : '')
    + '<div class="vn-req-note">' + esc((r.id || '').substring(0, 16)) + '&hellip;</div>'
    + '<div class="vn-req-actions">'
    + '<button class="vn-req-ok" onclick="vnPairAccept(\\'' + esc(r.id) + '\\')">Accept</button>'
    + '<button class="vn-req-no" onclick="vnPairDeny(\\'' + esc(r.id) + '\\')">Deny</button>'
    + '</div></div>';
}
function vnPairAccept(ref) {
  sendCommand('net_pair_accept', { ref: ref }).then(function(res) {
    if (res && res.ok === false) { showToast('Pair accept failed: ' + (res.error || 'unknown'), 'error'); return; }
    showToast('Paired — the node is now trusted', 'success');
    refreshVnPeers();
  }).catch(function(e) { showToast('Pair accept failed: ' + e.message, 'error'); });
}
function vnPairDeny(ref) {
  sendCommand('net_pair_deny', { ref: ref }).then(function() { refreshVnPeers(); });
}

/**
 * Drop VoleNet unread for peers the roster no longer contains.
 *
 * A count is cleared by opening that peer's chat — so a peer that disappears (left the hub,
 * revoked, renamed) leaves a number nothing can clear, and the agent-card badge (which sums
 * VoleNet and brain-chat unread) hangs there forever. Only runs with a non-empty roster: an
 * empty one means VoleNet is off or has not loaded, not that every peer vanished.
 */
function vnSweepUnread() {
  if (!currentAgentId || !vnPeers.length) return;
  var known = {};
  for (var i = 0; i < vnPeers.length; i++) known[vnPeers[i].id] = true;
  for (var j = 0; j < vnPairRequests.length; j++) known[vnPairRequests[j].id] = true;
  var m = vnUnreadFor(currentAgentId);
  var dropped = false;
  for (var id in m) { if (!known[id]) { delete m[id]; dropped = true; } }
  if (dropped) vnSaveUnread();
}

function renderVnPeerList() {
  var list = document.getElementById('vn-peer-list');
  if (!list) return;
  vnSweepUnread();
  if (!vnPeers.length && !vnPairRequests.length) {
    list.innerHTML = '<div class="vn-empty" style="margin-top:20px;font-size:12px">No connected nodes.</div>';
    return;
  }
  function peerBtn(p) {
    // A relay member's "online" is the hub's word; a direct peer's is its own heartbeat.
    var online = p.lastSeen && (Date.now() - p.lastSeen) < 30000;
    var unread = vnUnreadFor(currentAgentId)[p.id] || 0;
    var active = p.id === vnSelectedPeer ? ' active' : '';
    var relay = p.kind === 'relay';
    // Relay state → tag: accepted (chattable) shows "relay"; requested shows "awaiting";
    // a fresh member shows "connect" to invite the handshake.
    var tag = '';
    if (relay && p.accepted) tag = '<span class="vn-relay-tag">relay</span>';
    else if (relay && p.awaiting) tag = '<span class="vn-relay-tag vn-tag-wait">awaiting</span>';
    else if (relay) tag = '<span class="vn-relay-tag vn-tag-new">connect</span>';
    return '<button class="vn-peer' + active + '" onclick="selectVnPeer(\\'' + esc(p.id) + '\\')"'
      + (relay ? ' title="Reachable through ' + esc(p.viaHubName || 'a relay hub') + ' — end-to-end encrypted"' : '')
      + '>'
      + '<span class="vn-dot' + (relay ? ' relay' : '') + (online ? ' online' : '') + '"></span>'
      + '<span class="vn-peer-name">' + esc(p.name || p.id) + '</span>'
      + tag
      + (unread ? '<span class="vn-badge">' + unread + '</span>' : '')
      + '<span class="vn-info" onclick="event.stopPropagation(); openDetail(\\'peer:' + esc(p.id) + '\\')" title="Peer details">&#9432;</span>'
      + '</button>';
  }
  function reqRow(p) {
    return '<div class="vn-req">'
      + '<div class="vn-req-top"><span class="vn-peer-name">' + esc(p.name || p.id) + '</span>'
      + '<span class="vn-req-via">via ' + esc(p.viaHubName || 'relay') + '</span></div>'
      + (p.note ? '<div class="vn-req-note">' + esc(p.note) + '</div>' : '')
      + '<div class="vn-req-actions">'
      + '<button class="vn-req-ok" onclick="vnApprove(\\'' + esc(p.id) + '\\')">Approve</button>'
      + '<button class="vn-req-no" onclick="vnDeny(\\'' + esc(p.id) + '\\')">Deny</button>'
      + '</div></div>';
  }
  var incoming = vnPeers.filter(function(p) { return p.kind === 'relay' && p.incoming && !p.accepted; });
  var directs = vnPeers.filter(function(p) { return p.kind !== 'relay'; });
  var relays = vnPeers.filter(function(p) { return p.kind === 'relay' && !(p.incoming && !p.accepted); });
  var html = '';
  if (vnPairRequests.length) html += '<div class="vn-group-head vn-group-req">Pair requests</div>' + vnPairRequests.map(pairReqRow).join('');
  if (incoming.length) html += '<div class="vn-group-head vn-group-req">Connection requests</div>' + incoming.map(reqRow).join('');
  if (directs.length) html += '<div class="vn-group-head">Direct mesh</div>' + directs.map(peerBtn).join('');
  if (relays.length) html += '<div class="vn-group-head">\\uD83D\\uDD12 Via relay</div>' + relays.map(peerBtn).join('');
  list.innerHTML = html;
}

function selectVnPeer(peerId) {
  if (vnSelectedPeer !== peerId) vnClearStagedFile();
  vnSelectedPeer = peerId;
  vnClearUnread(currentAgentId, peerId);
  var peer = vnPeers.filter(function(p) { return p.id === peerId; })[0];
  document.getElementById('vn-chat-head').textContent = peer ? (peer.name || peerId) : peerId;
  renderVnPeerList();
  var box = document.getElementById('vn-messages');
  var comp = document.getElementById('vn-composer');
  // Relay member without mutual consent: no chat box — a connect prompt (or an "awaiting" note)
  // instead. Sharing a hub isn't consent; the recipient must approve first.
  if (peer && peer.kind === 'relay' && !peer.accepted) {
    comp.style.display = 'none';
    if (peer.awaiting) {
      box.innerHTML = '<div class="vn-empty">Waiting for <b>' + esc(peer.name || peerId)
        + '</b> to accept your connection request&hellip;</div>';
    } else {
      box.innerHTML = '<div class="vn-connect">'
        + '<div class="vn-connect-title">Not connected yet</div>'
        + '<p>You and <b>' + esc(peer.name || peerId) + '</b> share a relay hub but have no connection. '
        + 'Send a request — they must approve before either of you can chat. '
        + 'Messages are end-to-end encrypted; the hub never sees them.</p>'
        + '<button class="vn-connect-btn" onclick="vnConnect(\\'' + esc(peerId) + '\\')">Send connection request</button>'
        + '</div>';
    }
    return;
  }
  comp.style.display = '';
  box.innerHTML = '<div class="vn-empty">Loading&hellip;</div>';
  var epoch = viewEpoch;
  sendCommand('volenet_chat_history', { peerId: peerId }).then(function(res) {
    if (viewChanged(epoch)) return;
    box.innerHTML = '';
    var h = (res && res.history) ? res.history : [];
    if (h.length) {
      for (var i = 0; i < h.length; i++) addVnBubble(h[i].dir, h[i].text, h[i].relayed);
    }
    // Restore live file-transfer state: history only carries 📎 marker text, so a
    // pending offer's Accept/Decline (or an in-flight transfer's progress) would be
    // lost if this chat wasn't open when the offer arrived.
    return sendCommand('net_file_status').catch(function() { return null; }).then(function(fs) {
      if (viewChanged(epoch)) return;
      var transfers = (fs && fs.transfers) ? fs.transfers : [];
      var live = { pending: 1, offered: 1, accepted: 1, transferring: 1, verifying: 1 };
      for (var j = 0; j < transfers.length; j++) {
        var t = transfers[j];
        if (t.peerId !== peerId || !live[t.state]) continue;
        addVnFileBubble(t.dir === 'recv' ? 'in' : 'out', {
          transferId: t.transferId, name: t.name, size: t.size, note: t.note,
          state: t.state === 'pending' ? 'offer — accept?' : t.state,
          pending: t.dir === 'recv' && (t.state === 'pending')
        });
      }
      if (!box.children.length) box.innerHTML = '<div class="vn-empty">No messages yet — say hi.</div>';
      box.scrollTop = box.scrollHeight;
    });
  }).catch(function() {
    if (viewChanged(epoch)) return;
    box.innerHTML = '<div class="vn-empty">Could not load history.</div>';
  });
}

function addVnBubble(dir, text, relayed) {
  var box = document.getElementById('vn-messages');
  var empty = box.querySelector('.vn-empty');
  if (empty) empty.remove();
  if (relayed) {
    var tag = document.createElement('div');
    tag.className = 'vn-msg-relayed';
    tag.textContent = '🔒 via relay — end-to-end encrypted';
    box.appendChild(tag);
  }
  var el = document.createElement('div');
  el.className = 'chat-msg chat-msg-' + (dir === 'out' ? 'user' : 'brain');
  el.textContent = text;
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
  return el;
}

function sendVolenetChat() {
  var input = document.getElementById('vn-input');
  var text = input.value.trim();
  if (!vnSelectedPeer) return;
  // A staged attachment ships on Send, with the typed text riding as the offer's note.
  if (vnPendingFile) {
    input.value = '';
    input.placeholder = 'Message this node…';
    vnSendStagedFile(text || undefined);
    return;
  }
  if (!text) return;
  input.value = '';
  // Selected peer is a relay member? Badge the sent bubble too.
  var sel = vnPeers.filter(function(p) { return p.id === vnSelectedPeer; })[0];
  var el = addVnBubble('out', text, sel && sel.kind === 'relay');
  var epoch = viewEpoch;
  sendCommand('volenet_chat_send', { peerId: vnSelectedPeer, text: text }).then(function(res) {
    if (viewChanged(epoch)) return;
    if (!res || res.ok === false) {
      el.className = 'chat-msg chat-msg-error';
      el.textContent = text + '  —  failed: ' + ((res && res.error) || 'unknown');
    } else if (res.delivered === false) {
      el.classList.add('chat-msg-pending');
      el.textContent = text + '  (peer offline — not delivered)';
    }
  }).catch(function(e) {
    if (viewChanged(epoch)) return;
    el.className = 'chat-msg chat-msg-error';
    el.textContent = text + '  —  ' + e.message;
  });
}

function volenetOnMessage(data, agentId) {
  if (!data) return;
  var targetAgent = agentId !== undefined ? agentId : currentAgentId;
  var isCurrent = !currentAgentId || agentId === undefined || agentId === currentAgentId;
  if (isCurrent && data.from === vnSelectedPeer && currentTab === 'volenet') {
    addVnBubble('in', data.text, data.relayed);
    return;
  }
  // Count for whichever agent it belongs to — a message to a non-selected agent must
  // still light its badges (agent card + its VoleNet tab when opened).
  vnBumpUnread(targetAgent, data.from);
  if (isCurrent) {
    renderVnPeerList();
    showToast('Message from ' + (data.fromName || 'a node'), 'success');
  } else {
    var ag = (typeof lastAgents !== 'undefined' ? lastAgents : []).filter(function(a) { return a.id === targetAgent; })[0];
    showToast('Message for ' + ((ag && ag.name) || 'another agent') + ' from ' + (data.fromName || 'a node'), 'success');
  }
}

/* ── VoleDrop file transfer (chat attachments) ── */
var vnTransfers = {};  // transferId -> bubble state element

function humanBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
  return (n / 1073741824).toFixed(2) + ' GB';
}

// A DOM-built file bubble (textContent only for user data). t: {transferId, name, size, state, from?}
function addVnFileBubble(dir, t) {
  var box = document.getElementById('vn-messages');
  if (!box) return null;
  var empty = box.querySelector('.vn-empty');
  if (empty) empty.remove();
  var el = document.createElement('div');
  el.className = 'chat-msg chat-msg-' + (dir === 'out' ? 'user' : 'brain') + ' vn-file-bubble';
  var name = document.createElement('div');
  name.textContent = '📎 ' + t.name + '  (' + humanBytes(t.size) + ')';
  el.appendChild(name);
  if (t.note) {
    var noteEl = document.createElement('div');
    noteEl.className = 'vn-file-note';
    noteEl.textContent = t.note;
    el.appendChild(noteEl);
  }
  var state = document.createElement('div');
  state.className = 'vn-file-state';
  state.textContent = t.state || '';
  el.appendChild(state);
  if (dir === 'in' && t.pending) {
    var row = document.createElement('div');
    row.className = 'vn-file-actions';
    var acc = document.createElement('button');
    acc.className = 'btn-primary';
    acc.textContent = 'Accept';
    acc.onclick = function() { vnFileDecide(t.transferId, true, el); };
    var rej = document.createElement('button');
    rej.className = 'btn-restart';
    rej.textContent = 'Decline';
    rej.onclick = function() { vnFileDecide(t.transferId, false, el); };
    row.appendChild(acc); row.appendChild(rej);
    el.appendChild(row);
  }
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
  vnTransfers[t.transferId] = el;
  return el;
}

function vnFileDecide(transferId, accept, el) {
  var actions = el.querySelector('.vn-file-actions');
  if (actions) actions.remove();
  var epoch = viewEpoch;
  sendCommand(accept ? 'net_file_accept' : 'net_file_reject', { transferId: transferId }).then(function(res) {
    if (viewChanged(epoch)) return; // the bubble left with the previous agent's chat
    if (res && res.ok === false) vnFileState(transferId, 'failed: ' + (res.error || 'unknown'));
    else if (!accept) vnFileState(transferId, 'declined');
    else vnFileState(transferId, 'accepted — downloading…');
  }).catch(function(e) { if (!viewChanged(epoch)) vnFileState(transferId, 'failed: ' + e.message); });
}

function vnFileState(transferId, text) {
  var el = vnTransfers[transferId];
  if (!el) return;
  var s = el.querySelector('.vn-file-state');
  if (s) s.textContent = text;
}

// A picked file is STAGED, not sent — Send ships it, with the typed text as the note.
var vnPendingFile = null;
function uploadVnFile(input) {
  var file = input.files && input.files[0];
  input.value = '';
  if (!file || !vnSelectedPeer) return;
  vnPendingFile = file;
  renderVnAttachChip();
  var msgInput = document.getElementById('vn-input');
  if (msgInput) { msgInput.placeholder = 'Add a message to send with the file…'; msgInput.focus(); }
}
function vnClearStagedFile() {
  vnPendingFile = null;
  renderVnAttachChip();
  var msgInput = document.getElementById('vn-input');
  if (msgInput) msgInput.placeholder = 'Message this node…';
}
function renderVnAttachChip() {
  var old = document.getElementById('vn-attach-chip');
  if (old) old.remove();
  if (!vnPendingFile) return;
  var comp = document.getElementById('vn-composer');
  var chip = document.createElement('div');
  chip.id = 'vn-attach-chip';
  chip.className = 'vn-attach-chip';
  var label = document.createElement('span');
  label.textContent = '📎 ' + vnPendingFile.name + ' (' + humanBytes(vnPendingFile.size) + ')';
  var x = document.createElement('button');
  x.textContent = '×';
  x.title = 'Remove attachment';
  x.onclick = vnClearStagedFile;
  chip.appendChild(label); chip.appendChild(x);
  comp.parentNode.insertBefore(chip, comp);
}
function vnSendStagedFile(note) {
  var file = vnPendingFile;
  vnClearStagedFile();
  var token = new URLSearchParams(location.search).get('token') || '';
  var el = addVnFileBubble('out', { transferId: 'up-' + Date.now(), name: file.name, size: file.size, state: 'uploading…', note: note });
  var epoch = viewEpoch;
  fetch('/upload/' + encodeURIComponent(currentAgentId || '') + '?token=' + encodeURIComponent(token) + '&name=' + encodeURIComponent(file.name), {
    method: 'POST', body: file
  }).then(function(r) { return r.json(); }).then(function(up) {
    if (!up || !up.ok) throw new Error((up && up.error) || 'upload failed');
    return sendCommand('net_file_send', { peerId: vnSelectedPeer, path: up.path, note: note });
  }).then(function(res) {
    if (!res || res.ok === false) throw new Error((res && res.error) || 'send failed');
    if (viewChanged(epoch)) return; // transfer is running; its bubble belongs to the old view
    // Rebind the optimistic bubble to the real transferId for event updates.
    if (el) { vnTransfers[res.transferId] = el; }
    vnFileState(res.transferId, 'offered — waiting for the peer…');
  }).catch(function(e) {
    if (viewChanged(epoch)) return;
    if (el) { el.className = 'chat-msg chat-msg-error'; el.querySelector('.vn-file-state').textContent = e.message; }
  });
}

function volenetOnFileEvent(event, data, agentId) {
  if (!data) return;
  var isCurrent = !currentAgentId || agentId === undefined || agentId === currentAgentId;
  if (event === 'volenet:file:offer') {
    var targetAgent = agentId !== undefined ? agentId : currentAgentId;
    var show = isCurrent && data.from === vnSelectedPeer && currentTab === 'volenet';
    if (show) {
      addVnFileBubble('in', { transferId: data.transferId, name: data.name, size: data.size, note: data.note, state: data.auto ? 'receiving…' : 'offer — accept?', pending: !data.auto });
    } else {
      vnBumpUnread(targetAgent, data.from);
      if (isCurrent) renderVnPeerList();
      showToast('📎 File offer from ' + (data.fromName || 'a node') + (data.auto ? '' : ' — open VoleNet to accept'), 'success');
    }
    return;
  }
  if (!isCurrent) return; // transfer-state updates only apply to visible bubbles
  if (event === 'volenet:file:progress') { vnFileState(data.transferId, (data.dir === 'send' ? 'sending' : 'receiving') + ' ' + data.pct + '%'); return; }
  if (event === 'volenet:file:received') { vnFileState(data.transferId, 'received ✓ → ' + data.path); return; }
  if (event === 'volenet:file:sent') { vnFileState(data.transferId, 'delivered ✓'); return; }
  if (event === 'volenet:file:failed') { vnFileState(data.transferId, 'failed: ' + data.code); return; }
  if (event === 'volenet:file:rejected') { vnFileState(data.transferId, 'declined by peer'); return; }
}

/* ── Relay consent handshake ── */
function vnConnect(peerId) {
  sendCommand('volenet_relay_connect', { peerId: peerId }).then(function(res) {
    if (res && res.ok === false) { showToast('Connect failed: ' + (res.error || 'unknown'), 'error'); return; }
    showToast('Connection request sent', 'success');
    var box = document.getElementById('vn-messages');
    if (vnSelectedPeer === peerId && box) {
      box.innerHTML = '<div class="vn-empty">Waiting for approval&hellip;</div>';
      document.getElementById('vn-composer').style.display = 'none';
    }
    refreshVnPeers();
  }).catch(function(e) { showToast('Connect failed: ' + e.message, 'error'); });
}

function vnApprove(peerId) {
  sendCommand('volenet_relay_approve', { peerId: peerId }).then(function(res) {
    if (res && res.ok === false) { showToast('Approve failed: ' + (res.error || 'unknown'), 'error'); return; }
    showToast('Connection approved — you can chat now', 'success');
    refreshVnPeers();
  }).catch(function(e) { showToast('Approve failed: ' + e.message, 'error'); });
}

function vnDeny(peerId) {
  sendCommand('volenet_relay_deny', { peerId: peerId }).then(function() {
    showToast('Request denied', 'success');
    if (vnSelectedPeer === peerId) resetVolenetChatPane();
    refreshVnPeers();
  }).catch(function(e) { showToast('Deny failed: ' + e.message, 'error'); });
}

function resetVolenetChatPane() {
  var box = document.getElementById('vn-messages');
  if (box) box.innerHTML = '<div class="vn-empty">Pick a node on the left to start chatting.</div>';
  var comp = document.getElementById('vn-composer');
  if (comp) comp.style.display = 'none';
  var head = document.getElementById('vn-chat-head');
  if (head) head.textContent = 'Select a node to chat';
  vnSelectedPeer = null;
}

function volenetOnRelayEvent(event, data, agentId) {
  if (agentId !== undefined && currentAgentId && agentId !== currentAgentId) return;
  var who = (data && data.fromName) || 'A node';
  if (event === 'volenet:relay:request') showToast(who + ' wants to connect', 'success');
  else if (event === 'volenet:relay:accepted') showToast(who + ' accepted your connection', 'success');
  else if (event === 'volenet:relay:denied') showToast(who + ' declined your connection', 'error');
  if (currentTab === 'volenet' && currentAgentId) refreshVnPeers();
  // If the peer we're viewing just accepted us, flip the pane into a live chat.
  if (event === 'volenet:relay:accepted' && data && data.from === vnSelectedPeer) {
    setTimeout(function() { selectVnPeer(vnSelectedPeer); }, 300);
  }
}

/* ── Render aggregated engine state ── */
function renderState(d) {
  lastStatePaws = d.paws || [];
  lastStateTools = d.tools || [];
  lastStateSkills = d.skills || [];
  lastStateSchedules = d.schedules || [];
  lastStateVolenet = d.volenet || { enabled: false };
  refreshToolNameOptions();
  renderPaws(d.paws || []);
  renderAppsNav(d.paws || []);
  refreshBrainOptions();
  renderTools(d.tools || []);
  renderSkills(d.skills || []);
  lastStateTasks = d.tasks || [];
  renderTasks(lastStateTasks);
  recomputeChatUnread();
  renderSchedules(d.schedules || []);
  renderVoleNet(d.volenet || { enabled: false });
  renderVolenetTab(d.volenet || { enabled: false });
  if (drawerSection) renderDrawerBody(); // keep an open drawer in sync with live state
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
  saveView();
  var tabs = document.querySelectorAll('.tab-btn');
  for (var i = 0; i < tabs.length; i++) {
    tabs[i].classList.toggle('active', tabs[i].getAttribute('data-tab') === tabName);
  }
  document.getElementById('tab-overview').style.display = tabName === 'overview' ? '' : 'none';
  document.getElementById('tab-chat').style.display = tabName === 'chat' ? '' : 'none';
  document.getElementById('tab-config').style.display = tabName === 'config' ? '' : 'none';
  document.getElementById('tab-identity').style.display = tabName === 'identity' ? '' : 'none';
  document.getElementById('tab-panel').style.display = tabName === 'apps' ? '' : 'none';
  document.getElementById('tab-volenet').style.display = tabName === 'volenet' ? '' : 'none';
  document.getElementById('tab-projects').style.display = tabName === 'projects' ? '' : 'none';
  if (tabName === 'projects') loadProjects();
  if (tabName === 'apps') showAppFrame();
  if (tabName === 'volenet') initVolenetTab();

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

var currentApp = null;
function renderAppsNav(paws) {
  var withPanel = (paws || []).filter(function(p) { return p && p.panel; });
  var btn = document.getElementById('tab-btn-apps');
  if (btn) btn.style.display = '';
  var nav = document.getElementById('apps-nav');
  var layout = document.getElementById('apps-layout');
  var empty = document.getElementById('apps-empty');
  if (!nav) return;
  if (!withPanel.length) {
    currentApp = null;
    nav.innerHTML = '';
    if (layout) layout.style.display = 'none';
    if (empty) {
      empty.style.display = 'flex';
      empty.innerHTML = '<div class="apps-empty-inner">'
        + '<div class="apps-empty-title">No paw apps here yet</div>'
        + '<div class="apps-empty-text">Apps appear here when a running paw provides a dashboard panel. Install one that ships a panel — like <code>@openvole/paw-markets</code> — from the Config tab, then start the agent.</div>'
        + '</div>';
    }
    return;
  }
  if (empty) empty.style.display = 'none';
  if (layout) layout.style.display = 'flex';
  var names = withPanel.map(function(p) { return p.name; });
  if (!currentApp || names.indexOf(currentApp) < 0) currentApp = withPanel[0].name;
  nav.innerHTML = withPanel.map(function(p) {
    var active = p.name === currentApp ? ' active' : '';
    return '<button class="apps-nav-item' + active + '" data-paw="' + esc(p.name) + '">' + esc(p.panel) + '</button>';
  }).join('');
  var items = nav.querySelectorAll('.apps-nav-item');
  for (var i = 0; i < items.length; i++) {
    items[i].addEventListener('click', function() { selectApp(this.getAttribute('data-paw')); });
  }
  if (currentTab === 'apps') showAppFrame();
}
function selectApp(paw) {
  currentApp = paw;
  var items = document.querySelectorAll('#apps-nav .apps-nav-item');
  for (var i = 0; i < items.length; i++) {
    items[i].classList.toggle('active', items[i].getAttribute('data-paw') === paw);
  }
  showAppFrame();
}
function showAppFrame() {
  var frame = document.getElementById('panel-frame');
  if (!frame || !currentAgentId || !currentApp) return;
  // The panel runs sandboxed (null origin) so paw-authored HTML can't read the dashboard token
  // or reach the parent. Its tool calls are proxied here over the authenticated WebSocket, scoped
  // to the panel's own agent — the panel never sees the token and can't touch other agents.
  if (!window.__voleToolRelay) {
    window.__voleToolRelay = true;
    window.addEventListener('message', function(e) {
      var f = document.getElementById('panel-frame');
      if (!f || e.source !== f.contentWindow) return;
      var d = e.data;
      if (!d || !d.__voleTool) return;
      var epoch = viewEpoch;
      sendCommand('call_paw_tool', { agent: currentAgentId, name: d.name, params: d.params })
        .then(function(result) {
          if (viewChanged(epoch)) return; // the frame now belongs to another agent's panel
          f.contentWindow.postMessage({ __voleToolResult: true, reqId: d.reqId, result: result }, '*');
        })
        .catch(function(err) {
          if (viewChanged(epoch)) return;
          f.contentWindow.postMessage({ __voleToolResult: true, reqId: d.reqId, result: { error: String(err) } }, '*');
        });
    });
  }
  // The dashboard (which holds the token) fetches the panel HTML and injects it via srcdoc, so the
  // authorized request is made by the parent — the sandboxed iframe carries no token, yet still loads.
  var key = currentAgentId + '::' + currentApp;
  if (frame.__loadedApp === key) return;
  frame.__loadedApp = key;
  fetch('/panel/' + encodeURIComponent(currentAgentId) + '/' + encodeURIComponent(currentApp) + '/' + location.search)
    .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
    .then(function(html) { if (frame.__loadedApp === key) frame.srcdoc = html; })
    .catch(function(err) {
      if (frame.__loadedApp !== key) return;
      frame.__loadedApp = null;
      frame.srcdoc = '<!doctype html><meta charset="utf-8"><body style="margin:0;padding:16px;font:13px system-ui,sans-serif;color:#888;background:#1a1a1a">Failed to load panel: ' + String(err && err.message ? err.message : err) + '</body>';
    });
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
    btns[i].addEventListener('click', function() { installPawIntoAgent(this.getAttribute('data-paw'), this); });
  }
}
function installPawIntoAgent(name, btn) {
  if (!currentAgentId) { showToast('Select a running agent first', 'error'); return; }
  if (btn) { btn.disabled = true; btn.textContent = 'Installing…'; }
  showToast('Installing ' + name + '… (npm install can take a moment)', 'success');
  sendCommand('install_paw', { name: name }, 180000).then(function(info) {
    var v = info && info.version ? '@' + info.version : '';
    showToast('Installed ' + name + v + ' — Restart the agent to load it', 'success');
    if (btn) { btn.textContent = 'Added'; btn.disabled = true; }
    loadConfig(); // reload Config tab so the new { name, allow } shows
  }).catch(function(e) {
    showToast('Install failed: ' + e.message, 'error');
    if (btn) { btn.textContent = 'Add'; btn.disabled = false; }
  });
}
var IS_DEMO = false;
function setDemoBanner(host, id, on, beforeNode) {
  if (!host) return;
  var b = document.getElementById(id);
  if (on && !b) {
    b = document.createElement('div');
    b.id = id;
    b.style.cssText = 'margin:0 0 14px;padding:10px 14px;border:1px solid #d29922;border-radius:8px;background:rgba(210,153,34,0.12);color:#d29922;font-size:13px';
    b.textContent = 'Demo mode — read-only. Edit vole.config.json on the server to change config or identity.';
    host.insertBefore(b, beforeNode || host.firstChild);
  } else if (!on && b) {
    b.remove();
  }
}
function applyDemoLock(on) {
  IS_DEMO = on;
  var cc = document.getElementById('config-content');
  if (cc) {
    var fields = cc.querySelectorAll('input, select, textarea, button');
    for (var i = 0; i < fields.length; i++) fields[i].disabled = on;
    setDemoBanner(cc, 'config-demo-banner', on, cc.firstChild);
  }
  var cfgSave = document.getElementById('btn-save-config');
  if (cfgSave) cfgSave.style.display = on ? 'none' : '';
  var idEd = document.getElementById('identity-editor');
  if (idEd) {
    idEd.readOnly = on;
    setDemoBanner(idEd.parentNode, 'identity-demo-banner', on, idEd);
  }
  var idSave = document.getElementById('btn-save-identity');
  if (idSave) idSave.style.display = on ? 'none' : '';
}
function loadConfig() {
  var epoch = viewEpoch;
  sendCommand('read_config').then(function(data) {
    // Late response after an agent switch: dropping it leaves the form empty for the new
    // agent (its own load is already running). Populating it would show A's config under B's
    // name — and Save would then write A's values into B.
    if (viewChanged(epoch)) return;
    cachedConfig = data || {};
    populateConfig(cachedConfig);
    configLoaded = true;
    applyDemoLock(!!cachedConfig.demo);
    showToast('Config loaded', 'success');
  }).catch(function(err) {
    if (viewChanged(epoch)) return;
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
    .map(function(p) { return p.configName || p.name; });
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
  var pawsRawToggle = document.getElementById('cfg-paws-rawmode');
  if (pawsRawToggle) pawsRawToggle.checked = false;
  pawsRawMode = false;
  document.getElementById('cfg-paws-raw-wrap').style.display = 'none';
  document.getElementById('cfg-paws-form').style.display = '';
  renderPawsForm(cfg.paws || []);
  populateToolProfiles(cfg.toolProfiles || {});
  populateAgents(cfg.agents || {});
  populateNet(cfg.net || {});
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
    + '<button class="agent-btn agent-btn-danger" type="button" title="Remove">&times;</button>';
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
    + '<button class="agent-btn agent-btn-danger" type="button" title="Remove">&times;</button>';
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
/* ── Paws editor: manifest-driven per-paw grant cards ── */
var pawsRawMode = false;

function pawStateFor(name) {
  var arr = lastStatePaws || [];
  // Match by configName (the identifier written in config, e.g. a local path) or the manifest name.
  for (var i = 0; i < arr.length; i++) {
    var p = arr[i];
    if (p && (p.configName === name || p.name === name)) return p;
  }
  return null;
}
function normPawEntry(p) {
  if (typeof p === 'string') p = { name: p };
  p = p || {};
  var allow = p.allow || {};
  return {
    name: p.name || '',
    hooks: p.hooks || null,
    network: Array.isArray(allow.network) ? allow.network.slice() : [],
    listen: Array.isArray(allow.listen) ? allow.listen.slice() : [],
    filesystem: Array.isArray(allow.filesystem) ? allow.filesystem.slice() : [],
    env: Array.isArray(allow.env) ? allow.env.slice() : [],
    childProcess: !!allow.childProcess
  };
}
function cssId(name) { return String(name).replace(/[^a-zA-Z0-9_-]/g, '_'); }

function renderPawsForm(paws) {
  var wrap = document.getElementById('cfg-paws-form');
  if (!wrap) return;
  wrap.innerHTML = '';
  paws = Array.isArray(paws) ? paws : [];
  if (paws.length === 0) {
    wrap.innerHTML = '<div class="form-help">No paws configured. Use “Browse official paws” below to add one.</div>';
    return;
  }
  for (var i = 0; i < paws.length; i++) wrap.appendChild(buildPawCard(normPawEntry(paws[i])));
}

// A labelled field wrapper.
function pawField(label, help) {
  var f = document.createElement('div');
  f.className = 'paw-field';
  var l = document.createElement('div'); l.className = 'paw-field-label'; l.textContent = label;
  f.appendChild(l);
  if (help) { var h = document.createElement('div'); h.className = 'form-help'; h.innerHTML = help; f.appendChild(h); }
  return f;
}
// A removable text-input row inside a container; syncs on input.
function pawInputRow(container, value, placeholder, listId) {
  var row = document.createElement('div');
  row.className = 'paw-row';
  var input = document.createElement('input');
  input.type = 'text'; input.className = 'form-input paw-input';
  input.placeholder = placeholder || '';
  input.value = value == null ? '' : String(value);
  if (listId) input.setAttribute('list', listId);
  input.addEventListener('input', syncPawsFormToRaw);
  var del = document.createElement('button');
  del.type = 'button'; del.className = 'agent-btn agent-btn-danger'; del.title = 'Remove'; del.innerHTML = '&times;';
  del.addEventListener('click', function() { row.remove(); syncPawsFormToRaw(); });
  row.appendChild(input); row.appendChild(del);
  container.appendChild(row);
  return input;
}
function readPawInputs(container) {
  var out = [];
  if (!container) return out;
  var inputs = container.querySelectorAll('.paw-input');
  for (var i = 0; i < inputs.length; i++) { var v = inputs[i].value.trim(); if (v) out.push(v); }
  return out;
}
// A list field (rows + Add button), rows tagged with rowsClass so the card can read them back.
function pawListField(label, help, rowsClass, values, placeholder, suggestions, listId) {
  var f = pawField(label, help);
  var rows = document.createElement('div'); rows.className = rowsClass;
  f.appendChild(rows);
  var add = document.createElement('button');
  add.type = 'button'; add.className = 'btn-restart'; add.textContent = '+ Add'; add.style.marginTop = '6px';
  add.addEventListener('click', function() { pawInputRow(rows, '', placeholder, listId); syncPawsFormToRaw(); });
  f.appendChild(add);
  for (var i = 0; i < (values || []).length; i++) pawInputRow(rows, values[i], placeholder, listId);
  if (suggestions && suggestions.length && listId) {
    var dl = document.createElement('datalist'); dl.id = listId;
    dl.innerHTML = suggestions.map(function(s){ return '<option value="' + esc(String(s)) + '"></option>'; }).join('');
    f.appendChild(dl);
  }
  return f;
}

function buildPawCard(m) {
  var st = pawStateFor(m.name);
  var reqs = (st && st.permissions) || null;
  var card = document.createElement('div');
  card.className = 'paw-card collapsed';
  card.setAttribute('data-paw', m.name);

  // Header (click to expand/collapse): chevron + health dot + name + category badge + at-a-glance summary + remove.
  var head = document.createElement('div'); head.className = 'paw-card-head';
  var title = document.createElement('div'); title.className = 'paw-card-title';
  var dot = st ? '<span class="paw-dot ' + (st.healthy ? 'ok' : 'bad') + '" title="' + (st.healthy ? 'loaded' : 'not loaded') + '"></span>' : '';
  var badge = st && st.category ? '<span class="paw-badge">' + esc(st.category) + '</span>' : '';
  title.innerHTML = '<span class="paw-card-arrow">&#9656;</span>' + dot + '<span class="paw-name">' + esc(m.name) + '</span>' + badge + '<span class="paw-card-summary"></span>';
  head.appendChild(title);
  var rm = document.createElement('button');
  rm.type = 'button'; rm.className = 'agent-btn agent-btn-danger'; rm.textContent = 'Remove';
  rm.addEventListener('click', function(e) { e.stopPropagation(); card.remove(); syncPawsFormToRaw(); });
  head.appendChild(rm);
  head.addEventListener('click', function() { card.classList.toggle('collapsed'); });
  card.appendChild(head);

  var body = document.createElement('div'); body.className = 'paw-card-body';

  if (st && st.description) {
    var desc = document.createElement('div'); desc.className = 'form-help';
    desc.textContent = st.description;
    body.appendChild(desc);
  }
  if (!st) {
    var note = document.createElement('div'); note.className = 'form-help paw-note';
    note.textContent = 'Manifest not loaded — start the agent to see the exact permissions this paw requests. Editing free-form.';
    body.appendChild(note);
  }

  // Child process
  var reqCp = reqs ? !!reqs.childProcess : false;
  var cpF = pawField('Child process', reqCp
    ? 'This paw <b>requests</b> permission to spawn child processes.'
    : 'Let this paw spawn child processes (shell, npx, browsers). This effectively grants broad filesystem access — only for trusted paws.');
  var cpRow = document.createElement('label'); cpRow.className = 'form-checkbox-row';
  var cpCb = document.createElement('input'); cpCb.type = 'checkbox'; cpCb.className = 'form-checkbox pc-childprocess'; cpCb.checked = m.childProcess;
  cpCb.addEventListener('change', syncPawsFormToRaw);
  var cpLbl = document.createElement('span'); cpLbl.className = 'form-checkbox-label'; cpLbl.textContent = 'allow.childProcess' + (reqCp ? ' (requested)' : '');
  cpRow.appendChild(cpCb); cpRow.appendChild(cpLbl); cpF.appendChild(cpRow);
  body.appendChild(cpF);

  // Network
  var netSug = (reqs && reqs.network) || [];
  var netF = pawField('Network', netSug.length ? ('Requested: <code>' + esc(netSug.join(', ')) + '</code>') : 'Outbound hosts this paw may reach.');
  var netSel = document.createElement('select'); netSel.className = 'form-select pc-net-mode';
  netSel.innerHTML = '<option value="none">No network</option><option value="all">All hosts (*)</option><option value="hosts">Specific hosts</option>';
  var isAll = m.network.indexOf('*') >= 0;
  netSel.value = isAll ? 'all' : (m.network.length ? 'hosts' : 'none');
  var netListId = 'pawnet-' + cssId(m.name);
  var hostsWrap = document.createElement('div'); hostsWrap.className = 'pc-net-hosts';
  var addHost = document.createElement('button');
  addHost.type = 'button'; addHost.className = 'btn-restart'; addHost.textContent = '+ Add host'; addHost.style.marginTop = '6px';
  addHost.addEventListener('click', function() { pawInputRow(hostsWrap, '', 'api.example.com', netSug.length ? netListId : ''); syncPawsFormToRaw(); });
  function paintHosts() {
    var show = netSel.value === 'hosts';
    hostsWrap.style.display = show ? '' : 'none';
    addHost.style.display = show ? '' : 'none';
  }
  netSel.addEventListener('change', function() { paintHosts(); syncPawsFormToRaw(); });
  netF.appendChild(netSel);
  netF.appendChild(hostsWrap);
  netF.appendChild(addHost);
  var initHosts = m.network.filter(function(x){ return x !== '*'; });
  for (var hi = 0; hi < initHosts.length; hi++) pawInputRow(hostsWrap, initHosts[hi], 'api.example.com', netSug.length ? netListId : '');
  if (netSug.length) {
    var ndl = document.createElement('datalist'); ndl.id = netListId;
    ndl.innerHTML = netSug.map(function(s){ return '<option value="' + esc(String(s)) + '"></option>'; }).join('');
    netF.appendChild(ndl);
  }
  paintHosts();
  body.appendChild(netF);

  // Env — checkboxes for manifest-declared vars + free rows for extras
  var declared = (reqs && reqs.env) || [];
  var granted = m.env.slice();
  var envF = pawField('Environment variables', declared.length
    ? 'Check the variables this paw may read — these are what its manifest declares.'
    : 'Environment variable names this paw may read.');
  var declaredSet = {};
  if (declared.length) {
    var grid = document.createElement('div'); grid.className = 'paw-env-grid';
    for (var di = 0; di < declared.length; di++) {
      declaredSet[declared[di]] = true;
      var item = document.createElement('label'); item.className = 'paw-env-item';
      var ecb = document.createElement('input'); ecb.type = 'checkbox'; ecb.className = 'form-checkbox pc-env'; ecb.setAttribute('data-env', declared[di]);
      ecb.checked = granted.indexOf(declared[di]) >= 0;
      ecb.addEventListener('change', syncPawsFormToRaw);
      var espan = document.createElement('span'); espan.textContent = declared[di];
      item.appendChild(ecb); item.appendChild(espan); grid.appendChild(item);
    }
    envF.appendChild(grid);
  }
  var extraWrap = document.createElement('div'); extraWrap.className = 'pc-env-extra';
  envF.appendChild(extraWrap);
  var addEnv = document.createElement('button');
  addEnv.type = 'button'; addEnv.className = 'btn-restart'; addEnv.textContent = '+ Add variable'; addEnv.style.marginTop = '6px';
  addEnv.addEventListener('click', function() { pawInputRow(extraWrap, '', 'ENV_VAR_NAME'); syncPawsFormToRaw(); });
  envF.appendChild(addEnv);
  var extras = granted.filter(function(v){ return !declaredSet[v]; });
  for (var xi = 0; xi < extras.length; xi++) pawInputRow(extraWrap, extras[xi], 'ENV_VAR_NAME');
  body.appendChild(envF);

  // Filesystem
  body.appendChild(pawListField('Filesystem paths',
    'Extra paths only this paw may read/write, beyond its own data dir.',
    'pc-fs', m.filesystem, '.openvole/workspace or /abs/path', null, null));

  // Listen ports
  var listenSug = (reqs && reqs.listen) || [];
  body.appendChild(pawListField('Listen ports',
    listenSug.length ? ('Requested: <code>' + esc(listenSug.join(', ')) + '</code>') : 'TCP ports this paw may bind.',
    'pc-listen', m.listen, 'e.g. 8080', listenSug, 'pawlisten-' + cssId(m.name)));

  // Advanced: perceive hook ordering
  var adv = document.createElement('details');
  var sum = document.createElement('summary'); sum.className = 'paw-adv-summary'; sum.textContent = 'Advanced — perceive hook';
  adv.appendChild(sum);
  var advBody = document.createElement('div'); advBody.style.marginTop = '8px';
  var hook = (m.hooks && m.hooks.perceive) || {};
  var ordRow = document.createElement('div'); ordRow.className = 'paw-row';
  var ordLbl = document.createElement('span'); ordLbl.className = 'form-checkbox-label'; ordLbl.textContent = 'hooks.perceive.order';
  var ordInput = document.createElement('input'); ordInput.type = 'number'; ordInput.className = 'form-input pc-hook-order'; ordInput.style.width = '120px';
  ordInput.value = (hook.order != null ? hook.order : '');
  ordInput.addEventListener('input', syncPawsFormToRaw);
  ordRow.appendChild(ordLbl); ordRow.appendChild(ordInput);
  advBody.appendChild(ordRow);
  var pipeRow = document.createElement('label'); pipeRow.className = 'form-checkbox-row'; pipeRow.style.marginTop = '8px';
  var pipeCb = document.createElement('input'); pipeCb.type = 'checkbox'; pipeCb.className = 'form-checkbox pc-hook-pipeline'; pipeCb.checked = !!hook.pipeline;
  pipeCb.addEventListener('change', syncPawsFormToRaw);
  var pipeLbl = document.createElement('span'); pipeLbl.className = 'form-checkbox-label'; pipeLbl.textContent = 'hooks.perceive.pipeline';
  pipeRow.appendChild(pipeCb); pipeRow.appendChild(pipeLbl);
  advBody.appendChild(pipeRow);
  adv.appendChild(advBody);
  body.appendChild(adv);

  card.appendChild(body);
  card.querySelector('.paw-card-summary').textContent = pawSummary(serializePawCard(card));
  return card;
}

// One-line grant summary shown in the collapsed card header.
function pawSummary(entry) {
  if (typeof entry === 'string') return 'no grants';
  var a = entry.allow || {};
  var parts = [];
  if (a.childProcess) parts.push('child-proc');
  if (a.network && a.network.length) parts.push(a.network.indexOf('*') >= 0 ? 'net:*' : 'net:' + a.network.length);
  if (a.env && a.env.length) parts.push('env:' + a.env.length);
  if (a.filesystem && a.filesystem.length) parts.push('fs:' + a.filesystem.length);
  if (a.listen && a.listen.length) parts.push('listen:' + a.listen.length);
  if (entry.hooks) parts.push('hook');
  return parts.length ? parts.join(' · ') : 'no grants';
}

function serializePawCard(card) {
  var name = card.getAttribute('data-paw') || '';
  var allow = {};
  if (card.querySelector('.pc-childprocess').checked) allow.childProcess = true;
  var mode = card.querySelector('.pc-net-mode').value;
  if (mode === 'all') allow.network = ['*'];
  else if (mode === 'hosts') { var hosts = readPawInputs(card.querySelector('.pc-net-hosts')); if (hosts.length) allow.network = hosts; }
  var env = [];
  var ecbs = card.querySelectorAll('.pc-env');
  for (var i = 0; i < ecbs.length; i++) { if (ecbs[i].checked) env.push(ecbs[i].getAttribute('data-env')); }
  var extra = readPawInputs(card.querySelector('.pc-env-extra'));
  for (var j = 0; j < extra.length; j++) { if (env.indexOf(extra[j]) < 0) env.push(extra[j]); }
  if (env.length) allow.env = env;
  var fs = readPawInputs(card.querySelector('.pc-fs')); if (fs.length) allow.filesystem = fs;
  var ports = [];
  var pin = readPawInputs(card.querySelector('.pc-listen'));
  for (var k = 0; k < pin.length; k++) { var n = parseInt(pin[k], 10); if (!isNaN(n) && n > 0) ports.push(n); }
  if (ports.length) allow.listen = ports;
  var hooks = null;
  var order = parseInt(card.querySelector('.pc-hook-order').value, 10);
  var pipeline = card.querySelector('.pc-hook-pipeline').checked;
  if (!isNaN(order) || pipeline) {
    hooks = { perceive: {} };
    if (!isNaN(order)) hooks.perceive.order = order;
    if (pipeline) hooks.perceive.pipeline = true;
  }
  if (Object.keys(allow).length === 0 && !hooks) return name; // bare string when nothing is granted
  var entry = { name: name };
  if (Object.keys(allow).length) entry.allow = allow;
  if (hooks) entry.hooks = hooks;
  return entry;
}

function syncPawsFormToRaw() {
  var cards = document.querySelectorAll('#cfg-paws-form .paw-card');
  var out = [];
  for (var i = 0; i < cards.length; i++) {
    var entry = serializePawCard(cards[i]);
    out.push(entry);
    var sum = cards[i].querySelector('.paw-card-summary');
    if (sum) sum.textContent = pawSummary(entry);
  }
  var ta = document.getElementById('cfg-paws');
  if (ta) ta.value = JSON.stringify(out, null, 2);
}

function togglePawsRaw(on) {
  pawsRawMode = on;
  var raw = document.getElementById('cfg-paws-raw-wrap');
  var form = document.getElementById('cfg-paws-form');
  if (on) {
    syncPawsFormToRaw();
    raw.style.display = ''; form.style.display = 'none';
  } else {
    var arr;
    try { arr = JSON.parse(document.getElementById('cfg-paws').value || '[]'); }
    catch (e) {
      showToast('Raw JSON is invalid — fix it before switching back to the form.', 'error');
      document.getElementById('cfg-paws-rawmode').checked = true; pawsRawMode = true; return;
    }
    renderPawsForm(arr);
    raw.style.display = 'none'; form.style.display = '';
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
    + '<button class="agent-btn agent-btn-danger" type="button" title="Remove profile">&times;</button>';
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
    + '<button class="agent-btn agent-btn-danger" type="button" title="Remove">&times;</button>';
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
function populateAgents(ag) {
  document.getElementById('ag-blocks').innerHTML = '';
  ag = ag || {};
  for (var name in ag) addAgBlock(name, ag[name]);
}
function addAgBlock(name, profile) {
  profile = profile || {};
  var block = document.createElement('div');
  block.className = 'ag-block';
  block.style.cssText = 'border:1px solid var(--border);border-radius:6px;padding:10px;margin-top:8px';
  var head = document.createElement('div');
  head.style.cssText = 'display:flex;gap:8px;align-items:center';
  head.innerHTML = '<input type="text" class="form-input ag-name" style="flex:1" placeholder="agent name (e.g. researcher)" value="' + esc(String(name || '')) + '">'
    + '<button class="agent-btn agent-btn-danger" type="button" title="Remove agent">&times;</button>';
  head.querySelector('button').addEventListener('click', function() { block.remove(); });
  block.appendChild(head);

  var roleField = document.createElement('div');
  roleField.style.cssText = 'margin-top:8px';
  roleField.innerHTML = '<div style="font-size:11px;color:var(--text-dim);margin-bottom:2px">Role</div>'
    + '<input type="text" class="form-input ag-role" placeholder="Human-readable role" value="' + esc(String(profile.role || '')) + '">';
  block.appendChild(roleField);

  var instrField = document.createElement('div');
  instrField.style.cssText = 'margin-top:8px';
  instrField.innerHTML = '<div style="font-size:11px;color:var(--text-dim);margin-bottom:2px">Instructions</div>';
  var ta = document.createElement('textarea');
  ta.className = 'form-textarea ag-instructions';
  ta.rows = 3;
  ta.placeholder = "Injected into the sub-agent's context";
  ta.value = String(profile.instructions || '');
  instrField.appendChild(ta);
  block.appendChild(instrField);

  var iterField = document.createElement('div');
  iterField.style.cssText = 'margin-top:8px';
  iterField.innerHTML = '<div style="font-size:11px;color:var(--text-dim);margin-bottom:2px">Max iterations</div>'
    + '<input type="number" class="form-input ag-maxiter" min="1" placeholder="10" style="width:120px" value="' + (profile.maxIterations != null ? esc(String(profile.maxIterations)) : '') + '">';
  block.appendChild(iterField);

  var cols = document.createElement('div');
  cols.style.cssText = 'display:flex;gap:12px;margin-top:8px';
  cols.appendChild(buildToolListCol('Allow tools (empty = all)', 'ag-allow', profile.allowTools || []));
  cols.appendChild(buildToolListCol('Deny tools', 'ag-deny', profile.denyTools || []));
  block.appendChild(cols);

  document.getElementById('ag-blocks').appendChild(block);
}
function readAgentsFromForm() {
  var ag = {};
  var blocks = document.querySelectorAll('#ag-blocks .ag-block');
  for (var i = 0; i < blocks.length; i++) {
    var name = blocks[i].querySelector('.ag-name').value.trim();
    if (!name) continue;
    var prof = {};
    var role = blocks[i].querySelector('.ag-role').value.trim();
    if (role) prof.role = role;
    var instr = blocks[i].querySelector('.ag-instructions').value.trim();
    if (instr) prof.instructions = instr;
    var allow = readToolRows(blocks[i].querySelector('.ag-allow'));
    if (allow.length > 0) prof.allowTools = allow;
    var deny = readToolRows(blocks[i].querySelector('.ag-deny'));
    if (deny.length > 0) prof.denyTools = deny;
    var iter = parseInt(blocks[i].querySelector('.ag-maxiter').value, 10);
    if (!isNaN(iter)) prof.maxIterations = iter;
    ag[name] = prof;
  }
  return ag;
}
var loadedNet = {};
function populateNet(net) {
  loadedNet = net || {};
  var n = loadedNet;
  document.getElementById('cfg-net-enabled').checked = !!n.enabled;
  document.getElementById('cfg-net-instanceName').value = n.instanceName || '';
  document.getElementById('cfg-net-role').value = n.role || '';
  document.getElementById('cfg-net-port').value = n.port != null ? n.port : '';
  document.getElementById('cfg-net-keyPath').value = n.keyPath || '';
  document.getElementById('cfg-net-hostname').value = n.hostname || '';
  document.getElementById('cfg-net-publicUrl').value = n.publicUrl || '';
  var share = n.share || {};
  document.getElementById('cfg-net-share-tools').checked = !!share.tools;
  document.getElementById('cfg-net-share-memory').checked = !!share.memory;
  document.getElementById('cfg-net-share-session').checked = !!share.session;
  document.getElementById('cfg-net-brainSource').value = n.brainSource || '';
  document.getElementById('cfg-net-discovery').value = n.discovery || '';
  document.getElementById('cfg-net-encrypt').checked = !!n.encrypt;
  document.getElementById('cfg-net-publishNames').checked = !!n.publishNames;
  document.getElementById('cfg-net-leader').value = n.leader || '';
  document.getElementById('cfg-net-heartbeatMode').value = n.heartbeatMode || '';
  document.getElementById('cfg-net-brainMode').value = n.brainMode || '';
  document.getElementById('cfg-net-taskOverflow').value = n.taskOverflow || '';
  document.getElementById('cfg-net-maxQueuedTasks').value = n.maxQueuedTasks != null ? n.maxQueuedTasks : '';
  var tls = n.tls || {};
  document.getElementById('cfg-net-tls-cert').value = tls.cert || '';
  document.getElementById('cfg-net-tls-key').value = tls.key || '';
  document.getElementById('cfg-net-maxConnections').value = n.maxConnections != null ? n.maxConnections : '';
  document.getElementById('cfg-net-authTimeoutMs').value = n.authTimeoutMs != null ? n.authTimeoutMs : '';
  document.getElementById('cfg-net-maxMessagesPerSecond').value = n.maxMessagesPerSecond != null ? n.maxMessagesPerSecond : '';
  var relay = n.relay || {};
  document.getElementById('cfg-net-relay-enabled').checked = !!relay.enabled;
  document.getElementById('cfg-net-relay-maxPerMinutePerPair').value = relay.maxPerMinutePerPair != null ? relay.maxPerMinutePerPair : '';
  document.getElementById('cfg-net-relay-maxBytes').value = relay.maxBytes != null ? relay.maxBytes : '';
  document.getElementById('cfg-net-relay-acceptFrom').value =
    relay.acceptFrom === '*' ? '*' : (Array.isArray(relay.acceptFrom) ? relay.acceptFrom.join(', ') : '');
  var pj = n.publicJoin || {};
  document.getElementById('cfg-net-pj-enabled').checked = !!pj.enabled;
  document.getElementById('cfg-net-pj-trustLevel').value = pj.trustLevel || '';
  document.getElementById('cfg-net-pj-allowBrain').checked = !!pj.allowBrain;
  document.getElementById('cfg-net-pj-maxPeers').value = pj.maxPeers != null ? pj.maxPeers : '';
  document.getElementById('cfg-net-pj-ratePerMinute').value = pj.ratePerMinute != null ? pj.ratePerMinute : '';
  document.getElementById('cfg-net-pj-requireApproval').checked = !!pj.requireApproval;
  var cr = n.chatRetention || {};
  document.getElementById('cfg-net-cr-maxMessages').value = cr.maxMessages != null ? cr.maxMessages : '';
  document.getElementById('cfg-net-cr-maxAgeDays').value = cr.maxAgeDays != null ? cr.maxAgeDays : '';
  var nf = n.files || {};
  document.getElementById('cfg-net-files-enabled').checked = nf.enabled !== false;
  document.getElementById('cfg-net-files-inboxDir').value = nf.inboxDir || '';
  document.getElementById('cfg-net-files-acceptFrom').value =
    nf.acceptFrom === '*' ? '*' : (Array.isArray(nf.acceptFrom) ? nf.acceptFrom.join(', ') : '');
  document.getElementById('cfg-net-files-maxBytes').value = nf.maxBytes != null ? nf.maxBytes : '';
  document.getElementById('cfg-net-files-relayQuotaBytes').value = nf.relayQuotaBytes != null ? nf.relayQuotaBytes : '';
  document.getElementById('cfg-net-files-relayTtlHours').value = nf.relayTtlHours != null ? nf.relayTtlHours : '';
  document.getElementById('net-peers').innerHTML = '';
  (n.peers || []).forEach(function(p) { addNetPeer(p); });
  document.getElementById('net-routing').innerHTML = '';
  var routing = n.routing || {};
  for (var k in routing) addNetRoute(k, routing[k]);
}
function addNetPeer(peer) {
  peer = peer || {};
  var block = document.createElement('div');
  block.className = 'net-peer';
  block.style.cssText = 'border:1px solid var(--border);border-radius:6px;padding:10px;margin-top:8px';
  var head = document.createElement('div');
  head.style.cssText = 'display:flex;gap:8px;align-items:center';
  head.innerHTML = '<input type="text" class="form-input np-url" style="flex:1" placeholder="wss://host:port" value="' + esc(String(peer.url || '')) + '">'
    + '<button class="agent-btn agent-btn-danger" type="button" title="Remove peer">&times;</button>';
  head.querySelector('button').addEventListener('click', function() { block.remove(); });
  block.appendChild(head);
  var trust = peer.trust || '';
  var opts = document.createElement('div');
  opts.style.cssText = 'display:flex;gap:14px;align-items:center;margin-top:8px';
  opts.innerHTML = '<label style="font-size:11px;color:var(--text-dim);display:flex;gap:6px;align-items:center">trust'
    + '<select class="form-select np-trust" style="width:auto">'
    + '<option value="">(default)</option>'
    + '<option value="full"' + (trust === 'full' ? ' selected' : '') + '>full</option>'
    + '<option value="tool"' + (trust === 'tool' ? ' selected' : '') + '>tool</option>'
    + '<option value="read"' + (trust === 'read' ? ' selected' : '') + '>read</option>'
    + '</select></label>'
    + '<label class="form-checkbox-label" style="display:flex;gap:6px;align-items:center"><input type="checkbox" class="form-checkbox np-allowbrain"' + (peer.allowBrain ? ' checked' : '') + '>allowBrain</label>';
  block.appendChild(opts);
  var cols = document.createElement('div');
  cols.style.cssText = 'display:flex;gap:12px;margin-top:8px';
  cols.appendChild(buildToolListCol('Allow tools (empty = all)', 'np-allow', peer.allowTools || []));
  cols.appendChild(buildToolListCol('Deny tools', 'np-deny', peer.denyTools || []));
  block.appendChild(cols);
  document.getElementById('net-peers').appendChild(block);
}
function addNetRoute(key, val) {
  var row = document.createElement('div');
  row.className = 'net-route';
  row.style.cssText = 'display:flex;gap:8px;margin-top:6px;align-items:center';
  row.innerHTML = '<input type="text" class="form-input nr-key" style="flex:1" placeholder="pattern" value="' + esc(String(key || '')) + '">'
    + '<span style="color:var(--text-dim)">&rarr;</span>'
    + '<input type="text" class="form-input nr-val" style="flex:1" placeholder="instanceName" value="' + esc(String(val || '')) + '">'
    + '<button class="agent-btn agent-btn-danger" type="button" title="Remove">&times;</button>';
  row.querySelector('button').addEventListener('click', function() { row.remove(); });
  document.getElementById('net-routing').appendChild(row);
}
function readNetFromForm() {
  var net = {};
  net.enabled = document.getElementById('cfg-net-enabled').checked;
  var instanceName = document.getElementById('cfg-net-instanceName').value.trim();
  if (instanceName) net.instanceName = instanceName;
  var role = document.getElementById('cfg-net-role').value;
  if (role) net.role = role;
  var port = parseInt(document.getElementById('cfg-net-port').value, 10);
  if (!isNaN(port)) net.port = port;
  var keyPath = document.getElementById('cfg-net-keyPath').value.trim();
  if (keyPath) net.keyPath = keyPath;
  var hostname = document.getElementById('cfg-net-hostname').value.trim();
  if (hostname) net.hostname = hostname;
  var publicUrl = document.getElementById('cfg-net-publicUrl').value.trim();
  if (publicUrl) net.publicUrl = publicUrl;

  var peers = [];
  var pblocks = document.querySelectorAll('#net-peers .net-peer');
  for (var i = 0; i < pblocks.length; i++) {
    var url = pblocks[i].querySelector('.np-url').value.trim();
    if (!url) continue;
    var peer = { url: url };
    var trust = pblocks[i].querySelector('.np-trust').value;
    if (trust) peer.trust = trust;
    if (pblocks[i].querySelector('.np-allowbrain').checked) peer.allowBrain = true;
    var pa = readToolRows(pblocks[i].querySelector('.np-allow'));
    if (pa.length > 0) peer.allowTools = pa;
    var pd = readToolRows(pblocks[i].querySelector('.np-deny'));
    if (pd.length > 0) peer.denyTools = pd;
    peers.push(peer);
  }
  if (peers.length > 0) net.peers = peers;

  var share = {};
  if (document.getElementById('cfg-net-share-tools').checked) share.tools = true;
  if (document.getElementById('cfg-net-share-memory').checked) share.memory = true;
  if (document.getElementById('cfg-net-share-session').checked) share.session = true;
  if (Object.keys(share).length > 0) net.share = share;

  var brainSource = document.getElementById('cfg-net-brainSource').value.trim();
  if (brainSource) net.brainSource = brainSource;
  var discovery = document.getElementById('cfg-net-discovery').value;
  if (discovery) net.discovery = discovery;
  if (document.getElementById('cfg-net-encrypt').checked) net.encrypt = true;
  if (document.getElementById('cfg-net-publishNames').checked) net.publishNames = true;
  var leader = document.getElementById('cfg-net-leader').value.trim();
  if (leader) net.leader = leader;
  var heartbeatMode = document.getElementById('cfg-net-heartbeatMode').value;
  if (heartbeatMode) net.heartbeatMode = heartbeatMode;
  var brainMode = document.getElementById('cfg-net-brainMode').value;
  if (brainMode) net.brainMode = brainMode;
  var taskOverflow = document.getElementById('cfg-net-taskOverflow').value;
  if (taskOverflow) net.taskOverflow = taskOverflow;
  var maxQueued = parseInt(document.getElementById('cfg-net-maxQueuedTasks').value, 10);
  if (!isNaN(maxQueued)) net.maxQueuedTasks = maxQueued;

  var tlsCert = document.getElementById('cfg-net-tls-cert').value.trim();
  var tlsKey = document.getElementById('cfg-net-tls-key').value.trim();
  if (tlsCert || tlsKey) net.tls = { cert: tlsCert, key: tlsKey };

  var maxConnections = parseInt(document.getElementById('cfg-net-maxConnections').value, 10);
  if (!isNaN(maxConnections)) net.maxConnections = maxConnections;
  var authTimeoutMs = parseInt(document.getElementById('cfg-net-authTimeoutMs').value, 10);
  if (!isNaN(authTimeoutMs)) net.authTimeoutMs = authTimeoutMs;
  var maxMps = parseInt(document.getElementById('cfg-net-maxMessagesPerSecond').value, 10);
  if (!isNaN(maxMps)) net.maxMessagesPerSecond = maxMps;

  var pj = {};
  if (document.getElementById('cfg-net-pj-enabled').checked) pj.enabled = true;
  var pjTrust = document.getElementById('cfg-net-pj-trustLevel').value;
  if (pjTrust) pj.trustLevel = pjTrust;
  if (document.getElementById('cfg-net-pj-allowBrain').checked) pj.allowBrain = true;
  var pjMaxPeers = parseInt(document.getElementById('cfg-net-pj-maxPeers').value, 10);
  if (!isNaN(pjMaxPeers)) pj.maxPeers = pjMaxPeers;
  var pjRate = parseInt(document.getElementById('cfg-net-pj-ratePerMinute').value, 10);
  if (!isNaN(pjRate)) pj.ratePerMinute = pjRate;
  if (document.getElementById('cfg-net-pj-requireApproval').checked) pj.requireApproval = true;
  if (Object.keys(pj).length > 0) net.publicJoin = pj;
  var relay = {};
  if (document.getElementById('cfg-net-relay-enabled').checked) relay.enabled = true;
  var rpm = document.getElementById('cfg-net-relay-maxPerMinutePerPair').value.trim();
  if (rpm) relay.maxPerMinutePerPair = parseInt(rpm, 10);
  var rmb = document.getElementById('cfg-net-relay-maxBytes').value.trim();
  if (rmb) relay.maxBytes = parseInt(rmb, 10);
  var raf = document.getElementById('cfg-net-relay-acceptFrom').value.trim();
  if (raf === '*') relay.acceptFrom = '*';
  else if (raf) relay.acceptFrom = raf.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
  if (Object.keys(relay).length > 0) net.relay = relay;

  var cr = {};
  var crMax = parseInt(document.getElementById('cfg-net-cr-maxMessages').value, 10);
  if (!isNaN(crMax)) cr.maxMessages = crMax;
  var crAge = parseInt(document.getElementById('cfg-net-cr-maxAgeDays').value, 10);
  if (!isNaN(crAge)) cr.maxAgeDays = crAge;
  if (Object.keys(cr).length > 0) net.chatRetention = cr;

  var nf = {};
  if (!document.getElementById('cfg-net-files-enabled').checked) nf.enabled = false;
  var nfInbox = document.getElementById('cfg-net-files-inboxDir').value.trim();
  if (nfInbox) nf.inboxDir = nfInbox;
  var nfAccept = document.getElementById('cfg-net-files-acceptFrom').value.trim();
  if (nfAccept === '*') nf.acceptFrom = '*';
  else if (nfAccept) nf.acceptFrom = nfAccept.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
  var nfMax = parseInt(document.getElementById('cfg-net-files-maxBytes').value, 10);
  if (!isNaN(nfMax)) nf.maxBytes = nfMax;
  var nfQuota = parseInt(document.getElementById('cfg-net-files-relayQuotaBytes').value, 10);
  if (!isNaN(nfQuota)) nf.relayQuotaBytes = nfQuota;
  var nfTtl = parseInt(document.getElementById('cfg-net-files-relayTtlHours').value, 10);
  if (!isNaN(nfTtl)) nf.relayTtlHours = nfTtl;
  if (Object.keys(nf).length > 0) net.files = nf;

  var routing = {};
  var rrows = document.querySelectorAll('#net-routing .net-route');
  for (var r = 0; r < rrows.length; r++) {
    var rk = rrows[r].querySelector('.nr-key').value.trim();
    var rv = rrows[r].querySelector('.nr-val').value.trim();
    if (rk) routing[rk] = rv;
  }
  if (Object.keys(routing).length > 0) net.routing = routing;

  // Carry nested share keys the form does not model (the checkboxes rebuild share from
  // scratch, which silently dropped share.toolAllow on every save).
  if (loadedNet.share && loadedNet.share.toolAllow) {
    net.share = net.share || {};
    net.share.toolAllow = loadedNet.share.toolAllow;
  }

  // Forward-compat: preserve any keys we don't manage so saving never drops them.
  // encrypt/publishNames/files ARE managed by the form — leaving them out of this map let
  // the preserve loop overwrite the checkboxes with stale on-disk values (both toggles
  // were silently non-functional from the dashboard).
  var managed = { enabled: 1, instanceName: 1, role: 1, port: 1, hostname: 1, publicUrl: 1, keyPath: 1, peers: 1, share: 1, brainSource: 1, discovery: 1, leader: 1, heartbeatMode: 1, brainMode: 1, taskOverflow: 1, maxQueuedTasks: 1, tls: 1, routing: 1, maxConnections: 1, authTimeoutMs: 1, maxMessagesPerSecond: 1, publicJoin: 1, relay: 1, chatRetention: 1, encrypt: 1, publishNames: 1, files: 1 };
  for (var mk in loadedNet) if (!managed[mk]) net[mk] = loadedNet[mk];
  return net;
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

  // Paws: the card form keeps the raw JSON textarea in sync; in raw mode the user edits it directly.
  if (!pawsRawMode) syncPawsFormToRaw();
  try {
    cfg.paws = JSON.parse(document.getElementById('cfg-paws').value);
  } catch (e) {
    throw new Error('Invalid JSON in Paws');
  }

  var tp = readToolProfilesFromForm();
  if (Object.keys(tp).length > 0) cfg.toolProfiles = tp;

  var ag = readAgentsFromForm();
  if (Object.keys(ag).length > 0) cfg.agents = ag;

  var net = readNetFromForm();
  if (net.enabled || Object.keys(net).length > 1) cfg.net = net;

  // Preserve any top-level config keys the form does not model (skills, demo, schedules, …).
  // write_config replaces the whole file, so without this a Save would silently drop them —
  // this is what deregistered installed skills (they stayed on disk but vanished from config.skills).
  if (cachedConfig && typeof cachedConfig === 'object') {
    var managed = { brain: 1, loop: 1, heartbeat: 1, security: 1, paws: 1, toolProfiles: 1, agents: 1, net: 1 };
    for (var k in cachedConfig) {
      if (cachedConfig.hasOwnProperty(k) && !managed[k] && !(k in cfg)) cfg[k] = cachedConfig[k];
    }
  }

  return cfg;
}

function saveConfig() {
  if (IS_DEMO) { showToast('Demo mode — configuration is read-only.', 'error'); return; }
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
  var epoch = viewEpoch;
  sendCommand('read_identity').then(function(data) {
    if (viewChanged(epoch)) return; // never show one agent's SOUL/AGENT.md under another's name
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
    applyDemoLock(IS_DEMO);
    showToast('Identity files loaded', 'success');
  }).catch(function(err) {
    if (viewChanged(epoch)) return;
    showToast('Failed to load identity files: ' + err.message, 'error');
  });
}

function saveIdentity() {
  if (IS_DEMO) { showToast('Demo mode — identity files are read-only.', 'error'); return; }
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
  loadEventDays();
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

  if (msg.type === 'agents') {
    renderAgents(msg.data || []);
    // First list after a load is the moment to put the page back where it was. It has to wait for
    // the list: an agent that has since been deleted must fall back to the launcher, not open a
    // view of something that is gone.
    if (!viewRestored) {
      viewRestored = true;
      restoreView(msg.data || []);
    }
    return;
  }

  if (msg.type === 'state') {
    // In control-plane mode, ignore state for agents other than the selected one.
    if (msg.agentId && msg.agentId !== currentAgentId) return;
    renderState(msg.data || {});
  } else if (msg.type === 'event') {
    if (msg.event && msg.event.indexOf('task:') === 0) {
      chatOnTaskEvent(msg.event, msg.data, msg.agentId);
    }
    if (msg.event === 'volenet:chat') {
      volenetOnMessage(msg.data, msg.agentId);
    }
    if (msg.event === 'volenet:relay:request' || msg.event === 'volenet:relay:accepted'
        || msg.event === 'volenet:relay:denied') {
      volenetOnRelayEvent(msg.event, msg.data, msg.agentId);
    }
    if (msg.event && msg.event.indexOf('volenet:file:') === 0) {
      volenetOnFileEvent(msg.event, msg.data, msg.agentId);
      // Progress events would flood the Live Events feed — surface the rest only.
      if (msg.event === 'volenet:file:progress') return;
    }
    if (msg.event === 'volenet:pair:request') {
      if (!currentAgentId || msg.agentId === undefined || msg.agentId === currentAgentId) {
        showToast('🤝 Pair request from ' + ((msg.data && msg.data.fromName) || 'a node') + ' — open VoleNet to accept', 'success');
        if (currentTab === 'volenet') refreshVnPeers();
      }
    }
    if (msg.event === 'channel:message') {
      chatOnChannelMessage(msg.data, msg.agentId);
    }
    if (!currentAgentId || msg.agentId === undefined || msg.agentId === currentAgentId) {
      addEvent(msg.event, msg.data, msg.agentId);
    }
  }
};

function categoryTag(cat) {
  var colors = { brain: 'tag-purple', channel: 'tag-green', tool: 'tag-blue', infrastructure: 'tag-yellow' };
  return '<span class="tag ' + (colors[cat] || 'tag-blue') + '">' + esc(cat || 'tool') + '</span>';
}

// ── Overview summary cards (detail lives in the drawer) ──
function renderPaws(paws) {
  var el = document.getElementById('sum-paws');
  if (!el) return;
  var healthy = paws.filter(function(p) { return p.healthy; }).length;
  var down = paws.length - healthy;
  var cats = {};
  paws.forEach(function(p) { var c = p.category || 'tool'; cats[c] = (cats[c] || 0) + 1; });
  var chips = ['brain', 'channel', 'tool', 'infrastructure'].filter(function(c) { return cats[c]; })
    .map(function(c) { return '<span class="sc-chip"><b>' + cats[c] + '</b> ' + c + '</span>'; }).join('');
  el.innerHTML = '<div class="sumcard-metric">' + paws.length + '</div>'
    + '<div class="sumcard-sub">' + (paws.length
        ? (down ? '<span style="color:var(--red)">' + down + ' down</span> \\u00b7 ' + healthy + ' healthy' : 'all healthy')
        : 'none loaded') + '</div>'
    + (chips ? '<div style="margin-top:6px">' + chips + '</div>' : '');
}

function renderTools(tools) {
  var el = document.getElementById('sum-tools');
  if (!el) return;
  var bySrc = {};
  tools.forEach(function(t) { var s = (t.pawName || 'core').replace('@openvole/paw-', ''); bySrc[s] = (bySrc[s] || 0) + 1; });
  var srcs = Object.keys(bySrc).sort(function(a, b) { return bySrc[b] - bySrc[a]; });
  var chips = srcs.slice(0, 5).map(function(s) { return '<span class="sc-chip"><b>' + bySrc[s] + '</b> ' + esc(s) + '</span>'; }).join('');
  var more = srcs.length > 5 ? '<span class="sc-chip">+' + (srcs.length - 5) + ' more</span>' : '';
  el.innerHTML = '<div class="sumcard-metric">' + tools.length + '</div>'
    + '<div class="sumcard-sub">' + srcs.length + ' source' + (srcs.length === 1 ? '' : 's') + '</div>'
    + (chips ? '<div style="margin-top:6px">' + chips + more + '</div>' : '');
}

function renderSkills(skills) {
  var el = document.getElementById('sum-skills');
  if (!el) return;
  var active = skills.filter(function(s) { return s.active; });
  // Show names for ALL loaded skills (active first, inactive muted) so an installed-but-inactive skill
  // — e.g. one still waiting on a required tool — stays visible on the card, not hidden in the drawer.
  var ordered = active.concat(skills.filter(function(s) { return !s.active; }));
  var names = ordered.slice(0, 4).map(function(s) { return '<span class="sc-chip' + (s.active ? '' : ' sc-chip-off') + '" title="' + esc(s.name) + (s.active ? '' : ' \\u2014 inactive') + '">' + esc(s.name) + '</span>'; }).join('');
  var more = ordered.length > 4 ? '<span class="sc-chip">+' + (ordered.length - 4) + '</span>' : '';
  el.innerHTML = '<div class="sumcard-metric">' + active.length + '<small>/' + skills.length + ' active</small></div>'
    + (skills.length ? '<div style="margin-top:6px">' + names + more + '</div>'
        : '<div class="sumcard-sub">none loaded</div>');
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
    ? '<tr><td colspan="7" class="empty">No tasks</td></tr>'
    : sorted.map(function(t) {
      var elapsed = formatElapsed(t);
      var sTag = sourceClass(t.source);
      return '<tr>'
        + '<td>' + esc(t.id ? t.id.substring(0, 8) : '') + '</td>'
        + '<td><span class="tag ' + sTag + '">' + esc(t.source) + '</span></td>'
        + '<td title="' + esc(t.input || '') + '">' + esc((t.input || '').substring(0, 50)) + '</td>'
        + '<td><span class="tag ' + statusClass(t.status) + '">' + esc(t.status) + '</span></td>'
        + '<td class="task-when" title="' + esc(whenTitle(t)) + '">' + formatWhen(t) + '</td>'
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

// Same-day stamps keep seconds; older ones trade them for a date. Shared by the overview's task
// table and the project board's task lifecycle, so one timestamp never reads two ways.
function fmtStamp(at) {
  if (!at) return '\\u2014';
  var d = new Date(at);
  var time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  if (d.toDateString() === new Date().toDateString()) return time;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + time.slice(0, 5);
}

// When the task actually ran. Start time is the interesting stamp — a queued task has none
// yet, so fall back to when it was enqueued.
function formatWhen(t) {
  return fmtStamp(t.startedAt || t.createdAt);
}

function whenTitle(t) {
  var parts = [];
  if (t.createdAt) parts.push('queued ' + new Date(t.createdAt).toLocaleString());
  if (t.startedAt) parts.push('started ' + new Date(t.startedAt).toLocaleString());
  if (t.completedAt) parts.push('finished ' + new Date(t.completedAt).toLocaleString());
  return parts.join('\\n');
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
  var el = document.getElementById('sum-schedules');
  if (!el) return;
  var next = schedules.filter(function(s) { return s.nextRun; }).sort(function(a, b) { return a.nextRun - b.nextRun; })[0];
  el.innerHTML = '<div class="sumcard-metric">' + schedules.length + '</div>'
    + '<div class="sumcard-sub">' + (schedules.length ? 'next: ' + esc(next ? new Date(next.nextRun).toLocaleString() : '\\u2014') : 'none active') + '</div>';
}

function renderVoleNet(data) {
  var card = document.getElementById('sum-volenet-card');
  if (!card) return;
  if (!data || !data.enabled) { card.style.display = 'none'; return; }
  card.style.display = '';
  var el = document.getElementById('sum-volenet');
  var peers = data.peers || [];
  var online = peers.filter(function(p) { return p.lastSeen && (Date.now() - p.lastSeen) < 30000; }).length;
  el.innerHTML = '<div class="sumcard-metric">' + peers.length + '<small> peer' + (peers.length === 1 ? '' : 's') + '</small></div>'
    + '<div class="sumcard-sub">' + online + ' online \\u00b7 ' + (data.remoteTools || 0) + ' remote tool' + ((data.remoteTools || 0) === 1 ? '' : 's')
      + (data.isLeader ? ' \\u00b7 <span style="color:var(--green)">leader</span>' : '') + '</div>';
}

// ── Detail drawer (full lists for the compact overview cards) ──
var DRAWER_TITLES = { paws: 'Paws', tools: 'Tools', skills: 'Skills', schedules: 'Schedules' };
function openDetail(section) {
  drawerSection = section;
  document.getElementById('drawer-title').textContent = DRAWER_TITLES[section] || 'Detail';
  renderDrawerBody();
  document.getElementById('detail-drawer').classList.add('open');
  document.getElementById('drawer-scrim').classList.add('open');
}
function closeDetail() {
  drawerSection = null;
  document.getElementById('detail-drawer').classList.remove('open');
  document.getElementById('drawer-scrim').classList.remove('open');
}
function renderDrawerBody() {
  var body = document.getElementById('drawer-body');
  if (!body || !drawerSection) return;
  if (drawerSection === 'paws') body.innerHTML = detailPaws(lastStatePaws);
  else if (drawerSection === 'tools') body.innerHTML = detailTools(lastStateTools);
  else if (drawerSection === 'skills') body.innerHTML = detailSkills(lastStateSkills);
  else if (drawerSection === 'schedules') body.innerHTML = detailSchedules(lastStateSchedules);
  else if (drawerSection.indexOf('peer:') === 0) {
    document.getElementById('drawer-title').textContent = 'Peer';
    body.innerHTML = detailPeer(drawerSection.substring(5));
  }
}
function detailPaws(paws) {
  if (!paws.length) return '<div class="vn-empty">No paws loaded.</div>';
  var order = ['brain', 'channel', 'tool', 'infrastructure'];
  var grouped = {}; order.forEach(function(o) { grouped[o] = []; });
  paws.forEach(function(p) { var c = p.category || 'tool'; (grouped[c] = grouped[c] || []).push(p); });
  var rows = '';
  order.forEach(function(cat) {
    var items = grouped[cat]; if (!items || !items.length) return;
    rows += '<tr class="group-header"><td colspan="4"><strong>' + cat.charAt(0).toUpperCase() + cat.slice(1) + '</strong> (' + items.length + ')</td></tr>';
    items.forEach(function(p) {
      rows += '<tr><td title="' + esc(p.name) + '">' + esc(p.name.replace('@openvole/', '')) + '</td>'
        + '<td>' + categoryTag(cat) + '</td><td>' + (p.toolCount != null ? p.toolCount : 0) + '</td>'
        + '<td>' + (p.healthy ? '<span class="tag tag-green">ok</span>' : '<span class="tag tag-red">down</span>') + '</td></tr>';
    });
  });
  return '<table><thead><tr><th>Name</th><th>Category</th><th>Tools</th><th>Health</th></tr></thead><tbody>' + rows + '</tbody></table>';
}
function detailTools(tools) {
  if (!tools.length) return '<div class="vn-empty">No tools registered.</div>';
  return '<table><thead><tr><th>Name</th><th>Paw</th><th>Type</th></tr></thead><tbody>'
    + tools.map(function(t) { return '<tr><td title="' + esc(t.name) + '">' + esc(t.name) + '</td><td title="' + esc(t.pawName) + '">' + esc(t.pawName) + '</td><td><span class="tag tag-blue">' + (t.inProcess ? 'in-process' : 'subprocess') + '</span></td></tr>'; }).join('')
    + '</tbody></table>';
}
function detailSkills(skills) {
  if (!skills.length) return '<div class="vn-empty">No skills loaded.</div>';
  return '<table><thead><tr><th>Name</th><th>Status</th><th>Missing</th></tr></thead><tbody>'
    + skills.map(function(s) { return '<tr><td title="' + esc(s.name) + '">' + esc(s.name) + '</td><td>' + (s.active ? '<span class="tag tag-green">active</span>' : '<span class="tag tag-red">inactive</span>') + '</td><td>' + (s.missingTools && s.missingTools.length ? esc(s.missingTools.join(', ')) : '\\u2014') + '</td></tr>'; }).join('')
    + '</tbody></table>';
}
function detailSchedules(schedules) {
  if (!schedules.length) return '<div class="vn-empty">No active schedules.</div>';
  return '<table><thead><tr><th>ID</th><th>Input</th><th>Cron</th><th>Next Run</th></tr></thead><tbody>'
    + schedules.map(function(s) { var nr = s.nextRun ? new Date(s.nextRun).toLocaleString() : '\\u2014'; return '<tr><td>' + esc(s.id) + '</td><td title="' + esc(s.input) + '">' + esc((s.input || '').substring(0, 60)) + '</td><td><span class="tag tag-yellow">' + esc(s.cron) + '</span></td><td>' + nr + '</td></tr>'; }).join('')
    + '</tbody></table>';
}
function detailPeer(pid) {
  // Merge the two peer views: the overview state (direct peers, rich: role/capabilities/endpoint)
  // and the VoleNet tab roster (adds relay members + connection kind), so the drawer works from either.
  var direct = ((lastStateVolenet && lastStateVolenet.peers) || []).filter(function(x) { return x.id === pid; })[0];
  var vn = (typeof vnPeers !== 'undefined' ? vnPeers : []).filter(function(x) { return x.id === pid; })[0];
  var p = direct || vn;
  if (!p) return '<div class="vn-empty">Peer not found (may have disconnected).</div>';
  var role = (direct && direct.role) || (vn && vn.role) || 'peer';
  var kind = vn && vn.kind === 'relay' ? 'via relay \\u2014 ' + esc(vn.viaHubName || 'hub') : 'direct mesh';
  var lastSeen = (direct && direct.lastSeen) || (vn && vn.lastSeen);
  var ago = lastSeen ? Math.round((Date.now() - lastSeen) / 1000) + 's ago' : '\\u2014';
  var rows = '<dt>Name</dt><dd>' + esc(p.name || '') + '</dd>'
    + '<dt>ID</dt><dd><span class="tag tag-purple">' + esc(p.id || '') + '</span></dd>'
    + '<dt>Connection</dt><dd>' + kind + '</dd>'
    + '<dt>Role</dt><dd>' + esc(role) + '</dd>';
  if (direct) {
    rows += '<dt>Capabilities</dt><dd>' + (direct.capabilities || 0) + '</dd>'
      + '<dt>Remote tools</dt><dd>' + (direct.toolCount != null ? direct.toolCount : '\\u2014') + '</dd>'
      + '<dt>Endpoint</dt><dd>' + esc(direct.endpoint || '\\u2014') + '</dd>';
  }
  if (vn && vn.kind === 'relay') rows += '<dt>Accepted</dt><dd>' + (vn.accepted ? 'yes' : (vn.awaiting ? 'awaiting' : 'no')) + '</dd>';
  rows += '<dt>Last seen</dt><dd>' + ago + '</dd>';
  return '<dl class="kv">' + rows + '</dl>';
}

document.addEventListener('keydown', function(e) { if (e.key === 'Escape' && drawerSection) closeDetail(); });

function statusClass(s) {
  if (s === 'completed') return 'tag-green';
  if (s === 'running') return 'tag-blue';
  if (s === 'failed' || s === 'cancelled') return 'tag-red';
  return 'tag-yellow';
}

// 'live' or a YYYY-MM-DD day being read back from the saved log.
var eventsMode = 'live';

function eventsClear() {
  eventLog.innerHTML = '';
  var note = document.getElementById('events-note');
  if (note && eventsMode === 'live') note.textContent = 'Live \u2014 cleared. New events appear here; today\u2019s log on disk is untouched.';
}

/**
 * One event row. The collapsed row is a preview; the full payload is kept on the element and
 * swapped in on click, so nothing an event carried is ever unreachable from the UI.
 */
function eventLineEl(name, data, stamp, agentId) {
  var el = document.createElement('div');
  el.className = 'event-line';
  if (name === 'rate:limited') el.className += ' rate-limited';
  if (name === 'task:failed') el.className += ' task-failed';
  var full;
  if (data === null || data === undefined) full = '';
  else if (typeof data === 'object') { try { full = JSON.stringify(data, null, 2); } catch (e) { full = String(data); } }
  else full = String(data);
  var oneLine = full.replace(/\\s+/g, ' ').trim();
  el.innerHTML = '<span class="time">' + esc(stamp) + '</span>'
    + '<span class="name">' + esc(name) + '</span>'
    + '<span class="data"></span>';
  var dataEl = el.querySelector('.data');
  dataEl.textContent = oneLine;
  dataEl.title = agentId ? (agentId + ' \\u2014 click to expand') : 'Click to expand';
  dataEl.onclick = function() {
    var open = el.classList.toggle('expanded');
    dataEl.textContent = open ? full : oneLine;
  };
  return el;
}

function addEvent(name, data, agentId) {
  // Reading history: don't interleave live lines into a day being reviewed.
  if (eventsMode !== 'live') return;
  eventLog.prepend(eventLineEl(name, data, new Date().toLocaleTimeString(), agentId));
  while (eventLog.children.length > MAX_EVENTS) eventLog.lastChild.remove();
}

/** The server's current day — the file live events are being appended to right now. */
var eventsTodayKey = null;
/** How much of today to show when the feed opens. */
var EVENTS_LIVE_TAIL = 300;

/**
 * Fill the day dropdown, then load today's tail into the live feed.
 *
 * "Live" used to start blank and only fill as new events happened — so opening the dashboard on
 * a quiet agent showed nothing, while today's events sat in the dropdown one click away, listed
 * as if the day were already over. Today is not a past day: it is the file being written to.
 * So Live now tails today and follows it, and only *earlier* days appear as history.
 */
function loadEventDays() {
  var sel = document.getElementById('events-day');
  if (!sel) return;
  sendCommand('event_log_days', {}).then(function(res) {
    var days = (res && res.days) || [];
    eventsTodayKey = (res && res.today) || days[0] || null;
    var keep = sel.value || 'live';
    var opts = ['<option value="live">Live (today)</option>'];
    for (var i = 0; i < days.length; i++) {
      if (days[i] === eventsTodayKey) continue; // that IS live
      opts.push('<option value="' + esc(days[i]) + '">' + esc(days[i]) + '</option>');
    }
    sel.innerHTML = opts.join('');
    sel.value = keep;
    if (sel.value !== keep) { sel.value = 'live'; eventsMode = 'live'; }
    if (eventsMode === 'live') eventsLoadLive();
  }).catch(function() {});
}

/**
 * Show today's recent events, newest first, then let live ones prepend on top.
 *
 * Filtered to the selected agent, because that is what the live feed accepts — mixing another
 * agent's history into this agent's feed would read as its own activity.
 */
function eventsLoadLive() {
  var note = document.getElementById('events-note');
  var raw = document.getElementById('events-raw');
  if (eventsTodayKey && raw) {
    var token = new URLSearchParams(location.search).get('token') || '';
    raw.className = 'events-raw';
    raw.href = '/events.jsonl?day=' + encodeURIComponent(eventsTodayKey)
      + (token ? '&token=' + encodeURIComponent(token) : '');
  }
  if (!eventsTodayKey) { if (note) note.textContent = ''; return; }

  var epoch = viewEpoch;
  var agent = currentAgentId;
  if (note) note.textContent = 'Live \u2014 loading today\u2026';
  sendCommand('event_log_read', { day: eventsTodayKey, tail: EVENTS_LIVE_TAIL }).then(function(res) {
    // Agent switched, or you moved to a saved day while this was in flight.
    if (viewChanged(epoch) || eventsMode !== 'live') return;
    var entries = ((res && res.entries) || []).filter(function(e) {
      return !agent || !e.agentId || e.agentId === agent;
    });
    var frag = document.createDocumentFragment();
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      var stamp = (e.time || '').split(' ')[1] || (e.time || '');
      frag.appendChild(eventLineEl(e.event || '?', e.data, stamp, e.agentId));
    }
    // Appended below whatever arrived live while this was loading — those are newer.
    eventLog.appendChild(frag);
    while (eventLog.children.length > MAX_EVENTS) eventLog.lastChild.remove();
    if (note) {
      note.textContent = entries.length
        ? 'Live \u2014 following today, showing the last ' + entries.length + ' for this agent.'
        : 'Live \u2014 nothing logged for this agent today yet.';
    }
  }).catch(function() {
    if (note) note.textContent = '';
  });
}

function eventsDayChange() {
  var sel = document.getElementById('events-day');
  var note = document.getElementById('events-note');
  var raw = document.getElementById('events-raw');
  var day = (sel && sel.value) || 'live';
  eventsMode = day;
  eventLog.innerHTML = '';

  if (day === 'live') {
    eventsLoadLive();
    return;
  }

  var token = new URLSearchParams(location.search).get('token') || '';
  raw.className = 'events-raw';
  raw.href = '/events.jsonl?day=' + encodeURIComponent(day) + (token ? '&token=' + encodeURIComponent(token) : '');

  note.textContent = 'Loading ' + day + '\\u2026';
  sendCommand('event_log_read', { day: day, tail: 2000 }).then(function(res) {
    if (!res || res.ok === false) { note.textContent = (res && res.error) || 'Could not read the log.'; return; }
    var entries = res.entries || [];
    var frag = document.createDocumentFragment();
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      var stamp = (e.time || '').split(' ')[1] || (e.time || '');
      frag.appendChild(eventLineEl(e.event || '?', e.data, stamp, e.agentId));
    }
    eventLog.appendChild(frag);
    // Say what was left out rather than implying this is the whole day.
    note.textContent = day + ' \\u2014 ' + res.total + ' event' + (res.total === 1 ? '' : 's')
      + (res.dropped > 0 ? ', showing the newest ' + entries.length + ' (' + res.dropped + ' older not shown \\u2014 open raw for all)' : '')
      + '. Newest first.';
  }).catch(function(err) {
    note.textContent = 'Could not read the log: ' + (err && err.message ? err.message : 'error');
  });
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
