import {
  $, $$, el, escapeHtml, debounce, throttle, formatSize, formatDate, formatRelative,
  iconFor, colorFor, colorSoftFor, isImage, isVideo, isAudio, isPreviewable, isHeic,
  store, haptic, observeLazy, extOf, clamp
} from "./core.js";
import { t, loadLanguage, applyStatic, bootConfig, languages, guessLanguage, rememberLanguage, lang, htmlLang, onChange as onLangChange } from "./i18n.js";
import { icon } from "./icons.js";
import { api, mediaLink, downloadMedia, clearMediaLinks } from "./api.js";
import {
  toast, sheet, confirm, contextMenu, closeContextMenu, emptyState,
  skeletonGrid, skeletonRows, switchRow, segmented, avatarOf, inlineLoader
} from "./ui.js";
import { openPreview } from "./media.js";

const tg = window.Telegram?.WebApp;
const boot = bootConfig();

const state = {
  user: null,
  stats: { files: 0, size: 0 },
  counts: {},
  isAdmin: false,
  view: "all",
  sort: store.get("sort", "newest"),
  mode: store.get("mode", "grid"),
  density: store.get("density", "comfortable"),
  search: "",
  files: [],
  total: 0,
  limit: 48,
  loading: false,
  hasMore: true,
  selected: new Set(),
  selectionMode: false,
  ready: false,
  authExpired: false,
  theme: store.get("theme", "auto"),
  desktopMode: store.get("desktopMode", null),
  autoFullscreen: store.get("autoFullscreen", true),
  autoThumbnails: store.get("autoThumbnails", true),
  lastScroll: 0
};

const VIEWS = [
  { id: "all", icon: "files", label: "nav.all", countKey: "all" },
  { id: "images", icon: "image", label: "nav.images", countKey: "images" },
  { id: "videos", icon: "video", label: "nav.videos", countKey: "videos" },
  { id: "audio", icon: "audio", label: "nav.audio", countKey: "audio" },
  { id: "documents", icon: "file", label: "nav.documents", countKey: "documents" },
  { id: "archives", icon: "archive", label: "nav.archives", countKey: "archives" },
  { id: "favorites", icon: "star", label: "nav.favorites", countKey: "favorites" },
  { id: "trash", icon: "trash", label: "nav.trash", countKey: "trash" },
  { id: "settings", icon: "settings", label: "nav.settings", section: true },
  { id: "admin", icon: "crown", label: "nav.admin", section: true, adminOnly: true }
];

const SORTS = ["newest", "oldest", "nameAsc", "nameDesc", "largest", "smallest"];
const TABS = ["all", "images", "favorites", "settings"];

const dom = {
  app: $("#app"),
  sidebar: $("#sidebar"),
  navList: $("#navList"),
  storageCard: $("#storageCard"),
  userCard: $("#userCard"),
  menuBtn: $("#menuBtn"),
  sidebarClose: $("#sidebarClose"),
  viewTitle: $("#viewTitle"),
  searchInput: $("#searchInput"),
  searchClear: $("#searchClear"),
  searchIcon: $("#searchIcon"),
  refreshBtn: $("#refreshBtn"),
  viewBtn: $("#viewBtn"),
  fullscreenBtn: $("#fullscreenBtn"),
  moreBtn: $("#moreBtn"),
  chips: $("#chips"),
  toolbar: $("#toolbar"),
  toolbarActions: $("#toolbarActions"),
  resultCount: $("#resultCount"),
  content: $("#content"),
  tabbar: $("#tabbar"),
  fab: $("#fab"),
  brandMark: $("#brandMark")
};

