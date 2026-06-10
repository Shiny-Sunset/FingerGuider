import { GestureRecognizer, FilesetResolver } from '@mediapipe/tasks-vision'

export class HandInput {
  constructor() {
    this.recognizer = null
    this.video = null
    this._prevGesture = 'None'
    this.ready = false
  }

  async init(videoEl) {
    this.video = videoEl

    const vision = await FilesetResolver.forVisionTasks('wasm')
    this.recognizer = await GestureRecognizer.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: 'gesture_recognizer.task',
        delegate: 'GPU',
      },
      numHands: 1,
      runningMode: 'VIDEO',
      min_hand_detection_confidence: 0.1,
      min_hand_presence_confidence: 0.1,
      min_tracking_confidence: 0.1,
    })

    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 320, height: 180 },
      audio: false,
    })
    videoEl.srcObject = stream
    await videoEl.play()
    this.ready = true
    console.log('HandInput: ready')
  }

  // 毎フレーム呼ぶ。
  // 戻り値: { gesture:'pointing', x, y, isNew } | { gesture: string } | null
  detect(canvasW, canvasH) {
    if (!this.ready || this.video.readyState < 2) return null

    const r = this.recognizer.recognizeForVideo(this.video, performance.now())
    const { gestures, landmarks } = r

    if (gestures.length === 0) {
      this._prevGesture = 'None'
      return null
    }

    const name = gestures[0][0].categoryName

    if (name === 'Pointing_Up') {
      const tip = landmarks[0][8]          // landmark 8 = 人差し指先端
      const x = (1 - tip.x) * canvasW     // カメラ映像は左右反転して表示するので合わせる
      const y = tip.y * canvasH
      const isNew = this._prevGesture !== 'Pointing_Up'
      this._prevGesture = name
      return { gesture: 'pointing', x, y, isNew, landmarks: landmarks[0] }
    }

    this._prevGesture = name
    return { gesture: name, landmarks: landmarks[0] }
  }
}
