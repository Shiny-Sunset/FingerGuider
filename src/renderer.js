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
}
