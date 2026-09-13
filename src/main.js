// Bridge To Eternity -- application shell: renderer, loop, input and the glue
// between the network session and everything the player sees.

import * as THREE from 'three';

import { World, HORIZON_COLOR } from './render/scene.js';
import { BoardView, BOARD_CENTER, cellToWorld, TILE } from './render/boardview.js';
import { BoardCamera } from './render/camera.js';
import { HandView } from './render/handview.js';
import { audio } from './audio/audio.js';
import { cursorFor } from './render/cardart.js';
import { HostSession, ClientSession } from './net/session.js';
import { settings, saveSettings, qualityOf, openSettingsModal } from './ui/settings.js';
import { Hud, openHelp } from './ui/hud.js';
import { Menu } from './ui/menu.js';
import {
  $, toast, banner, clearBanner, setScreen, openModal, closeModal, isModalOpen, initTooltips,
} from './ui/dom.js';
import { GOAL_CELLS, key as cellKey } from './game/board.js';
import { cardTitle } from './game/cards.js';

const app = {
  renderer: null,
  world: null,
  board: null,
  hand: null,
  cam: null,
  session: null,
  view: null,
  sel: null,            // { cardId, card, mode, rotated, tools }
  placements: [],
  hoverCell: null,
  raycaster: new THREE.Raycaster(),
  ndc: new THREE.Vector2(),
  lastFrame: 0,
  lastRender: 0,
  fps: 0,
  fpsAccum: 0,
  fpsFrames: 0,
  shownRoleForRound: 0,
  running: true,
};

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function boot() {
  await waitForFonts();

  buildRenderer();
  app.world = new World(qualityOf());
  app.world.setShadows(settings.shadows);
  app.board = new BoardView(app.world.scene, qualityOf());
  app.hand = new HandView();
  app.cam = new BoardCamera(BOARD_CENTER.clone());
  app.cam.setHome(new THREE.Vector3(4 * TILE, 0, 0));
  app.cam.resetView(true);
  app.cam.shouldIgnore = (e) => !!handHit(e);
  app.cam.onClick = (e) => onBoardClick(e);

  app.hud = new Hud({
    onDiscard: () => discardSelected(),
    onCancel: () => clearSelection(),
    onRotate: () => rotateSelection(),
    onPickPlayer: (id) => pickPlayer(id),
    onPickTool: (tool) => pickTool(tool),
    onNextRound: () => app.session && app.session.nextRound(),
    onBackToLobby: () => app.session && app.session.backToLobby(),
    onLeave: () => confirmLeave(),
    onResetCamera: () => app.cam.resetView(),
    onChat: (text) => app.session && app.session.say(text),
  });

  app.menu = new Menu({
    onHost: (name) => hostGame(name),
    onJoin: (code, name) => joinGame(code, name),
    onStart: () => app.session && app.session.startGame(),
    onLeave: () => confirmLeave(),
    onChat: (text) => app.session && app.session.say(text),
    onSetting: (k, v) => app.session && app.session.setSettings({ [k]: v }),
    onKick: (id) => app.session && app.session.kick(id),
    onAddBot: () => {
      if (!app.session) return;
      const res = app.session.addBot();
      if (res && res.error) toast(res.error, 'bad');
      else audio.play('join');
    },
    onOpenSettings: () => openSettings(),
  });

  $('#btn-settings').addEventListener('click', () => openSettings());
  initTooltips();
  bindInput();
  onResize();
  window.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', () => {
    app.lastFrame = performance.now();
  });

  setScreen('title');
  applyCursor();
  requestAnimationFrame(loop);

  const loading = $('#loading');
  loading.classList.add('gone');
  setTimeout(() => loading.remove(), 800);
}

function waitForFonts() {
  if (!document.fonts || !document.fonts.load) return Promise.resolve();
  return Promise.all([
    document.fonts.load('700 40px Cinzel'),
    document.fonts.load('900 40px Cinzel'),
    document.fonts.load('400 30px "EB Garamond"'),
  ]).catch(() => {});
}

