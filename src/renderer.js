import { mapX } from './handInput.js'

const HAND_CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],
  [5,6],[6,7],[7,8],
  [9,10],[10,11],[11,12],
  [13,14],[14,15],[15,16],
  [17,18],[18,19],[19,20],
  [0,5],[5,9],[9,13],[13,17],[17,0],
]

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }

  drawBackground() {
    this.ctx.fillStyle = '#f5f0e8';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  drawLines(lines) {
    const ctx = this.ctx;
    for (const line of lines) {
      if (line.points.length < 2) continue;
      ctx.save();
      ctx.globalAlpha = line.alpha;
      ctx.beginPath();
      ctx.moveTo(line.points[0].x, line.points[0].y);
      for (let i = 1; i < line.points.length; i++) {
        ctx.lineTo(line.points[i].x, line.points[i].y);
      }
      ctx.strokeStyle = '#4a90d9';
      ctx.lineWidth = line.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.restore();
    }
  }

  drawIsopod(_isopod) {
    // 3D レンダラーに委譲
  }

  // 餌（残量 amount に応じてサイズが縮む緑色のペレット）
  drawFood(food) {
    const ctx = this.ctx;
    const r = 6 + food.amount * 6;
    ctx.save();
    ctx.beginPath();
    ctx.arc(food.x, food.y, r, 0, Math.PI * 2);
    ctx.fillStyle = '#efff96';
    ctx.fill();
    ctx.strokeStyle = 'rgba(60,90,30,0.7)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  // プレビュー対象を囲む選択リング（脈動＋回転する破線）
  drawHighlight(x, y) {
    const ctx = this.ctx;
    const t = Date.now() * 0.003;
    const r = 46 + Math.sin(t * 2) * 3;

    ctx.save();
    ctx.translate(x, y);

    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,170,40,0.95)';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.restore();
  }

  drawHand(landmarks, isPointing, cursorX, cursorY, offsetY) {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;

    // 実サイズのまま（拡大縮小せず）、カーソルと同じシフト量(offsetY)だけ手全体を平行移動する。
    // カーソル計算（handInput.js）と同じ式・同じoffsetYを使うので、指先(8)は常にカーソルと一致する。
    const px = (p) => mapX(p.x, W);
    const py = (p) => p.y * H + offsetY;

    ctx.save();

    // 骨格線
    ctx.strokeStyle = 'rgba(80,80,80,0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const [ai, bi] of HAND_CONNECTIONS) {
      const a = landmarks[ai], b = landmarks[bi];
      ctx.moveTo(px(a), py(a));
      ctx.lineTo(px(b), py(b));
    }
    ctx.stroke();

    // 全ランドマーク（青い小円）
    ctx.fillStyle = 'rgba(80,120,255,0.75)';
    for (const p of landmarks) {
      ctx.beginPath();
      ctx.arc(px(p), py(p), 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // 人差し指先端（landmark 8）の強調 — 描画中のみ。実際の描画位置（マッピング＋平滑化後）に合わせる
    if (isPointing) {
      const tx = cursorX;
      const ty = cursorY;
      ctx.beginPath();
      ctx.arc(tx, ty, 13, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,70,70,0.85)';
      ctx.fill();
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }

    ctx.restore();
  }
}
