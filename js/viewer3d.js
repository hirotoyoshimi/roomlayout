// 3D ビューア。state の間取り・家具を Three.js のシーンに組み立てる。
// 座標系: 平面図の (x, y) → 3D の (x, z)。高さは y。

import * as THREE from 'three';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { getState, wallLength, wallsBounds, activeFurniture } from './state.js';
import { catalogItem } from './catalog.js';

export class Viewer3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xe8eef2);
    this.scene.fog = new THREE.Fog(0xe8eef2, 30, 80);

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.05, 200);
    this.camera.position.set(5, 6, 7);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 0.5, 0);
    this.controls.maxPolarAngle = Math.PI * 0.55;
    this.controls.enableDamping = true;

    // ライティング
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xb0a894, 0.75));
    const sun = new THREE.DirectionalLight(0xfff4e0, 1.6);
    sun.position.set(6, 12, 4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -12; sun.shadow.camera.right = 12;
    sun.shadow.camera.top = 12; sun.shadow.camera.bottom = -12;
    sun.shadow.bias = -0.0004;
    this.scene.add(sun);

    // 地面（部屋の外側の余白）
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(60, 48),
      new THREE.MeshLambertMaterial({ color: 0xd5d0c6 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    this.scene.add(ground);

    this.root = new THREE.Group();  // rebuild で作り直す部分
    this.scene.add(this.root);

    this.textureCache = new Map();  // photoId -> THREE.Texture
    this.center = new THREE.Vector3(2, 0, 2);
    this.wallGroups = [];           // カットアウェイ用 {group, mid}
    this.cutaway = true;            // 手前の壁を自動で隠す
    this.active = false;

    const loop = () => {
      requestAnimationFrame(loop);
      if (!this.active) return;
      this.controls.update();
      this._updateCutaway();
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  // カメラと部屋の中心の間にある壁を半透明にして、外からでも室内が見えるようにする
  _updateCutaway() {
    const cam = this.camera.position;
    for (const wg of this.wallGroups) {
      const inward = new THREE.Vector3().subVectors(this.center, wg.mid).setY(0);
      const toCam = new THREE.Vector3().subVectors(cam, wg.mid).setY(0);
      const facing = inward.lengthSq() > 1e-6 && inward.dot(toCam) < 0;
      const fade = this.cutaway && facing;
      for (const mesh of wg.group.children) {
        if (mesh.userData.isGlass) continue;
        mesh.material.opacity = fade ? 0.13 : 1;
        mesh.castShadow = !fade;
      }
    }
  }

  setActive(on) {
    this.active = on;
    if (on) this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);
    this.renderer.setSize(rect.width, rect.height, false);
    this.camera.aspect = rect.width / rect.height;
    this.camera.updateProjectionMatrix();
  }

  screenshot() {
    this.renderer.render(this.scene, this.camera);
    const a = document.createElement('a');
    a.href = this.renderer.domElement.toDataURL('image/png');
    a.download = 'room-3d.png';
    a.click();
  }

  // ---------- カメラプリセット ----------
  viewTop() {
    const c = this.center;
    this.camera.position.set(c.x, Math.max(8, this.roomSpan * 1.3), c.z + 0.01);
    this.controls.target.copy(c);
  }
  viewIso() {
    const c = this.center;
    const r = Math.max(6, this.roomSpan * 1.1);
    this.camera.position.set(c.x + r * 0.8, r * 0.75, c.z + r * 0.8);
    this.controls.target.set(c.x, 0.6, c.z);
  }
  viewInside() {
    const c = this.center;
    const back = Math.max(0.5, this.spanZ * 0.25);
    this.camera.position.set(c.x, 1.4, c.z + back);
    this.controls.target.set(c.x, 1.0, c.z - Math.max(1.5, this.spanZ * 0.6));
  }

  // ---------- テクスチャ ----------
  _texture(photoId) {
    if (!photoId) return null;
    if (this.textureCache.has(photoId)) return this.textureCache.get(photoId);
    const photo = getState().photos.find(p => p.id === photoId);
    if (!photo) return null;
    const tex = new THREE.TextureLoader().load(photo.data);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    this.textureCache.set(photoId, tex);
    return tex;
  }

  // 面のサイズに合わせてタイル数を設定したマテリアルを作る
  _surfaceMaterial(photoId, fallbackColor, sizeU, sizeV, repeatMeters, opts = {}) {
    const base = this._texture(photoId);
    if (base) {
      const tex = base.clone();
      tex.needsUpdate = true;
      tex.repeat.set(Math.max(0.05, sizeU / repeatMeters), Math.max(0.05, sizeV / repeatMeters));
      return new THREE.MeshLambertMaterial({ map: tex, ...opts });
    }
    return new THREE.MeshLambertMaterial({ color: new THREE.Color(fallbackColor), ...opts });
  }

  // ---------- シーン再構築 ----------
  rebuild() {
    const s = getState();
    this.root.clear();

    const b = wallsBounds(0) || this._furnitureBounds() || { minX: 0, minY: 0, maxX: 4, maxY: 4 };
    const cx = (b.minX + b.maxX) / 2, cz = (b.minY + b.maxY) / 2;
    const spanX = Math.max(2, b.maxX - b.minX), spanZ = Math.max(2, b.maxY - b.minY);
    this.center = new THREE.Vector3(cx, 0, cz);
    this.spanX = spanX; this.spanZ = spanZ;
    this.roomSpan = Math.max(spanX, spanZ);
    this.wallGroups = [];

    // 床
    const t = s.settings.wallThickness;
    const floorW = spanX + t, floorD = spanZ + t;
    const floorMat = this._surfaceMaterial(
      s.settings.floorPhoto, s.settings.floorColor,
      floorW, floorD, s.settings.floorRepeat
    );
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(floorW, floorD), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(cx, 0, cz);
    floor.receiveShadow = true;
    this.root.add(floor);

    // 天井
    if (s.settings.showCeiling && s.walls.length) {
      const ceil = new THREE.Mesh(
        new THREE.PlaneGeometry(floorW, floorD),
        new THREE.MeshLambertMaterial({ color: 0xf7f5f0, side: THREE.DoubleSide })
      );
      ceil.rotation.x = Math.PI / 2;
      ceil.position.set(cx, s.settings.wallHeight, cz);
      this.root.add(ceil);
    }

    // 壁
    for (const w of s.walls) {
      const openings = s.openings.filter(o => o.wallId === w.id);
      this._buildWall(w, openings, s.settings);
    }

    // 家具
    for (const f of activeFurniture(s)) {
      const g = buildFurniture(f);
      g.position.set(f.x, f.elev || 0, f.y);
      g.rotation.y = -f.rot * Math.PI / 180;
      this.root.add(g);
      if (s.settings.showLabels) {
        const label = makeLabel(f.label);
        label.position.set(f.x, (f.elev || 0) + f.h + 0.25, f.y);
        this.root.add(label);
      }
    }
  }

  _furnitureBounds() {
    const s = getState();
    if (!activeFurniture(s).length) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const f of activeFurniture(s)) {
      const r = Math.max(f.w, f.d) / 2;
      minX = Math.min(minX, f.x - r); maxX = Math.max(maxX, f.x + r);
      minY = Math.min(minY, f.y - r); maxY = Math.max(maxY, f.y + r);
    }
    return { minX, minY, maxX, maxY };
  }

  // 壁1枚を、ドア・窓の開口を抜いた複数の直方体で組み立てる
  _buildWall(w, openings, settings) {
    const len = wallLength(w);
    if (len < 0.01) return;
    const H = settings.wallHeight, T = settings.wallThickness;
    const group = new THREE.Group();
    group.position.set(w.x1, 0, w.y1);
    group.rotation.y = -Math.atan2(w.y2 - w.y1, w.x2 - w.x1);

    const addBox = (x0, x1, y0, y1) => {
      const bw = x1 - x0, bh = y1 - y0;
      if (bw < 0.005 || bh < 0.005) return;
      const mat = this._surfaceMaterial(
        settings.wallPhoto, settings.wallColor, bw, bh, settings.wallRepeat,
        { transparent: true } // カットアウェイでフェードできるように
      );
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, T), mat);
      mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, 0);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    };

    // 開口を壁に沿った区間 [start, end] に変換してソート
    const spans = openings
      .map(o => ({
        start: Math.max(0, o.offset - o.width / 2),
        end: Math.min(len, o.offset + o.width / 2),
        o,
      }))
      .filter(x => x.end > x.start)
      .sort((a, b) => a.start - b.start);

    let cursor = 0;
    for (const sp of spans) {
      if (sp.start > cursor) addBox(cursor, sp.start, 0, H);
      const top = Math.min(H, sp.o.sill + sp.o.height);
      if (sp.o.sill > 0.01) addBox(sp.start, sp.end, 0, sp.o.sill);            // 窓下
      if (top < H - 0.01) addBox(sp.start, sp.end, top, H);                     // まぐさ（上部）
      // 窓ガラス
      if (sp.o.type === 'window') {
        const glass = new THREE.Mesh(
          new THREE.BoxGeometry(sp.end - sp.start, top - sp.o.sill, 0.02),
          new THREE.MeshLambertMaterial({ color: 0xbfe0f0, transparent: true, opacity: 0.35 })
        );
        glass.position.set((sp.start + sp.end) / 2, (sp.o.sill + top) / 2, 0);
        glass.userData.isGlass = true;
        group.add(glass);
      }
      cursor = Math.max(cursor, sp.end);
    }
    if (cursor < len) addBox(cursor, len, 0, H);

    this.root.add(group);
    this.wallGroups.push({
      group,
      mid: new THREE.Vector3((w.x1 + w.x2) / 2, 0, (w.y1 + w.y2) / 2),
    });
  }
}

