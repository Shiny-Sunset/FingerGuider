const MAX_AGE = 5000;

export class Line {
  constructor() {
    this.points = [];
    this.age = 0;
    this.width = 5;
  }

  addPoint(x, y) {
    const last = this.points[this.points.length - 1];
    if (!last || Math.hypot(x - last.x, y - last.y) > 4) {
      this.points.push({ x, y });
    }
  }

  update(dt) {
    this.age += dt;
  }

  get alpha() {
    return Math.max(0, 1 - this.age / MAX_AGE);
  }

  get expired() {
    return this.age >= MAX_AGE;
  }

  distanceTo(px, py) {
    if (this.points.length < 2) return Infinity;
    let min = Infinity;
    for (let i = 0; i < this.points.length - 1; i++) {
      const d = segDist(px, py, this.points[i], this.points[i + 1]);
      if (d < min) min = d;
    }
    return min;
  }

  avoidDirection(px, py) {
    let minD = Infinity;
    let cx = 0, cy = 0;
    for (let i = 0; i < this.points.length - 1; i++) {
      const r = segClosest(px, py, this.points[i], this.points[i + 1]);
      if (r.dist < minD) { minD = r.dist; cx = r.cx; cy = r.cy; }
    }
    const len = Math.hypot(px - cx, py - cy);
    if (len < 0.001) return { x: 1, y: 0 };
    return { x: (px - cx) / len, y: (py - cy) / len };
  }
}

function segClosest(px, py, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq < 1e-10 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / lenSq));
  const cx = a.x + t * dx, cy = a.y + t * dy;
  return { dist: Math.hypot(px - cx, py - cy), cx, cy };
}

function segDist(px, py, a, b) {
  return segClosest(px, py, a, b).dist;
}
