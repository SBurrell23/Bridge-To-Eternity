// The player's hand, drawn as real 3D cards in an orthographic overlay that
// sits across the bottom of the screen above the board.

import * as THREE from 'three';
import { makeCardFaceTexture, makeCardBackTexture, makeGlowTexture } from './cardart.js';

const texCache = new Map();

export function cardSignature(card, rotated = false) {
  if (card.type === 'path') {
    return 'p:' + card.art + ':' + card.edges + ':' + (card.passable ? 1 : 0) + (rotated ? ':r' : '');
  }
  if (card.action === 'break') return 'b:' + card.tool;
  if (card.action === 'repair') return 'r:' + card.tools.join('-');
  return 'a:' + card.action;
}

export function cardTexture(card, rotated = false) {
  const sig = cardSignature(card, rotated);
  if (texCache.has(sig)) return texCache.get(sig);
  const t = new THREE.CanvasTexture(makeCardFaceTexture(card, rotated));
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  texCache.set(sig, t);
  return t;
}

let backTexture = null;
export function cardBackTexture() {
  if (!backTexture) {
    backTexture = new THREE.CanvasTexture(makeCardBackTexture());
    backTexture.colorSpace = THREE.SRGBColorSpace;
  }
  return backTexture;
}

export class HandView {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -2000, 2000);
    this.camera.position.z = 600;

    const amb = new THREE.AmbientLight(0xffffff, 1.05);
    this.scene.add(amb);
    const key = new THREE.DirectionalLight(0xfff3d8, 1.0);
    key.position.set(-0.4, 1, 1);
    this.scene.add(key);

    this.root = new THREE.Group();
    this.scene.add(this.root);

    this.cards = [];        // { card, mesh, glow, target:{...}, cur:{...} }
    this.width = 1;
    this.height = 1;
    this.hoverId = null;
    this.selectedId = null;
    this.enabled = true;
    this.dimmed = false;
    // While a card is being aimed the rest of the hand slides down out of the
    // way, so the near end of the bridge stays clickable.
    this.aiming = false;
    // Which way the selected span is facing, so its face can be redrawn.
    this.rotated = false;
    this.time = 0;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2(-10, -10);
  }

  resize(w, h) {
    this.width = w;
    this.height = h;
    this.camera.left = -w / 2;
    this.camera.right = w / 2;
    this.camera.top = h / 2;
    this.camera.bottom = -h / 2;
    this.camera.updateProjectionMatrix();
    this.layout();
  }

  get metrics() {
    const n = Math.max(1, this.cards.length);
    const cw = Math.max(88, Math.min(this.width * 0.115, this.height * 0.2, 174));
    const ch = cw * 1.5;
    const spacing = Math.min(cw * 0.94, (this.width * 0.78) / n);
    return { cw, ch, spacing, n };
  }

  /**
   * Pixel height the hand claims, including room for a card raised by being
   * selected, so the action bar never lands on top of one.
   */
  get stripHeight() {
    return this.metrics.ch + 112;
  }

  setCards(cards) {
    const want = new Map(cards.map((c) => [c.id, c]));

    for (let i = this.cards.length - 1; i >= 0; i--) {
      const entry = this.cards[i];
      if (!want.has(entry.card.id)) {
        entry.leaving = true;
        entry.leaveT = 0;
      }
    }

    for (const c of cards) {
      if (this.cards.some((e) => e.card.id === c.id && !e.leaving)) continue;
      const geo = new THREE.PlaneGeometry(1, 1);
      const mat = new THREE.MeshBasicMaterial({
        map: cardTexture(c), transparent: true, alphaTest: 0.02, depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(makeGlowTexture(128, '255,230,160')),
        blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0,
      }));
      // The glow sits a touch behind so it haloes the card instead of
      // washing over the face of it.
      glow.position.z = -2;
      mesh.position.z = 0;
      const group = new THREE.Group();
      group.add(glow);
      group.add(mesh);
      this.root.add(group);
      this.cards.push({
        card: c,
        group,
        mesh,
        glow,
        cur: { x: 0, y: -this.height, rot: 0, scale: 1 },
        target: { x: 0, y: 0, rot: 0, scale: 1 },
        entering: true,
      });
    }

    // Keep hand order stable with the server's ordering.
    const order = new Map(cards.map((c, i) => [c.id, i]));
    this.cards.sort((a, b) => (order.get(a.card.id) ?? 99) - (order.get(b.card.id) ?? 99));
    this.layout();
  }

  layout() {
    const live = this.cards.filter((e) => !e.leaving);
    const n = live.length;
    const { cw, ch, spacing } = this.metrics;
    const total = spacing * (n - 1);
    const baseY = -this.height / 2 + ch * 0.5 + 14;

    live.forEach((e, i) => {
      const off = i - (n - 1) / 2;
      e.target.x = -total / 2 + i * spacing;
      e.target.y = baseY - Math.abs(off) * Math.min(6, 26 / Math.max(1, n)) ;
      e.target.rot = -off * 0.035;
      e.target.scale = 1;
      e.target.z = i * 0.6;
      e.cw = cw;
      e.ch = ch;
    });
  }

  setEnabled(on) {
    this.enabled = on;
  }

  setSelected(id) {
    if (id !== this.selectedId) this.rotated = false;
    this.selectedId = id;
    this.syncSelectedFace();
  }

  /** Flip the selected card's face so it matches the ghost on the board. */
  setRotation(rotated) {
    this.rotated = !!rotated;
    this.syncSelectedFace();
  }

  syncSelectedFace() {
    for (const e of this.cards) {
      if (e.leaving || e.card.type !== 'path') continue;
      const want = cardTexture(e.card, e.card.id === this.selectedId && this.rotated);
      if (e.mesh.material.map !== want) {
        e.mesh.material.map = want;
        e.mesh.material.needsUpdate = true;
      }
    }
  }

  /** Returns the card id under the pointer, or null. */
  hitTest(clientX, clientY, rect) {
    if (!this.enabled || !this.cards.length) return null;
    const x = ((clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.pointer.set(x, y);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const meshes = this.cards
      .filter((e) => !e.leaving && !(this.aiming && this.selectedId !== e.card.id))
      .map((e) => e.mesh);
    const hits = this.raycaster.intersectObjects(meshes, false);
    if (!hits.length) return null;
    // Cards overlap: the one drawn last (highest z) wins.
    let best = null;
    for (const h of hits) {
      const entry = this.cards.find((e) => e.mesh === h.object);
      if (!entry) continue;
      if (!best || entry.group.position.z > best.group.position.z) best = entry;
    }
    return best ? best.card.id : null;
  }

  setHover(id) {
    this.hoverId = id;
  }

  update(dt) {
    this.time += dt;
    const lerp = 1 - Math.pow(1e-8, dt);

    for (let i = this.cards.length - 1; i >= 0; i--) {
      const e = this.cards[i];
      if (e.leaving) {
        e.leaveT += dt * 2.2;
        e.cur.y += dt * 260;
        e.cur.scale = Math.max(0.01, e.cur.scale - dt * 1.5);
        e.mesh.material.opacity = Math.max(0, 1 - e.leaveT);
        e.mesh.material.transparent = true;
        if (e.leaveT >= 1) {
          this.root.remove(e.group);
          e.mesh.geometry.dispose();
          e.mesh.material.dispose();
          e.glow.material.dispose();
          this.cards.splice(i, 1);
          this.layout();
          continue;
        }
      } else {
        const hovered = this.hoverId === e.card.id;
        const selected = this.selectedId === e.card.id;
        const stowed = this.aiming && !selected;
        const lift = selected ? 52 : stowed ? -(e.ch || 180) * 0.62 : hovered ? 42 : 0;
        // Hovering blows the card up properly so its rules text can be read.
        const scale = selected ? 1.24 : hovered && !stowed ? 1.42 : 1;
        const tx = e.target.x;
        const ty = e.target.y + lift + (selected ? Math.sin(this.time * 3) * 3 : 0);
        const rot = selected || hovered ? e.target.rot * 0.25 : e.target.rot;

        e.cur.x += (tx - e.cur.x) * lerp;
        e.cur.y += (ty - e.cur.y) * lerp;
        e.cur.rot += (rot - e.cur.rot) * lerp;
        e.cur.scale += (scale - e.cur.scale) * lerp;
        e.group.position.z = (e.target.z || 0) + (selected ? 40 : hovered ? 20 : 0);

        const glowTarget = selected ? 0.42 : hovered && !stowed ? 0.22 : 0;
        e.glow.material.opacity += (glowTarget - e.glow.material.opacity) * lerp;
        const opacity = stowed ? 0.7 : (this.dimmed && !selected ? 0.55 : 1);
        e.mesh.material.opacity += (opacity - e.mesh.material.opacity) * lerp;
        e.mesh.material.transparent = true;
      }

      e.group.position.x = e.cur.x;
      e.group.position.y = e.cur.y;
      e.group.rotation.z = e.cur.rot;
      const w = (e.cw || 120) * e.cur.scale;
      const h = (e.ch || 180) * e.cur.scale;
      e.mesh.scale.set(w, h, 1);
      e.glow.scale.set(w * 1.9, h * 1.7, 1);
      // A gentle 3D tilt so the cards read as objects, not stickers.
      e.mesh.rotation.x = -0.12 + Math.sin(this.time * 0.8 + e.cur.x * 0.01) * 0.02;
    }
  }

  clear() {
    for (const e of this.cards) {
      this.root.remove(e.group);
      e.mesh.geometry.dispose();
      e.mesh.material.dispose();
      e.glow.material.dispose();
    }
    this.cards = [];
    this.hoverId = null;
    this.selectedId = null;
  }
}
