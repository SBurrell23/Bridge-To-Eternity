// Card definitions for Bridge To Eternity.
// Mechanically this is Saboteur; thematically the mine becomes a sky-bridge to the
// Eternal Gates, the miners become Builders and the saboteurs become the Fallen.

import { shuffle } from '../util/rng.js';

export const TOOLS = ['halo', 'wings', 'hammer'];

export const TOOL_INFO = {
  halo:   { name: 'Halo',   broken: 'Snuffed Halo',     fixed: 'Rekindled Halo',  glyph: 'halo' },
  wings:  { name: 'Wings',  broken: 'Shorn Wings',      fixed: 'Mended Wings',    glyph: 'wings' },
  hammer: { name: 'Hammer', broken: 'Shattered Hammer', fixed: 'Reforged Hammer', glyph: 'hammer' },
};

// ---------------------------------------------------------------------------
// Bridge (path) cards -- 40 total: 31 spans + 9 broken spans (dead ends).
// `edges` lists open sides on the unrotated card. `passable` false means the
// span is severed inside the card: you may attach to it, but nothing crosses it.
// ---------------------------------------------------------------------------
export const PATH_TEMPLATES = [
  { art: 'cross',   edges: 'NESW', passable: true,  count: 5 },
  { art: 'vert',    edges: 'NS',   passable: true,  count: 4 },
  { art: 'horiz',   edges: 'EW',   passable: true,  count: 3 },
  { art: 't_nes',   edges: 'NES',  passable: true,  count: 5 },
  { art: 't_nsw',   edges: 'NSW',  passable: true,  count: 5 },
  { art: 'turn_ne', edges: 'NE',   passable: true,  count: 5 },
  { art: 'turn_nw', edges: 'NW',   passable: true,  count: 4 },

  { art: 'de_n',    edges: 'N',    passable: false, count: 1 },
  { art: 'de_e',    edges: 'E',    passable: false, count: 1 },
  { art: 'de_s',    edges: 'S',    passable: false, count: 1 },
  { art: 'de_w',    edges: 'W',    passable: false, count: 1 },
  { art: 'de_ns',   edges: 'NS',   passable: false, count: 1 },
  { art: 'de_ew',   edges: 'EW',   passable: false, count: 1 },
  { art: 'de_ne',   edges: 'NE',   passable: false, count: 1 },
  { art: 'de_new',  edges: 'NEW',  passable: false, count: 1 },
  { art: 'de_nesw', edges: 'NESW', passable: false, count: 1 },
];

// ---------------------------------------------------------------------------
// Action cards -- 27 total.
// ---------------------------------------------------------------------------
export const ACTION_TEMPLATES = [
  { action: 'break',  tool: 'halo',   count: 3 },
  { action: 'break',  tool: 'wings',  count: 3 },
  { action: 'break',  tool: 'hammer', count: 3 },

  { action: 'repair', tools: ['halo'],   count: 2 },
  { action: 'repair', tools: ['wings'],  count: 2 },
  { action: 'repair', tools: ['hammer'], count: 2 },

  { action: 'repair', tools: ['halo', 'wings'],   count: 1 },
  { action: 'repair', tools: ['wings', 'hammer'], count: 1 },
  { action: 'repair', tools: ['halo', 'hammer'],  count: 1 },

  { action: 'smite',  count: 3 },
  { action: 'reveal', count: 6 },
];

export const GRACE_TEMPLATES = [
  { value: 1, count: 16 },
  { value: 2, count: 8 },
  { value: 3, count: 4 },
];

export function edgeSetToObj(str) {
  return {
    n: str.includes('N'),
    e: str.includes('E'),
    s: str.includes('S'),
    w: str.includes('W'),
  };
}

export function rotateEdges(edges) {
  return { n: edges.s, e: edges.w, s: edges.n, w: edges.e };
}

export function cardEdges(card) {
  const base = edgeSetToObj(card.edges);
  return card.rotated ? rotateEdges(base) : base;
}

let counter = 0;
function nextId(p) {
  counter += 1;
  return p + counter;
}

export function cardTitle(card) {
  if (card.type === 'path') {
    return card.passable ? 'Bridge Span' : 'Broken Span';
  }
  switch (card.action) {
    case 'break':  return TOOL_INFO[card.tool].broken;
    case 'repair': return card.tools.length === 1
      ? TOOL_INFO[card.tools[0]].fixed
      : 'Benediction';
    case 'smite':  return 'Smite';
    case 'reveal': return 'Revelation';
    default:       return 'Card';
  }
}

export function cardDescription(card) {
  if (card.type === 'path') {
    return card.passable
      ? 'Extend the bridge. Must join an existing span.'
      : 'A severed span. Attaches, but nothing crosses it.';
  }
  switch (card.action) {
    case 'break':
      return 'Curse a builder: their ' + TOOL_INFO[card.tool].name +
        ' is lost. They cannot lay spans until it is restored.';
    case 'repair':
      return card.tools.length === 1
        ? "Restore a builder's " + TOOL_INFO[card.tools[0]].name + '.'
        : 'Restore one of: ' + card.tools.map((t) => TOOL_INFO[t].name).join(' or ') + '.';
    case 'smite':
      return 'Call down fire and destroy one placed span (never the Cornerstone or a Gate).';
    case 'reveal':
      return 'Gaze upon one distant Gate. Only you see what lies beyond it.';
    default:
      return '';
  }
}

export function buildDeck(rng, opts = {}) {
  const cards = [];

  for (const t of PATH_TEMPLATES) {
    for (let i = 0; i < t.count; i++) {
      cards.push({
        id: nextId('p'),
        type: 'path',
        art: t.art,
        edges: t.edges,
        passable: t.passable,
        rotated: false,
      });
    }
  }

  for (const t of ACTION_TEMPLATES) {
    for (let i = 0; i < t.count; i++) {
      const card = { id: nextId('a'), type: 'action', action: t.action };
      if (t.tool) card.tool = t.tool;
      if (t.tools) card.tools = t.tools.slice();
      cards.push(card);
    }
  }

  let deck = cards;
  if (opts.noDeadEnds) deck = deck.filter((c) => c.type !== 'path' || c.passable);
  return shuffle(deck, rng);
}

export function buildGraceDeck(rng) {
  const cards = [];
  for (const t of GRACE_TEMPLATES) {
    for (let i = 0; i < t.count; i++) {
      cards.push({ id: nextId('g'), value: t.value });
    }
  }
  return shuffle(cards, rng);
}

// Official Saboteur role distribution, retitled. One role card is always left
// undealt so nobody can deduce the split from the count.
export const ROLE_TABLE = {
  3:  { fallen: 1, builders: 3 },
  4:  { fallen: 1, builders: 4 },
  5:  { fallen: 2, builders: 4 },
  6:  { fallen: 2, builders: 5 },
  7:  { fallen: 3, builders: 5 },
  8:  { fallen: 3, builders: 6 },
  9:  { fallen: 3, builders: 7 },
  10: { fallen: 4, builders: 7 },
};

export function handSizeFor(playerCount) {
  if (playerCount <= 5) return 6;
  if (playerCount <= 7) return 5;
  return 4;
}

// Grace awarded to each of the Fallen when the bridge never reaches the Gate.
export const FALLEN_PAYOUT = { 1: 4, 2: 3, 3: 2, 4: 1 };
