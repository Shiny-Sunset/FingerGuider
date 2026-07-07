// 2D キャンバスをその場でドット化するユーティリティ。
// 一度低解像度へ縮小し、ニアレスト補間で原寸へ戻すことでブロック状にする。
// 座標系は一切変えないので、描画コードはそのまま使える（フレーム最後に1回呼ぶだけ）。

const _tmp = document.createElement("canvas");
const _tctx = _tmp.getContext("2d");

// canvas に描き終えた内容を pixel px 角のブロックに量子化する。
// pixel < 1 なら何もしない。透明度も保持する。
export function pixelateCanvas(canvas, ctx, pixel) {
  const W = canvas.width;
  const H = canvas.height;
  if (!pixel || pixel <= 0 || W === 0 || H === 0) return;

  const lw = Math.max(1, Math.round(W / pixel));
  const lh = Math.max(1, Math.round(H / pixel));
  if (lw >= W || lh >= H) return; // 縮小にならない（PIXEL_SIZE<1）＝ドット化しない

  // 縮小（ニアレスト＝平均化せず1ドットを代表色に）
  _tmp.width = lw;
  _tmp.height = lh;
  _tctx.imageSmoothingEnabled = false;
  _tctx.clearRect(0, 0, lw, lh);
  _tctx.drawImage(canvas, 0, 0, W, H, 0, 0, lw, lh);

  // 原寸へニアレスト拡大＝ブロック化
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(_tmp, 0, 0, lw, lh, 0, 0, W, H);
  ctx.imageSmoothingEnabled = true;
}
