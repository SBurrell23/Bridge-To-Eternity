// Not part of the deploy gate: a quick win-rate probe for tuning the acolytes.
import { Engine } from '../src/game/engine.js';
import { chooseBotAction } from '../src/game/ai.js';
import { makeRng } from '../src/util/rng.js';

function run(skill, games, seed) {
  const rng = makeRng(seed);
  let b = 0, f = 0;
  for (let g = 0; g < games; g++) {
    const e = new Engine({ rounds: 1, botSkill: skill });
    const n = 4 + Math.floor(rng() * 4);
    for (let i = 0; i < n; i++) e.addPlayer('b' + i, 'B' + i, i === 0, true);
    e.startGame();
    let guard = 0;
    while (e.state.phase === 'playing' && guard++ < 3000) {
      const id = e.currentPlayerId();
      e.handle(id, chooseBotAction(e.viewFor(id), (c) => e.placementsFor(id, c), { skill, rng }));
    }
    if (e.state.roundResult && e.state.roundResult.winner === 'builders') b++; else f++;
  }
  return { skill, builders: b, fallen: f, rate: (b / games * 100).toFixed(0) + '%' };
}

for (const s of ['meek', 'steady', 'cunning']) console.log(run(s, 150, 7));
