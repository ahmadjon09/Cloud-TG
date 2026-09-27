// ui.js — reusable UI kit: toasts, sheets, dialogs, context menu, skeletons
import { $, $$, el, haptic, escapeHtml } from "./core.js";
import { icon } from "./icons.js";
import { t } from "./i18n.js";

/* ------------------------------------------------------------------ toasts */
let toastHost = null;
let toastTimer = null;

function ensureToastHost() {
  if (!toastHost) {
    toastHost = el("div", { class: "toast-host", role: "status", "aria-live": "polite" });
    document.body.append(toastHost);
  }
  return toastHost;
}

export function toast(message, type = "info", duration = 2400) {
  const host = ensureToastHost();
  host.innerHTML = "";
  const icons = { success: "check", error: "warning", info: "info", warning: "warning" };
  const node = el(
    "div",
    { class: `toast toast-${type}` },
    icon(icons[type] || "info", { size: 18 }),
    el("span", { class: "toast-text", text: message })
  );
  host.append(node);
  requestAnimationFrame(() => node.classList.add("is-in"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    node.classList.remove("is-in");
    setTimeout(() => node.remove(), 220);
  }, duration);
}

/* ---------------------------------------------------------------- overlays */
let overlayCount = 0;
const escStack = [];

function lockScroll(lock) {
  overlayCount = Math.max(0, overlayCount + (lock ? 1 : -1));
  document.body.classList.toggle("no-scroll", overlayCount > 0);
}

document.addEventListener("keydown", e => {
  if (e.key !== "Escape" || !escStack.length) return;
  const top = escStack[escStack.length - 1];
  if (top.closable === false) return;
  e.stopPropagation();
  top.close();
});

/**
 * Bottom sheet on mobile / centered dialog on desktop.
 * @returns {{close:Function, node:HTMLElement, body:HTMLElement}}
 */
export function sheet({ title = "", body, footer, size = "md", closable = true, onClose } = {}) {
  const backdrop = el("div", { class: "backdrop" });
  const bodyEl = el("div", { class: "sheet-body" });
  if (typeof body === "string") bodyEl.innerHTML = body;
  else if (body) bodyEl.append(body);

  const footerEl = el("div", { class: "sheet-footer" });
  if (footer) footerEl.append(footer);

  const panel = el(
    "div",
    { class: `sheet sheet-${size}`, role: "dialog", "aria-modal": "true" },
    el(
      "div",
      { class: "sheet-head" },
      el("div", { class: "sheet-grip" }),
      el("h2", { class: "sheet-title", text: title }),
      closable
        ? el("button", { class: "icon-btn", "aria-label": t("action.close"), html: icon("close", { size: 18 }) })
        : null
    ),
    bodyEl,
    footerEl
  );

  const wrap = el("div", { class: "overlay" }, backdrop, panel);
  document.body.append(wrap);
  lockScroll(true);
  requestAnimationFrame(() => wrap.classList.add("is-open"));

  const entry = {
    closable,
    close() {
      if (!wrap.isConnected) return;
      wrap.classList.remove("is-open");
      lockScroll(false);
      escStack.splice(escStack.indexOf(entry), 1);
      onClose?.();
      setTimeout(() => wrap.remove(), 200);
    }
  };
  escStack.push(entry);
  backdrop.addEventListener("click", () => closable && entry.close());
  panel.querySelector(".sheet-head .icon-btn")?.addEventListener("click", entry.close);

  // drag-to-dismiss on touch devices
  let startY = null;
  const head = panel.querySelector(".sheet-head");
  head?.addEventListener("touchstart", e => (startY = e.touches[0].clientY), { passive: true });
  head?.addEventListener(
    "touchmove",
    e => {
      if (startY === null) return;
      const dy = e.touches[0].clientY - startY;
      if (dy > 0) panel.style.transform = `translateY(${dy}px)`;
    },
    { passive: true }
  );
  head?.addEventListener("touchend", e => {
    if (startY === null) return;
    const dy = e.changedTouches[0].clientY - startY;
    panel.style.transform = "";
    if (dy > 110 && closable) entry.close();
    startY = null;
  });

  return { close: entry.close, node: panel, body: bodyEl, footer: footerEl };
}

