// Every texture in the game is drawn here, at runtime, onto a 2D canvas.
// No image files are shipped: spans, gates, halos, wings and hammers are all code.

import {
  cardTitle, cardDescription, TOOL_INFO, edgeSetToObj, rotateEdges,
} from '../game/cards.js';

export const PALETTE = {
  gold:      '#f3d489',
  goldDeep:  '#c9992f',
  goldDark:  '#7d5b14',
  ivory:     '#fff6e4',
  parchment: '#f7ecd6',
  stone:     '#cfd9e6',
  stoneDeep: '#7d8da0',
  sky:       '#9fd0f5',
  skyDeep:   '#3f6f9e',
  ember:     '#ff6a3d',
  blood:     '#c0303a',
  abyss:     '#1a0a12',
  violet:    '#a98ce8',
};

export function createCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function goldGradient(ctx, x0, y0, x1, y1) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, '#fff3c9');
  g.addColorStop(0.28, PALETTE.gold);
  g.addColorStop(0.55, PALETTE.goldDeep);
  g.addColorStop(0.78, '#f0cd7d');
  g.addColorStop(1, PALETTE.goldDark);
  return g;
}

function grain(ctx, w, h, amount, alpha) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * amount;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
    if (alpha) d[i + 3] = Math.min(255, d[i + 3]);
  }
  ctx.putImageData(img, 0, 0);
}

