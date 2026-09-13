# Bridge To Eternity

A 3D, peer-to-peer, browser card game in the clouds.

Two crews stand on a cloudbank. The **Builders** want to lay a bridge east to the Gate of Gold.
The **Fallen** are mixed in among them, smiling, helping — and making quite sure the bridge never
arrives. Nobody knows who is who.

It is *Saboteur*, re-themed: the mine becomes a sky-bridge, the miners become Builders, the
saboteurs become the Fallen, and the pickaxes, lanterns and minecarts become Hammers, Halos and
Wings. Every rule of the original is intact.

**Play it:** https://sburrell23.github.io/Bridge-To-Eternity/

---

## Everything is generated in code

No image files, no audio files, no models — apart from the ambient score, every asset is drawn or
synthesised at runtime:

- **Cards** — each face is painted onto a 2D canvas (`src/render/cardart.js`): gilded frames with
  corner flourishes, marble veining, film grain, and hand-drawn emblems for every halo, wing,
  hammer, bolt and eye. The canvas becomes a three.js texture.
- **The board** — bridge spans are drawn top-down from their open edges: stone decking, gold kerbs,
  a luminous inlay down the middle, plank seams. Broken spans get a red-lit chasm and embers.
- **The world** — sky gradient, cloud floor (a seamlessly tiling canvas), drifting puffs, shafts of
  light and floating motes.
- **Sound** — every chime, crack, curse and fanfare is Web Audio: oscillators, filtered noise and a
  convolution reverb built from a generated impulse response (`src/audio/audio.js`).

## Playing against the computer

You do not need five friends to hand. In the lobby the host can **Summon an Acolyte** — a
computer-controlled pilgrim — as many as there is room for, so one person plus two acolytes is a
complete game.

Acolytes are dealt allegiances like anybody else, so the one sitting next to you may well be
Fallen, and it will act like it: laying a helpful span now and then for cover, mending your Halo
with one hand and dropping a severed span on the frontier with the other. A Builder acolyte watches
who lays broken spans and who reaches for the Smite, and curses the pilgrim it trusts least.

Crucially, an acolyte is handed exactly the view a human in that seat would get — its own hand, its
own allegiance, its own Revelations and the public board. It cannot see your cards, it does not know
your role, and it has no idea which Gate hides the gold until it looks. Everything it does is
inference (`src/game/ai.js`).

Three skill levels in the lobby: **Meek** blunders often and bluffs clumsily, **Steady** plays a
solid game, and **Cunning** rarely wastes a turn and lies well. Across a few hundred headless games
the three settle at roughly an even split between the two sides.

## How a game works

Three to ten pilgrims, humans and acolytes in any mix. One player opens a room and shares the
four-letter code; everyone else joins.
The host's browser runs the authoritative game engine and sends every other player a view tailored
to them — a view that never contains another player's hand, anyone's allegiance, or what lies
behind an unopened Gate.

### A turn

Do exactly one thing, then draw a card:

- **Lay a span** next to the bridge. Every touching edge must match, and it must join a span that
  already reaches back to the Cornerstone. Press <kbd>R</kbd> to rotate before placing.
- **Play an action** on a pilgrim, a span or a Gate.
- **Cast a card away** face down if you would rather do nothing.

### The cards (44 bridge + 27 action, exactly as in the boxed game)

| Card | Count | What it does |
| --- | --- | --- |
| Bridge Span | 31 | Extends the bridge. |
| Broken Span | 9 | Attaches, but nothing crosses it. A quiet way to waste a space. |
| Cornerstone / Gates | 1 + 3 | The start tile and three face-down Gates; one hides gold. |
| Snuffed Halo / Shorn Wings / Shattered Hammer | 9 | Curse a pilgrim — they may lay no spans until restored. |
| Rekindled Halo / Mended Wings / Reforged Hammer | 6 | Restore one broken blessing on anyone. |
| Benediction | 3 | Restore either of two blessings. |
| Smite | 3 | Destroy one laid span (never the Cornerstone or a Gate). |
| Revelation | 6 | Look secretly beyond one Gate. |

### Ending a round

Reach the golden Gate and the Builders win; the pilgrim who laid the final span takes the richest
share of Grace. If every hand empties first, the Fallen win and share the spoils (4 / 3 / 2 / 1 each,
by how many of them there are). Three rounds by default — the most Grace at the end wins the crossing.

Role counts and hand sizes follow the original table, and one role card is always left undealt so
nobody can deduce the split.

## Controls

| | |
| --- | --- |
| Pan the view | drag, or <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> |
| Orbit | right-drag, or shift-drag |
| Zoom | wheel, or pinch |
| Turn | <kbd>Q</kbd> <kbd>E</kbd> |
| Reset the view | <kbd>R</kbd> |
| Rotate a held span | <kbd>R</kbd> |
| Pick a card | <kbd>1</kbd>–<kbd>6</kbd> |
| Chat | <kbd>Enter</kbd> |
| Help | <kbd>H</kbd> |
| Cancel / settings | <kbd>Esc</kbd> |

## Settings

**In the lobby** (host only): number of rounds, turn timer, hand size, how many Fallen, acolyte
skill, whether to remove broken spans from the deck, and whether allegiances are revealed at the end
of a round — plus summoning and dismissing acolytes.

**Per player** (kept in `localStorage`): master / effects / music volume and mute; quality preset;
frame-rate cap; anti-aliasing; resolution scale; shadows; cloud density; shafts of light; drifting
motes; view distance; FPS counter.

## Running it locally

No build step — it is plain ES modules.

```bash
npx --yes http-server . -p 4173 -c-1
```

Then open `http://localhost:4173`. To test multiplayer, open the page in several tabs: host in one,
join from the others with the room code.

Run the rules simulation (200 full games plus 100 acolyte games, headless):

```bash
node tests/sim.mjs
```

Probe how the two sides are balancing at each acolyte skill level:

```bash
node tests/balance.mjs
```

## How it fits together

```
index.html            markup for every screen; import map for three.js
styles/main.css       gilded-glass UI theme
src/
  main.js             renderer, frame loop, input, and the glue between session and view
  game/
    cards.js          the deck: every card, role table, hand sizes, payouts
    board.js          grid, placement legality, bridge connectivity, Gate reveals
    engine.js         authoritative state machine; builds per-player views
    ai.js             the acolytes; decides from a player view, never from engine state
  net/
    net.js            PeerJS transport (host and client)
    session.js        one interface for the UI whether hosting or joining
  render/
    cardart.js        every canvas-drawn texture in the game
    scene.js          sky, cloud floor, lights, rays, motes
    boardview.js      3D tiles, Gates, highlights, ghost preview
    handview.js       the hand, as real cards in an orthographic overlay
    camera.js         free-roaming board camera
  audio/audio.js      Web Audio synthesis and the ambient score
  ui/                 HUD, lobby, settings, modals
tests/sim.mjs         headless rules + acolyte harness
tests/balance.mjs     acolyte win-rate probe (not part of the deploy gate)
```

The engine is pure and has no idea a browser exists, which is why the same file can be driven by
`tests/sim.mjs` in Node and by the host's browser in a real game.

## Deployment

Pushing to `main` runs the rules simulation and, if it passes, publishes the repository root to
GitHub Pages (`.github/workflows/deploy.yml`).

## Credits

Built with [three.js](https://threejs.org/) and [PeerJS](https://peerjs.com/).
Ambient score: *Celestial Drift*.
Game design owes everything to Frederic Moyersoen's *Saboteur*.
