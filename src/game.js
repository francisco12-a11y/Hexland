// Hexland — pure rules engine. State in, state mutated, {ok, err} out.
// No DOM here so the same logic can later run on the P2P host.

import { generateBoard, mulberry32 } from './board.js';

export const RESOURCES = ['wood', 'brick', 'sheep', 'wheat', 'ore'];
export const RES_EMOJI = { wood: '🌲', brick: '🧱', sheep: '🐑', wheat: '🌾', ore: '⛰️' };
export const TERRAIN_RES = { hills: 'brick', forest: 'wood', mountains: 'ore', fields: 'wheat', pasture: 'sheep' };

export const COSTS = {
  road: { brick: 1, wood: 1 },
  settlement: { brick: 1, wood: 1, sheep: 1, wheat: 1 },
  city: { ore: 3, wheat: 2 },
};
export const COST_LABEL = {
  road: '1🧱 1🌲',
  settlement: '1🧱 1🌲 1🐑 1🌾',
  city: '3⛰️ 2🌾',
};
const STOCK = { road: 15, settlement: 5, city: 4 };

export const PLAYER_COLORS = ['#e63946', '#457b9d', '#f4a261', '#a78bfa'];
export const WIN_VP = 10;

const OK = { ok: true };
const err = (msg) => ({ ok: false, err: msg });
const log = (st, msg) => st.log.push(msg);

const totalCards = (p) => RESOURCES.reduce((s, r) => s + p.res[r], 0);
const canPay = (p, cost) => Object.entries(cost).every(([r, k]) => p.res[r] >= k);
const pay = (p, cost) => Object.entries(cost).forEach(([r, k]) => (p.res[r] -= k));

export function newGame(names, seed = Date.now() % 2 ** 31, colors = null) {
  const board = generateBoard(seed);
  const players = names.map((name, i) => ({
    id: i, name: name || `Jugador ${i + 1}`, color: PLAYER_COLORS[colors?.[i] ?? i],
    res: { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 },
    roads: [], settlements: [], cities: [],
  }));
  const n = players.length;
  const keys = [...Array(n).keys()];
  const setupQueue = [...keys, ...keys.slice().reverse()];
  return {
    board, players, seed,
    rng: mulberry32((seed ^ 0x9e3779b9) >>> 0),
    current: setupQueue[0], setupQueue, setupIdx: 0, lastSetupVertex: null,
    phase: 'setup', // setup | roll | main | discard | robber | over
    pendingDiscards: [],
    dice: null, turn: 1, winner: null,
    lastProduced: [],
    robber: board.robber,
    log: [`⬡ Partida creada — semilla ${seed}`],
  };
}

export const vp = (p) => p.settlements.length + 2 * p.cities.length;

// vertices reachable through own roads; enemy buildings block pass-through
export function ownNetwork(st, pid) {
  const p = st.players[pid];
  const enemyAt = (vid) =>
    st.players.some((q) => q.id !== pid && (q.settlements.includes(vid) || q.cities.includes(vid)));
  const seen = new Set([...p.settlements, ...p.cities]);
  const stack = [...seen];
  while (stack.length) {
    const v = stack.pop();
    if (enemyAt(v)) continue;
    for (const eid of st.board.vertices[v].edges) {
      const e = st.board.edges[eid];
      if (!p.roads.includes(eid)) continue;
      const other = e.a === v ? e.b : e.a;
      if (!seen.has(other)) { seen.add(other); stack.push(other); }
    }
  }
  return seen;
}

const allBuildings = (st) => {
  const s = new Set();
  for (const p of st.players) { p.settlements.forEach((v) => s.add(v)); p.cities.forEach((v) => s.add(v)); }
  return s;
};

export function settlementSpots(st, pid, setup) {
  const occ = allBuildings(st);
  const net = setup ? null : ownNetwork(st, pid);
  const spots = [];
  for (const v of st.board.vertices) {
    if (occ.has(v.id)) continue;
    if (v.neighbors.some((n) => occ.has(n))) continue; // distance rule
    if (setup || v.edges.some((eid) => {
      const e = st.board.edges[eid];
      return (e.a === v.id && net.has(e.b)) || (e.b === v.id && net.has(e.a));
    })) spots.push(v.id);
  }
  return spots;
}

const roadTaken = (st, eid) => st.players.some((p) => p.roads.includes(eid));

export function roadSpots(st, pid) {
  const net = ownNetwork(st, pid);
  const spots = [];
  for (const e of st.board.edges) {
    if (roadTaken(st, e.id)) continue;
    if (net.has(e.a) || net.has(e.b)) spots.push(e.id);
  }
  return spots;
}

