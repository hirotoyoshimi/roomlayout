// 間取り図画像から壁を自動検出する。
// 手法: 二値化 → (必要なら二重線をクロージングで融合) → 距離変換で
// 壁の太さを推定 → 細い線・文字をオープニングで除去 → 水平/垂直の
// 帯(バンド)を抽出して線分化 → 角のスナップ。
// 日本の不動産間取り図のような、壁が太い線で描かれた図面を想定。

// img: デコード済み Image, pxPerMeter: 図面の縮尺 (px/m),
// rotationDeg: 傾き補正 (エディタの表示と同じく画像中心まわり)
// 戻り値: [{x1,y1,x2,y2}] (メートル、画像左上原点) — 検出失敗時は []
export function detectWalls(img, pxPerMeter, rotationDeg = 0) {
  const MAX_DIM = 1100;
  const k = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
  const W = Math.max(1, Math.round(img.width * k));
  const H = Math.max(1, Math.round(img.height * k));
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  ctx.translate(W / 2, H / 2);
  ctx.rotate(rotationDeg * Math.PI / 180);
  ctx.drawImage(img, -W / 2, -H / 2, W, H);
  ctx.resetTransform();
  const data = ctx.getImageData(0, 0, W, H).data;

  // --- グレースケール + 二値化 (大津の方法、暗い側 = 壁候補) ---
  const lum = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    lum[i] = (data[i * 4] * 77 + data[i * 4 + 1] * 150 + data[i * 4 + 2] * 29) >> 8;
  }
  const th = Math.min(otsu(lum), 170);
  let binary = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) binary[i] = lum[i] < th ? 1 : 0;

  // クロージング半径を変えて試す。クロージングは破線・二重線の壁を拾える
  // 反面、文字も塊になって誤検出されやすい。そこで、最大の検出量に対して
  // 遜色ない結果のうち「最小のクロージング半径」のものを採用する。
  const passes = [0, 2, 4].map(closeR => {
    const segs = detectPass(binary, W, H, closeR, k, pxPerMeter);
    const total = segs.reduce((a, s) => a + Math.hypot(s.x2 - s.x1, s.y2 - s.y1), 0);
    return { segs, total };
  });
  const maxTotal = Math.max(...passes.map(p => p.total));
  for (const p of passes) {
    if (p.total >= maxTotal * 0.75) return p.segs;
  }
  return passes[0].segs;
}

function detectPass(binaryIn, W, H, closeR, k, pxPerMeter) {
  // クロージング (dilate → erode) で二重線・破線を1本の太い線に融合する
  let binary = binaryIn;
  if (closeR > 0) {
    binary = erode(dilate(binaryIn, W, H, closeR), W, H, closeR);
  }

  // --- 距離変換で壁の半幅を推定 ---
  const dist = chamfer(binary, W, H);
  const distVals = [];
  for (let i = 0; i < W * H; i++) if (binary[i]) distVals.push(dist[i]);
  if (distVals.length < 100) return [];
  distVals.sort((a, b) => a - b);
  const halfW = clamp(distVals[Math.floor(distVals.length * 0.97)], 1.5, 16);

  // --- オープニング: 太い芯 (dist >= halfW/2) の周囲だけを残す ---
  const core = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) core[i] = dist[i] >= Math.max(1.5, halfW * 0.55) ? 1 : 0;
  const coreDist = chamferToSet(core, W, H);
  const mask = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) mask[i] = binary[i] && coreDist[i] <= halfW + 1 ? 1 : 0;

  // --- 水平・垂直の帯を抽出 ---
  const minLenPx = Math.max(14, 0.4 * pxPerMeter * k);
  const maxBandH = halfW * 3 + 4;
  const segsH = extractBands(mask, W, H, false, minLenPx, maxBandH);
  const segsV = extractBands(mask, W, H, true, minLenPx, maxBandH);

  // --- 二重線の壁などで重複した平行線分をマージ ---
  const mergeTol = halfW * 2 + 5;
  let segs = mergeParallel(segsH, false, mergeTol).concat(mergeParallel(segsV, true, mergeTol));

  // --- 角のスナップ: 端点が他の線分の近くならそこまで延長する ---
  const tol = halfW * 2.5 + 3;
  segs = snapJunctions(segs, tol);

  // --- 短すぎるものを捨てて、px → m に変換 ---
  const scale = 1 / (k * pxPerMeter);
  return segs
    .filter(s => Math.hypot(s.x2 - s.x1, s.y2 - s.y1) >= minLenPx)
    .map(s => ({
      x1: round2(s.x1 * scale), y1: round2(s.y1 * scale),
      x2: round2(s.x2 * scale), y2: round2(s.y2 * scale),
    }));
}

