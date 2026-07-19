// 2D 間取りエディタ。
// キャンバス上に間取り図画像を下敷きとして表示し、壁・ドア・窓・家具を編集する。

import {
  getState, mutate, mutateLive, beginUndoGroup, endUndoGroup,
  genId, wallLength, nearestOnWall, wallsBounds, activeFurniture,
} from './state.js';
import { catalogItem } from './catalog.js';

const GRID = 0.05;          // スナップ格子 (m)
const ENDPOINT_SNAP_PX = 12; // 既存端点への吸着距離 (画面px)

export class Editor2D {
  constructor(canvas, { onSelectionChange, onHint } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onSelectionChange = onSelectionChange || (() => {});
    this.onHint = onHint || (() => {});

    this.view = { s: 80, x: 0, y: 0 }; // s: px/m
    this.tool = 'select';
    this.selection = null;             // {kind: 'wall'|'furniture'|'opening', id}
    this.drawChain = null;             // 壁描画中: {x, y} 直前の確定点
    this.cursor = null;                // ワールド座標のカーソル位置
    this.drag = null;
    this.calib = null;                 // 縮尺合わせ: {x1, y1} 1点目
    this.planImg = null;               // デコード済み Image
    this.planImgSrc = null;

    this._bindEvents();
    this.resize();
    this.centerView();
  }

  // ---------- 座標変換 ----------
  toScreen(wx, wy) { return [wx * this.view.s + this.view.x, wy * this.view.s + this.view.y]; }
  toWorld(sx, sy) { return [(sx - this.view.x) / this.view.s, (sy - this.view.y) / this.view.s]; }

  centerView() {
    const b = wallsBounds(0.5);
    const { width, height } = this.canvas.getBoundingClientRect();
    if (b) {
      const s = Math.min(width / (b.maxX - b.minX), height / (b.maxY - b.minY), 200);
      this.view.s = Math.max(20, s * 0.9);
      this.view.x = width / 2 - (b.minX + b.maxX) / 2 * this.view.s;
      this.view.y = height / 2 - (b.minY + b.maxY) / 2 * this.view.s;
    } else if (this.planImg) {
      const st = getState();
      const w = this.planImg.width / st.plan.scale, h = this.planImg.height / st.plan.scale;
      const s = Math.min(width / w, height / h) * 0.9;
      this.view.s = Math.max(10, Math.min(200, s));
      this.view.x = width / 2 - w / 2 * this.view.s;
      this.view.y = height / 2 - h / 2 * this.view.s;
    } else {
      this.view.s = 80;
      this.view.x = width / 2 - 2 * this.view.s;
      this.view.y = height / 2 - 2 * this.view.s;
    }
    this.render();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, rect.width * dpr);
    this.canvas.height = Math.max(1, rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.render();
  }

  // ---------- 下敷き画像 ----------
  syncPlanImage() {
    const src = getState().plan.image;
    if (src === this.planImgSrc) return;
    this.planImgSrc = src;
    if (!src) { this.planImg = null; this.render(); return; }
    const img = new Image();
    img.onload = () => { this.planImg = img; this.centerView(); };
    img.src = src;
  }

  // ---------- ツール ----------
  setTool(tool) {
    this.tool = tool;
    this.drawChain = null;
    this.calib = null;
    if (tool !== 'select') this.setSelection(null);
    const hints = {
      select: '',
      wall: 'クリックで壁の角を順に置いていきます。ダブルクリックか Esc で終了。Shift で角度スナップ解除',
      door: '壁の上をクリックしてドアを配置します',
      window: '壁の上をクリックして窓を配置します',
      calibrate: '間取り図上で実寸のわかる2点（例: 壁の両端）を順にクリックしてください',
    };
    this.onHint(hints[tool] ?? '');
    this.render();
  }

  setSelection(sel) {
    this.selection = sel;
    this.onSelectionChange(sel);
    this.render();
  }

  getSelected() {
    const s = getState();
    if (!this.selection) return null;
    const { kind, id } = this.selection;
    const list = kind === 'wall' ? s.walls : kind === 'opening' ? s.openings : activeFurniture(s);
    const obj = list.find(o => o.id === id);
    return obj ? { kind, obj } : null;
  }

