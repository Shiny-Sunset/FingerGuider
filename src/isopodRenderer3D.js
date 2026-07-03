import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as skeletonClone } from "three/addons/utils/SkeletonUtils.js";
import dangomushiUrl from "../model/dangomushi.glb?url";
import dangoGirlUrl from "../model/DangoGirl.glb?url";
import { PIXEL_SIZE, TOON } from "./renderConfig.js";

// トゥーン用の階調マップ（3段）。NearestFilter で段階的なセル調の陰影になる。
function makeGradientMap() {
  const steps = new Uint8Array([90, 170, 255]);
  const tex = new THREE.DataTexture(steps, steps.length, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}
const GRADIENT_MAP = TOON ? makeGradientMap() : null;

// 既存マテリアルをトゥーン（MeshToonMaterial）へ変換。テクスチャ・色・名前を引き継ぐ
// （口アトラスの検出や表情制御が name/map に依存しているため保持が必須）。
function toToonMaterial(mat) {
  if (!mat || mat.isMeshToonMaterial) return mat;
  const toon = new THREE.MeshToonMaterial({
    color: mat.color ? mat.color.clone() : new THREE.Color(0xffffff),
    map: mat.map ?? null,
    gradientMap: GRADIENT_MAP,
    transparent: mat.transparent ?? false,
    opacity: mat.opacity ?? 1,
    alphaTest: mat.alphaTest ?? 0,
    side: mat.side ?? THREE.FrontSide,
  });
  toon.name = mat.name;
  if (mat.alphaMap) toon.alphaMap = mat.alphaMap;
  if (mat.emissive && toon.emissive) toon.emissive.copy(mat.emissive);
  if (mat.emissiveMap) toon.emissiveMap = mat.emissiveMap;
  return toon;
}

// クローンしたシーンの全メッシュをトゥーンマテリアルへ差し替える。
function applyToon(scene) {
  if (!TOON) return;
  scene.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    o.material = Array.isArray(o.material)
      ? o.material.map(toToonMaterial)
      : toToonMaterial(o.material);
  });
}

// 切り替え可能なモデルの定義。targetSize はバウンディングボックス対角線の
// ピクセル長、rotX/rotY はモデルを画面に正対させるための初期回転。
export const MODELS = {
  dangomushi: {
    label: "ダンゴムシ",
    url: dangomushiUrl,
    targetSize: 80,
    rotX: Math.PI / 2,
    rotY: Math.PI / 2,
  },
  dangogirl: {
    label: "ちびキャラ",
    url: dangoGirlUrl,
    targetSize: 120,
    rotX: Math.PI / 2,
    rotY: Math.PI / 2,
    // 状態 → クリップ名の対応。これを持つモデルは設定済みアニメ制御を使う。
    anim: {
      idle: "Idle",
      walk: "Walk",
      run: "Run",
      curlIn: "Curl_up1", // 丸まる
      curlLoop: "Curl_up_loop", // 丸まったまま頭を抱える（ループ）
      curlOut: "Curl_up2", // 丸まりから戻る
      eatIn: "Eat1", // 餌にかがみ込む（導入）
      eatLoop: "Eat_loop", // むしゃむしゃ食べる（ループ）
      eatOut: "Eat2", // 食べ終えて戻る
    },
    // 口アトラス：1枚のテクスチャを cols×rows に分割し、offset で表示する口を切替。
    // index: 0=左上ノーマル(ニッコリ) / 1=右上笑い / 2=左下怒り(への字) / 3=右下困惑。
    // neutral=ノーマル、sad=困惑（丸まり時）、eat=笑い（食事中の開いた口）。
    mouth: { material: "Mouth", cols: 2, rows: 2, neutral: 0, sad: 3, eat: 1 },
  },
};

const LOCO_FADE = 0.25; // 移動アニメ間のクロスフェード秒数
const CURL_FADE = 0.15; // 丸まり遷移のクロスフェード秒数
const EAT_FADE = 0.2; // 食事遷移のクロスフェード秒数

const PREVIEW_SIZE = 220; // プレビューウィンドウの一辺（px）
const PREVIEW_MARGIN = 16; // 画面端からの余白（px）
const PREVIEW_SPIN = 0.0006; // ターンテーブル回転速度（rad/ms）

export const DEFAULT_MODEL_KEY = "dangomushi";

