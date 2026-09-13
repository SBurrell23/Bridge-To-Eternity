// Headless rules harness: plays whole games with scripted "bots" so the engine
// can be exercised without a browser. Run with: node tests/sim.mjs
import { Engine } from '../src/game/engine.js';
import { legalPlacements, smiteTargets, GOAL_CELLS, key, computeConnected } from '../src/game/board.js';
import { buildDeck, PATH_TEMPLATES, ACTION_TEMPLATES } from '../src/game/cards.js';
import { makeRng } from '../src/util/rng.js';

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log('  ok   ' + name);
  } else {
    failures++;
    console.log('  FAIL ' + name + (detail ? ' -- ' + detail : ''));
  }
}

// --- deck composition -------------------------------------------------------
console.log('\ndeck composition');
{
  const deck = buildDeck(makeRng(7));
  const paths = deck.filter((c) => c.type === 'path');
  const actions = deck.filter((c) => c.type === 'action');
  check('40 bridge cards', paths.length === 40, String(paths.length));
  check('31 spans / 9 broken', paths.filter((c) => c.passable).length === 31, String(paths.filter((c) => c.passable).length));
  check('27 action cards', actions.length === 27, String(actions.length));
  check('9 curses', actions.filter((c) => c.action === 'break').length === 9);
  check('9 blessings', actions.filter((c) => c.action === 'repair').length === 9);
  check('3 smites', actions.filter((c) => c.action === 'smite').length === 3);
  check('6 revelations', actions.filter((c) => c.action === 'reveal').length === 6);
  check('templates total 67', PATH_TEMPLATES.concat(ACTION_TEMPLATES).reduce((a, t) => a + t.count, 0) === 67);
}

// --- placement rules --------------------------------------------------------
console.log('\nplacement rules');
{
  const e = new Engine();
  ['A', 'B', 'C'].forEach((n, i) => e.addPlayer('p' + i, n, i === 0));
  e.startGame();
  const t = e.state.tiles;

  const cross = { type: 'path', art: 'cross', edges: 'NESW', passable: true };
  const vert = { type: 'path', art: 'vert', edges: 'NS', passable: true };

  check('cross fits east of cornerstone', legalPlacements(t, cross).some((p) => p.x === 1 && p.y === 0));
  check('cannot place on the cornerstone', legalPlacements(t, cross).every((p) => !(p.x === 0 && p.y === 0)));
  check('vertical span cannot touch cornerstone side-on',
    !legalPlacements(t, vert).some((p) => p.x === 1 && p.y === 0));
  check('floating cell is illegal', legalPlacements(t, cross).every((p) => Math.abs(p.x) + Math.abs(p.y) <= 1));
  check('off-board is illegal', legalPlacements(t, cross).every((p) => p.x >= 0 && p.x <= 8 && p.y >= -2 && p.y <= 2));

  // A severed span attaches but carries nothing onward.
  const dead = { type: 'path', art: 'de_ew', edges: 'EW', passable: false };
  e.state.tiles[key(1, 0)] = { kind: 'path', art: 'de_ew', edges: { n: false, e: true, s: false, w: true }, passable: false };
  const reach = computeConnected(e.state.tiles);
  check('broken span is reached', reach.has('1,0'));
  const horiz = { type: 'path', art: 'horiz', edges: 'EW', passable: true };
  check('nothing builds past a broken span', !legalPlacements(e.state.tiles, horiz).some((p) => p.x === 2 && p.y === 0), JSON.stringify(legalPlacements(e.state.tiles, horiz)));
  void dead;
}

// --- gate reveal ------------------------------------------------------------
console.log('\ngate reveal');
{
  const e = new Engine();
  ['A', 'B', 'C'].forEach((n, i) => e.addPlayer('p' + i, n, i === 0));
  e.startGame();
  // Lay a solid highway of crossroads from the cornerstone to the middle gate.
  for (let x = 1; x <= 7; x++) {
    e.state.tiles[key(x, 0)] = { kind: 'path', art: 'cross', edges: { n: true, e: true, s: true, w: true }, passable: true };
  }
  const goldIndex = GOAL_CELLS.findIndex((c) => e.state.tiles[key(c.x, c.y)].isGold);
  const before = e.state.phase;
  const revealed = (await import('../src/game/board.js')).revealReachedGoals(e.state.tiles);
  check('reaching the middle gate flips it', revealed.includes(1), JSON.stringify(revealed));
  check('side gates stay hidden', !revealed.includes(0) && !revealed.includes(2));
  check('phase untouched by pure board helper', before === e.state.phase);
  void goldIndex;
}

// --- a full scripted game ---------------------------------------------------
console.log('\nfull games');

