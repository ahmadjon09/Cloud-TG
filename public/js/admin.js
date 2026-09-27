// admin.js — admin panel: dashboard, users, files, broadcast, system
import {
  $, el, debounce, formatSize, formatDate, formatDateTime, formatRelative,
  categoryOf, iconFor, haptic
} from "./core.js";
import { t, loadLanguage, applyStatic, bootConfig, guessLanguage, lang, htmlLang } from "./i18n.js";
import { icon } from "./icons.js";
import { api } from "./api.js";
import { toast, sheet, confirm, contextMenu, avatarOf } from "./ui.js";

const tg = window.Telegram?.WebApp;
const boot = bootConfig();

const TABS = [
  { id: "dashboard", icon: "chart" },
  { id: "users", icon: "users" },
  { id: "files", icon: "files" },
  { id: "broadcast", icon: "broadcast" },
  { id: "system", icon: "server" }
];

const state = {
  tab: "dashboard",
  me: null,
  overview: null,
  users: { items: [], total: 0, skip: 0, limit: 20, q: "", loading: false },
  files: { items: [], total: 0, skip: 0, limit: 25, q: "", kind: "", loading: false },
  system: null,
  history: [],
  job: null
};

const dom = {
  tabs: $("#tabs"),
  main: $("#main"),
  refreshBtn: $("#refreshBtn"),
  backBtn: $("#backBtn"),
  moreBtn: $("#moreBtn"),
  adminMark: $("#adminMark")
};

const CAT_COLOR = { images: "#38bdf8", videos: "#fb923c", audio: "#a78bfa", documents: "#60a5fa", archives: "#f472b6" };
const KIND_COLOR = { photo: "#38bdf8", video: "#fb923c", audio: "#a78bfa", voice: "#f472b6", document: "#60a5fa" };

/* ============================================================ helpers */
function displayName(u) {
  return [u.firstName, u.lastName].filter(Boolean).join(" ") || (u.username ? `@${u.username}` : `#${u.id}`);
}

function langName(code) {
  const found = (boot.languages || []).find(l => l.code === code);
  return found ? `${found.flag} ${found.name}` : code || "—";
}