// ダンゴムシ1匹分の3D状態を管理する内部クラス
class IsopodModel {
  constructor(gltf, config) {
    const clonedScene = skeletonClone(gltf.scene);
    // マテリアルをトゥーンへ差し替え（口アトラス検出より前に：name/map は保持される）
    applyToon(clonedScene);

    const box = new THREE.Box3().setFromObject(clonedScene);
    const maxDim = box.getSize(new THREE.Vector3()).length();
    const scale = config.targetSize / maxDim;

    // プレビューは正面から見せたいので真上向きの寝かせ回転は使わず直立させる
    this._preview = config.preview ?? false;

    const inner = new THREE.Group();
    if (this._preview) {
      inner.rotation.y = config.previewRotY ?? 0;
    } else {
      inner.rotation.x = config.rotX;
      inner.rotation.y = config.rotY;
    }
    inner.scale.setScalar(scale);
    inner.add(clonedScene);

    this.wrapper = new THREE.Group();
    this.wrapper.add(inner);

    // プレビューはバウンディングボックス中心を原点へ寄せてフレーミングしやすく
    if (this._preview) {
      const center = new THREE.Box3()
        .setFromObject(this.wrapper)
        .getCenter(new THREE.Vector3());
      inner.position.sub(center);
    }

    this.mixer = null;
    this.curlAction = null;
    this.uncurlAction = null;
    this.currentState = null;
    this._uncurling = false;
    this._frozenPos = null;
    this._uncurlTimer = 0;

    // シェイプキー（モーフターゲット）による表情制御
    this._setupMorphs(clonedScene);
    // 口アトラス（テクスチャ offset で口を切替）
    this._setupMouth(clonedScene, config.mouth);

    // 設定済みアニメ制御（クリップ名で対応づけるモデル。例: ちびキャラ）
    this._anim = config.anim ?? null;
    if (this._anim) {
      this._setupConfiguredAnim(clonedScene, gltf);
      return;
    }

    if (gltf.animations?.length) {
      this.mixer = new THREE.AnimationMixer(clonedScene);

      for (const clip of gltf.animations) {
        const n = clip.name.toLowerCase();
        const a = this.mixer.clipAction(clip);
        if (
          n.includes("uncurl") ||
          n.includes("unroll") ||
          n.includes("open") ||
          n.includes("extend") ||
          n.includes("release") ||
          n.includes("stretch")
        ) {
          this.uncurlAction = a;
        } else if (n.includes("curl") || n.includes("roll")) {
          this.curlAction = a;
        }
      }

      // 名前で判定できなかった場合：順序で割り当て
      if (!this.curlAction && !this.uncurlAction) {
        if (gltf.animations.length >= 2) {
          this.curlAction = this.mixer.clipAction(gltf.animations[0]);
          this.uncurlAction = this.mixer.clipAction(gltf.animations[1]);
        } else if (gltf.animations.length === 1) {
          this.curlAction = this.mixer.clipAction(gltf.animations[0]);
        }
      } else if (this.curlAction && !this.uncurlAction) {
        for (const clip of gltf.animations) {
          const a = this.mixer.clipAction(clip);
          if (a !== this.curlAction) {
            this.uncurlAction = a;
            break;
          }
        }
      }
    }
  }

  // ── 表情（シェイプキー / モーフターゲット） ──────────────────
  _setupMorphs(clonedScene) {
    // 名前 → 対象メッシュとインデックス。各影響度を cur から target へ補間する
    this._expr = {};
    clonedScene.traverse((o) => {
      if (!o.isMesh || !o.morphTargetDictionary || !o.morphTargetInfluences) {
        return;
      }
      for (const [name, idx] of Object.entries(o.morphTargetDictionary)) {
        (this._expr[name] ??= { refs: [], cur: 0, target: 0 }).refs.push({
          mesh: o,
          idx,
        });
      }
    });
    const names = Object.keys(this._expr);
    if (names.length) console.log("[IsopodModel] shape keys:", names);
  }

  // 表情をセット。指定外のキーは 0（中立）へ戻る。
  setExpression(targets) {
    for (const name in this._expr) {
      this._expr[name].target = targets[name] ?? 0;
    }
  }

  _updateExpression(dt) {
    // 時間ベースの指数補間（フレームレート非依存でなめらか）
    const k = 1 - Math.exp(-dt / 90);
    for (const name in this._expr) {
      const e = this._expr[name];
      if (Math.abs(e.target - e.cur) < 0.001 && e.cur === e.target) continue;
      e.cur += (e.target - e.cur) * k;
      for (const r of e.refs) r.mesh.morphTargetInfluences[r.idx] = e.cur;
    }
  }

  // 表情を補間せず即座に反映（src があればその現在値を引き継ぐ）
  _snapExpression(src) {
    for (const name in this._expr) {
      const e = this._expr[name];
      e.cur = src?._expr?.[name] ? src._expr[name].cur : e.target;
      for (const r of e.refs) r.mesh.morphTargetInfluences[r.idx] = e.cur;
    }
  }

  // LoopOnce のアクションを指定時刻からフェードなしで再生（スナップ用）
  _playOnceAt(action, time) {
    action.reset();
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.timeScale = 1;
    action.time = time;
    action.play();
  }