function veins(ctx, w, h, count, color, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  for (let i = 0; i < count; i++) {
    ctx.lineWidth = 0.6 + Math.random() * 2.2;
    ctx.beginPath();
    let x = Math.random() * w;
    let y = Math.random() * h;
    ctx.moveTo(x, y);
    for (let s = 0; s < 5; s++) {
      x += (Math.random() - 0.5) * w * 0.35;
      y += (Math.random() - 0.5) * h * 0.35;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Board tiles: top-down spans of the sky bridge.
// ---------------------------------------------------------------------------
const DIR_VEC = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };

function spanRect(S, dir, from, to, width) {
  const c = S / 2;
  const [dx, dy] = DIR_VEC[dir];
  const x0 = c + dx * from - (dx ? 0 : width / 2);
  const y0 = c + dy * from - (dy ? 0 : width / 2);
  const len = to - from;
  if (dx) return { x: Math.min(x0, x0 + dx * len), y: y0, w: Math.abs(len), h: width };
  return { x: x0, y: Math.min(y0, y0 + dy * len), w: width, h: Math.abs(len) };
}

function drawDeck(ctx, S, dir, from, to, width) {
  const r = spanRect(S, dir, from, to, width);
  // Stone walkway.
  const g = ctx.createLinearGradient(r.x, r.y, r.x + (r.w > r.h ? 0 : r.w), r.y + (r.w > r.h ? r.h : 0));
  g.addColorStop(0, '#efe3c9');
  g.addColorStop(0.5, '#fff8e6');
  g.addColorStop(1, '#d7c49c');
  ctx.fillStyle = g;
  ctx.fillRect(r.x, r.y, r.w, r.h);

  // Gold kerbs along both flanks.
  ctx.fillStyle = goldGradient(ctx, r.x, r.y, r.x + r.w, r.y + r.h);
  const k = S * 0.038;
  if (r.w > r.h) {
    ctx.fillRect(r.x, r.y, r.w, k);
    ctx.fillRect(r.x, r.y + r.h - k, r.w, k);
  } else {
    ctx.fillRect(r.x, r.y, k, r.h);
    ctx.fillRect(r.x + r.w - k, r.y, k, r.h);
  }

  // Luminous inlay down the middle.
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = '#ffe9a8';
  if (r.w > r.h) ctx.fillRect(r.x, r.y + r.h / 2 - S * 0.008, r.w, S * 0.016);
  else ctx.fillRect(r.x + r.w / 2 - S * 0.008, r.y, S * 0.016, r.h);
  ctx.restore();

  // Plank seams.
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.strokeStyle = '#5d6b80';
  ctx.lineWidth = Math.max(1, S * 0.004);
  const step = S * 0.055;
  ctx.beginPath();
  if (r.w > r.h) {
    for (let x = r.x + step; x < r.x + r.w; x += step) { ctx.moveTo(x, r.y); ctx.lineTo(x, r.y + r.h); }
  } else {
    for (let y = r.y + step; y < r.y + r.h; y += step) { ctx.moveTo(r.x, y); ctx.lineTo(r.x + r.w, y); }
  }
  ctx.stroke();
  ctx.restore();
}

function drawRift(ctx, S, dir, at, width) {
  // A severed span: the deck stops and there is nothing but a red-lit chasm.
  const c = S / 2;
  const [dx, dy] = DIR_VEC[dir];
  const cx = c + dx * at;
  const cy = c + dy * at;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(Math.atan2(dy, dx));

  const half = width / 2;
  const grad = ctx.createLinearGradient(-S * 0.06, 0, S * 0.02, 0);
  grad.addColorStop(0, 'rgba(40,10,16,0)');
  grad.addColorStop(0.5, '#2a0a12');
  grad.addColorStop(1, '#12060a');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(-S * 0.05, -half);
  for (let i = 0; i <= 6; i++) {
    ctx.lineTo(-S * 0.02 + Math.random() * S * 0.05, -half + (width * i) / 6);
  }
  ctx.lineTo(-S * 0.05, half);
  ctx.closePath();
  ctx.fill();

  // Embers along the broken lip.
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 10; i++) {
    const y = -half + Math.random() * width;
    const x = -S * 0.03 + Math.random() * S * 0.04;
    const r = S * (0.004 + Math.random() * 0.012);
    const eg = ctx.createRadialGradient(x, y, 0, x, y, r);
    eg.addColorStop(0, 'rgba(255,150,60,0.9)');
    eg.addColorStop(1, 'rgba(200,40,20,0)');
    ctx.fillStyle = eg;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawTileBase(ctx, S, dark) {
  const g = ctx.createRadialGradient(S / 2, S / 2, S * 0.1, S / 2, S / 2, S * 0.72);
  if (dark) {
    g.addColorStop(0, '#4a3550');
    g.addColorStop(1, '#241a2c');
  } else {
    g.addColorStop(0, '#b9cde4');
    g.addColorStop(1, '#7f97b4');
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  veins(ctx, S, S, 14, dark ? '#120a18' : '#61789a', 0.22);

  // Cloud fluff creeping in from the corners.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 26; i++) {
    const x = Math.random() * S;
    const y = Math.random() * S;
    const r = S * (0.04 + Math.random() * 0.13);
    const edge = Math.min(x, y, S - x, S - y) / (S / 2);
    const cg = ctx.createRadialGradient(x, y, 0, x, y, r);
    cg.addColorStop(0, 'rgba(255,255,255,' + (0.16 * (1 - edge)).toFixed(3) + ')');
    cg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Top-down art for one bridge tile.
 * `edges` is {n,e,s,w}; `passable` false draws the severed variant.
 */
export function drawSpanArt(ctx, S, edges, passable) {
  drawTileBase(ctx, S, !passable);
  const width = S * 0.40;
  const open = ['n', 'e', 's', 'w'].filter((d) => edges[d]);
  const stopAt = passable ? S / 2 : S * 0.34;

  for (const d of open) drawDeck(ctx, S, d, S / 2, 0, width);

  if (passable) {
    // Central rosette where the spans meet.
    const c = S / 2;
    const r = width * 0.56;
    ctx.save();
    const rg = ctx.createRadialGradient(c, c, 0, c, c, r);
    rg.addColorStop(0, '#fffdf4');
    rg.addColorStop(0.65, '#f6e3b4');
    rg.addColorStop(1, '#d9b463');
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = goldGradient(ctx, c - r, c - r, c + r, c + r);
    ctx.lineWidth = S * 0.02;
    ctx.stroke();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = S * 0.008;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(a) * r * 0.32, c + Math.sin(a) * r * 0.32);
      ctx.lineTo(c + Math.cos(a) * r * 0.86, c + Math.sin(a) * r * 0.86);
      ctx.stroke();
    }
    ctx.restore();
  } else {
    // Cut each stub back and burn a chasm across it.
    ctx.save();
    for (const d of open) {
      const r = spanRect(S, d, stopAt, S / 2 - 1, width + 4);
      ctx.clearRect(r.x, r.y, r.w, r.h);
    }
    ctx.restore();
    // Repaint the base only inside the cleared band.
    const tmp = createCanvas(S, S);
    const tctx = tmp.getContext('2d');
    drawTileBase(tctx, S, true);
    ctx.save();
    ctx.globalCompositeOperation = 'destination-over';
    ctx.drawImage(tmp, 0, 0);
    ctx.restore();
    for (const d of open) drawRift(ctx, S, d, stopAt, width);

    // A sullen glow at the heart of the broken tile.
    const c = S / 2;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const hg = ctx.createRadialGradient(c, c, 0, c, c, S * 0.3);
    hg.addColorStop(0, 'rgba(190,40,30,0.55)');
    hg.addColorStop(1, 'rgba(120,10,20,0)');
    ctx.fillStyle = hg;
    ctx.fillRect(0, 0, S, S);
    ctx.restore();
  }

  // Outer bevel so tiles read as separate slabs.
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.30)';
  ctx.lineWidth = S * 0.016;
  ctx.strokeRect(S * 0.008, S * 0.008, S * 0.984, S * 0.984);
  ctx.strokeStyle = 'rgba(20,30,50,0.28)';
  ctx.lineWidth = S * 0.01;
  ctx.strokeRect(S * 0.028, S * 0.028, S * 0.944, S * 0.944);
  ctx.restore();
  grain(ctx, S, S, 14);
}

export function makeSpanTexture(edges, passable, size = 512) {
  const c = createCanvas(size, size);
  drawSpanArt(c.getContext('2d'), size, edges, passable);
  return c;
}

export function makeCornerstoneTexture(size = 512) {
  const c = createCanvas(size, size);
  const ctx = c.getContext('2d');
  const S = size;
  drawSpanArt(ctx, S, { n: true, e: true, s: true, w: true }, true);

  // An extra sunburst marks where the bridge begins.
  const cx = S / 2;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(cx, cx, 0, cx, cx, S * 0.34);
  g.addColorStop(0, 'rgba(255,244,198,0.95)');
  g.addColorStop(0.45, 'rgba(255,214,110,0.45)');
  g.addColorStop(1, 'rgba(255,190,60,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  ctx.globalAlpha = 0.85;
  ctx.strokeStyle = '#fff6d0';
  ctx.lineWidth = S * 0.012;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * S * 0.1, cx + Math.sin(a) * S * 0.1);
    ctx.lineTo(cx + Math.cos(a) * S * (0.2 + (i % 2) * 0.08), cx + Math.sin(a) * S * (0.2 + (i % 2) * 0.08));
    ctx.stroke();
  }
  ctx.restore();
  return c;
}

export function makeGateTexture(kind, size = 512) {
  // kind: 'hidden' | 'gold' | 'stone'
  const c = createCanvas(size, size);
  const ctx = c.getContext('2d');
  const S = size;
  const cx = S / 2;

  if (kind === 'hidden') {
    const g = ctx.createRadialGradient(cx, cx, S * 0.05, cx, cx, S * 0.7);
    g.addColorStop(0, '#4b3f6b');
    g.addColorStop(0.6, '#2b2445');
    g.addColorStop(1, '#161226');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 90; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * S * 0.45;
      const x = cx + Math.cos(a) * r;
      const y = cx + Math.sin(a) * r;
      const s = S * (0.002 + Math.random() * 0.006);
      ctx.fillStyle = 'rgba(220,220,255,' + (0.25 + Math.random() * 0.6).toFixed(2) + ')';
      ctx.beginPath();
      ctx.arc(x, y, s, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = goldGradient(ctx, 0, 0, S, S);
    ctx.lineWidth = S * 0.03;
    ctx.strokeRect(S * 0.06, S * 0.06, S * 0.88, S * 0.88);
    ctx.restore();
    drawQuestion(ctx, S);
    grain(ctx, S, S, 12);
    return c;
  }

  drawSpanArt(ctx, S, { n: true, e: true, s: true, w: true }, true);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(cx, cx, 0, cx, cx, S * 0.5);
  if (kind === 'gold') {
    g.addColorStop(0, 'rgba(255,248,205,1)');
    g.addColorStop(0.4, 'rgba(255,206,90,0.7)');
    g.addColorStop(1, 'rgba(255,170,40,0)');
  } else {
    g.addColorStop(0, 'rgba(150,160,180,0.55)');
    g.addColorStop(1, 'rgba(90,100,120,0)');
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  ctx.restore();

  if (kind === 'stone') {
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = '#5f6a7d';
    ctx.beginPath();
    ctx.arc(cx, cx, S * 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#38414f';
    ctx.lineWidth = S * 0.012;
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      const a = Math.random() * Math.PI * 2;
      ctx.moveTo(cx, cx);
      ctx.lineTo(cx + Math.cos(a) * S * 0.2, cx + Math.sin(a) * S * 0.2);
      ctx.stroke();
    }
    ctx.restore();
  }
  grain(ctx, S, S, 10);
  return c;
}

function drawQuestion(ctx, S) {
  ctx.save();
  ctx.translate(S / 2, S / 2);
  // A tile's canvas maps +x to world east, and a player stands at the
  // Cornerstone looking east -- so east is "up" on their screen. A quarter
  // turn puts the glyph's head that way instead of leaving it sideways.
  ctx.rotate(Math.PI / 2);
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = '#f3d489';
  ctx.font = '700 ' + Math.round(S * 0.42) + 'px Cinzel, Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(255,220,140,0.8)';
  ctx.shadowBlur = S * 0.08;
  ctx.fillText('?', 0, S * 0.02);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Emblems used by the action cards.
// ---------------------------------------------------------------------------
export function drawHalo(ctx, cx, cy, R, broken) {
  ctx.save();
  ctx.translate(cx, cy);
  if (!broken) {
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(0, 0, R * 0.2, 0, 0, R * 1.5);
    g.addColorStop(0, 'rgba(255,240,180,0.55)');
    g.addColorStop(1, 'rgba(255,200,80,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, R * 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.lineWidth = R * 0.2;
  ctx.strokeStyle = broken ? '#6b5a48' : goldGradient(ctx, -R, -R, R, R);
  ctx.beginPath();
  if (broken) {
    ctx.arc(0, 0, R, Math.PI * 0.15, Math.PI * 1.15);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, R, Math.PI * 1.35, Math.PI * 1.95);
    ctx.stroke();
    // Smoke curling from the snuffed ring.
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = '#403040';
    ctx.lineWidth = R * 0.1;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(R * (0.4 + i * 0.2), -R * 0.4);
      ctx.bezierCurveTo(R * 0.9, -R * 1.1, R * 0.2, -R * 1.4, R * 0.6, -R * 2.0);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#c0303a';
    ctx.lineWidth = R * 0.07;
    ctx.beginPath();
    ctx.moveTo(-R * 0.9, R * 0.5);
    ctx.lineTo(R * 0.9, -R * 0.5);
    ctx.stroke();
  } else {
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.7;
    ctx.strokeStyle = '#fffbe8';
    ctx.lineWidth = R * 0.06;
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.88, Math.PI * 1.1, Math.PI * 1.8);
    ctx.stroke();
  }
  ctx.restore();
}

/** One wing from a shoulder at the origin, fanning to the right. */
function featherFan(ctx, R, stroke, rows) {
  const feather = (a, L, w) => {
    const tx = Math.cos(a) * L;
    const ty = Math.sin(a) * L;
    const nx = -Math.sin(a) * w;
    const ny = Math.cos(a) * w;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(tx * 0.45 + nx, ty * 0.45 + ny, tx, ty);
    ctx.quadraticCurveTo(tx * 0.45 - nx, ty * 0.45 - ny, 0, 0);
    ctx.closePath();
    ctx.fill();
    if (stroke) ctx.stroke();
  };
  for (const row of rows) {
    ctx.fillStyle = row.fill;
    for (let i = 0; i < row.n; i++) {
      const t = row.n === 1 ? 0 : i / (row.n - 1);
      const a = row.a0 + (row.a1 - row.a0) * t;
      const L = R * (row.l0 + (row.l1 - row.l0) * t);
      feather(a, L, R * row.w);
    }
  }
}

const WING_ROWS = [
  { n: 7, a0: -0.62, a1: 0.42, l0: 1.62, l1: 1.02, w: 0.115, fill: '#efe0c2' },
  { n: 6, a0: -0.55, a1: 0.38, l0: 1.18, l1: 0.74, w: 0.105, fill: '#fdf2e0' },
  { n: 5, a0: -0.46, a1: 0.30, l0: 0.76, l1: 0.48, w: 0.095, fill: '#fffdf6' },
];

export function drawWings(ctx, cx, cy, R, broken) {
  const feather = (dir) => {
    ctx.save();
    ctx.scale(dir, 1);
    ctx.beginPath();
    ctx.moveTo(0, -R * 0.15);
    ctx.bezierCurveTo(R * 0.5, -R * 0.85, R * 1.25, -R * 0.6, R * 1.45, R * 0.05);
    ctx.bezierCurveTo(R * 1.1, R * 0.1, R * 0.9, R * 0.35, R * 0.62, R * 0.62);
    ctx.bezierCurveTo(R * 0.5, R * 0.3, R * 0.28, R * 0.15, 0, R * 0.2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Feather ribs.
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = R * 0.035;
    for (let i = 1; i <= 4; i++) {
      ctx.beginPath();
      ctx.moveTo(R * 0.12 * i, -R * 0.1);
      ctx.quadraticCurveTo(R * 0.42 * i, R * 0.1, R * 0.33 * i, R * 0.45);
      ctx.stroke();
    }
    ctx.restore();
  };

  ctx.save();
  ctx.translate(cx, cy);
  ctx.lineWidth = R * 0.07;
  if (broken) {
    ctx.fillStyle = '#8d8394';
    ctx.strokeStyle = '#4b4152';
    feather(1);
    // The other wing is gone; only shorn stubs and drifting feathers remain.
    ctx.save();
    ctx.scale(-1, 1);
    ctx.beginPath();
    ctx.moveTo(0, -R * 0.15);
    ctx.bezierCurveTo(R * 0.35, -R * 0.6, R * 0.6, -R * 0.42, R * 0.62, -R * 0.05);
    ctx.lineTo(R * 0.2, R * 0.2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = '#6d6376';
    for (let i = 0; i < 5; i++) {
      const x = -R * (0.7 + Math.random() * 0.9);
      const y = R * (0.5 + Math.random() * 1.1);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.random() * Math.PI);
      ctx.beginPath();
      ctx.ellipse(0, 0, R * 0.07, R * 0.22, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.strokeStyle = '#c0303a';
    ctx.lineWidth = R * 0.07;
    ctx.beginPath();
    ctx.moveTo(-R * 1.2, R * 0.7);
    ctx.lineTo(R * 1.2, -R * 0.7);
    ctx.stroke();
  } else {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 1.9);
    g.addColorStop(0, 'rgba(255,246,214,0.45)');
    g.addColorStop(1, 'rgba(255,220,140,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-R * 2.2, -R * 2.2, R * 4.4, R * 4.4);
    ctx.restore();

    ctx.strokeStyle = 'rgba(201,153,47,0.55)';
    ctx.lineWidth = R * 0.035;
    [1, -1].forEach((dir) => {
      ctx.save();
      ctx.scale(dir, 1);
      ctx.translate(R * 0.08, -R * 0.1);
      featherFan(ctx, R, true, WING_ROWS);
      ctx.restore();
    });
  }
  ctx.restore();
}

/** The Builder emblem: a halo over open wings, the hammer standing between. */
export function drawBuilderEmblem(ctx, cx, cy, R) {
  ctx.save();
  ctx.translate(cx, cy);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const bloom = ctx.createRadialGradient(0, -R * 0.15, 0, 0, -R * 0.15, R * 2.3);
  bloom.addColorStop(0, 'rgba(255,246,212,0.6)');
  bloom.addColorStop(0.4, 'rgba(255,216,130,0.28)');
  bloom.addColorStop(1, 'rgba(255,190,70,0)');
  ctx.fillStyle = bloom;
  ctx.fillRect(-R * 2.6, -R * 2.6, R * 5.2, R * 5.2);
  ctx.strokeStyle = 'rgba(255,238,180,0.38)';
  ctx.lineWidth = R * 0.05;
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * R * 1.05, -R * 0.15 + Math.sin(a) * R * 1.05);
    ctx.lineTo(Math.cos(a) * R * (1.4 + (i % 2) * 0.3), -R * 0.15 + Math.sin(a) * R * (1.4 + (i % 2) * 0.3));
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.translate(0, R * 0.36);
  ctx.strokeStyle = 'rgba(201,153,47,0.5)';
  ctx.lineWidth = R * 0.03;
  const rows = [
    { n: 8, a0: -0.66, a1: 0.34, l0: 1.74, l1: 1.06, w: 0.1,   fill: '#e9d6b4' },
    { n: 7, a0: -0.58, a1: 0.30, l0: 1.26, l1: 0.78, w: 0.092, fill: '#fbefdc' },
    { n: 5, a0: -0.48, a1: 0.24, l0: 0.82, l1: 0.50, w: 0.085, fill: '#fffdf7' },
  ];
  [1, -1].forEach((dir) => {
    ctx.save();
    ctx.scale(dir, 1);
    ctx.translate(R * 0.14, 0);
    featherFan(ctx, R, true, rows);
    ctx.restore();
  });
  ctx.restore();

  ctx.save();
  ctx.translate(0, R * 0.14);
  ctx.fillStyle = '#6a4b2c';
  ctx.strokeStyle = '#3a2716';
  ctx.lineWidth = R * 0.045;
  roundRect(ctx, -R * 0.085, -R * 0.08, R * 0.17, R * 1.12, R * 0.06);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = goldGradient(ctx, -R * 0.5, -R * 0.5, R * 0.5, R * 0.05);
  ctx.strokeStyle = PALETTE.goldDark;
  ctx.lineWidth = R * 0.05;
  roundRect(ctx, -R * 0.46, -R * 0.48, R * 0.92, R * 0.44, R * 0.08);
  ctx.fill();
  ctx.stroke();
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = '#fffbe8';
  roundRect(ctx, -R * 0.4, -R * 0.44, R * 0.8, R * 0.08, R * 0.04);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(0, -R * 1.02);
  ctx.strokeStyle = goldGradient(ctx, -R * 0.6, -R * 0.2, R * 0.6, R * 0.2);
  ctx.lineWidth = R * 0.13;
  ctx.beginPath();
  ctx.ellipse(0, 0, R * 0.62, R * 0.2, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 0.75;
  ctx.strokeStyle = '#fffdf0';
  ctx.lineWidth = R * 0.045;
  ctx.beginPath();
  ctx.ellipse(0, -R * 0.03, R * 0.56, R * 0.16, 0, Math.PI * 1.05, Math.PI * 1.95);
  ctx.stroke();
  ctx.restore();

  ctx.restore();
}

export function drawHammer(ctx, cx, cy, R, broken) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-0.5);
  const headW = R * 1.25;
  const headH = R * 0.62;

  if (broken) {
    // Head split in two, haft snapped.
    ctx.fillStyle = '#7f8794';
    ctx.strokeStyle = '#3c434f';
    ctx.lineWidth = R * 0.07;
    ctx.save();
    ctx.rotate(-0.35);
    ctx.translate(-R * 0.35, -R * 0.2);
    roundRect(ctx, -headW / 2, -headH / 2, headW * 0.46, headH, R * 0.08);
    ctx.fill(); ctx.stroke();
    ctx.restore();
    ctx.save();
    ctx.rotate(0.4);
    ctx.translate(R * 0.42, -R * 0.1);
    roundRect(ctx, headW * 0.04, -headH / 2, headW * 0.46, headH, R * 0.08);
    ctx.fill(); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = '#6a4b2c';
    ctx.save();
    ctx.rotate(0.15);
    roundRect(ctx, -R * 0.11, R * 0.2, R * 0.22, R * 0.6, R * 0.06);
    ctx.fill(); ctx.stroke();
    ctx.rotate(0.5);
    roundRect(ctx, -R * 0.09, R * 0.9, R * 0.18, R * 0.5, R * 0.05);
    ctx.fill(); ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = '#c0303a';
    ctx.lineWidth = R * 0.07;
    ctx.beginPath();
    ctx.moveTo(-R * 1.1, R * 0.9);
    ctx.lineTo(R * 1.1, -R * 0.9);
    ctx.stroke();
  } else {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 1.6);
    g.addColorStop(0, 'rgba(255,240,180,0.42)');
    g.addColorStop(1, 'rgba(255,200,80,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-R * 2, -R * 2, R * 4, R * 4);
    ctx.restore();
    ctx.fillStyle = '#6a4b2c';
    ctx.strokeStyle = '#3a2716';
    ctx.lineWidth = R * 0.06;
    roundRect(ctx, -R * 0.12, -R * 0.1, R * 0.24, R * 1.5, R * 0.07);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = goldGradient(ctx, -headW / 2, -headH / 2, headW / 2, headH / 2);
    ctx.strokeStyle = PALETTE.goldDark;
    ctx.lineWidth = R * 0.07;
    roundRect(ctx, -headW / 2, -headH / 2 - R * 0.1, headW, headH, R * 0.1);
    ctx.fill(); ctx.stroke();
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = '#fffbe8';
    roundRect(ctx, -headW / 2 + R * 0.08, -headH / 2 - R * 0.02, headW - R * 0.16, R * 0.1, R * 0.05);
    ctx.fill();
  }
  ctx.restore();
}

export function drawBolt(ctx, cx, cy, R) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 1.7);
  g.addColorStop(0, 'rgba(255,230,160,0.5)');
  g.addColorStop(0.5, 'rgba(255,120,50,0.25)');
  g.addColorStop(1, 'rgba(200,40,20,0)');
  ctx.fillStyle = g;
  ctx.fillRect(-R * 2, -R * 2, R * 4, R * 4);
  ctx.globalCompositeOperation = 'source-over';

  const path = () => {
    ctx.beginPath();
    ctx.moveTo(-R * 0.18, -R * 1.35);
    ctx.lineTo(R * 0.42, -R * 0.25);
    ctx.lineTo(R * 0.06, -R * 0.2);
    ctx.lineTo(R * 0.5, R * 1.35);
    ctx.lineTo(-R * 0.45, R * 0.1);
    ctx.lineTo(-R * 0.08, R * 0.05);
    ctx.closePath();
  };
  ctx.shadowColor = 'rgba(255,180,80,0.95)';
  ctx.shadowBlur = R * 0.6;
  ctx.fillStyle = '#fff3c4';
  path();
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = '#e08a2a';
  ctx.lineWidth = R * 0.06;
  path();
  ctx.stroke();
  ctx.restore();
}

export function drawEye(ctx, cx, cy, R) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = 'rgba(200,180,255,0.55)';
  ctx.lineWidth = R * 0.06;
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * R * 1.15, Math.sin(a) * R * 1.15);
    ctx.lineTo(Math.cos(a) * R * (1.5 + (i % 2) * 0.28), Math.sin(a) * R * (1.5 + (i % 2) * 0.28));
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';

  ctx.beginPath();
  ctx.moveTo(-R * 1.15, 0);
  ctx.quadraticCurveTo(0, -R * 0.95, R * 1.15, 0);
  ctx.quadraticCurveTo(0, R * 0.95, -R * 1.15, 0);
  ctx.closePath();
  ctx.fillStyle = '#fffaf0';
  ctx.fill();
  ctx.strokeStyle = PALETTE.goldDeep;
  ctx.lineWidth = R * 0.09;
  ctx.stroke();

  const ig = ctx.createRadialGradient(0, 0, R * 0.05, 0, 0, R * 0.52);
  ig.addColorStop(0, '#e6d6ff');
  ig.addColorStop(0.55, '#7b5fd0');
  ig.addColorStop(1, '#2e1f55');
  ctx.fillStyle = ig;
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.52, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#140c28';
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.beginPath();
  ctx.arc(-R * 0.18, -R * 0.18, R * 0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function cubicAt(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

/**
 * A solid horn, built by sweeping a shrinking disc along a curve. Outlining one
 * as a closed bezier kept pinching into a sliver; a swept taper cannot.
 */
function sweptHorn(ctx, pts, baseR, fill) {
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const t = i / (pts.length - 1);
    const r = baseR * Math.pow(1 - t, 1.25) + baseR * 0.03;
    ctx.moveTo(pts[i].x + r, pts[i].y);
    ctx.arc(pts[i].x, pts[i].y, r, 0, Math.PI * 2);
  }
  ctx.fillStyle = fill;
  ctx.fill();
}

export function drawHornsAndFire(ctx, cx, cy, R) {
  ctx.save();
  ctx.translate(cx, cy);

  // --- fire: nested silhouettes, so it reads as one mass of flame ---------
  // Separate tongues looked like petals; layering one wavy outline inside
  // another gives a blaze with a hot core. The layers are composed off-screen
  // so the flat bottom of each path can be dissolved away without punching a
  // hole through the card beneath.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const bloom = ctx.createRadialGradient(0, R * 0.5, 0, 0, R * 0.5, R * 2.6);
  bloom.addColorStop(0, 'rgba(255,150,60,0.5)');
  bloom.addColorStop(0.4, 'rgba(196,42,24,0.28)');
  bloom.addColorStop(1, 'rgba(100,6,16,0)');
  ctx.fillStyle = bloom;
  ctx.fillRect(-R * 3, -R * 3, R * 6, R * 6);
  ctx.restore();

  const FW = Math.ceil(R * 8);
  const FH = Math.ceil(R * 5);
  const fire = createCanvas(FW, FH);
  const fx = fire.getContext('2d');
  fx.translate(FW / 2, FH * 0.72);

  const base = R * 1.0;
  const flameLayer = (peaks, colour) => {
    fx.fillStyle = colour;
    fx.beginPath();
    fx.moveTo(peaks[0][0] * R, base);
    let prev = peaks[0][0] * R;
    for (const [px, ph] of peaks) {
      const x = px * R;
      const y = -ph * R;
      fx.quadraticCurveTo((prev + x) / 2, base * 0.3, x - R * 0.07, y + R * 0.05);
      fx.quadraticCurveTo(x, y - R * 0.14, x + R * 0.07, y + R * 0.05);
      prev = x;
    }
    fx.lineTo(peaks[peaks.length - 1][0] * R, base);
    fx.closePath();
    fx.fill();
  };

  flameLayer([[-1.58, 0.04], [-1.22, 0.34], [-0.86, 0.76], [-0.4, 0.46],
    [0.06, 0.94], [0.5, 0.52], [0.98, 0.78], [1.32, 0.3], [1.6, 0.04]], '#8e1420');
  flameLayer([[-1.16, 0.04], [-0.84, 0.4], [-0.46, 0.8], [-0.02, 0.54],
    [0.4, 0.88], [0.84, 0.44], [1.14, 0.04]], '#c22f28');
  flameLayer([[-0.8, 0.04], [-0.5, 0.44], [-0.14, 0.76], [0.24, 0.5],
    [0.6, 0.68], [0.84, 0.04]], '#ef6a24');
  flameLayer([[-0.5, 0.04], [-0.26, 0.42], [0.04, 0.64], [0.34, 0.36],
    [0.54, 0.04]], '#ffb047');
  flameLayer([[-0.24, 0.04], [-0.06, 0.34], [0.14, 0.46], [0.28, 0.04]], '#ffe6ae');

  // Dissolve the straight base into the coals.
  fx.globalCompositeOperation = 'destination-out';
  const fade = fx.createLinearGradient(0, base - R * 0.62, 0, base + R * 0.04);
  fade.addColorStop(0, 'rgba(0,0,0,0)');
  fade.addColorStop(1, 'rgba(0,0,0,1)');
  fx.fillStyle = fade;
  fx.fillRect(-FW / 2, base - R * 0.62, FW, R * 0.7);

  ctx.drawImage(fire, -FW / 2, -FH * 0.72);

  // The bed of coals the flames stand in.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const bed = ctx.createRadialGradient(0, R * 0.72, 0, 0, R * 0.72, R * 1.7);
  bed.addColorStop(0, 'rgba(255,196,96,0.75)');
  bed.addColorStop(0.34, 'rgba(226,78,34,0.5)');
  bed.addColorStop(1, 'rgba(140,16,24,0)');
  ctx.save();
  ctx.scale(1, 0.42);
  ctx.fillStyle = bed;
  ctx.beginPath();
  ctx.arc(0, R * 1.72, R * 1.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  for (let i = 0; i < 26; i++) {
    const x = (Math.random() - 0.5) * R * 3.4;
    const y = R * 0.6 - Math.random() * R * 2.5;
    const r = R * (0.01 + Math.random() * 0.032);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,218,140,0.95)');
    g.addColorStop(1, 'rgba(255,110,40,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // --- horns: long, heavy, sweeping out of the blaze ----------------------
  const horn = (dir) => {
    ctx.save();
    ctx.scale(dir, 1);

    // Centreline: out of the fire, outward, then up and slightly back.
    const P = [
      { x: R * 0.30, y: R * 1.0 },
      { x: R * 0.62, y: R * 0.2 },
      { x: R * 1.34, y: -R * 0.5 },
      { x: R * 1.32, y: -R * 1.72 },
    ];
    const pts = [];
    for (let i = 0; i <= 44; i++) {
      const t = i / 44;
      pts.push({
        x: cubicAt(P[0].x, P[1].x, P[2].x, P[3].x, t),
        y: cubicAt(P[0].y, P[1].y, P[2].y, P[3].y, t),
      });
    }

    ctx.save();
    ctx.shadowColor = 'rgba(30,2,8,0.95)';
    ctx.shadowBlur = R * 0.34;
    sweptHorn(ctx, pts, R * 0.34, '#180709');
    ctx.restore();

    // Warm rim down the lit side, and cool sheen along the back.
    ctx.save();
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const t = i / (pts.length - 1);
      const r = R * 0.34 * Math.pow(1 - t, 1.25) + R * 0.01;
      ctx.moveTo(pts[i].x + r, pts[i].y);
      ctx.arc(pts[i].x, pts[i].y, r, 0, Math.PI * 2);
    }
    ctx.clip();

    ctx.strokeStyle = 'rgba(255,140,62,0.9)';
    ctx.lineWidth = R * 0.075;
    ctx.lineCap = 'round';
    ctx.beginPath();
    pts.forEach((pt, i) => {
      const t = i / (pts.length - 1);
      const off = R * 0.22 * (1 - t);
      const p = { x: pt.x - off, y: pt.y + off * 0.35 };
      if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255,190,140,0.22)';
    ctx.lineWidth = R * 0.05;
    ctx.beginPath();
    pts.forEach((pt, i) => {
      const t = i / (pts.length - 1);
      const off = R * 0.2 * (1 - t);
      const p = { x: pt.x + off, y: pt.y - off * 0.3 };
      if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();

    // Growth ridges around the horn.
    ctx.strokeStyle = 'rgba(255,160,100,0.3)';
    ctx.lineWidth = R * 0.035;
    for (let i = 4; i < pts.length - 6; i += 5) {
      const t = i / (pts.length - 1);
      const r = R * 0.36 * Math.pow(1 - t, 1.25);
      const dx = pts[i + 1].x - pts[i - 1].x;
      const dy = pts[i + 1].y - pts[i - 1].y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      ctx.beginPath();
      ctx.moveTo(pts[i].x - nx * r, pts[i].y - ny * r);
      ctx.lineTo(pts[i].x + nx * r, pts[i].y + ny * r);
      ctx.stroke();
    }
    ctx.restore();
    ctx.restore();
  };
  horn(1);
  horn(-1);

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Hand cards.
// ---------------------------------------------------------------------------
const CARD_W = 512;
const CARD_H = 768;

const ACCENTS = {
  path:   { a: '#dff0ff', b: '#8fb6de', ink: '#2b3a4e' },
  break:  { a: '#3a0f17', b: '#7d1a20', ink: '#ffd9cf' },
  repair: { a: '#fff5db', b: '#f0d08f', ink: '#4a3411' },
  smite:  { a: '#3a1608', b: '#8c3b12', ink: '#ffe0c0' },
  reveal: { a: '#241a40', b: '#5b4694', ink: '#e6dcff' },
};

function accentFor(card) {
  if (card.type === 'path') return ACCENTS.path;
  return ACCENTS[card.action] || ACCENTS.path;
}

function wrapText(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function cardFrame(ctx, W, H, accent, dark) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, accent.a);
  g.addColorStop(1, accent.b);
  ctx.fillStyle = g;
  roundRect(ctx, 0, 0, W, H, W * 0.06);
  ctx.fill();

  veins(ctx, W, H, 10, dark ? '#000000' : '#ffffff', 0.08);

  // Double gold frame with corner flourishes.
  ctx.save();
  ctx.strokeStyle = goldGradient(ctx, 0, 0, W, H);
  ctx.lineWidth = W * 0.03;
  roundRect(ctx, W * 0.022, W * 0.022, W - W * 0.044, H - W * 0.044, W * 0.05);
  ctx.stroke();
  ctx.lineWidth = W * 0.008;
  ctx.strokeStyle = 'rgba(255,245,210,0.75)';
  roundRect(ctx, W * 0.055, W * 0.055, W - W * 0.11, H - W * 0.11, W * 0.04);
  ctx.stroke();

  ctx.fillStyle = goldGradient(ctx, 0, 0, W, H);
  const cs = W * 0.05;
  [[W * 0.055, W * 0.055, 1, 1], [W - W * 0.055, W * 0.055, -1, 1],
   [W * 0.055, H - W * 0.055, 1, -1], [W - W * 0.055, H - W * 0.055, -1, -1]]
    .forEach(([x, y, sx, sy]) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(sx, sy);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(cs, 0);
      ctx.quadraticCurveTo(cs * 0.25, cs * 0.25, 0, cs);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    });
  ctx.restore();
}

function cardBanner(ctx, W, title, y, ink) {
  ctx.save();
  const h = W * 0.14;
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, 'rgba(0,0,0,0.30)');
  g.addColorStop(1, 'rgba(0,0,0,0.05)');
  ctx.fillStyle = g;
  roundRect(ctx, W * 0.09, y, W * 0.82, h, h * 0.28);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,225,160,0.55)';
  ctx.lineWidth = W * 0.006;
  ctx.stroke();

  let size = Math.round(W * 0.092);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = ink;
  do {
    ctx.font = '700 ' + size + 'px Cinzel, Georgia, serif';
    size -= 2;
  } while (ctx.measureText(title).width > W * 0.76 && size > 20);
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = W * 0.02;
  ctx.fillText(title, W / 2, y + h / 2 + W * 0.004);
  ctx.restore();
}

function artPanel(ctx, W, y, h, dark) {
  ctx.save();
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  if (dark) {
    g.addColorStop(0, '#160d18');
    g.addColorStop(1, '#2b1520');
  } else {
    g.addColorStop(0, '#cfe6fb');
    g.addColorStop(1, '#8fb4d8');
  }
  ctx.fillStyle = g;
  roundRect(ctx, W * 0.1, y, W * 0.8, h, W * 0.04);
  ctx.fill();
  ctx.save();
  roundRect(ctx, W * 0.1, y, W * 0.8, h, W * 0.04);
  ctx.clip();
  // Cloudbank inside the frame.
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 22; i++) {
    const x = W * 0.1 + Math.random() * W * 0.8;
    const cy2 = y + h * (0.55 + Math.random() * 0.55);
    const r = W * (0.06 + Math.random() * 0.16);
    const cg = ctx.createRadialGradient(x, cy2, 0, x, cy2, r);
    cg.addColorStop(0, dark ? 'rgba(78,34,52,0.22)' : 'rgba(255,255,255,0.42)');
    cg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.arc(x, cy2, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,230,170,0.6)';
  ctx.lineWidth = W * 0.008;
  roundRect(ctx, W * 0.1, y, W * 0.8, h, W * 0.04);
  ctx.stroke();
  ctx.restore();
}

function cardFooter(ctx, W, H, text, ink) {
  ctx.save();
  ctx.fillStyle = ink;
  ctx.globalAlpha = 0.95;
  // Sized to stay legible once the card is only ~150 screen pixels wide.
  const size = Math.round(W * 0.066);
  const lead = W * 0.082;
  ctx.font = '600 ' + size + 'px "EB Garamond", Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  let lines = wrapText(ctx, text, W * 0.78);
  // Very long rules text drops a step rather than colliding with the art.
  if (lines.length > 4) {
    ctx.font = '600 ' + Math.round(W * 0.056) + 'px "EB Garamond", Georgia, serif';
    lines = wrapText(ctx, text, W * 0.8);
  }
  const startY = H - W * 0.13 - lines.length * lead;
  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowBlur = W * 0.006;
  lines.forEach((l, i) => ctx.fillText(l, W / 2, startY + i * lead));
  ctx.restore();
}

/**
 * @param rotated  draw the span as it will sit once flipped end-for-end.
 */
export function makeCardFaceTexture(card, rotated = false) {
  const c = createCanvas(CARD_W, CARD_H);
  const ctx = c.getContext('2d');
  const W = CARD_W;
  const H = CARD_H;
  const accent = accentFor(card);
  const dark = card.type === 'action' && (card.action === 'break' || card.action === 'smite' || card.action === 'reveal');

  cardFrame(ctx, W, H, accent, dark);
  cardBanner(ctx, W, cardTitle(card), W * 0.1, accent.ink);

  const panelY = W * 0.285;
  const panelH = W * 0.76;
  artPanel(ctx, W, panelY, panelH, dark);

  const cx = W / 2;
  const cy = panelY + panelH / 2;

  if (card.type === 'path') {
    // Show the actual span, drawn top-down and inset in the frame.
    const S = Math.round(W * 0.56);
    const tile = createCanvas(S, S);
    // The player looks east from the Cornerstone, so on screen east is up and
    // south is right. Drawing in board axes made an east-west span read as a
    // left-right corridor when it actually lay up-down the screen.
    const board = rotated ? rotateEdges(edgeSetToObj(card.edges)) : edgeSetToObj(card.edges);
    const edges = { n: board.e, e: board.s, s: board.w, w: board.n };
    drawSpanArt(tile.getContext('2d'), S, edges, card.passable);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = W * 0.04;
    ctx.shadowOffsetY = W * 0.012;
    ctx.drawImage(tile, cx - S / 2, cy - S / 2);
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,235,180,0.7)';
    ctx.lineWidth = W * 0.008;
    ctx.strokeRect(cx - S / 2, cy - S / 2, S, S);
  } else if (card.action === 'break') {
    const R = W * 0.2;
    if (card.tool === 'halo') drawHalo(ctx, cx, cy, R, true);
    if (card.tool === 'wings') drawWings(ctx, cx, cy, R, true);
    if (card.tool === 'hammer') drawHammer(ctx, cx, cy, R, true);
  } else if (card.action === 'repair') {
    if (card.tools.length === 1) {
      const R = W * 0.2;
      if (card.tools[0] === 'halo') drawHalo(ctx, cx, cy, R, false);
      if (card.tools[0] === 'wings') drawWings(ctx, cx, cy, R, false);
      if (card.tools[0] === 'hammer') drawHammer(ctx, cx, cy, R, false);
    } else {
      const R = W * 0.125;
      const off = W * 0.17;
      const draw = (tool, x) => {
        if (tool === 'halo') drawHalo(ctx, x, cy, R, false);
        if (tool === 'wings') drawWings(ctx, x, cy, R, false);
        if (tool === 'hammer') drawHammer(ctx, x, cy, R, false);
      };
      draw(card.tools[0], cx - off);
      draw(card.tools[1], cx + off);
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = '#7d5b14';
      ctx.font = '700 ' + Math.round(W * 0.07) + 'px Cinzel, Georgia, serif';
      ctx.textAlign = 'center';
      ctx.fillText('or', cx, cy + W * 0.02);
      ctx.restore();
    }
  } else if (card.action === 'smite') {
    // A bolt shattering a span.
    ctx.save();
    ctx.globalAlpha = 0.9;
    const S = W * 0.4;
    const frag = createCanvas(128, 128);
    drawSpanArt(frag.getContext('2d'), 128, { n: false, e: true, s: false, w: true }, true);
    ctx.translate(cx, cy + W * 0.2);
    ctx.rotate(0.22);
    ctx.drawImage(frag, -S / 2, -S * 0.18, S, S * 0.36);
    ctx.restore();
    drawBolt(ctx, cx, cy - W * 0.04, W * 0.2);
  } else if (card.action === 'reveal') {
    drawEye(ctx, cx, cy, W * 0.17);
  }

  cardFooter(ctx, W, H, cardDescription(card), accent.ink);

  // Corner pips so a fanned hand is still readable.
  ctx.save();
  ctx.fillStyle = accent.ink;
  ctx.globalAlpha = 0.8;
  ctx.font = '700 ' + Math.round(W * 0.058) + 'px Cinzel, Georgia, serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const pip = card.type === 'path' ? (card.passable ? 'SPAN' : 'BROKEN')
    : card.action === 'break' ? 'CURSE'
    : card.action === 'repair' ? 'BLESSING'
    : card.action === 'smite' ? 'WRATH' : 'SIGHT';
  ctx.fillText(pip, W * 0.1, H - W * 0.105);
  ctx.restore();

  grain(ctx, W, H, 9);
  return c;
}

export function makeCardBackTexture() {
  const c = createCanvas(CARD_W, CARD_H);
  const ctx = c.getContext('2d');
  const W = CARD_W;
  const H = CARD_H;

  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#20365c');
  g.addColorStop(0.5, '#2c4e82');
  g.addColorStop(1, '#16233f');
  ctx.fillStyle = g;
  roundRect(ctx, 0, 0, W, H, W * 0.06);
  ctx.fill();

  ctx.save();
  roundRect(ctx, W * 0.06, W * 0.06, W - W * 0.12, H - W * 0.12, W * 0.04);
  ctx.clip();
  ctx.strokeStyle = 'rgba(255,220,150,0.18)';
  ctx.lineWidth = 2;
  for (let i = -H; i < W + H; i += 34) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + H, H);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(i + H, 0);
    ctx.lineTo(i, H);
    ctx.stroke();
  }
  ctx.restore();

  // The gate emblem.
  const cx = W / 2;
  const cy = H / 2;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, W * 0.45);
  rg.addColorStop(0, 'rgba(255,230,160,0.5)');
  rg.addColorStop(1, 'rgba(255,200,90,0)');
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = goldGradient(ctx, -W * 0.3, -W * 0.3, W * 0.3, W * 0.3);
  ctx.lineWidth = W * 0.035;
  ctx.beginPath();
  ctx.moveTo(-W * 0.22, W * 0.3);
  ctx.lineTo(-W * 0.22, -W * 0.05);
  ctx.arc(0, -W * 0.05, W * 0.22, Math.PI, 0);
  ctx.lineTo(W * 0.22, W * 0.3);
  ctx.stroke();
  ctx.lineWidth = W * 0.016;
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo(W * 0.075 * i, W * 0.3);
    ctx.lineTo(W * 0.075 * i, -W * 0.05 - Math.cos((i / 2.6) * Math.PI * 0.5) * W * 0.19);
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = goldGradient(ctx, 0, 0, W, H);
  ctx.lineWidth = W * 0.028;
  roundRect(ctx, W * 0.028, W * 0.028, W - W * 0.056, H - W * 0.056, W * 0.05);
  ctx.stroke();
  ctx.restore();

  grain(ctx, W, H, 10);
  return c;
}

