const N_SEGS = 8;
const SEG_GAP = 13;
const AVOID_R = 90;
const CURL_R = 35;
// 交替性転向反応：線を避けるとき、法線（線から離れる向き）に加えて
// 接線（線に沿う向き）へも逃げ、その左右を接触のたびに交互に切り替える。
const LINE_NORMAL_W = 1.0;  // 線から離れる力（法線方向）
const LINE_TANGENT_W = 1.4; // 線に沿って逃げる力（接線方向）。この値が“曲がり”の強さ
const CURL_DUR = 2500;
const BASE_SPEED = 1.8;
const ISOPOD_AVOID_R = 80;
const ISOPOD_PUSH_R = 35;
const FOOD_SENSE_R = 240;   // この距離以内の餌に気づいて寄っていく
const FOOD_EAT_R = 26;      // この距離まで近づくと食べる
const FOOD_PULL = 1.0;      // 餌へ向かうステアリングの強さ
const EAT_RATE = 0.0006;    // 1ms あたりに減らす餌の量

// 誘引点（attractor）：虫食いモードで顔の中心へ群がらせるための強い引力。
// 餌と違い減らず消えない。画面全体を感知範囲にし、到達すると食事状態にする。
const ATTRACT_SENSE_R = 4000; // 事実上どこからでも感知
const ATTRACT_PULL = 2.4;     // 誘引点へ向かうステアリングの強さ（餌より強い）

export class Isopod {
  constructor(canvas, sizeScale = 1) {
    this.w = canvas.width;
    this.h = canvas.height;
    // 見た目の大きさ倍率。反発距離をこれに連動させる（虫食いモードで大きくするため）。
    this.sizeScale = sizeScale;
    this.angle = Math.random() * Math.PI * 2;
    this.x = this.w / 2 + (Math.random() - 0.5) * 100;
    this.y = this.h / 2 + (Math.random() - 0.5) * 100;
    this.segs = this._initSegs();
    this.state = 'walk';
    this.curlT = 0;
    // 交替性転向反応の状態
    this.turnDir = Math.random() < 0.5 ? 1 : -1; // 現在の回頭の左右（±1）
    this._wasNearLine = false; // 前フレームで線に接触していたか（ターンの立ち上がり検出）
  }

  _initSegs() {
    return Array.from({ length: N_SEGS }, (_, i) => ({
      x: this.x - Math.cos(this.angle) * SEG_GAP * i,
      y: this.y - Math.sin(this.angle) * SEG_GAP * i,
    }));
  }