function applyTheme() {
  const resolved = tg?.colorScheme || (window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark");
  document.documentElement.dataset.theme = resolved;
}

/* ============================================================ shell */
function renderTabs() {
  dom.tabs.innerHTML = "";
  for (const tab of TABS) {
    const btn = el(
      "button",
      { class: `admin-tab ${state.tab === tab.id ? "is-active" : ""}`, type: "button" },
      icon(tab.icon, { size: 16 }),
      el("span", { text: t(`admin.${tab.id}`) })
    );
    btn.addEventListener("click", () => setTab(tab.id));
    dom.tabs.append(btn);
  }
}

async function setTab(id) {
  state.tab = id;
  renderTabs();
  dom.main.innerHTML = "";
  dom.main.append(el("div", { class: "center-spinner" }, el("span", { class: "spinner spinner-lg" })));
  try {
    if (id === "dashboard") await renderDashboard();
    else if (id === "users") await renderUsers();
    else if (id === "files") await renderFiles();
    else if (id === "broadcast") await renderBroadcast();
    else if (id === "system") await renderSystem();
  } catch (e) {
    console.error(e);
    dom.main.innerHTML = "";
    dom.main.append(
      el("div", { class: "empty" },
        el("div", { class: "denied-art", html: icon("warning", { size: 34 }) }),
        el("h3", { class: "empty-title", text: t("empty.errorTitle") }),
        el("p", { class: "empty-text", text: e.message || t("toast.failed") }))
    );
  }
}

/* ============================================================ dashboard */
async function renderDashboard() {
  const data = await api.admin.overview();
  state.overview = data;
  dom.main.innerHTML = "";

  const stats = [
    { key: "statUsers", value: data.users, icon: "users", color: "var(--brand-400)" },
    { key: "statFiles", value: data.files, icon: "files", color: "var(--c-audio)" },
    { key: "statStorage", value: formatSize(data.size), icon: "cloud", color: "var(--c-videos)" },
    { key: "statActiveToday", value: data.activeToday, icon: "bolt", color: "var(--success)" },
    { key: "statNew7d", value: data.new7d, icon: "sparkles", color: "var(--warning)" },
    { key: "statAvgFiles", value: data.avg, icon: "chart", color: "var(--c-archives)" }
  ];

  const grid = el("div", { class: "stat-grid" });
  for (const s of stats) {
    grid.append(
      el("div", { class: "stat-card" },
        el("div", { class: "stat-label" }, icon(s.icon, { size: 14, style: `color:${s.color}` }), el("span", { text: t(`admin.${s.key}`) })),
        el("div", { class: "stat-value", text: String(s.value) })
      )
    );
  }
  dom.main.append(grid);

  /* charts */
  const chartRow = el("div", { class: "chart-row" });

  // donut: files by type
  const byKind = data.byKind || [];
  const totalKind = byKind.reduce((a, k) => a + k.count, 0) || 1;
  let acc = 0;
  const stops = byKind.map(k => {
    const from = (acc / totalKind) * 360;
    acc += k.count;
    const to = (acc / totalKind) * 360;
    const color = KIND_COLOR[k.kind] || CAT_COLOR[categoryOf("", k.kind)] || "#64748b";
    return `${color} ${from}deg ${to}deg`;
  });
  const donut = el("div", { class: "donut", style: { background: byKind.length ? `conic-gradient(${stops.join(", ")})` : "var(--surface-3)" } },
    el("div", { class: "donut-center" },
      el("b", { text: String(data.files || 0) }),
      el("span", { text: t("admin.statFiles") }))
  );
  const legend = el("div", { class: "legend" });
  if (!byKind.length) legend.append(el("div", { class: "muted small", text: t("admin.noData") }));
  for (const k of byKind) {
    legend.append(
      el("div", { class: "legend-item" },
        el("span", { class: "legend-dot", style: { background: KIND_COLOR[k.kind] || "#64748b" } }),
        el("span", { text: (k.kind || "document").toUpperCase() }),
        el("span", { class: "legend-value", text: `${k.count} · ${formatSize(k.size)}` }))
    );
  }
  chartRow.append(
    el("div", { class: "panel" },
      el("div", { class: "panel-head" }, el("div", { class: "panel-title", text: t("admin.chartByType") })),
      el("div", { class: "panel-body" }, el("div", { class: "donut-wrap" }, donut, legend)))
  );

  // bars: uploads per day
  const uploads = data.uploads || [];
  const maxUp = Math.max(1, ...uploads.map(u => u.count));
  const bars = el("div", { class: "bars" });
  for (const u of uploads) {
    bars.append(el("div", {
      class: "bar",
      style: { height: `${Math.max(3, (u.count / maxUp) * 100)}%` },
      "data-label": `${u._id} · ${u.count}`
    }));
  }
  chartRow.append(
    el("div", { class: "panel" },
      el("div", { class: "panel-head" }, el("div", { class: "panel-title", text: t("admin.chartUploads") })),
      el("div", { class: "panel-body" },
        uploads.length ? bars : el("div", { class: "muted small", text: t("admin.noData") }),
        el("div", { class: "bar-axis" },
          el("span", { text: uploads[0]?._id ? formatDate(uploads[0]._id, htmlLang(), { year: undefined }) : "" }),
          el("span", { text: uploads.at(-1)?._id ? formatDate(uploads.at(-1)._id, htmlLang(), { year: undefined }) : "" }))))
  );
  dom.main.append(chartRow);

  /* top users */
  const rows = (data.topUsers || []).map(u => el("tr", {},
    el("td", {}, el("div", { class: "cell-user" },
      avatarOf({ firstName: u.name, photoUrl: "" }, 28),
      el("div", {}, el("div", { class: "cell-strong", text: u.name }), el("div", { class: "small muted", text: u.username ? `@${u.username}` : "" })))),
    el("td", { class: "num", text: String(u.fileCount) }),
    el("td", { class: "num", text: formatSize(u.storageUsed) }),
    el("td", {}, el("button", { class: "icon-btn", "aria-label": t("admin.openInApp"), html: icon("external", { size: 16 }) }, ))
  ));
  for (const [i, tr] of rows.entries()) {
    const u = data.topUsers[i];
    tr.querySelector("button")?.addEventListener("click", () => openUser(u.id));
  }

  dom.main.append(
    el("div", { class: "panel" },
      el("div", { class: "panel-head" }, el("div", { class: "panel-title", text: t("admin.topUsers") })),
      el("div", { class: "panel-body", style: { padding: "0" } },
        el("div", { class: "table-wrap" },
          el("table", { class: "data" },
            el("thead", {}, el("tr", {},
              el("th", { text: t("admin.tableUser") }),
              el("th", { text: t("admin.tableFiles") }),
              el("th", { text: t("admin.tableStorage") }),
              el("th", {}))),
            el("tbody", {}, rows.length ? rows : el("tr", {}, el("td", { colspan: "4", class: "muted", text: t("admin.noData") })))))))
  );
}

/* ============================================================ users */
async function renderUsers() {
  const s = state.users;
  s.loading = true;
  const res = await api.admin.users({ q: s.q, limit: s.limit, skip: s.skip });
  s.items = res.items;
  s.total = res.total;
  s.loading = false;

  dom.main.innerHTML = "";
  const search = el("input", { class: "field", type: "search", placeholder: t("admin.searchUsers"), value: s.q });
  search.addEventListener("input", debounce(async e => {
    s.q = e.target.value.trim();
    s.skip = 0;
    await renderUsers();
    dom.main.querySelector("input[type=search]")?.focus();
  }, 350));

  dom.main.append(el("div", { class: "admin-toolbar" }, search));

  const rows = s.items.map(u => el("tr", {},
    el("td", {}, el("div", { class: "cell-user" },
      avatarOf(u, 30),
      el("div", {},
        el("div", { class: "cell-strong", text: displayName(u) }),
        el("div", { class: "small muted", text: u.username ? `@${u.username}` : `#${u.id}` })))),
    el("td", { class: "num", text: String(u.fileCount || 0) }),
    el("td", { class: "num", text: formatSize(u.storageUsed) }),
    el("td", { text: langName(u.language) }),
    el("td", { class: "num", text: formatDate(u.startedAt, htmlLang()) }),
    el("td", { class: "num", text: u.lastActiveAt ? formatRelative(u.lastActiveAt, htmlLang()) : "—" }),
    el("td", {}, el("div", { class: "cell-actions" },
      el("button", { class: "icon-btn", "aria-label": t("admin.userDetail"), html: icon("eye", { size: 16 }) }),
      el("button", { class: "icon-btn", "aria-label": t("action.more"), html: icon("more", { size: 16 }) })))
  ));

  rows.forEach((tr, i) => {
    const u = s.items[i];
    const [view, more] = tr.querySelectorAll(".cell-actions button");
    view.addEventListener("click", () => openUser(u.id));
    more.addEventListener("click", e => {
      const rect = e.currentTarget.getBoundingClientRect();
      contextMenu([
        { icon: "trash", label: t("admin.deleteUserFiles"), danger: true, onSelect: () => deleteUserFiles(u) },
        { icon: "external", label: t("admin.openInApp"), onSelect: () => openUser(u.id) }
      ], rect.left - 170, rect.bottom + 6);
    });
  });

  dom.main.append(
    el("div", { class: "panel" },
      el("div", { class: "panel-head" },
        el("div", { class: "panel-title", text: t("admin.users") }),
        el("span", { class: "small muted", text: `${s.total}` })),
      el("div", { class: "panel-body", style: { padding: "0" } },
        el("div", { class: "table-wrap" },
          el("table", { class: "data" },
            el("thead", {}, el("tr", {},
              el("th", { text: t("admin.tableUser") }),
              el("th", { text: t("admin.tableFiles") }),
              el("th", { text: t("admin.tableStorage") }),
              el("th", { text: t("admin.tableLanguage") }),
              el("th", { text: t("admin.tableJoined") }),
              el("th", { text: t("admin.tableActive") }),
              el("th", {}))),
            el("tbody", {}, rows.length ? rows : el("tr", {}, el("td", { colspan: "7", class: "muted", style: { padding: "18px" }, text: t("admin.noUsers") })))))))
  );

  dom.main.append(pager(s, renderUsers));
}

function pager(s, reload) {
  const prev = el("button", { class: "btn btn-sm" }, icon("back", { size: 15 }), el("span", { text: t("action.previous") }));
  const next = el("button", { class: "btn btn-sm" }, el("span", { text: t("action.next") }), icon("chevronRight", { size: 15 }));
  prev.disabled = s.skip <= 0;
  next.disabled = s.skip + s.items.length >= s.total;
  prev.addEventListener("click", async () => {
    s.skip = Math.max(0, s.skip - s.limit);
    await reload();
  });
  next.addEventListener("click", async () => {
    s.skip += s.limit;
    await reload();
  });
  return el("div", { class: "pager" }, prev,
    el("span", { class: "pager-info", text: `${s.skip + 1}–${s.skip + s.items.length} / ${s.total}` }),
    next);
}

async function openUser(id) {
  const res = await api.admin.user(id);
  const u = res.user;
  const body = el("div", {},
    el("div", { class: "row", style: { gap: "12px", marginBottom: "14px" } },
      avatarOf(u, 48),
      el("div", {}, el("div", { style: { fontWeight: "700", fontSize: "16px" }, text: displayName(u) }),
        el("div", { class: "small muted", text: u.username ? `@${u.username}` : `#${u.id}` }))),
    el("div", { class: "kv" },
      kv(t("admin.tableFiles"), String(u.fileCount || 0)),
      kv(t("admin.tableStorage"), formatSize(u.storageUsed)),
      kv(t("admin.tableLanguage"), langName(u.language)),
      kv(t("admin.tableJoined"), formatDate(u.startedAt, htmlLang())),
      kv(t("admin.tableActive"), u.lastActiveAt ? formatDateTime(u.lastActiveAt, htmlLang()) : "—"),
      kv(t("settings.notifications"), u.settings?.notifications ? t("common.on") : t("common.off"))
    ),
    res.files?.length
      ? el("div", { class: "setting-section", text: t("admin.userFiles") })
      : null,
    res.files?.length
      ? el("div", { class: "ap-playlist" }, res.files.map(f => el("div", { class: "ap-pl-item" },
          icon(iconFor(f), { size: 15 }),
          el("span", { class: "truncate", text: f.fileName }),
          el("span", { class: "ap-pl-size", text: formatSize(f.fileSize) }))))
      : null
  );
  const footer = el("div", { class: "confirm-actions" },
    el("button", { class: "btn btn-ghost", text: t("action.close") }),
    el("button", { class: "btn btn-danger" }, icon("trash", { size: 15 }), el("span", { text: t("admin.deleteUserFiles") }))
  );
  const dialog = sheet({ title: t("admin.userDetail"), body, footer, size: "md" });
  footer.children[0].addEventListener("click", () => dialog.close());
  footer.children[1].addEventListener("click", async () => {
    dialog.close();
    await deleteUserFiles(u);
  });
}

function kv(key, value) {
  return el("div", { class: "kv-item" }, el("span", { class: "kv-key", text: key }), el("span", { class: "kv-val", text: value }));
}

async function deleteUserFiles(u) {
  const ok = await confirm({
    title: t("admin.deleteUserFiles"),
    text: displayName(u),
    confirmText: t("action.delete"),
    danger: true,
    icon: "trash"
  });
  if (!ok) return;
  try {
    const res = await api.admin.deleteUserFiles(u.id);
    toast(`${t("toast.deletedForever")} · ${res.deleted}`, "success");
    if (state.tab === "users") renderUsers();
    else setTab("dashboard");
  } catch (e) {
    toast(e.message, "error");
  }
}

/* ============================================================ files */
async function renderFiles() {
  const s = state.files;
  const res = await api.admin.files({ q: s.q, kind: s.kind, limit: s.limit, skip: s.skip });
  s.items = res.items;
  s.total = res.total;

  dom.main.innerHTML = "";
  const search = el("input", { class: "field", type: "search", placeholder: t("admin.searchFiles"), value: s.q });
  search.addEventListener("input", debounce(async e => {
    s.q = e.target.value.trim();
    s.skip = 0;
    await renderFiles();
    dom.main.querySelector("input[type=search]")?.focus();
  }, 350));

  const kindSelect = el("select", { class: "field", style: { width: "auto", minWidth: "150px" } });
  kindSelect.append(el("option", { value: "", text: t("admin.allKinds") }));
  for (const k of ["photo", "video", "audio", "voice", "document"]) {
    kindSelect.append(el("option", { value: k, text: k.toUpperCase() }));
  }
  kindSelect.value = s.kind;
  kindSelect.addEventListener("change", async () => {
    s.kind = kindSelect.value;
    s.skip = 0;
    await renderFiles();
  });

  dom.main.append(el("div", { class: "admin-toolbar" }, search, kindSelect));

  const rows = s.items.map(f => el("tr", {},
    el("td", {}, el("div", { class: "cell-user" },
      el("span", { style: { width: "30px", height: "30px", borderRadius: "8px", display: "grid", placeItems: "center", background: `var(--c-${categoryOf(f.fileName, f.kind)}-soft)`, color: CAT_COLOR[categoryOf(f.fileName, f.kind)] }, html: icon(iconFor(f), { size: 15 }) }),
      el("div", { style: { minWidth: "0" } },
        el("div", { class: "cell-strong truncate", style: { maxWidth: "260px" }, text: f.fileName || "—", title: f.fileName }),
        el("div", { class: "small muted", text: f.ownerName || f.ownerId })))),
    el("td", { class: "num", text: formatSize(f.fileSize) }),
    el("td", { text: (f.kind || "—").toUpperCase() }),
    el("td", { class: "num", text: formatDate(f.createdAt, htmlLang()) }),
    el("td", {}, el("div", { class: "cell-actions" },
      el("button", { class: "icon-btn", "aria-label": t("action.delete"), html: icon("trash", { size: 16 }) })))
  ));

  rows.forEach((tr, i) => {
    const f = s.items[i];
    tr.querySelector("button")?.addEventListener("click", async () => {
      const ok = await confirm({
        title: t("confirm.deleteForeverTitle"),
        text: f.fileName,
        confirmText: t("action.delete"),
        danger: true,
        icon: "trash"
      });
      if (!ok) return;
      try {
        await api.admin.deleteFile(f.id);
        toast(t("toast.deletedForever"), "success");
        renderFiles();
      } catch (e) {
        toast(e.message, "error");
      }
    });
  });

  dom.main.append(
    el("div", { class: "panel" },
      el("div", { class: "panel-head" },
        el("div", { class: "panel-title", text: t("admin.files") }),
        el("span", { class: "small muted", text: `${s.total}` })),
      el("div", { class: "panel-body", style: { padding: "0" } },
        el("div", { class: "table-wrap" },
          el("table", { class: "data" },
            el("thead", {}, el("tr", {},
              el("th", { text: t("admin.tableName") }),
              el("th", { text: t("admin.tableSize") }),
              el("th", { text: t("admin.tableType") }),
              el("th", { text: t("admin.tableCreated") }),
              el("th", {}))),
            el("tbody", {}, rows.length ? rows : el("tr", {}, el("td", { colspan: "5", class: "muted", style: { padding: "18px" }, text: t("admin.noFiles") })))))))
  );
  dom.main.append(pager(s, renderFiles));
}

/* ============================================================ broadcast */
async function renderBroadcast() {
  const historyRes = await api.admin.broadcasts().catch(() => ({ items: [] }));
  state.history = historyRes.items || [];
  dom.main.innerHTML = "";

  const textarea = el("textarea", { class: "field bc-editor", placeholder: t("admin.broadcastPlaceholder") });
  const status = el("div", { class: "bc-progress hidden" });
  const sendBtn = el("button", { class: "btn btn-primary" }, icon("broadcast", { size: 16 }), el("span", { text: t("admin.broadcastSend") }));

  dom.main.append(
    el("div", { class: "panel" },
      el("div", { class: "panel-head" }, el("div", { class: "panel-title", text: t("admin.broadcastTitle") })),
      el("div", { class: "panel-body" },
        textarea,
        el("div", { class: "row", style: { marginTop: "12px" } }, sendBtn),
        status))
  );

  sendBtn.addEventListener("click", async () => {
    const text = textarea.value.trim();
    if (!text) return toast(t("admin.broadcastEmpty"), "warning");
    if (!boot.telegram) {
      toast(t("header.demo"), "info");
      return;
    }
    const ok = await confirm({
      title: t("admin.broadcastConfirmTitle"),
      text: t("admin.broadcastConfirmText", { count: state.overview?.users || "?" }),
      confirmText: t("admin.broadcastSend"),
      icon: "broadcast"
    });
    if (!ok) return;
    sendBtn.disabled = true;
    status.classList.remove("hidden");
    status.innerHTML = `<div class="progress-bar"><span style="width:0%"></span></div><div class="small muted" style="margin-top:6px">${t("state.sending")}</div>`;
    try {
      const res = await api.admin.broadcast(text);
      if (!res.jobId) {
        toast(t("toast.sent"), "success");
        return;
      }
      await pollJob(res.jobId, status);
    } catch (e) {
      toast(e.message, "error");
    } finally {
      sendBtn.disabled = false;
    }
  });

  const history = el("div", { class: "bc-history" });
  if (!state.history.length) {
    history.append(el("div", { class: "muted small", text: t("admin.broadcastNoHistory") }));
  }
  for (const item of state.history) {
    history.append(
      el("div", { class: "bc-item" },
        el("div", { class: "bc-item-head" },
          el("span", { text: formatDateTime(item.startedAt, htmlLang()) }),
          el("span", {}, icon("check", { size: 13, style: "color:var(--success)" }), ` ${item.sent}`),
          el("span", {}, icon("close", { size: 13, style: "color:var(--danger)" }), ` ${item.failed}`),
          el("span", {}, icon("block", { size: 13, style: "color:var(--warning)" }), ` ${item.blocked}`),
          el("span", { text: t("admin.broadcastBy", { name: item.by || "admin" }) })),
        el("div", { class: "bc-item-text", text: item.text })
      )
    );
  }
  dom.main.append(
    el("div", { class: "panel" },
      el("div", { class: "panel-head" }, el("div", { class: "panel-title", text: t("admin.broadcastHistory") })),
      el("div", { class: "panel-body" }, history))
  );
}

async function pollJob(jobId, statusNode) {
  for (let i = 0; i < 600; i++) {
    const job = await api.admin.broadcastStatus(jobId);
    const pct = job.total ? Math.round(((job.sent + job.failed + job.blocked) / job.total) * 100) : 0;
    statusNode.innerHTML = `
      <div class="progress-bar"><span style="width:${pct}%"></span></div>
      <div class="small muted" style="margin-top:6px">${t("admin.broadcastProgress", { sent: job.sent, total: job.total })}</div>`;
    if (job.status !== "running") {
      statusNode.innerHTML += `<div class="small" style="margin-top:6px">${t("admin.broadcastDone", { sent: job.sent, failed: job.failed })}</div>`;
      toast(t("admin.broadcastDone", { sent: job.sent, failed: job.failed }), job.failed ? "warning" : "success", 4000);
      renderBroadcast();
      return;
    }
    await new Promise(r => setTimeout(r, 700));
  }
}

/* ============================================================ system */
async function renderSystem() {
  const res = await api.admin.system();
  const s = res.system;
  state.system = s;
  dom.main.innerHTML = "";

  const items = [
    ["bolt", t("admin.sysVersion"), `v${s.version} · ${s.build}`],
    ["server", t("admin.sysNode"), s.node],
    ["clock", t("admin.sysUptime"), s.uptime],
    ["chart", t("admin.sysMemory"), `${s.memoryMb} MB`],
    ["cloud", t("admin.sysDatabase"), s.database],
    ["info", t("admin.sysEnv"), s.env],
    ["broom", t("admin.sysCache"), String(s.cacheEntries)],
    ["shield", t("admin.sysRateLimit"), String(s.rateLimitEntries)]
  ];
  const grid = el("div", { class: "kv" }, items.map(([ic, k, v]) =>
    el("div", { class: "kv-item" },
      el("span", { class: "kv-key" }, icon(ic, { size: 14 }), el("span", { text: k })),
      el("span", { class: "kv-val", text: v }))
  ));

  dom.main.append(
    el("div", { class: "panel" },
      el("div", { class: "panel-head" }, el("div", { class: "panel-title", text: t("admin.systemTitle") })),
      el("div", { class: "panel-body" }, grid))
  );

  const cacheBtn = el("button", { class: "btn" }, icon("broom", { size: 15 }), el("span", { text: t("admin.sysClearCache") }));
  const cleanBtn = el("button", { class: "btn btn-danger" }, icon("trash", { size: 15 }), el("span", { text: t("admin.sysCleanup") }));
  cacheBtn.addEventListener("click", async () => {
    const res2 = await api.admin.clearCache();
    toast(t("settings.cacheCleared"), "success");
    void res2;
    renderSystem();
  });
  cleanBtn.addEventListener("click", async () => {
    const ok = await confirm({ title: t("admin.sysCleanup"), confirmText: t("admin.sysCleanup"), danger: true, icon: "trash" });
    if (!ok) return;
    const res2 = await api.admin.cleanup();
    toast(t("admin.sysCleanupDone", { count: res2.deleted }), "success");
  });

  dom.main.append(el("div", { class: "admin-toolbar" }, cacheBtn, cleanBtn));

  if (s.caches?.length) {
    const rows = s.caches.map(c => el("tr", {},
      el("td", { text: c.name }),
      el("td", { class: "num", text: String(c.size) }),
      el("td", { class: "num", text: String(c.hits) }),
      el("td", { class: "num", text: `${c.hitRate}%` })
    ));
    dom.main.append(
      el("div", { class: "panel" },
        el("div", { class: "panel-head" }, el("div", { class: "panel-title", text: t("admin.sysCache") })),
        el("div", { class: "panel-body", style: { padding: "0" } },
          el("div", { class: "table-wrap" },
            el("table", { class: "data" },
              el("thead", {}, el("tr", {},
                el("th", { text: "Cache" }),
                el("th", { text: "Entries" }),
                el("th", { text: "Hits" }),
                el("th", { text: "Hit rate" }))),
              el("tbody", {}, rows)))))
    );
  }
}

/* ============================================================ boot */
function showDenied() {
  dom.main.innerHTML = "";
  dom.main.append(
    el("div", { class: "denied" },
      el("div", { class: "denied-art", html: icon("lock", { size: 36 }) }),
      el("h2", { style: { fontSize: "19px", fontWeight: "800" }, text: t("admin.denied") }),
      el("p", { class: "muted", style: { maxWidth: "360px", marginTop: "6px" }, text: t("admin.deniedText") }),
      el("a", { class: "btn btn-primary", href: "/app", style: { marginTop: "16px" } }, icon("cloud", { size: 16 }), el("span", { text: t("admin.backToApp") })))
  );
  dom.tabs.classList.add("hidden");
}

function bindEvents() {
  dom.refreshBtn.addEventListener("click", () => {
    haptic("light");
    setTab(state.tab);
  });
  dom.backBtn.addEventListener("click", () => {
    window.location.href = "/app";
  });
  dom.moreBtn.addEventListener("click", e => {
    const rect = e.currentTarget.getBoundingClientRect();
    contextMenu([
      { icon: "globe", label: t("action.language"), onSelect: openLanguageSheet },
      { icon: "expand", label: t("action.fullscreen"), onSelect: () => document.documentElement.requestFullscreen?.() },
      { icon: "cloud", label: t("admin.backToApp"), onSelect: () => (window.location.href = "/app") }
    ], rect.left - 180, rect.bottom + 6);
  });
}

function openLanguageSheet() {
  const grid = el("div", { class: "lang-grid" });
  for (const l of boot.languages || []) {
    const item = el("button", { class: `lang-item ${l.code === lang() ? "is-active" : ""}`, type: "button" },
      el("span", { class: "lang-flag", text: l.flag }),
      el("span", { text: l.name }));
    item.addEventListener("click", async () => {
      await loadLanguage(l.code);
      applyStatic();
      dialog.close();
      setTab(state.tab);
      renderTabs();
    });
    grid.append(item);
  }
  const dialog = sheet({ title: t("action.language"), body: grid });
}

async function main() {
  dom.adminMark.innerHTML = icon("crown", { size: 20 });
  dom.refreshBtn.innerHTML = icon("refresh", { size: 19 });
  dom.backBtn.innerHTML = icon("cloud", { size: 19 });
  dom.moreBtn.innerHTML = icon("more", { size: 19 });

  applyTheme();
  if (tg) {
    try {
      tg.ready();
      tg.expand();
    } catch { /* ignore */ }
  }

  await loadLanguage(guessLanguage(), { silent: true });
  applyStatic();
  renderTabs();
  bindEvents();

  try {
    const me = await api.me();
    state.me = me.user;
    if (!me.isAdmin) return showDenied();
  } catch (e) {
    console.error(e);
    if (e.status === 401 || e.code === "NOT_AUTHENTICATED") return showDenied();
    return showDenied();
  }

  await setTab("dashboard");
}

main().catch(err => {
  console.error("[admin]", err);
  dom.main.innerHTML = "";
  dom.main.append(
    el("div", { class: "empty" },
      el("div", { class: "denied-art", html: icon("warning", { size: 34 }) }),
      el("h3", { class: "empty-title", text: t("empty.errorTitle") }),
      el("p", { class: "empty-text", text: err.message || t("toast.failed") }))
  );
});
