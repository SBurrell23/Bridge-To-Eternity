// The bridge itself: slabs of cloudstone floating in mid-air, the three Gates,
// and every highlight the player needs in order to aim a card.

import * as THREE from 'three';
import { BOARD, GOAL_CELLS, key } from '../game/board.js';
import { makeSpanTexture, makeCornerstoneTexture, makeGateTexture, makeGlowTexture } from './cardart.js';

export const TILE = 2.3;
export const SLAB_H = 0.34;
export const BOARD_Y = 0;

export const cellToWorld = (x, y) => new THREE.Vector3(x * TILE, BOARD_Y, y * TILE);
export const BOARD_CENTER = new THREE.Vector3(
  ((BOARD.minX + BOARD.maxX) / 2) * TILE, 0, ((BOARD.minY + BOARD.maxY) / 2) * TILE,
);

const texCache = new Map();
function tileTexture(tile) {
  const k = tile.kind === 'goal'
    ? 'gate:' + (tile.revealed ? (tile.isGold ? 'gold' : 'stone') : 'hidden')
    : tile.kind === 'start'
      ? 'start'
      : 'span:' + ['n', 'e', 's', 'w'].map((d) => (tile.edges[d] ? 1 : 0)).join('') + ':' + (tile.passable ? 1 : 0);
  if (texCache.has(k)) return texCache.get(k);
  let canvas;
  if (tile.kind === 'goal') {
    canvas = makeGateTexture(tile.revealed ? (tile.isGold ? 'gold' : 'stone') : 'hidden');
  } else if (tile.kind === 'start') {
    canvas = makeCornerstoneTexture();
  } else {
    canvas = makeSpanTexture(tile.edges, tile.passable);
  }
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  texCache.set(k, t);
  return t;
}