  // プレビュー対象が切り替わったとき、その個体の「実際に再生中の位相」へ
  // 即座に合わせる。src = メインシーンでその個体を描画しているモデル。
  snapToState(isopod, src) {
    if (this._anim) {
      this.mixer.stopAllAction();
      this._loco = null;
      this._uncurling = false;
      this._frozenPos = null;
      this._curlTimer = 0;
      this._eatPhase = "none";
      this._eatTimer = 0;
      const a = this._act;

      // ソースの丸まり位相を優先（uncurl中=out を取りこぼさないため）。
      // src が無い／未ロードなら isopod.state から推定。
      const phase =
        src && src._anim
          ? src._curlPhase
          : isopod.state === "curled"
            ? "loop"
            : "none";

      if (phase === "in" && a.curlIn) {
        this._curlPhase = "in";
        const t = src?._act?.curlIn?.time ?? 0;
        this._playOnceAt(a.curlIn, t);
        this._curlTimer = Math.max(0, a.curlIn.getClip().duration - t);
        this.setExpression({ eye_close: 1, eyelash_sad: 1 });
        if (this._mouth) this.setMouth(this._mouth.sad);
      } else if (phase === "out" && a.curlOut) {
        // Curl_up2（のびる）再生中：残り時間を引き継いで続きから再生
        this._curlPhase = "out";
        this._uncurling = true;
        this._frozenPos = { x: isopod.x, y: isopod.y };
        const t = src?._act?.curlOut?.time ?? 0;
        this._playOnceAt(a.curlOut, t);
        this._curlTimer = Math.max(0, a.curlOut.getClip().duration - t);
        this.setExpression({});
        if (this._mouth) this.setMouth(this._mouth.neutral);
      } else if (phase === "in" || phase === "loop") {
        this._curlPhase = "loop"; // 丸まり待機（頭を抱えるループ）
        if (a.curlLoop) {
          a.curlLoop.reset().setLoop(THREE.LoopRepeat, Infinity).play();
        } else if (a.curlIn) {
          this._playOnceAt(a.curlIn, a.curlIn.getClip().duration);
        }
        this.setExpression({ eye_close: 1, eyelash_sad: 1 });
        if (this._mouth) this.setMouth(this._mouth.sad);
      } else {
        this._curlPhase = "none";
        // 丸まっていない：食事中ならその食事フェーズへ、そうでなければ移動
        const eatPhase =
          src && src._anim
            ? src._eatPhase
            : isopod.state === "eating"
              ? "loop"
              : "none";
        if (
          eatPhase !== "none" &&
          (a.eatIn || a.eatLoop || a.eatOut)
        ) {
          this._snapToEat(eatPhase, src);
        } else {
          const loco = this._locoFor(isopod.state);
          if (loco) {
            loco.reset().setLoop(THREE.LoopRepeat, Infinity).play();
            this._loco = loco;
          }
          this.setExpression({});
          if (this._mouth) this.setMouth(this._mouth.neutral);
        }
      }
      this._snapExpression(src);
      return;
    }

    // レガシー（ダンゴムシ）：uncurl中ならその続き、丸まり中なら丸まりポーズ
    this.mixer?.stopAllAction();
    this._uncurling = false;
    this._frozenPos = null;
    this._uncurlTimer = 0;
    if (src && !src._anim && src._uncurling && this.uncurlAction) {
      this.currentState = isopod.state;
      const t = src.uncurlAction?.time ?? 0;
      this._frozenPos = { x: isopod.x, y: isopod.y };
      this._uncurling = true;
      this._uncurlTimer = Math.max(0, this.uncurlAction.getClip().duration - t);
      this.uncurlAction.setLoop(THREE.LoopOnce);
      this.uncurlAction.clampWhenFinished = false;
      this.uncurlAction.reset();
      this.uncurlAction.time = t;
      this.uncurlAction.play();
    } else if (isopod.state === "curled") {
      this.currentState = "curled";
      if (this.curlAction) {
        const duration = this.curlAction.getClip().duration;
        this.curlAction.setLoop(THREE.LoopOnce);
        this.curlAction.clampWhenFinished = true;
        this.curlAction.reset();
        this.curlAction.time = duration;
        this.curlAction.play();
      }
    } else {
      this.currentState = isopod.state;
    }
    this._snapExpression(src);
  }