function resolveTheme(mode) {
  if (mode && mode !== "auto") return mode;
  const tgTheme = tg?.colorScheme;
  if (tgTheme === "dark" || tgTheme === "light") return tgTheme;
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function applyTheme(mode = state.theme) {
  state.theme = mode;
  const resolved = resolveTheme(mode);
  document.documentElement.dataset.theme = resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", resolved === "light" ? "#f4f6fb" : "#0b1020");
  if (tg?.themeParams) {
    const root = document.documentElement.style;
    const p = tg.themeParams;
    if (p.bg_color) root.setProperty("--bg", p.bg_color);
    if (p.secondary_bg_color) root.setProperty("--surface", p.secondary_bg_color);
    if (p.text_color) root.setProperty("--text", p.text_color);
    if (p.hint_color) root.setProperty("--text-3", p.hint_color);
    if (p.button_color) root.setProperty("--brand-500", p.button_color);
    if (p.button_text_color) root.setProperty("--brand-contrast", p.button_text_color);
  }
  if (tg) {
    try {
      tg.setHeaderColor?.(resolved === "light" ? "#f4f6fb" : "#0b1020");
      tg.setBackgroundColor?.(resolved === "light" ? "#f4f6fb" : "#0b1020");
    } catch {}
  }
  store.set("theme", mode);
}

function toggleTheme() {
  const order = ["auto", "light", "dark"];
  const next = order[(order.indexOf(state.theme) + 1) % order.length];
  applyTheme(next);
  toast(`${t("action.theme")}: ${t(`settings.theme${next[0].toUpperCase()}${next.slice(1)}`)}`);
  syncUserSettings({ theme: next });
}

function isDesktopViewport() {
  return window.innerWidth >= 900;
}

function isDesktopMode() {
  return state.desktopMode === null ? isDesktopViewport() : !!state.desktopMode;
}

function applyDesktopMode() {
  const on = isDesktopMode();
  document.body.classList.toggle("is-desktop", on);
  dom.sidebar.classList.toggle("is-open", on && isDesktopViewport());
}

async function requestFullscreen({ silent = false } = {}) {
  try {
    if (tg?.requestFullscreen) { tg.requestFullscreen(); return true; }
    const target = document.documentElement;
    if (!document.fullscreenElement) {
      await target.requestFullscreen?.({ navigationUI: "hide" });
      return true;
    }
  } catch (e) {
    if (!silent) toast(t("toast.fullscreenBlocked"), "info", 3200);
  }
  return false;
}

function exitFullscreen() {
  try {
    if (document.fullscreenElement) document.exitFullscreen?.();
    tg?.exitFullscreen?.();
  } catch {}
}

function isFullscreen() {
  return Boolean(document.fullscreenElement || tg?.isFullscreen);
}

let autoFsArmed = false;
function setupAutoFullscreen() {
  if (!state.autoFullscreen || !isDesktopMode() || autoFsArmed) return;
  autoFsArmed = true;
  const cleanup = () => {
    window.removeEventListener("pointerdown", handler);
    window.removeEventListener("keydown", handler);
    window.removeEventListener("touchstart", handler);
  };
  const handler = async () => {
    const ok = await requestFullscreen({ silent: true });
    if (ok) cleanup();
  };
  requestFullscreen({ silent: true }).then(ok => {
    if (ok) return cleanup();
    window.addEventListener("pointerdown", handler, { once: true });
    window.addEventListener("keydown", handler, { once: true });
    window.addEventListener("touchstart", handler, { once: true });
  });
}

function initTelegram() {
  if (!tg) return;
  try {
    tg.ready();
    tg.expand();
    tg.enableClosingConfirmation?.();
    tg.disableVerticalSwipes?.();
    store.del("initData");
    tg.onEvent?.("themeChanged", () => applyTheme(state.theme));
    tg.onEvent?.("viewportChanged", () => applyDesktopMode());
    tg.BackButton?.onClick?.(() => {
      if (state.selectionMode) return exitSelection();
      if (dom.sidebar.classList.contains("is-open") && !isDesktopViewport()) return closeDrawer();
      if (state.view !== "all") return setView("all");
      tg.close();
    });
  } catch (e) {
    console.warn("[tg]", e);
  }
}

const viewMeta = id => VIEWS.find(v => v.id === id) || VIEWS[0];

function renderNav() {
  dom.navList.innerHTML = "";
  let lastSection = false;
  for (const view of VIEWS) {
    if (view.adminOnly && !state.isAdmin) continue;
    if (view.section && !lastSection) {
      dom.navList.append(el("div", { class: "nav-group", text: t("nav.sectionMore") }));
      lastSection = true;
    }
    const count = state.counts[view.countKey];
    const btn = el(
      "button",
      { class: `nav-item ${state.view === view.id ? "is-active" : ""}`, type: "button" },
      icon(view.icon, { size: 19 }),
      el("span", { class: "truncate", text: t(view.label) }),
      count ? el("span", { class: "nav-count", text: String(count) }) : null
    );
    btn.addEventListener("click", () => setView(view.id));
    dom.navList.append(btn);
  }
}

function renderChips() {
  dom.chips.innerHTML = "";
  for (const view of VIEWS) {
    if (view.section || (view.adminOnly && !state.isAdmin)) continue;
    const count = state.counts[view.countKey];
    const chip = el(
      "button",
      { class: `chip ${state.view === view.id ? "is-active" : ""}`, type: "button" },
      icon(view.icon, { size: 15 }),
      el("span", { text: t(view.label) }),
      count ? el("span", { class: "badge", text: String(count) }) : null
    );
    chip.addEventListener("click", () => setView(view.id));
    dom.chips.append(chip);
  }
}

function renderTabs() {
  dom.tabbar.innerHTML = "";
  const items = [...TABS];
  if (state.isAdmin) items.splice(3, 0, "admin");
  for (const id of items) {
    const view = viewMeta(id);
    const btn = el(
      "button",
      { class: `tab-item ${state.view === id ? "is-active" : ""}`, type: "button" },
      icon(view.icon, { size: 21 }),
      el("span", { text: t(view.label) })
    );
    btn.addEventListener("click", () => setView(id));
    dom.tabbar.append(btn);
  }
}

function setView(id, { scrollTop = true } = {}) {
  if (state.view === id) {
    if (id !== "settings") refreshFiles();
    return;
  }
  ++fileRequest;
  state.loading = false;
  state.view = id;
  state.files = [];
  state.skip = 0;
  state.hasMore = true;
  exitSelection(true);
  closeDrawer();
  dom.viewTitle.textContent = t(viewMeta(id).label);
  document.title = t(viewMeta(id).label);
  renderNav();
  renderChips();
  renderTabs();
  renderToolbar();
  if (tg?.BackButton) {
    if (id === "all") tg.BackButton.hide();
    else tg.BackButton.show();
  }
  if (id === "settings") renderSettings();
  else if (id === "admin") {
    window.location.href = "/admin";
    return;
  } else refreshFiles();
  if (scrollTop) window.scrollTo({ top: 0 });
}

function openDrawer() {
  dom.sidebar.classList.add("is-open");
  if ($("#drawerBackdrop")) return;
  const backdrop = el("div", { class: "backdrop", id: "drawerBackdrop" });
  document.body.append(backdrop);
  requestAnimationFrame(() => backdrop.classList.add("is-open"));
  backdrop.addEventListener("click", closeDrawer);
}

function closeDrawer() {
  dom.sidebar.classList.remove("is-open");
  $("#drawerBackdrop")?.remove();
}

async function loadMe() {
  if (state.authExpired) return false;
  try {
    const me = await api.me();
    state.user = me.user;
    state.stats = me.stats || { files: 0, size: 0 };
    state.isAdmin = !!me.isAdmin;
    applyUser();
    if (me.user?.language && me.user.language !== lang()) {
      await loadLanguage(me.user.language);
      renderAll();
    }
    return true;
  } catch (e) {
    console.error("[me]", e);
    if (isAuthenticationError(e)) showAuthenticationRequired(e);
    else showFatal(e);
    return false;
  }
}

async function loadCounts() {
  if (state.authExpired) return;
  try {
    const res = await api.counts();
    state.counts = res.counts || {};
    renderNav();
    renderChips();
  } catch {}
}

function applyUser() {
  const u = state.user || {};
  const name = [u.firstName, u.lastName].filter(Boolean).join(" ") || u.username || t("header.guest");
  dom.userCard.innerHTML = "";
  dom.userCard.append(
    avatarOf(u, 34),
    el(
      "div",
      { class: "grow" },
      el("div", { class: "who truncate", text: name }),
      el("div", { class: "sub truncate", text: u.username ? `@${u.username}` : (boot.demo ? t("header.demo") : t("header.connected")) })
    )
  );
  const used = state.stats?.size || 0;
  const files = state.stats?.files || 0;
  dom.storageCard.innerHTML = "";
  dom.storageCard.append(
    el(
      "div",
      { class: "row-between" },
      el("span", { class: "small", text: t("settings.storageUsed") }),
      el("span", { class: "small", style: { fontWeight: "700" }, text: formatSize(used) })
    ),
    el("div", { class: "row-between", style: { marginTop: "8px" } },
      el("span", { class: "small muted", text: t("stats.files") + ": " + files }),
      state.isAdmin ? el("span", { class: "tag", text: "Admin" }) : null
    )
  );
}

function isAuthenticationError(error) {
  return error?.status === 401 || ["NO_INIT_DATA", "INIT_DATA_EXPIRED", "BAD_INIT_DATA", "NOT_AUTHENTICATED"].includes(error?.code);
}

function reopenTelegramSession() {
  try {
    if (tg?.close) { tg.close(); return; }
  } catch {}
  const username = String(boot.botUsername || "").replace(/^@/, "").trim();
  if (username) {
    const url = `https://t.me/${username}`;
    try {
      if (tg?.openTelegramLink) { tg.openTelegramLink(url); return; }
    } catch {}
    window.location.assign(url);
    return;
  }
  window.location.reload();
}

function showAuthenticationRequired(error) {
  if (state.authExpired) return;
  state.authExpired = true;
  state.ready = false;
  state.loading = false;
  fileRequest++;
  closeContextMenu();
  closeDrawer();

  const expired = error?.code === "INIT_DATA_EXPIRED";
  const hasTelegram = Boolean(tg?.close);
  const canOpenBot = Boolean(String(boot.botUsername || "").trim());
  const buttonLabel = hasTelegram
    ? t("session.closeAndReopen")
    : canOpenBot
      ? t("action.openBot")
      : t("action.retry");
  const action = el(
    "button",
    { class: "btn btn-primary", style: { marginTop: "14px" }, type: "button" },
    icon(hasTelegram ? "logout" : (canOpenBot ? "external" : "refresh"), { size: 16 }),
    el("span", { text: buttonLabel })
  );
  action.addEventListener("click", reopenTelegramSession);

  dom.content.innerHTML = "";
  dom.content.append(
    emptyState({
      iconName: "warning",
      title: t(expired ? "session.expiredTitle" : "session.requiredTitle"),
      text: t(expired ? "session.expiredText" : "session.requiredText"),
      action
    })
  );
}

function showFatal(error) {
  const demo = boot.demo;
  dom.content.innerHTML = "";
  dom.content.append(
    emptyState({
      iconName: demo ? "cloud" : "warning",
      title: demo ? t("header.demo") : t("empty.errorTitle"),
      text: demo ? t("empty.text") : `${error?.message || t("toast.failed")}`,
      action: el(
        "button",
        { class: "btn btn-primary", style: { marginTop: "14px" } },
        icon("refresh", { size: 16 }),
        el("span", { text: t("action.retry") })
      )
    })
  );
  dom.content.querySelector(".btn")?.addEventListener("click", () => window.location.reload());
}

let fileRequest = 0;
async function refreshFiles({ reset = true } = {}) {
  if (state.authExpired || state.view === "settings" || state.view === "admin") return;
  const requestId = ++fileRequest;
  let failed = false;
  if (reset) {
    state.skip = 0;
    state.files = [];
    state.hasMore = true;
  }
  state.loading = true;
  renderContent();
  try {
    const res = await api.files({
      category: ["all", "favorites", "trash"].includes(state.view) ? "" : state.view,
      favorite: state.view === "favorites" ? "true" : "",
      trash: state.view === "trash" ? "true" : "false",
      sort: state.sort,
      q: state.search,
      limit: state.limit,
      skip: state.skip
    });
    if (requestId !== fileRequest) return;
    state.files = reset ? res.items : [...state.files, ...res.items];
    state.total = res.total;
    state.hasMore = res.hasMore;
    state.skip = state.files.length;
    renderToolbarCounts();
  } catch (e) {
    if (requestId !== fileRequest) return;
    failed = true;
    console.error("[files]", e);
    if (isAuthenticationError(e)) showAuthenticationRequired(e);
    else if (state.files.length === 0) showFatal(e);
    else toast(e.message || t("toast.failed"), "error");
  } finally {
    if (requestId === fileRequest) {
      state.loading = false;
      if (!failed) renderContent();
    }
  }
}

async function loadMore() {
  if (state.authExpired || state.loading || !state.hasMore || state.view === "settings") return;
  const requestId = fileRequest;
  state.loading = true;
  renderLoadMore();
  try {
    const res = await api.files({
      category: ["all", "favorites", "trash"].includes(state.view) ? "" : state.view,
      favorite: state.view === "favorites" ? "true" : "",
      trash: state.view === "trash" ? "true" : "false",
      sort: state.sort,
      q: state.search,
      limit: state.limit,
      skip: state.skip
    });
    if (requestId !== fileRequest) return;
    state.files = [...state.files, ...res.items];
    state.total = res.total;
    state.hasMore = res.hasMore;
    state.skip = state.files.length;
  } catch (e) {
    if (requestId !== fileRequest) return;
    if (isAuthenticationError(e)) showAuthenticationRequired(e);
    else toast(e.message || t("toast.failed"), "error");
  } finally {
    if (requestId === fileRequest) {
      state.loading = false;
      renderContent();
    }
  }
}

function renderContent() {
  if (state.view === "settings") return renderSettings();
  dom.content.innerHTML = "";

  if (state.loading && !state.files.length) {
    dom.content.append(state.mode === "grid" ? skeletonGrid(12) : skeletonRows(10));
    return;
  }
  if (!state.files.length) {
    renderEmptyState();
    return;
  }

  const list = state.mode === "grid"
    ? el("div", { class: `files-grid ${state.density === "compact" ? "is-compact" : ""}` })
    : el("div", { class: "files-list" });

  for (const file of state.files) {
    list.append(state.mode === "grid" ? fileCard(file) : fileRow(file));
  }
  dom.content.append(list);
  observeLazy(dom.content);
  renderLoadMore();
}

function renderEmptyState() {
  const iconName = { images: "image", videos: "video", audio: "audio", documents: "file", archives: "archive", favorites: "star", trash: "trash" }[state.view] || "cloud";
  let title = t("empty.title");
  let text = t("empty.text");
  if (state.search) {
    title = t("empty.noResults");
    text = t("empty.noResultsText");
  } else if (state.view === "trash") {
    title = t("empty.trashTitle");
    text = t("empty.trashText");
  } else if (state.view === "favorites") {
    title = t("empty.favoritesTitle");
    text = t("empty.favoritesText");
  }
  dom.content.append(
    emptyState({
      iconName,
      title,
      text,
      action: state.search
        ? el("button", { class: "btn btn-primary", style: { marginTop: "14px" } },
            icon("close", { size: 15 }), el("span", { text: t("action.reset") }))
        : null
    })
  );
  if (state.search) {
    dom.content.querySelector(".btn")?.addEventListener("click", () => {
      dom.searchInput.value = "";
      onSearch("");
    });
  }
}

function renderLoadMore() {
  dom.content.querySelector(".load-more")?.remove();
  dom.content.querySelector(".end-marker")?.remove();
  if (state.view === "settings") return;

  if (state.hasMore && state.files.length) {
    const wrap = el("div", { class: "load-more" });
    const btn = el(
      "button",
      { class: "btn", type: "button" },
      state.loading
        ? el("span", { class: "spinner" })
        : icon("chevronDown", { size: 16 }),
      el("span", { text: state.loading ? t("state.loadingMore") : t("state.loadMore") })
    );
    btn.addEventListener("click", loadMore);
    wrap.append(btn);
    dom.content.append(wrap);
  } else if (state.files.length >= state.limit) {
    dom.content.append(el("div", { class: "end-marker", text: t("state.noMore") }));
  }
}

const thumbObserver = new IntersectionObserver(
  entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const img = entry.target;
      thumbObserver.unobserve(img);
      const file = state.files.find(f => f.id === img.dataset.thumbFor);
      if (!file) continue;
      if (state.autoThumbnails) loadThumb(img, file);
      else {
        img.remove();
        img.closest(".file-thumb")?.append(fallbackArt(file, colorFor(file)));
      }
    }
  },
  { rootMargin: "600px 0px", threshold: 0.01 }
);

