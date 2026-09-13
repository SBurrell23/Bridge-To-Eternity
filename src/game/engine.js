// Authoritative game engine. Only the host runs this; clients send intents and
// receive tailored views that never contain another player's secrets.

import {
  buildDeck, buildGraceDeck, handSizeFor, ROLE_TABLE, FALLEN_PAYOUT,
  TOOL_INFO, cardEdges,
} from './cards.js';
import {
  createBoard, key, canPlace, computeConnected, revealReachedGoals,
  legalPlacements, GOAL_CELLS,
} from './board.js';
import { makeRng, randomSeed, shuffle } from '../util/rng.js';

export const PLAYER_COLORS = [
  '#ffd76a', '#7fd8ff', '#ff9ad5', '#9cff8f', '#ffa36a',
  '#c5a3ff', '#7affd0', '#ff7f7f', '#e6e6e6', '#b9ff5c',
];

export const DEFAULT_SETTINGS = {
  rounds: 3,
  turnSeconds: 0,       // 0 = untimed
  handSize: 0,          // 0 = automatic by player count
  fallenCount: 0,       // 0 = automatic by player count
  noDeadEnds: false,
  revealRoles: true,    // show everyone's allegiance at round end
  botSkill: 'steady',   // meek | steady | cunning
};

const MAX_LOG = 120;

export class Engine {
  constructor(settings = {}) {
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.rng = makeRng(randomSeed());
    this.state = {
      phase: 'lobby',
      round: 0,
      maxRounds: this.settings.rounds,
      players: {},
      order: [],
      turnIndex: 0,
      tiles: {},
      deck: [],
      discardCount: 0,
      graceDeck: [],
      log: [],
      turnEndsAt: null,
      roundResult: null,
      gameResult: null,
    };
    this.peeks = {};        // playerId -> { goalIndex: isGold }
    this.onPrivate = () => {};
    this.onSfx = () => {};
  }

  // -- players ------------------------------------------------------------
  addPlayer(id, name, isHost = false, isBot = false) {
    const s = this.state;
    if (s.players[id]) {
      s.players[id].connected = true;
      return s.players[id];
    }
    const used = new Set(Object.values(s.players).map((p) => p.color));
    const color = PLAYER_COLORS.find((c) => !used.has(c)) || '#ffffff';
    const p = {
      id,
      name: (name || 'Pilgrim').slice(0, 16),
      color,
      isHost,
      isBot,
      connected: true,
      role: null,
      hand: [],
      broken: { halo: false, wings: false, hammer: false },
      grace: 0,
      roundGrace: 0,
    };
    s.players[id] = p;
    s.order.push(id);
    return p;
  }

  setConnected(id, connected) {
    const p = this.state.players[id];
    if (!p) return;
    p.connected = connected;
    if (!connected && this.state.phase === 'lobby') {
      delete this.state.players[id];
      this.state.order = this.state.order.filter((x) => x !== id);
    }
  }

  removePlayer(id) {
    delete this.state.players[id];
    this.state.order = this.state.order.filter((x) => x !== id);
  }

  rename(id, name) {
    const p = this.state.players[id];
    if (p) p.name = (name || 'Pilgrim').slice(0, 16);
  }

  get playerCount() {
    return this.state.order.length;
  }

  // -- logging ------------------------------------------------------------
  log(text, kind = 'info', extra = {}) {
    this.state.log.push({ t: Date.now(), text, kind, ...extra });
    if (this.state.log.length > MAX_LOG) this.state.log.shift();
  }

  // -- game / round lifecycle --------------------------------------------
  startGame() {
    const n = this.playerCount;
    if (n < 3) return { error: 'At least 3 pilgrims are needed.' };
    if (n > 10) return { error: 'At most 10 pilgrims.' };
    this.state.maxRounds = this.settings.rounds;
    this.state.graceDeck = buildGraceDeck(this.rng);
    for (const id of this.state.order) this.state.players[id].grace = 0;
    this.state.round = 0;
    this.state.gameResult = null;
    this.state.log = [];
    this.startRound();
    return { ok: true };
  }

