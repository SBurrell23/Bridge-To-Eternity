// One uniform interface for the UI, whether this browser is running the game
// (host) or watching someone else's (client).

import { Engine, DEFAULT_SETTINGS } from '../game/engine.js';
import { NetHost, NetClient, randomCode } from './net.js';

class Emitter {
  constructor() { this.handlers = {}; }
  on(name, fn) {
    (this.handlers[name] = this.handlers[name] || []).push(fn);
    return this;
  }
  emit(name, ...args) {
    for (const fn of this.handlers[name] || []) {
      try { fn(...args); } catch (err) { console.error('[session]', name, err); }
    }
  }
}

const MAX_CHAT = 60;

export class HostSession extends Emitter {
  constructor(name, settings) {
    super();
    this.isHost = true;
    this.localId = 'host';
    this.name = name;
    this.engine = new Engine({ ...DEFAULT_SETTINGS, ...settings });
    this.net = new NetHost();
    this.chat = [];
    this.code = null;
    this.pending = new Map();     // peerId -> true until they say hello
    this.timer = null;

    this.engine.onPrivate = (pid, msg) => this.sendPrivate(pid, msg);
    this.engine.onSfx = (sfx) => {
      this.net.broadcast({ t: 'sfx', name: sfx });
      this.emit('sfx', sfx);
    };
  }

  async start(preferredCode) {
    this.engine.addPlayer(this.localId, this.name, true);
    this.code = await this.net.start(preferredCode || randomCode());

    this.net.on('connect', (peerId) => {
      this.pending.set(peerId, Date.now());
    });
    this.net.on('message', (peerId, msg) => this.onMessage(peerId, msg));
    this.net.on('disconnect', (peerId) => {
      const p = this.engine.state.players[peerId];
      if (p) {
        this.pushChat(null, p.name + ' has drifted away.', 'system');
        this.engine.setConnected(peerId, false);
      }
      this.pending.delete(peerId);
      this.emit('sfx', 'leave');
      this.net.broadcast({ t: 'sfx', name: 'leave' });
      this.broadcast();
    });
    this.net.on('error', (err) => this.emit('error', err.message || String(err)));
    this.net.on('warn', (err) => console.warn('[host]', err));

    this.timer = setInterval(() => {
      if (this.engine.tick()) this.broadcast();
    }, 300);

    this.broadcast();
    return this.code;
  }

  onMessage(peerId, msg) {
    if (!msg || typeof msg !== 'object') return;

    if (msg.t === 'hello') {
      const s = this.engine.state;
      if (s.players[peerId]) {
        this.engine.setConnected(peerId, true);
      } else if (s.phase !== 'lobby') {
        this.net.send(peerId, { t: 'denied', reason: 'That bridge is already being built. Wait for the next game.' });
        setTimeout(() => this.net.kick(peerId), 500);
        return;
      } else if (this.engine.playerCount >= 10) {
        this.net.send(peerId, { t: 'denied', reason: 'The lobby is full.' });
        setTimeout(() => this.net.kick(peerId), 500);
        return;
      } else {
        this.engine.addPlayer(peerId, msg.name, false);
        this.pushChat(null, (msg.name || 'A pilgrim') + ' steps onto the cloud.', 'system');
      }
      this.pending.delete(peerId);
      this.emit('sfx', 'join');
      this.net.broadcast({ t: 'sfx', name: 'join' });
      this.broadcast();
      return;
    }

    if (msg.t === 'chat') {
      const p = this.engine.state.players[peerId];
      if (!p) return;
      this.pushChat(p, String(msg.text || '').slice(0, 200), 'player');
      this.broadcast();
      return;
    }

    if (msg.t === 'rename') {
      this.engine.rename(peerId, msg.name);
      this.broadcast();
      return;
    }

    if (msg.t === 'intent') {
      const res = this.engine.handle(peerId, msg.action);
      if (res && res.error) {
        this.net.send(peerId, { t: 'reject', reason: res.error });
      } else {
        this.broadcast();
      }
      return;
    }
  }

  pushChat(player, text, kind) {
    this.chat.push({
      id: Math.random().toString(36).slice(2),
      name: player ? player.name : null,
      color: player ? player.color : null,
      text,
      kind,
      t: Date.now(),
    });
    if (this.chat.length > MAX_CHAT) this.chat.shift();
  }

  sendPrivate(playerId, msg) {
    if (playerId === this.localId) this.emit('private', msg);
    else this.net.send(playerId, { t: 'private', msg });
  }

