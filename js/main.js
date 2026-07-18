// アプリ全体の配線: タブ・ツール・プロパティパネル・写真管理・保存/読込。

import {
  getState, load, mutate, undo, redo, resetAll,
  exportJSON, importJSON, onChange, genId, wallLength,
} from './state.js';
import { CATALOG } from './catalog.js';
import { Editor2D } from './editor2d.js';
import { Viewer3D } from './viewer3d.js';
import { detectWalls } from './autotrace.js';

load();

const $ = sel => document.querySelector(sel);

// ---------- 2D エディタ ----------
const editor = new Editor2D($('#canvas2d'), {
  onSelectionChange: renderProps,
  onHint: text => { $('#hint').textContent = text; },
});
editor.syncPlanImage();

// ---------- 3D ビューア ----------
const viewer = new Viewer3D($('#canvas3d'));

// ---------- タブ ----------
let mode3d = false;
function setMode(is3d) {
  mode3d = is3d;
  $('#tab-2d').classList.toggle('active', !is3d);
  $('#tab-3d').classList.toggle('active', is3d);
  $('#view-2d').classList.toggle('active', !is3d);
  $('#view-3d').classList.toggle('active', is3d);
  viewer.setActive(is3d);
  if (is3d) {
    viewer.rebuild();
    viewer.resize();
    if (!setMode._camInit) { viewer.viewIso(); setMode._camInit = true; }
  } else {
    editor.resize();
  }
}
$('#tab-2d').addEventListener('click', () => setMode(false));
$('#tab-3d').addEventListener('click', () => setMode(true));

// ---------- 状態変化の反映 ----------
let rebuildQueued = false;
onChange(() => {
  editor.syncPlanImage();
  editor.render();
  refreshSettingsInputs();
  renderPhotoUI();
  // 選択中オブジェクトが消えた場合に備えて選択を検証
  if (editor.selection && !editor.getSelected()) editor.setSelection(null);
  if (mode3d && !rebuildQueued) {
    rebuildQueued = true;
    requestAnimationFrame(() => { rebuildQueued = false; viewer.rebuild(); });
  }
});

// ---------- ツールバー ----------
document.querySelectorAll('#toolbar .tool[data-tool]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#toolbar .tool').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    editor.setTool(btn.dataset.tool);
  });
});
function resetToolUI() {
  document.querySelectorAll('#toolbar .tool').forEach(b =>
    b.classList.toggle('active', b.dataset.tool === 'select'));
}

// カタログ
for (const c of CATALOG) {
  const btn = document.createElement('button');
  btn.innerHTML = `<span class="emoji">${c.emoji}</span>${c.label}`;
  btn.title = `${Math.round(c.w * 100)}×${Math.round(c.d * 100)}×${Math.round(c.h * 100)}cm`;
  btn.addEventListener('click', () => { editor.addFurniture(c.type); resetToolUI(); });
  $('#catalog').appendChild(btn);
}

// ---------- 間取り図（下敷き） ----------
$('#plan-file').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const dataURL = await fileToDataURL(file, 1600);
  mutate(s => { s.plan.image = dataURL; });
  editor.syncPlanImage();
  $('#hint').textContent = '間取り図を読み込みました。「✨ 壁を自動検出」で図面から壁を起こせます（手動なら「🧱 壁を描く」）';
});

// 画像から壁を自動検出
$('#btn-autotrace').addEventListener('click', () => {
  if (!editor.planImg) {
    $('#hint').textContent = '先に「🖼 画像を読み込む」で間取り図を読み込んでください';
    return;
  }
  const s = getState();
  if (s.walls.length &&
      !confirm(`既存の壁 ${s.walls.length} 本とドア・窓を削除して、画像から検出し直しますか？`)) {
    return;
  }
  $('#hint').textContent = '解析中…';
  // ヒント表示を反映してから重い処理を回す
  setTimeout(() => {
    const segs = detectWalls(editor.planImg, getState().plan.scale);
    if (!segs.length) {
      $('#hint').textContent = '壁を検出できませんでした。より解像度が高くコントラストのはっきりした画像を試すか、「🧱 壁を描く」で手動でなぞってください';
      return;
    }
    mutate(st => {
      st.walls = segs.map(g => ({ id: genId('w'), ...g }));
      st.openings = [];
    });
    editor.setSelection(null);
    editor.centerView();
    $('#hint').textContent =
      `${segs.length} 本の壁を検出しました。余分な壁は選択して Delete、位置は端点ドラッグで調整。` +
      '次は「📏 縮尺合わせ」で実寸を設定してください（壁も一緒に拡縮されます）';
  }, 30);
});