  startRound() {
    const s = this.state;
    s.round += 1;
    s.roundResult = null;
    s.tiles = createBoard(Math.floor(this.rng() * 3));
    s.deck = buildDeck(this.rng, { noDeadEnds: this.settings.noDeadEnds });
    s.discardCount = 0;
    this.peeks = {};

    const n = this.playerCount;
    const table = ROLE_TABLE[n];
    const fallen = this.settings.fallenCount > 0
      ? Math.min(this.settings.fallenCount, n - 1)
      : table.fallen;

    // One role card always goes undealt, exactly as in the boxed game.
    const roles = [];
    for (let i = 0; i < fallen; i++) roles.push('fallen');
    while (roles.length < n + 1) roles.push('builder');
    const dealt = shuffle(roles, this.rng).slice(0, n);

    const hand = this.settings.handSize > 0 ? this.settings.handSize : handSizeFor(n);
    s.order.forEach((id, i) => {
      const p = s.players[id];
      p.role = dealt[i];
      p.broken = { halo: false, wings: false, hammer: false };
      p.hand = s.deck.splice(0, hand);
      p.roundGrace = 0;
    });

    s.turnIndex = Math.floor(this.rng() * n);
    s.phase = 'playing';
    this.log('Round ' + s.round + ' begins. The clouds part.', 'round');
    this.beginTurn();
  }

  beginTurn() {
    const s = this.state;
    if (s.phase !== 'playing') return;
    if (this.checkRoundOver()) return;
    // Skip anyone who has run dry.
    let guard = 0;
    while (guard++ <= s.order.length) {
      const p = s.players[s.order[s.turnIndex]];
      if (p && p.hand.length > 0) break;
      s.turnIndex = (s.turnIndex + 1) % s.order.length;
    }
    s.turnEndsAt = this.settings.turnSeconds > 0
      ? Date.now() + this.settings.turnSeconds * 1000
      : null;
  }

  advanceTurn() {
    const s = this.state;
    s.turnIndex = (s.turnIndex + 1) % s.order.length;
    this.beginTurn();
  }

  currentPlayerId() {
    return this.state.order[this.state.turnIndex];
  }

  checkRoundOver() {
    const s = this.state;
    const anyCards = s.order.some((id) => s.players[id].hand.length > 0);
    if (!anyCards) {
      this.endRound('fallen', null);
      return true;
    }
    return false;
  }

  // -- scoring ------------------------------------------------------------
  drawGrace(count) {
    const out = [];
    for (let i = 0; i < count; i++) {
      if (!this.state.graceDeck.length) this.state.graceDeck = buildGraceDeck(this.rng);
      out.push(this.state.graceDeck.shift());
    }
    return out;
  }

  endRound(winner, finderId) {
    const s = this.state;
    s.phase = 'roundEnd';
    s.turnEndsAt = null;

    const builders = s.order.filter((id) => s.players[id].role === 'builder');
    const fallen = s.order.filter((id) => s.players[id].role === 'fallen');
    const awards = [];

    if (winner === 'builders') {
      // The finder claims the richest share; the rest follow in seating order.
      const cards = this.drawGrace(builders.length).sort((a, b) => b.value - a.value);
      const startIdx = Math.max(0, builders.indexOf(finderId));
      const ordered = builders.slice(startIdx).concat(builders.slice(0, startIdx));
      ordered.forEach((id, i) => {
        const v = cards[i] ? cards[i].value : 1;
        s.players[id].grace += v;
        s.players[id].roundGrace = v;
        awards.push({ id, value: v });
      });
      this.log('The Gate of Gold is opened. The Builders cross over.', 'win');
    } else {
      const payout = FALLEN_PAYOUT[Math.min(4, Math.max(1, fallen.length))] || 0;
      fallen.forEach((id) => {
        s.players[id].grace += payout;
        s.players[id].roundGrace = payout;
        awards.push({ id, value: payout });
      });
      this.log('The bridge fails. The Fallen laugh in the dark.', 'lose');
    }

    s.roundResult = {
      winner,
      finderId,
      awards,
      roles: s.order.map((id) => ({ id, role: s.players[id].role })),
      goals: GOAL_CELLS.map((c, i) => {
        const t = s.tiles[key(c.x, c.y)];
        return { index: i, isGold: !!(t && t.isGold) };
      }),
      isFinalRound: s.round >= s.maxRounds,
    };

    // Everything is laid bare once the round is over.
    for (const c of GOAL_CELLS) {
      const t = s.tiles[key(c.x, c.y)];
      if (t) t.revealed = true;
    }

    if (s.round >= s.maxRounds) {
      const ranked = s.order
        .map((id) => ({ id, name: s.players[id].name, grace: s.players[id].grace }))
        .sort((a, b) => b.grace - a.grace);
      const top = ranked[0].grace;
      s.gameResult = {
        ranked,
        winners: ranked.filter((r) => r.grace === top).map((r) => r.id),
      };
    }
    this.onSfx(winner === 'builders' ? 'victory' : 'defeat');
  }

  nextRound() {
    if (this.state.phase !== 'roundEnd') return;
    if (this.state.round >= this.state.maxRounds) {
      this.state.phase = 'gameEnd';
      return;
    }
    this.startRound();
  }