function buildRenderer() {
  const old = document.getElementById('gl');
  const canvas = document.createElement('canvas');
  canvas.id = 'gl';
  if (old) old.replaceWith(canvas);
  else document.body.prepend(canvas);

  if (app.renderer) app.renderer.dispose();
  const r = new THREE.WebGLRenderer({
    canvas,
    antialias: settings.antialias,
    alpha: false,
    powerPreference: 'high-performance',
    stencil: false,
  });
  r.autoClear = false;
  r.setClearColor(HORIZON_COLOR, 1);
  r.shadowMap.enabled = settings.shadows;
  r.shadowMap.type = THREE.PCFSoftShadowMap;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 0.86;
  app.renderer = r;
  applyResolution();
}

function applyResolution() {
  const base = Math.min(window.devicePixelRatio || 1, 2);
  app.renderer.setPixelRatio(Math.max(0.4, Math.min(3, base * settings.resolution)));
  const w = window.innerWidth;
  const h = window.innerHeight;
  app.renderer.setSize(w, h, false);
}

// ---------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, (now - app.lastFrame) / 1000 || 0);
  app.lastFrame = now;

  if (settings.fpsCap > 0) {
    const minGap = 1000 / settings.fpsCap - 1.2;
    if (now - app.lastRender < minGap) return;
  }
  const rdt = Math.min(0.1, (now - app.lastRender) / 1000 || dt);
  app.lastRender = now;

  frame(rdt);

  app.fpsAccum += rdt;
  app.fpsFrames += 1;
  if (app.fpsAccum >= 0.5) {
    app.fps = Math.round(app.fpsFrames / app.fpsAccum);
    app.fpsAccum = 0;
    app.fpsFrames = 0;
    updateFpsCounter();
  }
}

/** Advance and draw exactly one frame. Split out so it can be driven by hand. */
function frame(dt) {
  app.world.update(dt, app.cam.camera);
  app.board.update(dt);
  app.hand.update(dt);
  app.cam.update(dt);
  if (app.hud) app.hud.updateTimer();

  const r = app.renderer;
  r.clear();
  r.render(app.world.scene, app.cam.camera);
  r.clearDepth();
  r.render(app.hand.scene, app.hand.camera);
}

let fpsNode = null;
function updateFpsCounter() {
  if (!settings.showFps) {
    if (fpsNode) { fpsNode.remove(); fpsNode = null; }
    return;
  }
  if (!fpsNode) {
    fpsNode = document.createElement('div');
    Object.assign(fpsNode.style, {
      position: 'fixed', bottom: '6px', right: '10px', zIndex: 50,
      font: '12px ui-monospace, monospace', color: 'rgba(240,205,125,0.75)',
      pointerEvents: 'none', textShadow: '0 1px 3px rgba(0,0,0,0.8)',
    });
    document.body.appendChild(fpsNode);
  }
  fpsNode.textContent = app.fps + ' fps';
}

function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  applyResolution();
  app.cam.resize(w, h);
  app.hand.resize(w, h);
  document.documentElement.style.setProperty('--hand-h', Math.round(app.hand.stripHeight) + 'px');
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
function canvasRect() {
  return app.renderer.domElement.getBoundingClientRect();
}

function handHit(e) {
  if (!app.view || app.view.phase !== 'playing') return null;
  if (!e || e.target.id !== 'gl') return null;
  return app.hand.hitTest(e.clientX, e.clientY, canvasRect());
}

function updateNdc(e) {
  const rect = canvasRect();
  app.ndc.set(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1,
  );
  app.raycaster.setFromCamera(app.ndc, app.cam.camera);
}

