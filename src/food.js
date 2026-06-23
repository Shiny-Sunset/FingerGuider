// 餌（ダンゴムシが寄ってきて食べる）。amount は残量（1=満タン, 0で消滅）。
export class Food {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.amount = 1;
  }

  get eaten() {
    return this.amount <= 0;
  }
}
