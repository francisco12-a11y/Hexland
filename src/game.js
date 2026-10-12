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
  dev: { sheep: 1, wheat: 1, ore: 1 },
};
export const COST_LABEL = {
  road: '1🧱 1🌲',
  settlement: '1🧱 1🌲 1🐑 1🌾',
  city: '3⛰️ 2🌾',
  dev: '1🐑 1🌾 1⛰️',
};
const STOCK = { road: 15, settlement: 5, city: 4 };

// mazo estándar de 25 cartas de desarrollo
export const DEV_EMOJI = { knight: '⚔️', vp: '🏆', roadbuilding: '🛣️', yoplenty: '🎁', monopoly: '💰' };
export const DEV_NAME = {
  knight: 'Caballero', vp: 'Punto de Victoria', roadbuilding: 'Construcción de Caminos',
  yoplenty: 'Año de Abundancia', monopoly: 'Monopolio',
};
const DEV_DECK = [
  ...Array(14).fill('knight'),
  ...Array(5).fill('vp'),
  ...Array(2).fill('roadbuilding'),
  ...Array(2).fill('yoplenty'),
  ...Array(2).fill('monopoly'),
];

export const PLAYER_COLORS = ['#e63946', '#457b9d', '#f4a261', '#a78bfa'];
export const WIN_VP = 10;

const OK = { ok: true };
const err = (msg) => ({ ok: false, err: msg });
const log = (st, msg) => st.log.push(msg);

const totalCards = (p) => RESOURCES.reduce((s, r) => s + p.res[r], 0);
const canPay = (p, cost) => Object.entries(cost).every(([r, k]) => p.res[r] >= k);
const pay = (p, cost) => Object.entries(cost).forEach(([r, k]) => (p.res[r] -= k));

export function newGame(names, seed = Date.now() % 2 ** 31, colors = null, map = 'clasico', winVp = WIN_VP) {
  const board = generateBoard(seed, map);
  const players = names.map((name, i) => ({
    id: i, name: name || `Jugador ${i + 1}`, color: PLAYER_COLORS[colors?.[i] ?? i],
    res: { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 },
    roads: [], settlements: [], cities: [],
    devs: [], knights: 0, hasLargestArmy: false, hasLongestRoad: false,
  }));
  const n = players.length;
  const keys = [...Array(n).keys()];
  const setupQueue = [...keys, ...keys.slice().reverse()];
  const rng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  return {
    board, players, seed, map, winVp,
    revealed: [], // niebla: ids de hexes ya descubiertos (mapa niebla)
    rng,
    devDeck: shuffleDev(DEV_DECK.slice(), rng),
    current: setupQueue[0], setupQueue, setupIdx: 0, lastSetupVertex: null,
    phase: 'setup', // setup | roll | main | discard | robber | over
    pendingDiscards: [],
    dice: null, turn: 1, winner: null,
    lastProduced: [], lastGain: {},
    stealCandidates: [], // a quién puede robar quien movió al ladrón (deriva UI)
    pendingGold: [],     // oro: [{pid, count}] — elecciones de recurso pendientes
    tradeOffer: null,    // comercio abierto: {id, from, give, get} esperando aceptación
    tradeSeq: 0,
    lastRollWas7: false, // regla de casa: no permite dos 7 seguidos
    devPlayed: false,    // una sola carta de desarrollo por turno
    freeRoads: 0,        // caminos gratis pendientes (construcción de caminos)
    largestArmy: null, largestArmySize: 0,
    longestRoad: null, longestRoadLen: 0,
    robber: board.robber,
    log: [`⬡ Partida creada — semilla ${seed}`],
  };
}

