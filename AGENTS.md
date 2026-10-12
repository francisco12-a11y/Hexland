# AGENTS.md — guidance for coding agents

Hexland: a Catan-style board game (fan project). Vanilla JS ES modules, zero
dependencies, zero build step, deployed on GitHub Pages. UI in Spanish
(Rioplatense), code comments in English.

## Hard rules

- **No build step, no npm runtime dependencies.** The site is served raw by
  GitHub Pages: plain HTML/CSS + ES modules. `package.json` exists only to set
  `"type": "module"` so Node can run the tests; Pages ignores it. Never add a
  bundler, TypeScript, or runtime deps without asking.
- **Deploy = `git push` to `main`.** Pages rebuilds in ~1–2 min. Verify with
  `curl -s https://francisco12-a11y.github.io/Hexland/<file> | grep <distinctive
  string>`.
- **Never break `npm test`** (runs `node --test tests/`, needs Node ≥ 18).
- Local dev server: `python3 -m http.server 8123` (ES modules do not work over
  `file://`).
- Original name and art only. Game *mechanics* are fine to implement; do not
  use Catan GmbH assets or trademarks.

## Architecture (three layers, strictly separated)

```
src/board.js   geometry: axial coords → { hexes[19], vertices[54], edges[],
               coast[30], ports[9] }. Pure data, no rules.
src/game.js    rules engine: pure state machine, ZERO DOM. newGame(seed) →
               state; actions mutate state and return {ok} | {ok:false, err}.
src/render.js  presentation: full-redraw state → SVG. No rule logic.
src/main.js    orchestration: screens (lobby/game), click routing
               (SVG data-vid/data-eid/data-hid → graph ids → game actions),
               modals, hot-seat handoffs. Also owns UI-only state: `mode`,
               modals, `shownDice`.
src/net.js     PeerJS wrapper (window.Peer from CDN): hostRoom/joinRoom.
```


### Online mode (host-authoritative)

`session` in main.js switches the whole UI. The HOST owns the state: clients
send `{t:'act', kind, args}` envelopes, `hostApply` validates ownership of the
turn and runs the same game.js function, then `broadcastState()` sends the full
state (JSON-sanitized — it strips the `rng` function; clients never use it).
Clients mirror the state in `applyRemoteState` and derive UI from state
fields, not from action results — that's why the engine exposes
`state.stealCandidates`, `state.pendingDiscards` and `state.lastSetupVertex`.
In online mode each player sees their own hand (`session.myId`) and buttons
enable only on their turn. During setup, the step (settlement vs road) derives
from `state.lastSetupVertex != null`, not from local `mode`.

Data flow: click → `main.onPick(kind, id)` → `game.js` action → `{ok}` →
`renderAll()` (board + sidebar + dice all re-derived from state). The UI never
decides rules: it asks the engine for valid spots (`settlementSpots`,
`roadSpots`, `citySpots`, `robberSpots`) and only paints those as targets.

The board is a graph derived once at generation: hexes reference vertex/edge
ids; vertices know their hexes, edges and `neighbors`; edges are vertex pairs.
Rules are graph queries: distance rule = `v.neighbors` occupancy; road
connectivity = `connectedSet` (own buildings ∪ own road endpoints); production
= hex → adjacent buildings; port discount = port `vids` ∩ player buildings.

Debug/test hook: `window.__hexland = { game, G, refresh, setMode, mode }`.

## Rules engine conventions

- Actions validate phase and inputs first, mutate only on success, and always
  return `{ok}` / `{ok:false, err:"mensaje en español"}`. The UI flashes `err`.
- RNG is seeded (mulberry32) and lives in the state (`st.rng`), so games are
  replayable and tests can force rolls by overriding `st.rng`.
- `state.lastProduced` = ALL hex ids matching the last roll (border flash),
  `state.lastGain` = `{hexId: {n, res}}` (the "+N 🌾" badges and the per-player
  `📦 … recibió …` log lines). Reset on every roll.
- `WIN_VP = 10` (standard). Buildings alone cap at 9 PV; dev-card VPs, longest
  road and largest army supply the rest.
- Settlement placement: the vertex itself must touch one of the player's roads
  (be an endpoint), not merely be adjacent to the network. After setup there
  are no valid spots until a road is extended (road endpoints hug the player's
  own settlements, blocked by the distance rule) — that is correct, don't
  "fix" it.

## Development cards & bonus points