/** Promise-based confirm dialog */
export function confirm({ title, text, confirmText, cancelText, danger = false, icon: iconName = "warning" }) {
  return new Promise(resolve => {
    const cancelBtn = el("button", {
      class: "btn btn-ghost",
      text: cancelText || t("action.cancel")
    });
    const okBtn = el("button", {
      class: `btn ${danger ? "btn-danger" : "btn-primary"}`,
      text: confirmText || t("action.confirm")
    });
    const dialog = sheet({
      title: "",
      size: "sm",
      body: el(
        "div",
        { class: "confirm-body" },
        el("div", { class: `confirm-icon ${danger ? "is-danger" : ""}`, html: icon(iconName, { size: 26 }) }),
        el("h3", { class: "confirm-title", text: title }),
        text ? el("p", { class: "confirm-text", text }) : null
      ),
      footer: el("div", { class: "confirm-actions" }, cancelBtn, okBtn)
    });
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      dialog.close();
      resolve(value);
    };
    cancelBtn.addEventListener("click", () => finish(false));
    okBtn.addEventListener("click", () => {
      haptic("medium");
      finish(true);
    });
    requestAnimationFrame(() => okBtn.focus());
  });
}

/** Prompt for a single value */
export function prompt({ title, label, value = "", placeholder = "", confirmText, multiline = false }) {
  return new Promise(resolve => {
    const input = multiline
      ? el("textarea", { class: "field", rows: "3", placeholder })
      : el("input", { class: "field", type: "text", placeholder });
    input.value = value;
    const dialog = sheet({
      title,
      size: "sm",
      body: el("div", { class: "field-group" }, el("label", { class: "field-label", text: label || "" }), input),
      footer: el(
        "div",
        { class: "confirm-actions" },
        el("button", { class: "btn btn-ghost", text: t("action.cancel") }),
        el("button", { class: "btn btn-primary", text: confirmText || t("action.save") })
      )
    });
    dialog.footer.querySelectorAll("button")[0].addEventListener("click", () => {
      dialog.close();
      resolve(null);
    });
    dialog.footer.querySelectorAll("button")[1].addEventListener("click", () => {
      const val = input.value.trim();
      dialog.close();
      resolve(val || null);
    });
    setTimeout(() => input.focus(), 120);
    input.addEventListener("keydown", e => {
      if (e.key === "Enter" && !multiline) {
        e.preventDefault();
        dialog.footer.querySelectorAll("button")[1].click();
      }
    });
  });
}

/* ------------------------------------------------------------ context menu */
let menuNode = null;
export function contextMenu(items, x, y, { onClose } = {}) {
  closeContextMenu();
  const list = el("div", { class: "ctx-menu", role: "menu" });
  for (const item of items) {
    if (item === "divider") {
      list.append(el("div", { class: "ctx-divider" }));
      continue;
    }
    const btn = el(
      "button",
      { class: `ctx-item ${item.danger ? "is-danger" : ""}`, role: "menuitem", type: "button" },
      icon(item.icon || "file", { size: 17 }),
      el("span", { text: item.label }),
      item.hint ? el("span", { class: "ctx-hint", text: item.hint }) : null
    );
    btn.addEventListener("click", () => {
      closeContextMenu();
      item.onSelect?.();
    });
    list.append(btn);
  }
  const backdrop = el("div", { class: "ctx-backdrop" });
  backdrop.addEventListener("click", closeContextMenu);
  backdrop.addEventListener("contextmenu", e => {
    e.preventDefault();
    closeContextMenu();
  });
  document.body.append(backdrop, list);
  menuNode = { list, backdrop, onClose };

  const rect = { w: list.offsetWidth || 220, h: list.offsetHeight || 200 };
  const left = Math.min(Math.max(8, x), window.innerWidth - rect.w - 8);
  const top = Math.min(Math.max(8, y), window.innerHeight - rect.h - 8);
  list.style.left = `${left}px`;
  list.style.top = `${top}px`;
  requestAnimationFrame(() => {
    list.classList.add("is-open");
    backdrop.classList.add("is-open");
  });
  haptic("medium");
  return list;
}