// Fisher-Yates local (no importa el shuffle genérico de board.js: este deck
// vive en game.js para que las pruebas puedan espiarlo)
function shuffleDev(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// niebla: hex oculto = marcado con fog y todavía no descubierto
export const hexHidden = (st, hid) => {
  const hex = st.board.hexes[hid];
  return !!hex.fog && !st.revealed.includes(hid);
};

const FOG_TERRAIN_LABEL = {
  forest: '🌲 un Bosque', hills: '🧱 una Ladera', pasture: '🐑 una Pradera',
  fields: '🌾 unos Sembradíos', mountains: '⛰️ una Montaña', desert: '🏜️ un Desierto',
};

// revela los hexes con niebla que tocan el camino recién construido
function revealByRoad(st, eid) {
  const p = st.players[st.current];
  for (const hid of st.board.edges[eid].hexes) {
    if (!hexHidden(st, hid)) continue;
    st.revealed.push(hid);
    const hex = st.board.hexes[hid];
    const ficha = hex.number ? ` con ficha ${hex.number}` : '';
    // recompensa de descubrimiento: 1 recurso del hex revelado
    const res = TERRAIN_RES[hex.terrain];
    log(st, `🌫️ ${p.name} descubrió ${FOG_TERRAIN_LABEL[hex.terrain] || hex.terrain}${ficha}${res ? ` (+1 ${RES_EMOJI[res]})` : ''}.`);
    if (res) p.res[res]++;
  }
}

// PV visibles: edificios + cartas de PV (cuentan en silencio, como en Colonist)
// + los dos bonus de 2 PV.
export const vp = (p) =>
  p.settlements.length + 2 * p.cities.length
  + p.devs.filter((c) => c.t === 'vp').length
  + (p.hasLargestArmy ? 2 : 0)
  + (p.hasLongestRoad ? 2 : 0);

// vértices conectados a la red del jugador: sus edificios + los extremos de
// sus caminos. Todo lo que construya tiene que tocar esta red.
function connectedSet(st, pid) {
  const p = st.players[pid];
  const s = new Set([...p.settlements, ...p.cities]);
  for (const eid of p.roads) {
    const e = st.board.edges[eid];
    s.add(e.a);
    s.add(e.b);
  }
  return s;
}

const allBuildings = (st) => {
  const s = new Set();
  for (const p of st.players) { p.settlements.forEach((v) => s.add(v)); p.cities.forEach((v) => s.add(v)); }
  return s;
};

export function settlementSpots(st, pid, setup) {
  const occ = allBuildings(st);
  const mine = setup ? null : connectedSet(st, pid);
  // volcán: en la primera pasada solo se funda sobre casillas de recurso
  // variable (R) — prohibido piedra, oro, desierto y niebla
  const firstPass = setup && st.setupIdx < st.players.length;
  const needPlain = firstPass && st.board.firstRoundPlain;
  const spots = [];
  for (const v of st.board.vertices) {
    if (occ.has(v.id)) continue;
    if (v.neighbors.some((n) => occ.has(n))) continue; // distance rule
    // niebla: no se puede poblar un vértice que toque un hex sin descubrir
    if (v.hexes.some((hid) => hexHidden(st, hid))) continue;
    if (needPlain && !v.hexes.some((hid) => st.board.hexes[hid].plain)) continue;
    // el vértice mismo debe ser extremo de un camino propio (no alcanza
    // con estar a un paso de la red)
    if (setup || mine.has(v.id)) spots.push(v.id);
  }
  return spots;
}

const roadTaken = (st, eid) => st.players.some((p) => p.roads.includes(eid));

export function roadSpots(st, pid) {
  const mine = connectedSet(st, pid);
  const spots = [];
  for (const e of st.board.edges) {
    if (roadTaken(st, e.id)) continue;
    if (mine.has(e.a) || mine.has(e.b)) spots.push(e.id);
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
  revealByRoad(st, eid);
  st.lastSetupVertex = null; // el paso termina: el siguiente jugador coloca asentamiento
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
  // regla de casa: el 7 no sale dos veces seguidas (se repite el tiro)
  let d1, d2, sum, attempts = 0;
  do {
    d1 = 1 + Math.floor(st.rng() * 6);
    d2 = 1 + Math.floor(st.rng() * 6);
    sum = d1 + d2;
    attempts++;
    if (sum === 7 && st.lastRollWas7 && attempts > 1) {
      log(st, '🎲 ¡Siete otra vez! Se repite el tiro.');
    }
  } while (sum === 7 && st.lastRollWas7 && attempts < 6);
  st.lastRollWas7 = sum === 7;
  st.dice = [d1, d2];
  st.lastProduced = st.board.hexes
    .filter((h) => h.number === sum && !hexHidden(st, h.id))
    .map((h) => h.id);
  st.lastGain = {};
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
  st.lastGain = {};
  const per = {}; // pid -> { recurso: cantidad }
  for (const hex of st.board.hexes) {
    if (hex.number !== sum || hex.terrain === 'desert' || st.robber === hex.id) continue;
    if (hexHidden(st, hex.id)) continue; // niebla: sin descubrir no produce
    // oro: no da una carta fija — el dueño del edificio elige recurso después
    if (hex.terrain === 'gold') {
      let n = 0;
      for (const vid of hex.vertices) {
        for (const p of st.players) {
          const k = p.settlements.includes(vid) ? 1 : p.cities.includes(vid) ? 2 : 0;
          if (!k) continue;
          n += k;
          const entry = st.pendingGold.find((g) => g.pid === p.id);
          if (entry) entry.count += k;
          else st.pendingGold.push({ pid: p.id, count: k });
          log(st, `🪙 ${p.name} ganó oro: puede elegir ${k} recurso${k > 1 ? 's' : ''} (madera, trigo, ladrillo o piedra).`);
        }
      }
      if (n) st.lastGain[hex.id] = { n, res: 'gold' };
      continue;
    }
    let hexGain = 0;
    for (const vid of hex.vertices) {
      for (const p of st.players) {
        // cada edificio junto al hex cobra: pueblo 1, ciudad 2 (aunque sean varios del mismo dueño)
        const n = p.settlements.includes(vid) ? 1 : p.cities.includes(vid) ? 2 : 0;
        if (!n) continue;
        const res = TERRAIN_RES[hex.terrain];
        p.res[res] += n;
        hexGain += n;
        (per[p.id] ??= {});
        per[p.id][res] = (per[p.id][res] || 0) + n;
      }
    }
    if (hexGain) st.lastGain[hex.id] = { n: hexGain, res: TERRAIN_RES[hex.terrain] };
  }
  // deja rastro de quién cobró qué: en pass & play la mano del resto está oculta
  for (const [pid, gains] of Object.entries(per)) {
    const detail = Object.entries(gains).map(([r, n]) => `${RES_EMOJI[r]}×${n}`).join(' ');
    log(st, `📦 ${st.players[pid].name} recibió ${detail}.`);
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
  return st.board.hexes
    .filter((h) => h.id !== st.robber && !hexHidden(st, h.id))
    .map((h) => h.id);
}

export function moveRobber(st, hid) {
  if (st.phase !== 'robber') return err('No podés mover al ladrón ahora');
  if (hid === st.robber) return err('Tiene que ir a otro hexágono');
  st.robber = hid;
  log(st, `🦹 ${st.players[st.current].name} movió al ladrón.`);
  st.phase = 'main';
  st.stealCandidates = stealVictims(st);
  return { ok: true, victims: st.stealCandidates };
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
  st.stealCandidates = [];
  return { ok: true, card };
}

// ---------- cartas de desarrollo ----------

export function buyDev(st) {
  if (st.phase !== 'main') return err('Solo podés comprar en tu turno principal');
  if (!st.devDeck.length) return err('No quedan cartas de desarrollo');
  const p = st.players[st.current];
  if (!canPay(p, COSTS.dev)) return err('Te faltan recursos (1🐑 1🌾 1⛰️)');
  pay(p, COSTS.dev);
  const t = st.devDeck.pop();
  p.devs.push({ t, turn: st.turn });
  log(st, `🃏 ${p.name} compró una carta de desarrollo.`);
  return checkWin(st, p); // una carta de PV puede cerrar la partida en el acto
}

// valida y consume la carta idx del mazo del jugador activo; una por turno y
// nunca la comprada en el turno en curso
function consumeDev(st, idx, type) {
  if (st.phase !== 'main') return err('Jugá las cartas en tu turno principal');
  if (st.devPlayed) return err('Ya jugaste una carta de desarrollo este turno');
  const p = st.players[st.current];
  const card = p.devs[idx];
  if (!card || card.t !== type) return err('No tenés esa carta');
  if (card.turn >= st.turn) return err('La compraste este turno: jugala en el próximo');
  p.devs.splice(idx, 1);
  st.devPlayed = true;
  return OK;
}

export function playKnight(st, idx) {
  const c = consumeDev(st, idx, 'knight');
  if (!c.ok) return c;
  const p = st.players[st.current];
  p.knights++;
  const msg = updateLargestArmy(st);
  log(st, `⚔️ ${p.name} jugó un Caballero (${p.knights} en total).`);
  if (msg) log(st, msg);
  const win = checkWin(st, p);
  if (st.phase === 'over') return win;
  st.phase = 'robber';
  st.stealCandidates = [];
  log(st, `🦹 Mové al ladrón.`);
  return OK;
}

export function playRoadBuilding(st, idx) {
  const c = consumeDev(st, idx, 'roadbuilding');
  if (!c.ok) return c;
  st.freeRoads = 2;
  log(st, `🛣️ ${st.players[st.current].name} jugó Construcción de Caminos: 2 caminos gratis.`);
  return OK;
}

export function playYearOfPlenty(st, idx, r1, r2) {
  const c = consumeDev(st, idx, 'yoplenty');
  if (!c.ok) return c;
  if (!RESOURCES.includes(r1) || !RESOURCES.includes(r2)) return err('Elegí dos recursos');
  const p = st.players[st.current];
  p.res[r1]++; p.res[r2]++;
  log(st, `🎁 ${p.name} jugó Año de Abundancia: ${RES_EMOJI[r1]}${r1 === r2 ? '×2' : ` + ${RES_EMOJI[r2]}`}.`);
  return OK;
}

export function playMonopoly(st, idx, res) {
  const c = consumeDev(st, idx, 'monopoly');
  if (!c.ok) return c;
  if (!RESOURCES.includes(res)) return err('Elegí un recurso');
  let taken = 0;
  const me = st.players[st.current];
  for (const q of st.players) {
    if (q.id === me.id) continue;
    taken += q.res[res];
    q.res[res] = 0;
  }
  me.res[res] += taken;
  log(st, `💰 ${me.name} jugó Monopolio: se llevó ${taken}× ${RES_EMOJI[res]}.`);
  return OK;
}

function updateLargestArmy(st) {
  const p = st.players[st.current];
  if (p.knights < 3) return null;
  if (st.largestArmy === p.id) { st.largestArmySize = p.knights; return null; }
  if (st.largestArmy != null && p.knights <= st.largestArmySize) return null;
  if (st.largestArmy != null) st.players[st.largestArmy].hasLargestArmy = false;
  st.largestArmy = p.id;
  st.largestArmySize = p.knights;
  p.hasLargestArmy = true;
  return `⚔️ ${p.name} tomó el Ejército Más Grande (+2 PV).`;
}

// ---------- camino comercial ----------

// camino más largo del jugador: DFS con backtracking sobre sus propias aristas.
// Un edificio enemigo en un vértice corta el paso (el camino toca, pero no
// atraviesa). Con ≤15 aristas por jugador el backtracking es trivial.
export function longestRoadLen(st, pid) {
  const p = st.players[pid];
  if (p.roads.length === 0) return 0;
  const edges = p.roads.map((eid) => st.board.edges[eid]);
  const atV = new Map();
  edges.forEach((e, i) => {
    for (const vid of [e.a, e.b]) {
      if (!atV.has(vid)) atV.set(vid, []);
      atV.get(vid).push(i);
    }
  });
  const blocked = new Set();
  for (const q of st.players) {
    if (q.id === pid) continue;
    q.settlements.forEach((v) => blocked.add(v));
    q.cities.forEach((v) => blocked.add(v));
  }
  const used = new Array(edges.length).fill(false);
  let best = 0;
  const dfs = (ei, len) => {
    if (len > best) best = len;
    const e = edges[ei];
    for (const vid of [e.a, e.b]) {
      if (blocked.has(vid)) continue;
      for (const j of atV.get(vid) || []) {
        if (used[j]) continue;
        used[j] = true;
        dfs(j, len + 1);
        used[j] = false;
      }
    }
  };
  for (let i = 0; i < edges.length; i++) {
    used[i] = true;
    dfs(i, 1);
    used[i] = false;
  }
  return best;
}

// recalcula el título tras cada camino o asentamiento. El titular conserva el
// empate; 5+ aristas para tomarlo; perderlo si te lo cortan o te lo superan.
// (exportada para las pruebas: los tests de motor manipulan el estado directo)
export function refreshLongestRoad(st) {
  const lens = st.players.map((_, i) => longestRoadLen(st, i));
  let bestPid = null, bestLen = 0;
  lens.forEach((len, i) => { if (len >= 5 && len > bestLen) { bestLen = len; bestPid = i; } });
  const cur = st.longestRoad;
  if (cur != null && bestPid !== cur && lens[cur] >= 5 && lens[bestPid] === lens[cur]) bestPid = cur;
  if (bestPid !== cur) {
    if (cur != null) st.players[cur].hasLongestRoad = false;
    st.longestRoad = bestPid;
    st.longestRoadLen = bestPid != null ? bestLen : 0;
    if (bestPid != null) {
      st.players[bestPid].hasLongestRoad = true;
      log(st, `🛣️ ${st.players[bestPid].name} tomó el Camino Comercial (${bestLen} caminos, +2 PV).`);
      const w = st.players[bestPid];
      if (vp(w) >= (st.winVp || WIN_VP) && st.phase !== 'over') checkWin(st, w);
    } else {
      log(st, `🛣️ ${st.players[cur].name} perdió el Camino Comercial.`);
    }
  } else if (cur != null) {
    st.longestRoadLen = lens[cur];
  }
}

// ---------- building & trading ----------

export function buildRoad(st, eid) {
  if (st.phase !== 'main') return err('Todavía no podés construir');
  const pid = st.current, p = st.players[pid];
  if (p.roads.length >= STOCK.road) return err('No quedan caminos');
  if (!roadSpots(st, pid).includes(eid)) return err('Camino inválido');
  const free = st.freeRoads > 0;
  if (!free) {
    if (!canPay(p, COSTS.road)) return err('Te faltan recursos');
    pay(p, COSTS.road);
  }
  p.roads.push(eid);
  if (free) st.freeRoads--;
  log(st, `🛣️ ${p.name} construyó un camino${free ? ' (gratis)' : ''}.`);
  revealByRoad(st, eid);
  refreshLongestRoad(st);
  return checkWin(st, p);
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
  refreshLongestRoad(st); // un edificio enemigo puede cortar el camino comercial
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
  if (vp(p) >= (st.winVp || WIN_VP)) {
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

// ---------- comercio entre jugadores ----------

// normaliza y valida un paquete de cartas {res: n}
function cleanPackage(st, pkg, pid, minTotal, checkHand = true) {
  const out = {};
  let total = 0;
  for (const [r, n] of Object.entries(pkg || {})) {
    if (!RESOURCES.includes(r) || !Number.isInteger(n) || n < 0) return null;
    if (n > 0) out[r] = n;
    total += n;
  }
  if (total < minTotal) return null;
  if (!checkHand) return out;
  const p = st.players[pid];
  for (const [r, n] of Object.entries(out)) {
    if (p.res[r] < n) return null;
  }
  return out;
}

export function proposeTrade(st, give, get) {
  if (st.phase !== 'main') return err('Solo podés comerciar en tu turno principal');
  const from = st.current;
  const g = cleanPackage(st, give, from, 1);
  if (!g) return err('Revisá qué ofrecés (no tenés esas cartas)');
  const k = cleanPackage(st, get, from, 1, false); // lo pedido no sale de tu mano
  if (!k) return err('Pedí al menos una carta');
  st.tradeOffer = { id: ++st.tradeSeq, from, give: g, get: k };
  log(st, `🤝 ${st.players[from].name} ofrece un intercambio: quien quiera, acepta.`);
  return OK;
}

// oferta ABIERTA: cualquier jugador distinto del oferente puede aceptar
export function respondTrade(st, accept, byPid) {
  const offer = st.tradeOffer;
  if (!offer) return err('No hay oferta pendiente');
  if (byPid === offer.from || !st.players[byPid]) return err('No podés aceptar tu propia oferta');
  if (st.phase !== 'main') return err('La oferta ya expiró');
  const fromP = st.players[offer.from], toP = st.players[byPid];
  if (!accept) return OK; // pasar no bloquea ni registra nada: sigue abierta para los demás
  const g = cleanPackage(st, offer.give, offer.from, 1);
  const k = cleanPackage(st, offer.get, byPid, 1);
  if (!g) return err(`${fromP.name} ya no tiene esas cartas`);
  if (!k) return err('Ya no tenés esas cartas');
  for (const [r, n] of Object.entries(g)) { fromP.res[r] -= n; toP.res[r] += n; }
  for (const [r, n] of Object.entries(k)) { toP.res[r] -= n; fromP.res[r] += n; }
  st.tradeOffer = null;
  const det = (p) => Object.entries(p).map(([r, n]) => `${RES_EMOJI[r]}×${n}`).join(' ');
  log(st, `🤝 ${toP.name} aceptó: ${fromP.name} dio ${det(g)} por ${det(k)}.`);
  return OK;
}

export function cancelTrade(st) {
  const offer = st.tradeOffer;
  if (!offer) return err('No hay oferta pendiente');
  st.tradeOffer = null;
  log(st, `🚫 ${st.players[offer.from].name} canceló su propuesta.`);
  return OK;
}

export const GOLD_CHOICES = ['wood', 'wheat', 'brick', 'ore']; // sin oveja, como pidió Fran

export function takeGold(st, res) {
  const entry = st.pendingGold[0];
  if (!entry) return err('No hay oro por cobrar');
  if (!GOLD_CHOICES.includes(res)) return err('Elegí madera, trigo, ladrillo o piedra');
  const p = st.players[entry.pid];
  p.res[res]++;
  entry.count--;
  log(st, `🪙 ${p.name} eligió ${RES_EMOJI[res]} con el oro.`);
  if (entry.count <= 0) st.pendingGold.shift();
  return OK;
}

export function endTurn(st) {
  if (st.phase !== 'main') return err('Terminá lo pendiente antes');
  if (st.pendingGold.length) return err('Cobrá el oro antes de terminar el turno');
  if (st.tradeOffer) return err('Esperá la respuesta al intercambio');
  st.current = (st.current + 1) % st.players.length;
  if (st.current === 0) st.turn++;
  st.phase = 'roll';
  st.dice = null;
  st.stealCandidates = [];
  st.devPlayed = false;
  st.freeRoads = 0; // los caminos gratis no se arrastran al turno siguiente
  st.tradeOffer = null; // las ofertas mueren con el turno
  log(st, `— Turno ${st.turn}: ${st.players[st.current].name} —`);
  return { ok: true, next: st.current };
}