export function makeRoleTexture(role) {
  const c = createCanvas(CARD_W, CARD_H);
  const ctx = c.getContext('2d');
  const W = CARD_W;
  const H = CARD_H;
  const builder = role === 'builder';
  const accent = builder
    ? { a: '#fff6e0', b: '#e9c67e', ink: '#4a3411' }
    : { a: '#2a0a12', b: '#6d1220', ink: '#ffd6cf' };

  cardFrame(ctx, W, H, accent, !builder);
  cardBanner(ctx, W, builder ? 'Builder' : 'Fallen', W * 0.1, accent.ink);
  const panelY = W * 0.29;
  const panelH = W * 0.86;
  artPanel(ctx, W, panelY, panelH, !builder);
  const cx = W / 2;
  const cy = panelY + panelH / 2;

  if (builder) {
    drawBuilderEmblem(ctx, cx, cy + W * 0.02, W * 0.175);
  } else {
    drawHornsAndFire(ctx, cx, cy + W * 0.05, W * 0.185);
  }

  cardFooter(ctx, W, H, builder
    ? 'Raise the span. Reach the Gate of Gold before the sky runs out.'
    : 'Let them build. Then let it fall. Reveal nothing.', accent.ink);
  grain(ctx, W, H, 9);
  return c;
}