export function setupRoadSpots(st, pid) {
  const v = st.lastSetupVertex;
  if (v == null) return [];
  return st.board.vertices[v].edges.filter((eid) => !roadTaken(st, eid));
}

export function citySpots(st, pid) {
  return st.players[pid].settlements.slice();
}

// ---------- setup phase ----------

export function placeSetupSettlement(st, vid) {
  if (st.phase !== 'setup') return err('No es la fase de colocación');
  const pid = st.setupQueue[st.setupIdx];
  if (!settlementSpots(st, pid, true).includes(vid)) return err('Lugar inválido');
  const p = st.players[pid];
  p.settlements.push(vid);
  st.lastSetupVertex = vid;
  log(st, `🏠 ${p.name} fundó un asentamiento.`);
  // second pass: collect one resource per adjacent hex
  if (st.setupIdx >= st.players.length) {
    for (const hid of st.board.vertices[vid].hexes) {
      const hex = st.board.hexes[hid];
      if (hex.terrain !== 'desert') p.res[TERRAIN_RES[hex.terrain]]++;
    }
  }
  return OK;
}

export function placeSetupRoad(st, eid) {
  if (st.phase !== 'setup') return err('No es la fase de colocación');
  const pid = st.setupQueue[st.setupIdx];
  if (!setupRoadSpots(st, pid).includes(eid)) return err('Camino inválido');
  const p = st.players[pid];
  p.roads.push(eid);
  log(st, `🛣️ ${p.name} construyó un camino.`);
  st.setupIdx++;
  if (st.setupIdx >= st.setupQueue.length) {
    st.phase = 'roll';
    st.current = 0;
    st.lastSetupVertex = null;
    log(st, `🏁 Colocación lista. ¡Arranca ${st.players[0].name}!`);
  } else {
    st.current = st.setupQueue[st.setupIdx];
  }
  return OK;
}

// ---------- turn phases ----------

export function rollDice(st) {
  if (st.phase !== 'roll') return err('No podés tirar ahora');
  const d1 = 1 + Math.floor(st.rng() * 6);
  const d2 = 1 + Math.floor(st.rng() * 6);
  st.dice = [d1, d2];
  const sum = d1 + d2;
  st.lastProduced = st.board.hexes.filter((h) => h.number === sum).map((h) => h.id);
  log(st, `🎲 ${st.players[st.current].name} tiró ${d1} + ${d2} = ${sum}.`);
  if (sum === 7) {
    st.pendingDiscards = st.players.filter((p) => totalCards(p) > 7).map((p) => p.id);
    if (st.pendingDiscards.length) {
      st.phase = 'discard';
      log(st, `🃏 ¡Siete! Los que tengan más de 7 cartas descartan la mitad.`);
    } else {
      st.phase = 'robber';
      log(st, `🦹 ¡Siete! Mové al ladrón.`);
    }
  } else {
    produce(st, sum);
    st.phase = 'main';
  }
  return { ok: true, sum };
}

function produce(st, sum) {
  for (const hex of st.board.hexes) {
    if (hex.number !== sum || hex.terrain === 'desert' || st.robber === hex.id) continue;
    for (const vid of hex.vertices) {
      for (const p of st.players) {
        if (p.settlements.includes(vid)) p.res[TERRAIN_RES[hex.terrain]] += 1;
        else if (p.cities.includes(vid)) p.res[TERRAIN_RES[hex.terrain]] += 2;
      }
    }
  }
}

export const requiredDiscard = (p) => Math.floor(totalCards(p) / 2);

export function discard(st, pid, cards) {
  const p = st.players[pid];
  let n = 0;
  for (const [r, k] of Object.entries(cards)) {
    if (k > p.res[r]) return err('Conteo inválido');
    n += k;
  }
  if (n !== requiredDiscard(p)) return err(`Tenés que descartar ${requiredDiscard(p)}`);
  for (const [r, k] of Object.entries(cards)) p.res[r] -= k;
  st.pendingDiscards = st.pendingDiscards.filter((id) => id !== pid);
  log(st, `🃏 ${p.name} descartó ${n} carta${n === 1 ? '' : 's'}.`);
  if (!st.pendingDiscards.length) st.phase = 'robber';
  return OK;
}

export function robberSpots(st) {
  return st.board.hexes.filter((h) => h.id !== st.robber).map((h) => h.id);
}

export function moveRobber(st, hid) {
  if (st.phase !== 'robber') return err('No podés mover al ladrón ahora');
  if (hid === st.robber) return err('Tiene que ir a otro hexágono');
  st.robber = hid;
  log(st, `🦹 ${st.players[st.current].name} movió al ladrón.`);
  st.phase = 'main';
  return { ok: true, victims: stealVictims(st) };
}

