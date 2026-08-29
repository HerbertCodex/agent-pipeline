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
        --shadow: 0 16px 40px rgb(0 0 0 / 24%);
      }
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--paper); color: var(--ink); }
    main { width: min(1180px, calc(100% - 32px)); margin: 0 auto; padding: 40px 0 80px; }
    header { display: flex; justify-content: space-between; align-items: end; gap: 24px; margin-bottom: 28px; }
    h1 { margin: 0; font: 650 clamp(2rem, 5vw, 4rem)/.95 Georgia, serif; letter-spacing: -.04em; }
    .lede { max-width: 42rem; margin: 12px 0 0; color: var(--muted); line-height: 1.55; }
    .connection { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: .85rem; }
    .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--alarm); }
    .dot.online { background: var(--accent); box-shadow: 0 0 0 5px var(--accent-soft); }
    form { display: grid; grid-template-columns: minmax(160px, 1fr) 180px auto; gap: 10px; padding: 16px; background: var(--panel); border: 1px solid var(--line); border-radius: 14px; box-shadow: var(--shadow); }
    label { display: grid; gap: 7px; color: var(--muted); font-size: .78rem; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
    input, select, button { min-height: 44px; border: 1px solid var(--line); border-radius: 9px; font: inherit; }
    input, select { width: 100%; padding: 0 12px; background: var(--paper); color: var(--ink); }
    button { align-self: end; padding: 0 18px; background: var(--accent); border-color: var(--accent); color: var(--paper); cursor: pointer; font-weight: 750; }
    button.secondary { min-height: 34px; padding: 0 12px; background: transparent; color: var(--alarm); border-color: currentColor; }
    button:disabled { cursor: wait; opacity: .55; }
    .summary { display: flex; gap: 24px; margin: 24px 0 16px; color: var(--muted); font-size: .9rem; }
    .summary strong { color: var(--ink); font-size: 1.2rem; }
    #runs { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 330px), 1fr)); gap: 16px; }
    .run { min-width: 0; padding: 18px; background: var(--panel); border: 1px solid var(--line); border-radius: 14px; box-shadow: var(--shadow); }
    .run-head { display: flex; justify-content: space-between; align-items: start; gap: 16px; }
    .run h2 { margin: 0; font-size: 1.05rem; overflow-wrap: anywhere; }
    .meta { margin: 6px 0 0; color: var(--muted); font: .8rem ui-monospace, monospace; }
    .status { padding: 5px 8px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); font-size: .72rem; font-weight: 800; text-transform: uppercase; }
    .status.failed, .status.interrupted { color: var(--alarm); }
    .facts { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 18px 0; }
    .fact { padding: 10px; background: var(--paper); border-radius: 8px; }
    .fact span { display: block; color: var(--muted); font-size: .72rem; text-transform: uppercase; }
    .fact strong { display: block; margin-top: 4px; font-size: .95rem; }
    pre { min-height: 110px; max-height: 260px; overflow: auto; margin: 0; padding: 12px; background: #101512; color: #d8e7dc; border-radius: 9px; white-space: pre-wrap; overflow-wrap: anywhere; font: .76rem/1.5 ui-monospace, monospace; }
    .actions { display: flex; justify-content: end; margin-top: 12px; }
    .empty { grid-column: 1 / -1; padding: 48px 24px; border: 1px dashed var(--line); border-radius: 14px; color: var(--muted); text-align: center; }
    #notice { min-height: 24px; margin: 10px 2px; color: var(--muted); font-size: .88rem; }
    @media (max-width: 680px) {
      header { align-items: start; flex-direction: column; }
      form { grid-template-columns: 1fr; }
      button { width: 100%; }
    }
  </style>
</head>
<body>
<main>
  <header>
    <div>
      <h1>Agent pipeline</h1>
      <p class="lede">Live work, heartbeats and output from the portable runtime. This page stays on your machine.</p>
    </div>
    <div class="connection"><span id="dot" class="dot"></span><span id="connection">Connecting</span></div>
  </header>

  <form id="dispatch">
    <label>Issue
      <input name="issue_id" required maxlength="128" pattern="[A-Za-z0-9][A-Za-z0-9._-]*" placeholder="i-001">
    </label>
    <label>Role
      <select name="role">
        <option value="product">Product</option>
        <option value="implementer" selected>Implementer</option>
        <option value="qa">QA</option>
        <option value="orchestrator">Orchestrator</option>
      </select>
    </label>
    <button type="submit">Dispatch agent</button>
  </form>
  <p id="notice" aria-live="polite"></p>

  <div class="summary">
    <span><strong id="active">0</strong> active</span>
    <span><strong id="total">0</strong> total</span>
  </div>
  <section id="runs" aria-live="polite"><p class="empty">No agent has been dispatched from this dashboard.</p></section>
</main>
<script>
  const token = __DASHBOARD_TOKEN__;
  const runs = document.querySelector("#runs");
  const notice = document.querySelector("#notice");
  const form = document.querySelector("#dispatch");
  const active = document.querySelector("#active");
  const total = document.querySelector("#total");
  const dot = document.querySelector("#dot");
  const connection = document.querySelector("#connection");

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

  function render(snapshot) {
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
      meta.textContent = run.id;
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
      );
      const output = document.createElement("pre");
      output.textContent = run.output || "Waiting for output…";
      card.append(head, facts, output);
      if (["starting", "running"].includes(run.status)) {
        const actions = document.createElement("div");
        actions.className = "actions";
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
    const button = form.querySelector("button");
    button.disabled = true;
    notice.textContent = "Dispatching…";
    try {
      const fields = new FormData(form);
      await mutate("/api/dispatch", {
        issue_id: fields.get("issue_id"),
        role: fields.get("role"),
      });
      notice.textContent = "Agent dispatched.";
    } catch (error) {
      notice.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });

  runs.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-interrupt]");
    if (button == null) return;
    button.disabled = true;
    try {
      await mutate("/api/runs/" + encodeURIComponent(button.dataset.interrupt) + "/interrupt");
      notice.textContent = "Interruption requested.";
    } catch (error) {
      notice.textContent = error.message;
      button.disabled = false;
    }
  });

  fetch("/api/snapshot").then((response) => response.json()).then(render);
  const events = new EventSource("/events");
  events.onopen = () => {
    dot.classList.add("online");
    connection.textContent = "Live";
  };
  events.onmessage = (event) => render(JSON.parse(event.data));
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
