import { GestureRecognizer, FilesetResolver } from "@mediapipe/tasks-vision";

// カメラ映像の上部（y: 0〜TOP_RATIO）の範囲を基準に、手の垂直位置を画面全体へシフトする。
// 手全体を映す都合上、手はカメラの下半分まで下げられないための対策。
// 値が小さいほど画面下端まで届きやすくなる代わりに、シフト量（動きの誇張）が大きくなる。
export const TOP_RATIO = 0.5;
// 指先カーソル座標の平滑化係数（0〜1）。小さいほど滑らかだが追従が遅れる。
const SMOOTHING = 0.4;
// シフト量の平滑化係数。ポインティング中のみ毎フレームかける。
const OFFSET_SMOOTHING = 0.25;

export function mapX(normX, canvasW) {
  return (1 - normX) * canvasW; // カメラ映像は左右反転して表示するので合わせる
}

// 指定したY位置（正規化座標）から、手全体のシフト量を求める。
// マッピング後の値・引く側の生位置の両方を同じ基準（TOP_RATIO）でクランプすることで、
// 範囲を超えた後はシフト量が一定値で頭打ちになり、逆戻りしないようにする。
function computeOffsetY(normY, canvasH) {
  const clamped = Math.min(normY, TOP_RATIO);
  return (clamped / TOP_RATIO) * canvasH - clamped * canvasH;
}

export class HandInput {
  constructor() {
    this.recognizer = null;
    this.video = null;
    this._prevGesture = "None";
    this._smoothX = null;
    this._smoothY = null;
    this._smoothOffsetY = null;
    this.ready = false;
  }

  async init(videoEl) {
    this.video = videoEl;

    const vision = await FilesetResolver.forVisionTasks("wasm");
    this.recognizer = await GestureRecognizer.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: "gesture_recognizer.task",
        delegate: "GPU",
      },
      numHands: 1,
      runningMode: "VIDEO",
      min_hand_detection_confidence: 0.1,
      min_hand_presence_confidence: 0.1,
      min_tracking_confidence: 0.1,
    });

    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 320, height: 180 },
      audio: false,
    });
    videoEl.srcObject = stream;
    await videoEl.play();
    this.ready = true;
    console.log("HandInput: ready");
  }

  // 毎フレーム呼ぶ。
  // 戻り値: { gesture:'pointing', x, y, isNew, offsetY, landmarks } | { gesture: string, offsetY, landmarks } | null
  detect(canvasW, canvasH) {
    if (!this.ready || this.video.readyState < 2) return null;

    const r = this.recognizer.recognizeForVideo(this.video, performance.now());
    const { gestures, landmarks } = r;

    if (gestures.length === 0) {
      this._prevGesture = "None";
      this._smoothX = null;
      this._smoothY = null;
      // シフト量(_smoothOffsetY)はリセットしない。手が画面外に出ても保持しておくことで、
      // 再びポインティングした時に直前の値からなめらかに繋がり、ワープしなくなる。
      return null;
    }

    const name = gestures[0][0].categoryName;

    if (name === "Pointing_Up") {
      const tip = landmarks[0][8]; // landmark 8 = 人差し指先端

      // シフト量は指先(8)自身を基準に計算する。これにより「指先がカメラ上端に触れる
      // →画面上端に触れる」が数式上ぴったり一致する。ポインティング中でない間は更新せず
      // 直前の値を保持する（指の曲げ伸ばしや、別の基準点に切り替えることによる
      // 意図しない上下動を防ぐため）。初回も含め常にEMAで滑らかに追従させることで、
      // 保持していた値との差が大きい場合でも一気に飛ばず、なめらかに遷移する。
      const rawOffsetY = computeOffsetY(tip.y, canvasH);
      const prevOffsetY = this._smoothOffsetY ?? 0;
      this._smoothOffsetY = prevOffsetY + (rawOffsetY - prevOffsetY) * OFFSET_SMOOTHING;

      // 実サイズのまま（拡大縮小せず）、手全体と同じシフト量だけ動かす。
      const rawX = mapX(tip.x, canvasW);
      const rawY = tip.y * canvasH + this._smoothOffsetY;
      const isNew = this._prevGesture !== "Pointing_Up";

      if (this._smoothX === null) {
        this._smoothX = rawX;
        this._smoothY = rawY;
      } else {
        this._smoothX += (rawX - this._smoothX) * SMOOTHING;
        this._smoothY += (rawY - this._smoothY) * SMOOTHING;
      }

      this._prevGesture = name;
      return {
        gesture: "pointing",
        x: this._smoothX,
        y: this._smoothY,
        isNew,
        offsetY: this._smoothOffsetY,
        landmarks: landmarks[0],
      };
    }

    this._smoothX = null;
    this._smoothY = null;

    this._prevGesture = name;
    // まだ一度もポインティングしておらずシフト量が未計算の間は0（生の位置）扱いにする。
    return { gesture: name, offsetY: this._smoothOffsetY ?? 0, landmarks: landmarks[0] };
  }
}
