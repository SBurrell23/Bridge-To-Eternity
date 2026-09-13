// Acolytes: computer-controlled pilgrims.
//
// A bot is handed exactly the same view a human player gets -- its own hand,
// its own allegiance, its own Revelations and the public board -- and nothing
// more. It cannot see another player's cards, anyone else's role, or what lies
// behind a Gate it has not looked at. Everything below is inference.

import { GOAL_CELLS, computeConnected, key, parseKey } from './board.js';
import { cardEdges } from './cards.js';

export const BOT_NAMES = [
  'Seraphiel', 'Ariel', 'Cassiel', 'Raziel', 'Zadkiel',
  'Camael', 'Barachiel', 'Jophiel', 'Selaphiel', 'Muriel',
  'Haniel', 'Uzziel', 'Remiel', 'Sariel',
];

export const BOT_SKILLS = {
  meek:    { blunder: 0.42, bluff: 0.5,  peekEarly: 0.2, label: 'Meek' },
  steady:  { blunder: 0.16, bluff: 0.35, peekEarly: 0.5, label: 'Steady' },
  cunning: { blunder: 0.02, bluff: 0.22, peekEarly: 0.8, label: 'Cunning' },
};

export function pickBotName(taken) {
  const free = BOT_NAMES.filter((n) => !taken.includes(n));
  const pool = free.length ? free : BOT_NAMES;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ---------------------------------------------------------------------------
// Reading the board
// ---------------------------------------------------------------------------
function cloneTiles(tiles) {
  const out = {};
  for (const [k, t] of Object.entries(tiles)) {
    out[k] = {
      kind: t.kind,
      edges: { ...t.edges },
      passable: t.passable,
      revealed: t.revealed,
      isGold: t.isGold,
      goalIndex: t.goalIndex,
      placedBy: t.placedBy,
    };
  }
  return out;
}

/**
 * What this bot believes about each Gate, from what has been revealed publicly
 * plus its own private Revelations. Two known stones means the third is gold.
 */
export function gateBeliefs(view) {
  const belief = GOAL_CELLS.map((c, i) => {
    const t = view.tiles[key(c.x, c.y)];
    if (t && t.revealed) return t.isGold ? 'gold' : 'stone';
    const peek = view.you.peeks ? view.you.peeks[i] : undefined;
    if (peek === true) return 'gold';
    if (peek === false) return 'stone';
    return 'unknown';
  });
  if (!belief.includes('gold') && belief.filter((b) => b === 'stone').length === 2) {
    belief[belief.indexOf('unknown')] = 'gold';
  }
  return belief;
}

function targetRows(view) {
  const belief = gateBeliefs(view);
  const gold = belief.indexOf('gold');
  if (gold >= 0) return [GOAL_CELLS[gold].y];
  const live = GOAL_CELLS.filter((c, i) => belief[i] !== 'stone');
  return live.length ? live.map((c) => c.y) : [0];
}

/** How close the bridge gets to the rows worth aiming at, and how far east. */
function measure(tiles, rows) {
  const connected = computeConnected(tiles);
  let reach = 0;
  let dist = 99;
  for (const k of connected) {
    const t = tiles[k];
    if (!t || !t.passable) continue;
    const { x, y } = parseKey(k);
    if (x > reach) reach = x;
    for (const row of rows) {
      const d = (8 - x) + Math.abs(row - y);
      if (d < dist) dist = d;
    }
  }
  return { reach, dist, size: connected.size };
}

/** Who looks like they are helping, and who looks like they are not. */
export function readTable(view) {
  const stats = {};
  for (const p of view.players) {
    stats[p.id] = { id: p.id, name: p.name, good: 0, bad: 0, spans: 0 };
  }
  for (const t of Object.values(view.tiles)) {
    if (t.kind !== 'path' || !t.placedBy || !stats[t.placedBy]) continue;
    stats[t.placedBy].spans += 1;
    if (t.passable) stats[t.placedBy].good += 1.2;
    else stats[t.placedBy].bad += 3;
  }
  for (const entry of view.log || []) {
    const s = entry.by && stats[entry.by];
    if (!s) continue;
    if (entry.kind === 'smite') s.bad += 2.5;
    else if (entry.kind === 'break') s.bad += 1.2;
    else if (entry.kind === 'repair') s.good += 2;
    else if (entry.kind === 'discard') s.bad += 0.3;
  }
  for (const id of Object.keys(stats)) stats[id].suspicion = stats[id].bad - stats[id].good;
  return stats;
}

// ---------------------------------------------------------------------------
// Choosing a move
// ---------------------------------------------------------------------------
/**
 * @param view           the bot's own player view, exactly as a human gets it
 * @param placementsFor  (cardId) => [{x, y, rotated}] legal spots for that card
 * @param opts           { skill, rng }
 * @returns an intent object ready for Engine.handle
 */
export function chooseBotAction(view, placementsFor, opts = {}) {
  const skill = BOT_SKILLS[opts.skill] || BOT_SKILLS.steady;
  const rng = opts.rng || Math.random;
  const me = view.you;
  const hand = me.hand || [];
  if (!hand.length) return null;

  const broken = me.broken;
  const cursed = broken.halo || broken.wings || broken.hammer;
  const fallen = me.role === 'fallen';
  const others = view.players.filter((p) => p.id !== me.id);
  const stats = readTable(view);
  const rows = targetRows(view);
  const belief = gateBeliefs(view);
  const before = measure(view.tiles, rows);

  // -- 1. A cursed pilgrim is useless. Mend yourself first. ----------------
  if (cursed) {
    const fix = hand.find((c) => c.type === 'action' && c.action === 'repair'
      && c.tools.some((t) => broken[t]));
    if (fix) {
      return { t: 'playAction', cardId: fix.id, targetId: me.id, tool: fix.tools.find((t) => broken[t]) };
    }
  }

  // -- 2. Score every span this bot could lay. -----------------------------
  const options = [];
  if (!cursed) {
    for (const card of hand) {
      if (card.type !== 'path') continue;
      for (const spot of placementsFor(card.id)) {
        const tiles = cloneTiles(view.tiles);
        tiles[key(spot.x, spot.y)] = {
          kind: 'path',
          edges: cardEdges({ ...card, rotated: spot.rotated }),
          passable: card.passable,
        };
        const after = measure(tiles, rows);
        const gain = (before.dist - after.dist) * 100
          + (after.reach - before.reach) * 45
          + (after.size - before.size) * 3;

        const edges = cardEdges({ ...card, rotated: spot.rotated });
        let score;
        if (!fallen) {
          // Builders want progress, never want to wall themselves in, and
          // break ties by pushing east with an opening that carries on east.
          score = gain + (card.passable ? 72 : -400)
            + spot.x * 8 + (edges.e ? 22 : 0);
        } else {
          // The Fallen want the opposite. A severed span on the frontier is the
          // most expensive thing to undo -- but dropping one there every single
          // turn would give the game away, so the pull is deliberately mild.
          score = -gain + (card.passable ? -45 : 84 + spot.x * 11);
          // Playing something genuinely useful now and then buys cover.
          if (card.passable && gain > 0 && rng() < skill.bluff) score += gain * 1.7 + 70;
        }
        options.push({ score: score + rng() * 12, card, spot });
      }
    }
  }
  options.sort((a, b) => b.score - a.score);

  const blunder = rng() < skill.blunder;
  const best = options.length
    ? (blunder && options.length > 1 ? options[1 + Math.floor(rng() * (options.length - 1))] : options[0])
    : null;

  // -- 3. Look beyond a Gate while it still matters. -----------------------
  const revealCard = hand.find((c) => c.type === 'action' && c.action === 'reveal');
  const unknownGate = belief.indexOf('unknown');
  const wantsPeek = unknownGate >= 0 && !belief.includes('gold')
    && (before.reach >= 2 || rng() < skill.peekEarly);
  if (revealCard && wantsPeek && (!best || best.score < 90 || rng() < 0.35)) {
    return { t: 'playAction', cardId: revealCard.id, goalIndex: unknownGate };
  }

  // -- 4. Lay the span if it is worth laying. ------------------------------
  if (best && best.score > 0) {
    return {
      t: 'playPath', cardId: best.card.id,
      x: best.spot.x, y: best.spot.y, rotated: best.spot.rotated,
    };
  }

  // -- 5. Curses and blessings. -------------------------------------------
  const breakCard = hand.find((c) => c.type === 'action' && c.action === 'break'
    && others.some((p) => !p.broken[c.tool]));
  if (breakCard) {
    const pool = others.filter((p) => !p.broken[breakCard.tool]);
    // A Builder curses whoever looks guilty; the Fallen curse whoever is
    // actually getting the bridge built.
    pool.sort((a, b) => (fallen
      ? stats[a.id].suspicion - stats[b.id].suspicion
      : stats[b.id].suspicion - stats[a.id].suspicion));
    const target = blunder ? pool[Math.floor(rng() * pool.length)] : pool[0];
    const worthIt = fallen ? stats[target.id].good > 0 || rng() < 0.45
      : stats[target.id].suspicion > 2.2;
    if (target && worthIt) {
      return { t: 'playAction', cardId: breakCard.id, targetId: target.id };
    }
  }

  const repairCard = hand.find((c) => c.type === 'action' && c.action === 'repair'
    && view.players.some((p) => c.tools.some((t) => p.broken[t])));
  if (repairCard) {
    const pool = view.players.filter((p) => repairCard.tools.some((t) => p.broken[t]));
    // Mending the least suspicious pilgrim helps the bridge; for the Fallen it
    // is cheap theatre that makes them look like a Builder.
    pool.sort((a, b) => stats[a.id].suspicion - stats[b.id].suspicion);
    const target = pool[0];
    const helpful = !fallen || rng() < skill.bluff + 0.2 || target.id === me.id;
    if (target && helpful) {
      return {
        t: 'playAction', cardId: repairCard.id, targetId: target.id,
        tool: repairCard.tools.find((t) => target.broken[t]),
      };
    }
  }

  // -- 6. Smite. ----------------------------------------------------------
  const smiteCard = hand.find((c) => c.type === 'action' && c.action === 'smite');
  if (smiteCard) {
    const connected = computeConnected(view.tiles);
    const cells = Object.keys(view.tiles)
      .filter((k) => view.tiles[k].kind === 'path')
      .map((k) => ({ k, ...parseKey(k), tile: view.tiles[k] }));
    if (cells.length) {
      let pick = null;
      for (const c of cells) {
        // Builders clear away severed spans; the Fallen cut the live route as
        // far east as they can reach.
        const score = !fallen
          ? (c.tile.passable ? -60 : 95) + c.x * 8
          : (c.tile.passable && connected.has(c.k) ? 55 + c.x * 11 : -60);
        if (!pick || score > pick.score) pick = { score, c };
      }
      if (pick && pick.score > 20) {
        return { t: 'playAction', cardId: smiteCard.id, x: pick.c.x, y: pick.c.y };
      }
    }
  }

  // A late Revelation is better than a wasted turn.
  if (revealCard && unknownGate >= 0) {
    return { t: 'playAction', cardId: revealCard.id, goalIndex: unknownGate };
  }

  // -- 7. Cast away whatever is least use. --------------------------------
  const junk = hand.slice().sort((a, b) => discardValue(a, fallen) - discardValue(b, fallen));
  return { t: 'discard', cardId: junk[0].id };
}

/** Lower means "get rid of this first". */
function discardValue(card, fallen) {
  if (card.type === 'path') {
    if (card.passable) return fallen ? 0 : 60;      // the Fallen bin good spans
    return fallen ? 70 : 5;                          // Builders bin broken ones
  }
  switch (card.action) {
    case 'break':  return fallen ? 80 : 30;
    case 'repair': return fallen ? 25 : 55;
    case 'smite':  return fallen ? 75 : 35;
    case 'reveal': return 40;
    default:       return 50;
  }
}
