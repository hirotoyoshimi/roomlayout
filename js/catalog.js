// 家具カタログ。寸法はメートル (w: 幅, d: 奥行, h: 高さ)。
// shape は viewer3d.js の 3D ビルダー選択に使う。

export const CATALOG = [
  { type: 'bed_s',    label: 'ベッド(S)',   emoji: '🛏', w: 0.97, d: 1.95, h: 0.45, color: '#c9d6e8', shape: 'bed' },
  { type: 'bed_sd',   label: 'ベッド(SD)',  emoji: '🛏', w: 1.20, d: 1.95, h: 0.45, color: '#c9d6e8', shape: 'bed' },
  { type: 'bed_d',    label: 'ベッド(D)',   emoji: '🛏', w: 1.40, d: 1.95, h: 0.45, color: '#c9d6e8', shape: 'bed' },
  { type: 'desk',     label: 'デスク',      emoji: '🪵', w: 1.20, d: 0.60, h: 0.72, color: '#b48c5c', shape: 'desk' },
  { type: 'chair',    label: 'チェア',      emoji: '🪑', w: 0.48, d: 0.50, h: 0.85, color: '#7a8a99', shape: 'chair' },
  { type: 'sofa2',    label: 'ソファ(2人)', emoji: '🛋', w: 1.60, d: 0.85, h: 0.80, color: '#9aa87e', shape: 'sofa' },
  { type: 'sofa1',    label: 'ソファ(1人)', emoji: '🛋', w: 0.90, d: 0.85, h: 0.80, color: '#9aa87e', shape: 'sofa' },
  { type: 'table_lo', label: 'ローテーブル', emoji: '🫖', w: 0.90, d: 0.50, h: 0.40, color: '#a3794f', shape: 'table' },
  { type: 'table',    label: 'テーブル',    emoji: '🍽', w: 1.20, d: 0.75, h: 0.72, color: '#a3794f', shape: 'table' },
  { type: 'wardrobe', label: 'ワードローブ', emoji: '🚪', w: 1.20, d: 0.60, h: 2.00, color: '#8d6e4e', shape: 'wardrobe' },
  { type: 'shelf',    label: '本棚',        emoji: '📚', w: 0.60, d: 0.30, h: 1.80, color: '#8d6e4e', shape: 'shelf' },
  { type: 'chest',    label: 'チェスト',    emoji: '🗄', w: 0.80, d: 0.45, h: 0.90, color: '#8d6e4e', shape: 'wardrobe' },
  { type: 'tvboard',  label: 'TVボード',    emoji: '📺', w: 1.50, d: 0.40, h: 0.45, color: '#6e5a44', shape: 'tvboard' },
  { type: 'fridge',   label: '冷蔵庫',      emoji: '🧊', w: 0.60, d: 0.65, h: 1.40, color: '#c8ccd0', shape: 'box' },
  { type: 'plant',    label: '観葉植物',    emoji: '🪴', w: 0.40, d: 0.40, h: 1.20, color: '#5e8a56', shape: 'plant' },
  { type: 'rug',      label: 'ラグ',        emoji: '🟫', w: 2.00, d: 1.40, h: 0.02, color: '#c4a98a', shape: 'rug' },
  { type: 'boxst',    label: '収納ボックス', emoji: '📦', w: 0.40, d: 0.40, h: 0.40, color: '#b7ad9d', shape: 'box' },
  { type: 'custom',   label: 'カスタム',    emoji: '➕', w: 1.00, d: 1.00, h: 1.00, color: '#b0b0b0', shape: 'box' },
];

// 実物の家具(所有している・購入予定の実在アイテム)。寸法は実物どおり
export const REAL_FURNITURE = [
  {
    type: 'kallax_4x4', label: 'KALLAX 147×147', emoji: '🟫',
    w: 1.47, d: 0.39, h: 1.47, color: '#4a3c33', shape: 'shelf',
    note: 'IKEA KALLAX シェルフユニット ブラックブラウン (103.518.89)',
  },
];

export function catalogItem(type) {
  return CATALOG.find(c => c.type === type)
    || REAL_FURNITURE.find(c => c.type === type)
    || CATALOG[CATALOG.length - 1];
}