function bindInput() {
  document.addEventListener('pointerdown', (e) => {
    if (e.target.id !== 'gl') return;
    audio.init();
    const id = handHit(e);
    if (id) {
      e.preventDefault();
      selectCard(id);
    }
  });

  document.addEventListener('pointermove', (e) => {
    if (!app.view) return;
    const overHand = e.target.id === 'gl' ? app.hand.hitTest(e.clientX, e.clientY, canvasRect()) : null;
    app.hand.setHover(overHand);

    if (!overHand && app.sel && (app.sel.mode === 'path' || app.sel.mode === 'tile' || app.sel.mode === 'gate')) {
      updateNdc(e);
      const cell = app.board.pickCell(app.raycaster);
      app.hoverCell = cell;
      if (app.sel.mode === 'path') {
        const ok = cell && app.placements.some((p) => p.x === cell.x && p.y === cell.y && p.rotated === app.sel.rotated);
        app.board.setGhost(cell ? app.sel.card : null, app.sel.rotated, cell, ok);
      }
    } else {
      app.hoverCell = null;
      if (app.sel && app.sel.mode === 'path') app.board.setGhost(null);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    if (e.key === 'Escape') {
      if (isModalOpen()) return;
      if (app.sel) clearSelection();
      else if (app.view) openSettings();
      else openSettings();
      return;
    }
    if (isModalOpen()) return;

    if (e.key === 'r' || e.key === 'R') {
      if (app.sel && app.sel.mode === 'path') rotateSelection();
      else app.cam.resetView();
      return;
    }
    if (e.key === 'h' || e.key === 'H') { openHelp(); return; }
    if (e.key === 'Enter' && app.view && app.view.phase !== 'lobby') {
      const input = $('#chat-input');
      const tab = document.querySelector('#log-panel .tab[data-tab="chat"]');
      if (tab) tab.click();
      if (input) input.focus();
      return;
    }
    if (/^[1-9]$/.test(e.key)) {
      const idx = Number(e.key) - 1;
      const hand = app.view && app.view.you ? app.view.you.hand : [];
      if (hand[idx]) selectCard(hand[idx].id);
    }
  });
}

// ---------------------------------------------------------------------------
// Selection state machine
// ---------------------------------------------------------------------------
function myTurn() {
  return !!(app.view && app.view.phase === 'playing' && app.view.you
    && app.view.currentPlayerId === app.view.you.id);
}

function selectCard(cardId) {
  if (!myTurn()) {
    toast('Wait for your turn.', 'bad', 1600);
    audio.play('error');
    return;
  }
  if (app.sel && app.sel.cardId === cardId) { clearSelection(); return; }

  const card = app.view.you.hand.find((c) => c.id === cardId);
  if (!card) return;

  const broken = app.view.you.broken;
  const cursed = broken.halo || broken.wings || broken.hammer;

  let mode = null;
  let blockedWhy = '';
  if (card.type === 'path') {
    // A cursed pilgrim may still pick up a span -- only to cast it away.
    mode = cursed ? 'blocked' : 'path';
    if (cursed) blockedWhy = 'your blessings are broken';
  } else if (card.action === 'break') {
    mode = 'player';
    if (!app.view.players.some((p) => !p.broken[card.tool])) {
      mode = 'blocked';
      blockedWhy = 'every pilgrim has already lost that blessing';
    }
  } else if (card.action === 'repair') {
    mode = 'player';
    if (!app.view.players.some((p) => card.tools.some((t) => p.broken[t]))) {
      mode = 'blocked';
      blockedWhy = 'nobody has that blessing broken';
    }
  } else if (card.action === 'smite') {
    mode = 'tile';
    if (!Object.values(app.view.tiles).some((t) => t.kind === 'path')) {
      mode = 'blocked';
      blockedWhy = 'no span has been laid yet';
    }
  } else if (card.action === 'reveal') {
    mode = 'gate';
    if (!GOAL_CELLS.some((c) => {
      const t = app.view.tiles[cellKey(c.x, c.y)];
      return t && !t.revealed;
    })) {
      mode = 'blocked';
      blockedWhy = 'every Gate is already open';
    }
  }

  app.sel = { cardId, card, mode, rotated: false, tools: card.tools || [], blockedWhy };
  audio.play('select');
  app.hand.setSelected(cardId);
  app.hand.setRotation(false);
  refreshSelectionVisuals();
}

function clearSelection() {
  if (!app.sel) return;
  app.sel = null;
  app.hand.aiming = false;
  app.hand.setSelected(null);
  app.board.setGhost(null);
  app.board.clearMarkers();
  app.placements = [];
  app.hud.setSelection(null);
}

function rotateSelection() {
  if (!app.sel || app.sel.mode !== 'path') return;
  app.sel.rotated = !app.sel.rotated;
  app.hand.setRotation(app.sel.rotated);
  audio.play('rotate');
  refreshSelectionVisuals();
}

/** Angel wings by default; a pitchfork once you know you are one of the Fallen. */
function applyCursor() {
  const role = app.view && app.view.you ? app.view.you.role : null;
  const kind = role === 'fallen' ? 'fallen' : 'builder';
  if (app.cursorKind === kind) return;
  app.cursorKind = kind;
  document.body.style.cursor = cursorFor(kind);
}

function refreshSelectionVisuals() {
  const sel = app.sel;
  app.hud.setSelection(sel);
  // Aiming at the board: stow the rest of the hand so it cannot eat the click.
  app.hand.aiming = !!(sel && sel.mode !== 'player' && sel.mode !== 'tool');
  if (!sel) return;

  if (sel.mode === 'path') {
    app.placements = app.session ? app.session.placementsFor(sel.cardId) : [];
    const cells = [];
    const seen = new Set();
    for (const p of app.placements) {
      const k = p.x + ',' + p.y;
      if (!seen.has(k)) { seen.add(k); cells.push({ x: p.x, y: p.y }); }
    }
    app.board.setMarkers(cells, 'place');
    if (!cells.length) toast('This span joins nowhere. Cast it away, or pick another.', 'bad', 3000);
    if (app.hoverCell) {
      const ok = app.placements.some((p) => p.x === app.hoverCell.x && p.y === app.hoverCell.y && p.rotated === sel.rotated);
      app.board.setGhost(sel.card, sel.rotated, app.hoverCell, ok);
    }
  } else if (sel.mode === 'tile') {
    const cells = Object.keys(app.view.tiles)
      .filter((k) => app.view.tiles[k].kind === 'path')
      .map((k) => {
        const [x, y] = k.split(',').map(Number);
        return { x, y };
      });
    app.board.setMarkers(cells, 'smite');
  } else if (sel.mode === 'gate') {
    const cells = GOAL_CELLS.filter((c) => {
      const t = app.view.tiles[cellKey(c.x, c.y)];
      return t && !t.revealed;
    });
    app.board.setMarkers(cells, 'gate');
  } else {
    app.board.setMarkers([], 'place');
  }
}

function onBoardClick(e) {
  if (!app.view || app.view.phase !== 'playing') return;
  if (!app.sel) return;
  if (!myTurn()) return;
  updateNdc(e);
  const cell = app.board.pickCell(app.raycaster);
  if (!cell) return;

  const sel = app.sel;
  if (sel.mode === 'path') {
    const ok = app.placements.some((p) => p.x === cell.x && p.y === cell.y && p.rotated === sel.rotated);
    if (!ok) {
      const other = app.placements.some((p) => p.x === cell.x && p.y === cell.y);
      toast(other ? 'It would fit the other way round — press R.' : 'That span will not join the bridge there.', 'bad');
      audio.play('error');
      return;
    }
    send({ t: 'playPath', cardId: sel.cardId, x: cell.x, y: cell.y, rotated: sel.rotated });
  } else if (sel.mode === 'tile') {
    const tile = app.view.tiles[cellKey(cell.x, cell.y)];
    if (!tile || tile.kind !== 'path') {
      toast('Only a laid span may be smitten.', 'bad');
      audio.play('error');
      return;
    }
    send({ t: 'playAction', cardId: sel.cardId, x: cell.x, y: cell.y });
  } else if (sel.mode === 'gate') {
    const gi = GOAL_CELLS.findIndex((c) => c.x === cell.x && c.y === cell.y);
    if (gi < 0) return;
    const tile = app.view.tiles[cellKey(cell.x, cell.y)];
    if (!tile || tile.revealed) {
      toast('That Gate is already open for all to see.', 'bad');
      audio.play('error');
      return;
    }
    send({ t: 'playAction', cardId: sel.cardId, goalIndex: gi });
  }
}

function pickPlayer(playerId) {
  const sel = app.sel;
  if (!sel || sel.mode !== 'player') return;
  const card = sel.card;
  if (card.action === 'repair' && card.tools.length > 1) {
    const target = app.view.players.find((p) => p.id === playerId);
    const broken = card.tools.filter((t) => target.broken[t]);
    if (broken.length > 1) {
      app.sel = { ...sel, mode: 'tool', targetId: playerId, tools: broken };
      app.hud.setSelection(app.sel);
      return;
    }
    send({ t: 'playAction', cardId: sel.cardId, targetId: playerId, tool: broken[0] });
    return;
  }
  send({ t: 'playAction', cardId: sel.cardId, targetId: playerId, tool: card.tools ? card.tools[0] : undefined });
}

function pickTool(tool) {
  const sel = app.sel;
  if (!sel || sel.mode !== 'tool') return;
  send({ t: 'playAction', cardId: sel.cardId, targetId: sel.targetId, tool });
}

function discardSelected() {
  if (!app.sel) return;
  send({ t: 'discard', cardId: app.sel.cardId });
}

function send(action) {
  if (!app.session) return;
  app.session.intent(action);
  clearSelection();
}

// ---------------------------------------------------------------------------
// Session wiring
// ---------------------------------------------------------------------------
function attachSession(session) {
  app.session = session;

  session.on('view', (view) => onView(view));
  session.on('sfx', (name) => audio.play(name));
  session.on('private', (msg) => {
    if (msg.t === 'peek') {
      const cell = GOAL_CELLS[msg.goalIndex];
      const where = cell.y < 0 ? 'North Gate' : cell.y > 0 ? 'South Gate' : 'Middle Gate';
      banner(msg.isGold ? 'GOLD lies beyond' : 'Only stone', !msg.isGold, 2400);
      toast('The ' + where + ' hides ' + (msg.isGold ? 'the Gate of Gold.' : 'nothing but stone.'),
        msg.isGold ? 'good' : '', 5000);
    }
  });
  session.on('reject', (reason) => {
    toast(reason, 'bad');
    audio.play('error');
    clearSelection();
  });
  session.on('error', (reason) => toast(reason, 'bad', 5000));
  session.on('denied', (reason) => {
    endSession();
    app.menu.showTitle();
    app.menu.setStatus(reason, true);
  });
  session.on('closed', () => {
    endSession();
    app.menu.showTitle();
    app.menu.setStatus('The room closed.', true);
    toast('The host closed the room.', 'bad', 5000);
  });
}

function onView(view) {
  const prev = app.view;
  app.view = view;

  if (view.phase === 'lobby') {
    app.board.clear();
    app.hand.clear();
    app.shownRoleForRound = 0;
    app.menu.showLobby(view);
    return;
  }

  if (!prev || prev.phase === 'lobby') {
    setScreen('game');
    closeModal();
    app.cam.setHome(new THREE.Vector3(4 * TILE, 0, 0));
    app.cam.resetView(true);
  }

  // Board + hand.
  const colors = {};
  for (const p of view.players) colors[p.id] = p.color;
  app.board.setPlayerColors(colors);
  app.board.sync(view.tiles, view.connected);
  app.hand.setCards(view.you ? view.you.hand : []);
  app.hand.dimmed = !myTurn();
  app.hand.setEnabled(view.phase === 'playing');
  document.documentElement.style.setProperty('--hand-h', Math.round(app.hand.stripHeight) + 'px');

  // A card we were aiming may have left our hand.
  if (app.sel && view.you && !view.you.hand.some((c) => c.id === app.sel.cardId)) clearSelection();
  else if (app.sel) refreshSelectionVisuals();

  app.hud.update(view);
  applyCursor();

  // Round ceremonies.
  if (view.phase === 'playing' && view.round !== app.shownRoleForRound && view.you && view.you.role) {
    app.shownRoleForRound = view.round;
    banner('Round ' + view.round, false, 2000);
    app.hud.showRoleReveal(view.you.role, () => {});
  }

  if (prev && prev.currentPlayerId !== view.currentPlayerId) {
    if (myTurn()) {
      audio.play('turn');
      banner('Your move', false, 1400);
    } else {
      // Don't leave "Your move" hanging over somebody else's turn.
      clearBanner();
    }
  }

  if (view.phase === 'roundEnd' && (!prev || prev.phase !== 'roundEnd')) {
    const builders = view.roundResult.winner === 'builders';
    banner(builders ? 'The Gate Opens' : 'The Bridge Fails', !builders, 3200);
    app.board.setGhost(null);
    app.board.clearMarkers();
    clearSelection();
  }
}

async function hostGame(name) {
  audio.init();
  startMusic();
  app.menu.setBusy(true, 'Opening a room in the clouds…');
  const session = new HostSession(name, {});
  // Subscribe before starting: the host broadcasts its first view from start().
  attachSession(session);
  try {
    const code = await session.start();
    app.menu.setBusy(false);
    app.menu.setStatus('');
    toast('Room ' + code + ' is open.', 'good');
  } catch (err) {
    app.session = null;
    app.menu.setBusy(false);
    app.menu.setStatus(friendlyNetError(err), true);
  }
}

async function joinGame(code, name) {
  audio.init();
  startMusic();
  app.menu.setBusy(true, 'Reaching for room ' + code + '…');
  const session = new ClientSession(name);
  attachSession(session);
  try {
    await session.start(code);
    app.menu.setBusy(false);
    app.menu.setStatus('');
  } catch (err) {
    app.session = null;
    app.menu.setBusy(false);
    app.menu.setStatus(friendlyNetError(err), true);
  }
}

function friendlyNetError(err) {
  const msg = (err && (err.message || err.type)) || String(err);
  if (/peer-unavailable|No room/i.test(msg)) return 'No room with that code is open.';
  if (/browser|webrtc/i.test(msg)) return 'This browser cannot make peer connections.';
  if (/network|server/i.test(msg)) return 'Could not reach the matchmaking server. Check your connection.';
  return msg;
}

function endSession() {
  if (app.session) {
    try { app.session.leave(); } catch (err) { /* already gone */ }
  }
  app.session = null;
  app.view = null;
  app.sel = null;
  app.shownRoleForRound = 0;
  app.board.clear();
  app.hand.clear();
  closeModal();
}

function confirmLeave() {
  openModal({
    title: 'Step off the cloud?',
    body: '<p>Leaving ends the game for you. If you are the host, the room closes for everyone.</p>',
    actions: [
      { label: 'Stay' },
      {
        label: 'Leave',
        primary: true,
        onClick: () => {
          endSession();
          app.menu.showTitle();
        },
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
function startMusic() {
  audio.applySettings({
    master: settings.master, sfx: settings.sfx, music: settings.music, muted: settings.muted,
  });
  audio.startMusic('assets/music/celestial-drift.mp3');
}

function openSettings() {
  openSettingsModal((changedKey) => {
    audio.applySettings({
      master: settings.master, sfx: settings.sfx, music: settings.music, muted: settings.muted,
    });
    if (changedKey === 'antialias' || changedKey === 'preset') rebuildRendererIfNeeded();
    applyResolution();
    app.renderer.shadowMap.enabled = settings.shadows;
    app.world.applyQuality(qualityOf());
    app.board.quality = qualityOf();
    updateFpsCounter();
    saveSettings();
  });
}

let lastAntialias = null;
function rebuildRendererIfNeeded() {
  if (lastAntialias === null) lastAntialias = settings.antialias;
  if (lastAntialias === settings.antialias) return;
  lastAntialias = settings.antialias;
  buildRenderer();
  app.renderer.shadowMap.enabled = settings.shadows;
  onResize();
  toast('Anti-aliasing ' + (settings.antialias ? 'on' : 'off') + '.', '', 1600);
}

// ---------------------------------------------------------------------------
boot().catch((err) => {
  console.error(err);
  const loading = $('#loading');
  if (loading) {
    loading.innerHTML = '<div class="loading-inner"><p style="max-width:32em;text-align:center;line-height:1.6">'
      + 'The clouds would not gather.<br>' + String(err && err.message ? err.message : err) + '</p></div>';
  }
});

// Exposed for quick console poking during development.
app.frame = frame;
window.__bte = app;
export { app, cardTitle };
