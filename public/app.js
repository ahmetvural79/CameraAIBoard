import {
  HandLandmarker,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35";
import { detectGesture } from "./gestures.js";
import { Board, strokePath } from "./canvas.js";
import { solveImage, solveText, evaluateExpression } from "./solver.js";
import { PointFilter } from "./filters.js";

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";

const COLORS = [
  "#111111",
  "#ffffff",
  "#ff4d4d",
  "#ff9e2c",
  "#ffd633",
  "#4ade80",
  "#22d3ee",
  "#5b8cff",
  "#a855f7",
  "#ff6ad5",
];

// --- Tuning ---
const HOLD_FRAMES = 14; // baş yukarı/aşağı tetikleme için basılı tutma
const SOLVE_COOLDOWN_MS = 1500;
const DRAW_GRACE = 4; // kalemi bu kadar kare boyunca "tutmaya" devam et (titreme toleransı)
const MIN_PT_DIST = 2.2; // bu mesafeden yakın noktaları çizgiye ekleme
const DWELL_MS = 550; // renk kutusunda bekleme süresi
// One-Euro filtre ayarları (normalize edilmiş el koordinatları için)
const FILTER_OPTS = { minCutoff: 1.0, beta: 0.02, dCutoff: 1.0 };

// ---------- DOM ----------
const stage = document.getElementById("stage");
const video = document.getElementById("video");
const boardCanvas = document.getElementById("board");
const overlayCanvas = document.getElementById("overlay");
const octx = overlayCanvas.getContext("2d");
const badge = document.getElementById("gestureBadge");
const toast = document.getElementById("toast");
const splash = document.getElementById("splash");
const splashNote = document.getElementById("splashNote");
const startBtn = document.getElementById("startBtn");
const swatchesEl = document.getElementById("swatches");
const toolbar = document.getElementById("toolbar");
const brushSize = document.getElementById("brushSize");
const solveBtn = document.getElementById("solveBtn");
const clearBtn = document.getElementById("clearBtn");
const correctionCard = document.getElementById("correctionCard");
const correctionInput = document.getElementById("correctionInput");
const correctionAnswer = document.getElementById("correctionAnswer");
const correctionFix = document.getElementById("correctionFix");
const correctionOk = document.getElementById("correctionOk");

// ---------- State ----------
const board = new Board(boardCanvas);
const cursorFilter = new PointFilter(FILTER_OPTS);
// El takibi, ekrana basılan keskin videodan bağımsız küçük bir tuvalde yapılır:
// görüntü net kalır, çıkarım ucuz olur.
const INF_W = 480;
const infCanvas = document.createElement("canvas");
const ictx = infCanvas.getContext("2d");
let handLandmarker = null;
let running = false;
let activeColor = COLORS[3];
let brush = Number(brushSize.value);
let lastVideoTime = -1;

let currentStroke = null; // { color, width, pts:[{x,y}] }
let offCount = 0; // ardışık "çizmeme" karesi (grace için)
let lastErase = null;
let lastGesture = "init";

let heldName = null;
let heldFrames = 0;
let solveLockedUntil = 0;
let solving = false;

// Palet (renk kutuları) ekran konumları + dwell durumu
let toolbarZone = null;
let paletteRects = [];
const dwell = { color: null, start: 0, progress: 0, done: false };

// ---------- UI helpers ----------
function showToast(msg, { error = false, spinner = false, sticky = false } = {}) {
  toast.className = "toast" + (error ? " error" : "");
  toast.innerHTML = spinner
    ? `<span class="spinner"></span><span>${msg}</span>`
    : msg;
  toast.classList.remove("hidden");
  if (!sticky) {
    clearTimeout(showToast._t);
    showToast._t = setTimeout(
      () => toast.classList.add("hidden"),
      error ? 4500 : 1400
    );
  }
}
function hideToast() {
  toast.classList.add("hidden");
}

function buildSwatches() {
  COLORS.forEach((c) => {
    const b = document.createElement("button");
    b.className = "swatch" + (c === activeColor ? " active" : "");
    b.style.background = c;
    b.dataset.color = c;
    b.title = c;
    b.addEventListener("click", () => selectColor(c));
    swatchesEl.appendChild(b);
  });
}

function selectColor(color) {
  activeColor = color;
  document
    .querySelectorAll(".swatch")
    .forEach((s) => s.classList.toggle("active", s.dataset.color === color));
}

function setBadge(name) {
  const map = {
    draw: ["✏️ Çizim", "draw"],
    erase: ["🧽 Silgi", "erase"],
    clear: ["🧹 Temizle", "clear"],
    solve: ["🤖 Çöz", "solve"],
    palette: ["🎨 Renk seç", ""],
    none: ["✋ Hazır", ""],
  };
  const [label, cls] = map[name] || map.none;
  badge.textContent = label;
  badge.className = "gesture-badge" + (cls ? " " + cls : "");
}

function syncCanvasSize() {
  const w = Math.round(stage.clientWidth);
  const h = Math.round(stage.clientHeight);
  board.resize(w, h);
  overlayCanvas.width = w;
  overlayCanvas.height = h;
  computePaletteRects();
}

function rectRel(r, s) {
  return { x: r.left - s.left, y: r.top - s.top, w: r.width, h: r.height };
}
function computePaletteRects() {
  const sr = stage.getBoundingClientRect();
  toolbarZone = rectRel(toolbar.getBoundingClientRect(), sr);
  paletteRects = [...swatchesEl.querySelectorAll(".swatch")].map((el) => ({
    color: el.dataset.color,
    ...rectRel(el.getBoundingClientRect(), sr),
  }));
}
function inRect(p, r) {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

// Normalize landmark → aynalı tuval pikseli
function toCanvas(nx, ny) {
  return { x: (1 - nx) * board.w, y: ny * board.h };
}

// ---------- Stroke state machine ----------
function startStroke(p) {
  currentStroke = { color: activeColor, width: brush, pts: [p] };
  offCount = 0;
}
function addPoint(p) {
  const pts = currentStroke.pts;
  const last = pts[pts.length - 1];
  if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= MIN_PT_DIST)
    pts.push(p);
}
function finalizeStroke() {
  if (currentStroke && currentStroke.pts.length) {
    board.commitStroke(
      currentStroke.pts,
      currentStroke.color,
      currentStroke.width
    );
  }
  currentStroke = null;
  offCount = 0;
}

// ---------- Overlay (canlı çizgi + imleç) ----------
function eraserRadius() {
  return Math.max(34, brush * 3.2);
}
function renderOverlay(name, p) {
  octx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

  // İşlenmemiş (canlı) çizgi overlay üzerinde gösterilir; bitince board'a yazılır.
  if (currentStroke && currentStroke.pts.length) {
    strokePath(octx, currentStroke.pts, currentStroke.color, currentStroke.width);
  }
  if (!p) return;

  if (name === "erase") {
    octx.beginPath();
    octx.arc(p.x, p.y, eraserRadius(), 0, Math.PI * 2);
    octx.strokeStyle = "rgba(255,255,255,0.85)";
    octx.lineWidth = 2;
    octx.stroke();
    octx.fillStyle = "rgba(255,200,84,0.18)";
    octx.fill();
    return;
  }

  if (name === "palette") {
    // dwell ilerleme halkası
    const r = 18;
    octx.beginPath();
    octx.arc(p.x, p.y, r, 0, Math.PI * 2);
    octx.strokeStyle = "rgba(255,255,255,0.35)";
    octx.lineWidth = 4;
    octx.stroke();
    if (dwell.color) {
      octx.beginPath();
      octx.arc(p.x, p.y, r, -Math.PI / 2, -Math.PI / 2 + dwell.progress * Math.PI * 2);
      octx.strokeStyle = dwell.color === "#ffffff" ? "#5b8cff" : dwell.color;
      octx.lineWidth = 4;
      octx.stroke();
    }
    octx.beginPath();
    octx.arc(p.x, p.y, 5, 0, Math.PI * 2);
    octx.fillStyle = "#fff";
    octx.fill();
    return;
  }

  if (name === "draw") {
    octx.beginPath();
    octx.arc(p.x, p.y, Math.max(5, brush * 0.6), 0, Math.PI * 2);
    octx.fillStyle = activeColor;
    octx.fill();
    octx.lineWidth = 2;
    octx.strokeStyle = "rgba(255,255,255,0.9)";
    octx.stroke();
  }
}

// ---------- Palette dwell ----------
function handlePalette(name, p, tNow) {
  const sw = name === "draw" ? paletteRects.find((r) => inRect(p, r)) : null;
  if (sw) {
    if (dwell.color === sw.color) {
      dwell.progress = Math.min(1, (tNow - dwell.start) / DWELL_MS);
      if (tNow - dwell.start >= DWELL_MS && !dwell.done) {
        selectColor(sw.color);
        dwell.done = true;
        showToast("Renk seçildi 🎨");
      }
    } else {
      dwell.color = sw.color;
      dwell.start = tNow;
      dwell.progress = 0;
      dwell.done = false;
    }
  } else {
    dwell.color = null;
    dwell.progress = 0;
    dwell.done = false;
  }
}

// ---------- Held gestures (clear / solve) ----------
function handleHeld(name, tNow) {
  if (name === "clear" || name === "solve") {
    if (heldName === name) heldFrames++;
    else {
      heldName = name;
      heldFrames = 1;
    }
    if (heldFrames > 0 && heldFrames <= HOLD_FRAMES) {
      const dots = "•".repeat(Math.min(3, Math.ceil((heldFrames / HOLD_FRAMES) * 3)));
      badge.textContent = (name === "clear" ? "🧹 Temizle " : "🤖 Çöz ") + dots;
    }
    if (heldFrames === HOLD_FRAMES) {
      if (name === "clear") doClear();
      else if (tNow >= solveLockedUntil) doSolve();
      heldFrames = -99999; // bırakana kadar kilitle
    }
  } else {
    heldName = null;
    heldFrames = 0;
  }
}

// ---------- Core loop ----------
function loop() {
  if (!running) return;
  // Tüm gövde try/catch içinde: tek bir karedeki hata render döngüsünü asla
  // öldürmez (çözüm sonrası "sistem kalıyor" sorununa karşı güvence).
  try {
    const now = performance.now();
    if (video.currentTime !== lastVideoTime && video.readyState >= 2) {
      lastVideoTime = video.currentTime;
      ictx.drawImage(video, 0, 0, infCanvas.width, infCanvas.height);
      const result = handLandmarker.detectForVideo(infCanvas, now);
      if (result.landmarks && result.landmarks.length > 0) {
        handleHand(result.landmarks[0], now);
      } else {
        onNoHand(now);
      }
    }
  } catch (e) {
    console.error("loop error (yoksayıldı):", e);
  }
  requestAnimationFrame(loop);
}

function onNoHand(now) {
  if (currentStroke) {
    offCount++;
    if (offCount > DRAW_GRACE) finalizeStroke();
  }
  lastErase = null;
  handleHeld("none", now);
  cursorFilter.reset();
  lastGesture = "none";
  setBadge("none");
  renderOverlay("none", null);
}

function handleHand(landmarks, now) {
  const g = detectGesture(landmarks);

  // İmleç kaynağı (parmak ucu / avuç) değişince filtreyi sıfırla ki
  // pozisyon zıplaması olmasın.
  if (g.name !== lastGesture) {
    cursorFilter.reset();
    lastGesture = g.name;
  }
  const f = cursorFilter.filter(g.cursor, now);
  const cur = toCanvas(f.x, f.y);

  const inPalette = toolbarZone && inRect(cur, toolbarZone);

  // ---- Palet bölgesi: çizim yok, renk seçimi var ----
  if (inPalette) {
    if (currentStroke) finalizeStroke();
    lastErase = null;
    handleHeld("none", now);
    handlePalette(g.name, cur, now);
    setBadge("palette");
    renderOverlay("palette", cur);
    return;
  }
  dwell.color = null;
  dwell.progress = 0;

  setBadge(g.name);

  // ---- Çizim (grace ile sürekli) ----
  if (g.name === "draw") {
    offCount = 0;
    if (!currentStroke) startStroke(cur);
    else addPoint(cur);
  } else if (currentStroke) {
    offCount++;
    if (offCount > DRAW_GRACE) finalizeStroke();
  }

  // ---- Silgi ----
  if (g.name === "erase") {
    if (currentStroke) finalizeStroke();
    const r = eraserRadius();
    board.eraseSegment(lastErase || cur, cur, r);
    lastErase = cur;
  } else {
    lastErase = null;
  }

  // ---- Baş yukarı/aşağı (çöz / temizle) ----
  handleHeld(g.name, now);

  renderOverlay(g.name, cur);
}

// ---------- Actions ----------
function doClear() {
  currentStroke = null;
  offCount = 0;
  board.clear();
  octx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  correctionCard.classList.add("hidden");
  showToast("Tahta temizlendi");
}

async function doSolve() {
  if (solving) return;
  finalizeStroke(); // son çizgiyi kesin olarak board'a yaz
  octx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  if (board.isEmpty()) {
    showToast("Önce bir denklem çizin ✏️", { error: true });
    return;
  }
  solving = true;
  solveBtn.disabled = true;
  solveLockedUntil = performance.now() + SOLVE_COOLDOWN_MS;
  showToast("Reading…", { spinner: true, sticky: true });

  try {
    const data = board.snapshotForOCR();
    const out = await solveImage(data);
    if (!out.found || out.answer === "") {
      showToast("Denklem okunamadı. Daha net yazmayı deneyin.", { error: true });
    } else {
      board.renderAnswer(out.answer, activeColor);
      showCorrection(out.equation, out.answer);
      hideToast();
    }
  } catch (err) {
    showToast(err.message || "Çözüm başarısız oldu", { error: true });
  } finally {
    solving = false;
    solveBtn.disabled = false;
  }
}

function fmtAns(a) {
  return /[a-zA-Z=]/.test(String(a)) ? String(a) : "= " + a;
}

function showCorrection(equation, answer) {
  correctionInput.value = equation || "";
  correctionAnswer.textContent = fmtAns(answer);
  correctionCard.classList.remove("hidden");
}

async function applyCorrection() {
  const text = correctionInput.value.trim();
  if (!text) return;
  // "x" ya da "=" içeren ifade → cebirsel: sunucuda çöz. Saf aritmetik → yerel.
  const core = text.replace(/=\s*$/, "");
  const isAlgebra = /[a-zA-Z]/.test(core) || core.includes("=");
  correctionFix.disabled = true;
  try {
    let answer;
    if (isAlgebra) {
      showToast("Hesaplanıyor…", { spinner: true, sticky: true });
      const out = await solveText(text);
      hideToast();
      if (!out.found || out.answer === "") throw new Error("Çözülemedi");
      answer = out.answer;
    } else {
      answer = evaluateExpression(text);
    }
    board.renderAnswer(answer, activeColor);
    correctionAnswer.textContent = fmtAns(answer);
    showToast("Güncellendi ✓");
  } catch (err) {
    showToast(err.message || "İfade hesaplanamadı", { error: true });
  } finally {
    correctionFix.disabled = false;
  }
}

// ---------- Startup ----------
async function init() {
  startBtn.disabled = true;
  splashNote.textContent = "Model yükleniyor…";
  try {
    const vision = await FilesetResolver.forVisionTasks(WASM_URL);
    const make = (delegate) =>
      HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate },
        numHands: 1,
        runningMode: "VIDEO",
        minHandDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
    try {
      handLandmarker = await make("GPU");
    } catch (gpuErr) {
      console.warn("GPU delegate başarısız, CPU'ya geçiliyor", gpuErr);
      handLandmarker = await make("CPU");
    }
  } catch (err) {
    console.error(err);
    splashNote.textContent = "Model yüklenemedi. İnternet bağlantınızı kontrol edin.";
    startBtn.disabled = false;
    return;
  }

  splashNote.textContent = "Kamera açılıyor…";
  try {
    // Görüntü keskin kalsın diye kamera yüksek çözünürlükte; el takibi ayrı
    // küçük tuvalde yapıldığı için performans bundan etkilenmez.
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
  } catch (err) {
    console.error(err);
    splashNote.textContent = "Kamera izni reddedildi ya da kamera bulunamadı.";
    startBtn.disabled = false;
    return;
  }

  await new Promise((r) => {
    if (video.videoWidth) return r();
    video.onloadedmetadata = () => r();
  });
  const vw = video.videoWidth,
    vh = video.videoHeight;
  infCanvas.width = INF_W;
  infCanvas.height = Math.max(1, Math.round((INF_W * vh) / vw));
  stage.style.aspectRatio = `${vw} / ${vh}`;
  syncCanvasSize();

  splash.classList.add("hidden");
  running = true;
  setBadge("none");
  loop();
}

// ---------- Events ----------
startBtn.addEventListener("click", init);
clearBtn.addEventListener("click", doClear);
solveBtn.addEventListener("click", doSolve);
brushSize.addEventListener("input", () => (brush = Number(brushSize.value)));
correctionFix.addEventListener("click", applyCorrection);
correctionInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") applyCorrection();
});
correctionOk.addEventListener("click", () => correctionCard.classList.add("hidden"));
window.addEventListener("resize", () => {
  if (running) syncCanvasSize();
});

buildSwatches();