  // プレビューを対象の食事フェーズへ即座にスナップ（snapToState から使用）
  _snapToEat(phase, src) {
    const a = this._act;
    if (phase === "in" && a.eatIn) {
      this._eatPhase = "in";
      const t = src?._act?.eatIn?.time ?? 0;
      this._playOnceAt(a.eatIn, t);
      this._eatTimer = Math.max(0, a.eatIn.getClip().duration - t);
      this.setExpression({ eye_happy: 1 });
      if (this._mouth) this.setMouth(this._mouth.eat);
    } else if (phase === "out" && a.eatOut) {
      this._eatPhase = "out";
      this._uncurling = true;
      const t = src?._act?.eatOut?.time ?? 0;
      this._playOnceAt(a.eatOut, t);
      this._eatTimer = Math.max(0, a.eatOut.getClip().duration - t);
      this.setExpression({});
      if (this._mouth) this.setMouth(this._mouth.neutral);
    } else {
      this._eatPhase = "loop"; // むしゃむしゃ（ループ）
      if (a.eatLoop) {
        a.eatLoop.reset().setLoop(THREE.LoopRepeat, Infinity).play();
      } else if (a.eatIn) {
        this._playOnceAt(a.eatIn, a.eatIn.getClip().duration);
      }
      this.setExpression({ eye_happy: 1 });
      if (this._mouth) this.setMouth(this._mouth.eat);
    }
  }

  // ── 口アトラス（テクスチャ offset で4分割の口を切替） ──────────
  _setupMouth(clonedScene, cfg) {
    this._mouth = null;
    if (!cfg) return;
    clonedScene.traverse((o) => {
      if (this._mouth || !o.isMesh) return;
      const mat = o.material;
      if (!mat || mat.name !== cfg.material || !mat.map) return;
      // クローン共有を断ち切り、この個体専用の口マテリアル/テクスチャにする
      const m = mat.clone();
      m.map = mat.map.clone();
      m.map.needsUpdate = true;
      m.map.wrapS = m.map.wrapT = THREE.RepeatWrapping;
      o.material = m;
      this._mouth = {
        tex: m.map,
        mat: m,
        cols: cfg.cols,
        rows: cfg.rows,
        base: m.map.offset.clone(), // 作者が設定した初期オフセット（口0）
        neutral: cfg.neutral ?? 0,
        sad: cfg.sad ?? cfg.neutral ?? 0,
        eat: cfg.eat ?? cfg.neutral ?? 0,
      };
    });
    if (this._mouth) {
      console.log(
        "[IsopodModel] mouth atlas:",
        cfg.material,
        `${cfg.cols}x${cfg.rows}`,
      );
      this.setMouth(this._mouth.neutral);
    }
  }

  // 口アトラスの index 番目の口を表示（repeat は変えず offset のみ移動）
  setMouth(index) {
    const m = this._mouth;
    if (!m) return;
    const col = index % m.cols;
    const row = Math.floor(index / m.cols);
    m.tex.offset.set(m.base.x + col / m.cols, m.base.y - row / m.rows);
  }

  // ── 設定済みアニメ制御（ちびキャラ等） ───────────────────────
  _setupConfiguredAnim(clonedScene, gltf) {
    this.mixer = new THREE.AnimationMixer(clonedScene);
    const byName = {};
    for (const clip of gltf.animations) {
      byName[clip.name] = this.mixer.clipAction(clip);
    }
    // 名前 → アクション
    this._act = {};
    for (const [key, clipName] of Object.entries(this._anim)) {
      this._act[key] = byName[clipName] ?? null;
    }
    this._loco = null; // 現在の移動アクション（idle/walk/run）
    this._curlPhase = "none"; // none | in | loop | out
    this._curlTimer = 0;
    this._eatPhase = "none"; // none | in | loop | out
    this._eatTimer = 0;
  }

  // 状態に対応する移動アクションを返す
  _locoFor(state) {
    const a = this._act;
    if (state === "avoid") return a.run ?? a.walk ?? a.idle;
    if (state === "walk") return a.walk ?? a.idle;
    return a.idle ?? a.walk;
  }

  _setLoco(next) {
    if (next === this._loco) return;
    this._loco?.fadeOut(LOCO_FADE);
    next?.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(LOCO_FADE).play();
    this._loco = next ?? null;
  }

  _playOnce(action, fade) {
    action.reset();
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.timeScale = 1;
    action.fadeIn(fade).play();
  }

  _startCurlIn() {
    this._curlPhase = "in";
    this._loco?.fadeOut(CURL_FADE);
    this._loco = null;
    // 丸まるときは困った顔（目を閉じて眉を八の字に＋困った口）
    this.setExpression({ eye_close: 1, eyelash_sad: 1 });
    if (this._mouth) this.setMouth(this._mouth.sad);
    const a = this._act;
    // 前サイクルの curlOut が最終フレームを保持したまま残っていると、
    // 手が開いた姿勢とブレンドされてしまうので必ず落とす
    a.curlOut?.fadeOut(CURL_FADE);
    if (a.curlIn) {
      this._playOnce(a.curlIn, CURL_FADE);
      this._curlTimer = a.curlIn.getClip().duration;
    } else {
      this._curlTimer = 0;
    }
  }

