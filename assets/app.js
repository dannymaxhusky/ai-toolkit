/* ============================================================
   Reroom — frontend logic
   Flow: capture photo -> pick style -> kick off background
   function -> poll status -> reveal before/after.
   ============================================================ */

const STYLES = [
  {
    key: "minimalist",
    name: "现代简约",
    en: "Modern Minimalist",
    glyph: "▢",
    swatch: "linear-gradient(120deg,#E9E4DA,#CFC7B8)",
    desc: "干净利落的线条，中性色调，低矮家具与隐藏式收纳。",
  },
  {
    key: "scandinavian",
    name: "北欧风",
    en: "Scandinavian",
    glyph: "❋",
    swatch: "linear-gradient(120deg,#F3EEE4,#D8C9A8)",
    desc: "浅色橡木、白墙、温暖织物与绿植，明亮舒适。",
  },
  {
    key: "industrial",
    name: "工业风",
    en: "Industrial Loft",
    glyph: "▦",
    swatch: "linear-gradient(120deg,#9A9388,#5C544B)",
    desc: "裸露砖墙、水泥、黑色金属框与皮革，沉稳粗犷。",
  },
  {
    key: "japandi",
    name: "日式侘寂",
    en: "Japandi",
    glyph: "◠",
    swatch: "linear-gradient(120deg,#E5DDCF,#B7A98F)",
    desc: "低矮木家具、天然材质、素雅大地色，宁静禅意。",
  },
  {
    key: "luxury",
    name: "轻奢风",
    en: "Modern Luxury",
    glyph: "◈",
    swatch: "linear-gradient(120deg,#C9BBA0,#6E5B40)",
    desc: "大理石、黄铜、丝绒，沉稳高级，金色点缀。",
  },
  {
    key: "midcentury",
    name: "中古风",
    en: "Mid-Century",
    glyph: "◉",
    swatch: "linear-gradient(120deg,#D9A86C,#7A5230)",
    desc: "胡桃木、细腿家具、复古撞色，经典摩登。",
  },
  {
    key: "french",
    name: "法式",
    en: "French Parisian",
    glyph: "❀",
    swatch: "linear-gradient(120deg,#EAD9D2,#C99CA0)",
    desc: "石膏线、人字拼地板、复古家具，优雅浪漫。",
  },
  {
    key: "bohemian",
    name: "波西米亚",
    en: "Bohemian",
    glyph: "❖",
    swatch: "linear-gradient(120deg,#D8A488,#9A6A4A)",
    desc: "藤编、织物、绿植、大地色，自由随性。",
  },
];

const LOADING_MSGS = [
  "分析房间结构与透视",
  "保留墙体、门窗与视角",
  "挑选家具与材质",
  "布置灯光与色彩",
  "渲染最终设计方案",
];

// ---- state ----
const TILE_PRESETS = [
  { id: "marble", name: "大理石" },
  { id: "herringbone", name: "木纹" },
  { id: "hexagon", name: "六角砖" },
  { id: "terrazzo", name: "水磨石" },
  { id: "concrete", name: "灰砖" },
  { id: "encaustic", name: "花砖" },
];

const state = {
  imageB64: null, mimeType: "image/jpeg", previewUrl: null,
  style: null, count: 4, provider: "google",
  tilesEnabled: false, selectedTiles: [], tileTargets: { design: true, original: true },
};

// ---- elements ----
const $ = (id) => document.getElementById(id);
const fileInput = $("fileInput");
const dropzone = $("dropzone");
const previewImg = $("previewImg");
const dropzoneInner = $("dropzoneInner");
const retakeBtn = $("retakeBtn");
const styleGrid = $("styleGrid");
const generateBtn = $("generateBtn");
const ctaHint = $("ctaHint");
const overlay = $("overlay");
const overlayMsg = $("overlayMsg");
const overlayTimer = $("overlayTimer");
const resultModal = $("resultModal");

// ============================================================
// Style cards
// ============================================================
STYLES.forEach((s) => {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "style-card";
  card.style.setProperty("--swatch", s.swatch);
  card.dataset.key = s.key;
  card.innerHTML = `
    <span class="sc-check">✓</span>
    <span class="sc-glyph">${s.glyph}</span>
    <span class="sc-name">${s.name}</span>
    <span class="sc-en">${s.en}</span>
    <span class="sc-desc">${s.desc}</span>`;
  card.addEventListener("click", () => selectStyle(s.key, card));
  styleGrid.appendChild(card);
});

function selectStyle(key, card) {
  state.style = key;
  document.querySelectorAll(".style-card").forEach((c) => c.classList.remove("selected"));
  card.classList.add("selected");
  refreshCTA();
}