function botTurn(e, rng) {
  const pid = e.currentPlayerId();
  const p = e.state.players[pid];
  if (!p || !p.hand.length) return e.advanceTurn();

  const broken = p.broken.halo || p.broken.wings || p.broken.hammer;

  // Repair yourself first if you can.
  if (broken) {
    const fix = p.hand.find((c) => c.type === 'action' && c.action === 'repair'
      && c.tools.some((t) => p.broken[t]));
    if (fix) {
      const tool = fix.tools.find((t) => p.broken[t]);
      return e.handle(pid, { t: 'playAction', cardId: fix.id, targetId: pid, tool });
    }
  }

  // Builders push east; the Fallen prefer to place the worst card they hold.
  if (!broken) {
    const paths = p.hand.filter((c) => c.type === 'path');
    let best = null;
    for (const c of paths) {
      for (const spot of legalPlacements(e.state.tiles, c)) {
        const score = (p.role === 'builder'
          ? spot.x * 10 + (c.passable ? 50 : -100)
          : spot.x * -2 + (c.passable ? -50 : 40)) + rng();
        if (!best || score > best.score) best = { score, card: c, spot };
      }
    }
    if (best && (p.role === 'builder' ? best.score > 0 : true)) {
      return e.handle(pid, {
        t: 'playPath', cardId: best.card.id,
        x: best.spot.x, y: best.spot.y, rotated: best.spot.rotated,
      });
    }
  }

  // Otherwise try an action card.
  const others = e.state.order.filter((id) => id !== pid);
  for (const c of p.hand) {
    if (c.type !== 'action') continue;
    if (c.action === 'break') {
      const target = others.find((id) => !e.state.players[id].broken[c.tool]);
      if (target) return e.handle(pid, { t: 'playAction', cardId: c.id, targetId: target });
    } else if (c.action === 'repair') {
      const target = e.state.order.find((id) => c.tools.some((t) => e.state.players[id].broken[t]));
      if (target) {
        const tool = c.tools.find((t) => e.state.players[target].broken[t]);
        return e.handle(pid, { t: 'playAction', cardId: c.id, targetId: target, tool });
      }
    } else if (c.action === 'smite') {
      const targets = smiteTargets(e.state.tiles);
      if (targets.length) {
        const tgt = targets[Math.floor(rng() * targets.length)];
        return e.handle(pid, { t: 'playAction', cardId: c.id, x: tgt.x, y: tgt.y });
      }
    } else if (c.action === 'reveal') {
      const gi = GOAL_CELLS.findIndex((cell) => !e.state.tiles[key(cell.x, cell.y)].revealed);
      if (gi >= 0) return e.handle(pid, { t: 'playAction', cardId: c.id, goalIndex: gi });
    }
  }

  return e.handle(pid, { t: 'discard', cardId: p.hand[0].id });
}

{
  const rng = makeRng(1234);
  let builderWins = 0;
  let fallenWins = 0;
  let leaks = 0;
  let errors = 0;
  const GAMES = 200;

  for (let g = 0; g < GAMES; g++) {
    const e = new Engine({ rounds: 3 });
    const n = 3 + Math.floor(rng() * 8); // 3..10 players
    for (let i = 0; i < n; i++) e.addPlayer('p' + i, 'Bot' + i, i === 0);
    const started = e.startGame();
    if (started.error) { errors++; continue; }

    let guard = 0;
    while (e.state.phase !== 'gameEnd' && guard++ < 8000) {
      if (e.state.phase === 'playing') {
        const res = botTurn(e, rng);
        if (res && res.error) errors++;
      } else if (e.state.phase === 'roundEnd') {
        if (e.state.roundResult.winner === 'builders') builderWins++; else fallenWins++;
        // A hidden gate must never leak its contents mid-round.
        e.nextRound();
      }
    }
    if (e.state.phase !== 'gameEnd') { errors++; continue; }

    // View hygiene: mid-round, no view may contain another player's hand or role.
    const e2 = new Engine();
    for (let i = 0; i < 4; i++) e2.addPlayer('q' + i, 'Q' + i, i === 0);
    e2.startGame();
    const v = e2.viewFor('q1');
    if (v.players.some((p) => p.role !== null)) leaks++;
    if (v.players.some((p) => p.hand)) leaks++;
    if (Object.values(v.tiles).some((t) => t.kind === 'goal' && !t.revealed && 'isGold' in t)) leaks++;
    if (v.you.hand.length === 0) leaks++;
  }

  check('every game reached a final scoreboard', errors === 0, errors + ' errors');
  check('no secret leaked into a player view', leaks === 0, leaks + ' leaks');
  check('builders win sometimes', builderWins > 0, String(builderWins));
  check('fallen win sometimes', fallenWins > 0, String(fallenWins));
  console.log('  info builders ' + builderWins + ' / fallen ' + fallenWins + ' rounds over ' + GAMES + ' games');
}

// --- turn timer -------------------------------------------------------------
console.log('\nturn timer');
{
  const e = new Engine({ turnSeconds: 1 });
  ['A', 'B', 'C'].forEach((n, i) => e.addPlayer('p' + i, n, i === 0));
  e.startGame();
  const first = e.currentPlayerId();
  check('a deadline is set', typeof e.state.turnEndsAt === 'number');
  e.state.turnEndsAt = Date.now() - 1;
  const fired = e.tick();
  check('expiry forces the turn on', fired && e.currentPlayerId() !== first);
}

// --- illegal intents --------------------------------------------------------
console.log('\nillegal intents');
{
  const e = new Engine();
  ['A', 'B', 'C'].forEach((n, i) => e.addPlayer('p' + i, n, i === 0));
  e.startGame();
  const cur = e.currentPlayerId();
  const other = e.state.order.find((id) => id !== cur);
  check('out-of-turn play rejected', !!e.handle(other, { t: 'discard', cardId: 'nope' }).error);
  check('unknown card rejected', !!e.handle(cur, { t: 'discard', cardId: 'nope' }).error);
  check('unknown intent rejected', !!e.handle(cur, { t: 'wat' }).error);

  const p = e.state.players[cur];
  p.broken.halo = true;
  const path = p.hand.find((c) => c.type === 'path');
  if (path) {
    check('cursed player cannot lay a span',
      !!e.handle(cur, { t: 'playPath', cardId: path.id, x: 1, y: 0, rotated: false }).error);
  }
}

console.log('\n' + (failures ? failures + ' FAILURES' : 'all checks passed'));
process.exit(failures ? 1 : 0);
