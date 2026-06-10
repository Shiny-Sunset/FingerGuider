import { Line } from "./line.js";
import { Isopod } from "./character.js";
import { Renderer } from "./renderer.js";
import { HandInput } from "./handInput.js";

const canvas = document.getElementById("canvas");
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

const renderer = new Renderer(canvas);
const isopod = new Isopod(canvas);

const lines = [];
let activeLine = null;
let lastTime = null;

// MediaPipe 指入力
const handInput = new HandInput();
const cameraEl = document.getElementById("camera");
handInput
  .init(cameraEl)
  .catch((err) => console.warn("カメラ初期化失敗（マウス操作で代替）:", err));

// モード切り替え
let mode = "mouse"; // 'mouse' | 'finger'
const modeBtn = document.getElementById("modeBtn");
const uiText = document.getElementById("uiText");

function setMode(next) {
  mode = next;
  if (mode === "finger") {
    modeBtn.textContent = "☝ 指モード";
    uiText.textContent = "人差し指を立てて線を引いてみよう";
    cameraEl.style.display = "block";
  } else {
    modeBtn.textContent = "🖱 マウスモード";
    uiText.textContent = "マウスをドラッグして線を引いてみよう";
    cameraEl.style.display = "none";
    activeLine = null;
  }
}

modeBtn.addEventListener("click", () =>
  setMode(mode === "mouse" ? "finger" : "mouse"),
);
setMode("mouse"); // 初期状態

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
  if (mode !== "mouse") return;
  const { x, y } = getPos(e);
  activeLine = new Line();
  activeLine.addPoint(x, y);
  lines.push(activeLine);
});

canvas.addEventListener("mousemove", (e) => {
  if (mode !== "mouse" || !activeLine) return;
  const { x, y } = getPos(e);
  activeLine.addPoint(x, y);
});

canvas.addEventListener("mouseup", () => {
  activeLine = null;
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

window.addEventListener("resize", () => {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  isopod.w = canvas.width;
  isopod.h = canvas.height;
});

function loop(ts) {
  const dt = lastTime == null ? 16.667 : Math.min(ts - lastTime, 100);
  lastTime = ts;

  // MediaPipe 指入力（指モードのときのみ）
  const hand =
    mode === "finger" ? handInput.detect(canvas.width, canvas.height) : null;
  if (hand?.gesture === "pointing") {
    if (hand.isNew) {
      activeLine = new Line();
      lines.push(activeLine);
    }
    activeLine?.addPoint(hand.x, hand.y);
  } else if (hand !== null) {
    activeLine = null;
  }

  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i] !== activeLine) lines[i].update(dt);
    if (lines[i].expired) lines.splice(i, 1);
  }

  isopod.update(dt, lines);

  renderer.drawBackground();
  renderer.drawLines(lines);
  renderer.drawIsopod(isopod);
  if (hand?.landmarks) {
    renderer.drawHand(hand.landmarks, hand.gesture === "pointing");
  }

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