  _startCurlLoop() {
    this._curlPhase = "loop";
    const a = this._act;
    if (a.curlLoop) {
      a.curlIn?.fadeOut(CURL_FADE);
      a.curlLoop
        .reset()
        .setLoop(THREE.LoopRepeat, Infinity)
        .fadeIn(CURL_FADE)
        .play();
    }
    // curlLoop が無ければ curlIn の最終フレームを保持（clampWhenFinished）
  }

  _startCurlOut(isopod) {
    this._curlPhase = "out";
    this._uncurling = true;
    this._frozenPos = { x: isopod.x, y: isopod.y };
    // のびるときに表情・口を中立へ戻す
    this.setExpression({});
    if (this._mouth) this.setMouth(this._mouth.neutral);
    const a = this._act;
    a.curlIn?.fadeOut(CURL_FADE);
    a.curlLoop?.fadeOut(CURL_FADE);
    if (a.curlOut) {
      this._playOnce(a.curlOut, CURL_FADE);
      this._curlTimer = a.curlOut.getClip().duration;
    } else {
      this._curlTimer = 0;
    }
  }

  // ── 食事（Eat1 → Eat_loop → Eat2 の3フェーズ） ────────────────
  _startEatIn() {
    this._eatPhase = "in";
    this._loco?.fadeOut(EAT_FADE);
    this._loco = null;
    // 食事中はうれしそうに（目を細めて口を開ける）
    this.setExpression({ eye_happy: 1 });
    if (this._mouth) this.setMouth(this._mouth.eat);
    const a = this._act;
    // 前サイクルの eatOut が最終フレームを保持したまま残らないよう落とす
    a.eatOut?.fadeOut(EAT_FADE);
    if (a.eatIn) {
      this._playOnce(a.eatIn, EAT_FADE);
      this._eatTimer = a.eatIn.getClip().duration;
    } else {
      this._eatTimer = 0;
    }
  }

  _startEatLoop() {
    this._eatPhase = "loop";
    const a = this._act;
    if (a.eatLoop) {
      a.eatIn?.fadeOut(EAT_FADE);
      a.eatLoop
        .reset()
        .setLoop(THREE.LoopRepeat, Infinity)
        .fadeIn(EAT_FADE)
        .play();
    }
    // eatLoop が無ければ eatIn の最終フレームを保持（clampWhenFinished）
  }

  _startEatOut(isopod) {
    this._eatPhase = "out";
    // Eat2（起き上がり）再生中は移動させない。丸まり戻りと同様に位置を固定し、
    // 物理更新もスキップさせる（main.js が isUncurlingAt を見て止める）。
    this._uncurling = true;
    this._frozenPos = { x: isopod.x, y: isopod.y };
    // 食べ終えたら表情・口を中立へ戻す
    this.setExpression({});
    if (this._mouth) this.setMouth(this._mouth.neutral);
    const a = this._act;
    a.eatIn?.fadeOut(EAT_FADE);
    a.eatLoop?.fadeOut(EAT_FADE);
    if (a.eatOut) {
      this._playOnce(a.eatOut, EAT_FADE);
      this._eatTimer = a.eatOut.getClip().duration;
    } else {
      this._eatTimer = 0;
    }
  }

  // 食事アニメを即座に畳む（丸まりに割り込まれたときなど）
  _stopEat() {
    const a = this._act;
    a.eatIn?.fadeOut(CURL_FADE);
    a.eatLoop?.fadeOut(CURL_FADE);
    a.eatOut?.fadeOut(CURL_FADE);
    this._eatPhase = "none";
    this._eatTimer = 0;
    // Eat2 中に割り込まれた場合の固定を解除
    this._uncurling = false;
    this._frozenPos = null;
  }