// ============================================================
// 家具の 3D モデル（すべて w×d×h の箱に収まる。原点は底面中心）
// ============================================================

function lambert(color) {
  return new THREE.MeshLambertMaterial({ color: new THREE.Color(color) });
}

function box(w, h, d, color, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lambert(color));
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function shade(hex, amt) {
  const c = new THREE.Color(hex);
  c.offsetHSL(0, 0, amt);
  return `#${c.getHexString()}`;
}

export function buildFurniture(f) {
  const g = new THREE.Group();
  const shape = catalogItem(f.type).shape;
  const { w, d, h, color } = f;
  const wood = '#8d6e4e';

  switch (shape) {
    case 'platform_bed': {
      // ヘッドボードなしの低床ベッド(スチールフレーム+マットレス)
      const frameH = h * 0.45;
      g.add(box(w * 0.98, frameH, d * 0.98, '#2c2c30', 0, frameH / 2, 0));
      g.add(box(w, h * 0.55, d, '#e8e6e0', 0, frameH + h * 0.275, 0));
      // 枕(ベッドの奥側 = -z)
      g.add(box(w * 0.5, h * 0.25, d * 0.15, '#ffffff', 0, h + h * 0.1, -d * 0.35));
      break;
    }
    case 'bed': {
      const frameH = h * 0.4;
      g.add(box(w, frameH, d, wood, 0, frameH / 2, 0));
      g.add(box(w * 0.96, h * 0.45, d * 0.96, color, 0, frameH + h * 0.225, 0));
      // 枕（ベッドの奥側 = -z）
      g.add(box(w * 0.5, h * 0.18, d * 0.15, '#ffffff', 0, frameH + h * 0.5, -d * 0.35));
      // ヘッドボード
      g.add(box(w, h * 1.6, 0.04, wood, 0, h * 0.8, -d / 2 + 0.02));
      break;
    }
    case 'desk': {
      const topT = 0.035, legW = 0.05;
      g.add(box(w, topT, d, color, 0, h - topT / 2, 0));
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        g.add(box(legW, h - topT, legW, shade(color, -0.12),
          sx * (w / 2 - legW), (h - topT) / 2, sz * (d / 2 - legW)));
      }
      break;
    }
    case 'table': {
      const topT = 0.04, legW = 0.06;
      g.add(box(w, topT, d, color, 0, h - topT / 2, 0));
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        g.add(box(legW, h - topT, legW, shade(color, -0.12),
          sx * (w / 2 - legW), (h - topT) / 2, sz * (d / 2 - legW)));
      }
      break;
    }
    case 'chair': {
      const seatH = h * 0.5, seatT = 0.05, legW = 0.04;
      g.add(box(w, seatT, d, color, 0, seatH, 0));
      g.add(box(w, h - seatH, seatT, shade(color, -0.08), 0, seatH + (h - seatH) / 2, -d / 2 + seatT / 2));
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        g.add(box(legW, seatH, legW, shade(color, -0.18),
          sx * (w / 2 - legW), seatH / 2, sz * (d / 2 - legW)));
      }
      break;
    }
    case 'sofa': {
      const baseH = h * 0.45, armW = Math.min(0.15, w * 0.12);
      g.add(box(w, baseH, d, color, 0, baseH / 2, 0));
      g.add(box(w, h - baseH, d * 0.3, shade(color, -0.06), 0, baseH + (h - baseH) / 2, -d / 2 + d * 0.15));
      g.add(box(armW, h * 0.75, d, shade(color, -0.1), -w / 2 + armW / 2, h * 0.375, 0));
      g.add(box(armW, h * 0.75, d, shade(color, -0.1), w / 2 - armW / 2, h * 0.375, 0));
      break;
    }
    case 'wardrobe': {
      g.add(box(w, h, d, color, 0, h / 2, 0));
      // 扉の筋
      g.add(box(0.01, h * 0.92, 0.012, shade(color, -0.25), 0, h / 2, d / 2));
      // 取っ手
      g.add(box(0.02, 0.12, 0.02, '#555555', -0.05, h * 0.55, d / 2 + 0.01));
      g.add(box(0.02, 0.12, 0.02, '#555555', 0.05, h * 0.55, d / 2 + 0.01));
      break;
    }
    case 'shelf': {
      const t = 0.02;
      g.add(box(t, h, d, color, -w / 2 + t / 2, h / 2, 0));
      g.add(box(t, h, d, color, w / 2 - t / 2, h / 2, 0));
      g.add(box(w, t, d, color, 0, h - t / 2, 0));
      g.add(box(w - t, h, t, shade(color, -0.2), 0, h / 2, -d / 2 + t / 2)); // 背板
      const shelves = Math.max(2, Math.round(h / 0.35));
      for (let i = 0; i <= shelves; i++) {
        g.add(box(w - 2 * t, t, d - 0.01, color, 0, (h / shelves) * i + t / 2, 0));
      }
      break;
    }
    case 'tvboard': {
      g.add(box(w, h, d, color, 0, h / 2, 0));
      // テレビ
      const tvW = w * 0.75, tvH = tvW * 0.56;
      g.add(box(tvW, tvH, 0.03, '#1c1c20', 0, h + tvH / 2 + 0.05, 0));
      g.add(box(tvW * 0.2, 0.05, d * 0.4, '#333', 0, h + 0.025, 0));
      break;
    }
    case 'open_wardrobe': {
      // スチールユニットシェルフのワードローブ: 左右のラダーフレーム +
      // 天板 + ハンガーバー + 下段棚
      const post = 0.025;
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          g.add(box(post, h, post, color,
            sx * (w / 2 - post / 2), h / 2, sz * (d / 2 - post / 2)));
        }
        // 側面の横桟
        for (const yy of [0.12, h * 0.5, h - 0.06]) {
          g.add(box(post, post, d - post, color, sx * (w / 2 - post / 2), yy, 0));
        }
      }
      // 天板と下段棚(明るい木目)
      g.add(box(w, 0.02, d, '#d8cdb8', 0, h - 0.01, 0));
      g.add(box(w - post * 2, 0.02, d - post, '#d8cdb8', 0, 0.13, 0));
      // ハンガーバー
      g.add(box(w - post * 2, 0.02, 0.02, shade(color, -0.15), 0, h - 0.12, 0));
      break;
    }
    case 'hanger': {
      // ミニマルなアイアンフレームのハンガーラック(KANADEMONO RAC-101風):
      // 1枚の長方形フレームが立ち、足元だけ前後に足が伸びる
      const post = 0.018;
      // 左右の縦フレーム
      g.add(box(post, h, post, color, -(w / 2 - post / 2), h / 2, 0));
      g.add(box(post, h, post, color, w / 2 - post / 2, h / 2, 0));
      // 上のハンガーバーと下の横バー
      g.add(box(w, post, post, color, 0, h - post / 2, 0));
      g.add(box(w - post * 2, post, post, color, 0, 0.25, 0));
      // 前後に伸びる足(左右)
      g.add(box(post, post, d, color, -(w / 2 - post / 2), post / 2, 0));
      g.add(box(post, post, d, color, w / 2 - post / 2, post / 2, 0));
      break;
    }
    case 'plant': {
      const potH = h * 0.25;
      const pot = new THREE.Mesh(
        new THREE.CylinderGeometry(w * 0.3, w * 0.22, potH, 12),
        lambert('#9c6b4a')
      );
      pot.position.y = potH / 2;
      pot.castShadow = true;
      g.add(pot);
      const foliage = new THREE.Mesh(
        new THREE.SphereGeometry(w * 0.5, 10, 8),
        lambert(color)
      );
      foliage.position.y = potH + (h - potH) * 0.55;
      foliage.scale.y = (h - potH) / (w);
      foliage.castShadow = true;
      g.add(foliage);
      break;
    }
    case 'rug': {
      const m = box(w, Math.max(0.012, h), d, color, 0, Math.max(0.006, h / 2), 0);
      m.castShadow = false;
      g.add(m);
      break;
    }
    default: {
      g.add(box(w, h, d, color, 0, h / 2, 0));
    }
  }
  return g;
}

// 家具名のラベル（スプライト）
function makeLabel(text) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  ctx.font = '28px sans-serif';
  const tw = Math.ceil(ctx.measureText(text).width) + 24;
  c.width = tw; c.height = 44;
  const ctx2 = c.getContext('2d');
  ctx2.fillStyle = 'rgba(40,38,34,.72)';
  ctx2.beginPath(); ctx2.roundRect(0, 0, tw, 44, 10); ctx2.fill();
  ctx2.font = '28px sans-serif';
  ctx2.fillStyle = '#fff';
  ctx2.textAlign = 'center'; ctx2.textBaseline = 'middle';
  ctx2.fillText(text, tw / 2, 23);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  const scale = 0.35;
  sp.scale.set(tw / 44 * scale, scale, 1);
  return sp;
}