const thumbPending = new Set();

async function loadThumb(img, file) {
  if (img?.src) return;
  if (thumbPending.has(file.id)) {
    thumbObserver.observe(img);
    return;
  }
  thumbPending.add(file.id);
  try {
    const url = await mediaLink(file, "thumb");
    if (url) {
      for (const node of $$(`img[data-thumb-for="${file.id}"]`)) {
        if (!node.src) node.src = url;
      }
    } else {
      img.remove();
      img.closest(".file-thumb")?.append(fallbackArt(file, colorFor(file)));
    }
  } catch {} finally {
    thumbPending.delete(file.id);
  }
}

function thumbNode(file) {
  const color = colorFor(file);
  const wrap = el("div", { class: "file-thumb" });
  const badges = el("div", { class: "file-badges" });
  if (file.isFavorite) badges.append(el("span", { class: "badge-pill is-star", html: icon("star", { size: 12 }) }));
  if (file.isPrivate) badges.append(el("span", { class: "badge-pill", html: icon("lock", { size: 12 }) }));
  if (badges.children.length) wrap.append(badges);

  const canThumb = (isImage(file) || isVideo(file)) && file.fileSize <= 20 * 1024 * 1024 && !isHeic(file.fileName);
  if (canThumb && state.autoThumbnails) {
    const img = el("img", { alt: escapeHtml(file.fileName), loading: "lazy", decoding: "async" });
    img.addEventListener("load", () => img.classList.add("is-loaded"));
    img.addEventListener("error", () => {
      img.remove();
      if (!wrap.querySelector(".file-icon-big")) wrap.append(fallbackArt(file, color));
    });
    img.dataset.thumbFor = file.id;
    wrap.append(img);
    thumbObserver.observe(img);
  } else {
    wrap.append(fallbackArt(file, color));
    if (isHeic(file.fileName)) {
      wrap.append(el("span", { class: "heic-badge", text: "HEIC" }));
    }
  }
  if (isVideo(file)) wrap.append(el("span", { class: "play-badge", html: icon("play", { size: 13 }) }));
  return wrap;
}

