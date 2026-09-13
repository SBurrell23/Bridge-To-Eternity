// The world the bridge is built in: an endless cloudbank under a gilded sky.
// The floor is finite, but fog and a matching sky colour hide every edge.

import * as THREE from 'three';
import {
  makeCloudFloorTexture, makePuffTexture, makeGlowTexture,
  makeRayTexture, makeSkyTexture,
} from './cardart.js';

export const HORIZON_COLOR = 0xc2dcf4;

function canvasTexture(canvas, repeat) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
  }
  t.anisotropy = 8;
  return t;
}

export class World {
  constructor(quality) {
    this.quality = quality;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(HORIZON_COLOR);
    this.scene.fog = new THREE.Fog(HORIZON_COLOR, 90, 300);

    this.time = 0;
    this.puffs = [];
    this.rays = null;
    this.motes = null;

    this.buildSky();
    this.buildLights();
    this.buildFloor();
    this.buildPuffs();
    this.buildRays();
    this.buildMotes();
    this.buildDistantGates();
  }

  buildSky() {
    const geo = new THREE.SphereGeometry(600, 32, 24);
    const tex = canvasTexture(makeSkyTexture());
    // toneMapped:false is what makes the horizon seamless. three.js applies fog
    // AFTER tone mapping, so a fogged surface ends up as the raw fog colour
    // while a tone-mapped sky does not -- and the two met in a visible line.
    // Opting the sky out of tone mapping puts both on the same footing.
    const mat = new THREE.MeshBasicMaterial({
      map: tex, side: THREE.BackSide, fog: false, depthWrite: false, toneMapped: false,
    });
    this.sky = new THREE.Mesh(geo, mat);
    this.sky.rotation.y = Math.PI;
    this.scene.add(this.sky);
  }

  buildLights() {
    this.hemi = new THREE.HemisphereLight(0xf4fbff, 0x7d9cc2, 0.8);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xfff0cf, 1.35);
    this.sun.position.set(46, 62, -34);
    this.sun.target.position.set(9, 0, 0);
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.fill = new THREE.DirectionalLight(0xbcd8f6, 0.3);
    this.fill.position.set(-40, 24, 40);
    this.scene.add(this.fill);

