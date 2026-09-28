import { el, formatSize, formatDuration, categoryOf, isImage, isVideo, isAudio, isHeic, extOf, haptic, clamp } from "./core.js";
import { icon } from "./icons.js";
import { t } from "./i18n.js";
import { api, mediaLink, downloadMedia } from "./api.js";
import { toast, sheet, inlineLoader } from "./ui.js";

function safePlay(node) {
  try {
    const result = node?.play?.();
    if (result && typeof result.catch === "function") result.catch(() => {});
  } catch {}
}

const TEXT_EXT = ["txt", "md", "log", "json", "xml", "yml", "yaml", "csv", "js", "mjs", "ts", "jsx", "tsx", "html", "css", "scss", "py", "sh", "sql", "ini", "env"];
const MAX_TEXT = 220_000;

function canBrowserShowHeic() {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;
  try {
    const img = new Image();
    img.src = "data:image/heic;base64,AAA";
    return false;
  } catch {
    return false;
  }
}

const HEIC_SUPPORTED = false;

export async function openPreview(file, opts = {}) {
  const pool = (opts.files || []).filter(f => categoryOf(f.fileName, f.kind) === categoryOf(file.fileName, file.kind));
  if (isImage(file)) return imageViewer(file, pool);
  if (isVideo(file)) return videoPlayer(file);
  if (isAudio(file)) return audioPlayer(file, pool.length ? pool : [file]);
  return documentPreview(file);
}

function unsupported(file, reason) {
  const body = el(
    "div",
    { class: "detail" },
    el(
      "div",
      { class: "confirm-body" },
      el("div", { class: "confirm-icon", html: icon("warning", { size: 26 }) }),
      el("h3", { class: "confirm-title", text: reason?.title || t("preview.unsupported") }),
      el("p", { class: "confirm-text", text: reason?.text || t("preview.unsupportedText") })
    ),
    el(
      "div",
      { class: "meta-list", style: { marginTop: "16px" } },
      el("div", { class: "meta-row" }, el("span", { class: "meta-key", text: t("details.name") }), el("span", { class: "meta-val", text: file.fileName })),
      el("div", { class: "meta-row" }, el("span", { class: "meta-key", text: t("details.size") }), el("span", { class: "meta-val", text: formatSize(file.fileSize) }))
    )
  );
  const footer = el("div", { class: "confirm-actions" },
    el("button", { class: "btn btn-ghost" }, icon("download", { size: 15 }), el("span", { text: t("action.download") })),
    el("button", { class: "btn btn-primary" }, icon("send", { size: 15 }), el("span", { text: t("action.sendToTelegram") }))
  );
  const dialog = sheet({ title: t("action.preview"), body, footer, size: "sm" });
  footer.children[0].addEventListener("click", () => download(file));
  footer.children[1].addEventListener("click", async () => {
    dialog.close();
    await send(file);
  });
}

async function download(file) {
  try {
    await downloadMedia(file);
  } catch (e) {
    toast(e.message || t("toast.failed"), "error");
  }
}

async function send(file) {
  try {
    toast(t("state.sending"), "info", 1200);
    await api.sendFile(file.id);
    toast(t("toast.sent"), "success");
    haptic("success");
  } catch (e) {
    toast(`${t("toast.sendFailed")}: ${e.message}`, "error", 3000);
  }
}

