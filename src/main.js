import { Line } from './line.js';
import { Isopod } from './character.js';
import { Renderer } from './renderer.js';

const canvas = document.getElementById('canvas');
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

const renderer = new Renderer(canvas);
const isopod = new Isopod(canvas);

const lines = [];
let activeLine = null;
let lastTime = null;

function getPos(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function getTouchPos(e) {
  const rect = canvas.getBoundingClientRect();
  const t = e.touches[0];
  return { x: t.clientX - rect.left, y: t.clientY - rect.top };
}

canvas.addEventListener('mousedown', (e) => {
  const { x, y } = getPos(e);
  activeLine = new Line();
  activeLine.addPoint(x, y);
  lines.push(activeLine);
});

canvas.addEventListener('mousemove', (e) => {
  if (!activeLine) return;
  const { x, y } = getPos(e);
  activeLine.addPoint(x, y);
});

canvas.addEventListener('mouseup', () => { activeLine = null; });
canvas.addEventListener('mouseleave', () => { activeLine = null; });

canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  const { x, y } = getTouchPos(e);
  activeLine = new Line();
  activeLine.addPoint(x, y);
  lines.push(activeLine);
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
  if (!activeLine) return;
  const { x, y } = getTouchPos(e);
  activeLine.addPoint(x, y);
}, { passive: false });

canvas.addEventListener('touchend', () => { activeLine = null; });

window.addEventListener('resize', () => {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  isopod.w = canvas.width;
  isopod.h = canvas.height;
});

function loop(ts) {
  const dt = lastTime == null ? 16.667 : Math.min(ts - lastTime, 100);
  lastTime = ts;

  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i] !== activeLine) lines[i].update(dt);
    if (lines[i].expired) lines.splice(i, 1);
  }

  isopod.update(dt, lines);

  renderer.drawBackground();
  renderer.drawLines(lines);
  renderer.drawIsopod(isopod);

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