// ---- count selector ----
document.querySelectorAll("#countSelect .count-opt").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.count = parseInt(btn.dataset.count, 10) || 1;
    document.querySelectorAll("#countSelect .count-opt").forEach((b) => b.classList.remove("selected"));
    btn.classList.add("selected");
    refreshCTA();
  });
});

// (model is always Google Gemini — provider selector removed)

// ============================================================
// Tile swap
// ============================================================
const MAX_TILES = 4;
const tileGrid = $("tileGrid");
const tileUploadEl = $("tileUpload");

// render preset swatches before the upload tile
TILE_PRESETS.forEach((t) => {
  const cell = document.createElement("button");
  cell.type = "button";
  cell.className = "tile-cell";
  cell.dataset.tile = t.id;
  cell.innerHTML = `<img src="/assets/tiles/${t.id}.jpg" alt="${t.name}" loading="lazy" /><span class="tile-name">${t.name}</span><span class="tile-check">✓</span>`;
  cell.addEventListener("click", () => togglePreset(t, cell));
  tileGrid.insertBefore(cell, tileUploadEl);
});

function togglePreset(t, cell) {
  const i = state.selectedTiles.findIndex((x) => x.type === "preset" && x.id === t.id);
  if (i >= 0) {
    state.selectedTiles.splice(i, 1);
    cell.classList.remove("selected");
  } else {
    if (state.selectedTiles.length >= MAX_TILES) { alert(`最多选择 ${MAX_TILES} 种瓷砖`); return; }
    state.selectedTiles.push({ type: "preset", id: t.id, name: t.name });
    cell.classList.add("selected");
  }
  refreshCTA();
}

// tile on/off toggle
document.querySelectorAll("#tileToggle .count-opt").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.tilesEnabled = btn.dataset.tiles === "on";
    document.querySelectorAll("#tileToggle .count-opt").forEach((b) => b.classList.remove("selected"));
    btn.classList.add("selected");
    $("tileDetail").hidden = !state.tilesEnabled;
    refreshCTA();
  });
});

// target chips (multi-select)
document.querySelectorAll("#tileTargets .target-chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    const k = chip.dataset.target;
    state.tileTargets[k] = !state.tileTargets[k];
    chip.classList.toggle("selected", state.tileTargets[k]);
    refreshCTA();
  });
});

// upload custom tiles
$("tileFileInput").addEventListener("change", async (e) => {
  const files = [...(e.target.files || [])];
  for (const f of files) {
    if (state.selectedTiles.length >= MAX_TILES) { alert(`最多选择 ${MAX_TILES} 种瓷砖`); break; }
    const r = await resizeImage(f, 640, 0.85);
    const entry = { type: "upload", name: "自定义", base64: r.base64 };
    state.selectedTiles.push(entry);
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "tile-cell selected";
    cell.innerHTML = `<img src="${r.dataUrl}" alt="自定义瓷砖" /><span class="tile-name">自定义</span><span class="tile-check">✓</span>`;
    cell.addEventListener("click", () => {
      const idx = state.selectedTiles.indexOf(entry);
      if (idx >= 0) state.selectedTiles.splice(idx, 1);
      cell.remove();
      refreshCTA();
    });
    tileGrid.insertBefore(cell, tileUploadEl);
  }
  e.target.value = "";
  refreshCTA();
});

// ============================================================
// Image capture + client-side resize (keeps payload small)
// ============================================================
fileInput.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const resized = await resizeImage(file, 1280, 0.82);
  state.imageB64 = resized.base64;
  state.mimeType = "image/jpeg";
  state.previewUrl = resized.dataUrl;
  previewImg.src = resized.dataUrl;
  previewImg.hidden = false;
  dropzoneInner.style.display = "none";
  retakeBtn.hidden = false;
  dropzone.classList.add("has-image");
  refreshCTA();
});

retakeBtn.addEventListener("click", (e) => {
  e.preventDefault();
  fileInput.value = "";
  fileInput.click();
});

function resizeImage(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > height && width > maxDim) { height = Math.round((height * maxDim) / width); width = maxDim; }
      else if (height > maxDim) { width = Math.round((width * maxDim) / height); height = maxDim; }
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      resolve({ dataUrl, base64: dataUrl.split(",")[1] });
    };
    img.onerror = reject;
    img.src = url;
  });
}

// ============================================================
// CTA gating
// ============================================================
function refreshCTA() {
  const needDesign = !state.tilesEnabled || state.tileTargets.design;
  const hasTarget = state.tileTargets.design || state.tileTargets.original;
  let ready = !!state.imageB64;
  if (needDesign) ready = ready && !!state.style;
  if (state.tilesEnabled) ready = ready && state.selectedTiles.length > 0 && hasTarget;
  generateBtn.disabled = !ready;

  if (!state.imageB64) ctaHint.textContent = "先拍一张照片";
  else if (state.tilesEnabled && state.selectedTiles.length === 0) ctaHint.textContent = "请选择至少一种瓷砖图案";
  else if (state.tilesEnabled && !hasTarget) ctaHint.textContent = "请选择瓷砖应用到哪里";
  else if (needDesign && !state.style) ctaHint.textContent = "选择一种装修风格";
  else if (!needDesign) ctaHint.textContent = "仅在原图上更换地砖 · 约需 20–40 秒";
  else ctaHint.textContent = state.count > 1 ? `生成 ${state.count} 个方案 · 约 30–60 秒` : "约需 20–40 秒生成";
}