// 行(または列)方向の連続ランを帯にまとめ、壁の中心線に変換する
function extractBands(mask, W, H, vertical, minLen, maxBandH) {
  const outer = vertical ? W : H;   // 走査する行数
  const inner = vertical ? H : W;   // 行内の長さ
  const at = (o, i) => vertical ? mask[i * W + o] : mask[o * W + i];

  let active = [];  // {lo, hi, start, end, sumCenter, rows}
  const done = [];
  for (let o = 0; o < outer; o++) {
    // ラン検出(5px以下の隙間はノイズとして埋める)
    const runs = [];
    let runStart = -1, gap = 0;
    for (let i = 0; i <= inner; i++) {
      const v = i < inner ? at(o, i) : 0;
      if (v) {
        if (runStart < 0) runStart = i;
        gap = 0;
      } else if (runStart >= 0) {
        gap++;
        if (gap > 5 || i === inner) {
          const end = i - gap;
          if (end - runStart + 1 >= minLen) runs.push([runStart, end]);
          runStart = -1; gap = 0;
        }
      }
    }
    // 帯への割り当て
    const next = [];
    const used = new Set();
    for (const [lo, hi] of runs) {
      let band = null;
      for (const b of active) {
        if (!used.has(b) && lo <= b.hi && hi >= b.lo) { band = b; break; }
      }
      if (band) {
        used.add(band);
        band.lo = Math.min(band.lo, lo);
        band.hi = Math.max(band.hi, hi);
        band.end = o;
        band.rows++;
        band.px += hi - lo + 1;
        next.push(band);
      } else {
        next.push({ lo, hi, start: o, end: o, rows: 1, px: hi - lo + 1 });
      }
    }
    for (const b of active) if (!next.includes(b)) done.push(b);
    active = next;
  }
  done.push(...active);

  const segs = [];
  for (const b of done) {
    const bandH = b.end - b.start + 1;
    if (bandH < 2 || bandH > maxBandH) continue;      // 薄すぎ/塗り潰し領域は除外
    if (b.hi - b.lo + 1 < minLen) continue;
    // 塗り率: 壁はほぼベタ塗り(≈1.0)、文字や記号は隙間が多い
    const fill = b.px / ((b.hi - b.lo + 1) * bandH);
    if (fill < 0.8) continue;
    const c = (b.start + b.end) / 2;                   // 中心線
    if (vertical) segs.push({ x1: c, y1: b.lo, x2: c, y2: b.hi });
    else segs.push({ x1: b.lo, y1: c, x2: b.hi, y2: c });
  }
  return segs;
}

// 近接した平行線分(二重線の壁の両側など)を1本にまとめる
function mergeParallel(segs, vertical, tol) {
  // 位置 = 線分の走査軸座標, 範囲 = 線分方向の区間
  const items = segs.map(s => vertical
    ? { pos: s.x1, lo: Math.min(s.y1, s.y2), hi: Math.max(s.y1, s.y2) }
    : { pos: s.y1, lo: Math.min(s.x1, s.x2), hi: Math.max(s.x1, s.x2) });
  let changed = true;
  while (changed) {
    changed = false;
    outer:
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i], b = items[j];
        if (Math.abs(a.pos - b.pos) > tol) continue;
        const overlap = Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo);
        const shorter = Math.min(a.hi - a.lo, b.hi - b.lo);
        if (overlap < shorter * 0.5) continue;   // 同一直線上の別壁はマージしない
        const wa = a.hi - a.lo, wb = b.hi - b.lo;
        a.pos = (a.pos * wa + b.pos * wb) / (wa + wb);
        a.lo = Math.min(a.lo, b.lo);
        a.hi = Math.max(a.hi, b.hi);
        items.splice(j, 1);
        changed = true;
        break outer;
      }
    }
  }
  return items.map(it => vertical
    ? { x1: it.pos, y1: it.lo, x2: it.pos, y2: it.hi }
    : { x1: it.lo, y1: it.pos, x2: it.hi, y2: it.pos });
}