  returnToLobby() {
    const s = this.state;
    s.phase = 'lobby';
    s.round = 0;
    s.tiles = {};
    s.roundResult = null;
    s.gameResult = null;
    s.turnEndsAt = null;
    s.log = [];
    for (const id of s.order) {
      const p = s.players[id];
      p.hand = [];
      p.role = null;
      p.grace = 0;
      p.roundGrace = 0;
      p.broken = { halo: false, wings: false, hammer: false };
    }
  }

  // -- turn actions -------------------------------------------------------
  draw(player) {
    if (this.state.deck.length) player.hand.push(this.state.deck.shift());
  }

  takeCard(player, cardId) {
    const i = player.hand.findIndex((c) => c.id === cardId);
    if (i === -1) return null;
    return player.hand.splice(i, 1)[0];
  }

  handle(playerId, msg) {
    const s = this.state;
    if (s.phase === 'roundEnd' || s.phase === 'gameEnd') {
      if (msg.t === 'next' && s.players[playerId] && s.players[playerId].isHost) {
        this.nextRound();
        return { ok: true };
      }
      return { error: 'The round is over.' };
    }
    if (s.phase !== 'playing') return { error: 'Not in play.' };
    if (playerId !== this.currentPlayerId()) return { error: 'It is not your turn.' };

    const p = s.players[playerId];
    if (!p) return { error: 'Unknown pilgrim.' };

    let res;
    switch (msg.t) {
      case 'playPath':   res = this.actPath(p, msg); break;
      case 'playAction': res = this.actAction(p, msg); break;
      case 'discard':    res = this.actDiscard(p, msg); break;
      default: return { error: 'Unknown action.' };
    }
    if (res && res.error) return res;

    if (s.phase === 'playing') {
      this.draw(p);
      this.advanceTurn();
    }
    return { ok: true };
  }

  actPath(p, msg) {
    const s = this.state;
    if (p.broken.halo || p.broken.wings || p.broken.hammer) {
      return { error: 'Your blessings are broken. You cannot lay a span.' };
    }
    const idx = p.hand.findIndex((c) => c.id === msg.cardId);
    if (idx === -1) return { error: 'Card not in hand.' };
    const card = p.hand[idx];
    if (card.type !== 'path') return { error: 'That is not a span.' };

    const rotated = !!msg.rotated;
    if (!canPlace(s.tiles, card, msg.x, msg.y, rotated)) {
      return { error: 'That span will not join the bridge there.' };
    }

    p.hand.splice(idx, 1);
    s.tiles[key(msg.x, msg.y)] = {
      kind: 'path',
      art: card.art,
      edges: cardEdges({ ...card, rotated }),
      passable: card.passable,
      rotated,
      placedBy: p.id,
      placedAt: Date.now(),
    };
    this.log(p.name + ' lays a span.', 'path', { by: p.id, x: msg.x, y: msg.y });
    this.onSfx('place');

    const revealed = revealReachedGoals(s.tiles);
    for (const gi of revealed) {
      const cell = GOAL_CELLS[gi];
      const t = s.tiles[key(cell.x, cell.y)];
      if (t.isGold) {
        this.log('A Gate of purest gold stands open.', 'win');
        this.endRound('builders', p.id);
        return { ok: true };
      }
      this.log('A Gate opens onto empty sky. Nothing but stone.', 'reveal');
      this.onSfx('gateStone');
    }
    return { ok: true };
  }

  actAction(p, msg) {
    const s = this.state;
    const idx = p.hand.findIndex((c) => c.id === msg.cardId);
    if (idx === -1) return { error: 'Card not in hand.' };
    const card = p.hand[idx];
    if (card.type !== 'action') return { error: 'That is not an action.' };

    if (card.action === 'break') {
      const target = s.players[msg.targetId];
      if (!target) return { error: 'No such pilgrim.' };
      if (target.broken[card.tool]) return { error: 'That blessing is already broken.' };
      target.broken[card.tool] = true;
      this.log(p.name + ' curses ' + target.name + ': ' + TOOL_INFO[card.tool].broken + '.',
        'break', { by: p.id, to: target.id });
      this.onSfx('curse');
    } else if (card.action === 'repair') {
      const target = s.players[msg.targetId];
      if (!target) return { error: 'No such pilgrim.' };
      const tool = card.tools.length === 1 ? card.tools[0] : msg.tool;
      if (!tool || !card.tools.includes(tool)) return { error: 'Choose a blessing to restore.' };
      if (!target.broken[tool]) return { error: 'That blessing is not broken.' };
      target.broken[tool] = false;
      this.log(p.name + ' restores ' + target.name + "'s " + TOOL_INFO[tool].name + '.',
        'repair', { by: p.id, to: target.id });
      this.onSfx('bless');
    } else if (card.action === 'smite') {
      const t = s.tiles[key(msg.x, msg.y)];
      if (!t || t.kind !== 'path') return { error: 'Only a laid span may be smitten.' };
      delete s.tiles[key(msg.x, msg.y)];
      this.log(p.name + ' smites a span from the sky.', 'smite', { by: p.id, x: msg.x, y: msg.y });
      this.onSfx('smite');
    } else if (card.action === 'reveal') {
      const gi = msg.goalIndex | 0;
      const cell = GOAL_CELLS[gi];
      if (!cell) return { error: 'No such Gate.' };
      const t = s.tiles[key(cell.x, cell.y)];
      if (!t || t.revealed) return { error: 'That Gate is already known.' };
      if (!this.peeks[p.id]) this.peeks[p.id] = {};
      this.peeks[p.id][gi] = !!t.isGold;
      this.log(p.name + ' receives a Revelation.', 'reveal', { by: p.id });
      this.onSfx('reveal');
      this.onPrivate(p.id, { t: 'peek', goalIndex: gi, isGold: !!t.isGold });
    } else {
      return { error: 'Unknown action card.' };
    }

    p.hand.splice(idx, 1);
    s.discardCount += 1;
    return { ok: true };
  }

