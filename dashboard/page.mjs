const PAGE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Agent pipeline — live</title>
  <style>
    :root {
      color-scheme: light dark;
      --paper: #f4f2ed;
      --panel: #fffdf8;
      --ink: #1c201d;
      --muted: #646b65;
      --line: #d8d4ca;
      --accent: #146c5a;
      --accent-soft: #dcece7;
      --alarm: #a33c35;
      --warning: #9a650d;
      --shadow: 0 16px 40px rgb(28 32 29 / 8%);
      font-family: Inter, ui-sans-serif, system-ui, sans-serif;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --paper: #141816;
        --panel: #1c211e;
        --ink: #edf1ed;
        --muted: #aab2ac;
        --line: #343b36;
        --accent: #74d4bc;
        --accent-soft: #203b34;
        --alarm: #ff9b92;
        --warning: #f2bd62;
        --shadow: 0 16px 40px rgb(0 0 0 / 24%);
      }
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--paper); color: var(--ink); }
    main { width: min(1280px, calc(100% - 32px)); margin: 0 auto; padding: 40px 0 80px; }
    header { display: flex; justify-content: space-between; align-items: end; gap: 24px; margin-bottom: 28px; }
    h1 { margin: 0; font: 650 clamp(2rem, 5vw, 4rem)/.95 Georgia, serif; letter-spacing: -.04em; }
    h2 { margin: 0; font-size: 1.05rem; }
    .lede { max-width: 42rem; margin: 12px 0 0; color: var(--muted); line-height: 1.55; }
    .connection { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: .85rem; }
    .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--alarm); }
    .dot.online { background: var(--accent); box-shadow: 0 0 0 5px var(--accent-soft); }
    .panel { padding: 16px; background: var(--panel); border: 1px solid var(--line); border-radius: 14px; box-shadow: var(--shadow); }
    .panel-head { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; margin-bottom: 14px; }
    .panel-head p { margin: 0; color: var(--muted); font-size: .84rem; }
    .issue-toolbar { display: grid; grid-template-columns: minmax(200px, 1fr) 190px; gap: 10px; }
    label { display: grid; gap: 7px; color: var(--muted); font-size: .78rem; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
    input, select, button { min-height: 44px; border: 1px solid var(--line); border-radius: 9px; font: inherit; }
    input, select { width: 100%; padding: 0 12px; background: var(--paper); color: var(--ink); }
    button { padding: 0 18px; background: var(--accent); border-color: var(--accent); color: var(--paper); cursor: pointer; font-weight: 750; }
    button:disabled { cursor: not-allowed; opacity: .55; }
    #issues { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr)); gap: 10px; max-height: 390px; overflow: auto; margin-top: 14px; padding: 2px; }
    .issue-option { min-width: 0; padding: 13px; background: var(--paper); border-color: var(--line); color: var(--ink); text-align: left; font-weight: 400; }
    .issue-option:hover, .issue-option.selected { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }
    .issue-title { display: block; margin-top: 6px; overflow: hidden; font-weight: 750; text-overflow: ellipsis; white-space: nowrap; }
    .issue-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .issue-id { color: var(--muted); font: .78rem ui-monospace, monospace; }
    .issue-meta, .issue-reason { display: block; margin-top: 7px; color: var(--muted); font-size: .76rem; line-height: 1.35; }
    .issue-reason.blocked { color: var(--warning); }
    .badge { flex: none; padding: 4px 7px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); font-size: .66rem; font-weight: 800; text-transform: uppercase; }
    .badge.blocked { background: transparent; color: var(--warning); border: 1px solid currentColor; }
    .empty-issues { grid-column: 1 / -1; margin: 0; padding: 28px 16px; color: var(--muted); text-align: center; }
    form { display: grid; grid-template-columns: minmax(220px, 1fr) 190px auto; gap: 10px; margin-top: 14px; padding: 16px; background: var(--panel); border: 1px solid var(--line); border-radius: 14px; box-shadow: var(--shadow); }
    .selection { min-width: 0; align-self: center; }
    .selection strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .selection span { display: block; margin-top: 5px; color: var(--muted); font-size: .78rem; }
    form button { align-self: end; }
    #notice { min-height: 24px; margin: 10px 2px; color: var(--muted); font-size: .88rem; }
    .summary { display: flex; gap: 24px; margin: 24px 0 16px; color: var(--muted); font-size: .9rem; }
    .summary strong { color: var(--ink); font-size: 1.2rem; }
    #runs { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 330px), 1fr)); gap: 16px; }
    .run { min-width: 0; padding: 18px; background: var(--panel); border: 1px solid var(--line); border-radius: 14px; box-shadow: var(--shadow); }
    .run-head { display: flex; justify-content: space-between; align-items: start; gap: 16px; }
    .run h2 { overflow-wrap: anywhere; }
    .meta { margin: 6px 0 0; color: var(--muted); font: .8rem ui-monospace, monospace; }
    .status { padding: 5px 8px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); font-size: .72rem; font-weight: 800; text-transform: uppercase; }
    .status.failed, .status.interrupted { color: var(--alarm); }
    .facts { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 18px 0; }
    .fact { padding: 10px; background: var(--paper); border-radius: 8px; }
    .fact span { display: block; color: var(--muted); font-size: .72rem; text-transform: uppercase; }
    .fact strong { display: block; margin-top: 4px; font-size: .95rem; }
    pre { min-height: 110px; max-height: 260px; overflow: auto; margin: 0; padding: 12px; background: #101512; color: #d8e7dc; border-radius: 9px; white-space: pre-wrap; overflow-wrap: anywhere; font: .76rem/1.5 ui-monospace, monospace; }
    .actions { display: flex; justify-content: end; gap: 8px; margin-top: 12px; }
    .actions input { flex: 1; min-width: 0; min-height: 34px; }
    button.secondary { min-height: 34px; padding: 0 12px; background: transparent; color: var(--alarm); border-color: currentColor; }
    .empty { grid-column: 1 / -1; padding: 48px 24px; border: 1px dashed var(--line); border-radius: 14px; color: var(--muted); text-align: center; }
    @media (max-width: 720px) {
      header { align-items: start; flex-direction: column; }
      .issue-toolbar, form { grid-template-columns: 1fr; }
      form button { width: 100%; }
    }
  </style>
</head>
<body>
<main>
  <header>
    <div>
      <h1>Agent pipeline</h1>
      <p class="lede">Choose a Sudocode issue, then follow the agent heartbeat and output live. Pipeline control stays separate and local.</p>
    </div>
    <div class="connection"><span id="dot" class="dot"></span><span id="connection">Connecting</span></div>
  </header>

  <section class="panel" aria-labelledby="issues-title">
    <div class="panel-head">
      <h2 id="issues-title">Project issues</h2>
      <p><span id="issue-count">0</span> shown</p>
    </div>
    <div class="issue-toolbar">
      <label>Search issues
        <input id="issue-search" type="search" placeholder="ID, title, spec or phase">
      </label>
      <label>Filter
        <select id="issue-filter">
          <option value="actionable">Ready to dispatch</option>
          <option value="active">In progress</option>
          <option value="blocked">Blocked or waiting</option>
          <option value="closed">Closed</option>
          <option value="all">All issues</option>
        </select>
      </label>
    </div>
    <div id="issues" aria-live="polite"><p class="empty-issues">Loading issues…</p></div>
  </section>

  <form id="dispatch">
    <input type="hidden" name="issue_id">
    <div class="selection">
      <strong id="selected-title">Select an issue above</strong>
      <span id="selected-meta">The expected role will be chosen from its phase.</span>
      <span id="selected-scope"></span>
    </div>
    <label>Expected role
      <input name="role" readonly aria-readonly="true" value="—">
    </label>
    <button type="submit" disabled>Dispatch agent</button>
  </form>
  <p id="notice" aria-live="polite"></p>

  <div class="summary">
    <span><strong id="active">0</strong> active</span>
    <span><strong id="total">0</strong> runs</span>
  </div>
  <section id="runs" aria-live="polite"><p class="empty">No agent has been dispatched from this dashboard.</p></section>
</main>
<script>
  const token = __DASHBOARD_TOKEN__;
  const runs = document.querySelector("#runs");
  const issues = document.querySelector("#issues");
  const notice = document.querySelector("#notice");
  const form = document.querySelector("#dispatch");
  const dispatchButton = form.querySelector('button[type="submit"]');
  const issueId = form.elements.issue_id;
  const role = form.elements.role;
  const selectedTitle = document.querySelector("#selected-title");
  const selectedMeta = document.querySelector("#selected-meta");
  const selectedScope = document.querySelector("#selected-scope");
  const search = document.querySelector("#issue-search");
  const filter = document.querySelector("#issue-filter");
  const issueCount = document.querySelector("#issue-count");
  const active = document.querySelector("#active");
  const total = document.querySelector("#total");
  const dot = document.querySelector("#dot");
  const connection = document.querySelector("#connection");
  let catalog = [];
  let selectedId = null;

  function fact(label, value) {
    const item = document.createElement("div");
    item.className = "fact";
    const name = document.createElement("span");
    name.textContent = label;
    const body = document.createElement("strong");
    body.textContent = value;
    item.append(name, body);
    return item;
  }

  function isActiveIssue(issue) {
    return issue.active || ["in_progress", "ready_for_qa", "qa_in_progress"].includes(issue.phase);
  }

  function matchesFilter(issue) {
    if (filter.value === "all") return true;
    if (filter.value === "actionable") return issue.dispatchable;
    if (filter.value === "active") return isActiveIssue(issue);
    if (filter.value === "closed") return issue.phase === "closed";
    return issue.phase.startsWith("blocked_") || issue.phase === "operator_escalation" ||
      (issue.phase !== "closed" && !issue.dispatchable);
  }

  function searchedIssues() {
    const query = search.value.trim().toLocaleLowerCase();
    return catalog.filter((issue) => {
      const text = [issue.id, issue.title, issue.spec_id, issue.phase, issue.tracker_status, issue.role]
        .filter(Boolean).join(" ").toLocaleLowerCase();
      return matchesFilter(issue) && text.includes(query);
    });
  }

  function badgeFor(issue) {
    if (issue.active) return "running";
    if (issue.dispatchable) return issue.phase === "planned" ? "ready" : "resume";
    if (issue.phase === "closed") return "closed";
    return "waiting";
  }

  function renderIssues() {
    const visible = searchedIssues();
    issues.replaceChildren();
    issueCount.textContent = String(visible.length);
    if (visible.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-issues";
      empty.textContent = catalog.length === 0 ? "No issue exists in the configured source." : "No issue matches this view.";
      issues.append(empty);
      return;
    }
    for (const issue of visible) {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "issue-option" + (issue.id === selectedId ? " selected" : "");
      option.dataset.issue = issue.id;
      option.setAttribute("aria-pressed", String(issue.id === selectedId));
      const top = document.createElement("span");
      top.className = "issue-top";
      const id = document.createElement("span");
      id.className = "issue-id";
      id.textContent = issue.id;
      const badge = document.createElement("span");
      badge.className = "badge" + (issue.dispatchable ? "" : " blocked");
      badge.textContent = badgeFor(issue);
      top.append(id, badge);
      const title = document.createElement("span");
      title.className = "issue-title";
      title.textContent = issue.title;
      const meta = document.createElement("span");
      meta.className = "issue-meta";
      meta.textContent = issue.phase + (issue.tracker_status ? " · Sudocode: " + issue.tracker_status : "") +
        (issue.spec_id ? " · " + issue.spec_id : "") +
        " · " + issue.criteria_count + " criteria · " + issue.depends_on.length +
        " dependencies · " + issue.reservations.length + " reservations";
      const reason = document.createElement("span");
      reason.className = "issue-reason" + (issue.dispatchable ? "" : " blocked");
      reason.textContent = issue.reason;
      option.append(top, title, meta, reason);
      issues.append(option);
    }
  }

  function showSelection() {
    const issue = catalog.find((candidate) => candidate.id === selectedId);
    if (issue == null) {
      issueId.value = "";
      role.value = "—";
      selectedTitle.textContent = "Select an issue above";
      selectedMeta.textContent = "The expected role will be chosen from its phase.";
      selectedScope.textContent = "";
      dispatchButton.disabled = true;
      return;
    }
    issueId.value = issue.id;
    role.value = issue.role || "—";
    selectedTitle.textContent = issue.id + " · " + issue.title;
    selectedMeta.textContent = issue.phase + " · " + issue.reason;
    const dependencies = issue.depends_on.length === 0 ? "none" : issue.depends_on.join(", ");
    const reservations = issue.reservations.length === 0 ? "none" : issue.reservations.join(", ");
    selectedScope.textContent = "Dependencies: " + dependencies + " · Reservations: " + reservations;
    dispatchButton.disabled = !issue.dispatchable;
    notice.textContent = issue.dispatchable ? "Ready to dispatch as " + issue.role + "." : issue.reason;
  }

  function selectIssue(id) {
    selectedId = id;
    showSelection();
    renderIssues();
  }

  async function loadIssues() {
    try {
      const response = await fetch("/api/issues");
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Issue store unavailable");
      catalog = payload.issues;
      if (!catalog.some((issue) => issue.id === selectedId)) {
        selectedId = catalog.find((issue) => issue.dispatchable)?.id ?? catalog[0]?.id ?? null;
      }
      showSelection();
      renderIssues();
    } catch (error) {
      catalog = [];
      selectedId = null;
      showSelection();
      issues.replaceChildren();
      const empty = document.createElement("p");
      empty.className = "empty-issues";
      empty.textContent = error.message;
      issues.append(empty);
      notice.textContent = error.message;
    }
  }

  function renderRuns(snapshot) {
    runs.replaceChildren();
    total.textContent = String(snapshot.runs.length);
    const live = snapshot.runs.filter((run) => ["starting", "running"].includes(run.status));
    active.textContent = String(live.length);
    if (snapshot.runs.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "No agent has been dispatched from this dashboard.";
      runs.append(empty);
      return;
    }
    for (const run of snapshot.runs) {
      const card = document.createElement("article");
      card.className = "run";
      const head = document.createElement("div");
      head.className = "run-head";
      const titleBox = document.createElement("div");
      const title = document.createElement("h2");
      title.textContent = run.issue_id + " · " + run.role;
      const meta = document.createElement("p");
      meta.className = "meta";
      meta.textContent = run.runtime_run_id == null
        ? run.id
        : run.id + " · runtime " + run.runtime_run_id;
      titleBox.append(title, meta);
      const status = document.createElement("span");
      status.className = "status " + run.status;
      status.textContent = run.status;
      head.append(titleBox, status);
      const facts = document.createElement("div");
      facts.className = "facts";
      facts.append(
        fact("Elapsed", (run.elapsed_ms / 1000).toFixed(1) + " s"),
        fact("Exit", run.exit_code == null ? "—" : String(run.exit_code)),
        fact("Record", run.run_record == null ? "—" : run.run_record),
      );
      const output = document.createElement("pre");
      output.textContent = run.output || "Waiting for output…";
      card.append(head, facts, output);
      if (["starting", "running"].includes(run.status)) {
        const actions = document.createElement("div");
        actions.className = "actions";
        if (run.interactive) {
          const message = document.createElement("input");
          message.type = "text";
          message.maxLength = 4000;
          message.placeholder = "Send guidance to this agent";
          message.dataset.message = run.id;
          message.setAttribute("aria-label", "Message for " + run.issue_id);
          const send = document.createElement("button");
          send.type = "button";
          send.dataset.send = run.id;
          send.textContent = "Send";
          actions.append(message, send);
        }
        const stop = document.createElement("button");
        stop.type = "button";
        stop.className = "secondary";
        stop.dataset.interrupt = run.id;
        stop.textContent = "Interrupt";
        actions.append(stop);
        card.append(actions);
      }
      runs.append(card);
    }
  }

  async function mutate(path, body = {}) {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json", "x-dashboard-token": token },
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Request refused");
    return payload;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const selected = catalog.find((issue) => issue.id === selectedId);
    if (selected == null || !selected.dispatchable || selected.role == null) return;
    dispatchButton.disabled = true;
    notice.textContent = "Dispatching…";
    try {
      await mutate("/api/dispatch", { issue_id: selected.id, role: selected.role });
      notice.textContent = "Agent dispatched.";
      await loadIssues();
    } catch (error) {
      notice.textContent = error.message;
      await loadIssues();
    }
  });

  issues.addEventListener("click", (event) => {
    const option = event.target.closest("[data-issue]");
    if (option != null) selectIssue(option.dataset.issue);
  });
  search.addEventListener("input", renderIssues);
  filter.addEventListener("change", renderIssues);

  runs.addEventListener("click", async (event) => {
    const send = event.target.closest("[data-send]");
    if (send != null) {
      const field = runs.querySelector('[data-message="' + CSS.escape(send.dataset.send) + '"]');
      if (field == null || field.value.trim().length === 0) return;
      send.disabled = true;
      try {
        await mutate("/api/runs/" + encodeURIComponent(send.dataset.send) + "/input", {
          message: field.value,
        });
        notice.textContent = "Message sent to the running agent.";
        field.value = "";
      } catch (error) {
        notice.textContent = error.message;
      } finally {
        send.disabled = false;
      }
      return;
    }
    const button = event.target.closest("[data-interrupt]");
    if (button == null) return;
    button.disabled = true;
    try {
      await mutate("/api/runs/" + encodeURIComponent(button.dataset.interrupt) + "/interrupt");
      notice.textContent = "Interruption requested.";
      await loadIssues();
    } catch (error) {
      notice.textContent = error.message;
      button.disabled = false;
    }
  });

  loadIssues();
  fetch("/api/snapshot").then((response) => response.json()).then(renderRuns);
  setInterval(loadIssues, 5000);
  const events = new EventSource("/events");
  events.onopen = () => {
    dot.classList.add("online");
    connection.textContent = "Live";
  };
  events.onmessage = (event) => renderRuns(JSON.parse(event.data));
  events.onerror = () => {
    dot.classList.remove("online");
    connection.textContent = "Reconnecting";
  };
</script>
</body>
</html>`;

/**
 * Renders the dependency-free live dashboard.
 *
 * Dynamic values are inserted through DOM text nodes in the browser. The only
 * server value embedded in the source is a random request token encoded as a
 * JSON string, so agent output is never interpreted as markup.
 *
 * @param {string} token - Token required by mutating API requests.
 * @returns {string} Complete HTML document.
 */
export function dashboardPage(token) {
  const safeToken = JSON.stringify(token).replaceAll("<", "\\u003c");
  return PAGE.replace("__DASHBOARD_TOKEN__", safeToken);
}