function imageViewer(file, pool) {
  const list = pool.length ? pool : [file];
  let index = Math.max(0, list.findIndex(f => f.id === file.id));
  let scale = 1;
  let tx = 0;
  let ty = 0;
  let dragging = null;

  const img = el("img", { alt: "", draggable: "false" });
  const stage = el("div", { class: "viewer-stage" });
  const loader = el("div", { class: "inline-loader", style: { position: "absolute", inset: "0", zIndex: "2" } },
    el("span", { class: "spinner spinner-lg" })
  );
  stage.append(img, loader);
  const counter = el("div", { class: "viewer-counter" });
  const title = el("div", { class: "viewer-title" });

  const closeBtn = el("button", { class: "icon-btn", "aria-label": t("action.close"), html: icon("close", { size: 20 }) });
  const zoomOut = el("button", { class: "icon-btn", "aria-label": t("action.zoomOut"), html: icon("zoomOut", { size: 19 }) });
  const zoomIn = el("button", { class: "icon-btn", "aria-label": t("action.zoomIn"), html: icon("zoomIn", { size: 19 }) });
  const reset = el("button", { class: "icon-btn", "aria-label": t("action.resetZoom"), html: icon("restore", { size: 19 }) });
  const prevBtn = el("button", { class: "viewer-nav prev", "aria-label": t("action.previous"), html: icon("back", { size: 20 }) });
  const nextBtn = el("button", { class: "viewer-nav next", "aria-label": t("action.next"), html: icon("chevronRight", { size: 20 }) });
  const sendBtn = el("button", { class: "icon-btn", "aria-label": t("action.sendToTelegram"), html: icon("send", { size: 19 }) });
  const dlBtn = el("button", { class: "icon-btn", "aria-label": t("action.download"), html: icon("download", { size: 19 }) });

  const viewer = el(
    "div",
    { class: "viewer", role: "dialog", "aria-modal": "true" },
    el("div", { class: "viewer-head" }, closeBtn, title, sendBtn, dlBtn),
    stage,
    el(
      "div",
      { class: "viewer-foot" },
      zoomOut,
      reset,
      zoomIn,
      counter
    )
  );

  if (list.length > 1) stage.append(prevBtn, nextBtn);
  document.body.append(viewer);
  document.body.classList.add("no-scroll");

  function applyTransform() {
    img.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
  }

  function resetZoom() {
    scale = 1;
    tx = 0;
    ty = 0;
    applyTransform();
  }

  async function show(i) {
    index = (i + list.length) % list.length;
    const current = list[index];
    title.textContent = current.fileName || "";
    counter.textContent = list.length > 1 ? t("preview.counter", { current: index + 1, total: list.length }) : "";
    resetZoom();
    img.style.opacity = "0";
    loader.style.display = "";

    const ext = extOf(current.fileName);
    if (isHeic(current.fileName) && !HEIC_SUPPORTED) {
      img.style.display = "none";
      loader.innerHTML = "";
      loader.style.display = "";
      loader.style.background = "var(--surface-2)";
      loader.style.flexDirection = "column";
      loader.style.gap = "12px";
      loader.style.borderRadius = "16px";
      loader.style.padding = "32px";
      loader.style.position = "relative";
      loader.style.inset = "";
      loader.append(
        el("div", { html: icon("image", { size: 48 }), style: { color: "var(--text-3)", textAlign: "center" } }),
        el("div", { style: { fontWeight: "700", fontSize: "15px", color: "var(--text)" }, text: `${ext.toUpperCase()} format` }),
        el("div", { style: { fontSize: "13px", color: "var(--text-3)", textAlign: "center", maxWidth: "260px" }, text: "This image format is not supported by your browser. You can download it or send to Telegram." }),
        el("div", { style: { display: "flex", gap: "8px", marginTop: "8px" } },
          (() => { const b = el("button", { class: "btn btn-ghost btn-sm" }, icon("download", { size: 14 }), el("span", { text: t("action.download") })); b.addEventListener("click", () => download(current)); return b; })(),
          (() => { const b = el("button", { class: "btn btn-primary btn-sm" }, icon("send", { size: 14 }), el("span", { text: t("action.sendToTelegram") })); b.addEventListener("click", () => send(current)); return b; })()
        )
      );
      return;
    }

    img.style.display = "";
    const url = await mediaLink(current, "preview");
    if (!url) {
      loader.style.display = "none";
      img.remove();
      stage.append(el("div", { class: "muted", style: { textAlign: "center" }, text: t("preview.unsupported") }));
      return;
    }
    img.onload = () => {
      loader.style.display = "none";
      img.style.opacity = "1";
    };
    img.onerror = () => {
      loader.style.display = "none";
      img.style.opacity = "1";
    };
    img.src = url;
  }

  zoomIn.addEventListener("click", () => {
    scale = clamp(scale * 1.35, 1, 6);
    applyTransform();
  });
  zoomOut.addEventListener("click", () => {
    scale = clamp(scale / 1.35, 1, 6);
    if (scale === 1) { tx = 0; ty = 0; }
    applyTransform();
  });
  reset.addEventListener("click", resetZoom);
  prevBtn.addEventListener("click", () => show(index - 1));
  nextBtn.addEventListener("click", () => show(index + 1));
  dlBtn.addEventListener("click", () => download(list[index]));
  sendBtn.addEventListener("click", () => send(list[index]));

  stage.addEventListener("pointerdown", e => {
    if (scale === 1) return;
    dragging = { x: e.clientX - tx, y: e.clientY - ty };
    stage.setPointerCapture?.(e.pointerId);
  });
  stage.addEventListener("pointermove", e => {
    if (!dragging) return;
    tx = e.clientX - dragging.x;
    ty = e.clientY - dragging.y;
    applyTransform();
  });
  stage.addEventListener("pointerup", () => (dragging = null));
  stage.addEventListener("pointercancel", () => (dragging = null));
  stage.addEventListener("wheel", e => {
    e.preventDefault();
    scale = clamp(scale * (e.deltaY < 0 ? 1.12 : 0.89), 1, 6);
    if (scale === 1) { tx = 0; ty = 0; }
    applyTransform();
  }, { passive: false });

  let lastTap = 0;
  stage.addEventListener("pointerup", e => {
    if (e.pointerType !== "touch") return;
    const now = Date.now();
    if (now - lastTap < 280) {
      scale = scale > 1 ? 1 : 2.4;
      if (scale === 1) { tx = 0; ty = 0; }
      applyTransform();
    }
    lastTap = now;
  });

  let swipeStart = null;
  stage.addEventListener("touchstart", e => {
    swipeStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, { passive: true });
  stage.addEventListener("touchend", e => {
    if (!swipeStart || scale !== 1) return;
    const dx = e.changedTouches[0].clientX - swipeStart.x;
    const dy = e.changedTouches[0].clientY - swipeStart.y;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy)) show(index + (dx < 0 ? 1 : -1));
    swipeStart = null;
  });

  const onKey = e => {
    if (e.key === "Escape") close();
    if (e.key === "ArrowRight") show(index + 1);
    if (e.key === "ArrowLeft") show(index - 1);
    if (e.key === "+" || e.key === "=") zoomIn.click();
    if (e.key === "-") zoomOut.click();
  };
  window.addEventListener("keydown", onKey);

  function close() {
    window.removeEventListener("keydown", onKey);
    viewer.remove();
    document.body.classList.remove("no-scroll");
  }
  closeBtn.addEventListener("click", close);
  stage.addEventListener("click", e => {
    if (e.target === stage) close();
  });

  show(index);
  return viewer;
}