// ============================================================
// Generate -> background function -> poll status
// ============================================================
generateBtn.addEventListener("click", startGeneration);

async function startGeneration() {
  const jobId = (crypto.randomUUID && crypto.randomUUID()) || String(Date.now()) + Math.random().toString(16).slice(2);
  showOverlay();

  try {
    // 1. upload the photo via a normal function (handles large bodies)
    const up = await fetch("/.netlify/functions/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: jobId, image: state.imageB64, mimeType: state.mimeType }),
    });
    if (!up.ok) throw new Error(`上传失败 (HTTP ${up.status})`);

    // 1b. upload any custom tile images, build the tiles payload
    const tiles = [];
    if (state.tilesEnabled) {
      let ui = 0;
      for (const t of state.selectedTiles) {
        if (t.type === "preset") {
          tiles.push({ type: "preset", id: t.id, name: t.name });
        } else {
          const key = `tile/${jobId}/${ui++}`;
          const tu = await fetch("/.netlify/functions/upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: jobId, key, image: t.base64, mimeType: "image/jpeg" }),
          });
          if (!tu.ok) throw new Error(`瓷砖上传失败 (HTTP ${tu.status})`);
          tiles.push({ type: "upload", key, name: "自定义" });
        }
      }
    }

    // 2. trigger the background job with just the ids (tiny payload)
    const kick = await fetch("/.netlify/functions/redesign-background", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: jobId, style: state.style, count: state.count, provider: state.provider,
        tilesEnabled: state.tilesEnabled, tiles, tileTargets: state.tileTargets,
      }),
    });
    // Background functions reply 202. Anything 5xx/404 means it isn't deployed.
    if (kick.status >= 400 && kick.status !== 202) {
      throw new Error(`后端未就绪 (HTTP ${kick.status})。请确认 Netlify 函数与环境变量已配置。`);
    }
  } catch (err) {
    hideOverlay();
    alert("启动失败：" + err.message);
    return;
  }

  pollStatus(jobId);
}

async function pollStatus(jobId) {
  const started = Date.now();
  const maxMs = 180000;
  // expected duration drives the time-based creep (Seedance polls remote tasks, so slower)
  const expectedMs = (state.provider === "seedance" ? 70000 : 42000) * (state.count > 1 ? 1.5 : 1);
  let msgIdx = 0;
  let serverProgress = 0;

  const tick = setInterval(() => {
    const secs = Math.floor((Date.now() - started) / 1000);
    overlayTimer.textContent = secs + "s";
    // creep toward 92% based on elapsed time, but never below real server progress
    const creep = Math.min(92, (Date.now() - started) / expectedMs * 92);
    setProgress(Math.max(creep, serverProgress));
    if (secs > 0 && secs % 6 === 0) {
      msgIdx = (msgIdx + 1) % LOADING_MSGS.length;
      overlayMsg.textContent = LOADING_MSGS[msgIdx];
    }
  }, 250);

  async function check() {
    if (Date.now() - started > maxMs) {
      clearInterval(tick); hideOverlay();
      alert("生成超时，请稍后重试。");
      return;
    }
    try {
      const res = await fetch(`/.netlify/functions/status?id=${jobId}`);
      const row = await res.json();
      if (typeof row.progress === "number") serverProgress = row.progress;
      if (row.status === "done" && row.result_url) {
        clearInterval(tick);
        setProgress(100);
        setTimeout(() => { hideOverlay(); showResult(row); loadRecent(); }, 450);
        return;
      }
      if (row.status === "error") {
        clearInterval(tick); hideOverlay();
        alert("生成失败：" + (row.error || "未知错误"));
        return;
      }
    } catch (_) { /* keep polling */ }
    setTimeout(check, 2500);
  }
  setTimeout(check, 3000);
}

function setProgress(pct) {
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  $("progressFill").style.width = p + "%";
  $("progressPct").textContent = p + "%";
}

// ============================================================
// Overlay
// ============================================================
function showOverlay() {
  const designing = !state.tilesEnabled || state.tileTargets.design;
  $("overlayTitle").textContent = !designing
    ? "正在更换地面瓷砖…"
    : state.count > 1 ? `正在生成 ${state.count} 个设计方案…` : "正在重新设计你的空间…";
  overlayMsg.textContent = LOADING_MSGS[0];
  overlayTimer.textContent = "0s";
  setProgress(0);
  overlay.hidden = false;
}
function hideOverlay() { overlay.hidden = true; }

