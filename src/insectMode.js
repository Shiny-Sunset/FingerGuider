import { Isopod } from "./character.js";
import { IsopodRenderer3D } from "./isopodRenderer3D.js";
import { FaceInput } from "./faceInput.js";
import { pixelateCanvas } from "./pixelate.js";
import { PIXEL_SIZE } from "./renderConfig.js";

// 状態機械
const LIVE = "live"; // カメラ映像＋顔にダンゴムシが群がる
const CUTIN = "cutin"; // 撮影直後：ちびキャラのカットイン
const EATING = "eating"; // 静止画の顔をダンゴムシが虫食い
const FINISH = "finish"; // 完成カットイン（ごちそうさま）
const RESULT = "result"; // ダウンロード選択

const LIVE_DANGO = 20; // ライブモードで徘徊させる数
const DANGO_PER_FACE = 20; // 捕食時、顔1つあたりのダンゴムシ数
const MAX_EAT_DANGO = 12;

// 虫食いモードだけのダンゴムシの大きさ倍率（インタラクションモードには影響しない）。
// 1.0＝通常サイズ。大きくすると顔を覆う穴も大きく・早くなる。
const DANGO_SIZE = 2.0;

const CUTIN_MS = 1400; // カットイン表示時間
const FINISH_MS = 1600; // 完成カットインの長さ

// 虫食いは「顔全体に敷いた“見えない餌（bait）”を食べ終わったか」で判定する。
// 各餌はダンゴムシが近くにいる間だけ食べ進み、その位置に穴が育つ。
const BAIT_HOLE_FRAC = 0.24; // 各餌の穴の目標半径 ＝ 顔サイズ × これ
const BAIT_SPACING_FRAC = 0.25; // 餌の間隔 ＝ 顔サイズ × これ（穴同士が重なって顔全体を覆う）
const BAIT_MARGIN = 1.2; // 顔の輪郭より少し外側まで餌を置く
const BAIT_STOP_FRAC = 1.3; // ダンゴムシが餌の中心から止まる距離 ＝ 穴半径 × これ
const BAIT_EAT_REACH = 1.6; // この距離（穴半径×これ）以内にダンゴムシがいれば食べ進む
const BAIT_EAT_SPEED = 0.0022; // 1ms あたりに食べ進む量（progress 0→1）
const FINISH_EATEN = 0.99; // 餌のこの割合を食べ終わったら完成
const EAT_MAX_MS = 16000; // 万一食べきれない場合の安全タイマー
const EAT_MIN_MS = 1500; // 早すぎる完成を防ぐ最短時間

// カットイン画像（public/ に置くと自動で使われる。無ければ絵文字にフォールバック）。
const CUTIN_IMG_START = `${import.meta.env.BASE_URL}cutin_start.png`;
const CUTIN_IMG_FINISH = `${import.meta.env.BASE_URL}cutin_finish.png`;

// 完成写真に載せるちびキャラ（ドヤ顔＋ピース）。public/chibi_pose.png を置くと使われる。
// 無ければ何も載せずに写真を完成させる。
const CHIBI_POSE_IMG = `${import.meta.env.BASE_URL}chibi_pose.png`;
const CHIBI_SIDE = "right"; // "right" か "left"：写真のどちら側に載せるか
const CHIBI_HEIGHT_FRAC = 0.55; // ちびキャラの高さ ＝ 写真の高さ × これ

export class InsectMode {
  // getStream: async () => MediaStream（handInput のカメラを共有）
  constructor({ getStream }) {
    this.getStream = getStream;

    this.screen = document.getElementById("insectScreen");
    this.video = document.getElementById("insectCam");
    this.canvas = document.getElementById("insectCanvas");
    this.ctx = this.canvas.getContext("2d");
    this.hint = document.getElementById("insectHint");
    this.captureBtn = document.getElementById("captureBtn");
    this.cutin = document.getElementById("cutin");
    this.cutinText = document.getElementById("cutinText");
    this.cutinFace = document.getElementById("cutinFace");
    this.cutinImg = document.getElementById("cutinImg");
    this.resultOverlay = document.getElementById("resultOverlay");
    this.resultImg = document.getElementById("resultImg");

    this.face = new FaceInput();
    this.renderer3d = null; // 初回 enter で遅延生成
    this.isopods = [];

    this.state = LIVE;
    this.active = false;
    this.faces = []; // 画面座標の顔 [{x,y,r}]
    this._raf = null;
    this._lastTime = null;
    this._phaseEnd = 0;
    this._faceInited = false;

    // 撮影・虫食い用
    this.basePhoto = document.createElement("canvas"); // 撮影した静止画
    this.baits = []; // 顔全体に敷く見えない餌 [{x,y,r,cr,progress,seed}]
    this._resultUrl = null;

    // 完成写真に載せるちびキャラ画像を先読みしておく（無ければ naturalWidth=0）
    this.chibiImg = new Image();
    this.chibiImg.src = CHIBI_POSE_IMG;

    this.captureBtn.addEventListener("click", () => this._onCapture());
    document
      .getElementById("downloadBtn")
      .addEventListener("click", () => this._download());
    document
      .getElementById("skipBtn")
      .addEventListener("click", () => this._backToLive());
  }

