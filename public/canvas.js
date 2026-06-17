// Kalıcı çizim yüzeyi: pürüzsüz çizgiler, silgi, temizle, OCR anlık görüntüsü
// ve cevabın "el yazısı gibi" çizilmesi.

// Bir nokta dizisini pürüzsüz bir eğri olarak çizer (kuadratik orta-nokta
// yöntemi — imza/çizim uygulamalarındaki klasik yumuşatma). Hem canlı önizleme
// (overlay) hem de kalıcı işleme (board) için aynı fonksiyon kullanılır ki
// çizgi "commit" anında görünüm değiştirmesin.
export function strokePath(ctx, pts, color, width) {
  if (!pts.length) return;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;

  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, width / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  if (pts.length === 2) {
    ctx.lineTo(pts[1].x, pts[1].y);
    ctx.stroke();
    return;
  }
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2;
    const my = (pts[i].y + pts[i + 1].y) / 2;
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
}

// Ramer–Douglas–Peucker: çizgi biter bitmez gürültülü noktaları seyreltip
// daha temiz/düzgün bir çizgi bırakır ("çizim sonu düzeltme").
export function simplify(points, epsilon = 1.6) {
  if (points.length < 3) return points.slice();
  const sqEps = epsilon * epsilon;

  function sqSegDist(p, a, b) {
    let x = a.x,
      y = a.y,
      dx = b.x - x,
      dy = b.y - y;
    if (dx !== 0 || dy !== 0) {
      const t = ((p.x - x) * dx + (p.y - y) * dy) / (dx * dx + dy * dy);
      if (t > 1) {
        x = b.x;
        y = b.y;
      } else if (t > 0) {
        x += dx * t;
        y += dy * t;
      }
    }
    dx = p.x - x;
    dy = p.y - y;
    return dx * dx + dy * dy;
  }

  function rdp(first, last, pts, out) {
    let maxSq = sqEps,
      index = -1;
    for (let i = first + 1; i < last; i++) {
      const sq = sqSegDist(pts[i], pts[first], pts[last]);
      if (sq > maxSq) {
        index = i;
        maxSq = sq;
      }
    }
    if (index !== -1) {
      if (index - first > 1) rdp(first, index, pts, out);
      out.push(pts[index]);
      if (last - index > 1) rdp(index, last, pts, out);
    }
  }

  const out = [points[0]];
  rdp(0, points.length - 1, points, out);
  out.push(points[points.length - 1]);
  return out;
}

export class Board {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { willReadFrequently: true });
    this.lastAnswerRect = null;
  }

  get w() {
    return this.canvas.width;
  }
  get h() {
    return this.canvas.height;
  }

  resize(width, height) {
    if (this.w === width && this.h === height) return;
    const snapshot =
      this.w && this.h ? this.ctx.getImageData(0, 0, this.w, this.h) : null;
    this.canvas.width = width;
    this.canvas.height = height;
    if (snapshot) this.ctx.putImageData(snapshot, 0, 0);
    this.ctx.lineCap = "round";
    this.ctx.lineJoin = "round";
  }

  // Tamamlanmış bir çizgiyi kalıcı yüzeye işler (önce hafifçe sadeleştirir).
  commitStroke(pts, color, width) {
    this.ctx.globalCompositeOperation = "source-over";
    const clean = simplify(pts, Math.max(1.2, width * 0.18));
    strokePath(this.ctx, clean, color, width);
  }

  eraseSegment(a, b, radius) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.lineCap = "round";
    ctx.lineWidth = radius * 2;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(b.x, b.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  clear() {
    this.ctx.clearRect(0, 0, this.w, this.h);
    this.lastAnswerRect = null;
  }

  computeBBox(exclude = null) {
    const { data } = this.ctx.getImageData(0, 0, this.w, this.h);
    let minX = this.w,
      minY = this.h,
      maxX = 0,
      maxY = 0,
      found = false;
    const step = 2;
    for (let y = 0; y < this.h; y += step) {
      for (let x = 0; x < this.w; x += step) {
        if (
          exclude &&
          x >= exclude.x - 4 &&
          x <= exclude.x + exclude.w + 4 &&
          y >= exclude.y - 4 &&
          y <= exclude.y + exclude.h + 4
        )
          continue;
        if (data[(y * this.w + x) * 4 + 3] > 12) {
          found = true;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (!found) return null;
    return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
  }

  isEmpty() {
    return this.computeBBox() === null;
  }

  snapshotForOCR() {
    const off = document.createElement("canvas");
    off.width = this.w;
    off.height = this.h;
    const octx = off.getContext("2d");
    octx.fillStyle = "#ffffff";
    octx.fillRect(0, 0, off.width, off.height);
    octx.drawImage(this.canvas, 0, 0);
    return off.toDataURL("image/png");
  }

  // Cevabı denklemin YANINA çizer; sığmazsa yazı tipini küçültür, gerçekten
  // yer yoksa son çare olarak altına koyar. "answer" aynen yazılır (örn. "19"
  // ya da "x = 2").
  renderAnswer(answerText, color) {
    const bbox = this.computeBBox(this.lastAnswerRect);
    if (!bbox) return;

    if (this.lastAnswerRect) {
      const r = this.lastAnswerRect;
      this.ctx.clearRect(r.x - 4, r.y - 4, r.w + 8, r.h + 8);
    }

    const ctx = this.ctx;
    ctx.globalCompositeOperation = "source-over";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = color;
    const setFont = (s) =>
      (ctx.font = `700 ${s}px "Bradley Hand", "Comic Sans MS", "Segoe Print", cursive`);

    const text = String(answerText);
    const baseFont = Math.max(40, Math.min(bbox.h, 150));
    const gap = Math.max(14, bbox.h * 0.18);

    // 1) Denklemin sağına dene
    let x = bbox.maxX + gap;
    let availW = this.w - x - 12;
    let fontSize = baseFont;
    setFont(fontSize);
    let tw = ctx.measureText(text).width;
    if (tw > availW) {
      fontSize = Math.max(24, fontSize * (availW / tw));
      setFont(fontSize);
      tw = ctx.measureText(text).width;
    }
    let below = false;

    // 2) Sağda yeterli yer yoksa altına koy
    if (availW < bbox.h * 0.7) {
      below = true;
      x = Math.max(8, bbox.minX);
      availW = this.w - x - 12;
      fontSize = baseFont;
      setFont(fontSize);
      tw = ctx.measureText(text).width;
      if (tw > availW) {
        fontSize = Math.max(24, fontSize * (availW / tw));
        setFont(fontSize);
        tw = ctx.measureText(text).width;
      }
    }

    let y = below
      ? Math.min(this.h - 8, bbox.maxY + fontSize * 1.05)
      : bbox.minY + bbox.h / 2 + fontSize * 0.34;
    if (y > this.h - 6) y = this.h - 6;

    ctx.fillText(text, x, y);
    this.lastAnswerRect = { x, y: y - fontSize, w: tw, h: fontSize * 1.35 };
  }
}
