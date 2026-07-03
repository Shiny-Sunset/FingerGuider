import { FaceDetector, FilesetResolver } from "@mediapipe/tasks-vision";

// MediaPipe FaceDetector のラッパー。handInput.js と同じパターンで、
// 与えられた video 要素から顔のバウンディングボックスを検出する。
// 出力は「正規化・未反転（映像そのままの向き）」の座標。
// カメラ映像は表示側で左右反転(scaleX(-1))・cover 表示されるため、
// 画面ピクセル座標への変換（反転・cover マッピング）は呼び出し側で行う。
export class FaceInput {
  constructor() {
    this.detector = null;
    this.video = null;
    this.ready = false;
    this._lastVideoTime = -1;
    this._faces = [];
  }

  async init(videoEl) {
    this.video = videoEl;
    const vision = await FilesetResolver.forVisionTasks("wasm");
    this.detector = await FaceDetector.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: "blaze_face_short_range.tflite",
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      minDetectionConfidence: 0.5,
    });
    this.ready = true;
    console.log("FaceInput: ready");
  }

  // 毎フレーム呼ぶ。戻り値: [{ nx, ny, nw, nh, cx, cy }]
  //   nx,ny = バウンディングボックス左上（正規化 0〜1）
  //   nw,nh = 幅・高さ（正規化）  cx,cy = 顔中心（正規化）
  // 同一フレームでは前回の結果を再利用する。
  detect() {
    if (!this.ready || !this.video || this.video.readyState < 2) {
      return this._faces;
    }
    if (this.video.currentTime === this._lastVideoTime) return this._faces;
    this._lastVideoTime = this.video.currentTime;

    const vW = this.video.videoWidth || 1;
    const vH = this.video.videoHeight || 1;
    const res = this.detector.detectForVideo(this.video, performance.now());
    this._faces = (res.detections ?? []).map((d) => {
      const b = d.boundingBox;
      const nw = b.width / vW;
      const nh = b.height / vH;
      const nx = b.originX / vW;
      const ny = b.originY / vH;
      return { nx, ny, nw, nh, cx: nx + nw / 2, cy: ny + nh / 2 };
    });
    return this._faces;
  }
}