  // カタログから家具を追加（画面中央に置く）
  addFurniture(type) {
    const c = catalogItem(type);
    const rect = this.canvas.getBoundingClientRect();
    const [cx, cy] = this.toWorld(rect.width / 2, rect.height / 2);
    const item = {
      id: genId('f'), type: c.type, label: c.label,
      x: snap(cx, GRID), y: snap(cy, GRID), rot: 0,
      w: c.w, d: c.d, h: c.h, color: c.color, elev: 0,
    };
    mutate(s => activeFurniture(s).push(item));
    this.setTool('select');
    this.setSelection({ kind: 'furniture', id: item.id });
  }

  deleteSelection() {
    const sel = this.getSelected();
    if (!sel) return;
    mutate(s => {
      if (sel.kind === 'wall') {
        s.walls = s.walls.filter(w => w.id !== sel.obj.id);
        s.openings = s.openings.filter(o => o.wallId !== sel.obj.id);
      } else if (sel.kind === 'opening') {
        s.openings = s.openings.filter(o => o.id !== sel.obj.id);
      } else {
        const lay = s.layouts.find(l => l.id === s.activeLayoutId);
        lay.furniture = lay.furniture.filter(f => f.id !== sel.obj.id);
      }
    });
    this.setSelection(null);
  }

  rotateSelection(deg = 15) {
    const sel = this.getSelected();
    if (!sel || sel.kind !== 'furniture') return;
    mutate(() => { sel.obj.rot = (sel.obj.rot + deg) % 360; });
  }

  // ---------- 入力 ----------
  _bindEvents() {
    const c = this.canvas;
    c.addEventListener('pointerdown', e => this._onDown(e));
    c.addEventListener('pointermove', e => this._onMove(e));
    c.addEventListener('pointerup', e => this._onUp(e));
    c.addEventListener('dblclick', e => { e.preventDefault(); this._finishChain(); });
    c.addEventListener('contextmenu', e => { e.preventDefault(); this._finishChain(); });
    c.addEventListener('wheel', e => {
      e.preventDefault();
      const rect = c.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const factor = Math.exp(-e.deltaY * 0.0012);
      this.zoomAt(mx, my, factor);
    }, { passive: false });
  }

  zoomAt(sx, sy, factor) {
    const [wx, wy] = this.toWorld(sx, sy);
    this.view.s = Math.max(8, Math.min(600, this.view.s * factor));
    this.view.x = sx - wx * this.view.s;
    this.view.y = sy - wy * this.view.s;
    this.render();
  }