  actDiscard(p, msg) {
    const card = this.takeCard(p, msg.cardId);
    if (!card) return { error: 'Card not in hand.' };
    this.state.discardCount += 1;
    this.log(p.name + ' casts a card into the clouds.', 'discard', { by: p.id });
    this.onSfx('discard');
    return { ok: true };
  }

  /** Called on a timer by the host; forces a discard when the sand runs out. */
  tick() {
    const s = this.state;
    if (s.phase !== 'playing' || !s.turnEndsAt) return false;
    if (Date.now() < s.turnEndsAt) return false;
    const p = s.players[this.currentPlayerId()];
    if (p && p.hand.length) {
      const card = p.hand[Math.floor(this.rng() * p.hand.length)];
      this.log(p.name + ' runs out of time.', 'timeout', { by: p.id });
      this.actDiscard(p, { cardId: card.id });
      this.draw(p);
    }
    this.advanceTurn();
    return true;
  }

  // -- views --------------------------------------------------------------
  publicTiles() {
    const out = {};
    for (const [k, t] of Object.entries(this.state.tiles)) {
      const v = {
        kind: t.kind,
        art: t.art,
        edges: t.edges,
        passable: t.passable,
        rotated: !!t.rotated,
        placedBy: t.placedBy || null,
      };
      if (t.kind === 'goal') {
        v.goalIndex = t.goalIndex;
        v.revealed = !!t.revealed;
        if (t.revealed) v.isGold = !!t.isGold;
      }
      out[k] = v;
    }
    return out;
  }

  viewFor(playerId) {
    const s = this.state;
    const me = s.players[playerId];
    const rolesOpen = s.phase === 'roundEnd' || s.phase === 'gameEnd';
    const connected = s.phase === 'playing' || s.phase === 'roundEnd'
      ? Array.from(computeConnected(s.tiles))
      : [];

    return {
      phase: s.phase,
      round: s.round,
      maxRounds: s.maxRounds,
      settings: this.settings,
      hostId: s.order.find((id) => s.players[id].isHost) || null,
      order: s.order.slice(),
      turnIndex: s.turnIndex,
      currentPlayerId: s.phase === 'playing' ? this.currentPlayerId() : null,
      turnEndsAt: s.turnEndsAt,
      deckCount: s.deck.length,
      discardCount: s.discardCount,
      tiles: this.publicTiles(),
      connected,
      log: s.log.slice(-40),
      roundResult: s.roundResult,
      gameResult: s.gameResult,
      you: me
        ? {
            id: me.id,
            role: me.role,
            hand: me.hand,
            broken: me.broken,
            peeks: this.peeks[playerId] || {},
            isHost: me.isHost,
          }
        : null,
      players: s.order.map((id) => {
        const p = s.players[id];
        return {
          id: p.id,
          name: p.name,
          color: p.color,
          isHost: p.isHost,
          isBot: !!p.isBot,
          connected: p.connected,
          handCount: p.hand.length,
          broken: p.broken,
          grace: p.grace,
          roundGrace: p.roundGrace,
          role: rolesOpen && this.settings.revealRoles ? p.role : null,
        };
      }),
    };
  }

  /** Cells the given player could legally place the given card on. */
  placementsFor(playerId, cardId) {
    const p = this.state.players[playerId];
    if (!p) return [];
    const card = p.hand.find((c) => c.id === cardId);
    if (!card || card.type !== 'path') return [];
    if (p.broken.halo || p.broken.wings || p.broken.hammer) return [];
    return legalPlacements(this.state.tiles, card);
  }
}