- Deck of 25 (`DEV_DECK` in game.js): 14 knight, 5 VP, 2 road building,
  2 year of plenty, 2 monopoly. Shuffled into `st.devDeck` at `newGame` with
  the seeded rng. Cost 1 sheep + 1 wheat + 1 ore (`COSTS.dev`).
- Each card stores `{t, turn}` — `turn` is the purchase turn; a card cannot be
  played the same turn it was bought (`consumeDev`), and only one dev card per
  turn (`st.devPlayed`, reset by `endTurn`). VP cards are never "played": they
  count silently in `vp()`.
- `st.freeRoads` drives road building (2 free roads). The UI derives free-road
  targets from STATE (not local mode), so it works in online rooms too.
- `longestRoadLen(st, pid)` = DFS with backtracking over the player's own
  edges; enemy buildings block passage through a vertex. `refreshLongestRoad`
  runs after every road or settlement placement: holder keeps ties, 5+ edges
  to take it, losing it when cut or beaten.
- Largest army: `p.knights` counts played knights; 3+ takes it, only a
  strictly higher count steals it, ties keep the holder (`updateLargestArmy`).
- `p.hasLongestRoad` / `p.hasLargestArmy` live ON the player so `vp(p)` stays
  a pure player function; `st.longestRoad` / `st.largestArmy` keep the holder
  pid for the log/tie logic. Chips show 🛣️/⚔️ badges.

## Testing

`node --test tests/rules.test.mjs` — engine only, no browser, no deps
(node:test + node:assert). Conventions there:

- `startGame(seed)` plays the full snake setup deterministically and returns a
  state in `roll` phase, current player 0.
- `forceRoll(st, sum)` overrides `st.rng` to force a dice sum (7 → discard/robber flow).
- Tests may set up state directly (`p.settlements.push(vid)`) — that is fine
  for focused rule tests; clear setup-granted resources with
  `G.RESOURCES.forEach(r => p.res[r] = 0)` when counting cards.
- Building/trading outside the normal flow requires `st.phase = 'main'`.
- Add a regression test for every reported bug before fixing it.

## Gotchas (all hit for real — don't rediscover them)

- **SVG + CSS `transform` animations pivot at the viewBox origin**, so scale
  pulses make elements fly across the board. Animate `opacity` only.
- **`[hidden]` is beaten by any CSS `display`** on the same element. A global
  `[hidden] { display: none !important; }` exists in styles.css — keep it.
- **Vertex dedup keys must be sign-safe**: use `Math.round(x * 10)` in the key.
  `toFixed(1)` yields `"-0.0"` vs `"0.0"` for the same corner (cos(±90°) float
  residues), which split two island corners, corrupted the 30-edge perimeter
  into 38, and gave some ports two 1-hex access vertices.
- **The island coast is 30 vertices** (18 touch 1 hex, 12 touch 2), not 18 —
  perimeter = 114 total edges − 2×42 internal adjacencies. Port frame is FIXED
  (same positions and types every game): on the coastal cycle the 9 ports sit
  at cycle starts `[0,3,6,10,13,16,20,23,26]` — the `ppn ppn ppn nn` rhythm —
  so every port covers one 1-hex + one 2-hex adjacent vertex pair. The test
  suite enforces all of this; if a port test fails, suspect the geometry first.
- **Production pays every building** adjacent to the rolled hex (settlement 1,
  city 2, multiple buildings stack), to all players. In hot-seat the hand panel
  shows only the current player, so production visibility depends on the log
  lines and the "+N" hex badges — keep them working.
- **Dice panel is the roll button** (bottom-right, floating). Placeholder shows
  6+6=12 dimmed before the first roll; `.attn` flashes when it's your turn to
  roll. The sidebar has no roll button by design.
- Reading `window.__hexland.game` in tests: do it **after** clicking Jugar;
  call `H.refresh()` after mutating state from the console.

## Visual reference

colonist.io is the layout/style reference (Fran supplies screenshots/video:
full-screen board, bottom bar with piece-count square buttons, cream right
panel with chat-style log + bank stacks, floating dice, ships for ports).
Keep improving toward that look; do not copy their assets.

## Roadmap (in order)

1. ~~Online rooms via PeerJS~~ (done, v0.2) — next: TURN fallback for strict
   CGNAT networks, state filtering (don't leak other hands to clients),
   host migration / reconnect.
2. Player-to-player trading (offers/counteroffers).
3. ~~Dev cards, largest army, longest road~~ (done 2026-10-12, `WIN_VP = 10`).