  broadcast() {
    for (const pid of this.engine.state.order) {
      const view = this.engine.viewFor(pid);
      view.chat = this.chat;
      view.code = this.code;
      if (pid === this.localId) this.emit('view', view);
      else this.net.send(pid, { t: 'view', view });
    }
    // Anyone mid-handshake still deserves to see the lobby.
    for (const [peerId] of this.pending) {
      const view = this.engine.viewFor(null);
      view.chat = this.chat;
      view.code = this.code;
      this.net.send(peerId, { t: 'view', view });
    }
  }

  // -- commands from the local UI ----------------------------------------
  intent(action) {
    const res = this.engine.handle(this.localId, action);
    if (res && res.error) this.emit('reject', res.error);
    else this.broadcast();
    return res;
  }

  say(text) {
    const p = this.engine.state.players[this.localId];
    this.pushChat(p, String(text).slice(0, 200), 'player');
    this.broadcast();
  }

  setSettings(patch) {
    Object.assign(this.engine.settings, patch);
    this.engine.state.maxRounds = this.engine.settings.rounds;
    this.broadcast();
  }

  startGame() {
    const res = this.engine.startGame();
    if (res.error) this.emit('reject', res.error);
    this.broadcast();
    return res;
  }

  nextRound() {
    this.engine.nextRound();
    this.broadcast();
  }

  backToLobby() {
    this.engine.returnToLobby();
    this.broadcast();
  }

  kick(playerId) {
    if (playerId === this.localId) return;
    this.net.send(playerId, { t: 'denied', reason: 'The host has removed you from the room.' });
    setTimeout(() => this.net.kick(playerId), 300);
    this.engine.removePlayer(playerId);
    this.broadcast();
  }

  leave() {
    if (this.timer) clearInterval(this.timer);
    this.net.broadcast({ t: 'denied', reason: 'The host has closed the room.' });
    setTimeout(() => this.net.destroy(), 200);
  }

  placementsFor(cardId) {
    return this.engine.placementsFor(this.localId, cardId);
  }
}

export class ClientSession extends Emitter {
  constructor(name) {
    super();
    this.isHost = false;
    this.name = name;
    this.net = new NetClient();
    this.localId = null;
    this.code = null;
    this.lastView = null;
  }

  async start(code) {
    await this.net.connect(code);
    this.code = code;

    this.net.on('message', (msg) => {
      if (!msg || typeof msg !== 'object') return;
      switch (msg.t) {
        case 'view':
          this.lastView = msg.view;
          if (msg.view.you) this.localId = msg.view.you.id;
          this.emit('view', msg.view);
          break;
        case 'private': this.emit('private', msg.msg); break;
        case 'sfx':     this.emit('sfx', msg.name); break;
        case 'reject':  this.emit('reject', msg.reason); break;
        case 'denied':
          this.emit('denied', msg.reason);
          break;
        default: break;
      }
    });
    this.net.on('close', () => this.emit('closed'));
    this.net.on('warn', (err) => console.warn('[client]', err));

    this.net.send({ t: 'hello', name: this.name });
  }

  intent(action) { this.net.send({ t: 'intent', action }); }
  say(text) { this.net.send({ t: 'chat', text: String(text).slice(0, 200) }); }
  setSettings() { /* host only */ }
  startGame() { /* host only */ }
  nextRound() { this.net.send({ t: 'intent', action: { t: 'next' } }); }
  backToLobby() { /* host only */ }
  kick() { /* host only */ }
  leave() { this.net.destroy(); }

  /**
   * Clients compute legal cells locally from the public board -- the host still
   * validates every placement, so this is only a convenience for highlighting.
   */
  placementsFor(cardId) {
    const v = this.lastView;
    if (!v || !v.you) return [];
    const card = v.you.hand.find((c) => c.id === cardId);
    if (!card || card.type !== 'path') return [];
    const b = v.you.broken;
    if (b.halo || b.wings || b.hammer) return [];
    return localPlacements(v.tiles, card);
  }
}

// Imported lazily to keep the client bundle honest about where rules live.
import { legalPlacements } from '../game/board.js';
function localPlacements(tilesView, card) {
  const tiles = {};
  for (const [k, t] of Object.entries(tilesView)) {
    tiles[k] = {
      kind: t.kind,
      edges: t.edges,
      passable: t.passable,
      revealed: t.revealed,
      isGold: t.isGold,
      goalIndex: t.goalIndex,
    };
  }
  return legalPlacements(tiles, card);
}