async function videoPlayer(file) {
  const url = await mediaLink(file, "preview");
  if (!url) return unsupported(file, { title: t("preview.tooBig"), text: t("preview.tooBigText") });

  const video = el("video", { src: url, playsinline: "", preload: "metadata" });
  const title = el("div", { class: "vp-title", text: file.fileName || "" });
  const playIcon = el("span", { html: icon("play", { size: 22 }) });
  const playBtn = el("button", { class: "vp-btn is-primary", "aria-label": t("action.play"), html: playIcon });
  const cur = el("span", { class: "vp-time", text: "0:00" });
  const dur = el("span", { class: "vp-time", text: "0:00" });
  const seek = el("input", { class: "vp-seek", type: "range", min: "0", max: "1000", value: "0" });
  const muteBtn = el("button", { class: "vp-btn", "aria-label": t("action.mute"), html: icon("volume", { size: 18 }) });
  const speedBtn = el("button", { class: "vp-speed", text: "1x" });
  const fsBtn = el("button", { class: "vp-btn", "aria-label": t("action.fullscreen"), html: icon("expand", { size: 18 }) });
  const center = el("div", { class: "vp-center" }, el("span", { html: icon("play", { size: 28 }) }));
  const closeBtn = el("button", { class: "icon-btn", "aria-label": t("action.close"), html: icon("close", { size: 20 }) });
  const sendBtn = el("button", { class: "icon-btn", "aria-label": t("action.sendToTelegram"), html: icon("send", { size: 19 }) });

  const controls = el(
    "div",
    { class: "vp-controls" },
    el("div", { class: "vp-row" }, cur, seek, dur),
    el("div", { class: "vp-row", style: { justifyContent: "center" } }, playBtn, muteBtn, speedBtn, fsBtn)
  );

  const stage = el("div", { class: "vp-stage" }, video, center);
  const player = el(
    "div",
    { class: "vplayer", role: "dialog", "aria-modal": "true" },
    el("div", { class: "vp-top" }, closeBtn, title, sendBtn),
    stage,
    controls
  );
  document.body.append(player);
  document.body.classList.add("no-scroll");

  const speeds = [1, 1.25, 1.5, 2, 0.5];
  let speedIdx = 0;
  let hideTimer = null;

  const togglePlay = () => (video.paused ? safePlay(video) : video.pause());

  video.addEventListener("loadedmetadata", () => {
    dur.textContent = formatDuration(video.duration);
  });
  video.addEventListener("timeupdate", () => {
    cur.textContent = formatDuration(video.currentTime);
    if (video.duration) seek.value = String(Math.round((video.currentTime / video.duration) * 1000));
  });
  video.addEventListener("play", () => {
    playIcon.innerHTML = icon("pause", { size: 22 });
    center.style.opacity = "0";
  });
  video.addEventListener("pause", () => {
    playIcon.innerHTML = icon("play", { size: 22 });
    center.style.opacity = "1";
    showControls();
  });
  video.addEventListener("ended", () => {
    playIcon.innerHTML = icon("play", { size: 22 });
    center.style.opacity = "1";
    showControls();
  });
  video.addEventListener("error", () => toast(t("preview.unsupported"), "error"));

  playBtn.addEventListener("click", togglePlay);
  center.addEventListener("click", togglePlay);
  stage.addEventListener("click", e => {
    if (e.target === stage || e.target === video) togglePlay();
  });
  muteBtn.addEventListener("click", () => {
    video.muted = !video.muted;
    muteBtn.innerHTML = icon(video.muted ? "mute" : "volume", { size: 18 });
  });
  speedBtn.addEventListener("click", () => {
    speedIdx = (speedIdx + 1) % speeds.length;
    video.playbackRate = speeds[speedIdx];
    speedBtn.textContent = `${speeds[speedIdx]}x`;
  });
  fsBtn.addEventListener("click", async () => {
    try {
      if (!document.fullscreenElement) {
        await player.requestFullscreen?.();
        fsBtn.innerHTML = icon("compress", { size: 18 });
      } else {
        await document.exitFullscreen?.();
        fsBtn.innerHTML = icon("expand", { size: 18 });
      }
    } catch {}
  });
  seek.addEventListener("input", () => {
    if (video.duration) video.currentTime = (Number(seek.value) / 1000) * video.duration;
  });
  sendBtn.addEventListener("click", () => send(file));

  function showControls() {
    controls.classList.remove("is-hidden");
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (!video.paused) controls.classList.add("is-hidden");
    }, 3200);
  }
  stage.addEventListener("mousemove", showControls);
  stage.addEventListener("touchstart", showControls, { passive: true });

  const onKey = e => {
    if (e.key === "Escape" && !document.fullscreenElement) close();
    if (e.key === " ") { e.preventDefault(); togglePlay(); }
    if (e.key === "ArrowRight") video.currentTime = Math.min(video.duration || 0, video.currentTime + 10);
    if (e.key === "ArrowLeft") video.currentTime = Math.max(0, video.currentTime - 10);
  };
  window.addEventListener("keydown", onKey);

  function close() {
    window.removeEventListener("keydown", onKey);
    video.pause();
    video.removeAttribute("src");
    player.remove();
    document.body.classList.remove("no-scroll");
  }
  closeBtn.addEventListener("click", close);
  showControls();
  safePlay(video);
  return player;
}