function fallbackArt(file, color) {
  const node = el(
    "div",
    { class: "file-icon-big", style: { background: `linear-gradient(160deg, ${colorSoftFor(file)}, transparent)` } },
    el("span", { style: { color }, html: icon(iconFor(file), { size: 30 }) })
  );
  const ext = extOf(file.fileName);
  if (ext && !isImage(file)) node.append(el("span", { class: "thumb-ext", text: ext }));
  return node;
}

function fileCard(file) {
  const selected = state.selected.has(file.id);
  const card = el("div", {
    class: `file-card ${selected ? "is-selected" : ""}`,
    tabindex: "0",
    role: "button",
    dataset: { id: file.id }
  });
  card.append(
    el("span", { class: "file-check", html: icon("check", { size: 13 }) }),
    thumbNode(file),
    el(
      "div",
      { class: "file-card-info" },
      el("div", { class: "file-name", text: file.fileName || "—", title: file.fileName }),
      el(
        "div",
        { class: "file-meta" },
        el("span", { text: formatSize(file.fileSize) }),
        el("span", { text: "•" }),
        el("span", { text: formatDate(file.createdAt, htmlLang()) })
      ),
      file.note ? el("div", { class: "file-note truncate" }, icon("note", { size: 11 }), el("span", { text: file.note })) : null
    )
  );
  bindFileEvents(card, file);
  return card;
}

function fileRow(file) {
  const selected = state.selected.has(file.id);
  const row = el("div", { class: `file-row ${selected ? "is-selected" : ""}`, tabindex: "0", role: "button", dataset: { id: file.id } });
  const iconWrap = el("div", { class: "file-icon-sm", style: { background: colorSoftFor(file), color: colorFor(file) } });
  if ((isImage(file) || isVideo(file)) && state.autoThumbnails && file.fileSize <= 20 * 1024 * 1024 && !isHeic(file.fileName)) {
    const img = el("img", { alt: "", loading: "lazy", decoding: "async", dataset: { thumbFor: file.id } });
    img.addEventListener("error", () => {
      img.remove();
      iconWrap.append(icon(iconFor(file), { size: 19 }));
    });
    iconWrap.append(img);
    loadThumb(img, file);
  } else {
    iconWrap.append(icon(iconFor(file), { size: 19 }));
  }

  row.append(
    el("span", { class: "file-check", style: { position: "static", opacity: selected ? "1" : "0.55" }, html: icon("check", { size: 12 }) }),
    iconWrap,
    el(
      "div",
      { class: "row-name" },
      el("div", { class: "truncate", style: { fontWeight: "600", fontSize: "13.8px" }, text: file.fileName || "—", title: file.fileName }),
      el(
        "div",
        { class: "small muted row" },
        el("span", { text: formatRelative(file.createdAt, htmlLang()) }),
        file.isFavorite ? el("span", { html: icon("star", { size: 11 }), style: { color: "#fbbf24" } }) : null,
        file.isPrivate ? el("span", { html: icon("lock", { size: 11 }) }) : null
      )
    ),
    el("span", { class: "row-size", text: formatSize(file.fileSize) }),
    el(
      "div",
      { class: "row-actions" },
      actionBtn("eye", "action.preview", () => openPreview(file, { files: state.files }), isPreviewable(file)),
      actionBtn("send", "action.sendToTelegram", () => sendFiles([file.id])),
      actionBtn("more", "action.more", e => {
        e.stopPropagation();
        showMenu(file, e.currentTarget.getBoundingClientRect());
      })
    )
  );
  bindFileEvents(row, file);
  return row;
}

function actionBtn(iconName, labelKey, onClick, visible = true) {
  if (!visible) return null;
  const btn = el("button", {
    class: "icon-btn",
    type: "button",
    "aria-label": t(labelKey),
    title: t(labelKey),
    html: icon(iconName, { size: 16 })
  });
  btn.addEventListener("click", e => {
    e.stopPropagation();
    haptic("light");
    onClick(e);
  });
  return btn;
}

function bindFileEvents(node, file) {
  let pressTimer = null;
  let longPressed = false;

  node.addEventListener("click", e => {
    if (longPressed) { longPressed = false; return; }
    if (state.selectionMode || e.shiftKey || e.metaKey || e.ctrlKey) {
      toggleSelect(file.id, node);
      return;
    }
    openFile(file);
  });

  node.addEventListener("keydown", e => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      node.click();
    }
  });

  node.addEventListener("contextmenu", e => {
    e.preventDefault();
    showMenu(file, { left: e.clientX, top: e.clientY });
  });

  node.addEventListener("touchstart", () => {
    longPressed = false;
    pressTimer = setTimeout(() => {
      longPressed = true;
      haptic("medium");
      if (!state.selectionMode) enterSelection(file.id, node);
      else toggleSelect(file.id, node);
    }, 480);
  }, { passive: true });

  const clear = () => clearTimeout(pressTimer);
  node.addEventListener("touchend", clear);
  node.addEventListener("touchmove", clear);
  node.addEventListener("touchcancel", clear);
}

function showMenu(file, rectOrPoint) {
  const point = rectOrPoint && "left" in rectOrPoint
    ? rectOrPoint
    : { left: rectOrPoint.left, top: rectOrPoint.bottom + 4 };
  const items = [];
  if (isPreviewable(file)) items.push({ icon: "eye", label: t("action.preview"), onSelect: () => openFile(file, true) });
  items.push({ icon: "send", label: t("action.sendToTelegram"), onSelect: () => sendFiles([file.id]) });
  if (!file.isDeleted && file.fileSize <= 20 * 1024 * 1024) {
    items.push({ icon: "download", label: t("action.download"), onSelect: () => downloadFile(file) });
  }
  items.push({ icon: "edit", label: t("action.rename"), onSelect: () => renameFile(file) });
  items.push({
    icon: file.isFavorite ? "star" : "star",
    label: file.isFavorite ? t("action.unfavorite") : t("action.favorite"),
    onSelect: () => toggleFavorite(file)
  });
  items.push("divider");
  items.push({ icon: "info", label: t("action.details"), onSelect: () => openDetails(file) });
  items.push({ icon: "copy", label: t("action.copyName"), onSelect: () => copyName(file) });
  if (file.isDeleted) {
    items.push({ icon: "restore", label: t("action.restore"), onSelect: () => restoreFiles([file.id]) });
    items.push({ icon: "trash", label: t("confirm.deleteForeverTitle"), danger: true, onSelect: () => deleteFiles([file.id], true) });
  } else {
    items.push({ icon: "trash", label: t("action.delete"), danger: true, onSelect: () => deleteFiles([file.id]) });
  }
  contextMenu(items, point.left, point.top);
}

function openFile(file, forcePreview = false) {
  if (isPreviewable(file) && (forcePreview || isImage(file) || isVideo(file) || isAudio(file))) {
    openPreview(file, { files: state.files });
    return;
  }
  openDetails(file);
}