$('#plan-opacity').addEventListener('input', e => {
  mutate(s => { s.plan.opacity = e.target.value / 100; }, { undoable: false });
});

$('#btn-plan-remove').addEventListener('click', () => {
  if (!getState().plan.image) return;
  if (!confirm('下敷きの間取り図画像を削除しますか？（壁や家具は残ります）')) return;
  mutate(s => { s.plan.image = null; });
});

// ---------- プロパティパネル ----------
function renderProps() {
  const body = $('#props-body');
  const sel = editor.getSelected();
  if (!sel) {
    body.innerHTML = '<p class="muted">壁や家具を選択すると、ここでサイズや色を編集できます。</p>';
    return;
  }
  const { kind, obj } = sel;
  body.innerHTML = '';

  const title = document.createElement('h3');
  const row = (labelText, input) => {
    const l = document.createElement('label');
    l.append(labelText, input);
    body.appendChild(l);
    return input;
  };
  const numInput = (value, onCommit, opts = {}) => {
    const i = document.createElement('input');
    i.type = 'number';
    Object.assign(i, opts);
    i.value = value;
    i.addEventListener('change', () => {
      const v = parseFloat(i.value);
      if (isFinite(v)) onCommit(v);
    });
    return i;
  };

  if (kind === 'furniture') {
    title.textContent = `家具: ${obj.label}`;
    body.appendChild(title);

    const name = document.createElement('input');
    name.type = 'text'; name.value = obj.label;
    name.addEventListener('change', () => mutate(() => { obj.label = name.value || obj.label; }));
    row('名前', name);

    row('幅 (cm)', numInput(Math.round(obj.w * 100), v => mutate(() => { obj.w = clampCm(v); }), { min: 5, max: 1000 }));
    row('奥行 (cm)', numInput(Math.round(obj.d * 100), v => mutate(() => { obj.d = clampCm(v); }), { min: 5, max: 1000 }));
    row('高さ (cm)', numInput(Math.round(obj.h * 100), v => mutate(() => { obj.h = clampCm(v); }), { min: 1, max: 400 }));
    row('床からの高さ (cm)', numInput(Math.round((obj.elev || 0) * 100), v => mutate(() => { obj.elev = Math.max(0, v / 100); }), { min: 0, max: 300 }));
    row('回転 (度)', numInput(Math.round(obj.rot), v => mutate(() => { obj.rot = ((v % 360) + 360) % 360; }), { min: 0, max: 359, step: 15 }));

    const color = document.createElement('input');
    color.type = 'color'; color.value = obj.color;
    color.addEventListener('change', () => mutate(() => { obj.color = color.value; }));
    row('色', color);

    const btns = document.createElement('div');
    btns.className = 'btn-row';
    const dup = document.createElement('button');
    dup.textContent = '⧉ 複製';
    dup.addEventListener('click', () => {
      const copy = { ...obj, id: genId('f'), x: obj.x + 0.3, y: obj.y + 0.3 };
      mutate(s => s.furniture.push(copy));
      editor.setSelection({ kind: 'furniture', id: copy.id });
    });
    const del = document.createElement('button');
    del.className = 'danger'; del.textContent = '🗑 削除';
    del.addEventListener('click', () => editor.deleteSelection());
    btns.append(dup, del);
    body.appendChild(btns);

  } else if (kind === 'wall') {
    title.textContent = '壁';
    body.appendChild(title);
    row('長さ (cm)', numInput(Math.round(wallLength(obj) * 100), v => {
      const len = wallLength(obj);
      if (len < 1e-6 || v < 10) return;
      mutate(() => {
        const k = (v / 100) / len;
        obj.x2 = obj.x1 + (obj.x2 - obj.x1) * k;
        obj.y2 = obj.y1 + (obj.y2 - obj.y1) * k;
      });
    }, { min: 10, max: 3000 }));
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = '端点の○をドラッグして長さや角度を変えられます。厚み・高さは「部屋の設定」で全体に適用されます。';
    body.appendChild(p);
    const btns = document.createElement('div');
    btns.className = 'btn-row';
    const del = document.createElement('button');
    del.className = 'danger'; del.textContent = '🗑 削除';
    del.addEventListener('click', () => editor.deleteSelection());
    btns.append(del);
    body.appendChild(btns);

  } else if (kind === 'opening') {
    title.textContent = obj.type === 'door' ? 'ドア' : '窓';
    body.appendChild(title);
    row('幅 (cm)', numInput(Math.round(obj.width * 100), v => mutate(() => { obj.width = clampCm(v); }), { min: 30, max: 400 }));
    row('高さ (cm)', numInput(Math.round(obj.height * 100), v => mutate(() => { obj.height = clampCm(v); }), { min: 20, max: 300 }));
    row('床からの高さ (cm)', numInput(Math.round(obj.sill * 100), v => mutate(() => { obj.sill = Math.max(0, v / 100); }), { min: 0, max: 250 }));
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'ドラッグで壁に沿って移動できます。';
    body.appendChild(p);
    const btns = document.createElement('div');
    btns.className = 'btn-row';
    const del = document.createElement('button');
    del.className = 'danger'; del.textContent = '🗑 削除';
    del.addEventListener('click', () => editor.deleteSelection());
    btns.append(del);
    body.appendChild(btns);
  }
}

