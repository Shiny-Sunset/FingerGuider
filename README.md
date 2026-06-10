# FingerGuider — ちびキャラちょっかいアプリ

カメラで人差し指を検知し、Canvas に描いた線でダンゴムシをインタラクティブに操作できる Web アプリ。

---

## 操作方法

画面右上のボタンでマウスモードと指モードを切り替えられます。

| ボタン表示 | 入力方法 |
|---|---|
| 🖱 マウスモード | マウスドラッグで線を描画 |
| ☝ 指モード | 人差し指を立ててカメラに向けると線を描画 |

| 操作 | 効果 |
|---|---|
| 線を描く | ダンゴムシが線から逃げる |
| 線に強く接触 | 丸まる（2.5秒後に展開） |
| 線は5秒でフェードアウト | — |

### 指モードのジェスチャー

| ジェスチャー | 効果 |
|---|---|
| 人差し指を立てる（Pointing_Up） | 線を描画・指先が赤丸で強調表示 |
| それ以外（グー・パーなど） | 描画停止 |

---

## 起動方法

**GitHub Pages**： [https://shiny-sunset.github.io/FingerGuider/](https://shiny-sunset.github.io/FingerGuider/)

**ローカルで動かす場合**：

```bash
npm install
npm run dev
```

ブラウザで `http://localhost:5173` を開く。

---

## 技術スタック

- Canvas 2D API
- Vanilla JavaScript（ES Modules）
- [MediaPipe Tasks Vision](https://developers.google.com/mediapipe/solutions/vision/gesture_recognizer) — ジェスチャー認識・手のランドマーク検出
- [Vite](https://vitejs.dev/) — ビルドツール

---

## 開発フェーズ

| フェーズ | 内容 | 状態 |
|---|---|---|
| Phase 1 | ダンゴムシシミュレーション（マウス操作） | ✅ 完了 |
| Phase 2 | MediaPipe 統合・指で線を引く・手のスケルトン表示 | ✅ 完了 |
| Phase 3 | ちびキャラ置換・閉じ込め判定・感情表現 | 予定 |