  update(dt, lines, others = [], foods = [], attractors = []) {
    if (this.state === 'curled') {
      this.curlT += dt;
      if (this.curlT >= CURL_DUR) {
        this.state = 'walk';
        this.curlT = 0;
      }
      return;
    }

    let avoidX = 0, avoidY = 0;
    let lineX = 0, lineY = 0; // 線からの回避（法線）だけを先に集める
    let closestDist = Infinity;

    for (const line of lines) {
      if (line.points.length < 2) continue;
      const d = line.distanceTo(this.x, this.y);
      if (d < closestDist) closestDist = d;
      if (d < AVOID_R) {
        const dir = line.avoidDirection(this.x, this.y);
        const str = (1 - d / AVOID_R) ** 2;
        lineX += dir.x * str;
        lineY += dir.y * str;
      }
    }

    if (closestDist < CURL_R) {
      this.state = 'curled';
      this.curlT = 0;
      return;
    }

    // 線による回避が働いているか（餌より線を優先するため先に判定）
    const lineThreat = lineX !== 0 || lineY !== 0;

    // ── 交替性転向反応 ─────────────────────────────────────────
    // 線に触れた瞬間、前回と逆の左右へ回頭して線沿いに逃げる（ダンゴムシ特有の習性）。
    if (lineThreat) {
      if (!this._wasNearLine) this.turnDir = -this.turnDir; // 新たな接触ごとに左右を反転
      this._wasNearLine = true;
      const ln = Math.hypot(lineX, lineY) || 1;
      const nx = lineX / ln, ny = lineY / ln;                 // 線から離れる法線
      const tx = -ny * this.turnDir, ty = nx * this.turnDir;  // 法線を90°回した接線（左右は turnDir で交替）
      avoidX += nx * LINE_NORMAL_W + tx * LINE_TANGENT_W;
      avoidY += ny * LINE_NORMAL_W + ty * LINE_TANGENT_W;
    } else {
      this._wasNearLine = false;
    }

    // ダンゴムシ同士の反発（ステアリング）。反発距離はサイズ倍率に連動。
    const avoidR = ISOPOD_AVOID_R * this.sizeScale;
    for (const other of others) {
      const dx = this.x - other.x;
      const dy = this.y - other.y;
      const dist = Math.hypot(dx, dy);
      if (dist < avoidR && dist > 0.5) {
        const str = (1 - dist / avoidR) ** 2;
        avoidX += (dx / dist) * str * 1.5;
        avoidY += (dy / dist) * str * 1.5;
      }
    }

    // 餌：脅威となる線が無ければ最寄りの餌へ寄り、十分近ければ食べる
    let eating = false;
    if (!lineThreat) {
      let target = null;
      let td = FOOD_SENSE_R;
      for (const f of foods) {
        if (f.amount <= 0) continue;
        const d = Math.hypot(f.x - this.x, f.y - this.y);
        if (d < td) { td = d; target = f; }
      }
      if (target) {
        const fdx = target.x - this.x;
        const fdy = target.y - this.y;
        const fd = Math.hypot(fdx, fdy) || 1;
        if (fd < FOOD_EAT_R) {
          eating = true;
          target.amount -= EAT_RATE * dt;
        } else {
          avoidX += (fdx / fd) * FOOD_PULL;
          avoidY += (fdy / fd) * FOOD_PULL;
        }
      }
    }

    // 誘引点（顔）：脅威の線が無ければ最寄りの顔へ群がる。半径 r 以内で「食事」状態。
    if (!lineThreat && attractors.length) {
      let target = null;
      let td = ATTRACT_SENSE_R;
      for (const a of attractors) {
        const d = Math.hypot(a.x - this.x, a.y - this.y);
        if (d < td) { td = d; target = a; }
      }
      if (target) {
        const adx = target.x - this.x;
        const ady = target.y - this.y;
        const ad = Math.hypot(adx, ady) || 1;
        // 誘引点の r（呼び出し側が指定する停止半径）以内に来たら食べる。
        // それ以外は誘引点へ強く引き寄せる。個体同士の反発で自然に散らばる。
        const eatR = target.r ?? FOOD_EAT_R;
        if (ad < eatR) {
          eating = true;
        } else {
          avoidX += (adx / ad) * ATTRACT_PULL;
          avoidY += (ady / ad) * ATTRACT_PULL;
        }
      }
    }

    if (eating) {
      this.state = 'eating';
      this.angle += (Math.random() - 0.5) * 0.02; // ほぼ静止、わずかに揺れる
    } else {
      this.state = lineThreat ? 'avoid' : 'walk';
      this.angle += (Math.random() - 0.5) * 0.08;
      if (avoidX !== 0 || avoidY !== 0) {
        const targetAngle = Math.atan2(avoidY, avoidX);
        this.angle = lerpAngle(this.angle, targetAngle, 0.15);
      }
    }

    // 移動速度もサイズ倍率に連動（大きい個体ほど速く歩く）
    const step = (eating ? 0 : BASE_SPEED * this.sizeScale) * (dt / 16.667);
    this.x += Math.cos(this.angle) * step;
    this.y += Math.sin(this.angle) * step;

    // ダンゴムシ同士のめり込み解消。押し出し距離もサイズ倍率に連動。
    const pushR = ISOPOD_PUSH_R * this.sizeScale;
    for (const other of others) {
      const dx = this.x - other.x;
      const dy = this.y - other.y;
      const dist = Math.hypot(dx, dy);
      if (dist < pushR && dist > 0.5) {
        const overlap = (pushR - dist) / 2;
        this.x += (dx / dist) * overlap;
        this.y += (dy / dist) * overlap;
      }
    }

    const m = 25;
    if (this.x < m)           { this.x = m;           this.angle = Math.PI - this.angle; }
    if (this.x > this.w - m)  { this.x = this.w - m;  this.angle = Math.PI - this.angle; }
    if (this.y < m)           { this.y = m;           this.angle = -this.angle; }
    if (this.y > this.h - m)  { this.y = this.h - m;  this.angle = -this.angle; }

    this.segs[0].x = this.x;
    this.segs[0].y = this.y;
    for (let i = 1; i < N_SEGS; i++) {
      const p = this.segs[i - 1], c = this.segs[i];
      const dx = c.x - p.x, dy = c.y - p.y;
      const dist = Math.hypot(dx, dy);
      if (dist > SEG_GAP) {
        const r = SEG_GAP / dist;
        c.x = p.x + dx * r;
        c.y = p.y + dy * r;
      }
    }
  }