export function closeContextMenu() {
  if (!menuNode) return;
  const { list, backdrop, onClose } = menuNode;
  menuNode = null;
  list.remove();
  backdrop.remove();
  onClose?.();
}

window.addEventListener("scroll", closeContextMenu, { passive: true });
window.addEventListener("resize", closeContextMenu);

/* --------------------------------------------------------------- fragments */
export function emptyState({ iconName = "cloud", title, text, action }) {
  const node = el(
    "div",
    { class: "empty" },
    el("div", { class: "empty-art", html: icon(iconName, { size: 40 }) }),
    el("h3", { class: "empty-title", text: title }),
    text ? el("p", { class: "empty-text", text }) : null,
    action || null
  );
  return node;
}

export function skeletonGrid(count = 12) {
  const wrap = el("div", { class: "files-grid" });
  for (let i = 0; i < count; i++) {
    wrap.append(
      el(
        "div",
        { class: "file-card is-skeleton" },
        el("div", { class: "skeleton skeleton-thumb" }),
        el(
          "div",
          { class: "file-card-info" },
          el("div", { class: "skeleton", style: { height: "12px", width: "80%" } }),
          el("div", { class: "skeleton", style: { height: "10px", width: "55%", marginTop: "8px" } })
        )
      )
    );
  }
  return wrap;
}

export function skeletonRows(count = 8) {
  const wrap = el("div", { class: "files-list" });
  for (let i = 0; i < count; i++) {
    wrap.append(
      el(
        "div",
        { class: "file-row is-skeleton" },
        el("div", { class: "skeleton skeleton-icon" }),
        el("div", { class: "skeleton", style: { height: "12px", width: "45%" } }),
        el("div", { class: "skeleton", style: { height: "10px", width: "18%", marginLeft: "auto" } })
      )
    );
  }
  return wrap;
}

/** Accessible switch row */
export function switchRow({ label, hint, value, onChange }) {
  const btn = el("button", {
    class: "switch",
    type: "button",
    role: "switch",
    "aria-checked": String(!!value)
  });
  btn.addEventListener("click", () => {
    const next = btn.getAttribute("aria-checked") !== "true";
    btn.setAttribute("aria-checked", String(next));
    haptic("light");
    onChange?.(next);
  });
  const row = el(
    "div",
    { class: "setting-row" },
    el(
      "div",
      { class: "setting-text" },
      el("div", { class: "setting-label", text: label }),
      hint ? el("div", { class: "setting-hint", text: hint }) : null
    ),
    btn
  );
  return { row, btn, setValue: v => btn.setAttribute("aria-checked", String(!!v)) };
}

/** Segmented control (view switch, theme switch…) */
export function segmented(options, value, onChange) {
  const wrap = el("div", { class: "segmented", role: "tablist" });
  const buttons = options.map(opt => {
    const btn = el(
      "button",
      {
        class: `segmented-item ${opt.value === value ? "is-active" : ""}`,
        type: "button",
        role: "tab",
        "aria-selected": String(opt.value === value),
        title: opt.title || opt.label
      },
      opt.icon ? icon(opt.icon, { size: 16 }) : null,
      el("span", { text: opt.label })
    );
    btn.addEventListener("click", () => {
      wrap.querySelectorAll(".segmented-item").forEach(b => {
        b.classList.remove("is-active");
        b.setAttribute("aria-selected", "false");
      });
      btn.classList.add("is-active");
      btn.setAttribute("aria-selected", "true");
      haptic("light");
      onChange?.(opt.value);
    });
    wrap.append(btn);
    return btn;
  });
  return { node: wrap, buttons };
}

export function avatarOf(user, size = 36) {
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || user?.username || "";
  if (user?.photoUrl) {
    return el("span", { class: "avatar", style: { width: `${size}px`, height: `${size}px` } }, el("img", { src: user.photoUrl, alt: name, loading: "lazy" }));
  }
  const initials = name
    ? name
        .split(/\s+/)
        .slice(0, 2)
        .map(p => p[0])
        .join("")
        .toUpperCase()
    : "☁";
  return el("span", { class: "avatar", style: { width: `${size}px`, height: `${size}px`, fontSize: `${size / 2.6}px` }, text: escapeHtml(initials) });
}
