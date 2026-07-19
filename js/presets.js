// 東京の部屋(1DK・南向き)のプリセット。
// 間取り図(玄関1.03J / DK / 居室11.69J / 南バルコニー)から書き起こし。
//
// 図面に寸法の記載がないため、居室11.69J(≈18.9㎡)と図の比率から
// 内寸を 幅3.9m × 全長9.5m(居室部分 約3.9×4.9m)と推定している。
// 実測後は「📐 実寸補正」で幅・奥行を入力すると全体が補正される。
//
// 座標系: 原点 = 室内の北西角。x: 東(右)+, y: 南(下)+。北が上。

import { genId } from './state.js';

export const TOKYO_ROOM = {
  name: '東京の部屋(推定寸法)',
  width: 3.9,     // 内寸幅(西→東)
  length: 9.5,    // 内寸全長(北→南)
};

export function tokyoRoomData() {
  const W = TOKYO_ROOM.width;   // 3.9
  const L = TOKYO_ROOM.length;  // 9.5
  const SAN = 2.35;             // 水回りブロックの南端 y
  const GENKAN_W = 1.0;         // 玄関・廊下の幅

  const w = (x1, y1, x2, y2) => ({ id: genId('w'), x1, y1, x2, y2 });

  const west = w(0, 0, 0, L);
  const north = w(0, 0, W, 0);
  const east = w(W, 0, W, L);
  const south = w(0, L, W, L);
  const sanWest = w(GENKAN_W, 0, GENKAN_W, SAN);        // 玄関と水回りの仕切り
  const sanSouth = w(GENKAN_W, SAN, W, SAN);            // 水回りブロック南壁

  const walls = [west, north, east, south, sanWest, sanSouth];

  const openings = [
    // 玄関ドア(北壁・西寄り)
    { id: genId('o'), wallId: north.id, type: 'door', offset: 0.55, width: 0.85, height: 2.0, sill: 0 },
    // 水回りへのドア(南壁の中央やや東)
    { id: genId('o'), wallId: sanSouth.id, type: 'door', offset: 1.55, width: 0.75, height: 2.0, sill: 0 },
    // 東面の窓 ×2(居室)
    { id: genId('o'), wallId: east.id, type: 'window', offset: 6.15, width: 1.2, height: 1.1, sill: 0.9 },
    { id: genId('o'), wallId: east.id, type: 'window', offset: 7.75, width: 1.6, height: 1.1, sill: 0.9 },
    // 南の掃き出し窓(バルコニーへ)
    { id: genId('o'), wallId: south.id, type: 'window', offset: 1.3, width: 2.2, height: 2.0, sill: 0.02 },
  ];

  // 動かせない設備(グレー表示・ドラッグ不可)
  const fixed = [
    {
      id: genId('f'), type: 'custom', label: 'キッチン(固定)',
      x: W - 0.325, y: 3.45, rot: 0, w: 0.65, d: 1.9, h: 0.85,
      color: '#a8adb3', elev: 0, locked: true,
    },
    {
      id: genId('f'), type: 'custom', label: '冷蔵庫置場',
      x: W - 0.35, y: 2.75, rot: 0, w: 0.7, d: 0.72, h: 1.8,
      color: '#c5c9cd', elev: 0, locked: true,
    },
  ];

  return { walls, openings, fixed };
}

// 状態に東京の部屋を読み込む(壁・開口を置き換え、固定設備を全案に配る)
export function applyTokyoRoom(state) {
  const data = tokyoRoomData();
  state.walls = data.walls;
  state.openings = data.openings;
  state.plan.image = null;
  state.settings.wallHeight = 2.4;
  state.settings.wallThickness = 0.12;
  for (const layout of state.layouts) {
    // 既存の固定設備を除いてから入れ直す
    layout.furniture = layout.furniture.filter(f => !f.locked);
    layout.furniture.unshift(...data.fixed.map(f => ({ ...f, id: genId('f') })));
  }
}
