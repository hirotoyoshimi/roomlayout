// 東京の部屋(1DK・南向き)のプリセット。
// 実測値入りの間取り図(2026-07 手書き採寸)+室内写真から書き起こし。
//
// 採寸値: 居室幅 2,940 / 窓側の壁〜水回りブロック 5,100 /
// 北東の水回りブロック(洗濯機・トイレ・洗面台・シャワー) 2,140×1,730 /
// 掃き出し窓 2,275 / 玄関ドア 800 / 南東の隅に柱 680×680。
// 東壁沿いは北から キッチン(1,250×600×850) → 冷蔵庫置場(685) → 柱(540)。
// 南の窓沿いに高さ40cmの造り付けベンチ。すべて実測ベース。
//
// 座標系: 原点 = 室内の北西角。x: 東(右)+, y: 南(下)+。北が上。

import { genId } from './state.js';

export const TOKYO_ROOM = {
  name: '東京の部屋(実測)',
  width: 2.94,    // 内寸幅(西→東) 実測
  length: 6.83,   // 内寸全長(北→南) = 水回り1.73 + 5.10 (ともに実測)
};

export function tokyoRoomData() {
  const W = TOKYO_ROOM.width;   // 2.94
  const L = TOKYO_ROOM.length;  // 6.83
  const SAN = 1.73;             // 水回りブロックの南端 y(実測 2,140×1,730)
  const GENKAN_W = W - 2.14;    // 玄関・廊下の幅 = 0.80

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
    { id: genId('o'), wallId: north.id, type: 'door', offset: 0.45, width: 0.8, height: 2.0, sill: 0 },
    // 水回りへのドア(南壁・東寄り)
    { id: genId('o'), wallId: sanSouth.id, type: 'door', offset: 1.25, width: 0.7, height: 2.0, sill: 0 },
    // 東面の窓(南東の柱のすぐ北)
    { id: genId('o'), wallId: east.id, type: 'window', offset: 5.72, width: 0.85, height: 1.1, sill: 0.9 },
    // 南の掃き出し窓(バルコニーへ) 実測2275。西端から、東側は南東の柱
    { id: genId('o'), wallId: south.id, type: 'window', offset: 1.14, width: 2.275, height: 2.0, sill: 0.02 },
  ];

  // 動かせない設備(グレー表示・ドラッグ不可)。東壁沿いは北から
  // キッチン → 冷蔵庫置場 → 柱 が水回りの壁から隙間なく並ぶ
  const KITCHEN_LEN = 1.25;   // 実測 125×60×85
  const FRIDGE_LEN = 0.685;   // 実測 685
  const PILLAR_E = 0.54;      // 実測 540角
  const fixed = [
    {
      id: genId('f'), type: 'custom', label: 'キッチン(固定)',
      x: W - 0.30, y: SAN + KITCHEN_LEN / 2, rot: 0, w: 0.60, d: KITCHEN_LEN, h: 0.85,
      color: '#a8adb3', elev: 0, locked: true,
    },
    {
      id: genId('f'), type: 'custom', label: '冷蔵庫置場',
      x: W - 0.34, y: SAN + KITCHEN_LEN + FRIDGE_LEN / 2, rot: 0, w: 0.68, d: FRIDGE_LEN, h: 1.8,
      color: '#c5c9cd', elev: 0, locked: true,
    },
    {
      // 床から天井までの柱
      id: genId('f'), type: 'custom', label: '柱(東)',
      x: W - 0.27, y: SAN + KITCHEN_LEN + FRIDGE_LEN + PILLAR_E / 2, rot: 0,
      w: PILLAR_E, d: PILLAR_E, h: 2.4,
      color: '#8f9296', elev: 0, locked: true,
    },
    {
      // 南東の隅の柱(実測680×680)。床から天井まで
      id: genId('f'), type: 'custom', label: '柱(南東)',
      x: W - 0.34, y: L - 0.34, rot: 0, w: 0.68, d: 0.68, h: 2.4,
      color: '#8f9296', elev: 0, locked: true,
    },
    {
      // 南の窓沿いの造り付けベンチ(高さ40cm)
      id: genId('f'), type: 'custom', label: 'ベンチ(固定)',
      x: 1.14, y: L - 0.25, rot: 0, w: 2.275, d: 0.5, h: 0.4,
      color: '#b09872', elev: 0, locked: true,
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
    // 既存の固定設備(と旧版で誤って家具化していた棚)を除いてから入れ直す
    layout.furniture = layout.furniture.filter(f => !f.locked && f.label !== '棚(実測685)');
    layout.furniture.unshift(...data.fixed.map(f => ({ ...f, id: genId('f') })));
  }
}