function clampCm(v) { return Math.max(0.01, Math.min(30, v / 100)); }

// ---------- 部屋の設定 ----------
function refreshSettingsInputs() {
  const s = getState();
  if (document.activeElement !== $('#set-wall-height')) $('#set-wall-height').value = Math.round(s.settings.wallHeight * 100);
  if (document.activeElement !== $('#set-wall-thickness')) $('#set-wall-thickness').value = Math.round(s.settings.wallThickness * 100);
  if (document.activeElement !== $('#plan-opacity')) $('#plan-opacity').value = Math.round(s.plan.opacity * 100);
  $('#floor-color').value = s.settings.floorColor;
  $('#wall-color').value = s.settings.wallColor;
  if (document.activeElement !== $('#floor-repeat')) $('#floor-repeat').value = Math.round(s.settings.floorRepeat * 100);
  if (document.activeElement !== $('#wall-repeat')) $('#wall-repeat').value = Math.round(s.settings.wallRepeat * 100);
  $('#show-ceiling').checked = s.settings.showCeiling;
  $('#show-labels').checked = s.settings.showLabels;
}

$('#set-wall-height').addEventListener('change', e => {
  const v = parseFloat(e.target.value);
  if (isFinite(v)) mutate(s => { s.settings.wallHeight = Math.max(1.8, Math.min(4, v / 100)); });
});
$('#set-wall-thickness').addEventListener('change', e => {
  const v = parseFloat(e.target.value);
  if (isFinite(v)) mutate(s => { s.settings.wallThickness = Math.max(0.05, Math.min(0.4, v / 100)); });
});

// ---------- 写真・テクスチャ ----------
$('#photo-file').addEventListener('change', async e => {
  const files = [...e.target.files];
  e.target.value = '';
  for (const file of files) {
    const dataURL = await fileToDataURL(file, 1024);
    mutate(s => s.photos.push({
      id: genId('p'),
      name: file.name.replace(/\.[^.]+$/, '').slice(0, 24) || '写真',
      data: dataURL,
    }));
  }
});

function renderPhotoUI() {
  const s = getState();
  const list = $('#photo-list');
  list.innerHTML = '';
  for (const p of s.photos) {
    const div = document.createElement('div');
    div.className = 'photo';
    const img = document.createElement('img');
    img.src = p.data; img.alt = p.name;
    const name = document.createElement('div');
    name.className = 'name'; name.textContent = p.name;
    const del = document.createElement('button');
    del.className = 'del'; del.textContent = '×'; del.title = '削除';
    del.addEventListener('click', () => {
      mutate(st => {
        st.photos = st.photos.filter(x => x.id !== p.id);
        if (st.settings.floorPhoto === p.id) st.settings.floorPhoto = null;
        if (st.settings.wallPhoto === p.id) st.settings.wallPhoto = null;
      });
    });
    div.append(img, del, name);
    list.appendChild(div);
  }

  for (const [selId, key] of [['#floor-photo', 'floorPhoto'], ['#wall-photo', 'wallPhoto']]) {
    const select = $(selId);
    select.innerHTML = '';
    const none = document.createElement('option');
    none.value = ''; none.textContent = '（単色）';
    select.appendChild(none);
    for (const p of s.photos) {
      const opt = document.createElement('option');
      opt.value = p.id; opt.textContent = p.name;
      select.appendChild(opt);
    }
    select.value = s.settings[key] || '';
  }
}