const PORTAL_VERT = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Value noise stacked into a slow upward drift, then sheared by a travelling
// sine so the surface curls instead of merely scrolling.
const PORTAL_FRAG = `
  uniform float uTime;
  uniform vec3 uDeep;
  uniform vec3 uBright;
  uniform float uAlpha;
  varying vec2 vUv;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }

  void main() {
    vec2 uv = vUv;
    float t = uTime;
    float n = noise(uv * 3.0 + vec2(0.0, -t * 0.28)) * 0.55
            + noise(uv * 6.5 + vec2(t * 0.18, -t * 0.52)) * 0.3
            + noise(uv * 13.0 - vec2(t * 0.12, t * 0.8)) * 0.15;
    float curl = sin((uv.y * 7.0 - t * 1.1) + n * 5.5) * 0.5 + 0.5;
    float body = clamp(n * 0.85 + curl * 0.45, 0.0, 1.0);
    float core = smoothstep(0.35, 0.95, body);
    vec3 col = mix(uDeep, uBright, core);
    col += pow(core, 3.0) * 0.35;

    // Melt into the stonework rather than ending on a hard rim.
    float edge = smoothstep(0.0, 0.16, uv.x) * smoothstep(1.0, 0.84, uv.x)
               * smoothstep(0.0, 0.1, uv.y) * smoothstep(1.0, 0.9, uv.y);
    gl_FragColor = vec4(col, uAlpha * edge * (0.45 + 0.55 * body));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** ShapeGeometry hands back position-space uvs; renormalise them to 0..1. */
function normaliseUv(geo) {
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const w = bb.max.x - bb.min.x || 1;
  const h = bb.max.y - bb.min.y || 1;
  const pos = geo.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = (pos.getX(i) - bb.min.x) / w;
    uv[i * 2 + 1] = (pos.getY(i) - bb.min.y) / h;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

function edgeMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0xf2d489, roughness: 0.34, metalness: 0.8,
    emissive: 0x6b4c10, emissiveIntensity: 0.55,
  });
}

function underMaterial() {
  return new THREE.MeshStandardMaterial({ color: 0x51617a, roughness: 0.95, metalness: 0.05 });
}

function glowSprite(color, size, opacity) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(makeGlowTexture(128, color)),
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false,
  }));
  s.scale.setScalar(size);
  s.material.opacity = opacity;
  return s;
}

export class BoardView {
  constructor(scene, quality) {
    this.scene = scene;
    this.quality = quality;
    this.root = new THREE.Group();
    scene.add(this.root);

    this.tiles = new Map();       // "x,y" -> { group, sig, anim }
    this.falling = [];            // smitten slabs on their way down
    this.markers = new THREE.Group();
    this.root.add(this.markers);
    this.ghost = null;
    this.portals = [];
    this.time = 0;
    this.playerColors = {};

    // Invisible sheet used to turn a mouse ray into a grid cell.
    this.pickPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    this.pickPlane.rotation.x = -Math.PI / 2;
    this.pickPlane.position.y = BOARD_Y + SLAB_H / 2;
    this.root.add(this.pickPlane);

    this.buildPlatformGlow();
  }

  buildPlatformGlow() {
    // Light welling up from beneath the whole structure.
    const s = glowSprite('255,226,158', 26, 0.13);
    s.position.copy(BOARD_CENTER);
    s.position.y = -5.2;
    this.root.add(s);
    this.platformGlow = s;
  }

  tileSignature(tile) {
    return [
      tile.kind, tile.art,
      ['n', 'e', 's', 'w'].map((d) => (tile.edges[d] ? 1 : 0)).join(''),
      tile.passable ? 1 : 0,
      tile.revealed ? 1 : 0,
      tile.isGold ? 1 : 0,
      tile.placedBy || '',
    ].join('|');
  }

  makeTileMesh(tile, cellX, cellY) {
    const group = new THREE.Group();
    const top = new THREE.MeshStandardMaterial({
      map: tileTexture(tile),
      roughness: 0.62,
      metalness: 0.16,
      emissive: 0xffffff,
      emissiveMap: tileTexture(tile),
      emissiveIntensity: 0.1,
    });
    const edge = edgeMaterial();
    const under = underMaterial();
    // BoxGeometry material order: +x, -x, +y, -y, +z, -z
    const mats = [edge, edge, top, under, edge, edge];
    const slab = new THREE.Mesh(new THREE.BoxGeometry(TILE * 0.97, SLAB_H, TILE * 0.97), mats);
    slab.castShadow = this.quality.shadows;
    slab.receiveShadow = this.quality.shadows;
    group.add(slab);
    group.userData.slab = slab;
    group.userData.top = top;

    if (tile.kind === 'goal') {
      group.add(this.makeGateArch(tile));
    }

    if (tile.kind === 'start') {
      const g = glowSprite('255,236,180', 6.5, 0.3);
      g.position.y = 1.4;
      group.add(g);
    }

    // A small gem in the owner's colour so you can read who built what.
    if (tile.placedBy && this.playerColors[tile.placedBy]) {
      const gem = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.13, 0),
        new THREE.MeshStandardMaterial({
          color: this.playerColors[tile.placedBy],
          emissive: this.playerColors[tile.placedBy],
          emissiveIntensity: 0.8,
          roughness: 0.3,
          metalness: 0.4,
        }),
      );
      gem.position.set(TILE * 0.36, SLAB_H / 2 + 0.13, TILE * 0.36);
      group.userData.gem = gem;
      group.add(gem);
    }

    group.position.copy(cellToWorld(cellX, cellY));
    return group;
  }

  makeGateArch(tile) {
    const g = new THREE.Group();
    // High metalness with no environment map renders almost black, which is
    // what made the gates read as bronze. Less metal plus a warm emissive puts
    // the gold back.
    const stone = tile.revealed && !tile.isGold;
    const gold = new THREE.MeshStandardMaterial({
      color: stone ? 0x97a2b2 : 0xffdf95,
      roughness: stone ? 0.62 : 0.26,
      metalness: stone ? 0.1 : 0.5,
      emissive: stone ? 0x14181e : 0x7c5c16,
      emissiveIntensity: stone ? 0.15 : (tile.isGold ? 0.75 : 0.5),
    });
    const pillarGeo = new THREE.CylinderGeometry(0.17, 0.22, 2.1, 12);
    [-0.78, 0.78].forEach((z) => {
      const p = new THREE.Mesh(pillarGeo, gold);
      p.position.set(0, 1.05, z);
      p.castShadow = this.quality.shadows;
      g.add(p);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.5), gold);
      cap.position.set(0, 2.16, z);
      g.add(cap);
    });
    const arch = new THREE.Mesh(new THREE.TorusGeometry(0.78, 0.16, 10, 24, Math.PI), gold);
    arch.position.set(0, 2.16, 0);
    arch.rotation.y = Math.PI / 2;
    g.add(arch);

    // The portal fills the opening exactly: straight sides up to the springing
    // line, then the same semicircle as the arch above it. A plain rectangle
    // poked out past the arch at both top corners.
    const half = 0.66;
    const spring = 2.16;
    const shape = new THREE.Shape();
    shape.moveTo(-half, 0);
    shape.lineTo(-half, spring);
    shape.absarc(0, spring, half, Math.PI, 0, true);
    shape.lineTo(half, 0);
    shape.closePath();

    const scheme = tile.revealed
      ? (tile.isGold
        ? { deep: 0xb8791a, bright: 0xfff6cf, alpha: 0.95 }
        : { deep: 0x2c3542, bright: 0x93a3b8, alpha: 0.72 })
      : { deep: 0x241a44, bright: 0x9d7cf0, alpha: 0.85 };

    const portalMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: Math.random() * 40 },
        uDeep: { value: new THREE.Color(scheme.deep) },
        uBright: { value: new THREE.Color(scheme.bright) },
        uAlpha: { value: scheme.alpha },
      },
      vertexShader: PORTAL_VERT,
      fragmentShader: PORTAL_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });
    const portal = new THREE.Mesh(normaliseUv(new THREE.ShapeGeometry(shape, 36)), portalMat);
    portal.position.set(0, SLAB_H / 2, 0);
    portal.rotation.y = Math.PI / 2;
    g.add(portal);
    g.userData.portal = portal;
    this.portals.push(portalMat);

    if (tile.revealed && tile.isGold) {
      const glow = glowSprite('255,238,180', 10, 0.7);
      glow.position.set(0, 1.5, 0);
      g.add(glow);
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.9, 1.6, 60, 16, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0xfff0c0, transparent: true, opacity: 0.14,
          blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false, fog: false,
        }),
      );
      beam.position.set(0, 30, 0);
      g.add(beam);
    } else if (!tile.revealed) {
      const glow = glowSprite('150,130,220', 5.5, 0.38);
      glow.position.set(0, 1.35, 0);
      g.add(glow);
    }
    return g;
  }

  setPlayerColors(map) {
    this.playerColors = map;
  }

  /** Reconcile the 3D board with the authoritative tile map. */
  sync(tiles, connected) {
    const seen = new Set();
    const reach = new Set(connected || []);

    for (const [k, tile] of Object.entries(tiles)) {
      seen.add(k);
      const [cx, cy] = k.split(',').map(Number);
      const sig = this.tileSignature(tile);
      const existing = this.tiles.get(k);
      if (existing && existing.sig === sig) {
        existing.connected = tile.kind === 'goal' && !tile.revealed ? false : reach.has(k);
        continue;
      }
      if (existing) {
        this.root.remove(existing.group);
        this.disposeGroup(existing.group);
      }
      const group = this.makeTileMesh(tile, cx, cy);
      const anim = existing ? { t: 1 } : { t: 0 };
      this.root.add(group);
      this.tiles.set(k, {
        group, sig, anim, connected: reach.has(k), kind: tile.kind, cell: { x: cx, y: cy },
      });
    }

    for (const [k, rec] of Array.from(this.tiles.entries())) {
      if (seen.has(k)) continue;
      this.tiles.delete(k);
      this.startFall(rec.group);
    }
  }

  startFall(group) {
    this.falling.push({
      group,
      t: 0,
      vy: 1.2,
      spin: new THREE.Vector3(
        (Math.random() - 0.5) * 2.4, (Math.random() - 0.5) * 2.4, (Math.random() - 0.5) * 2.4,
      ),
    });
  }

  disposeGroup(group) {
    group.traverse((o) => {
      if (o.material && o.material.isShaderMaterial) {
        this.portals = this.portals.filter((m) => m !== o.material);
      }
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        // Shared tile textures live in the cache; only drop the material shells.
        for (const m of mats) m.dispose();
      }
    });
  }

  // -- markers -------------------------------------------------------------
  clearMarkers() {
    while (this.markers.children.length) {
      const c = this.markers.children.pop();
      this.disposeGroup(c);
    }
  }

  /**
   * kind: 'place' (gold), 'smite' (ember), 'gate' (violet)
   * cells: [{x,y}]
   */
  setMarkers(cells, kind) {
    this.clearMarkers();
    if (!cells || !cells.length) return;
    const color = kind === 'smite' ? 0xff6a3d : kind === 'gate' ? 0xb08cff : 0xffd76a;
    const rgb = kind === 'smite' ? '255,106,61' : kind === 'gate' ? '176,140,255' : '255,215,106';

    for (const c of cells) {
      const g = new THREE.Group();
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(TILE * 0.33, TILE * 0.45, 28),
        new THREE.MeshBasicMaterial({
          color, transparent: true, opacity: 0.85, side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = SLAB_H / 2 + 0.06;
      g.add(ring);

      const column = new THREE.Mesh(
        new THREE.CylinderGeometry(TILE * 0.28, TILE * 0.36, 1.5, 16, 1, true),
        new THREE.MeshBasicMaterial({
          color, transparent: true, opacity: 0.05, side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
        }),
      );
      column.position.y = 0.85;
      g.add(column);

      const spark = glowSprite(rgb, 1.9, 0.16);
      spark.position.y = 0.3;
      g.add(spark);

      g.position.copy(cellToWorld(c.x, c.y));
      g.userData.cell = c;
      this.markers.add(g);
    }
  }

  // -- ghost preview -------------------------------------------------------
  setGhost(card, rotated, cell, valid) {
    if (!card || !cell) {
      if (this.ghost) {
        this.root.remove(this.ghost);
        this.disposeGroup(this.ghost);
        this.ghost = null;
      }
      return;
    }
    const edges = {
      n: card.edges.includes(rotated ? 'S' : 'N'),
      e: card.edges.includes(rotated ? 'W' : 'E'),
      s: card.edges.includes(rotated ? 'N' : 'S'),
      w: card.edges.includes(rotated ? 'E' : 'W'),
    };
    const sig = 'ghost|' + Object.values(edges).map(Number).join('') + '|' + card.passable + '|' + valid;
    if (this.ghost && this.ghost.userData.sig === sig) {
      this.ghost.position.copy(cellToWorld(cell.x, cell.y));
      this.ghost.position.y = BOARD_Y + 1.5;
      return;
    }
    if (this.ghost) {
      this.root.remove(this.ghost);
      this.disposeGroup(this.ghost);
    }
    const tex = new THREE.CanvasTexture(makeSpanTexture(edges, card.passable, 256));
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: 0.72,
      color: valid ? 0xffffff : 0xff8a7a,
      depthWrite: false,
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(TILE * 0.97, TILE * 0.97), mat);
    m.rotation.x = -Math.PI / 2;
    const g = new THREE.Group();
    g.add(m);
    const halo = glowSprite(valid ? '255,225,150' : '255,110,90', 4.5, 0.4);
    halo.position.y = 0.4;
    g.add(halo);
    g.userData.sig = sig;
    g.position.copy(cellToWorld(cell.x, cell.y));
    g.position.y = BOARD_Y + 1.5;
    this.ghost = g;
    this.root.add(g);
  }

  // -- picking -------------------------------------------------------------
  pickCell(raycaster) {
    const hit = raycaster.intersectObject(this.pickPlane, false)[0];
    if (!hit) return null;
    const x = Math.round(hit.point.x / TILE);
    const y = Math.round(hit.point.z / TILE);
    if (x < BOARD.minX || x > BOARD.maxX || y < BOARD.minY || y > BOARD.maxY) return null;
    return { x, y };
  }

  gateCellFor(index) {
    return GOAL_CELLS[index];
  }

  focusPointFor(tiles) {
    // Keep the camera's natural home near the leading edge of the bridge.
    let maxX = 1;
    for (const k of Object.keys(tiles || {})) {
      const x = Number(k.split(',')[0]);
      if (x < 8) maxX = Math.max(maxX, x);
    }
    return new THREE.Vector3(Math.min(maxX + 1.5, 6) * TILE, 0, 0);
  }

  update(dt) {
    this.time += dt;
    const t = this.time;

    for (const [, rec] of this.tiles) {
      const g = rec.group;
      if (rec.anim.t < 1) {
        rec.anim.t = Math.min(1, rec.anim.t + dt * 2.6);
        const e = 1 - Math.pow(1 - rec.anim.t, 3);
        g.position.y = BOARD_Y + (1 - e) * 9;
        const s = 0.82 + 0.18 * e + Math.sin(e * Math.PI) * 0.06;
        g.scale.setScalar(s);
        if (rec.anim.t >= 1) {
          g.position.y = BOARD_Y;
          g.scale.setScalar(1);
        }
      } else {
        // Reached spans breathe with light; orphaned ones sit dull.
        const top = g.userData.top;
        if (top) {
          const target = rec.connected ? 0.16 + 0.06 * Math.sin(t * 1.6 + g.position.x) : 0.02;
          top.emissiveIntensity += (target - top.emissiveIntensity) * Math.min(1, dt * 4);
        }
        g.position.y = BOARD_Y + (rec.connected ? Math.sin(t * 0.9 + g.position.x * 0.4) * 0.035 : 0);
      }
      if (g.userData.gem) g.userData.gem.rotation.y += dt * 1.6;
    }

    for (const m of this.portals) m.uniforms.uTime.value += dt;

    for (let i = this.falling.length - 1; i >= 0; i--) {
      const f = this.falling[i];
      f.t += dt;
      f.vy -= dt * 22;
      f.group.position.y += f.vy * dt;
      f.group.rotation.x += f.spin.x * dt;
      f.group.rotation.y += f.spin.y * dt;
      f.group.rotation.z += f.spin.z * dt;
      f.group.scale.multiplyScalar(1 - dt * 0.35);
      if (f.t > 2.2 || f.group.position.y < -40) {
        this.root.remove(f.group);
        this.disposeGroup(f.group);
        this.falling.splice(i, 1);
      }
    }

    const pulse = 0.6 + 0.4 * Math.sin(t * 3.2);
    for (const m of this.markers.children) {
      m.children[0].material.opacity = 0.55 + 0.4 * pulse;
      m.children[1].material.opacity = 0.025 + 0.04 * pulse;
      m.rotation.y = t * 0.5;
    }

    if (this.ghost) {
      this.ghost.position.y = BOARD_Y + 1.5 + Math.sin(t * 3) * 0.11;
      this.ghost.rotation.y = Math.sin(t * 1.1) * 0.04;
    }
  }

  clear() {
    for (const [, rec] of this.tiles) {
      this.root.remove(rec.group);
      this.disposeGroup(rec.group);
    }
    this.tiles.clear();
    for (const f of this.falling) {
      this.root.remove(f.group);
      this.disposeGroup(f.group);
    }
    this.falling = [];
    this.clearMarkers();
    this.setGhost(null);
  }
}

export { key };
