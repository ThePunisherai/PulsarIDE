/* PlanIDE single-page app. Talks to server.py's JSON API. No framework. */
"use strict";

// --------------------------------------------------------------------------- helpers
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtBytes = (n) => {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB"]; let i = 0; n = Number(n);
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return n.toFixed(n < 10 && i > 0 ? 1 : 0) + " " + u[i];
};

async function get(path) {
  const r = await fetch(path, { headers: { "Accept": "application/json" } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || (path + " -> " + r.status));
  return body;
}
async function post(path, obj) {
  const r = await fetch(path, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(obj || {}),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || (path + " -> " + r.status));
  return body;
}

let TOASTS = 0;
function toast(msg, kind = "") {
  const t = document.createElement("div");
  t.className = "toast " + kind;
  t.textContent = msg;
  $("#toasts").appendChild(t);
  const id = ++TOASTS;
  setTimeout(() => { t.style.opacity = "0"; setTimeout(() => t.remove(), 250); }, 3200);
  return id;
}

// modal ----------------------------------------------------------------------
function openModal(title, bodyHtml, footHtml, wide) {
  $("#modalTitle").textContent = title;
  $("#modalBody").innerHTML = bodyHtml;
  $("#modalFoot").innerHTML = footHtml || "";
  $("#modal").classList.toggle("wide", !!wide);
  $("#modalBg").classList.add("show");
}
function closeModal() { $("#modalBg").classList.remove("show"); }
$("#modalClose").onclick = closeModal;
$("#modalBg").onclick = (e) => { if (e.target === $("#modalBg")) closeModal(); };
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

// state ----------------------------------------------------------------------
const STATUS_COLS = [
  ["broken", "Broken"], ["blocked", "Blocked"], ["wip", "In progress"],
  ["todo", "To do"], ["works", "Works"], ["done", "Complete"],
];
// Status = the state it's in. Flags (confirmed / protected) are yours alone and
// live on the item, not in a column -- an item can be complete AND protected.
const STATUS_LABEL = Object.fromEntries(STATUS_COLS);
const SECTIONS = [
  ["overview", "Overview"], ["board", "Board"], ["protected", "Protected"],
  ["fixes", "Fixes / AI log"], ["roadmap", "Roadmap"], ["versions", "Versions"],
  ["activity", "Activity"], ["github", "GitHub"], ["backups", "Backups"],
  ["ai", "AI export"],
];
let BOARD_FILTER = "";
let OV = null;      // overview payload
let CUR = null;     // current project detail

// --------------------------------------------------------------------------- router
function parseHash() {
  const h = (location.hash || "#/").replace(/^#/, "");
  const parts = h.split("/").filter(Boolean);
  if (parts[0] === "p" && parts[1]) return { view: "project", id: parts[1], section: parts[2] || "overview" };
  if (parts[0] === "add") return { view: "add" };
  return { view: "overview" };
}
function go(hash) { location.hash = hash; }
window.addEventListener("hashchange", route);

async function route() {
  const r = parseHash();
  closeModal();
  if (r.view === "add") { await ensureOverview(); openAddProject(); go("#/"); return; }
  if (r.view === "project") return renderProject(r.id, r.section);
  return renderOverview();
}

async function ensureOverview() {
  OV = await get("/api/overview");
  $("#sideVersion").textContent = "PlanIDE v" + OV.version;
  $("#navProjCount").textContent = OV.count;
  renderSidebarProjects();
}

function renderSidebarProjects() {
  const box = $("#navProjects");
  if (!OV || !OV.projects.length) { box.innerHTML = '<div class="dimmer" style="font-size:12px;padding:6px 8px;">No projects yet</div>'; return; }
  box.innerHTML = OV.projects.map((p) => {
    const pr = p.progress || {};
    const warn = (pr.broken || 0) + (pr.open_fixes || 0);
    return `<div class="nav-item" data-goto="${p.id}"><span class="ic">▸</span>
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.name)}</span>
      ${warn ? `<span class="badge warn">${warn}</span>` : `<span class="badge" style="background:var(--surface-2);color:var(--text-dim)">${pr.percent || 0}%</span>`}</div>`;
  }).join("");
  $$("[data-goto]", box).forEach((n) => n.onclick = () => go("#/p/" + n.dataset.goto));
}

// --------------------------------------------------------------------------- overview
async function renderOverview() {
  await ensureOverview();
  setActiveNav("overview");
  $("#crumb").textContent = "Projects";
  $("#crumbSub").textContent = "Track what works, what's broken, and ship it.";
  $("#topActions").innerHTML = `<button class="btn primary" id="addBtn">＋ Add project</button>`;
  $("#addBtn").onclick = openAddProject;

  const v = $("#view");
  if (!OV.projects.length) {
    v.innerHTML = `<div class="panel"><div class="empty">
      No projects tracked yet.<br><br>
      <button class="btn primary" onclick="openAddProject()">＋ Add your first project</button>
      <div class="mt14 muted" style="font-size:12px">Pick any folder — web app, .exe, emulator, library, anything.</div>
    </div></div>`;
    return;
  }
  const stats = `<div class="grid stats" style="margin-bottom:18px">
    <div class="stat"><div class="k">Projects</div><div class="v mono">${OV.count}</div></div>
    <div class="stat"><div class="k">Tracked items</div><div class="v mono">${OV.total_items}</div></div>
    <div class="stat"><div class="k">Broken / blocked</div><div class="v mono ${OV.broken ? "red" : "ok"}">${OV.broken}</div></div>
    <div class="stat"><div class="k">Open fixes</div><div class="v mono ${OV.open_fixes ? "warn" : "ok"}">${OV.open_fixes}</div></div>
  </div>`;

  const cards = OV.projects.map((p) => {
    const pr = p.progress || {};
    const langs = (p.languages || []).slice(0, 3).map((l) => `<span class="chip">${esc(l)}</span>`).join("");
    const gh = p.github && p.github.remote ? `<span class="chip">⾕ GitHub</span>` : "";
    if (!p.exists) {
      return `<div class="pcard" data-goto="${p.id}">
        <div class="top"><div style="flex:1"><div class="nm">${esc(p.name)}</div>
        <div class="missing">⚠ folder not found</div><div class="pth">${esc(p.path)}</div></div></div></div>`;
    }
    return `<div class="pcard" data-goto="${p.id}">
      <div class="top"><div style="flex:1">
        <div class="nm">${esc(p.name)}</div>
        <div class="pth">${esc(p.path)}</div>
      </div><span class="chip type">${esc(p.type || "custom")}</span></div>
      <div class="chips">${langs}${p.custom_stack ? `<span class="chip">${esc(p.custom_stack)}</span>` : ""}${gh}
        <span class="chip mono">v${esc(p.version || "0.1.0")}</span></div>
      <div>
        <div class="flex" style="justify-content:space-between;font-size:11.5px;margin-bottom:5px">
          <span class="muted">${pr.done || 0}/${pr.total_items || 0} working</span>
          <span class="mono">${pr.percent || 0}%</span></div>
        <div class="bar"><i style="width:${pr.percent || 0}%"></i></div>
      </div>
      <div class="chips">
        ${pr.broken ? `<span class="pill broken">${pr.broken} broken</span>` : ""}
        ${pr.open_fixes ? `<span class="pill open">${pr.open_fixes} open fix${pr.open_fixes > 1 ? "es" : ""}</span>` : ""}
        ${!pr.broken && !pr.open_fixes ? `<span class="pill works">healthy</span>` : ""}
      </div></div>`;
  }).join("");
  v.innerHTML = stats + `<div class="grid cards">${cards}</div>`;
  $$("[data-goto]", v).forEach((n) => n.onclick = () => go("#/p/" + n.dataset.goto));
}

function setActiveNav(nav) {
  $$(".nav-item[data-nav]").forEach((n) => n.classList.toggle("active", n.dataset.nav === nav));
}

// --------------------------------------------------------------------------- project
async function renderProject(id, section) {
  setActiveNav("");
  let d;
  try { d = await get("/api/project?id=" + encodeURIComponent(id)); }
  catch (e) { toast("Could not load project: " + e.message, "err"); go("#/"); return; }
  CUR = d;
  await ensureOverview();
  const pr = d.progress || {};
  const det = (d.stack && d.stack.detected) || {};

  $("#crumb").innerHTML = `<a href="#/" style="color:var(--text-dim)">Projects</a> <span class="dimmer">/</span> ${esc(d.name)}`;
  $("#crumbSub").textContent = d.path;
  $("#topActions").innerHTML = `
    <button class="btn sm" id="aiBtn">✦ AI export</button>
    <button class="btn sm primary" id="syncTop">⾕ Sync</button>`;
  $("#aiBtn").onclick = () => go("#/p/" + id + "/ai");
  $("#syncTop").onclick = () => go("#/p/" + id + "/github");

  const tabs = SECTIONS.map(([k, label]) => {
    let badge = "";
    if (k === "board" && pr.broken) badge = `<span class="badge warn">${pr.broken}</span>`;
    if (k === "fixes" && pr.open_fixes) badge = `<span class="badge warn">${pr.open_fixes}</span>`;
    return `<button class="btn sm ${k === section ? "primary" : "ghost"}" data-sec="${k}">${label}${badge}</button>`;
  }).join(" ");

  const langs = (det.languages || []).map((l) => `<span class="chip">${esc(l)}</span>`).join("");
  const stack = (det.stack || []).map((l) => `<span class="chip">${esc(l)}</span>`).join("");
  const header = `<div class="panel">
    <div class="flex wrap" style="justify-content:space-between;align-items:flex-start">
      <div style="min-width:0">
        <div class="flex gap8 wrap"><span class="chip type">${esc(d.type || "custom")}</span>
          <span class="chip mono">v${esc(d.version || "0.1.0")}</span>
          ${det.confidence ? `<span class="chip">detect: ${esc(det.confidence)}</span>` : ""}</div>
        <div class="chips mt8">${langs}${stack}${d.stack && d.stack.custom ? `<span class="chip type">${esc(d.stack.custom)}</span>` : ""}</div>
      </div>
      <div class="ring-wrap">
        <div class="ring ${pr.confirmed_percent >= 100 ? "g" : ""}" style="--p:${pr.confirmed_percent || 0}"
             title="Confirmed by you — the only number that isn't a claim"><span>${pr.confirmed_percent || 0}%</span></div>
        <div style="font-size:12px" class="muted">
          <div><b style="color:var(--ok)">${pr.confirmed || 0}</b> confirmed by you</div>
          <div><b style="color:var(--warn)">${pr.unconfirmed || 0}</b> claimed, unchecked</div>
          <div><b style="color:var(--accent-2)">${pr.protected || 0}</b> protected</div>
          <div><b style="color:var(--err)">${pr.broken || 0}</b> broken · <b>${pr.total_items || 0}</b> total</div>
          ${pr.regressed ? `<div style="color:var(--err);font-weight:700">⚠ ${pr.regressed} regression${pr.regressed > 1 ? "s" : ""}</div>` : ""}
        </div>
      </div>
    </div>
    <div class="flex gap6 wrap mt14">${tabs}</div>
  </div>`;

  $("#view").innerHTML = header + `<div id="sec"></div>`;
  $$("[data-sec]").forEach((b) => b.onclick = () => go("#/p/" + id + "/" + b.dataset.sec));
  const secBox = $("#sec");
  const R = { overview: secOverview, board: secBoard, protected: secProtected,
    fixes: secFixes, roadmap: secRoadmap, versions: secVersions,
    activity: secActivity, github: secGithub, backups: secBackups, ai: secAI };
  (R[section] || secOverview)(secBox, d);
  if (window.innerWidth <= 860) closeSidebar();
}

function reload() { const r = parseHash(); if (r.view === "project") renderProject(r.id, r.section); else renderOverview(); }
const pid = () => CUR.id;

// section: overview ----------------------------------------------------------
function secOverview(box, d) {
  const pr = d.progress;
  const broken = d.items.filter((i) => i.status === "broken" || i.status === "blocked");
  const openFixes = d.fixes.filter((f) => f.status === "open");
  const c = pr.counts || {};
  const regressed = (d.items || []).filter((i) => i.locked && (i.status === "broken" || i.status === "blocked"));
  box.innerHTML = `
    ${regressed.length ? `<div class="panel regression">
      <div class="panel-h"><h2>⚠ ${regressed.length} protected item${regressed.length > 1 ? "s" : ""} broke</h2>
        <div class="spacer"></div><button class="btn sm" data-sec-jump="protected">Open →</button></div>
      <div class="panel-note">You marked ${regressed.length > 1 ? "these" : "this"} “do not break”: ${regressed.map((i) => `<b>${esc(i.title)}</b>`).join(", ")}. Fix before anything else.</div>
    </div>` : ""}
    <div class="grid stats" style="margin-bottom:18px">
      <div class="stat"><div class="k">Confirmed by you</div><div class="v ok mono">${pr.confirmed}</div>
        <div class="dimmer" style="font-size:11px">${pr.confirmed_percent}% of all items</div></div>
      <div class="stat"><div class="k">Claimed, unchecked</div><div class="v mono ${pr.unconfirmed ? "warn" : ""}">${pr.unconfirmed}</div></div>
      <div class="stat"><div class="k">Complete</div><div class="v mono">${pr.complete}</div></div>
      <div class="stat"><div class="k">Still open</div><div class="v mono">${pr.open}</div></div>
      <div class="stat"><div class="k">Protected</div><div class="v mono" style="color:var(--accent-2)">${pr.protected}</div></div>
      <div class="stat"><div class="k">Broken/blocked</div><div class="v mono ${pr.broken ? "red" : ""}">${pr.broken}</div></div>
    </div>
    <div class="panel"><div class="panel-h"><h2>Needs attention</h2><div class="spacer"></div>
      <button class="btn sm" data-sec-jump="board">Open board →</button></div>
      ${broken.length || openFixes.length ? `
        ${broken.map((i) => `<div class="item-row"><span class="pill ${i.status}">${i.status}</span>
          <div class="grow"><div class="t">${esc(i.title)}</div>${i.notes ? `<div class="d">${esc(i.notes)}</div>` : ""}</div></div>`).join("")}
        ${openFixes.map((f) => `<div class="item-row"><span class="pill open">fix</span>
          <div class="grow"><div class="t">${esc(f.title)}</div>${f.problem ? `<div class="d">${esc(f.problem)}</div>` : ""}</div></div>`).join("")}
      ` : `<div class="empty">Nothing broken and no open fixes. 🎉</div>`}
    </div>`;
  $$("[data-sec-jump]", box).forEach((b) => b.onclick = () => go("#/p/" + pid() + "/" + b.dataset.secJump));
}

// section: board -------------------------------------------------------------
function itemBadges(i) {
  const b = [];
  if (i.locked) b.push('<span class="badge-lock" title="Protected: do not break">🔒 PROTECTED</span>');
  if (i.verified) b.push('<span class="badge-ok" title="Confirmed by you">✓ CONFIRMED</span>');
  else if ((i.status === "works" || i.status === "done") && i.claimed_by)
    b.push(`<span class="badge-claim" title="Reported by an agent — not confirmed">claimed · ${esc(i.claimed_by)}</span>`);
  return b.join("");
}

function itemCard(i) {
  return `<div class="card ${i.locked ? "locked" : ""}" data-edit="${i.id}">
    <div class="t">${esc(i.title)}</div>
    ${i.notes ? `<div class="nts">${esc(i.notes)}</div>` : ""}
    <div class="meta">${itemBadges(i)}
      ${(i.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join("")}
      ${i.priority && i.priority !== "normal" ? `<span class="tag" style="color:var(--warn)">${esc(i.priority)}</span>` : ""}
    </div>
    <div class="card-acts">
      ${i.status === "works" || i.status === "done"
        ? `<button class="mini ${i.verified ? "on" : ""}" data-verify="${i.id}" data-to="${i.verified ? "0" : "1"}"
             title="${i.verified ? "Withdraw your confirmation" : "I checked this — it works"}">${i.verified ? "undo confirm" : "confirm"}</button>` : ""}
      <button class="mini ${i.locked ? "on lock" : ""}" data-lock="${i.id}" data-to="${i.locked ? "0" : "1"}"
        title="${i.locked ? "Remove protection" : "Protect: do not break this"}">${i.locked ? "unprotect" : "protect"}</button>
    </div>
  </div>`;
}

function secBoard(box, d) {
  const q = (BOARD_FILTER || "").toLowerCase();
  const match = (i) => !q || (i.title + " " + (i.notes || "") + " " + (i.tags || []).join(" ")).toLowerCase().includes(q);
  const cols = STATUS_COLS.map(([st, label]) => {
    const items = d.items.filter((i) => i.status === st && match(i));
    const cards = items.map(itemCard).join("") || `<div class="dimmer" style="font-size:12px;padding:6px 2px">—</div>`;
    return `<div class="col"><div class="col-h"><span class="pill ${st}">${label}</span><span class="n">${items.length}</span></div>${cards}</div>`;
  }).join("");

  box.innerHTML = `
    <div class="panel quickadd">
      <div class="panel-h"><h2>Add what you know</h2>
        <span class="panel-note">type it, pick the state, Enter — this is your board</span></div>
      <div class="flex gap8 wrap">
        <input id="qaTitle" placeholder="e.g. save button throws a 500" style="flex:2;min-width:220px">
        <select id="qaStatus" style="flex:0 0 150px">
          ${STATUS_COLS.map(([v, l]) => `<option value="${v}" ${v === "todo" ? "selected" : ""}>${l}</option>`).join("")}
        </select>
        <button class="btn primary" id="qaAdd">Add</button>
      </div>
      <div class="flex gap8 wrap mt8">
        <input id="qaNotes" placeholder="details (optional) — what exactly happens?" style="flex:2;min-width:220px">
        <label class="flex gap6 dimmer" style="font-size:12px;flex:0 0 auto">
          <input type="checkbox" id="qaLock" style="width:auto"> protect (do not break)</label>
        <label class="flex gap6 dimmer" style="font-size:12px;flex:0 0 auto">
          <input type="checkbox" id="qaConfirm" style="width:auto"> I confirmed this works</label>
      </div>
    </div>
    <div class="panel"><div class="panel-h"><h2>Tracker board</h2>
      <span class="panel-note">click a card to edit · 🔒 = never break this</span>
      <div class="spacer"></div>
      <input id="boardFilter" placeholder="filter…" style="max-width:190px" value="${esc(BOARD_FILTER)}"></div>
      <div class="board">${cols}</div></div>`;

  const addNow = async () => {
    const title = $("#qaTitle").value.trim();
    if (!title) return;
    const wantLock = $("#qaLock").checked, wantConfirm = $("#qaConfirm").checked;
    try {
      const r = await post("/api/item/add", { id: pid(), title, status: $("#qaStatus").value, notes: $("#qaNotes").value });
      const iid = r.item.id;
      if (wantLock) await post("/api/item/lock", { id: pid(), item_id: iid, locked: true });
      if (wantConfirm) await post("/api/item/verify", { id: pid(), item_id: iid, verified: true });
      toast("Added", "ok"); reload();
    } catch (e) { toast(e.message, "err"); }
  };
  $("#qaAdd").onclick = addNow;
  $("#qaTitle").onkeydown = (e) => { if (e.key === "Enter") addNow(); };
  $("#qaNotes").onkeydown = (e) => { if (e.key === "Enter") addNow(); };
  $("#boardFilter").oninput = (e) => { BOARD_FILTER = e.target.value; const p = e.target.selectionStart; secBoard(box, d); const f = $("#boardFilter"); f.focus(); f.setSelectionRange(p, p); };
  wireItemActions(box, d);
}

// Confirm / protect buttons live on cards in several views; wire them all the
// same way so a card behaves identically wherever it is rendered.
function wireItemActions(box, d) {
  $$("[data-edit]", box).forEach((c) => c.onclick = (e) => {
    if (e.target.closest("[data-verify],[data-lock]")) return;
    editItem(d.items.find((i) => i.id === c.dataset.edit));
  });
  $$("[data-verify]", box).forEach((b) => b.onclick = async (e) => {
    e.stopPropagation();
    try { await post("/api/item/verify", { id: pid(), item_id: b.dataset.verify, verified: b.dataset.to === "1" }); reload(); }
    catch (err) { toast(err.message, "err"); }
  });
  $$("[data-lock]", box).forEach((b) => b.onclick = async (e) => {
    e.stopPropagation();
    try { await post("/api/item/lock", { id: pid(), item_id: b.dataset.lock, locked: b.dataset.to === "1" }); reload(); }
    catch (err) { toast(err.message, "err"); }
  });
}

// Protected view: everything you said must not break, and anything that did.
function secProtected(box, d) {
  const locked = d.items.filter((i) => i.locked);
  const regressed = locked.filter((i) => i.status === "broken" || i.status === "blocked");
  const holding = locked.filter((i) => !regressed.includes(i));
  box.innerHTML = `
    ${regressed.length ? `<div class="panel regression">
      <div class="panel-h"><h2>⚠ Regression — protected work is broken</h2></div>
      <div class="panel-note">You marked these “do not break”. They are failing now. This is the first thing to fix.</div>
      <div class="board mt14">${regressed.map(itemCard).join("")}</div></div>` : ""}
    <div class="panel">
      <div class="panel-h"><h2>Protected — do not break</h2>
        <span class="panel-note">${holding.length} holding${regressed.length ? ` · ${regressed.length} broken` : ""}</span></div>
      ${locked.length
        ? `<div class="panel-note mb0">Agents see this list in every briefing, and are told not to refactor or “improve” these while doing something else.</div>
           <div class="board mt14">${holding.map(itemCard).join("") || `<div class="dimmer">— all protected items are currently broken —</div>`}</div>`
        : `<div class="empty">Nothing protected yet.<br><br>Mark the things that already work and must stay working —
             they show up in every AI briefing as off-limits.</div>`}
    </div>`;
  wireItemActions(box, d);
}

// What changed, and who changed it — you or an agent.
function secActivity(box, d) {
  const acts = d.activity || [];
  const icon = { "item-add": "＋", "item-status": "→", verify: "✓", lock: "🔒",
                 "fix-add": "🔧", "fix-done": "✔" };
  box.innerHTML = `<div class="panel"><div class="panel-h"><h2>Activity</h2>
    <span class="panel-note">every change, and who made it</span></div>
    ${acts.length ? acts.map((a) => `<div class="act">
      <span class="act-ic">${icon[a.kind] || "·"}</span>
      <span class="act-who ${a.who === "you" ? "me" : "bot"}">${esc(a.who)}</span>
      <span class="act-txt">${esc(a.text)}</span>
      <span class="act-at">${esc(String(a.at).slice(5, 16).replace("T", " "))}</span>
    </div>`).join("") : `<div class="empty">Nothing recorded yet.</div>`}
  </div>`;
}

function editItem(it) {
  const isNew = !it;
  it = it || { title: "", status: "todo", notes: "", tags: [], priority: "normal" };
  const opts = STATUS_COLS.map(([v, l]) => `<option value="${v}" ${it.status === v ? "selected" : ""}>${l}</option>`).join("");
  openModal(isNew ? "New item" : "Edit item", `
    <div><label class="fld">Title</label><input id="iTitle" value="${esc(it.title)}" placeholder="e.g. Login screen"></div>
    <div class="row">
      <div><label class="fld">Status</label><select id="iStatus">${opts}</select></div>
      <div><label class="fld">Priority</label><select id="iPrio">
        ${["low", "normal", "high", "critical"].map((p) => `<option ${it.priority === p ? "selected" : ""}>${p}</option>`).join("")}</select></div>
    </div>
    <div><label class="fld">Notes (what's wrong / how it works)</label><textarea id="iNotes" placeholder="Details…">${esc(it.notes)}</textarea></div>
    <div><label class="fld">Tags (comma separated)</label><input id="iTags" value="${esc((it.tags || []).join(", "))}"></div>
    ${isNew ? "" : `<div class="flagbox">
      <label class="flex gap8"><input type="checkbox" id="iLock" ${it.locked ? "checked" : ""} style="width:auto">
        <span><b>🔒 Do not break</b><br><span class="dimmer" style="font-size:11px">Agents are told this is off-limits in every briefing.</span></span></label>
      <label class="flex gap8 mt8"><input type="checkbox" id="iVerify" ${it.verified ? "checked" : ""} style="width:auto">
        <span><b>✓ Confirmed by me</b><br><span class="dimmer" style="font-size:11px">Only you can set this — an agent saying "works" is just a claim.</span></span></label>
      ${it.claimed_by ? `<div class="dimmer mt8" style="font-size:11px">reported by <b>${esc(it.claimed_by)}</b></div>` : ""}
    </div>`}`,
    `${isNew ? "" : `<button class="btn danger" id="iDel">Delete</button>`}
     <div class="spacer" style="flex:1"></div>
     <button class="btn" id="iCancel">Cancel</button>
     <button class="btn primary" id="iSave">${isNew ? "Add" : "Save"}</button>`);
  $("#iCancel").onclick = closeModal;
  $("#iSave").onclick = async () => {
    const body = { id: pid(), title: $("#iTitle").value, status: $("#iStatus").value,
      priority: $("#iPrio").value, notes: $("#iNotes").value,
      tags: $("#iTags").value.split(",").map((s) => s.trim()).filter(Boolean) };
    try {
      if (isNew) await post("/api/item/add", body);
      else {
        await post("/api/item/update", Object.assign({ item_id: it.id }, body));
        // Flags are separate endpoints on purpose: they are yours, and the
        // generic update path deliberately cannot set them.
        const wantLock = $("#iLock").checked, wantVerify = $("#iVerify").checked;
        if (wantLock !== !!it.locked)
          await post("/api/item/lock", { id: pid(), item_id: it.id, locked: wantLock });
        if (wantVerify !== !!it.verified)
          await post("/api/item/verify", { id: pid(), item_id: it.id, verified: wantVerify });
      }
      toast("Item saved", "ok"); closeModal(); reload();
    } catch (e) { toast(e.message, "err"); }
  };
  if (!isNew) $("#iDel").onclick = async () => {
    if (!confirm("Delete this item?")) return;
    try { await post("/api/item/delete", { id: pid(), item_id: it.id }); toast("Deleted", "ok"); closeModal(); reload(); }
    catch (e) { toast(e.message, "err"); }
  };
}

// section: fixes -------------------------------------------------------------
function secFixes(box, d) {
  const open = d.fixes.filter((f) => f.status === "open");
  const done = d.fixes.filter((f) => f.status !== "open");
  const row = (f) => `<div class="item-row">
    <span class="pill ${f.status}">${f.status}</span>
    <div class="grow">
      <div class="t">${esc(f.title)}</div>
      ${f.problem ? `<div class="d"><b>Problem:</b> ${esc(f.problem)}</div>` : ""}
      ${f.solution ? `<div class="d"><b>Solution:</b> ${esc(f.solution)}</div>` : ""}
      ${f.agent ? `<div class="d dimmer">agent: ${esc(f.agent)}</div>` : ""}
    </div>
    <div class="acts">
      ${f.status === "open" ? `<button class="icon-btn" title="Mark fixed" data-fixdone="${f.id}">✓</button>` : ""}
      <button class="icon-btn" data-fixedit="${f.id}">✎</button>
    </div></div>`;
  box.innerHTML = `<div class="panel"><div class="panel-h"><h2>Fix log</h2>
    <span class="panel-note">problem → solution, AI-assisted or manual</span><div class="spacer"></div>
    <button class="btn sm primary" id="addFix">＋ Fix</button></div>
    <h3 style="font-size:12px" class="muted">Open (${open.length})</h3>
    ${open.map(row).join("") || `<div class="empty">No open fixes.</div>`}
    <h3 style="font-size:12px;margin-top:18px" class="muted">Resolved (${done.length})</h3>
    ${done.map(row).join("") || `<div class="dimmer" style="font-size:12px;padding:8px">Nothing resolved yet.</div>`}
  </div>`;
  $("#addFix").onclick = () => editFix(null);
  $$("[data-fixedit]", box).forEach((b) => b.onclick = () => editFix(d.fixes.find((f) => f.id === b.dataset.fixedit)));
  $$("[data-fixdone]", box).forEach((b) => b.onclick = async () => {
    try { await post("/api/fix/update", { id: pid(), fix_id: b.dataset.fixdone, status: "fixed" }); toast("Marked fixed", "ok"); reload(); }
    catch (e) { toast(e.message, "err"); }
  });
}

function editFix(f) {
  const isNew = !f;
  f = f || { title: "", problem: "", solution: "", agent: "", status: "open" };
  const items = (CUR.items || []).map((i) => `<option value="${i.id}" ${f.item_id === i.id ? "selected" : ""}>${esc(i.title)}</option>`).join("");
  openModal(isNew ? "New fix" : "Edit fix", `
    <div><label class="fld">Title</label><input id="fTitle" value="${esc(f.title)}" placeholder="e.g. Fix save button 500"></div>
    <div><label class="fld">Problem</label><textarea id="fProblem" placeholder="What's broken?">${esc(f.problem)}</textarea></div>
    <div><label class="fld">Solution / proposal</label><textarea id="fSolution" placeholder="How it was (or will be) fixed">${esc(f.solution)}</textarea></div>
    <div class="row">
      <div><label class="fld">Status</label><select id="fStatus">
        ${["open", "fixed", "wontfix"].map((s) => `<option ${f.status === s ? "selected" : ""}>${s}</option>`).join("")}</select></div>
      <div><label class="fld">Agent (optional)</label><input id="fAgent" value="${esc(f.agent)}" placeholder="Claude / Codex / me"></div>
    </div>
    <div><label class="fld">Linked item (optional)</label><select id="fItem"><option value="">—</option>${items}</select></div>`,
    `${isNew ? "" : `<button class="btn danger" id="fDel">Delete</button>`}
     <div style="flex:1"></div><button class="btn" id="fCancel">Cancel</button>
     <button class="btn primary" id="fSave">${isNew ? "Add" : "Save"}</button>`);
  $("#fCancel").onclick = closeModal;
  $("#fSave").onclick = async () => {
    const body = { id: pid(), title: $("#fTitle").value, problem: $("#fProblem").value,
      solution: $("#fSolution").value, status: $("#fStatus").value, agent: $("#fAgent").value,
      item_id: $("#fItem").value };
    try {
      if (isNew) await post("/api/fix/add", body);
      else await post("/api/fix/update", Object.assign({ fix_id: f.id }, body));
      toast("Fix saved", "ok"); closeModal(); reload();
    } catch (e) { toast(e.message, "err"); }
  };
  if (!isNew) $("#fDel").onclick = async () => {
    if (!confirm("Delete this fix?")) return;
    try { await post("/api/fix/delete", { id: pid(), fix_id: f.id }); toast("Deleted", "ok"); closeModal(); reload(); }
    catch (e) { toast(e.message, "err"); }
  };
}

// section: roadmap -----------------------------------------------------------
function secRoadmap(box, d) {
  const pr = d.progress;
  const ms = (d.roadmap || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  box.innerHTML = `<div class="panel"><div class="panel-h"><h2>Roadmap</h2>
    <span class="panel-note">${pr.milestones_done}/${pr.milestones_total} milestones done</span>
    <div class="spacer"></div><button class="btn sm primary" id="addMs">＋ Milestone</button></div>
    <div class="bar g" style="margin-bottom:16px"><i style="width:${pr.milestones_percent || 0}%"></i></div>
    ${ms.map((m) => `<div class="ms">
      <div class="box ${m.done ? "done" : ""}" data-ms="${m.id}">${m.done ? "✓" : ""}</div>
      <div class="grow"><div class="t" style="font-weight:620">${esc(m.title)}</div>
        ${m.target ? `<div class="tgt">target: ${esc(m.target)}</div>` : ""}</div>
      <div class="acts"><button class="icon-btn" data-msedit="${m.id}">✎</button></div>
    </div>`).join("") || `<div class="empty">No milestones yet — add where you're headed.</div>`}
  </div>`;
  $("#addMs").onclick = () => editMilestone(null);
  $$("[data-ms]", box).forEach((b) => b.onclick = async () => {
    const m = d.roadmap.find((x) => x.id === b.dataset.ms);
    try { await post("/api/milestone/update", { id: pid(), mid: m.id, done: !m.done }); reload(); }
    catch (e) { toast(e.message, "err"); }
  });
  $$("[data-msedit]", box).forEach((b) => b.onclick = () => editMilestone(d.roadmap.find((x) => x.id === b.dataset.msedit)));
}

function editMilestone(m) {
  const isNew = !m;
  m = m || { title: "", target: "" };
  openModal(isNew ? "New milestone" : "Edit milestone", `
    <div><label class="fld">Title</label><input id="mTitle" value="${esc(m.title)}" placeholder="e.g. Playable demo"></div>
    <div><label class="fld">Target (version / date, optional)</label><input id="mTarget" value="${esc(m.target)}" placeholder="v1.0 or Q3"></div>`,
    `${isNew ? "" : `<button class="btn danger" id="mDel">Delete</button>`}
     <div style="flex:1"></div><button class="btn" id="mCancel">Cancel</button>
     <button class="btn primary" id="mSave">${isNew ? "Add" : "Save"}</button>`);
  $("#mCancel").onclick = closeModal;
  $("#mSave").onclick = async () => {
    const body = { id: pid(), title: $("#mTitle").value, target: $("#mTarget").value };
    try {
      if (isNew) await post("/api/milestone/add", body);
      else await post("/api/milestone/update", Object.assign({ mid: m.id }, body));
      toast("Saved", "ok"); closeModal(); reload();
    } catch (e) { toast(e.message, "err"); }
  };
  if (!isNew) $("#mDel").onclick = async () => {
    try { await post("/api/milestone/delete", { id: pid(), mid: m.id }); toast("Deleted", "ok"); closeModal(); reload(); }
    catch (e) { toast(e.message, "err"); }
  };
}

// section: versions ----------------------------------------------------------
function secVersions(box, d) {
  const vs = d.versions || [];
  box.innerHTML = `<div class="panel"><div class="panel-h"><h2>Version history</h2>
    <span class="panel-note">current: v${esc(d.version)}</span><div class="spacer"></div>
    <button class="btn sm primary" id="addVer">＋ Version</button></div>
    ${vs.map((v) => `<div class="ver">
      <div class="vh">v${esc(v.version)}</div><div class="vd">${esc(v.date)}</div>
      ${v.notes ? `<div class="mt8" style="font-size:13px">${esc(v.notes)}</div>` : ""}
      <div class="tags">
        ${(v.added || []).map((x) => `<div><span style="color:var(--ok)">＋</span> ${esc(x)}</div>`).join("")}
        ${(v.fixed || []).map((x) => `<div><span style="color:var(--accent-2)">✓</span> ${esc(x)}</div>`).join("")}
        ${(v.changed || []).map((x) => `<div><span style="color:var(--warn)">~</span> ${esc(x)}</div>`).join("")}
      </div></div>`).join("") || `<div class="empty">No versions cut yet.</div>`}
  </div>`;
  $("#addVer").onclick = () => {
    openModal("Cut a version", `
      <div><label class="fld">Version</label><input id="vNum" placeholder="e.g. 0.2.0"></div>
      <div><label class="fld">Notes</label><textarea id="vNotes" placeholder="What's this release about?"></textarea></div>
      <div><label class="fld">Added (one per line)</label><textarea id="vAdd"></textarea></div>
      <div><label class="fld">Fixed (one per line)</label><textarea id="vFix"></textarea></div>
      <div><label class="fld">Changed (one per line)</label><textarea id="vChg"></textarea></div>`,
      `<div style="flex:1"></div><button class="btn" onclick="closeModalX()">Cancel</button>
       <button class="btn primary" id="vSave">Add version</button>`);
    $("#vSave").onclick = async () => {
      const lines = (id) => $("#" + id).value.split("\n").map((s) => s.trim()).filter(Boolean);
      try {
        await post("/api/version/add", { id: pid(), version: $("#vNum").value, notes: $("#vNotes").value,
          added: lines("vAdd"), fixed: lines("vFix"), changed: lines("vChg") });
        toast("Version added", "ok"); closeModal(); reload();
      } catch (e) { toast(e.message, "err"); }
    };
  };
}
window.closeModalX = closeModal;

// section: github ------------------------------------------------------------
async function secGithub(box, d) {
  box.innerHTML = `<div class="panel"><div class="panel-h"><h2>GitHub sync</h2><span class="spin" id="ghSpin"></span></div>
    <div id="ghBody" class="muted">Reading git status…</div></div>`;
  let g;
  try { g = await get("/api/git/status?id=" + pid()); } catch (e) { g = { ok: false, error: e.message }; }
  $("#ghSpin").remove();
  const body = $("#ghBody");
  if (!g.has_git) {
    body.innerHTML = `<div class="empty">This folder is not a git repo yet.
      <div class="mt14 flex gap8" style="justify-content:center">
        <input id="ghBranch" value="main" style="max-width:120px">
        <button class="btn primary" id="ghInit">Initialise git</button></div></div>`;
    $("#ghInit").onclick = async () => {
      try { await post("/api/git/init", { id: pid(), branch: $("#ghBranch").value || "main" }); toast("git initialised", "ok"); reload(); }
      catch (e) { toast(e.message, "err"); }
    };
    return;
  }
  const changed = g.changed_count || 0;
  body.innerHTML = `
    <div class="grid stats" style="margin-bottom:16px">
      <div class="stat"><div class="k">Branch</div><div class="v mono" style="font-size:17px">${esc(g.branch || "?")}</div></div>
      <div class="stat"><div class="k">Uncommitted</div><div class="v mono ${changed ? "warn" : "ok"}">${changed}</div></div>
      <div class="stat"><div class="k">Ahead / behind</div><div class="v mono" style="font-size:17px">${g.ahead || 0} / ${g.behind || 0}</div></div>
    </div>
    <div class="item-row"><div class="grow"><div class="t">Remote</div>
      <div class="d mono">${g.remote ? esc(g.remote) : "— none set —"}</div></div>
      <button class="btn sm" id="ghRemote">${g.remote ? "Change" : "Set remote"}</button></div>
    ${g.last_commit ? `<div class="item-row"><div class="grow"><div class="t">Last commit</div><div class="d mono">${esc(g.last_commit)}</div></div></div>` : ""}
    <div class="mt14"><label class="fld">Commit message (optional)</label>
      <input id="ghMsg" placeholder="PlanIDE: sync tracker + project state"></div>
    <div class="flex gap8 wrap mt14">
      <label class="flex gap6" style="font-size:13px"><input type="checkbox" id="ghPush" checked style="width:auto"> push to origin</label>
      <div style="flex:1"></div>
      <button class="btn" id="ghBig">Scan large files</button>
      <button class="btn primary" id="ghSync">⾕ Commit &amp; sync</button>
    </div>
    <div id="ghOut" class="mt14"></div>`;
  $("#ghRemote").onclick = () => {
    openModal("Set GitHub remote", `
      <div><label class="fld">Remote URL (origin)</label>
        <input id="ghUrl" value="${esc(g.remote || "")}" placeholder="https://github.com/you/repo.git"></div>
      <div class="panel-note">Uses your existing git credentials (helper / SSH / gh). PlanIDE never stores a token.</div>`,
      `<div style="flex:1"></div><button class="btn" onclick="closeModalX()">Cancel</button>
       <button class="btn primary" id="ghSetR">Save remote</button>`);
    $("#ghSetR").onclick = async () => {
      try { await post("/api/git/set-remote", { id: pid(), url: $("#ghUrl").value }); toast("Remote set", "ok"); closeModal(); reload(); }
      catch (e) { toast(e.message, "err"); }
    };
  };
  $("#ghSync").onclick = async () => {
    const btn = $("#ghSync"); btn.disabled = true; btn.textContent = "Syncing…";
    $("#ghOut").innerHTML = `<div class="flex gap8"><span class="spin"></span> running git…</div>`;
    try {
      const r = await post("/api/git/sync", { id: pid(), message: $("#ghMsg").value, push: $("#ghPush").checked });
      $("#ghOut").innerHTML = `<pre class="report">${esc((r.log || []).join("\n"))}</pre>`;
      toast(r.pushed ? "Pushed to GitHub" : (r.committed ? "Committed" : "Nothing to commit"), r.push_error ? "err" : "ok");
      if (r.push_error) toast(r.push_error, "err");
    } catch (e) { toast(e.message, "err"); $("#ghOut").innerHTML = `<div class="d" style="color:var(--err)">${esc(e.message)}</div>`; }
    btn.disabled = false; btn.textContent = "⾕ Commit & sync";
  };
  $("#ghBig").onclick = () => scanLargeFiles();
}

async function scanLargeFiles() {
  openModal("Large files (LFS candidates)", `<div class="flex gap8"><span class="spin"></span> scanning…</div>`, "");
  let r;
  try { r = await get("/api/git/large-files?id=" + pid() + "&mb=25"); }
  catch (e) { $("#modalBody").innerHTML = `<div class="d" style="color:var(--err)">${esc(e.message)}</div>`; return; }
  if (!r.count) { $("#modalBody").innerHTML = `<div class="empty">No files over 25 MB. Nothing needs Git LFS.</div>`; return; }
  $("#modalBody").innerHTML = `
    <div class="panel-note">${r.count} file(s) over ${r.threshold_mb} MB. GitHub rejects files > 100 MB — track these with Git LFS.</div>
    <div class="dirlist mt8">${r.files.map((f) => `<div class="d" style="cursor:default">
      <span class="mono" style="flex:1;overflow:hidden;text-overflow:ellipsis">${esc(f.path)}</span>
      <span class="chip mono">${f.size_mb} MB</span></div>`).join("")}</div>
    <div class="mt14"><label class="fld">Track these extensions with LFS</label>
      <input id="lfsPat" value="${esc(r.extensions.join(", "))}" placeholder=".zip, .bin, .exe"></div>`;
  $("#modalFoot").innerHTML = `<div style="flex:1"></div><button class="btn" onclick="closeModalX()">Close</button>
    <button class="btn primary" id="lfsGo">Track with Git LFS</button>`;
  $("#lfsGo").onclick = async () => {
    const pats = $("#lfsPat").value.split(",").map((s) => s.trim()).filter(Boolean);
    try {
      const res = await post("/api/git/lfs", { id: pid(), patterns: pats });
      if (res.ok) { toast("LFS tracking " + (res.tracked || []).join(", "), "ok"); closeModal(); }
      else toast(res.error || "LFS failed", "err");
    } catch (e) { toast(e.message, "err"); }
  };
}

// section: backups -----------------------------------------------------------
async function secBackups(box, d) {
  const list = d.backups || [];
  box.innerHTML = `<div class="panel"><div class="panel-h"><h2>Backups</h2>
    <span class="panel-note">zip snapshots (no node_modules/.git)</span><div class="spacer"></div>
    <button class="btn sm primary" id="mkBak">＋ Snapshot now</button></div>
    ${list.map((b) => `<div class="item-row"><div class="grow">
      <div class="t mono">${esc(b.file)}</div><div class="d">${esc(b.created_at)} · ${fmtBytes(b.size)}</div></div>
      <div class="acts">
        <button class="icon-btn" title="Restore" data-restore="${esc(b.file)}">⤓</button>
        <button class="icon-btn danger" title="Delete" data-delbak="${esc(b.file)}">🗑</button>
      </div></div>`).join("") || `<div class="empty">No snapshots yet.</div>`}
  </div>`;
  $("#mkBak").onclick = async () => {
    const btn = $("#mkBak"); btn.disabled = true; btn.textContent = "Zipping…";
    try { const r = await post("/api/backup/create", { id: pid(), label: "" });
      toast("Snapshot: " + r.file + " (" + r.files + " files)", "ok"); reload(); }
    catch (e) { toast(e.message, "err"); btn.disabled = false; btn.textContent = "＋ Snapshot now"; }
  };
  $$("[data-restore]", box).forEach((b) => b.onclick = async () => {
    if (!confirm("Restore into .planide/restored-…/ ?")) return;
    try { const r = await post("/api/backup/restore", { id: pid(), file: b.dataset.restore });
      toast("Restored to " + r.restored_to, "ok"); } catch (e) { toast(e.message, "err"); }
  });
  $$("[data-delbak]", box).forEach((b) => b.onclick = async () => {
    if (!confirm("Delete this snapshot?")) return;
    try { await post("/api/backup/delete", { id: pid(), file: b.dataset.delbak }); toast("Deleted", "ok"); reload(); }
    catch (e) { toast(e.message, "err"); }
  });
}

// section: AI export ---------------------------------------------------------
async function secAI(box, d) {
  box.innerHTML = `<div class="panel"><div class="panel-h"><h2>AI export</h2>
    <span class="panel-note">hand this to Claude / Codex / any agent</span><div class="spacer"></div>
    <select id="aiMode" style="max-width:150px">
      <option value="full">Full briefing + ask</option>
      <option value="report">Status report only</option>
      <option value="prompt">Ask-focused</option>
    </select>
    <button class="btn sm" id="aiCopy">⧉ Copy</button></div>
    <pre class="report" id="aiOut">Generating…</pre></div>`;
  async function load() {
    try { const r = await get("/api/ai-report?id=" + pid() + "&mode=" + $("#aiMode").value);
      $("#aiOut").textContent = r.markdown; }
    catch (e) { $("#aiOut").textContent = "Error: " + e.message; }
  }
  $("#aiMode").onchange = load;
  $("#aiCopy").onclick = async () => {
    try { await navigator.clipboard.writeText($("#aiOut").textContent); toast("Copied to clipboard", "ok"); }
    catch { const r = document.createRange(); r.selectNode($("#aiOut")); getSelection().removeAllRanges(); getSelection().addRange(r); document.execCommand("copy"); toast("Copied", "ok"); }
  };
  load();
}

// --------------------------------------------------------------------------- add project + folder browser
function openAddProject() {
  openModal("Add a project", `
    <div><label class="fld">Project folder (absolute path)</label>
      <div class="flex gap8"><input id="apPath" placeholder="/home/you/projects/my-app">
        <button class="btn" id="apBrowse">Browse…</button></div></div>
    <div><label class="fld">Name (optional)</label><input id="apName" placeholder="defaults to folder name"></div>
    <div id="apDetect" class="panel-note"></div>`,
    `<div style="flex:1"></div><button class="btn" onclick="closeModalX()">Cancel</button>
     <button class="btn primary" id="apAdd">Add project</button>`, true);
  const detect = async () => {
    const p = $("#apPath").value.trim();
    if (!p) { $("#apDetect").textContent = ""; return; }
    try { const d = await get("/api/detect?path=" + encodeURIComponent(p));
      $("#apDetect").innerHTML = d.type === "unknown"
        ? `<span style="color:var(--warn)">⚠ path not found</span>`
        : `Detected: <b>${esc(d.type)}</b> · ${esc((d.languages || []).join(", ") || "—")} <span class="dimmer">(${esc(d.confidence)})</span>`;
    } catch { $("#apDetect").textContent = ""; }
  };
  $("#apPath").oninput = detect;
  $("#apBrowse").onclick = () => browseFolder($("#apPath").value.trim() || "~", (chosen) => { $("#apPath").value = chosen; detect(); });
  $("#apAdd").onclick = async () => {
    const path = $("#apPath").value.trim();
    if (!path) { toast("Enter a folder path", "err"); return; }
    try { const r = await post("/api/project/add", { path, name: $("#apName").value.trim() });
      toast("Project added", "ok"); closeModal(); await ensureOverview(); go("#/p/" + r.project.id); }
    catch (e) { toast(e.message, "err"); }
  };
}

async function browseFolder(start, onPick) {
  let cur = start;
  async function show(p) {
    let r;
    try { r = await get("/api/browse?path=" + encodeURIComponent(p)); }
    catch (e) { toast(e.message, "err"); return; }
    if (!r.ok) { toast(r.error || "cannot open", "err"); return; }
    cur = r.path;
    const det = r.detected || {};
    openModal("Choose folder", `
      <div class="crumbs">${esc(r.path)}</div>
      ${det.type && det.type !== "unknown" ? `<div class="panel-note mb0">Detected here: <b>${esc(det.type)}</b> · ${esc((det.languages || []).join(", ") || "—")}</div>` : ""}
      <div class="dirlist mt8">
        <div class="d" data-up><span class="ic">↰</span> .. (up)</div>
        ${r.dirs.map((x) => `<div class="d" data-dir="${esc(x.path)}"><span class="ic">▸</span> ${esc(x.name)}</div>`).join("")}
      </div>`,
      `<div style="flex:1"></div><button class="btn" onclick="closeModalX()">Cancel</button>
       <button class="btn primary" id="brPick">Use this folder</button>`, true);
    $("[data-up]").onclick = () => show(r.parent);
    $$("[data-dir]").forEach((x) => x.onclick = () => show(x.dataset.dir));
    $("#brPick").onclick = () => { onPick(cur); };
  }
  show(start);
}

// --------------------------------------------------------------------------- chrome
function openSidebar() { $("#sidebar").classList.add("open"); $("#backdrop").classList.add("show"); }
function closeSidebar() { $("#sidebar").classList.remove("open"); $("#backdrop").classList.remove("show"); }
$("#hamburger").onclick = openSidebar;
$("#backdrop").onclick = closeSidebar;
$$(".nav-item[data-nav]").forEach((n) => n.onclick = () => {
  if (n.dataset.nav === "add") { openAddProject(); }
  else go("#/");
  closeSidebar();
});

// theme
function applyTheme(t) {
  if (t) document.documentElement.setAttribute("data-theme", t);
  else document.documentElement.removeAttribute("data-theme");
}
applyTheme(localStorage.getItem("planide-theme") || "");
$("#themeBtn").onclick = () => {
  const cur = localStorage.getItem("planide-theme") || "";
  const next = cur === "dark" ? "light" : (cur === "light" ? "" : "dark");
  localStorage.setItem("planide-theme", next); applyTheme(next);
  toast("Theme: " + (next || "system"));
};

// go
route().catch((e) => { $("#view").innerHTML = `<div class="panel"><div class="empty" style="color:var(--err)">${esc(e.message)}</div></div>`; });