  _updateConfigured(isopod, dt, w, h) {
    // プレビューは位置・向きを固定（ターンテーブル回転はレンダラー側で付与）
    if (!this._preview) {
      const pos = this._frozenPos ?? isopod;
      this.wrapper.position.set(pos.x - w / 2, -(pos.y - h / 2), 0);
      if (!this._uncurling) this.wrapper.rotation.z = -isopod.angle;
    }

    const isCurled = isopod.state === "curled";
    const isEating = isopod.state === "eating";
    const sec = dt / 1000;

    // 丸まり遷移判定（丸まりは食事より優先。食事中に割り込まれたら畳む）
    if (isCurled && this._curlPhase === "none") {
      if (this._eatPhase !== "none") this._stopEat();
      this._startCurlIn();
    } else if (!isCurled && (this._curlPhase === "in" || this._curlPhase === "loop")) {
      this._startCurlOut(isopod);
    }

    // 食事遷移判定（丸まっていないときのみ）
    if (this._curlPhase === "none") {
      if (isEating && this._eatPhase === "none") {
        this._startEatIn();
      } else if (!isEating && (this._eatPhase === "in" || this._eatPhase === "loop")) {
        this._startEatOut(isopod);
      }
    }

    // 丸まりフェーズ進行
    if (this._curlPhase === "in") {
      this._curlTimer -= sec;
      if (this._curlTimer <= 0) this._startCurlLoop();
    } else if (this._curlPhase === "out") {
      this._curlTimer -= sec;
      if (this._curlTimer <= 0) {
        this._curlPhase = "none";
        this._uncurling = false;
        this._frozenPos = null;
        // 最終フレームを保持している curlOut を解放してから歩行へ戻す
        this._act.curlOut?.fadeOut(LOCO_FADE);
      }
    }

    // 食事フェーズ進行
    if (this._eatPhase === "in") {
      this._eatTimer -= sec;
      if (this._eatTimer <= 0) this._startEatLoop();
    } else if (this._eatPhase === "out") {
      this._eatTimer -= sec;
      if (this._eatTimer <= 0) {
        this._eatPhase = "none";
        // Eat2 が終わったので固定を解除し、物理・移動を再開させる
        this._uncurling = false;
        this._frozenPos = null;
        // 最終フレームを保持している eatOut を解放してから歩行へ戻す
        this._act.eatOut?.fadeOut(LOCO_FADE);
      }
    }

    // 移動アニメ＋表情（丸まり・食事どちらも進行していないとき）
    if (this._curlPhase === "none" && this._eatPhase === "none") {
      this._setLoco(this._locoFor(isopod.state));
      this.setExpression({});
      if (this._mouth) this.setMouth(this._mouth.neutral);
    }

    if (dt) this.mixer.update(sec);
    this._updateExpression(dt);
  }

  _enterCurled() {
    this.currentState = "curled";
    this._uncurling = false;
    this._frozenPos = null;
    this._uncurlTimer = 0;
    this.uncurlAction?.stop();
    if (this.curlAction) {
      const duration = this.curlAction.getClip().duration;
      this.curlAction.timeScale = 1;
      this.curlAction.setLoop(THREE.LoopOnce);
      this.curlAction.clampWhenFinished = true;
      this.curlAction.stop();
      this.curlAction.time = duration;
      this.curlAction.play();
    }
  }

  _exitCurled(isopod) {
    this.currentState = isopod.state;
    this.curlAction?.stop();
    if (this.uncurlAction) {
      const duration = this.uncurlAction.getClip().duration;
      this._frozenPos = { x: isopod.x, y: isopod.y };
      this._uncurling = true;
      this._uncurlTimer = duration;
      this.uncurlAction.timeScale = 1;
      this.uncurlAction.setLoop(THREE.LoopOnce);
      this.uncurlAction.clampWhenFinished = false;
      this.uncurlAction.reset().play();
    }
  }

  update(isopod, dt, w, h) {
    if (this._anim) {
      this._updateConfigured(isopod, dt, w, h);
      return;
    }

    if (!this._preview) {
      const pos = this._frozenPos ?? isopod;
      this.wrapper.position.set(pos.x - w / 2, -(pos.y - h / 2), 0);

      if (!this._uncurling) {
        this.wrapper.rotation.z = -isopod.angle;
      }
    }

    if (isopod.state === "curled" && this.currentState !== "curled") {
      this._enterCurled();
    } else if (isopod.state !== "curled" && this.currentState === "curled") {
      this._exitCurled(isopod);
    }

    if (this._uncurling) {
      this._uncurlTimer -= dt / 1000;
      if (this._uncurlTimer <= 0) {
        this._uncurling = false;
        this._frozenPos = null;
        this._uncurlTimer = 0;
        this.uncurlAction?.stop();
      }
    }

    if (this.mixer && dt) this.mixer.update(dt / 1000);
    this._updateExpression(dt);
  }

  dispose(scene) {
    this.mixer?.stopAllAction();
    // 個体専用に複製した口マテリアル/テクスチャを解放
    this._mouth?.tex.dispose();
    this._mouth?.mat.dispose();
    scene.remove(this.wrapper);
  }
}