function renderToolbar() {
  dom.toolbarActions.innerHTML = "";
  const inTrash = state.view === "trash";
  const inSettings = state.view === "settings";

  if (inSettings) {
    const resetBtn = el("button", { class: "btn btn-sm btn-ghost" }, icon("restore", { size: 15 }), el("span", { text: t("settings.resetSettings") }));
    resetBtn.addEventListener("click", resetSettings);
    dom.toolbarActions.append(resetBtn);
    return;
  }

  if (inTrash) {
    const emptyBtn = el("button", { class: "btn btn-sm btn-danger" }, icon("trash", { size: 15 }), el("span", { text: t("trash.emptyTrash") }));
    emptyBtn.addEventListener("click", emptyTrash);
    dom.toolbarActions.append(emptyBtn);
  }

  const sortSelect = el("select", { class: "field", style: { height: "36px", width: "auto", minWidth: "150px", fontSize: "13.5px" } });
  for (const s of SORTS) sortSelect.append(el("option", { value: s, text: t(`sort.${s}`) }));
  sortSelect.value = state.sort;
  sortSelect.addEventListener("change", () => {
    state.sort = sortSelect.value;
    store.set("sort", state.sort);
    refreshFiles();
  });
  dom.toolbarActions.append(sortSelect);

  const seg = segmented(
    [
      { value: "grid", icon: "grid", label: t("view.grid"), title: t("view.gridHint") },
      { value: "list", icon: "list", label: t("view.list"), title: t("view.listHint") }
    ],
    state.mode,
    value => {
      state.mode = value;
      store.set("mode", value);
      renderContent();
    }
  );
  seg.node.querySelector(".segmented-item span").style.display = isDesktopViewport() ? "" : "none";
  dom.toolbarActions.append(seg.node);
}

function renderToolbarCounts() {
  const n = state.total;
  dom.resultCount.textContent = n === 1 ? t("stats.item", { count: n }) : t("stats.items", { count: n });
  if (state.selectionMode) renderSelectionBar();
}

function enterSelection(id, node) {
  state.selectionMode = true;
  state.selected.add(id);
  node?.classList.add("is-selected");
  renderSelectionBar();
}

function exitSelection(silent = false) {
  state.selectionMode = false;
  state.selected.clear();
  $$(".is-selected").forEach(n => n.classList.remove("is-selected"));
  renderSelectionBar();
  if (!silent) renderToolbarCounts();
}

function toggleSelect(id, node) {
  if (state.selected.has(id)) state.selected.delete(id);
  else {
    state.selected.add(id);
    state.selectionMode = true;
  }
  node?.classList.toggle("is-selected", state.selected.has(id));
  if (!state.selected.size) exitSelection();
  else renderSelectionBar();
}

function renderSelectionBar() {
  dom.toolbar.querySelector(".selection-bar")?.remove();
  if (!state.selected.size) {
    state.selectionMode = false;
    dom.toolbar.classList.remove("has-selection");
    return;
  }
  state.selectionMode = true;
  const count = state.selected.size;
  const inTrash = state.view === "trash";
  const bar = el("div", { class: "selection-bar" });
  bar.append(el("span", { class: "selection-count", text: t("selection.selectedCount", { count }) }));
  const ids = [...state.selected];
  bar.append(
    inTrash
      ? el("div", { class: "row" },
          actionBtn("restore", "action.restore", () => restoreFiles(ids)),
          actionBtn("trash", "confirm.deleteForeverTitle", () => deleteFiles(ids, true)))
      : el("div", { class: "row" },
          actionBtn("send", "selection.sendAll", () => sendFiles(ids)),
          actionBtn("star", "selection.favoriteAll", () => favoriteFiles(ids, true)),
          actionBtn("trash", "selection.deleteAll", () => deleteFiles(ids))),
    actionBtn("close", "selection.exit", () => exitSelection())
  );
  dom.toolbar.prepend(bar);
  dom.toolbar.classList.add("has-selection");
}

async function sendFiles(ids) {
  if (!ids.length) return toast(t("toast.nothingSelected"), "warning");
  if (ids.length > 1) {
    const ok = await confirm({
      title: t("confirm.sendManyTitle", { count: ids.length }),
      text: t("confirm.sendManyText"),
      confirmText: t("action.send"),
      icon: "send"
    });
    if (!ok) return;
  }
  toast(t("state.sending"), "info", 1500);
  try {
    if (ids.length === 1) await api.sendFile(ids[0]);
    else await api.bulk(ids, "send");
    toast(ids.length === 1 ? t("toast.sent") : t("toast.sentMany", { count: ids.length }), "success");
    haptic("success");
    exitSelection();
  } catch (e) {
    toast(`${t("toast.sendFailed")}: ${e.message}`, "error", 3200);
    haptic("error");
  }
}

async function deleteFiles(ids, hard = false) {
  if (!ids.length) return;
  const name = state.files.find(f => f.id === ids[0])?.fileName || "";
  const ok = await confirm({
    title: hard ? t("confirm.deleteForeverTitle") : ids.length > 1 ? t("confirm.deleteManyTitle", { count: ids.length }) : t("confirm.deleteTitle"),
    text: hard ? t("confirm.deleteForeverText", { name }) : ids.length > 1 ? t("confirm.deleteManyText") : t("confirm.deleteText", { name }),
    confirmText: hard ? t("action.delete") : t("confirm.deleteTitle"),
    danger: true,
    icon: "trash"
  });
  if (!ok) return;
  try {
    if (ids.length === 1) await api.deleteFile(ids[0], hard);
    else await api.bulk(ids, hard ? "hardDelete" : "delete");
    toast(hard ? t("toast.deletedForever") : t("toast.deleted"), "success");
    haptic("success");
    exitSelection();
    await Promise.all([refreshFiles(), loadCounts(), loadMe()]);
  } catch (e) {
    toast(e.message, "error");
  }
}

async function restoreFiles(ids) {
  try {
    await api.bulk(ids, "restore");
    toast(ids.length > 1 ? t("toast.restoredMany", { count: ids.length }) : t("toast.restored"), "success");
    haptic("success");
    exitSelection();
    await Promise.all([refreshFiles(), loadCounts(), loadMe()]);
  } catch (e) {
    toast(e.message, "error");
  }
}

async function favoriteFiles(ids, value = true) {
  try {
    await api.bulk(ids, value ? "favorite" : "unfavorite");
    toast(value ? t("toast.favoriteAdded") : t("toast.favoriteRemoved"), "success");
    exitSelection();
    await Promise.all([refreshFiles(), loadCounts()]);
  } catch (e) {
    toast(e.message, "error");
  }
}

async function toggleFavorite(file) {
  try {
    await api.updateFile(file.id, { isFavorite: !file.isFavorite });
    file.isFavorite = !file.isFavorite;
    toast(file.isFavorite ? t("toast.favoriteAdded") : t("toast.favoriteRemoved"), "success");
    await Promise.all([refreshFiles(), loadCounts()]);
  } catch (e) {
    toast(e.message, "error");
  }
}

async function renameFile(file) {
  const name = await (await import("./ui.js")).prompt({
    title: t("action.rename"),
    label: t("details.name"),
    value: file.fileName,
    placeholder: t("details.namePlaceholder"),
    confirmText: t("action.save")
  });
  if (!name) return;
  try {
    await api.updateFile(file.id, { fileName: name });
    file.fileName = name;
    toast(t("toast.saved"), "success");
    refreshFiles();
  } catch (e) {
    toast(e.message, "error");
  }
}

async function downloadFile(file) {
  try {
    await downloadMedia(file);
  } catch (e) {
    toast(e.message || t("toast.failed"), "error");
  }
}