export function stealVictims(st) {
  const me = st.current;
  const vids = new Set(st.board.hexes.find((h) => h.id === st.robber).vertices);
  const out = [];
  for (const p of st.players) {
    if (p.id === me || !totalCards(p)) continue;
    if (p.settlements.some((v) => vids.has(v)) || p.cities.some((v) => vids.has(v))) out.push(p.id);
  }
  return out;
}

export function stealFrom(st, victimPid) {
  const me = st.players[st.current], victim = st.players[victimPid];
  const pool = [];
  for (const r of RESOURCES) for (let i = 0; i < victim.res[r]; i++) pool.push(r);
  if (!pool.length) return err('No tiene cartas');
  const card = pool[Math.floor(st.rng() * pool.length)];
  victim.res[card]--; me.res[card]++;
  log(st, `🤏 ${me.name} le robó una carta a ${victim.name}.`);
  return { ok: true, card };
}

// ---------- building & trading ----------

export function buildRoad(st, eid) {
  if (st.phase !== 'main') return err('Todavía no podés construir');
  const pid = st.current, p = st.players[pid];
  if (p.roads.length >= STOCK.road) return err('No quedan caminos');
  if (!roadSpots(st, pid).includes(eid)) return err('Camino inválido');
  if (!canPay(p, COSTS.road)) return err('Te faltan recursos');
  pay(p, COSTS.road);
  p.roads.push(eid);
  log(st, `🛣️ ${p.name} construyó un camino.`);
  return OK;
}

export function buildSettlement(st, vid) {
  if (st.phase !== 'main') return err('Todavía no podés construir');
  const pid = st.current, p = st.players[pid];
  if (p.settlements.length >= STOCK.settlement) return err('No quedan asentamientos');
  if (!settlementSpots(st, pid, false).includes(vid)) return err('Lugar inválido (regla de distancia o desconectado)');
  if (!canPay(p, COSTS.settlement)) return err('Te faltan recursos');
  pay(p, COSTS.settlement);
  p.settlements.push(vid);
  log(st, `🏠 ${p.name} fundó un asentamiento (${vp(p)} PV).`);
  return checkWin(st, p);
}

export function buildCity(st, vid) {
  if (st.phase !== 'main') return err('Todavía no podés construir');
  const pid = st.current, p = st.players[pid];
  if (p.cities.length >= STOCK.city) return err('No quedan ciudades');
  if (!citySpots(st, pid).includes(vid)) return err('Necesitás uno de tus asentamientos');
  if (!canPay(p, COSTS.city)) return err('Te faltan recursos');
  pay(p, COSTS.city);
  p.settlements = p.settlements.filter((v) => v !== vid);
  p.cities.push(vid);
  log(st, `🏛️ ${p.name} fundó una ciudad (${vp(p)} PV).`);
  return checkWin(st, p);
}

function checkWin(st, p) {
  if (vp(p) >= WIN_VP) {
    st.phase = 'over';
    st.winner = p.id;
    log(st, `🏆 ¡${p.name} ganó con ${vp(p)} puntos de victoria!`);
  }
  return OK;
}

export function tradeRate(st, pid, giveRes) {
  let rate = 4;
  const p = st.players[pid];
  for (const port of st.board.ports) {
    const touched = port.vids.some((v) => p.settlements.includes(v) || p.cities.includes(v));
    if (!touched) continue;
    if (port.type === '3:1') rate = Math.min(rate, 3);
    else if (port.type === giveRes) rate = Math.min(rate, 2);
  }
  return rate;
}

export function bankTrade(st, give, get) {
  if (st.phase !== 'main') return err('Solo podés comerciar en tu turno');
  const p = st.players[st.current];
  if (give === get) return err('Elegí recursos distintos');
  const rate = tradeRate(st, p.id, give);
  if (p.res[give] < rate) return err(`Necesitás ${rate} de ese recurso`);
  p.res[give] -= rate;
  p.res[get] += 1;
  log(st, `🔁 ${p.name} cambió ${rate}× ${RES_EMOJI[give]} por 1× ${RES_EMOJI[get]} con el banco.`);
  return OK;
}

export function endTurn(st) {
  if (st.phase !== 'main') return err('Terminá lo pendiente antes');
  st.current = (st.current + 1) % st.players.length;
  if (st.current === 0) st.turn++;
  st.phase = 'roll';
  st.dice = null;
  log(st, `— Turno ${st.turn}: ${st.players[st.current].name} —`);
  return { ok: true, next: st.current };
}
