// icons.js — Font Awesome Free 7 (solid) glyph set, served locally.
// No inline SVG anywhere: every icon is a font glyph from /public/fonts/fa-solid-900.woff2
// (subset CSS in /public/css/icons.css), so it renders crisply at any size and
// works inside Telegram's iframe, offline and under the strict CSP.
const MAP = {
  cloud: "fa-cloud",
  home: "fa-house",
  files: "fa-folder-open",
  image: "fa-image",
  video: "fa-film",
  audio: "fa-music",
  file: "fa-file",
  pdf: "fa-file-pdf",
  word: "fa-file-word",
  excel: "fa-file-excel",
  powerpoint: "fa-file-powerpoint",
  text: "fa-file-lines",
  code: "fa-file-code",
  archive: "fa-file-zipper",
  search: "fa-magnifying-glass",
  settings: "fa-gear",
  star: "fa-star",
  trash: "fa-trash",
  send: "fa-paper-plane",
  download: "fa-download",
  upload: "fa-upload",
  refresh: "fa-arrows-rotate",
  close: "fa-xmark",
  check: "fa-check",
  plus: "fa-plus",
  more: "fa-ellipsis",
  menu: "fa-bars",
  back: "fa-chevron-left",
  chevronRight: "fa-chevron-right",
  chevronDown: "fa-chevron-down",
  block: "fa-ban",
  eye: "fa-eye",
  edit: "fa-pen-to-square",
  shield: "fa-shield-halved",
  lock: "fa-lock",
  globe: "fa-globe",
  users: "fa-users",
  chart: "fa-chart-column",
  crown: "fa-crown",
  bell: "fa-bell",
  bolt: "fa-bolt",
  info: "fa-circle-info",
  warning: "fa-triangle-exclamation",
  expand: "fa-expand",
  compress: "fa-compress",
  play: "fa-play",
  pause: "fa-pause",
  volume: "fa-volume-high",
  mute: "fa-volume-xmark",
  shuffle: "fa-shuffle",
  repeat: "fa-repeat",
  grid: "fa-table-cells-large",
  list: "fa-list",
  sort: "fa-arrow-down-wide-short",
  filter: "fa-filter",
  keyboard: "fa-keyboard",
  moon: "fa-moon",
  sun: "fa-sun",
  logout: "fa-right-from-bracket",
  folder: "fa-folder",
  clock: "fa-clock",
  note: "fa-note-sticky",
  restore: "fa-rotate-left",
  external: "fa-up-right-from-square",
  copy: "fa-copy",
  link: "fa-link",
  sparkles: "fa-wand-magic-sparkles",
  broadcast: "fa-tower-broadcast",
  broom: "fa-broom",
  server: "fa-server",
  zoomIn: "fa-magnifying-glass-plus",
  zoomOut: "fa-magnifying-glass-minus",
  calendar: "fa-calendar",
  headset: "fa-headset",
  stepBack: "fa-backward-step",
  stepForward: "fa-forward-step"
};

/**
 * Renders an icon as a Font Awesome glyph.
 * The signature is kept identical to the old SVG implementation
 * (size in px, extra class, inline style) so all call sites work unchanged.
 * @param {string} name
 * @param {{size?:number, className?:string, stroke?:number, style?:string}} opts
 */
export function icon(name, opts = {}) {
  const { size = 20, className = "", style = "" } = opts;
  const glyph = MAP[name] || MAP.file;
  return `<i class="fa-solid ${glyph} icon ${className}" aria-hidden="true" style="font-size:${Number(size) || 20}px${style ? ";" + style : ""}"></i>`;
}

/** All icon names (used by the dev-only icon gallery) */
export const iconNames = Object.keys(MAP);