$('#floor-photo').addEventListener('change', e => mutate(s => { s.settings.floorPhoto = e.target.value || null; }));
$('#wall-photo').addEventListener('change', e => mutate(s => { s.settings.wallPhoto = e.target.value || null; }));
$('#floor-color').addEventListener('change', e => mutate(s => { s.settings.floorColor = e.target.value; }));
$('#wall-color').addEventListener('change', e => mutate(s => { s.settings.wallColor = e.target.value; }));
$('#floor-repeat').addEventListener('change', e => {
  const v = parseFloat(e.target.value);
  if (isFinite(v)) mutate(s => { s.settings.floorRepeat = Math.max(0.2, v / 100); });
});
$('#wall-repeat').addEventListener('change', e => {
  const v = parseFloat(e.target.value);
  if (isFinite(v)) mutate(s => { s.settings.wallRepeat = Math.max(0.2, v / 100); });
});
$('#cutaway').addEventListener('change', e => { viewer.cutaway = e.target.checked; });
$('#show-ceiling').addEventListener('change', e => mutate(s => { s.settings.showCeiling = e.target.checked; }));
$('#show-labels').addEventListener('change', e => mutate(s => { s.settings.showLabels = e.target.checked; }));

// ---------- 3D 操作ボタン ----------
$('#cam-top').addEventListener('click', () => viewer.viewTop());
$('#cam-iso').addEventListener('click', () => viewer.viewIso());
$('#cam-inside').addEventListener('click', () => viewer.viewInside());
$('#btn-shot').addEventListener('click', () => viewer.screenshot());

// ---------- ズームバー ----------
$('#zoom-in').addEventListener('click', () => {
  const r = $('#canvas2d').getBoundingClientRect();
  editor.zoomAt(r.width / 2, r.height / 2, 1.25);
});
$('#zoom-out').addEventListener('click', () => {
  const r = $('#canvas2d').getBoundingClientRect();
  editor.zoomAt(r.width / 2, r.height / 2, 0.8);
});
$('#zoom-fit').addEventListener('click', () => editor.centerView());

// ---------- 保存 / 読込 / 新規 ----------
$('#btn-export').addEventListener('click', exportJSON);
$('#btn-import').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    importJSON(await file.text());
    editor.setSelection(null);
    editor.centerView();
  } catch (err) {
    alert(`読み込めませんでした: ${err.message}`);
  }
});
$('#btn-new').addEventListener('click', () => {
  if (!confirm('すべての壁・家具・写真を消して最初からやり直しますか？\n（元に戻す ↩︎ で復元できます）')) return;
  resetAll();
  editor.setSelection(null);
  editor.centerView();
});

$('#btn-undo').addEventListener('click', undo);
$('#btn-redo').addEventListener('click', redo);

// ---------- キーボード ----------
window.addEventListener('keydown', e => {
  const inInput = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    e.shiftKey ? redo() : undo();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  if (inInput) return;
  if (e.key === 'Delete' || e.key === 'Backspace') { editor.deleteSelection(); }
  if (e.key.toLowerCase() === 'r' && !mode3d) { editor.rotateSelection(e.shiftKey ? -15 : 15); }
  if (e.key === 'Escape') {
    if (!editor.cancel()) { editor.setTool('select'); resetToolUI(); }
  }
  if (e.key === ' ') { editor.setSpace(true); e.preventDefault(); }
});
window.addEventListener('keyup', e => {
  if (e.key === ' ') editor.setSpace(false);
});

// ---------- リサイズ ----------
window.addEventListener('resize', () => {
  editor.resize();
  if (mode3d) viewer.resize();
});

// ---------- 画像 → 縮小 dataURL ----------
async function fileToDataURL(file, maxSize) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('画像を読み込めませんでした'));
      i.src = url;
    });
    const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.width * scale));
    c.height = Math.max(1, Math.round(img.height * scale));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// デバッグ・自動テスト用フック
window.__app = { editor, viewer, getState };

// ---------- 初期化 ----------
refreshSettingsInputs();
renderPhotoUI();
renderProps(null);
editor.resize();
editor.centerView();
