// Board geometry, placement legality and bridge connectivity.

import { cardEdges } from './cards.js';

export const BOARD = { minX: 0, maxX: 8, minY: -2, maxY: 2 };
export const START = { x: 0, y: 0 };
export const GOAL_CELLS = [
  { x: 8, y: -2 },
  { x: 8, y: 0 },
  { x: 8, y: 2 },
];

export const DIRS = [
  { d: 'n', dx: 0, dy: -1, opp: 's' },
  { d: 'e', dx: 1, dy: 0,  opp: 'w' },
  { d: 's', dx: 0, dy: 1,  opp: 'n' },
  { d: 'w', dx: -1, dy: 0, opp: 'e' },
];

export const key = (x, y) => x + ',' + y;
export const parseKey = (k) => {
  const [x, y] = k.split(',').map(Number);
  return { x, y };
};

export function inBounds(x, y) {
  return x >= BOARD.minX && x <= BOARD.maxX && y >= BOARD.minY && y <= BOARD.maxY;
}

export function makeStartTile() {
  return {
    kind: 'start',
    art: 'start',
    edges: { n: true, e: true, s: true, w: true },
    passable: true,
  };
}

export function makeGoalTile(index) {
  return {
    kind: 'goal',
    art: 'gate',
    goalIndex: index,
    revealed: false,
    isGold: false,
    edges: { n: true, e: true, s: true, w: true },
    passable: true,
  };
}

export function createBoard(goldIndex) {
  const tiles = {};
  tiles[key(START.x, START.y)] = makeStartTile();
  GOAL_CELLS.forEach((c, i) => {
    const t = makeGoalTile(i);
    t.isGold = i === goldIndex;
    tiles[key(c.x, c.y)] = t;
  });
  return tiles;
}

// A hidden Gate is a wildcard for edge matching (you may build right up beside
// it either way) but carries no bridge, so nothing connects through it yet.
function isHidden(tile) {
  return tile.kind === 'goal' && !tile.revealed;
}

/**
 * Keys of every tile the bridge actually reaches from the Cornerstone.
 * Traversal enters a tile through matching open edges and may only continue
 * out of it when the tile is passable (severed spans are reached but dead).
 */
export function computeConnected(tiles) {
  const connected = new Set();
  const startKey = key(START.x, START.y);
  if (!tiles[startKey]) return connected;

  const queue = [startKey];
  connected.add(startKey);

  while (queue.length) {
    const k = queue.shift();
    const tile = tiles[k];
    if (!tile.passable || isHidden(tile)) continue;
    const { x, y } = parseKey(k);
    for (const dir of DIRS) {
      if (!tile.edges[dir.d]) continue;
      const nk = key(x + dir.dx, y + dir.dy);
      const nb = tiles[nk];
      if (!nb || connected.has(nk)) continue;
      if (isHidden(nb)) continue;
      if (!nb.edges[dir.opp]) continue;
      connected.add(nk);
      queue.push(nk);
    }
  }
  return connected;
}

/**
 * Can `card` (a path card, already carrying its `rotated` flag) go at x,y?
 * Rules: empty legal cell; every touching edge matches; and at least one
 * neighbour that is passable AND already reached by the bridge joins it.
 */
export function canPlace(tiles, card, x, y, rotated, connected) {
  if (!inBounds(x, y)) return false;
  if (tiles[key(x, y)]) return false;

  const edges = cardEdges({ ...card, rotated });
  const reach = connected || computeConnected(tiles);
  let joins = false;

  for (const dir of DIRS) {
    const nk = key(x + dir.dx, y + dir.dy);
    const nb = tiles[nk];
    if (!nb) continue;
    if (isHidden(nb)) {
      // Hidden Gate: anything is allowed beside it, but it cannot be the link
      // back to the Cornerstone.
      continue;
    }
    if (edges[dir.d] !== nb.edges[dir.opp]) return false;
    if (edges[dir.d] && nb.edges[dir.opp] && nb.passable && reach.has(nk)) {
      joins = true;
    }
  }
  return joins;
}

export function legalPlacements(tiles, card) {
  const connected = computeConnected(tiles);
  const out = [];
  const seen = new Set();
  for (let y = BOARD.minY; y <= BOARD.maxY; y++) {
    for (let x = BOARD.minX; x <= BOARD.maxX; x++) {
      if (tiles[key(x, y)]) continue;
      for (const rotated of [false, true]) {
        if (canPlace(tiles, card, x, y, rotated, connected)) {
          const id = key(x, y) + (rotated ? 'r' : 'f');
          if (!seen.has(id)) {
            seen.add(id);
            out.push({ x, y, rotated });
          }
        }
      }
    }
  }
  return out;
}

export function hasAnyPlacement(tiles, cards) {
  for (const c of cards) {
    if (c.type !== 'path') continue;
    if (legalPlacements(tiles, c).length) return true;
  }
  return false;
}

/**
 * Flip every Gate the bridge has now reached. Revealing a stone Gate opens a
 * through-route, so keep going until nothing new turns over.
 * Returns the list of goalIndexes revealed by this call, in order.
 */
export function revealReachedGoals(tiles) {
  const revealed = [];
  for (;;) {
    const connected = computeConnected(tiles);
    let changed = false;
    for (const cell of GOAL_CELLS) {
      const gk = key(cell.x, cell.y);
      const goal = tiles[gk];
      if (!goal || goal.kind !== 'goal' || goal.revealed) continue;
      for (const dir of DIRS) {
        const nk = key(cell.x + dir.dx, cell.y + dir.dy);
        const nb = tiles[nk];
        if (!nb || isHidden(nb)) continue;
        if (!nb.passable || !connected.has(nk)) continue;
        if (!nb.edges[dir.opp]) continue;
        goal.revealed = true;
        revealed.push(goal.goalIndex);
        changed = true;
        break;
      }
    }
    if (!changed) break;
  }
  return revealed;
}

export function canSmite(tiles, x, y) {
  const t = tiles[key(x, y)];
  return !!t && t.kind === 'path';
}

export function smiteTargets(tiles) {
  return Object.keys(tiles)
    .filter((k) => tiles[k].kind === 'path')
    .map(parseKey);
}

/** How far east the bridge has actually reached -- used for HUD flavour. */
export function bridgeReach(tiles) {
  const connected = computeConnected(tiles);
  let best = 0;
  for (const k of connected) best = Math.max(best, parseKey(k).x);
  return best;
}