// ============================================================
// Result + before/after slider
// ============================================================
let compareBefore = null; // "before" image url for the compare slider

function showResult(row) {
  const meta = STYLES.find((s) => s.key === row.style);
  $("resultStyleName").textContent = meta ? meta.name : "设计方案";
  compareBefore = state.previewUrl;
  // results may be strings (older jobs) or { url, label } objects
  let items = (Array.isArray(row.results) && row.results.length
    ? row.results
    : row.result_url ? [row.result_url] : []
  ).map((r) => (typeof r === "string" ? { url: r, label: "" } : r));
  if (!items.length) return;
  resultModal.hidden = false;
  $("resultBack").hidden = true;
  if (items.length > 1) {
    buildGrid(items);
    showPane("grid");
  } else {
    openCompare(items[0].url);
  }
}

function buildGrid(items) {
  const grid = $("resultGrid");
  grid.innerHTML = "";
  items.forEach((it, i) => {
    const label = it.label || `方案 ${i + 1}`;
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "grid-cell";
    cell.innerHTML = `<img src="${it.url}" alt="${label}" loading="lazy" /><span class="cell-no">${label}</span>`;
    cell.addEventListener("click", () => {
      openCompare(it.url);
      $("resultBack").hidden = false;
    });
    grid.appendChild(cell);
  });
}

function openCompare(url) {
  $("afterImg").src = url;
  $("beforeImg").src = compareBefore || state.previewUrl || url;
  $("downloadBtn").href = url;
  showPane("compare");
  initCompare();
}

function showPane(which) {
  $("gridPane").hidden = which !== "grid";
  $("comparePane").hidden = which !== "compare";
}

function againReset() {
  resultModal.hidden = true;
  document.getElementById("styleSection").scrollIntoView({ behavior: "smooth" });
}

$("resultBack").addEventListener("click", () => { showPane("grid"); $("resultBack").hidden = true; });
$("resultClose").addEventListener("click", () => (resultModal.hidden = true));
$("againBtn").addEventListener("click", againReset);
$("againBtnGrid").addEventListener("click", againReset);

function initCompare() {
  const compare = $("compare");
  const beforeWrap = $("beforeWrap");
  const handle = $("compareHandle");

  const setPos = (clientX) => {
    const rect = compare.getBoundingClientRect();
    let pct = ((clientX - rect.left) / rect.width) * 100;
    pct = Math.max(2, Math.min(98, pct));
    beforeWrap.style.width = pct + "%";
    handle.style.left = pct + "%";
  };

  // reset to center on each open
  beforeWrap.style.width = "50%";
  handle.style.left = "50%";

  // Bind drag handlers ONCE, scoped to the compare element only.
  // Pointer Events + setPointerCapture keeps tracking without any global/
  // window listeners — so taps on the header buttons are never intercepted.
  if (compare.dataset.bound) return;
  compare.dataset.bound = "1";

  let dragging = false;
  compare.addEventListener("pointerdown", (e) => {
    dragging = true;
    try { compare.setPointerCapture(e.pointerId); } catch (_) {}
    setPos(e.clientX);
  });
  compare.addEventListener("pointermove", (e) => { if (dragging) setPos(e.clientX); });
  const end = () => { dragging = false; };
  compare.addEventListener("pointerup", end);
  compare.addEventListener("pointercancel", end);
}

// ============================================================
// Recent lookbook
// ============================================================
async function loadRecent() {
  try {
    const res = await fetch("/.netlify/functions/recent");
    if (!res.ok) return;
    const rows = await res.json();
    if (!Array.isArray(rows) || !rows.length) return;
    const strip = $("recentStrip");
    strip.innerHTML = "";
    rows.forEach((r) => {
      const url = r.url || r.result_url; // tolerate old entries
      if (!url) return;
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "recent-cell";
      cell.innerHTML = `<img src="${url}" loading="lazy" alt="${r.label || "设计"}" />` +
        (r.label ? `<span class="recent-label">${r.label}</span>` : "");
      cell.addEventListener("click", () => reopenFromRecent({ ...r, url }));
      strip.appendChild(cell);
    });
    $("recentSection").hidden = false;
  } catch (_) { /* silent */ }
}

// reopen a past result straight from history — no regeneration
function reopenFromRecent(r) {
  const meta = STYLES.find((s) => s.key === r.style);
  $("resultStyleName").textContent = r.label || (meta ? meta.name : "设计方案");
  compareBefore = r.original_url || null;
  resultModal.hidden = false;
  $("resultBack").hidden = true;
  openCompare(r.url);
}

loadRecent();
refreshCTA();