// ---------------------------------------------------------------------------
// Environment textures.
// ---------------------------------------------------------------------------
export function makeCloudFloorTexture(size = 1024) {
  const c = createCanvas(size, size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#a3c2e0';
  ctx.fillRect(0, 0, size, size);

  // Layered soft blobs tile seamlessly by wrapping draws across the edges.
  const blob = (x, y, r, alpha, color) => {
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        const px = x + ox * size;
        const py = y + oy * size;
        if (px < -r || px > size + r || py < -r || py > size + r) continue;
        const g = ctx.createRadialGradient(px, py, 0, px, py, r);
        g.addColorStop(0, color.replace('$a', alpha));
        g.addColorStop(1, color.replace('$a', '0'));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  };

  for (let i = 0; i < 160; i++) {
    blob(Math.random() * size, Math.random() * size, size * (0.04 + Math.random() * 0.16),
      (0.16 + Math.random() * 0.34).toFixed(3), 'rgba(78,116,163,$a)');
  }
  for (let i = 0; i < 200; i++) {
    blob(Math.random() * size, Math.random() * size, size * (0.03 + Math.random() * 0.12),
      (0.16 + Math.random() * 0.38).toFixed(3), 'rgba(250,253,255,$a)');
  }
  for (let i = 0; i < 80; i++) {
    blob(Math.random() * size, Math.random() * size, size * (0.05 + Math.random() * 0.12),
      (0.1 + Math.random() * 0.22).toFixed(3), 'rgba(255,222,164,$a)');
  }
  for (let i = 0; i < 45; i++) {
    blob(Math.random() * size, Math.random() * size, size * (0.06 + Math.random() * 0.18),
      (0.07 + Math.random() * 0.15).toFixed(3), 'rgba(72,110,160,$a)');
  }
  return c;
}

export function makePuffTexture(size = 256) {
  const c = createCanvas(size, size);
  const ctx = c.getContext('2d');
  const n = 14;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = size * (0.1 + Math.random() * 0.16);
    const x = size / 2 + Math.cos(a) * size * 0.2 * Math.random();
    const y = size / 2 + Math.sin(a) * size * 0.13 * Math.random();
    const g = ctx.createRadialGradient(x, y, 0, x, y, rr);
    g.addColorStop(0, 'rgba(255,255,255,0.85)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, rr, 0, Math.PI * 2);
    ctx.fill();
  }
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.18)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  // Guarantee the quad reaches zero alpha well inside its own edge, so a puff
  // drifting close to the camera can never show a straight border.
  ctx.globalCompositeOperation = 'destination-out';
  const cut = ctx.createRadialGradient(size / 2, size / 2, size * 0.36, size / 2, size / 2, size * 0.5);
  cut.addColorStop(0, 'rgba(0,0,0,0)');
  cut.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.fillStyle = cut;
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = 'source-over';
  return c;
}

