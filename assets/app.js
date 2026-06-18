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
const state = { imageB64: null, mimeType: "image/jpeg", previewUrl: null, style: null, count: 4 };

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
document.querySelectorAll(".count-opt").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.count = parseInt(btn.dataset.count, 10) || 1;
    document.querySelectorAll(".count-opt").forEach((b) => b.classList.remove("selected"));
    btn.classList.add("selected");
    refreshCTA();
  });
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
  const ready = state.imageB64 && state.style;
  generateBtn.disabled = !ready;
  if (ready) ctaHint.textContent = state.count > 1 ? `生成 ${state.count} 个方案 · 约需 30–60 秒` : "约需 20–40 秒生成";
  else if (!state.imageB64) ctaHint.textContent = "先拍一张照片，再选一种风格";
  else ctaHint.textContent = "选择一种装修风格";
}

// ============================================================
// Generate -> background function -> poll status
// ============================================================
generateBtn.addEventListener("click", startGeneration);

async function startGeneration() {
  const jobId = (crypto.randomUUID && crypto.randomUUID()) || String(Date.now()) + Math.random().toString(16).slice(2);
  showOverlay();

  try {
    const kick = await fetch("/.netlify/functions/redesign-background", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: jobId, style: state.style, image: state.imageB64, mimeType: state.mimeType, count: state.count }),
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
  let msgIdx = 0;

  const tick = setInterval(() => {
    const secs = Math.floor((Date.now() - started) / 1000);
    overlayTimer.textContent = secs + "s";
    if (secs > 0 && secs % 6 === 0) {
      msgIdx = (msgIdx + 1) % LOADING_MSGS.length;
      overlayMsg.textContent = LOADING_MSGS[msgIdx];
    }
  }, 1000);

  async function check() {
    if (Date.now() - started > maxMs) {
      clearInterval(tick); hideOverlay();
      alert("生成超时，请稍后重试。");
      return;
    }
    try {
      const res = await fetch(`/.netlify/functions/status?id=${jobId}`);
      const row = await res.json();
      if (row.status === "done" && row.result_url) {
        clearInterval(tick); hideOverlay();
        showResult(row);
        loadRecent();
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

// ============================================================
// Overlay
// ============================================================
function showOverlay() {
  $("overlayTitle").textContent = state.count > 1 ? `正在生成 ${state.count} 个设计方案…` : "正在重新设计你的空间…";
  overlayMsg.textContent = LOADING_MSGS[0];
  overlayTimer.textContent = "0s";
  overlay.hidden = false;
}
function hideOverlay() { overlay.hidden = true; }

// ============================================================
// Result + before/after slider
// ============================================================
function showResult(row) {
  const meta = STYLES.find((s) => s.key === row.style);
  $("resultStyleName").textContent = meta ? meta.name : "设计方案";
  const urls = Array.isArray(row.results) && row.results.length
    ? row.results
    : row.result_url ? [row.result_url] : [];
  if (!urls.length) return;
  resultModal.hidden = false;
  $("resultBack").hidden = true;
  if (urls.length > 1) {
    buildGrid(urls);
    showPane("grid");
  } else {
    openCompare(urls[0]);
  }
}

function buildGrid(urls) {
  const grid = $("resultGrid");
  grid.innerHTML = "";
  urls.forEach((u, i) => {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "grid-cell";
    cell.innerHTML = `<img src="${u}" alt="方案 ${i + 1}" loading="lazy" /><span class="cell-no">方案 ${i + 1}</span>`;
    cell.addEventListener("click", () => {
      openCompare(u);
      $("resultBack").hidden = false;
    });
    grid.appendChild(cell);
  });
}

function openCompare(url) {
  $("afterImg").src = url;
  $("beforeImg").src = state.previewUrl || url;
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
  let dragging = false;

  const setPos = (clientX) => {
    const rect = compare.getBoundingClientRect();
    let pct = ((clientX - rect.left) / rect.width) * 100;
    pct = Math.max(2, Math.min(98, pct));
    beforeWrap.style.width = pct + "%";
    handle.style.left = pct + "%";
  };

  const down = (e) => { dragging = true; setPos(getX(e)); };
  const move = (e) => { if (dragging) { setPos(getX(e)); e.preventDefault(); } };
  const up = () => (dragging = false);
  const getX = (e) => (e.touches ? e.touches[0].clientX : e.clientX);

  // reset to center each open
  beforeWrap.style.width = "50%";
  handle.style.left = "50%";

  handle.onmousedown = down; compare.onmousedown = down;
  handle.ontouchstart = down; compare.ontouchstart = down;
  window.onmousemove = move; window.ontouchmove = move;
  window.onmouseup = up; window.ontouchend = up;
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
      if (!r.result_url) return;
      const img = document.createElement("img");
      img.src = r.result_url;
      img.loading = "lazy";
      img.alt = "设计方案";
      img.addEventListener("click", () => window.open(r.result_url, "_blank"));
      strip.appendChild(img);
    });
    $("recentSection").hidden = false;
  } catch (_) { /* silent */ }
}

loadRecent();
refreshCTA();