  draw(ctx) {
    if (this.state === 'curled') {
      this._drawCurled(ctx);
    } else {
      this._drawWalking(ctx);
    }
  }

  _drawWalking(ctx) {
    for (let i = N_SEGS - 1; i >= 0; i--) {
      const { x, y } = this.segs[i];
      const size = 13 - i * 0.9;

      let segAngle = this.angle;
      if (i < N_SEGS - 1) {
        const dx = this.segs[i].x - this.segs[i + 1].x;
        const dy = this.segs[i].y - this.segs[i + 1].y;
        if (Math.hypot(dx, dy) > 0.1) segAngle = Math.atan2(dy, dx);
      }

      ctx.beginPath();
      ctx.ellipse(x, y, size, size * 0.72, segAngle, 0, Math.PI * 2);
      ctx.fillStyle = `hsl(28, 38%, ${i === 0 ? 28 : Math.min(44, 36 + i)}%)`;
      ctx.fill();
      ctx.strokeStyle = 'hsl(28, 30%, 18%)';
      ctx.lineWidth = 0.8;
      ctx.stroke();

      if (i > 0 && i < N_SEGS - 1) {
        const anim = Math.sin(Date.now() * 0.008 + i * 1.2) * 0.25;
        for (const s of [-1, 1]) {
          const baseAngle = segAngle + s * (Math.PI / 2);
          ctx.beginPath();
          ctx.moveTo(
            x + Math.cos(baseAngle) * size * 0.7,
            y + Math.sin(baseAngle) * size * 0.7
          );
          ctx.lineTo(
            x + Math.cos(baseAngle) * size * 0.7 + Math.cos(baseAngle + anim * s) * size * 0.9,
            y + Math.sin(baseAngle) * size * 0.7 + Math.sin(baseAngle + anim * s) * size * 0.9
          );
          ctx.strokeStyle = 'hsl(28, 30%, 20%)';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
    }

    const head = this.segs[0];

    for (const s of [-1, 1]) {
      const ex = head.x + Math.cos(this.angle + s * 0.55) * 7;
      const ey = head.y + Math.sin(this.angle + s * 0.55) * 7;
      ctx.beginPath();
      ctx.arc(ex, ey, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = '#0a0a0a';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(ex + 0.7, ey - 0.7, 0.8, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fill();
    }

    for (const s of [-1, 1]) {
      const a0 = this.angle + s * 0.4;
      ctx.beginPath();
      ctx.moveTo(head.x + Math.cos(a0) * 8, head.y + Math.sin(a0) * 8);
      ctx.quadraticCurveTo(
        head.x + Math.cos(a0 + s * 0.3) * 16,
        head.y + Math.sin(a0 + s * 0.3) * 16,
        head.x + Math.cos(a0 + s * 0.2) * 24,
        head.y + Math.sin(a0 + s * 0.2) * 24
      );
      ctx.strokeStyle = 'hsl(28, 30%, 20%)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  }

  _drawCurled(ctx) {
    const t = Math.min(this.curlT / 300, 1);
    const head = this.segs[0];
    const r = 16 + t * 3;

    const grad = ctx.createRadialGradient(head.x - 4, head.y - 4, 2, head.x, head.y, r);
    grad.addColorStop(0, 'hsl(28, 40%, 48%)');
    grad.addColorStop(1, 'hsl(28, 40%, 26%)');

    ctx.beginPath();
    ctx.arc(head.x, head.y, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = 'hsl(28, 30%, 16%)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.save();
    ctx.translate(head.x, head.y);
    ctx.strokeStyle = 'hsl(28, 30%, 22%)';
    ctx.lineWidth = 0.8;
    for (let i = 1; i <= 3; i++) {
      ctx.beginPath();
      ctx.arc(0, 0, r * (0.28 + i * 0.22), Math.PI * 0.1, Math.PI * 1.75);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function lerpAngle(a, b, t) {
  const diff = ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  return a + diff * t;
}
