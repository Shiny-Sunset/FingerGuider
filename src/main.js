import { Line } from "./line.js";
import { Isopod } from "./character.js";
import { Food } from "./food.js";
import { Renderer } from "./renderer.js";
import { HandInput, mapX, TOP_RATIO } from "./handInput.js";
import { IsopodRenderer3D, MODELS } from "./isopodRenderer3D.js";

// タイトル画面 ⇄ インタラクションモード画面の切り替え
// 虫食いモードボタン（startInsectBtn）は友人が別途実装予定のためリスナーなし
const titleScreen = document.getElementById("titleScreen");
const gameScreen = document.getElementById("gameScreen");

document.getElementById("startInteractionBtn").addEventListener("click", () => {
  titleScreen.classList.add("hidden");
  gameScreen.classList.remove("hidden");
});

document.getElementById("backToTitleBtn").addEventListener("click", () => {
  gameScreen.classList.add("hidden");
  titleScreen.classList.remove("hidden");
});

const canvas = document.getElementById("canvas");
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

const renderer = new Renderer(canvas);
const isopodRenderer3D = new IsopodRenderer3D(canvas);

const isopods = [];

function addIsopod() {
  if (isopods.length >= 10) return;
  isopods.push(new Isopod(canvas));
  isopodRenderer3D.addIsopod();
  updateCount();
}

function removeIsopod() {
  if (isopods.length <= 1) return;
  isopods.pop();
  isopodRenderer3D.removeIsopod();
  updateCount();
}

function updateCount() {
  document.getElementById("countDisplay").textContent = isopods.length;
}

addIsopod(); // 初期1匹

const lines = [];
let activeLine = null;
let lastTime = null;

// プレビュー対象：直近にカーソルが触れたダンゴムシ
const PREVIEW_PICK_R = 60; // この距離以内に近づいたら選択
let previewTarget = isopods[0];

function pickIsopod(x, y) {
  let best = null;
  let bestDist = PREVIEW_PICK_R;
  for (const iso of isopods) {
    const d = Math.hypot(iso.x - x, iso.y - y);
    if (d < bestDist) {
      bestDist = d;
      best = iso;
    }
  }
  if (best) previewTarget = best;
}

// 餌
const MAX_FOODS = 40;
const foods = [];
let prevHandGesture = null; // 指ジェスチャーの立ち上がり検出用

function addFood(x, y) {
  if (foods.length >= MAX_FOODS) foods.shift(); // 古いものから消す
  foods.push(new Food(x, y));
}

// MediaPipe 指入力
const handInput = new HandInput();
const cameraEl = document.getElementById("camera");
handInput
  .init(cameraEl)
  .catch((err) => console.warn("カメラ初期化失敗（マウス操作で代替）:", err));

// 指トラッキングが追従する範囲（カメラ上部）を示す枠。falseで非表示。
const SHOW_TRACK_ZONE = false;
const trackZoneEl = document.getElementById("cameraTrackZone");
trackZoneEl.style.height = `${cameraEl.height * TOP_RATIO}px`;

// モード切り替え
let mode = "mouse";
const modeBtn = document.getElementById("modeBtn");
const uiText = document.getElementById("uiText");

function setMode(next) {
  mode = next;
  if (mode === "finger") {
    modeBtn.textContent = "☝ 指モード";
    uiText.textContent = "人差し指を立てて線を引く / ✌️ピースで餌を置く";
    cameraEl.style.display = "block";
    trackZoneEl.style.display = SHOW_TRACK_ZONE ? "block" : "none";
  } else {
    modeBtn.textContent = "🖱 マウスモード";
    uiText.textContent = "ドラッグで線を引く / 右クリックで餌を置く";
    cameraEl.style.display = "none";
    trackZoneEl.style.display = "none";
    activeLine = null;
  }
}

modeBtn.addEventListener("click", () =>
  setMode(mode === "mouse" ? "finger" : "mouse"),
);
setMode("mouse");

document.getElementById("incBtn").addEventListener("click", addIsopod);
document.getElementById("decBtn").addEventListener("click", removeIsopod);

// モデル切り替え（ダンゴムシ ⇄ ちびキャラ）
const modelBtn = document.getElementById("modelBtn");
const modelKeys = Object.keys(MODELS);
modelBtn.addEventListener("click", () => {
  const cur = isopodRenderer3D.getModelKey();
  const next = modelKeys[(modelKeys.indexOf(cur) + 1) % modelKeys.length];
  isopodRenderer3D.switchModel(next);
  modelBtn.textContent = MODELS[next].label;
});