  // ── 出入り ───────────────────────────────────────────────
  async enter() {
    this.active = true;
    this.screen.classList.remove("hidden");
    this._resize();

    // カメラ映像を全画面 video に流す（handInput のストリームを共有）
    try {
      const stream = await this.getStream();
      if (stream && this.video.srcObject !== stream) {
        this.video.srcObject = stream;
      }
      await this.video.play().catch(() => {});
      // 映像はキャンバスへ描き込むので、video 要素自体は常に隠す（デコードは継続する）
      this.video.style.visibility = "hidden";
    } catch (err) {
      console.warn("虫食いモード：カメラ取得失敗", err);
    }

    // 3D レンダラー（プレビュー窓なし）とダンゴムシは初回のみ生成
    if (!this.renderer3d) {
      this.renderer3d = new IsopodRenderer3D(this.canvas, {
        preview: false,
        sizeScale: DANGO_SIZE,
      });
    }
    if (!this._faceInited) {
      this._faceInited = true;
      this.face
        .init(this.video)
        .catch((err) => console.warn("FaceInput 初期化失敗", err));
    }

    this._toLiveState();
    this._lastTime = null;
    this._raf = requestAnimationFrame((t) => this._loop(t));
  }

  exit() {
    this.active = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    this.screen.classList.add("hidden");
    // ストリームは共有物なので停止しない（video の参照だけ外す）
    this.video.srcObject = null;
  }

