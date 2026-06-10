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

  drawIsopod(isopod) {
    isopod.draw(this.ctx);
  }

  drawHand(landmarks, isPointing) {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;

    ctx.save();

    // 骨格線
    ctx.strokeStyle = 'rgba(80,80,80,0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const [ai, bi] of HAND_CONNECTIONS) {
      const a = landmarks[ai], b = landmarks[bi];
      ctx.moveTo((1 - a.x) * W, a.y * H);
      ctx.lineTo((1 - b.x) * W, b.y * H);
    }
    ctx.stroke();

    // 全ランドマーク（青い小円）
    ctx.fillStyle = 'rgba(80,120,255,0.75)';
    for (const p of landmarks) {
      ctx.beginPath();
      ctx.arc((1 - p.x) * W, p.y * H, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // 人差し指先端（landmark 8）の強調 — 描画中のみ
    if (isPointing) {
      const tip = landmarks[8];
      const tx = (1 - tip.x) * W;
      const ty = tip.y * H;
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