  _pos(e) {
    const rect = this.canvas.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  _onDown(e) {
    const [sx, sy] = this._pos(e);
    const [wx, wy] = this.toWorld(sx, sy);
    this.canvas.setPointerCapture(e.pointerId);

    // 中ボタン or Space はパン
    if (e.button === 1 || this._space) {
      this.drag = { kind: 'pan', sx, sy, vx: this.view.x, vy: this.view.y };
      return;
    }
    if (e.button !== 0) return;

    if (this.tool === 'wall') { this._wallClick(sx, sy, e.shiftKey); return; }
    if (this.tool === 'door' || this.tool === 'window') { this._placeOpening(wx, wy, this.tool); return; }
    if (this.tool === 'calibrate') { this._calibClick(wx, wy); return; }

    // ---- 選択ツール ----
    // 回転ハンドル
    const rotHandle = this._rotHandlePos();
    if (rotHandle && Math.hypot(sx - rotHandle[0], sy - rotHandle[1]) < 10) {
      const sel = this.getSelected();
      beginUndoGroup();
      this.drag = { kind: 'rotate', item: sel.obj };
      return;
    }
    // 壁端点ハンドル
    const sel = this.getSelected();
    if (sel && sel.kind === 'wall') {
      for (const end of [1, 2]) {
        const [ex, ey] = this.toScreen(sel.obj[`x${end}`], sel.obj[`y${end}`]);
        if (Math.hypot(sx - ex, sy - ey) < 10) {
          beginUndoGroup();
          this.drag = { kind: 'wall-end', wall: sel.obj, end };
          return;
        }
      }
    }

    const hit = this._hitTest(wx, wy, sx, sy);
    if (hit) {
      this.setSelection({ kind: hit.kind, id: hit.obj.id });
      beginUndoGroup();
      if (hit.kind === 'furniture') {
        if (!hit.obj.locked) {
          this.drag = { kind: 'furniture', item: hit.obj, ox: wx - hit.obj.x, oy: wy - hit.obj.y };
        }
      } else if (hit.kind === 'wall') {
        this.drag = { kind: 'wall-move', wall: hit.obj, wx, wy, orig: { ...hit.obj } };
      } else if (hit.kind === 'opening') {
        this.drag = { kind: 'opening', opening: hit.obj };
      }
    } else {
      this.setSelection(null);
      this.drag = { kind: 'pan', sx, sy, vx: this.view.x, vy: this.view.y };
    }
  }

  _onMove(e) {
    const [sx, sy] = this._pos(e);
    const [wx, wy] = this.toWorld(sx, sy);
    this.cursor = [wx, wy];

    if (!this.drag) {
      if (this.tool === 'wall' && this.drawChain) this.render();
      if (this.tool === 'calibrate' && this.calib) this.render();
      return;
    }
    const d = this.drag;
    if (d.kind === 'pan') {
      this.view.x = d.vx + (sx - d.sx);
      this.view.y = d.vy + (sy - d.sy);
      this.render();
    } else if (d.kind === 'furniture') {
      mutateLive(() => {
        d.item.x = snap(wx - d.ox, GRID);
        d.item.y = snap(wy - d.oy, GRID);
      });
    } else if (d.kind === 'rotate') {
      const ang = Math.atan2(wy - d.item.y, wx - d.item.x) * 180 / Math.PI + 90;
      mutateLive(() => { d.item.rot = e.shiftKey ? Math.round(ang) : Math.round(ang / 15) * 15; });
    } else if (d.kind === 'wall-end') {
      const p = this._snapPoint(wx, wy, sx, sy, d.wall);
      mutateLive(() => { d.wall[`x${d.end}`] = p.x; d.wall[`y${d.end}`] = p.y; });
    } else if (d.kind === 'wall-move') {
      const dx = snap(wx - d.wx, GRID), dy = snap(wy - d.wy, GRID);
      mutateLive(() => {
        d.wall.x1 = d.orig.x1 + dx; d.wall.y1 = d.orig.y1 + dy;
        d.wall.x2 = d.orig.x2 + dx; d.wall.y2 = d.orig.y2 + dy;
      });
    } else if (d.kind === 'opening') {
      const s = getState();
      const wall = s.walls.find(w => w.id === d.opening.wallId);
      if (wall) {
        const near = nearestOnWall(wall, wx, wy);
        const len = wallLength(wall);
        const half = d.opening.width / 2;
        mutateLive(() => {
          d.opening.offset = Math.max(half, Math.min(len - half, near.t * len));
        });
      }
    }
  }

  _onUp(e) {
    if (this.drag && this.drag.kind !== 'pan') endUndoGroup();
    this.drag = null;
  }

  setSpace(down) { this._space = down; this.canvas.style.cursor = down ? 'grab' : ''; }

  // ---------- 壁描画 ----------
  _wallClick(sx, sy, freeAngle) {
    const [wx, wy] = this.toWorld(sx, sy);
    const p = this._snapPoint(wx, wy, sx, sy, null, this.drawChain, freeAngle);
    if (!this.drawChain) {
      this.drawChain = { x: p.x, y: p.y };
    } else {
      const { x, y } = this.drawChain;
      if (Math.hypot(p.x - x, p.y - y) > 0.02) {
        mutate(s => s.walls.push({ id: genId('w'), x1: x, y1: y, x2: p.x, y2: p.y }));
        this.drawChain = { x: p.x, y: p.y };
      }
    }
    this.render();
  }

  _finishChain() {
    if (this.drawChain) { this.drawChain = null; this.render(); }
  }

  cancel() {
    if (this.drawChain) { this.drawChain = null; this.render(); return true; }
    if (this.calib) { this.calib = null; this.render(); return true; }
    if (this.selection) { this.setSelection(null); return true; }
    return false;
  }

  // スナップ: 既存端点 → 格子。壁描画中は前の点からの角度も45°単位にスナップ
  _snapPoint(wx, wy, sx, sy, ignoreWall, from = null, freeAngle = false) {
    const s = getState();
    for (const w of s.walls) {
      if (w === ignoreWall) continue;
      for (const end of [1, 2]) {
        const ex = w[`x${end}`], ey = w[`y${end}`];
        const [px, py] = this.toScreen(ex, ey);
        if (Math.hypot(sx - px, sy - py) < ENDPOINT_SNAP_PX) return { x: ex, y: ey, snapped: true };
      }
    }
    let x = wx, y = wy;
    if (from && !freeAngle) {
      const dx = wx - from.x, dy = wy - from.y;
      const dist = Math.hypot(dx, dy);
      const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
      x = from.x + Math.cos(ang) * dist;
      y = from.y + Math.sin(ang) * dist;
    }
    return { x: snap(x, GRID), y: snap(y, GRID), snapped: false };
  }

  // ---------- ドア / 窓 ----------
  _placeOpening(wx, wy, type) {
    const s = getState();
    let best = null;
    for (const w of s.walls) {
      const near = nearestOnWall(w, wx, wy);
      if (near.dist < 0.4 && (!best || near.dist < best.near.dist)) best = { wall: w, near };
    }
    if (!best) { this.onHint('壁の近くをクリックしてください'); return; }
    const len = wallLength(best.wall);
    const def = type === 'door'
      ? { width: 0.8, height: 2.0, sill: 0 }
      : { width: 1.2, height: 1.1, sill: 0.9 };
    if (len < def.width + 0.1) { this.onHint('壁が短すぎて配置できません'); return; }
    const half = def.width / 2;
    const offset = Math.max(half, Math.min(len - half, best.near.t * len));
    const op = { id: genId('o'), wallId: best.wall.id, type, offset, ...def };
    mutate(st => st.openings.push(op));
    this.setTool('select');
    this.setSelection({ kind: 'opening', id: op.id });
  }

  // ---------- 縮尺合わせ ----------
  _calibClick(wx, wy) {
    if (!this.calib) {
      this.calib = { x1: wx, y1: wy };
      this.onHint('2点目をクリックしてください');
      this.render();
      return;
    }
    const dist = Math.hypot(wx - this.calib.x1, wy - this.calib.y1);
    this.calib = null;
    if (dist < 1e-6) return;
    const input = prompt('この2点間の実際の距離を cm で入力してください（例: 360）');
    const cm = parseFloat(input);
    if (!input || !isFinite(cm) || cm <= 0) { this.setTool('select'); return; }
    const real = cm / 100;
    // 図面からなぞった/自動検出した壁は、新しい縮尺に追従させる
    const scaleWalls = getState().walls.length > 0 &&
      confirm('既存の壁や家具の位置も新しい縮尺に合わせて拡大縮小しますか？\n（図面から作った壁は「OK」を推奨）');
    mutate(s => {
      // 現在 dist(m) と測れた区間が実際は real(m)。画像の px/m を補正する
      s.plan.scale = s.plan.scale * dist / real;
      if (scaleWalls) {
        const f = real / dist;
        for (const w of s.walls) { w.x1 *= f; w.y1 *= f; w.x2 *= f; w.y2 *= f; }
        for (const o of s.openings) o.offset *= f;
        for (const lay of s.layouts) {
          for (const fu of lay.furniture) { fu.x *= f; fu.y *= f; } // 位置のみ。サイズは実寸なので不変
        }
      }
    });
    this.onHint(`縮尺を設定しました（${cm}cm）。次は「🧱 壁を描く」で図面をなぞってください`);
    this.setTool('select');
    this.centerView();
  }

  // ---------- ヒットテスト ----------
  _hitTest(wx, wy, sx, sy) {
    const s = getState();
    // 家具（後に描いたもの = 上にあるものを優先）
    const furn = activeFurniture(s);
    for (let i = furn.length - 1; i >= 0; i--) {
      const f = furn[i];
      if (pointInRect(wx, wy, f)) return { kind: 'furniture', obj: f };
    }
    // ドア・窓
    for (const o of s.openings) {
      const w = s.walls.find(x => x.id === o.wallId);
      if (!w) continue;
      const len = wallLength(w);
      if (len === 0) continue;
      const t = o.offset / len;
      const cx = w.x1 + (w.x2 - w.x1) * t, cy = w.y1 + (w.y2 - w.y1) * t;
      const [px, py] = this.toScreen(cx, cy);
      if (Math.hypot(sx - px, sy - py) < Math.max(14, o.width / 2 * this.view.s)) {
        return { kind: 'opening', obj: o };
      }
    }
    // 壁
    const tolerance = 10 / this.view.s;
    for (const w of s.walls) {
      if (nearestOnWall(w, wx, wy).dist < Math.max(tolerance, getState().settings.wallThickness)) {
        return { kind: 'wall', obj: w };
      }
    }
    return null;
  }

  _rotHandlePos() {
    const sel = this.getSelected();
    if (!sel || sel.kind !== 'furniture' || sel.obj.locked) return null;
    const f = sel.obj;
    const rad = f.rot * Math.PI / 180;
    const dist = f.d / 2 + 25 / this.view.s;
    // 家具ローカル座標 (0, -dist) を回転させた位置
    const hx = f.x + Math.sin(rad) * dist;
    const hy = f.y - Math.cos(rad) * dist;
    return this.toScreen(hx, hy);
  }

  // ---------- 描画 ----------
  render() {
    const ctx = this.ctx;
    const rect = this.canvas.getBoundingClientRect();
    const W = rect.width, H = rect.height;
    const s = getState();
    const v = this.view;

    ctx.clearRect(0, 0, W, H);

    // グリッド
    this._drawGrid(W, H);

    // 下敷き画像（傾き補正は画像中心まわりの回転で適用）
    if (this.planImg) {
      ctx.save();
      ctx.globalAlpha = s.plan.opacity;
      const iw = this.planImg.width / s.plan.scale * v.s;
      const ih = this.planImg.height / s.plan.scale * v.s;
      ctx.translate(v.x + iw / 2, v.y + ih / 2);
      ctx.rotate((s.plan.rotation || 0) * Math.PI / 180);
      ctx.drawImage(this.planImg, -iw / 2, -ih / 2, iw, ih);
      ctx.restore();
    }

    // 壁
    const thick = Math.max(2, s.settings.wallThickness * v.s);
    for (const w of s.walls) {
      const selected = this.selection?.kind === 'wall' && this.selection.id === w.id;
      const [x1, y1] = this.toScreen(w.x1, w.y1);
      const [x2, y2] = this.toScreen(w.x2, w.y2);
      ctx.strokeStyle = selected ? '#4a7a5c' : '#57514a';
      ctx.lineWidth = thick;
      ctx.lineCap = 'butt';
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();

      // 寸法ラベル
      const len = wallLength(w);
      if (len > 0.3 && v.s > 30) {
        const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
        let ang = Math.atan2(y2 - y1, x2 - x1);
        if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
        ctx.save();
        ctx.translate(mx, my); ctx.rotate(ang);
        ctx.fillStyle = selected ? '#4a7a5c' : '#7a746b';
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${Math.round(len * 100)}cm`, 0, -thick / 2 - 4);
        ctx.restore();
      }
      if (selected) {
        for (const end of [1, 2]) {
          const [ex, ey] = this.toScreen(w[`x${end}`], w[`y${end}`]);
          ctx.fillStyle = '#fff'; ctx.strokeStyle = '#4a7a5c'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(ex, ey, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
      }
    }

    // ドア・窓
    for (const o of s.openings) {
      const w = s.walls.find(x => x.id === o.wallId);
      if (!w) continue;
      this._drawOpening(w, o, thick);
    }

    // 家具
    for (const f of activeFurniture(s)) {
      this._drawFurniture(f);
    }

    // 壁描画プレビュー
    if (this.tool === 'wall' && this.drawChain && this.cursor) {
      const [csx, csy] = this.toScreen(this.cursor[0], this.cursor[1]);
      const p = this._snapPoint(this.cursor[0], this.cursor[1], csx, csy, null, this.drawChain, false);
      const [x1, y1] = this.toScreen(this.drawChain.x, this.drawChain.y);
      const [x2, y2] = this.toScreen(p.x, p.y);
      ctx.strokeStyle = 'rgba(74,122,92,.8)';
      ctx.lineWidth = thick;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      const len = Math.hypot(p.x - this.drawChain.x, p.y - this.drawChain.y);
      ctx.fillStyle = '#2f5c40';
      ctx.font = 'bold 12px sans-serif';
      ctx.fillText(`${Math.round(len * 100)}cm`, (x1 + x2) / 2 + 8, (y1 + y2) / 2 - 8);
    }
    if (this.tool === 'wall' && this.drawChain) {
      const [x, y] = this.toScreen(this.drawChain.x, this.drawChain.y);
      ctx.fillStyle = '#4a7a5c';
      ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
    }

    // 縮尺合わせの1点目マーカー
    if (this.calib) {
      const [x, y] = this.toScreen(this.calib.x1, this.calib.y1);
      ctx.strokeStyle = '#b05545'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - 11, y); ctx.lineTo(x + 11, y); ctx.moveTo(x, y - 11); ctx.lineTo(x, y + 11); ctx.stroke();
      if (this.cursor) {
        const [cx, cy] = this.toScreen(this.cursor[0], this.cursor[1]);
        ctx.setLineDash([6, 4]);
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(cx, cy); ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  _drawGrid(W, H) {
    const ctx = this.ctx, v = this.view;
    const step = v.s;             // 1m
    if (step < 8) return;
    const x0 = ((v.x % step) + step) % step;
    const y0 = ((v.y % step) + step) % step;
    ctx.strokeStyle = 'rgba(0,0,0,.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = x0; x < W; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = y0; y < H; y += step) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
  }

  _drawOpening(w, o, thickPx) {
    const ctx = this.ctx;
    const len = wallLength(w);
    if (len === 0) return;
    const ux = (w.x2 - w.x1) / len, uy = (w.y2 - w.y1) / len;
    const cx = w.x1 + ux * o.offset, cy = w.y1 + uy * o.offset;
    const half = o.width / 2;
    const [ax, ay] = this.toScreen(cx - ux * half, cy - uy * half);
    const [bx, by] = this.toScreen(cx + ux * half, cy + uy * half);
    const selected = this.selection?.kind === 'opening' && this.selection.id === o.id;

    // 壁の切れ目（白）
    ctx.strokeStyle = '#edeae3';
    ctx.lineWidth = thickPx + 2;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();

    if (o.type === 'door') {
      // 開き扉の弧
      const r = Math.hypot(bx - ax, by - ay);
      const ang = Math.atan2(by - ay, bx - ax);
      ctx.strokeStyle = selected ? '#4a7a5c' : '#8a8378';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.arc(ax, ay, r, ang, ang - Math.PI / 2, true);
      ctx.lineTo(ax, ay);
      ctx.stroke();
    } else {
      ctx.strokeStyle = selected ? '#4a7a5c' : '#6f8fae';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    }
    if (selected) {
      ctx.strokeStyle = '#4a7a5c'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
      ctx.strokeRect(Math.min(ax, bx) - 4, Math.min(ay, by) - 4 - thickPx / 2,
        Math.abs(bx - ax) + 8 + 1, Math.abs(by - ay) + 8 + thickPx);
      ctx.setLineDash([]);
    }
  }

  _drawFurniture(f) {
    const ctx = this.ctx, v = this.view;
    const [cx, cy] = this.toScreen(f.x, f.y);
    const selected = this.selection?.kind === 'furniture' && this.selection.id === f.id;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(f.rot * Math.PI / 180);
    const w = f.w * v.s, d = f.d * v.s;
    ctx.fillStyle = f.locked ? 'rgba(150,150,150,.35)' : hexWithAlpha(f.color, 0.55);
    ctx.strokeStyle = selected ? '#2f5c40' : shade(f.color, -30);
    ctx.lineWidth = selected ? 2.5 : 1.5;
    if (f.locked) ctx.setLineDash([5, 3]);
    roundRect(ctx, -w / 2, -d / 2, w, d, Math.min(6, w / 5, d / 5));
    ctx.fill(); ctx.stroke();
    ctx.setLineDash([]);

    // 所有者マーカー(左上の点): 自分=青 / 同居人=紫
    if (f.owner === 'me' || f.owner === 'roommate') {
      ctx.fillStyle = f.owner === 'me' ? '#3d6ea5' : '#8a4fa8';
      ctx.beginPath();
      ctx.arc(-w / 2 + 7, -d / 2 + 7, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    if (v.s > 25 && Math.min(w, d) > 24) {
      ctx.fillStyle = '#3a352e';
      ctx.font = `${Math.min(12, d / 3)}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(f.label, 0, d > 34 ? -6 : 0, w - 6);
      if (d > 34) {
        ctx.fillStyle = '#7a746b';
        ctx.font = `${Math.min(10, d / 4)}px sans-serif`;
        ctx.fillText(`${Math.round(f.w * 100)}×${Math.round(f.d * 100)}`, 0, 8, w - 6);
      }
    }
    ctx.restore();

    if (selected) {
      const hp = this._rotHandlePos();
      if (hp) {
        ctx.strokeStyle = '#2f5c40'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(hp[0], hp[1]); ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(hp[0], hp[1], 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
    }
  }
}

// ---------- 小物 ----------
function snap(v, grid) { return Math.round(v / grid) * grid; }

function pointInRect(wx, wy, f) {
  const rad = -f.rot * Math.PI / 180;
  const dx = wx - f.x, dy = wy - f.y;
  const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
  const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
  return Math.abs(lx) <= f.w / 2 && Math.abs(ly) <= f.d / 2;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function hexWithAlpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const c = v => Math.max(0, Math.min(255, v + amt));
  const r = c((n >> 16) & 255), g = c((n >> 8) & 255), b = c(n & 255);
  return `rgb(${r},${g},${b})`;
}
