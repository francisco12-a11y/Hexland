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
```

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
- `WIN_VP = 8` on purpose: buildings alone cap at 9 PV (1 settlement + 4
  cities). Raise to 10 only when dev cards + longest road + largest army exist.
- Settlement placement: the vertex itself must touch one of the player's roads
  (be an endpoint), not merely be adjacent to the network. After setup there
  are no valid spots until a road is extended (road endpoints hug the player's
  own settlements, blocked by the distance rule) — that is correct, don't
  "fix" it.

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

1. **Online rooms via PeerJS**: host-authoritative — the host runs `game.js`,
   clients send action requests, host validates with the same functions and
   broadcasts full state JSON (~KBs). `render.js` renders remote state
   unchanged. The engine being DOM-free is what makes this possible; keep it
   that way.
2. Player-to-player trading (offers/counteroffers).
3. Dev cards, knight, largest army, longest road → then `WIN_VP = 10`.
4. Host migration / reconnect.
