import { open } from "@tauri-apps/plugin-dialog";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

const $ = (id) => document.getElementById(id);
const player = $("v");
const stage = $("stage");

/* ---------- persistence ---------- */
const load = (k, d) => {
  try { const v = localStorage.getItem("reelplay." + k); return v ? JSON.parse(v) : d; } catch { return d; }
};
const save = (k, v) => { try { localStorage.setItem("reelplay." + k, JSON.stringify(v)); } catch {} };

let folders = load("folders", []);
const likes = new Set(load("likes", []));
let history = load("history", {});
const settings = Object.assign(
  { random: false, autoNext: false, volume: 1, muted: false, filter: "all", last: null },
  load("settings", {})
);
const saveSettings = () => save("settings", settings);
const saveLikes = () => save("likes", [...likes]);

/* ---------- state ---------- */
let library = [];
let queue = [];
let idx = 0;
let current = null;
let pendingSeek = 0;
let ready = false;
let lastSave = 0;
let skipCount = 0;
let lastDir = 1;

/* ---------- helpers ---------- */
const fmt = (s) => {
  if (!isFinite(s)) return "0:00";
  s = Math.floor(s);
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const parentDir = (p) => p.slice(0, Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/")));
const lastSeg = (p) => p.slice(Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/")) + 1);
const stripExt = (n) => n.replace(/\.[^.]+$/, "");
const shuffle = (a) => {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

function toast(msg, ms = 1800) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove("show"), ms);
}

/* ---------- smart discovery: filters ---------- */
const isResumable = (path) => {
  const h = history[path];
  return !!(h && h.dur && h.pos > 3 && h.pos < h.dur - 3);
};

function filtered() {
  const f = settings.filter;
  if (f === "liked") return library.filter((v) => likes.has(v.path));
  if (f === "continue") {
    return library
      .filter((v) => isResumable(v.path))
      .sort((a, b) => history[b.path].ts - history[a.path].ts);
  }
  if (f.startsWith("dir:")) {
    const d = f.slice(4);
    return library.filter((v) => v.dir === d);
  }
  return library.slice();
}

function rebuildQueue() {
  let list = filtered();
  if (settings.random) list = shuffle(list);
  queue = list;
  if (current) {
    const i = queue.findIndex((v) => v.path === current.path);
    if (i >= 0) {
      if (settings.random && i > 0) {
        const [c] = queue.splice(i, 1);
        queue.unshift(c);
        idx = 0;
      } else {
        idx = i;
      }
      return true;
    }
  }
  idx = 0;
  return false;
}

/* ---------- empty state ---------- */
function emptyMessage() {
  if (!library.length) return "Add a folder with videos to start your feed.";
  if (settings.filter === "liked") return "No liked videos yet. Press L or double-click a video to like it.";
  if (settings.filter === "continue") return "Nothing to continue yet. Watch part of a video and it will show up here.";
  return "No videos in this view.";
}
function syncEmpty() {
  const empty = !queue.length;
  $("empty").classList.toggle("show", empty);
  if (empty) {
    $("emptyText").textContent = emptyMessage();
    $("emptyAdd").style.display = library.length ? "none" : "";
    player.pause();
  }
  return empty;
}

/* ---------- playback ---------- */
function tryPlay() {
  player.muted = settings.muted;
  player.volume = settings.volume;
  player.play().catch(() => {
    player.muted = true;
    updateVolUI();
    player.play().catch(() => {});
    toast("Autoplay was blocked, playing muted. Press M to unmute.");
  });
}

function animate(dir) {
  const w = $("vwrap");
  w.classList.remove("in-next", "in-prev");
  void w.offsetWidth;
  w.classList.add(dir === "next" ? "in-next" : "in-prev");
}

function saveProgress(force) {
  if (!current || !ready || !isFinite(player.duration)) return;
  const now = Date.now();
  if (!force && now - lastSave < 2000) return;
  lastSave = now;
  const pos = player.currentTime;
  const dur = player.duration;
  history[current.path] = { pos: pos > dur - 1 ? 0 : pos, dur, ts: now };
  save("history", history);
}

function playVideo(v, dir) {
  saveProgress(true);
  ready = false;
  current = v;
  settings.last = v.path;
  saveSettings();
  const h = history[v.path];
  pendingSeek = h && h.dur && h.pos > 3 && h.pos < h.dur - 3 ? h.pos : 0;
  player.loop = !settings.autoNext;
  player.src = convertFileSrc(v.path);
  if (dir) animate(dir);
  tryPlay();
  updateUI();
}

function go(delta) {
  if (!queue.length) return;
  lastDir = delta >= 0 ? 1 : -1;
  let n = idx + delta;
  if (n >= queue.length) {
    if (settings.random) {
      const lastPath = current && current.path;
      queue = shuffle(filtered());
      if (queue.length > 1 && queue[0].path === lastPath) queue.push(queue.shift());
    }
    n = 0;
  } else if (n < 0) {
    n = queue.length - 1;
  }
  idx = n;
  playVideo(queue[n], delta >= 0 ? "next" : "prev");
}

function playFromList(v) {
  const i = queue.findIndex((x) => x.path === v.path);
  if (i < 0) return;
  idx = i;
  playVideo(v, i >= 0 ? "next" : null);
  closeDrawer();
}

function togglePlay() {
  if (!current) return;
  if (player.paused) player.play().catch(() => {}); else player.pause();
}

function seekBy(sec) {
  if (!isFinite(player.duration)) return;
  player.currentTime = Math.max(0, Math.min(player.duration, player.currentTime + sec));
}

/* ---------- likes ---------- */
function toggleLike() {
  if (!current) return;
  if (likes.has(current.path)) {
    likes.delete(current.path);
    toast("Removed from favourites");
  } else {
    likes.add(current.path);
    const p = $("heartpop");
    p.classList.remove("go");
    void p.offsetWidth;
    p.classList.add("go");
  }
  saveLikes();
  updateUI();
  renderDrawer();
}

/* ---------- modes ---------- */
function setRandom(on) {
  settings.random = on;
  saveSettings();
  rebuildQueue();
  updateUI();
  toast(on ? "Random mode on" : "Random mode off");
}
function setAutoNext(on) {
  settings.autoNext = on;
  player.loop = !on;
  saveSettings();
  updateUI();
  toast(on ? "Auto-next on" : "Looping current video");
}
function applyFilter(f) {
  const wasEmpty = $("empty").classList.contains("show");
  settings.filter = f;
  saveSettings();
  const keep = rebuildQueue();
  if (!syncEmpty()) {
    if (!keep) playVideo(queue[0], "next");
    else if (wasEmpty) tryPlay();
  }
  updateUI();
  renderDrawer();
}

/* ---------- UI ---------- */
function updateUI() {
  $("vtitle").textContent = current ? stripExt(current.name) : "ReelPlay";
  $("vsub").textContent = current
    ? `${current.folder}  \u2022  ${queue.length ? idx + 1 : 0} / ${queue.length}`
    : "";
  const liked = current && likes.has(current.path);
  $("likeIcon").innerHTML = liked ? "&#9829;" : "&#9825;";
  $("likeBtn").classList.toggle("on", !!liked);
  $("randBtn").classList.toggle("on", settings.random);
  $("autoBtn").classList.toggle("on", settings.autoNext);
  $("tgRandom").textContent = "Random: " + (settings.random ? "ON" : "OFF");
  $("tgAuto").textContent = "Auto-next: " + (settings.autoNext ? "ON" : "OFF");
  updatePlayIcon();
  updateVolUI();
  document.querySelectorAll("#dlist .item").forEach((el) => {
    el.classList.toggle("active", !!current && el.dataset.path === current.path);
  });
}
function updatePlayIcon() { $("playBtn").innerHTML = player.paused ? "&#9654;" : "&#10074;&#10074;"; }
function updateVolUI() {
  const muted = player.muted || player.volume === 0;
  $("muteBtn").innerHTML = muted ? "&#128263;" : "&#128266;";
  $("vol").value = muted ? 0 : Math.round(player.volume * 100);
}
function updateTime() {
  const d = player.duration;
  $("time").textContent = fmt(player.currentTime) + " / " + fmt(d);
  if (isFinite(d) && d > 0) $("seek").value = Math.round((player.currentTime / d) * 1000);
}

function renderDrawer() {
  // folders
  const fl = $("folders");
  fl.innerHTML = "";
  if (!folders.length) fl.innerHTML = '<div class="frow">No folders yet.</div>';
  folders.forEach((f) => {
    const row = document.createElement("div");
    row.className = "frow";
    row.innerHTML = `<span title="${esc(f)}">${esc(f)}</span><a>remove</a>`;
    row.querySelector("a").onclick = () => {
      folders = folders.filter((x) => x !== f);
      save("folders", folders);
      refresh();
    };
    fl.appendChild(row);
  });

  // tabs: All / Liked / Continue / per-folder
  const tabs = $("tabs");
  tabs.innerHTML = "";
  const mk = (label, f) => {
    const b = document.createElement("button");
    b.className = "tab" + (settings.filter === f ? " active" : "");
    b.textContent = label;
    b.onclick = () => applyFilter(f);
    tabs.appendChild(b);
  };
  const contCount = library.filter((v) => isResumable(v.path)).length;
  const likedCount = library.filter((v) => likes.has(v.path)).length;
  mk(`All (${library.length})`, "all");
  mk(`\u2665 Liked (${likedCount})`, "liked");
  mk(`Continue (${contCount})`, "continue");
  const dirs = new Map();
  library.forEach((v) => dirs.set(v.dir, (dirs.get(v.dir) || 0) + 1));
  if (dirs.size > 1) {
    [...dirs.entries()].forEach(([d, n]) => mk(`${lastSeg(d)} (${n})`, "dir:" + d));
  }

  // list
  const list = $("dlist");
  list.innerHTML = "";
  filtered().forEach((v) => {
    const el = document.createElement("div");
    el.className = "item";
    el.dataset.path = v.path;
    const h = history[v.path];
    const pct = h && h.dur ? Math.min(100, Math.round((h.pos / h.dur) * 100)) : 0;
    el.innerHTML =
      `<div class="meta"><div class="nm">${esc(stripExt(v.name))}</div>` +
      `<div class="fd">${esc(v.folder)}</div>` +
      (pct > 0 ? `<div class="pb"><i style="width:${pct}%"></i></div>` : "") +
      `</div>` + (likes.has(v.path) ? '<span class="hrt">&#9829;</span>' : "");
    el.onclick = () => playFromList(v);
    list.appendChild(el);
  });
  document.querySelectorAll("#dlist .item").forEach((el) => {
    el.classList.toggle("active", !!current && el.dataset.path === current.path);
  });
}

function openDrawer() { renderDrawer(); $("drawer").classList.add("open"); $("scrim").classList.add("show"); }
function closeDrawer() { $("drawer").classList.remove("open"); $("scrim").classList.remove("show"); }
const drawerOpen = () => $("drawer").classList.contains("open");

/* ---------- library scanning ---------- */
async function refresh() {
  const map = new Map();
  for (const f of folders) {
    try {
      const r = await invoke("scan_folder", { path: f });
      for (const v of r) {
        v.dir = parentDir(v.path);
        v.folder = lastSeg(v.dir);
        map.set(v.path, v);
      }
    } catch (e) {
      toast("Can't read folder: " + f, 3500);
    }
  }
  library = [...map.values()].sort(
    (a, b) => a.dir.localeCompare(b.dir) || b.name.localeCompare(a.name, undefined, { numeric: true })
  );

  if (!library.length) {
    current = null;
    queue = [];
    idx = 0;
    player.pause();
    player.removeAttribute("src");
    player.load();
    syncEmpty();
    updateUI();
    renderDrawer();
    return;
  }

  if (settings.filter.startsWith("dir:") && !library.some((v) => "dir:" + v.dir === settings.filter)) {
    settings.filter = "all";
    saveSettings();
  }

  const stillThere = current && library.some((v) => v.path === current.path);
  let startWith = null;
  if (!stillThere) {
    current = null;
    startWith = library.find((v) => v.path === settings.last) || null;
  } else {
    current = library.find((v) => v.path === current.path);
  }

  rebuildQueue();
  if (!syncEmpty() && !stillThere) {
    let i = startWith ? queue.findIndex((v) => v.path === startWith.path) : -1;
    if (i < 0) i = 0;
    idx = i;
    playVideo(queue[i], null);
  }
  updateUI();
  renderDrawer();
}

async function addFolder() {
  try {
    const dir = await open({ directory: true, multiple: false });
    if (dir && !folders.includes(dir)) {
      folders.push(dir);
      save("folders", folders);
      await refresh();
    }
  } catch (e) {
    toast("Dialog error: " + e, 4000);
  }
}

/* ---------- fullscreen ---------- */
async function toggleFullscreen() {
  try {
    const w = getCurrentWindow();
    await w.setFullscreen(!(await w.isFullscreen()));
  } catch {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {}
  }
}
async function exitFullscreen() {
  try { await getCurrentWindow().setFullscreen(false); } catch {}
}

/* ---------- video events ---------- */
player.addEventListener("loadedmetadata", () => {
  if (pendingSeek) {
    player.currentTime = pendingSeek;
    toast("Resumed at " + fmt(pendingSeek));
    pendingSeek = 0;
  }
  ready = true;
  updateTime();
});
player.addEventListener("timeupdate", () => { updateTime(); saveProgress(false); });
player.addEventListener("play", updatePlayIcon);
player.addEventListener("pause", () => { updatePlayIcon(); saveProgress(true); });
player.addEventListener("playing", () => { skipCount = 0; });
player.addEventListener("ended", () => { if (settings.autoNext) go(1); });
player.addEventListener("error", () => {
  if (!current) return;
  toast("Can't play this file (codec not supported). Skipping...", 2500);
  skipCount++;
  if (skipCount <= queue.length) setTimeout(() => go(lastDir), 1200);
});
window.addEventListener("beforeunload", () => saveProgress(true));

/* ---------- gestures: swipe, tap, double-tap ---------- */
const vwrap = $("vwrap");
let pd = null;
let lastTap = 0;
let tapTimer = null;

function tap() {
  const now = Date.now();
  if (now - lastTap < 300) {
    clearTimeout(tapTimer);
    lastTap = 0;
    toggleLike();
  } else {
    lastTap = now;
    tapTimer = setTimeout(togglePlay, 260);
  }
}
vwrap.addEventListener("pointerdown", (e) => {
  pd = { x: e.clientX, y: e.clientY };
  try { vwrap.setPointerCapture(e.pointerId); } catch {}
});
vwrap.addEventListener("pointerup", (e) => {
  if (!pd) return;
  const dx = e.clientX - pd.x;
  const dy = e.clientY - pd.y;
  pd = null;
  if (Math.abs(dy) > 70 && Math.abs(dy) > Math.abs(dx)) { go(dy < 0 ? 1 : -1); return; }
  if (Math.abs(dx) < 10 && Math.abs(dy) < 10) tap();
});
vwrap.addEventListener("pointercancel", () => { pd = null; });

let wheelLock = false;
stage.addEventListener("wheel", (e) => {
  e.preventDefault();
  if (wheelLock || Math.abs(e.deltaY) < 15) return;
  wheelLock = true;
  go(e.deltaY > 0 ? 1 : -1);
  setTimeout(() => { wheelLock = false; }, 600);
}, { passive: false });

/* ---------- controls ---------- */
$("playBtn").onclick = togglePlay;
$("likeBtn").onclick = toggleLike;
$("randBtn").onclick = () => setRandom(!settings.random);
$("autoBtn").onclick = () => setAutoNext(!settings.autoNext);
$("libBtn").onclick = openDrawer;
$("closeDrawer").onclick = closeDrawer;
$("scrim").onclick = closeDrawer;
$("fsBtn").onclick = toggleFullscreen;
$("addBtn").onclick = addFolder;
$("emptyAdd").onclick = addFolder;
$("rescanBtn").onclick = () => { refresh(); toast("Rescanned folders"); };
$("tgRandom").onclick = () => setRandom(!settings.random);
$("tgAuto").onclick = () => setAutoNext(!settings.autoNext);
$("clearHist").onclick = () => { history = {}; save("history", history); renderDrawer(); toast("Watch history cleared"); };

$("muteBtn").onclick = () => {
  player.muted = !player.muted;
  settings.muted = player.muted;
  if (!player.muted && player.volume === 0) { player.volume = 0.5; settings.volume = 0.5; }
  saveSettings();
  updateVolUI();
};
$("vol").oninput = (e) => {
  const v = Number(e.target.value) / 100;
  player.volume = v;
  player.muted = v === 0;
  settings.volume = v;
  settings.muted = player.muted;
  saveSettings();
  updateVolUI();
};
$("seek").oninput = (e) => {
  if (isFinite(player.duration)) player.currentTime = (Number(e.target.value) / 1000) * player.duration;
};

// stop buttons/sliders from keeping focus (so Space and arrows go to our handler)
document.addEventListener("click", (e) => { if (e.target.closest("button")) e.target.closest("button").blur(); });
["seek", "vol"].forEach((id) => $(id).addEventListener("change", (e) => e.target.blur()));

/* ---------- keyboard ---------- */
window.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key;
  let handled = true;
  switch (k) {
    case "ArrowDown": case "j": case "J": go(1); break;
    case "ArrowUp": case "k": case "K": go(-1); break;
    case "ArrowRight": seekBy(5); break;
    case "ArrowLeft": seekBy(-5); break;
    case " ": togglePlay(); break;
    case "l": case "L": toggleLike(); break;
    case "m": case "M": $("muteBtn").click(); break;
    case "r": case "R": setRandom(!settings.random); break;
    case "f": case "F": toggleFullscreen(); break;
    case "b": case "B": drawerOpen() ? closeDrawer() : openDrawer(); break;
    case "Escape": if (drawerOpen()) closeDrawer(); else exitFullscreen(); break;
    default: handled = false;
  }
  if (handled) {
    e.preventDefault();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }
}, true);

/* ---------- auto-hide controls ---------- */
let idleTimer = null;
function wake() {
  stage.classList.remove("idle");
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { if (!player.paused && !drawerOpen()) stage.classList.add("idle"); }, 2500);
}
stage.addEventListener("mousemove", wake);
stage.addEventListener("pointerdown", wake);
wake();

/* ---------- init ---------- */
player.volume = settings.volume;
player.muted = settings.muted;
updateUI();
refresh();