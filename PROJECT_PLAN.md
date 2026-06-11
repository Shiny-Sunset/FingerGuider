# プロジェクト企画書：FingerGuider — ダンゴムシちょっかいアプリ

## 概要

マウスまたはカメラの人差し指で Canvas に線を引き、3D ダンゴムシをインタラクティブに操作できる Web アプリ。  
線を使ってダンゴムシを誘導・驚かせるインタラクションを楽しめる。  
大学院講義（Human Media Interface）の最終課題として開発。

---

## リポジトリ構成

```
FingerGuider/
├── index.html
├── style.css
├── vite.config.js
├── package.json
├── model/
│   └── dangomushi.glb        # ダンゴムシ 3D モデル（GLB）
└── src/
    ├── main.js               # エントリポイント・入力管理・メインループ
    ├── character.js          # Isopod クラス（物理・ステートマシン・衝突）
    ├── line.js               # 描画線の管理・距離判定・フェードアウト
    ├── handInput.js          # MediaPipe GestureRecognizer ラッパー
    ├── renderer.js           # Canvas 2D 描画（背景・線・手のスケルトン）
    └── isopodRenderer3D.js   # Three.js 3D レンダラー（全匹共有・単一 WebGL コンテキスト）
```

---

## 使用技術

| 技術 | バージョン | 用途 |
|------|-----------|------|
| Vite | ^8.0 | ビルドツール・開発サーバー |
| Vanilla JavaScript | ES2022 | アプリロジック全般 |
| Canvas 2D API | ブラウザ標準 | 背景・線・手のスケルトン描画 |
| Three.js | ^0.177 | 3D モデルのレンダリング（WebGL） |
| MediaPipe Tasks Vision | ^0.10.35 | ジェスチャー認識・手のランドマーク検出 |

---

## アーキテクチャ

### レンダリング構成

```
[ Canvas 2D（#canvas） ]  ← 背景・描画線・手のスケルトン
[ WebGL Canvas（透明） ]  ← Three.js で 3D ダンゴムシを重ねて描画
```

2D Canvas の上に `position:absolute` で透明な WebGL Canvas を重ね、  
2D 側は背景と UI 要素、3D 側はダンゴムシモデルのみを担当する。

### ダンゴムシのステートマシン（`character.js`）

```
walk ──線が近い(< 90px)──► avoid ──線が遠ざかる──► walk
 │                                                  ▲
 └──線に接触(< 35px)──► curled ──2500ms後──────────┘
```

物理（位置・角度・衝突）と描画は完全に分離されており、  
`Isopod.update()` は座標を計算するだけで描画を持たない。

### 3D レンダラー設計（`isopodRenderer3D.js`）

- `IsopodRenderer3D` がシーン・カメラ・WebGL レンダラーを **1つだけ** 管理
- ダンゴムシ1匹 = `IsopodModel`（`SkeletonUtils.clone()` でアニメーション込みの複製）
- `addIsopod()` でシーンにモデルを追加、`removeIsopod()` で末尾から削除（LIFO）
- OrthographicCamera でピクセル座標をそのままワールド座標にマッピング

---

## 機能仕様

### 入力

| 方式 | 詳細 |
|------|------|
| マウスモード | `mousedown` + `mousemove` で線を描画 |
| 指モード | MediaPipe GestureRecognizer で `Pointing_Up` を検知、人差し指先端座標で線を描画 |
| タッチ | タッチ操作もマウスモードとして対応（`touchstart` / `touchmove`） |

### ダンゴムシの挙動

| 状態 | 条件 | 挙動 |
|------|------|------|
| walk | 線が遠い | ランダムウォーク（微小な角度変化） |
| avoid | 線が 90px 以内 | 線から遠ざかる方向へステアリング |
| curled | 線が 35px 以内 | まるまるアニメーション再生・停止 |
| uncurling | curled 終了後 | のびるアニメーション再生・位置凍結・完了後に walk 再開 |

### ダンゴムシ同士の衝突

- 80px 以内：互いに反発力を加えてステアリング
- 35px 以内：めり込み解消のため物理的に押し出し

### アニメーション

| タイミング | 動作 |
|---|---|
| 歩行中 | アニメーションなし（静止ポーズ） |
| curled 突入 | まるまるアニメーションを1回再生（LoopOnce・最終フレームで停止） |
| curled 解除 | のびるアニメーションを1回再生しながら位置を凍結・完了後に歩行再開 |

### UI コントロール

| コントロール | 位置 | 機能 |
|---|---|---|
| 🖱 / ☝ ボタン | 右上 | マウスモード・指モード切り替え |
| − / ＋ ボタン | 右上（モードボタンの下） | ダンゴムシを 1〜10 匹で増減 |

---

## 開発フェーズ

### Phase 1 ✅ 完了

- Canvas 2D でダンゴムシをセグメント描画（楕円 × 8）
- マウスドラッグで線を描画
- 線回避・丸まり挙動の実装

### Phase 2 ✅ 完了

- MediaPipe 統合（GestureRecognizer による `Pointing_Up` 検知）
- 手のスケルトン・指先の強調表示
- Three.js による GLB モデルへの置き換え
- ダンゴムシを複数匹（1〜10）に対応
- ダンゴムシ同士の衝突・反発挙動
- まるまり・のびるアニメーションの制御

### Phase 3（予定）

- ちびキャラ（ミニキャラ）への 3D モデル差し替え
- キャラクターの感情表現（驚き・安心など）

---

## 今後の拡張候補

- 閉じ込め判定（Point-in-Polygon）
- スコアシステム（まるめた回数・閉じ込め時間）
- キャラクター間のリアクション（ぶつかったときの表現）
- SE・BGM の追加
