// 東京の部屋(1DK・南向き)のプリセット。
// 実測値入りの間取り図(2026-07 手書き採寸)から書き起こし。
//
// 採寸値: 居室幅 2,940 / 窓側の壁〜水回りブロック 5,100 /
// 掃き出し窓 2,275(+壁680) / 西壁のバルコニー開口 670 /
// 玄関ドア 800 / キッチン横の棚 685 / 冷蔵庫置場(点線枠) 540。
// 水回りブロックの奥行(約1.92m)のみ図の比率からの推定。
//
// 座標系: 原点 = 室内の北西角。x: 東(右)+, y: 南(下)+。北が上。

import { genId } from './state.js';

export const TOKYO_ROOM = {
  name: '東京の部屋(実測)',
  width: 2.94,    // 内寸幅(西→東) 実測
  length: 7.02,   // 内寸全長(北→南) = 水回り1.92(推定) + 実測5.10
};

export function tokyoRoomData() {
  const W = TOKYO_ROOM.width;   // 2.94
  const L = TOKYO_ROOM.length;  // 7.02
  const SAN = 1.92;             // 水回りブロックの南端 y(推定)
  const GENKAN_W = 0.75;        // 玄関・廊下の幅(推定)

  const w = (x1, y1, x2, y2) => ({ id: genId('w'), x1, y1, x2, y2 });

  const west = w(0, 0, 0, L);
  const north = w(0, 0, W, 0);
  const east = w(W, 0, W, L);
  const south = w(0, L, W, L);
  const sanWest = w(GENKAN_W, 0, GENKAN_W, SAN);        // 玄関と水回りの仕切り
  const sanSouth = w(GENKAN_W, SAN, W, SAN);            // 水回りブロック南壁

  const walls = [west, north, east, south, sanWest, sanSouth];

  const openings = [
    // 玄関ドア(北壁・西寄り) 実測800
    { id: genId('o'), wallId: north.id, type: 'door', offset: 0.5, width: 0.8, height: 2.0, sill: 0 },
    // 水回りへのドア(南壁・東寄り)
    { id: genId('o'), wallId: sanSouth.id, type: 'door', offset: 1.25, width: 0.7, height: 2.0, sill: 0 },
    // 東面の窓(居室南東側)
    { id: genId('o'), wallId: east.id, type: 'window', offset: 6.2, width: 1.5, height: 1.1, sill: 0.9 },
    // 南の掃き出し窓(バルコニーへ) 実測2275。西端から、東側に壁680が残る
    { id: genId('o'), wallId: south.id, type: 'window', offset: 1.14, width: 2.275, height: 2.0, sill: 0.02 },
    // 西壁南寄りのバルコニー開口(実測670)
    { id: genId('o'), wallId: west.id, type: 'door', offset: 6.64, width: 0.67, height: 1.9, sill: 0.05 },
  ];

  // 動かせない設備(グレー表示・ドラッグ不可)
  const fixed = [
    {
      // キッチン(東壁沿い、水回りのすぐ南) 長さ約1.6m×奥行0.65
      id: genId('f'), type: 'custom', label: 'キッチン(固定)',
      x: W - 0.325, y: 2.72, rot: 0, w: 0.65, d: 1.6, h: 0.85,
      color: '#a8adb3', elev: 0, locked: true,
    },
    {
      // 冷蔵庫置場(点線枠・幅540)
      id: genId('f'), type: 'custom', label: '冷蔵庫置場',
      x: W - 0.34, y: 4.6, rot: 0, w: 0.68, d: 0.54, h: 1.8,
      color: '#c5c9cd', elev: 0, locked: true,
    },
  ];

  // 実測済みの手持ち家具(動かせる)
  const movable = [
    {
      // キッチンと冷蔵庫置場の間にある棚(実測685)
      id: genId('f'), type: 'custom', label: '棚(実測685)',
      x: W - 0.3, y: 3.87, rot: 0, w: 0.6, d: 0.685, h: 0.9,
      color: '#a3794f', elev: 0, owner: 'me',
    },
  ];

  return { walls, openings, fixed, movable };
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
    // 実測済みの手持ち家具は、まだ入っていない案にだけ足す
    for (const m of data.movable) {
      if (!layout.furniture.some(f => f.label === m.label)) {
        layout.furniture.push({ ...m, id: genId('f') });
      }
    }
  }
}