export function makeGlowTexture(size = 256, color = '255,225,150') {
  const c = createCanvas(size, size);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(' + color + ',1)');
  g.addColorStop(0.25, 'rgba(' + color + ',0.55)');
  g.addColorStop(1, 'rgba(' + color + ',0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c;
}

export function makeRayTexture(size = 256) {
  const c = createCanvas(size, size);
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, size);
  // Fades in at the top as well as out at the bottom: a hard top edge turned
  // every shaft into a visible horizontal line across the sky.
  g.addColorStop(0, 'rgba(255,240,200,0)');
  g.addColorStop(0.14, 'rgba(255,240,200,0.5)');
  g.addColorStop(0.58, 'rgba(255,228,166,0.16)');
  g.addColorStop(1, 'rgba(255,210,130,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const fade = ctx.createLinearGradient(0, 0, size, 0);
  fade.addColorStop(0, 'rgba(0,0,0,1)');
  fade.addColorStop(0.5, 'rgba(0,0,0,0)');
  fade.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, size, size);
  return c;
}

export function makeSkyTexture(w = 64, h = 512) {
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, h);
  // The band around v = 0.5 is the horizon; it is pinned to the scene fog colour
  // so the far edge of the cloud floor dissolves into the sky with no seam.
  g.addColorStop(0.00, '#1f5c9e');
  g.addColorStop(0.16, '#3f86c9');
  g.addColorStop(0.30, '#79b4e4');
  g.addColorStop(0.38, '#a9cdec');
  g.addColorStop(0.44, '#c2dcf4');
  g.addColorStop(0.62, '#c2dcf4');
  g.addColorStop(0.74, '#d8e6f6');
  g.addColorStop(0.88, '#ffe4b4');
  g.addColorStop(1.00, '#e8a271');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  return c;
}