async function copyName(file) {
  const { copyText } = await import("./core.js");
  await copyText(file.fileName || "");
  toast(t("toast.copied"), "success");
}

async function emptyTrash() {
  const ok = await confirm({
    title: t("confirm.emptyTrashTitle"),
    text: t("confirm.emptyTrashText", { count: state.total }),
    confirmText: t("trash.emptyTrash"),
    danger: true,
    icon: "trash"
  });
  if (!ok) return;
  const ids = state.files.map(f => f.id);
  if (!ids.length) return;
  try {
    await api.bulk(ids.slice(0, 50), "hardDelete");
    toast(t("toast.deletedForever"), "success");
    await Promise.all([refreshFiles(), loadCounts(), loadMe()]);
  } catch (e) {
    toast(e.message, "error");
  }
}

function openDetails(file) {
  const body = el("div", { class: "detail" });
  const art = el("div", { class: "hero-art", style: { color: colorFor(file) } });
  if ((isImage(file) || isVideo(file)) && file.fileSize <= 20 * 1024 * 1024 && !isHeic(file.fileName)) {
    const img = el("img", { alt: "", dataset: { thumbFor: file.id } });
    img.addEventListener("error", () => {
      img.remove();
      art.append(icon(iconFor(file), { size: 40 }));
    });
    art.append(img);
    setTimeout(() => loadThumb(img, file), 60);
  } else {
    art.append(icon(iconFor(file), { size: 40 }));
  }
  body.append(el("div", { class: "detail-hero" }, art));

  if (isPreviewable(file)) {
    const previewBtn = el("button", { class: "btn btn-primary btn-block", style: { marginBottom: "14px" } },
      icon("eye", { size: 16 }), el("span", { text: t("action.preview") }));
    previewBtn.addEventListener("click", () => {
      dialog.close();
      openFile(file, true);
    });
    body.append(previewBtn);
  }

  const nameInput = el("input", { class: "field", type: "text", maxlength: "200" });
  nameInput.value = file.fileName || "";
  const noteInput = el("textarea", { class: "field", rows: "3", maxlength: "500", placeholder: t("details.notePlaceholder") });
  noteInput.value = file.note || "";
  body.append(
    el("div", { class: "field-group" }, el("label", { class: "field-label", text: t("details.name") }), nameInput),
    el("div", { class: "field-group" }, el("label", { class: "field-label", text: t("details.note") }), noteInput)
  );

  const meta = el(
    "div",
    { class: "meta-list" },
    metaRow("file", t("details.type"), (file.kind || "—").toUpperCase()),
    metaRow("download", t("details.size"), formatSize(file.fileSize)),
    metaRow("calendar", t("details.created"), formatDate(file.createdAt, htmlLang(), { hour: "2-digit", minute: "2-digit", month: "short" })),
    metaRow("clock", t("details.expires"), file.expiresAt ? formatDate(file.expiresAt, htmlLang()) : t("details.never")),
    metaRow("shield", t("details.private"), file.isPrivate ? t("details.private") : t("details.public"))
  );
  body.append(el("div", { class: "setting-section", text: t("details.title") }), meta);

  const fav = switchRow({ label: t("action.favorite"), value: file.isFavorite, onChange: v => (file.isFavorite = v) });
  const priv = switchRow({ label: t("details.private"), value: file.isPrivate, onChange: v => (file.isPrivate = v) });
  body.append(el("div", { class: "setting-card", style: { marginTop: "12px" } }, fav.row, priv.row));

  const footer = el(
    "div",
    { class: "confirm-actions" },
    el("button", { class: "btn btn-ghost" }, icon("send", { size: 15 }), el("span", { text: t("action.send") })),
    el("button", { class: "btn btn-primary" }, icon("check", { size: 15 }), el("span", { text: t("action.save") }))
  );

  const dialog = sheet({ title: t("details.title"), body, footer, size: "md" });
  footer.children[0].addEventListener("click", () => {
    dialog.close();
    sendFiles([file.id]);
  });
  footer.children[1].addEventListener("click", async () => {
    const name = nameInput.value.trim();
    if (!name) return toast(t("toast.nameRequired"), "warning");
    try {
      await api.updateFile(file.id, {
        fileName: name,
        note: noteInput.value,
        isFavorite: fav.btn.getAttribute("aria-checked") === "true",
        isPrivate: priv.btn.getAttribute("aria-checked") === "true"
      });
      Object.assign(file, { fileName: name, note: noteInput.value });
      toast(t("toast.saved"), "success");
      haptic("success");
      dialog.close();
      refreshFiles();
    } catch (e) {
      toast(e.message, "error");
    }
  });
}

function metaRow(iconName, key, value) {
  return el(
    "div",
    { class: "meta-row" },
    el("span", { class: "meta-key" }, icon(iconName, { size: 14 }), el("span", { text: key })),
    el("span", { class: "meta-val", text: value })
  );
}