// シーン・レンダラーを1つだけ持ち、全ダンゴムシを管理する
export class IsopodRenderer3D {
  constructor(canvas2d, opts = {}) {
    this.canvas2d = canvas2d;
    // preview:false でプレビュー窓（右下の小窓）を無効化する（虫食いモード用）
    this._enablePreview = opts.preview !== false;
    // このレンダラーだけモデルサイズを倍率で変える（虫食いモードで独立して調整するため）
    this._sizeScale = opts.sizeScale ?? 1;

    this._canvas = document.createElement("canvas");
    // 表示は原寸。ドット化の有無（image-rendering）は resize() で切り替える
    this._canvas.style.cssText =
      "position:absolute;top:0;left:0;pointer-events:none;";
    canvas2d.parentElement.appendChild(this._canvas);

    this._renderer = new THREE.WebGLRenderer({
      canvas: this._canvas,
      alpha: true,
      antialias: true,
    });
    // メインビューとプレビューを別ビューポートで2回描画するため手動クリア
    this._renderer.autoClear = false;
    this._scene = new THREE.Scene();

    const w = canvas2d.width,
      h = canvas2d.height;
    this._camera = new THREE.OrthographicCamera(
      -w / 2,
      w / 2,
      h / 2,
      -h / 2,
      0.1,
      1000,
    );
    this._camera.position.z = 100;

    this._scene.add(new THREE.AmbientLight(0xffffff, 1.5));
    const dir = new THREE.DirectionalLight(0xffffff, 1.0);
    dir.position.set(1, 2, 3);
    this._scene.add(dir);

    // プレビュー用シーン（直立した1体を透視カメラで間近に表示）
    this._previewScene = new THREE.Scene();
    this._previewCamera = new THREE.PerspectiveCamera(35, 1, 0.1, 5000);
    this._previewScene.add(new THREE.AmbientLight(0xffffff, 1.6));
    const pdir = new THREE.DirectionalLight(0xffffff, 1.2);
    pdir.position.set(1, 2, 3);
    this._previewScene.add(pdir);
    this._previewModel = null;
    this._previewTarget = null; // 直近にカーソルが触れたダンゴムシ
    this._prevPreviewTarget = null; // 切替検出用
    this._previewBasePos = new THREE.Vector3(); // フレーミング時のカメラ位置
    this._previewZoom = 1; // ホイールズーム倍率

    this._models = [];
    this._baseGltf = null;
    this._pendingAdds = 0;

    this._loader = new GLTFLoader();
    this._gltfCache = {};
    this._modelKey = DEFAULT_MODEL_KEY;

    this.resize(w, h);

    this._loadGltf(this._modelKey, (gltf) => {
      this._baseGltf = gltf;
      const pending = this._pendingAdds;
      this._pendingAdds = 0;
      for (let i = 0; i < pending; i++) this._createModel();
      if (this._enablePreview) this._buildPreviewModel(gltf);
    });
  }

  // 現在モデルの設定に、このレンダラーのサイズ倍率を反映したものを返す
  _scaledConfig(extra = {}) {
    const base = MODELS[this._modelKey];
    return { ...base, targetSize: base.targetSize * this._sizeScale, ...extra };
  }

  // プレビュー用の単体モデルを（再）生成し、カメラをフレーミングする
  _buildPreviewModel(gltf) {
    if (this._previewModel) {
      this._previewModel.dispose(this._previewScene);
      this._previewModel = null;
    }
    const model = new IsopodModel(gltf, this._scaledConfig({ preview: true }));
    this._previewScene.add(model.wrapper);
    this._previewModel = model;
    this._prevPreviewTarget = null; // 新モデルで現在の対象へ再スナップさせる

    // モデル全体が収まるよう透視カメラの距離を決める
    const size = new THREE.Box3()
      .setFromObject(model.wrapper)
      .getSize(new THREE.Vector3());
    const span = Math.max(size.x, size.y);
    const fov = (this._previewCamera.fov * Math.PI) / 180;
    const dist = (span / 2 / Math.tan(fov / 2)) * 1.3;
    this._previewBasePos.set(0, span * 0.1, dist);
    this._previewCamera.far = dist * 20;
    this._previewCamera.updateProjectionMatrix();
    this._applyPreviewZoom();
  }

  // 基準位置に倍率をかけてカメラを配置（視線方向は維持）
  _applyPreviewZoom() {
    this._previewCamera.position
      .copy(this._previewBasePos)
      .multiplyScalar(this._previewZoom);
    this._previewCamera.lookAt(0, 0, 0);
  }

  setPreviewTarget(isopod) {
    this._previewTarget = isopod;
  }

  // クライアント座標がプレビュー窓の中にあるか
  isPointInPreview(cx, cy) {
    const w = this.canvas2d.width,
      h = this.canvas2d.height;
    const left = w - PREVIEW_SIZE - PREVIEW_MARGIN;
    const top = h - PREVIEW_SIZE - PREVIEW_MARGIN;
    return (
      cx >= left &&
      cx <= left + PREVIEW_SIZE &&
      cy >= top &&
      cy <= top + PREVIEW_SIZE
    );
  }

  // ホイール量に応じてプレビューカメラをズーム（拡大/縮小）
  zoomPreview(deltaY) {
    const factor = deltaY > 0 ? 1.1 : 0.9; // 奥へ回すと縮小、手前で拡大
    this._previewZoom = Math.min(4, Math.max(0.3, this._previewZoom * factor));
    this._applyPreviewZoom();
  }