    // The sun's disc, hanging beyond the Gates.
    const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: canvasTexture(makeGlowTexture(256, '255,244,214')),
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      fog: false,
    }));
    sunSprite.position.set(120, 128, -96);
    sunSprite.scale.setScalar(150);
    sunSprite.material.opacity = 0.55;
    this.scene.add(sunSprite);
    this.sunSprite = sunSprite;
  }

  setShadows(enabled) {
    this.sun.castShadow = enabled;
    if (enabled) {
      this.sun.shadow.mapSize.set(2048, 2048);
      const c = this.sun.shadow.camera;
      c.near = 20;
      c.far = 220;
      c.left = -40; c.right = 40; c.top = 40; c.bottom = -40;
      this.sun.shadow.bias = -0.0009;
      this.sun.shadow.normalBias = 0.03;
      c.updateProjectionMatrix();
    }
  }

  buildFloor() {
    const tex = canvasTexture(makeCloudFloorTexture(1024), 26);
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 1,
      metalness: 0,
      color: 0xdcebf9,
    });
    const geo = new THREE.PlaneGeometry(2000, 2000, 1, 1);
    this.floor = new THREE.Mesh(geo, mat);
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.y = -13;
    this.floor.receiveShadow = true;
    this.scene.add(this.floor);

    // A second, slower sheet just beneath for parallax depth.
    const tex2 = canvasTexture(makeCloudFloorTexture(1024), 11);
    const mat2 = new THREE.MeshBasicMaterial({
      map: tex2, transparent: true, opacity: 0.42, color: 0x9fb9d8,
    });
    this.floor2 = new THREE.Mesh(new THREE.PlaneGeometry(2600, 2600), mat2);
    this.floor2.rotation.x = -Math.PI / 2;
    this.floor2.position.y = -34;
    this.scene.add(this.floor2);

    this.floorTex = tex;
    this.floorTex2 = tex2;
  }

  buildPuffs() {
    for (const p of this.puffs) this.scene.remove(p);
    this.puffs = [];
    const count = this.quality.cloudCount;
    if (!count) return;
    const map = canvasTexture(makePuffTexture(256));
    const mat = new THREE.SpriteMaterial({
      map, transparent: true, opacity: 0.9, depthWrite: false,
    });
    for (let i = 0; i < count; i++) {
      const s = new THREE.Sprite(mat.clone());
      const ring = 40 + Math.random() * 230;
      const a = Math.random() * Math.PI * 2;
      s.position.set(9 + Math.cos(a) * ring, -20 + Math.random() * 34, Math.sin(a) * ring);
      const sc = 18 + Math.random() * 52;
      s.scale.set(sc, sc * 0.62, 1);
      s.userData.baseOpacity = 0.28 + Math.random() * 0.5;
      s.material.opacity = s.userData.baseOpacity;
      s.userData.drift = 0.4 + Math.random() * 1.1;
      s.userData.bob = Math.random() * Math.PI * 2;
      this.puffs.push(s);
      this.scene.add(s);
    }
  }

  buildRays() {
    if (this.rays) {
      this.scene.remove(this.rays);
      this.rays = null;
    }
    if (!this.quality.godRays) return;
    const group = new THREE.Group();
    const map = canvasTexture(makeRayTexture(256));
    for (let i = 0; i < 7; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        opacity: 0.16 + Math.random() * 0.2,
        fog: false,
      });
      const w = 12 + Math.random() * 26;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, 150), mat);
      m.position.set(9 + (Math.random() - 0.5) * 150, 46, (Math.random() - 0.5) * 150);
      m.rotation.set(0, Math.random() * Math.PI, (Math.random() - 0.5) * 0.28);
      m.userData.spin = (Math.random() - 0.5) * 0.02;
      group.add(m);
    }
    this.rays = group;
    this.scene.add(group);
  }

  buildMotes() {
    if (this.motes) {
      this.scene.remove(this.motes);
      this.motes = null;
    }
    if (!this.quality.motes) return;
    const n = 420;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3);
    const phase = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = 9 + (Math.random() - 0.5) * 90;
      pos[i * 3 + 1] = -6 + Math.random() * 34;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 90;
      phase[i] = Math.random() * Math.PI * 2;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      map: canvasTexture(makeGlowTexture(64, '255,240,200')),
      size: 0.5,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
      fog: false,
    });
    this.motes = new THREE.Points(geo, mat);
    this.motes.userData.phase = phase;
    this.motes.userData.base = pos.slice();
    this.scene.add(this.motes);
  }

  buildDistantGates() {
    // Just light on the eastern horizon. Actual geometry out here read as flat
    // translucent boxes with hard edges as soon as the camera orbited towards
    // it, which is precisely the kind of seam the fog is meant to hide.
    const group = new THREE.Group();
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: canvasTexture(makeGlowTexture(256, '255,236,180')),
      blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false,
    }));
    glow.position.set(215, 26, -20);
    glow.scale.setScalar(200);
    glow.material.opacity = 0.5;
    group.add(glow);
    this.distantGates = group;
    this.scene.add(group);
  }

  applyQuality(quality) {
    this.quality = quality;
    this.buildPuffs();
    this.buildRays();
    this.buildMotes();
    this.setShadows(quality.shadows);
    this.scene.fog.far = quality.fogFar || 260;
  }

  update(dt, camera) {
    this.time += dt;
    const t = this.time;

    // The sky sphere follows the camera. That keeps the viewer at its centre,
    // so the horizon always lands on the band of the gradient that is painted
    // in the exact fog colour -- the far edge of the cloud floor dissolves into
    // it and there is no line to see, however far the camera roams.
    if (camera) this.sky.position.copy(camera.position);

    // The cloud sheets slide forever; the board never reaches an edge.
    this.floorTex.offset.x = (t * 0.0035) % 1;
    this.floorTex.offset.y = (t * 0.0018) % 1;
    this.floorTex2.offset.x = (t * 0.0012) % 1;
    this.floorTex2.offset.y = (-t * 0.0008) % 1;

    for (const p of this.puffs) {
      p.position.x += p.userData.drift * dt * 0.55;
      p.position.y += Math.sin(t * 0.22 + p.userData.bob) * dt * 0.28;
      if (p.position.x > 270) p.position.x = -250;
      // A puff the camera has drifted into fills the screen with one flat quad.
      // Fade it out before it gets close enough for its edges to read.
      if (camera) {
        const d = p.position.distanceTo(camera.position);
        const near = Math.min(1, Math.max(0, (d - 22) / 46));
        p.material.opacity = p.userData.baseOpacity * near * near;
      }
    }

    if (this.rays) {
      for (const m of this.rays.children) {
        m.rotation.y += m.userData.spin * dt;
        m.material.opacity = 0.13 + 0.1 * (0.5 + 0.5 * Math.sin(t * 0.35 + m.position.x));
      }
    }

    if (this.motes) {
      const pos = this.motes.geometry.attributes.position;
      const base = this.motes.userData.base;
      const ph = this.motes.userData.phase;
      for (let i = 0; i < ph.length; i++) {
        pos.array[i * 3 + 1] = base[i * 3 + 1] + Math.sin(t * 0.4 + ph[i]) * 1.6;
        pos.array[i * 3] = base[i * 3] + Math.cos(t * 0.22 + ph[i]) * 1.2;
      }
      pos.needsUpdate = true;
    }
  }
}