function audioPlayer(file, playlist) {
  const list = playlist.length ? playlist : [file];
  let index = Math.max(0, list.findIndex(f => f.id === file.id));
  let shuffle = false;
  let repeat = false;

  const audio = typeof window.Audio === "function" ? new window.Audio() : document.createElement("audio");
  audio.preload = "metadata";

  const art = el("div", { class: "ap-art" }, icon("audio", { size: 62 }));
  const title = el("div", { class: "ap-title", text: "" });
  const sub = el("div", { class: "ap-sub", text: "" });
  const cur = el("span", { text: "0:00" });
  const dur = el("span", { text: "0:00" });
  const seek = el("input", { class: "ap-seek", type: "range", min: "0", max: "1000", value: "0" });
  const mainIcon = el("span", { html: icon("play", { size: 26 }) });
  const mainBtn = el("button", { class: "ap-btn is-main", "aria-label": t("action.play"), html: mainIcon });

  const back = el("button", { class: "ap-btn", "aria-label": t("action.previous"), html: icon("stepBack", { size: 19 }) });
  const fwd = el("button", { class: "ap-btn", "aria-label": t("action.next"), html: icon("stepForward", { size: 19 }) });
  const shuffleBtn = el("button", { class: "ap-btn", "aria-label": t("action.shuffle"), html: icon("shuffle", { size: 18 }) });
  const repeatBtn = el("button", { class: "ap-btn", "aria-label": t("action.loop"), html: icon("repeat", { size: 18 }) });

  const plWrap = el("div", { class: "ap-playlist" });
  const body = el(
    "div",
    { class: "aplayer" },
    art,
    title,
    sub,
    seek,
    el("div", { class: "ap-times" }, cur, dur),
    el("div", { class: "ap-controls" }, shuffleBtn, back, mainBtn, fwd, repeatBtn),
    plWrap
  );

  const footer = el("div", { class: "confirm-actions" },
    el("button", { class: "btn btn-ghost" }, icon("download", { size: 15 }), el("span", { text: t("action.download") })),
    el("button", { class: "btn btn-primary" }, icon("send", { size: 15 }), el("span", { text: t("action.sendToTelegram") }))
  );

  const dialog = sheet({ title: t("action.preview"), body, footer, size: "md", onClose: () => audio.pause() });

  async function load(i) {
    index = (i + list.length) % list.length;
    const track = list[index];
    title.textContent = track.fileName || "—";
    sub.textContent = `${(extOf(track.fileName) || "audio").toUpperCase()} · ${formatSize(track.fileSize)}`;
    const url = await mediaLink(track, "preview");
    if (!url) {
      toast(t("preview.unsupported"), "error");
      return;
    }
    audio.src = url;
    audio.load();
    renderPlaylist();
    play();
  }

  function play() {
    safePlay(audio);
  }

  audio.addEventListener("play", () => {
    mainIcon.innerHTML = icon("pause", { size: 26 });
    art.classList.add("is-playing");
  });
  audio.addEventListener("pause", () => {
    mainIcon.innerHTML = icon("play", { size: 26 });
    art.classList.remove("is-playing");
  });
  audio.addEventListener("loadedmetadata", () => {
    dur.textContent = formatDuration(audio.duration);
  });
  audio.addEventListener("timeupdate", () => {
    cur.textContent = formatDuration(audio.currentTime);
    if (audio.duration) seek.value = String(Math.round((audio.currentTime / audio.duration) * 1000));
  });
  audio.addEventListener("ended", () => {
    if (repeat) return play();
    if (shuffle) return load(Math.floor(Math.random() * list.length));
    if (index < list.length - 1) return load(index + 1);
    art.classList.remove("is-playing");
  });
  audio.addEventListener("error", () => toast(t("preview.unsupported"), "error"));

  mainBtn.addEventListener("click", () => (audio.paused ? play() : audio.pause()));
  back.addEventListener("click", () => load(index - 1));
  fwd.addEventListener("click", () => load(index + 1));
  shuffleBtn.addEventListener("click", () => {
    shuffle = !shuffle;
    shuffleBtn.classList.toggle("is-on", shuffle);
  });
  repeatBtn.addEventListener("click", () => {
    repeat = !repeat;
    repeatBtn.classList.toggle("is-on", repeat);
  });
  seek.addEventListener("input", () => {
    if (audio.duration) audio.currentTime = (Number(seek.value) / 1000) * audio.duration;
  });
  footer.children[0].addEventListener("click", () => download(list[index]));
  footer.children[1].addEventListener("click", () => {
    dialog.close();
    send(list[index]);
  });

  function renderPlaylist() {
    if (list.length < 2) {
      plWrap.classList.add("hidden");
      return;
    }
    plWrap.innerHTML = "";
    plWrap.append(el("div", { class: "ap-pl-head", text: `${t("preview.openOriginal")} · ${list.length}` }));
    list.forEach((track, i) => {
      const item = el(
        "div",
        { class: `ap-pl-item ${i === index ? "is-active" : ""}` },
        el("span", { class: "ap-pl-num", text: String(i + 1) }),
        el("span", { class: "truncate", text: track.fileName }),
        el("span", { class: "ap-pl-size", text: formatSize(track.fileSize) })
      );
      item.addEventListener("click", () => load(i));
      plWrap.append(item);
    });
  }

  load(index);
  return dialog;
}