function renderSettings() {
  dom.content.innerHTML = "";
  const wrap = el("div", { class: "settings" });
  const u = state.user || {};

  wrap.append(el("div", { class: "setting-section", text: t("settings.language") }));
  const langGrid = el("div", { class: "lang-grid" });
  for (const l of languages()) {
    const item = el(
      "button",
      { class: `lang-item ${l.code === lang() ? "is-active" : ""}`, type: "button" },
      el("span", { class: "lang-flag", text: l.flag }),
      el("span", { text: l.name }),
      l.code === lang() ? el("span", { class: "lang-check", html: icon("check", { size: 16 }) }) : null
    );
    item.addEventListener("click", async () => {
      await loadLanguage(l.code);
      rememberLanguage(l.code);
      syncUserSettings({}, l.code);
      toast(t("toast.languageChanged"), "success");
      renderAll();
    });
    langGrid.append(item);
  }
  wrap.append(langGrid);

  wrap.append(el("div", { class: "setting-section", text: t("settings.appearance") }));
  const themeSeg = segmented(
    [
      { value: "auto", icon: "sparkles", label: t("settings.themeAuto") },
      { value: "light", icon: "sun", label: t("settings.themeLight") },
      { value: "dark", icon: "moon", label: t("settings.themeDark") }
    ],
    state.theme,
    value => {
      applyTheme(value);
      syncUserSettings({ theme: value });
    }
  );
  wrap.append(
    el("div", { class: "setting-card" },
      el("div", { class: "setting-row" },
        el("div", { class: "setting-text" },
          el("div", { class: "setting-label", text: t("settings.theme") }),
          el("div", { class: "setting-hint", text: t("settings.appearanceHint") })
        ),
        themeSeg.node
      )
    )
  );

  const desktop = switchRow({
    label: t("settings.desktopMode"),
    hint: t("settings.desktopModeHint"),
    value: isDesktopMode(),
    onChange: v => {
      state.desktopMode = v;
      store.set("desktopMode", v);
      applyDesktopMode();
      syncUserSettings({ desktopMode: v });
    }
  });
  const autoFs = switchRow({
    label: t("settings.autoFullscreen"),
    hint: t("settings.autoFullscreenHint"),
    value: state.autoFullscreen,
    onChange: v => {
      state.autoFullscreen = v;
      store.set("autoFullscreen", v);
      if (v) setupAutoFullscreen();
      syncUserSettings({ autoFullscreen: v });
    }
  });
  const thumbs = switchRow({
    label: t("settings.autoThumbnails"),
    hint: t("settings.autoThumbnailsHint"),
    value: state.autoThumbnails,
    onChange: v => {
      state.autoThumbnails = v;
      store.set("autoThumbnails", v);
      clearMediaLinks();
      syncUserSettings({ autoThumbnails: v });
    }
  });
  const densitySeg = segmented(
    [
      { value: "comfortable", label: t("view.comfortable") },
      { value: "compact", label: t("view.compact") }
    ],
    state.density,
    v => {
      state.density = v;
      store.set("density", v);
      renderContent();
      syncUserSettings({ density: v });
    }
  );
  wrap.append(
    el("div", { class: "setting-section", text: t("settings.interface") }),
    el("div", { class: "setting-card" },
      desktop.row,
      el("div", { class: "divider" }),
      autoFs.row,
      el("div", { class: "divider" }),
      thumbs.row,
      el("div", { class: "divider" }),
      el("div", { class: "setting-row" },
        el("div", { class: "setting-text" },
          el("div", { class: "setting-label", text: t("settings.gridDensity") })
        ),
        densitySeg.node
      )
    )
  );

  const priv = switchRow({
    label: t("settings.privateByDefault"),
    value: !!u.settings?.privateByDefault,
    onChange: v => syncUserSettings({ privateByDefault: v })
  });
  const notif = switchRow({
    label: t("settings.notifications"),
    value: u.settings?.notifications !== false,
    onChange: v => syncUserSettings({ notifications: v })
  });
  const expireSelect = el("select", { class: "field", style: { width: "auto", minWidth: "130px", height: "36px", fontSize: "13.5px" } });
  expireSelect.append(el("option", { value: "", text: t("details.never") }));
  for (const key of ["24h", "7d", "30d", "90d"]) {
    expireSelect.append(el("option", { value: key, text: t(`expiry.${key}`) || key }));
  }
  expireSelect.value = u.settings?.autoExpire || "";
  expireSelect.addEventListener("change", () => syncUserSettings({ autoExpire: expireSelect.value || null }));

  wrap.append(
    el("div", { class: "setting-section", text: t("settings.filesSection") }),
    el("div", { class: "setting-card" },
      priv.row,
      el("div", { class: "divider" }),
      notif.row,
      el("div", { class: "divider" }),
      el("div", { class: "setting-row" },
        el("div", { class: "setting-text" },
          el("div", { class: "setting-label", text: t("settings.autoExpire") })
        ),
        expireSelect
      )
    )
  );

  wrap.append(
    el("div", { class: "setting-section", text: t("settings.storageUsed") }),
    el("div", { class: "setting-card" },
      el("div", { class: "setting-row" },
        el("div", { class: "setting-text" },
          el("div", { class: "setting-label", text: t("stats.files") }),
          el("div", { class: "setting-hint", text: t("stats.acrossFiles") })
        ),
        el("span", { style: { fontWeight: "700" }, text: String(state.stats?.files || 0) })
      ),
      el("div", { class: "divider" }),
      el("div", { class: "setting-row" },
        el("div", { class: "setting-text" },
          el("div", { class: "setting-label", text: t("stats.storage") }),
          el("div", { class: "setting-hint", text: t("stats.inCloud") })
        ),
        el("span", { style: { fontWeight: "700" }, text: formatSize(state.stats?.size || 0) })
      )
    )
  );

  wrap.append(
    el("div", { class: "setting-section", text: t("shortcuts.title") }),
    el("div", { class: "setting-card" },
      shortcutRow("search", "shortcuts.search", "/"),
      shortcutRow("grid", "shortcuts.selectAll", "Ctrl + A"),
      shortcutRow("eye", "shortcuts.preview", "Enter"),
      shortcutRow("trash", "shortcuts.delete", "Delete"),
      shortcutRow("refresh", "shortcuts.refresh", "R"),
      shortcutRow("expand", "action.fullscreen", "F"),
      shortcutRow("close", "shortcuts.close", "Esc")
    ),
    el("p", { class: "small muted", style: { padding: "10px 12px" }, text: t("shortcuts.hint") })
  );

  wrap.append(
    el("div", { class: "setting-section", text: t("settings.aboutSection") }),
    el("div", { class: "setting-card" },
      el("div", { class: "setting-row" },
        el("div", { class: "setting-text" }, el("div", { class: "setting-label", text: t("settings.version") })),
        el("span", { class: "muted", text: `v${boot.version || "—"}` })
      )
    ),
    el("div", { style: { marginTop: "18px" } },
      el("button", { class: "btn btn-block btn-danger" }, icon("logout", { size: 15 }), el("span", { text: t("action.logout") }))
    )
  );
  wrap.querySelector(".btn-danger").addEventListener("click", () => {
    try { tg?.close(); } catch {}
    window.location.href = "https://t.me";
  });

  dom.content.append(wrap);
  applyStatic(dom.content);
}

function shortcutRow(iconName, labelKey, keys) {
  return el(
    "div",
    { class: "shortcut-row" },
    el("span", { class: "row" }, icon(iconName, { size: 15 }), el("span", { text: t(labelKey) })),
    el("span", { class: "row" }, ...String(keys).split(" + ").map(k => el("kbd", { text: k })))
  );
}

async function syncUserSettings(patch, language) {
  const body = {};
  if (language) body.language = language;
  if (Object.keys(patch).length) body.settings = patch;
  try {
    const res = await api.updateMe(body);
    if (res.user) state.user = res.user;
  } catch (e) {
    console.warn("[settings]", e.message);
  }
}

async function resetSettings() {
  const ok = await confirm({ title: t("settings.resetSettings"), text: t("settings.resetDone"), confirmText: t("action.reset"), icon: "restore" });
  if (!ok) return;
  for (const key of ["theme", "mode", "density", "sort", "autoThumbnails", "autoFullscreen", "desktopMode"]) store.del(key);
  await syncUserSettings({
    theme: "auto", view: "grid", density: "comfortable",
    desktopMode: true, autoFullscreen: true, autoThumbnails: true
  });
  window.location.reload();
}

function showMoreMenu(target) {
  const rect = target.getBoundingClientRect();
  contextMenu(
    [
      { icon: "menu", label: t("nav.openMenu"), onSelect: openDrawer, hint: "" },
      {
        icon: isFullscreen() ? "compress" : "expand",
        label: isFullscreen() ? t("action.exitFullscreen") : t("action.fullscreen"),
        onSelect: () => (isFullscreen() ? exitFullscreen() : requestFullscreen()),
        hint: "F"
      },
      { icon: "globe", label: t("action.language"), onSelect: openLanguageSheet },
      { icon: state.theme === "dark" ? "sun" : "moon", label: t("action.theme"), onSelect: toggleTheme },
      "divider",
      { icon: "keyboard", label: t("shortcuts.title"), onSelect: openShortcuts },
      { icon: "refresh", label: t("action.refresh"), onSelect: () => refreshFiles(), hint: "R" },
      { icon: "settings", label: t("nav.settings"), onSelect: () => setView("settings") }
    ],
    rect.left - 180,
    rect.bottom + 6
  );
}

function openLanguageSheet() {
  const grid = el("div", { class: "lang-grid" });
  for (const l of languages()) {
    const item = el(
      "button",
      { class: `lang-item ${l.code === lang() ? "is-active" : ""}`, type: "button" },
      el("span", { class: "lang-flag", text: l.flag }),
      el("span", { text: l.name }),
      l.code === lang() ? el("span", { class: "lang-check", html: icon("check", { size: 16 }) }) : null
    );
    item.addEventListener("click", async () => {
      await loadLanguage(l.code);
      rememberLanguage(l.code);
      syncUserSettings({}, l.code);
      toast(t("toast.languageChanged"), "success");
      dialog.close();
      renderAll();
    });
    grid.append(item);
  }
  const dialog = sheet({ title: t("action.language"), body: grid });
}