// 水平・垂直の線分の端点を、近くの直交する線分との交点まで延長する
function snapJunctions(segs, tol) {
  const hs = segs.filter(s => s.y1 === s.y2);
  const vs = segs.filter(s => s.x1 === s.x2);
  for (const h of hs) {
    for (const v of vs) {
      const ix = v.x1, iy = h.y1;
      const vLo = Math.min(v.y1, v.y2), vHi = Math.max(v.y1, v.y2);
      const hLo = Math.min(h.x1, h.x2), hHi = Math.max(h.x1, h.x2);
      // 交点が両線分の近傍にあるか
      if (iy < vLo - tol || iy > vHi + tol) continue;
      if (ix < hLo - tol || ix > hHi + tol) continue;
      // 水平線分の端の延長
      if (ix < hLo && ix >= hLo - tol) { if (h.x1 < h.x2) h.x1 = ix; else h.x2 = ix; }
      if (ix > hHi && ix <= hHi + tol) { if (h.x1 > h.x2) h.x1 = ix; else h.x2 = ix; }
      // 垂直線分の端の延長
      if (iy < vLo && iy >= vLo - tol) { if (v.y1 < v.y2) v.y1 = iy; else v.y2 = iy; }
      if (iy > vHi && iy <= vHi + tol) { if (v.y1 > v.y2) v.y1 = iy; else v.y2 = iy; }
    }
  }
  return hs.concat(vs);
}

// ---------- 形態学 / 距離変換 ----------

// L1 チャンファー距離: 前景(=1)ピクセルの、背景からの距離
function chamfer(fg, W, H) {
  const INF = 1e7;
  const d = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) d[i] = fg[i] ? INF : 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (d[i] === 0) continue;
      let m = d[i];
      if (x > 0) m = Math.min(m, d[i - 1] + 1);
      if (y > 0) m = Math.min(m, d[i - W] + 1);
      d[i] = m;
    }
  }
  for (let y = H - 1; y >= 0; y--) {
    for (let x = W - 1; x >= 0; x--) {
      const i = y * W + x;
      if (d[i] === 0) continue;
      let m = d[i];
      if (x < W - 1) m = Math.min(m, d[i + 1] + 1);
      if (y < H - 1) m = Math.min(m, d[i + W] + 1);
      d[i] = m;
    }
  }
  return d;
}

// 集合 set への距離 (set ピクセルが 0)
function chamferToSet(set, W, H) {
  const inv = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) inv[i] = set[i] ? 0 : 1;
  return chamfer(inv, W, H);
}

// ボックス膨張 (2パスのスライディング処理)
function dilate(src, W, H, r) {
  if (r <= 0) return src;
  const tmp = new Uint8Array(W * H);
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let v = 0;
      for (let dx = -r; dx <= r && !v; dx++) {
        const nx = x + dx;
        if (nx >= 0 && nx < W && src[y * W + nx]) v = 1;
      }
      tmp[y * W + x] = v;
    }
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let v = 0;
      for (let dy = -r; dy <= r && !v; dy++) {
        const ny = y + dy;
        if (ny >= 0 && ny < H && tmp[ny * W + x]) v = 1;
      }
      out[y * W + x] = v;
    }
  }
  return out;
}

function erode(src, W, H, r) {
  if (r <= 0) return src;
  const inv = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) inv[i] = src[i] ? 0 : 1;
  const d = dilate(inv, W, H, r);
  const out = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) out[i] = d[i] ? 0 : 1;
  return out;
}

function otsu(lum) {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < lum.length; i++) hist[lum[i]]++;
  const total = lum.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, maxVar = 0, best = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > maxVar) { maxVar = v; best = t; }
  }
  return best;
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function round2(v) { return Math.round(v * 100) / 100; }