async function documentPreview(file) {
  const ext = extOf(file.fileName);

  if (ext === "pdf") {
    const url = await mediaLink(file, "preview");
    const body = el("div", { class: "doc-preview", style: { padding: "0", background: "#fff" } }, el("iframe", { src: url, title: file.fileName || "pdf" }));
    const footer = el("div", { class: "confirm-actions" },
      el("button", { class: "btn btn-ghost" }, icon("external", { size: 15 }), el("span", { text: t("preview.openOriginal") })),
      el("button", { class: "btn btn-primary" }, icon("send", { size: 15 }), el("span", { text: t("action.sendToTelegram") }))
    );
    const dialog = sheet({ title: file.fileName || t("action.preview"), body, footer, size: "lg" });
    footer.children[0].addEventListener("click", () => window.open(url, "_blank"));
    footer.children[1].addEventListener("click", () => {
      dialog.close();
      send(file);
    });
    return dialog;
  }

  if (TEXT_EXT.includes(ext)) {
    const url = await mediaLink(file, "preview");
    const body = el("div", { class: "doc-preview" });
    body.append(inlineLoader());
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      body.innerHTML = "";
      body.textContent = text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}\n…` : text;
    } catch {
      body.innerHTML = "";
      body.textContent = t("preview.unsupportedText");
    }
    const dialog = sheet({ title: file.fileName || t("action.preview"), body, size: "lg" });
    return dialog;
  }

  return unsupported(file);
}