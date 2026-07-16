// アプリの状態モデル・永続化・Undo/Redo。
// 長さの単位はすべてメートル。座標系は間取り図の平面 (x: 右+, y: 下+)。

const STORAGE_KEY = 'room-layout-3d/v1';

export function defaultState() {
  return {
    version: 1,
    settings: {
      wallHeight: 2.4,
      wallThickness: 0.12,
      floorColor: '#d8c8a8',
      wallColor: '#f2ede4',
      floorPhoto: null,   // photos[].id
      wallPhoto: null,
      floorRepeat: 2.0,   // テクスチャ1タイルの実寸幅 (m)
      wallRepeat: 2.5,
      showCeiling: false,
      showLabels: true,
    },
    plan: {
      image: null,        // dataURL
      scale: 100,         // 図面画像の px / m
      opacity: 0.45,
    },
    walls: [],            // {id, x1, y1, x2, y2}
    openings: [],         // {id, wallId, type: 'door'|'window', offset(中心, 壁始点から m), width, height, sill}
    furniture: [],        // {id, type, label, x, y(中心), rot(度), w, d, h, color, elev}
    photos: [],           // {id, name, data(dataURL)}
  };
}

let state = defaultState();
let undoStack = [];
let redoStack = [];
const listeners = new Set();

let nextId = 1;
export function genId(prefix) { return `${prefix}${nextId++}_${Math.random().toString(36).slice(2, 7)}`; }

export function getState() { return state; }

export function onChange(fn) { listeners.add(fn); }

function emit(scope) {
  for (const fn of listeners) fn(scope);
}

// ---- 変更のエントリポイント ----
// mutate(fn): Undo対象の編集。commit=false のドラッグ中などは snapshot を積まない。
export function mutate(fn, { undoable = true, scope = 'model' } = {}) {
  if (undoable) pushUndo();
  fn(state);
  save();
  emit(scope);
}

// ドラッグ開始時に1回だけ呼ぶと、ドラッグ全体が1回のUndoになる
export function beginUndoGroup() { pushUndo(); }
export function mutateLive(fn, scope = 'model') {
  fn(state);
  emit(scope);
}
export function endUndoGroup() { save(); }

function pushUndo() {
  undoStack.push(JSON.stringify(state));
  if (undoStack.length > 60) undoStack.shift();
  redoStack = [];
  updateUndoButtons();
}

export function undo() {
  if (!undoStack.length) return;
  redoStack.push(JSON.stringify(state));
  state = JSON.parse(undoStack.pop());
  save();
  emit('model');
  updateUndoButtons();
}

export function redo() {
  if (!redoStack.length) return;
  undoStack.push(JSON.stringify(state));
  state = JSON.parse(redoStack.pop());
  save();
  emit('model');
  updateUndoButtons();
}

function updateUndoButtons() {
  const u = document.getElementById('btn-undo');
  const r = document.getElementById('btn-redo');
  if (u) u.disabled = !undoStack.length;
  if (r) r.disabled = !redoStack.length;
}

// ---- 永続化 ----
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      // 画像入りで容量超過することがある。データ本体は失わないよう黙って諦める。
      console.warn('localStorage への保存に失敗:', e.message);
    }
  }, 400);
}

export function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.version === 1) {
        state = Object.assign(defaultState(), parsed);
        state.settings = Object.assign(defaultState().settings, parsed.settings || {});
        state.plan = Object.assign(defaultState().plan, parsed.plan || {});
      }
    }
  } catch (e) {
    console.warn('保存データの読み込みに失敗:', e.message);
  }
}

export function resetAll() {
  pushUndo();
  state = defaultState();
  save();
  emit('model');
}

// ---- 書き出し / 読み込み ----
export function exportJSON() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  a.download = `room-layout-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function importJSON(text) {
  const parsed = JSON.parse(text);
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.walls)) {
    throw new Error('このファイルは部屋レイアウトのデータではないようです');
  }
  pushUndo();
  state = Object.assign(defaultState(), parsed);
  state.settings = Object.assign(defaultState().settings, parsed.settings || {});
  state.plan = Object.assign(defaultState().plan, parsed.plan || {});
  save();
  emit('model');
}

// ---- 幾何ヘルパ ----
export function wallLength(w) {
  return Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
}

// 点 p から壁 w への最近傍。{t: 0..1, dist, x, y} を返す
export function nearestOnWall(w, px, py) {
  const dx = w.x2 - w.x1, dy = w.y2 - w.y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - w.x1) * dx + (py - w.y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const x = w.x1 + t * dx, y = w.y1 + t * dy;
  return { t, dist: Math.hypot(px - x, py - y), x, y };
}

// すべての壁の端点のバウンディングボックス（床の生成などに使う）
export function wallsBounds(margin = 0) {
  const s = getState();
  if (!s.walls.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const w of s.walls) {
    minX = Math.min(minX, w.x1, w.x2); maxX = Math.max(maxX, w.x1, w.x2);
    minY = Math.min(minY, w.y1, w.y2); maxY = Math.max(maxY, w.y1, w.y2);
  }
  return { minX: minX - margin, minY: minY - margin, maxX: maxX + margin, maxY: maxY + margin };
}