  _resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    for (const iso of this.isopods) {
      iso.w = this.canvas.width;
      iso.h = this.canvas.height;
    }
    this.renderer3d?.resize(this.canvas.width, this.canvas.height);
  }

  // 外部（main の resize）から呼ぶ
  onResize() {
    if (this.active && this.state === LIVE) this._resize();
  }

  // ── ダンゴムシ数の管理（3D モデルと同期） ──────────────────
  _setDangoCount(n) {
    while (this.isopods.length < n) {
      this.isopods.push(new Isopod(this.canvas, DANGO_SIZE));
      this.renderer3d.addIsopod();
    }
    while (this.isopods.length > n) {
      this.isopods.pop();
      this.renderer3d.removeIsopod();
    }
  }

  _spawnAtEdges(n) {
    this._setDangoCount(n);
    const W = this.canvas.width;
    const H = this.canvas.height;
    for (const iso of this.isopods) {
      // 画面外周からスタートさせて「這い寄る」演出にする
      const edge = Math.floor(Math.random() * 4);
      if (edge === 0) { iso.x = Math.random() * W; iso.y = 20; }
      else if (edge === 1) { iso.x = Math.random() * W; iso.y = H - 20; }
      else if (edge === 2) { iso.x = 20; iso.y = Math.random() * H; }
      else { iso.x = W - 20; iso.y = Math.random() * H; }
      iso.state = "walk";
      iso.curlT = 0;
      iso.segs = iso._initSegs();
    }
  }

  // ── 状態遷移 ─────────────────────────────────────────────
  _toLiveState() {
    this.state = LIVE;
    this.baits = [];
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.captureBtn.disabled = false;
    this.hint.textContent = "顔を映すとダンゴムシが群がる…📷で撮影";
    this.hint.classList.remove("hidden");
    this.resultOverlay.classList.add("hidden");
    this._setDangoCount(LIVE_DANGO);
  }

  _onCapture() {
    if (this.state !== LIVE) return;
    // 顔スナップショット（今フレームの画面座標）
    const shot = this._mapFaces(this.face.detect());
    if (shot.length === 0) {
      this._flashHint("顔が検出できませんでした");
      return;
    }
    this.faces = shot;
    this._buildBaits();
    this._capturePhoto();

    // ライブのダンゴムシを消す → カットイン
    this._setDangoCount(0);
    this.video.style.visibility = "hidden";
    this.captureBtn.disabled = true;
    this.hint.classList.add("hidden");

    this._showCutin("いっただっきま〜す！", "😋", CUTIN_IMG_START);
    this.state = CUTIN;
    this._phaseEnd = performance.now() + CUTIN_MS;
  }

  _startEating() {
    this._hideCutin();
    this._spawnAtEdges(Math.min(MAX_EAT_DANGO, this.faces.length * DANGO_PER_FACE));
    this.state = EATING;
    const now = performance.now();
    this._eatStart = now;
    this._eatDeadline = now + EAT_MAX_MS;
    this._eatenFrac = 0;
  }

  _startFinish() {
    this._setDangoCount(0);
    this._buildResult();
    this._showCutin("ごちそうさま！✌", "😆", CUTIN_IMG_FINISH);
    this.state = FINISH;
    this._phaseEnd = performance.now() + FINISH_MS;
  }

  _showResult() {
    this._hideCutin();
    if (this._resultUrl) this.resultImg.src = this._resultUrl;
    this.resultOverlay.classList.remove("hidden");
    this.state = RESULT;
  }

  _backToLive() {
    this._toLiveState();
    this._lastTime = null;
  }

  // ── メインループ ─────────────────────────────────────────
  _loop(ts) {
    if (!this.active) return;
    const dt = this._lastTime == null ? 16.667 : Math.min(ts - this._lastTime, 100);
    this._lastTime = ts;

    if (this.state === LIVE) {
      this.faces = this._mapFaces(this.face.detect());
      // ライブは顔の中心付近に集める（半径の半分を停止距離に）
      const live = this.faces.map((f) => ({ x: f.x, y: f.y, r: f.r * 0.5 }));
      this._updateDango(dt, live);
      // カメラ映像を2Dキャンバスへ描き込む（他と同じグリッドで一緒にドット化するため）
      this._drawCameraFrame();
    } else if (this.state === CUTIN) {
      this._drawPhoto();
      if (ts >= this._phaseEnd) this._startEating();
    } else if (this.state === EATING) {
      // まだ食べ終えていない餌へダンゴムシを誘導し、近くにいる餌を食べ進める
      const active = this.baits
        .filter((b) => b.progress < 1)
        .map((b) => ({ x: b.x, y: b.y, r: b.r * BAIT_STOP_FRAC }));
      this._updateDango(dt, active);
      this._eatenFrac = this._updateBaits(dt);
      this._drawPhoto();
      const elapsed = ts - this._eatStart;
      const done = this._eatenFrac >= FINISH_EATEN && elapsed >= EAT_MIN_MS;
      if (done || ts >= this._eatDeadline) this._startFinish();
    } else if (this.state === FINISH) {
      this._drawPhoto();
      if (ts >= this._phaseEnd) this._showResult();
    } else if (this.state === RESULT) {
      this._drawPhoto(); // 完成画像を背景に保持
    }

    // 2Dレイヤー（カメラ／写真／穴）をまとめてドット化（DS風）
    pixelateCanvas(this.canvas, this.ctx, PIXEL_SIZE);

    // ダンゴムシ（3D）は撮影後の静止画の上にも描く＝顔を食べているように見える
    this.renderer3d?.update(this.isopods, dt);
    this.renderer3d?.render();

    this._raf = requestAnimationFrame((t) => this._loop(t));
  }

  _updateDango(dt, attractors) {
    for (let i = 0; i < this.isopods.length; i++) {
      if (this.renderer3d.isUncurlingAt(i)) continue;
      const others = this.isopods.filter((_, j) => j !== i);
      this.isopods[i].update(dt, [], others, [], attractors);
    }
  }

  // ── 顔座標の変換（cover 表示＋左右反転に合わせる） ──────────
  _mapFaces(rawFaces) {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const vW = this.video.videoWidth || 16;
    const vH = this.video.videoHeight || 9;
    const scale = Math.max(W / vW, H / vH); // object-fit: cover
    const dispW = vW * scale;
    const dispH = vH * scale;
    const ox = (W - dispW) / 2;
    const oy = (H - dispH) / 2;
    return rawFaces.map((f) => {
      const sx = ox + f.cx * dispW;
      const sy = oy + f.cy * dispH;
      const rx = (f.nw * dispW) / 2; // 顔の横半径
      const ry = (f.nh * dispH) / 2; // 顔の縦半径
      return {
        x: W - sx, // 左右反転（表示が scaleX(-1)）
        y: sy,
        rx,
        ry,
        r: Math.max(rx, ry), // 代表半径（ライブモードの群がり用）
      };
    });
  }

  // ── 撮影：表示（cover＋反転）と同じ絵を basePhoto に焼く ────
  _capturePhoto() {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const vW = this.video.videoWidth || 16;
    const vH = this.video.videoHeight || 9;
    this.basePhoto.width = W;
    this.basePhoto.height = H;
    const g = this.basePhoto.getContext("2d");
    const scale = Math.max(W / vW, H / vH);
    const srcW = W / scale;
    const srcH = H / scale;
    const srcX = (vW - srcW) / 2;
    const srcY = (vH - srcH) / 2;
    g.save();
    g.translate(W, 0);
    g.scale(-1, 1); // 左右反転
    g.drawImage(this.video, srcX, srcY, srcW, srcH, 0, 0, W, H);
    g.restore();
  }

  // ライブのカメラ映像を、撮影時と同じ cover＋左右反転で 2D キャンバスへ描く。
  // （映像も他レイヤーと同じピクセルグリッドで一緒にドット化させるため）
  _drawCameraFrame() {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    ctx.clearRect(0, 0, W, H);
    if (this.video.readyState < 2) return; // まだ映像が来ていない
    const vW = this.video.videoWidth || 16;
    const vH = this.video.videoHeight || 9;
    const scale = Math.max(W / vW, H / vH);
    const srcW = W / scale;
    const srcH = H / scale;
    const srcX = (vW - srcW) / 2;
    const srcY = (vH - srcH) / 2;
    ctx.save();
    ctx.translate(W, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(this.video, srcX, srcY, srcW, srcH, 0, 0, W, H);
    ctx.restore();
  }

  // 静止画＋虫食い穴を insectCanvas に描く
  _drawPhoto() {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(this.basePhoto, 0, 0, W, H);
    this._punchHoles(ctx);
    // 完成演出（ごちそうさま）以降はちびキャラを写真に載せる
    if (this.state === FINISH || this.state === RESULT) {
      this._drawChibiPose(ctx, W, H);
    }
  }

  // ちびキャラ（ドヤ顔＋ピース）を写真の右端 or 左端・下寄せで描く。
  _drawChibiPose(ctx, W, H) {
    const img = this.chibiImg;
    if (!img || !img.complete || !img.naturalWidth) return;
    const dh = H * CHIBI_HEIGHT_FRAC;
    const dw = img.naturalWidth * (dh / img.naturalHeight);
    const margin = Math.min(W, H) * 0.02;
    const x = CHIBI_SIDE === "left" ? margin : W - dw - margin;
    const y = H - dh - margin;
    ctx.drawImage(img, x, y, dw, dh);
  }

  // 餌の進行度に応じて育った穴を切り抜く。縁を少しぼかして“かじり跡”に見せる。
  _punchHoles(ctx) {
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    for (const b of this.baits) {
      if (b.cr <= 0.5) continue;
      const g = ctx.createRadialGradient(b.x, b.y, b.cr * 0.6, b.x, b.y, b.cr);
      g.addColorStop(0, "rgba(0,0,0,1)");
      g.addColorStop(0.8, "rgba(0,0,0,1)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.cr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // 顔全体（楕円）に見えない餌を格子状に敷き詰める。撮影時に一度だけ作る。
  _buildBaits() {
    this.baits = [];
    for (const f of this.faces) {
      const rx = f.rx * BAIT_MARGIN;
      const ry = f.ry * BAIT_MARGIN;
      const s = (rx + ry) / 2; // 顔の代表サイズ
      const holeR = s * BAIT_HOLE_FRAC;
      const step = s * BAIT_SPACING_FRAC;
      for (let dx = -rx; dx <= rx; dx += step) {
        for (let dy = -ry; dy <= ry; dy += step) {
          if ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) > 1) continue;
          this.baits.push({
            x: f.x + dx + (Math.random() - 0.5) * step * 0.5,
            y: f.y + dy + (Math.random() - 0.5) * step * 0.5,
            r: holeR * (0.85 + Math.random() * 0.3),
            cr: 0, // 現在の穴半径
            progress: 0, // 0=手つかず 1=食べ終わり
          });
        }
      }
    }
  }

  // ダンゴムシが近くにいる餌を食べ進め、穴を育てる。戻り値＝食べ終えた餌の割合。
  _updateBaits(dt) {
    if (this.baits.length === 0) return 1;
    let eaten = 0;
    const growK = 1 - Math.exp(-dt / 150);
    for (const b of this.baits) {
      if (b.progress < 1) {
        const reach = b.r * BAIT_EAT_REACH;
        let near = false;
        for (const iso of this.isopods) {
          const dx = iso.x - b.x;
          const dy = iso.y - b.y;
          if (dx * dx + dy * dy < reach * reach) {
            near = true;
            break;
          }
        }
        if (near) b.progress = Math.min(1, b.progress + BAIT_EAT_SPEED * dt);
      }
      if (b.progress >= 1) eaten++;
      // 穴は食べ進むほど大きく育つ（progress に比例）
      const targetR = b.r * b.progress;
      b.cr += (targetR - b.cr) * growK;
    }
    return eaten / this.baits.length;
  }

  // 完成画像（basePhoto から穴を切り抜いた透過 PNG）を生成
  _buildResult() {
    const W = this.basePhoto.width;
    const H = this.basePhoto.height;
    const out = document.createElement("canvas");
    out.width = W;
    out.height = H;
    const g = out.getContext("2d");
    g.drawImage(this.basePhoto, 0, 0);
    this._punchHoles(g); // basePhoto は画面と同サイズなので餌座標がそのまま合う
    this._drawChibiPose(g, W, H); // ドヤ顔ちびキャラを載せて完成
    pixelateCanvas(out, g, PIXEL_SIZE); // 画面と同じDS風ドット化で保存
    if (this._resultUrl) URL.revokeObjectURL(this._resultUrl);
    this._resultUrl = out.toDataURL("image/png");
  }

  _download() {
    if (!this._resultUrl) return;
    const a = document.createElement("a");
    a.href = this._resultUrl;
    a.download = `mushikui_${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    this._backToLive();
  }

  // ── カットイン演出 ───────────────────────────────────────
  // imgUrl を指定し、その画像が読み込めれば画像を主役に（絵文字＋テキストは隠す）。
  // 読み込めなければ絵文字＋テキストにフォールバックする。
  _showCutin(text, emoji, imgUrl) {
    this.cutinText.textContent = text;
    this.cutinFace.textContent = emoji;
    // 既定は絵文字＋テキスト表示、画像は隠す
    this.cutinText.classList.remove("hidden");
    this.cutinFace.classList.remove("hidden");
    this.cutinImg.classList.add("hidden");
    this.cutin.classList.remove("has-img");

    if (imgUrl) {
      this.cutinImg.onload = () => {
        this.cutinImg.classList.remove("hidden");
        this.cutinFace.classList.add("hidden");
        this.cutinText.classList.add("hidden");
        this.cutin.classList.add("has-img");
      };
      this.cutinImg.onerror = () => {
        this.cutinImg.classList.add("hidden");
        this.cutinFace.classList.remove("hidden");
        this.cutinText.classList.remove("hidden");
        this.cutin.classList.remove("has-img");
      };
      this.cutinImg.src = imgUrl;
    }

    this.cutin.classList.remove("hidden");
    // リフローを挟んでアニメーション用クラスを付与
    void this.cutin.offsetWidth;
    this.cutin.classList.add("show");
  }

  _hideCutin() {
    this.cutin.classList.remove("show");
    this.cutin.classList.add("hidden");
  }

  _flashHint(msg) {
    this.hint.textContent = msg;
    this.hint.classList.remove("hidden");
    clearTimeout(this._hintTimer);
    this._hintTimer = setTimeout(() => {
      if (this.state === LIVE) {
        this.hint.textContent = "顔を映すとダンゴムシが群がる…📷で撮影";
      }
    }, 1800);
  }
}