export function toolGlyphDataUrl(tool, broken, size = 96) {
  const c = createCanvas(size, size);
  const ctx = c.getContext('2d');
  const R = size * 0.3;
  if (tool === 'halo') drawHalo(ctx, size / 2, size / 2, R, broken);
  if (tool === 'wings') drawWings(ctx, size / 2, size / 2, R * 0.85, broken);
  if (tool === 'hammer') drawHammer(ctx, size / 2, size / 2, R * 0.9, broken);
  return c.toDataURL();
}

export const TOOL_NAMES = TOOL_INFO;

// ---------------------------------------------------------------------------
// Cursors. A pointer you can actually aim with, wearing the mark of your side.
// ---------------------------------------------------------------------------
export const CURSOR_SIZE = 34;

// Where the pointer actually points, in canvas pixels. The glyph is free to
// sit anywhere around it -- the hotspot is what the browser aims with.
export const CURSOR_HOTSPOT = {
  builder: [3, 2],
  fallen: [4, 4],
};

export function makeCursor(kind, size = CURSOR_SIZE) {
  const c = createCanvas(size, size);
  const ctx = c.getContext('2d');
  const u = size / 34;                       // one design unit
  const P = (x, y) => [x * u, y * u];

  // Silhouette first, fill second: the heavy dark outline is what keeps the
  // glyph readable at 34px over clouds, gold panels and dark modals alike.
  const outlined = (path, fill, line, lw) => {
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = line;
    ctx.lineWidth = lw * u;
    path();
    ctx.stroke();
    ctx.fillStyle = fill;
    path();
    ctx.fill();
  };

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 2 * u;
  ctx.shadowOffsetY = 0.8 * u;

  if (kind === 'fallen') {
    // A three-tined fork angled up-left, the middle tine on the hotspot.
    ctx.translate(...P(12, 12));
    ctx.rotate(-Math.PI / 4);

    // Tapered tines with a real point, not a stroked hairline.
    const tine = (x, len, w) => () => {
      ctx.beginPath();
      ctx.moveTo(...P(x - w, 1.2));
      ctx.lineTo(...P(x - w, -len + 3.2));
      ctx.lineTo(...P(x, -len));
      ctx.lineTo(...P(x + w, -len + 3.2));
      ctx.lineTo(...P(x + w, 1.2));
      ctx.closePath();
    };
    outlined(tine(-5.2, 9.2, 1.45), '#d62a24', '#2e0509', 1.7);
    outlined(tine(5.2, 9.2, 1.45), '#d62a24', '#2e0509', 1.7);
    outlined(tine(0, 12.4, 1.6), '#ff4a36', '#2e0509', 1.7);

    // Collar joining the tines.
    outlined(() => {
      ctx.beginPath();
      ctx.moveTo(...P(-7, 0.2));
      ctx.lineTo(...P(7, 0.2));
      ctx.lineTo(...P(7, 3.0));
      ctx.lineTo(...P(-7, 3.0));
      ctx.closePath();
    }, '#b8211c', '#2e0509', 1.7);

    // Haft.
    outlined(() => {
      ctx.beginPath();
      ctx.moveTo(...P(-1.7, 2.6));
      ctx.lineTo(...P(1.7, 2.6));
      ctx.lineTo(...P(1.7, 15.5));
      ctx.lineTo(...P(-1.7, 15.5));
      ctx.closePath();
    }, '#9c1a17', '#2e0509', 1.7);
  } else {
    // A plain gold pointer.
    outlined(() => {
      ctx.beginPath();
      ctx.moveTo(...P(3, 2.4));
      ctx.lineTo(...P(3, 17.6));
      ctx.lineTo(...P(6.9, 14.0));
      ctx.lineTo(...P(9.5, 20.2));
      ctx.lineTo(...P(12.1, 19.0));
      ctx.lineTo(...P(9.6, 13.1));
      ctx.lineTo(...P(14.7, 12.6));
      ctx.closePath();
    }, goldGradient(ctx, ...P(3, 2), ...P(15, 20)), '#4a3410', 2.1);
  }

  ctx.restore();
  return c.toDataURL();
}

const cursorCache = {};

/** The full CSS cursor value, hotspot included. */
export function cursorFor(kind) {
  if (!cursorCache[kind]) {
    const hot = CURSOR_HOTSPOT[kind] || [2, 2];
    cursorCache[kind] = 'url(' + makeCursor(kind) + ') ' + hot[0] + ' ' + hot[1] + ', auto';
  }
  return cursorCache[kind];
}