function getPos(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function getTouchPos(e) {
  const rect = canvas.getBoundingClientRect();
  const t = e.touches[0];
  return { x: t.clientX - rect.left, y: t.clientY - rect.top };
}

canvas.addEventListener("mousedown", (e) => {
  if (mode !== "mouse" || e.button !== 0) return; // 左ボタンのみ線を引く
  const { x, y } = getPos(e);
  activeLine = new Line();
  activeLine.addPoint(x, y);
  lines.push(activeLine);
});

canvas.addEventListener("mousemove", (e) => {
  const { x, y } = getPos(e);
  pickIsopod(x, y); // モードに関係なくプレビュー対象を更新
  if (mode !== "mouse" || !activeLine) return;
  activeLine.addPoint(x, y);
});

canvas.addEventListener("mouseup", () => {
  activeLine = null;
});

// 右クリックで餌を配置（コンテキストメニューは抑制）
canvas.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  const { x, y } = getPos(e);
  addFood(x, y);
});
canvas.addEventListener("mouseleave", () => {
  activeLine = null;
});

canvas.addEventListener(
  "touchstart",
  (e) => {
    if (mode !== "mouse") return;
    e.preventDefault();
    const { x, y } = getTouchPos(e);
    activeLine = new Line();
    activeLine.addPoint(x, y);
    lines.push(activeLine);
  },
  { passive: false },
);

canvas.addEventListener(
  "touchmove",
  (e) => {
    if (mode !== "mouse") return;
    e.preventDefault();
    if (!activeLine) return;
    const { x, y } = getTouchPos(e);
    activeLine.addPoint(x, y);
  },
  { passive: false },
);

canvas.addEventListener("touchend", () => {
  activeLine = null;
});

// プレビュー窓の上でホイールするとカメラをズーム
window.addEventListener(
  "wheel",
  (e) => {
    if (!isopodRenderer3D.isPointInPreview(e.clientX, e.clientY)) return;
    e.preventDefault();
    isopodRenderer3D.zoomPreview(e.deltaY);
  },
  { passive: false },
);

window.addEventListener("resize", () => {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  for (const iso of isopods) {
    iso.w = canvas.width;
    iso.h = canvas.height;
  }
  isopodRenderer3D.resize(canvas.width, canvas.height);
});

function loop(ts) {
  const dt = lastTime == null ? 16.667 : Math.min(ts - lastTime, 100);
  lastTime = ts;

  const hand =
    mode === "finger" ? handInput.detect(canvas.width, canvas.height) : null;
  if (hand?.gesture === "pointing") {
    if (hand.isNew) {
      activeLine = new Line();
      lines.push(activeLine);
    }
    activeLine?.addPoint(hand.x, hand.y);
    pickIsopod(hand.x, hand.y);
  } else if (hand !== null) {
    activeLine = null;
  }

  // ✌️ピース（Victory）に切り替わった瞬間、人差し指の先端に餌を1個置く
  const gesture = hand?.gesture ?? null;
  if (gesture === "Victory" && prevHandGesture !== "Victory" && hand.landmarks) {
    const tip = hand.landmarks[8];
    addFood(mapX(tip.x, canvas.width), tip.y * canvas.height + hand.offsetY);
  }
  prevHandGesture = gesture;

  // 対象が削除済みなら先頭にフォールバックし、レンダラーへ渡す
  if (!isopods.includes(previewTarget)) previewTarget = isopods[0];
  isopodRenderer3D.setPreviewTarget(previewTarget);

  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i] !== activeLine) lines[i].update(dt);
    if (lines[i].expired) lines.splice(i, 1);
  }

  // 各ダンゴムシの物理更新（uncurl中はスキップ）
  for (let i = 0; i < isopods.length; i++) {
    if (isopodRenderer3D.isUncurlingAt(i)) continue;
    const others = isopods.filter((_, j) => j !== i);
    isopods[i].update(dt, lines, others, foods);
  }

  // 食べ尽くされた餌を除去
  for (let i = foods.length - 1; i >= 0; i--) {
    if (foods[i].eaten) foods.splice(i, 1);
  }

  renderer.drawBackground();
  renderer.drawLines(lines);
  for (const f of foods) renderer.drawFood(f);
  // プレビュー対象を囲む選択リング（3Dモデルの下＝足元に描画）
  if (previewTarget) renderer.drawHighlight(previewTarget.x, previewTarget.y);
  for (const iso of isopods) renderer.drawIsopod(iso);

  isopodRenderer3D.update(isopods, dt);
  isopodRenderer3D.render();

  if (hand?.landmarks) {
    renderer.drawHand(hand.landmarks, hand.gesture === "pointing", hand.x, hand.y, hand.offsetY);
  }

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