  // GLB をロードしてキャッシュ。キャッシュ済みなら即コールバック。
  _loadGltf(key, cb) {
    const cached = this._gltfCache[key];
    if (cached) {
      cb(cached);
      return;
    }
    this._loader.load(MODELS[key].url, (gltf) => {
      console.log(
        `[IsopodRenderer3D] "${key}" clips:`,
        gltf.animations.map((c) => c.name),
      );
      this._gltfCache[key] = gltf;
      cb(gltf);
    });
  }

  _createModel() {
    if (!this._baseGltf) {
      this._pendingAdds++;
      return;
    }
    const model = new IsopodModel(this._baseGltf, this._scaledConfig());
    this._scene.add(model.wrapper);
    this._models.push(model);
  }

  addIsopod() {
    this._createModel();
  }

  removeIsopod() {
    const model = this._models.pop();
    model?.dispose(this._scene);
  }

  getModelKey() {
    return this._modelKey;
  }

  // 表示中の全モデルを新モデルへ差し替える。匹数は維持される。
  switchModel(key) {
    if (key === this._modelKey || !MODELS[key]) return;
    this._modelKey = key;
    this._loadGltf(key, (gltf) => {
      // 切り替え中に再度切り替わっていたら無視
      if (this._modelKey !== key) return;
      const count = this._models.length + this._pendingAdds;
      for (const m of this._models) m.dispose(this._scene);
      this._models = [];
      this._pendingAdds = 0;
      this._baseGltf = gltf;
      for (let i = 0; i < count; i++) this._createModel();
      if (this._enablePreview) this._buildPreviewModel(gltf);
    });
  }

  isUncurlingAt(i) {
    return this._models[i]?._uncurling ?? false;
  }

  update(isopods, dt) {
    const w = this.canvas2d.width,
      h = this.canvas2d.height;
    const len = Math.min(isopods.length, this._models.length);
    for (let i = 0; i < len; i++) {
      this._models[i].update(isopods[i], dt, w, h);
    }

    // プレビュー：対象個体の状態をアニメに反映しつつターンテーブル回転
    if (this._previewModel) {
      const target = this._previewTarget ?? isopods[0];
      if (target) {
        // 対象が切り替わったら、その個体が実際に再生中の位相へ即座にスナップ
        if (target !== this._prevPreviewTarget) {
          const idx = isopods.indexOf(target);
          const src =
            idx >= 0 && idx < this._models.length ? this._models[idx] : null;
          this._previewModel.snapToState(target, src);
          this._prevPreviewTarget = target;
        }
        this._previewModel.update(target, dt, w, h);
      }
      this._previewModel.wrapper.rotation.y += dt * PREVIEW_SPIN;
    }
  }

  render() {
    const w = this._canvas.width,
      h = this._canvas.height;

    // メインビュー（全画面・透明背景）
    this._renderer.setScissorTest(false);
    this._renderer.setViewport(0, 0, w, h);
    this._renderer.setClearColor(0x000000, 0);
    this._renderer.clear();
    this._renderer.render(this._scene, this._camera);

    // プレビュー（右下・不透明背景の小窓）。低解像度バッファなので px比を掛ける。
    if (this._previewModel) {
      const r = this._pxRatio ?? 1;
      const pv = PREVIEW_SIZE * r;
      const pm = PREVIEW_MARGIN * r;
      const x = w - pv - pm;
      const y = pm; // WebGL のビューポート原点は左下
      this._renderer.setViewport(x, y, pv, pv);
      this._renderer.setScissor(x, y, pv, pv);
      this._renderer.setScissorTest(true);
      this._renderer.setClearColor(0x2b2622, 1);
      this._renderer.clear();
      this._renderer.render(this._previewScene, this._previewCamera);
      this._renderer.setScissorTest(false);
    }
  }

  resize(w, h) {
    // PIXEL_SIZE>=1：低解像度バッファ＋ニアレスト拡大でドット化（DS風）。
    // PIXEL_SIZE<1：ピクセル化オフ。デバイス解像度で描いてくっきり表示する。
    const pixelate = PIXEL_SIZE >= 1;
    const P = pixelate ? PIXEL_SIZE : 1;
    const dpr = pixelate ? 1 : window.devicePixelRatio || 1;
    const lw = Math.max(1, Math.round((w / P) * dpr));
    const lh = Math.max(1, Math.round((h / P) * dpr));
    this._renderer.setSize(lw, lh, false); // バッファ解像度のみ設定。style は触らない
    this._canvas.style.width = w + "px"; // 表示は常に原寸
    this._canvas.style.height = h + "px";
    this._canvas.style.imageRendering = pixelate ? "pixelated" : "auto";
    this._pxRatio = lw / w; // バッファ／原寸（プレビューのスケール用）
    // カメラのワールド境界は原寸のまま＝座標系・見た目の位置は不変
    this._camera.left = -w / 2;
    this._camera.right = w / 2;
    this._camera.top = h / 2;
    this._camera.bottom = -h / 2;
    this._camera.updateProjectionMatrix();
  }
}
