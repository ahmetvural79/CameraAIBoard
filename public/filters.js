// One-Euro filtresi: el takibinde titremeyi düşük gecikmeyle bastırmak için
// kullanılan standart yöntem. Yavaş harekette güçlü yumuşatma, hızlı harekette
// düşük gecikme verir (cutoff frekansı hıza göre artar).
// Ref: Casiez et al., "1€ Filter" (CHI 2012).

class LowPass {
  constructor() {
    this.y = null;
  }
  filter(x, alpha) {
    this.y = this.y === null ? x : alpha * x + (1 - alpha) * this.y;
    return this.y;
  }
  reset() {
    this.y = null;
  }
}

export class OneEuro {
  constructor({ minCutoff = 1.0, beta = 0.02, dCutoff = 1.0 } = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.xPrev = null;
    this.tPrev = null;
    this.xLP = new LowPass();
    this.dxLP = new LowPass();
  }
  alpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }
  filter(x, tMs) {
    if (this.tPrev === null) {
      this.tPrev = tMs;
      this.xPrev = x;
      this.xLP.y = x;
      return x;
    }
    let dt = (tMs - this.tPrev) / 1000;
    if (dt <= 0 || dt > 1) dt = 1 / 30;
    this.tPrev = tMs;

    const dx = (x - this.xPrev) / dt;
    this.xPrev = x;
    const edx = this.dxLP.filter(dx, this.alpha(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    return this.xLP.filter(x, this.alpha(cutoff, dt));
  }
  reset() {
    this.xPrev = null;
    this.tPrev = null;
    this.xLP.reset();
    this.dxLP.reset();
  }
}

// 2B nokta için x/y eksenlerini birlikte filtreler.
export class PointFilter {
  constructor(opts) {
    this.fx = new OneEuro(opts);
    this.fy = new OneEuro(opts);
  }
  filter(p, tMs) {
    return { x: this.fx.filter(p.x, tMs), y: this.fy.filter(p.y, tMs) };
  }
  reset() {
    this.fx.reset();
    this.fy.reset();
  }
}