function openShortcuts() {
  const list = el(
    "div",
    {},
    shortcutRow("search", "shortcuts.search", "/"),
    shortcutRow("grid", "shortcuts.selectAll", "Ctrl + A"),
    shortcutRow("eye", "shortcuts.preview", "Enter"),
    shortcutRow("trash", "shortcuts.delete", "Delete"),
    shortcutRow("star", "action.favorite", "Fav"),
    shortcutRow("refresh", "shortcuts.refresh", "R"),
    shortcutRow("expand", "action.fullscreen", "F")
  );
  sheet({ title: t("shortcuts.title"), body: list, size: "sm" });
}

const onSearch = debounce(value => {
  state.search = value.trim();
  dom.searchClear.classList.toggle("hidden", !value);
  refreshFiles();
}, 320);

function bindEvents() {
  onLangChange(() => {
    if (!state.ready) return;
    applyStatic();
    renderNav();
    renderChips();
    renderTabs();
    renderToolbar();
    dom.viewTitle.textContent = t(viewMeta(state.view).label);
    if (state.view === "settings") renderSettings();
    else refreshFiles();
  });

  dom.menuBtn.addEventListener("click", () => (dom.sidebar.classList.contains("is-open") ? closeDrawer() : openDrawer()));
  dom.sidebarClose.addEventListener("click", closeDrawer);
  dom.refreshBtn.addEventListener("click", async () => {
    haptic("light");
    const [, , loaded] = await Promise.all([refreshFiles(), loadCounts(), loadMe()]);
    if (loaded) toast(t("header.updated"), "success", 1400);
  });
  dom.viewBtn.addEventListener("click", () => {
    state.mode = state.mode === "grid" ? "list" : "grid";
    store.set("mode", state.mode);
    renderContent();
    renderToolbar();
  });
  dom.fullscreenBtn.addEventListener("click", () => (isFullscreen() ? exitFullscreen() : requestFullscreen()));
  dom.moreBtn.addEventListener("click", e => showMoreMenu(e.currentTarget));
  dom.searchInput.addEventListener("input", e => onSearch(e.target.value));
  dom.searchClear.addEventListener("click", () => {
    dom.searchInput.value = "";
    onSearch("");
    dom.searchInput.focus();
  });
  dom.fab.addEventListener("click", () => openDrawer());

  window.addEventListener("scroll", throttle(() => {
    if (state.view === "settings" || !state.hasMore || state.loading) return;
    if (window.innerHeight + window.scrollY > document.body.offsetHeight - 700) loadMore();
  }, 220), { passive: true });

  window.addEventListener("resize", debounce(() => {
    applyDesktopMode();
    if (isDesktopViewport()) closeDrawer();
  }, 200));

  window.addEventListener("keydown", onKeydown);
  window.addEventListener("cloud:unauthorized", event => showAuthenticationRequired(event.detail));
  window.addEventListener("online", () => toast(t("app.online"), "success", 1600));
  window.addEventListener("offline", () => toast(t("app.offline"), "warning", 2200));

  document.addEventListener("fullscreenchange", syncFullscreenIcon);
}

function syncFullscreenIcon() {
  const on = isFullscreen();
  dom.fullscreenBtn.innerHTML = icon(on ? "compress" : "expand", { size: 19 });
  dom.fullscreenBtn.title = on ? t("action.exitFullscreen") : t("action.fullscreen");
}

function onKeydown(e) {
  const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName);
  closeContextMenu();

  if (e.key === "/" && !typing) {
    e.preventDefault();
    dom.searchInput.focus();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    dom.searchInput.focus();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a" && !typing) {
    e.preventDefault();
    selectAll();
    return;
  }
  if (typing) return;

  const key = e.key.toLowerCase();
  if (key === "r") {
    refreshFiles();
    toast(t("header.updated"), "success", 1200);
  } else if (key === "f" && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    isFullscreen() ? exitFullscreen() : requestFullscreen();
  } else if (e.key === "Enter" && state.selected.size === 1) {
    const file = state.files.find(f => f.id === [...state.selected][0]);
    if (file) openFile(file);
  } else if ((e.key === "Delete" || e.key === "Backspace") && state.selected.size) {
    e.preventDefault();
    deleteFiles([...state.selected], state.view === "trash");
  } else if (e.key === "Escape") {
    if (state.selectionMode) exitSelection();
    else if (dom.sidebar.classList.contains("is-open") && !isDesktopViewport()) closeDrawer();
  }
}

function selectAll() {
  if (state.view === "settings") return;
  state.selectionMode = true;
  for (const file of state.files) state.selected.add(file.id);
  $$("[data-id]").forEach(n => n.classList.add("is-selected"));
  renderSelectionBar();
}

function renderAll() {
  applyStatic();
  renderNav();
  renderChips();
  renderTabs();
  renderToolbar();
  syncFullscreenIcon();
  if (state.view === "settings") renderSettings();
  else refreshFiles();
}

function paintStaticIcons() {
  dom.brandMark.innerHTML = icon("cloud", { size: 21 });
  dom.menuBtn.innerHTML = icon("menu", { size: 20 });
  dom.sidebarClose.innerHTML = icon("close", { size: 18 });
  dom.searchIcon.innerHTML = icon("search", { size: 17 });
  dom.refreshBtn.innerHTML = icon("refresh", { size: 19 });
  dom.viewBtn.innerHTML = icon("grid", { size: 19 });
  dom.fullscreenBtn.innerHTML = icon("expand", { size: 19 });
  dom.moreBtn.innerHTML = icon("more", { size: 19 });
  dom.searchClear.innerHTML = icon("close", { size: 15 });
  dom.fab.innerHTML = icon("menu", { size: 22 });
  dom.viewBtn.addEventListener("click", () => {
    dom.viewBtn.innerHTML = icon(state.mode === "grid" ? "grid" : "list", { size: 19 });
  });
}

async function main() {
  store.del("initData");
  paintStaticIcons();
  initTelegram();
  applyTheme(state.theme);
  applyDesktopMode();
  bindEvents();

  await loadLanguage(guessLanguage(), { silent: true });
  applyStatic();
  paintStaticIcons();
  document.title = t("app.name");
  dom.viewTitle.textContent = t("nav.all");

  if (boot.demo) {
    dom.toolbar.after(
      el("div", { class: "banner is-info" }, icon("info", { size: 16 }), el("span", { text: t("header.demo") }))
    );
  }

  registerServiceWorker();
  const authenticated = await loadMe();
  if (!authenticated) return;
  state.ready = true;
  renderAll();
  loadCounts();
  setupAutoFullscreen();

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && state.ready) {
      refreshFiles();
      loadCounts();
    }
  });

  setInterval(() => {
    if (!document.hidden && state.view !== "settings") loadCounts();
  }, 60_000);
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (!window.isSecureContext && location.hostname !== "localhost") return;
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloaded) return;
    reloaded = true;
    location.reload();
  });
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then(reg => reg.update().catch(() => {}))
      .catch(() => {});
  });
}

main().catch(err => {
  console.error("[app]", err);
  if (isAuthenticationError(err)) showAuthenticationRequired(err);
  else showFatal(err);
});

export { state, refreshFiles, loadCounts };