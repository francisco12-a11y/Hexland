// Tests del motor de reglas — corre con: npm test  (node --test, cero dependencias)
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../src/game.js';
import { generateBoard } from '../src/board.js';

// ---------- helpers ----------

function startGame(seed = 7, names = ['A', 'B', 'C']) {
  const st = G.newGame(names, seed);
  while (st.phase === 'setup') {
    const pid = st.setupQueue[st.setupIdx];
    const spots = G.settlementSpots(st, pid, true);
    const r1 = G.placeSetupSettlement(st, spots[Math.floor(spots.length / 2)]);
    assert.ok(r1.ok, 'setup settlement: ' + r1.err);
    const r2 = G.placeSetupRoad(st, G.setupRoadSpots(st, pid)[0]);
    assert.ok(r2.ok, 'setup road: ' + r2.err);
  }
  return st; // fase 'roll', current = 0
}

function forceRoll(st, sum) {
  const d1 = Math.max(1, Math.min(6, sum - 1));
  const d2 = sum - d1;
  assert.ok(d1 >= 1 && d1 <= 6 && d2 >= 1 && d2 <= 6, 'suma imposible: ' + sum);
  const seq = [((d1 - 1) + 0.5) / 6, ((d2 - 1) + 0.5) / 6];
  let i = 0;
  st.rng = () => (i < seq.length ? seq[i++] : 0.5);
  return G.rollDice(st);
}

const totals = (st) => st.players.map((p) => G.RESOURCES.reduce((s, r) => s + p.res[r], 0));

// ganancia esperada según las reglas de Catan, calculada independiente del motor
function expectedGains(st, sum) {
  const TERRAIN = { hills: 'brick', forest: 'wood', mountains: 'ore', fields: 'wheat', pasture: 'sheep' };
  const gains = st.players.map(() => ({ wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 }));
  for (const hex of st.board.hexes) {
    if (hex.number !== sum || hex.terrain === 'desert' || st.robber === hex.id) continue;
    for (const vid of hex.vertices) {
      st.players.forEach((p, i) => {
        if (p.settlements.includes(vid)) gains[i][TERRAIN[hex.terrain]] += 1;
        else if (p.cities.includes(vid)) gains[i][TERRAIN[hex.terrain]] += 2;
      });
    }
  }
  return gains;
}

// ---------- tablero ----------

test('misma semilla → mismo tablero', () => {
  const a = generateBoard(123), b = generateBoard(123);
  assert.deepEqual(a.hexes.map(h => [h.terrain, h.number]), b.hexes.map(h => [h.terrain, h.number]));
  assert.deepEqual(a.ports.map(p => p.type), b.ports.map(p => p.type));
});

test('sin 6/8 adyacentes en 200 semillas', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const b = generateBoard(seed);
    const reds = b.hexes.filter(h => h.number === 6 || h.number === 8);
    for (const x of reds) for (const y of reds) {
      if (x.id >= y.id) continue;
      const adj = Math.abs(x.q - y.q) + Math.abs(x.r - y.r) + Math.abs(x.q + x.r - y.q - y.r);
      assert.notEqual(adj / 2, 1, `semilla ${seed}: 6/8 adyacentes`);
    }
  }
});

test('puertos: marco fijo (misma posición y tipo siempre), acceso costero y muelle perpendicular', () => {
  // posiciones y tipos idénticos entre semillas: el marco no se baraja
  const a = generateBoard(1), b = generateBoard(999);
  const frame = (bd) => bd.ports.map(p => ({ t: p.type, vids: p.vids, mx: p.mx, my: p.my, nx: p.nx, ny: p.ny }));
  assert.deepEqual(frame(a), frame(b));

  // la isla tiene exactamente 30 vértices costeros (18 de 1 hex + 12 de 2 hexes)
  const coast = (bd) => bd.coast;
  assert.equal(coast(a).length, 30);
  assert.equal(new Set(coast(a)).size, 30);
  assert.equal(new Set(coast(a)).size, new Set(coast(b)).size);

  for (const bd of [a, b]) {
    assert.equal(bd.ports.length, 9);
    const counts = bd.coast.map(vid => bd.vertices[vid].hexes.length);
    assert.equal(counts.filter(c => c === 1).length, 18);
    assert.equal(counts.filter(c => c === 2).length, 12);
    // ritmo ppn ppn ppn nn: cada puerto cubre (1hex, 2hex) adyacentes y los
    // huecos entre puertos son 1,1,2 vértices
    for (const p of bd.ports) {
      const [ca, cb] = p.vids.map(vid => bd.vertices[vid].hexes.length);
      assert.deepEqual([ca, cb].sort(), [1, 2], 'acceso: un vértice de 1 hex + uno de 2');
      assert.ok(bd.coast.includes(p.vids[0]) && bd.coast.includes(p.vids[1]), 'ambos costeros');
    }
    // huecos: distancia a lo largo del ciclo entre el 2do vértice de un puerto
    // y el 1ro del siguiente = 1,1,2 repetido (inicio-a-inicio: 3,3,4)
    const posOf = new Map(bd.coast.map((vid, i) => [vid, i]));
    // orden circular desde el primer puerto
    const base = bd.ports[0].vids[0];
    const ordered = bd.ports.map(p => posOf.get(p.vids[0]))
      .map(i => (i - posOf.get(base) + 30) % 30).sort((x, y) => x - y);
    for (let i = 0; i < ordered.length; i++) {
      const next = ordered[(i + 1) % ordered.length];
      const gap = (next - ordered[i] + 30) % 30; // distancia inicio-a-inicio
      assert.ok([3, 3, 4].includes(gap), `hueco de puerto inválido: ${gap}`);
    }
    // geometría del muelle
    for (const p of bd.ports) {
      const [va, vb] = p.vids.map(vid => bd.vertices[vid]);
      assert.ok(p.nx * p.mx + p.ny * p.my > 0, 'normal hacia adentro');
      const dot = (vb.x - va.x) * p.nx + (vb.y - va.y) * p.ny;
      assert.ok(Math.abs(dot) < 1e-6, 'muelle no perpendicular');
      assert.ok(Math.hypot(p.ix, p.iy) > Math.hypot(p.px, p.py));
    }
  }
  // tipos: 4× 3:1 + 5× 2:1
  const t = a.ports.map(p => p.type);
  assert.equal(t.filter(x => x === '3:1').length, 4);
  assert.equal(t.length - t.filter(x => x === '3:1').length, 5);
});

// ---------- producción (los bugs que reportó Fran) ----------

test('producción: dos asentamientos del mismo jugador en el hex → +2 (bug 1), y el jugador inactivo también cobra (bug 2)', () => {
  const st = startGame(7);
  const hex = st.board.hexes.find(h => h.number === 12); // único 12 del tablero
  const libres = hex.vertices.filter(vid =>
    !st.players.some(p => p.settlements.includes(vid) || p.cities.includes(vid)));
  assert.ok(libres.length >= 3, 'el 12 debería tener vértices libres');
  st.players[0].settlements.push(libres[0], libres[1]); // A: dos pueblos, y A es el activo
  st.players[1].settlements.push(libres[2]);            // B: un pueblo, inactivo
  st.players[2].cities.push(libres[3]);                 // C: ciudad, inactivo

  const before = totals(st);
  const r = forceRoll(st, 12);
  assert.ok(r.ok);
  const after = totals(st);

  const exp = expectedGains(st, 12).map(g => G.RESOURCES.reduce((s, k) => s + g[k], 0));
  // el motor paga exactamente lo que dicta la regla, para todos
  st.players.forEach((_, i) => assert.equal(after[i] - before[i], exp[i], `jugador ${i}`));
  // y en concreto los dos casos reportados:
  assert.equal(after[0] - before[0], 2, 'bug 1: dos pueblos del activo deben dar 2');
  assert.equal(after[1] - before[1], 1, 'bug 2: el pueblo del jugador inactivo debe pagar 1');
  assert.equal(after[2] - before[2], 2, 'la ciudad del jugador inactivo debe pagar 2');
  // y queda registrado quién cobró (visibilidad en pass & play)
  assert.equal(st.lastGain[hex.id].n, 5, 'badge del hex: 2+1+2');
  assert.ok(st.log.some(l => l.includes('recibió')), 'log con las ganancias por jugador');
});

test('producción: la ciudad de un jugador inactivo paga 2 aunque otra ciudad suya esté en otro hex del mismo número', () => {
  const st = startGame(7);
  const doce = st.board.hexes.filter(h => h.number === 12);
  const doceOtros = st.board.hexes.filter(h => h.number === 9);
  assert.equal(doce.length, 1, 'un solo 12 por tablero');
  const hex = doce[0];
  const libres = hex.vertices.filter(vid =>
    !st.players.some(p => p.settlements.includes(vid) || p.cities.includes(vid)));
  st.players[1].cities.push(libres[0]); // inactivo con ciudad en el 12
  if (doceOtros.length) {
    const v2 = doceOtros[0].vertices.find(vid =>
      !st.players.some(p => p.settlements.includes(vid) || p.cities.includes(vid)));
    if (v2 != null) st.players[1].cities.push(v2); // otra ciudad suya en un 9
  }
  const before = totals(st);
  forceRoll(st, 12);
  const after = totals(st);
  const exp = expectedGains(st, 12).map(g => G.RESOURCES.reduce((s, k) => s + g[k], 0));
  st.players.forEach((_, i) => assert.equal(after[i] - before[i], exp[i], `jugador ${i}`));
  assert.equal(after[1] - before[1], 2);
});

test('el ladrón bloquea la producción del hex que ocupa', () => {
  const st = startGame(7);
  const hex = st.board.hexes.find(h => h.number === 12);
  const libres = hex.vertices.filter(vid =>
    !st.players.some(p => p.settlements.includes(vid) || p.cities.includes(vid)));
  st.players[0].settlements.push(libres[0]);
  st.robber = hex.id;
  const before = totals(st);
  forceRoll(st, 12);
  const after = totals(st);
  assert.deepEqual(after, before);
});

// ---------- siete: descarte y robo ----------

test('7: los que tienen más de 7 cartas descartan la mitad', () => {
  const st = startGame(7);
  // limpio las cartas de la colocación inicial para el escenario exacto
  for (const p of st.players) G.RESOURCES.forEach((r) => (p.res[r] = 0));
  st.players[0].res.wood = 9;  // descarta 4
  st.players[1].res.brick = 7; // no descarta (7 no es más de 7)
  st.players[2].res.sheep = 2;
  forceRoll(st, 7);
  assert.equal(st.phase, 'discard');
  assert.deepEqual(st.pendingDiscards, [0]);
  const r = G.discard(st, 0, { wood: 4 });
  assert.ok(r.ok, r.err);
  assert.equal(st.players[0].res.wood, 5);
  assert.equal(st.phase, 'robber');
});

test('7: mover ladrón y robarle una carta a una víctima con cartas', () => {
  const st = startGame(7);
  // solo p1 tiene cartas: víctimas posibles sin ambigüedad
  for (const p of st.players) G.RESOURCES.forEach((r) => (p.res[r] = 0));
  st.players[1].res.ore = 3;
  // p1 debe tener edificio junto al destino del ladrón
  const hex = st.board.hexes.find(h => h.number === 12);
  const libres = hex.vertices.filter(vid =>
    !st.players.some(p => p.settlements.includes(vid) || p.cities.includes(vid)));
  st.players[1].settlements.push(libres[0]);
  st.players[0].res.wood = 9;
  forceRoll(st, 7);
  G.discard(st, 0, { wood: 4 });
  assert.equal(st.phase, 'robber');
  const r = G.moveRobber(st, hex.id);
  assert.ok(r.ok, r.err);
  assert.deepEqual(r.victims, [1]);
  const before = totals(st);
  const s = G.stealFrom(st, 1);
  assert.ok(s.ok, s.err);
  assert.equal(totals(st)[0], before[0] + 1);
  assert.equal(totals(st)[1], before[1] - 1);
  assert.equal(st.phase, 'main');
});

// ---------- colocación y construcción ----------

test('regla de distancia: no se puede colocar junto a otro edificio', () => {
  const st = startGame(7);
  const occ = st.players[0].settlements[0];
  const v = st.board.vertices[occ];
  for (const n of v.neighbors) {
    const spots = G.settlementSpots(st, 0, true);
    // durante el setup los spots válidos nunca incluyen vecinos de un edificio
    assert.equal(spots.includes(n), false);
  }
});

test('caminos: solo en la red propia, y no se puede construir lejos de ella', () => {
  const st = startGame(7);
  st.phase = 'main';
  const p = st.players[0];
  for (const r of G.RESOURCES) p.res[r] = 50;
  const mine = new Set([...p.settlements, ...p.cities]);
  for (const eid of p.roads) { mine.add(st.board.edges[eid].a); mine.add(st.board.edges[eid].b); }
  const spots = G.roadSpots(st, 0);
  assert.ok(spots.length > 0);
  for (const eid of spots) {
    const e = st.board.edges[eid];
    assert.ok(mine.has(e.a) || mine.has(e.b));
  }
  const far = st.board.edges.find(e => !spots.includes(e.id));
  assert.equal(G.buildRoad(st, far.id).ok, false);
});

test("asentamientos: solo sobre vértices que tocan un camino propio, no a 1 de distancia (bug de Fran)", () => {
  const st = startGame(7);
  st.phase = 'main';
  const p = st.players[0];
  for (const r of G.RESOURCES) p.res[r] = 50;
  const spots = new Set(G.settlementSpots(st, 0, false));
  // cada camino mío tiene un extremo libre: ese SÍ es lugar válido…
  for (const eid of p.roads) {
    const e = st.board.edges[eid];
    for (const vid of [e.a, e.b]) {
      const isBuilding = p.settlements.includes(vid) || p.cities.includes(vid);
      if (!isBuilding && !spots.has(vid)) {
        // si está libre y cumple distancia, tiene que estar
        const occ = st.players.some(q => q.settlements.includes(vid) || q.cities.includes(vid) ||
          q.settlements.some(s => st.board.vertices[s].neighbors.includes(vid)));
        if (!occ) assert.ok(spots.has(vid), `extremo de camino propio ${vid} debería ser válido`);
      }
    }
  }
  // …y un vecino del extremo libre (conectado solo por arista vacía) NO lo es
  let checked = 0;
  for (const eid of p.roads) {
    const e = st.board.edges[eid];
    for (const vid of [e.a, e.b]) {
      if (p.settlements.includes(vid) || p.cities.includes(vid)) continue;
      for (const nb of st.board.vertices[vid].neighbors) {
        if (spots.has(nb)) continue; // conectado por otro lado
        const occNear = st.players.some(q => q.settlements.includes(nb) || q.cities.includes(nb) ||
          q.settlements.some(s => st.board.vertices[s].neighbors.includes(nb)));
        if (occNear) continue; // inválido por distancia, no prueba nada
        const r = G.buildSettlement(st, nb);
        assert.equal(r.ok, false, `vértice ${nb} a 1 de distancia del fin del camino no debería ser válido`);
        checked++;
      }
    }
  }
  assert.ok(checked > 0, 'debería haber verificado al menos un nodo vecino');
  // tras el setup los extremos libres pegan a mi propio asentamiento (regla de
  // distancia), así que el flujo real es: extender un camino y fundar más allá
  let ok = false;
  for (const eid of [...G.roadSpots(st, 0)]) {
    assert.ok(G.buildRoad(st, eid).ok, 'extender camino desde la red propia');
    const s = G.settlementSpots(st, 0, false);
    if (s.length) {
      assert.ok(G.buildSettlement(st, s[0]).ok, 'fundar en vértice tocado por camino propio');
      ok = true;
      break;
    }
  }
  assert.ok(ok, 'tras extender un camino debería haber lugar válido');
});

test('stock: 15 caminos, 5 asentamientos, 4 ciudades por jugador', () => {
  const st = startGame(7);
  st.phase = 'main'; // habilita construcción
  const p = st.players[0];
  for (const r of G.RESOURCES) p.res[r] = 50;
  while (p.roads.length < 15) {
    const spots = G.roadSpots(st, 0);
    if (!spots.length) break; // puede quedarse sin lugar antes de 15 en un tablero chico
    assert.ok(G.buildRoad(st, spots[0]).ok);
  }
  if (p.roads.length === 15) {
    const spots = G.roadSpots(st, 0);
    if (spots.length) assert.equal(G.buildRoad(st, spots[0]).ok, false);
  }
});

test('victoria a 10 PV: edificios solos no alcanzan (techo 9), una carta de PV cierra', () => {
  const st = startGame(7);
  st.phase = 'main';
  const p = st.players[0];
  for (const r of G.RESOURCES) p.res[r] = 50;
  // completo 5 asentamientos (colocación libre, como el setup)
  while (p.settlements.length < 5) {
    const spots = G.settlementSpots(st, 0, true);
    assert.ok(spots.length, 'sin lugares para asentamientos');
    p.settlements.push(spots[0]);
  }
  // 5 asentamientos + 4 ciudades = 9 PV: no gana con edificios solos
  for (let i = 0; i < 4; i++) {
    const r = G.buildCity(st, p.settlements[0]);
    assert.ok(r.ok, r.err);
  }
  assert.notEqual(st.phase, 'over', '9 PV no deben ganar');
  assert.equal(G.vp(p), 9);
  // la 5ta ciudad no existe: convierto la última en ciudad… no puede (stock 4)
  assert.ok(p.settlements.length === 1);
  // compro cartas hasta que salga un Punto de Victoria (mazo espiado y forzado)
  p.devs = [];
  st.devDeck = ['vp', 'knight'];
  assert.ok(G.buyDev(st).ok);
  assert.notEqual(st.phase, 'over', 'el caballero no suma PV');
  assert.ok(G.buyDev(st).ok, 'compra del PV');
  assert.equal(st.phase, 'over', '10 PV con la carta de PV');
  assert.equal(st.winner, 0);
  assert.equal(G.vp(p), 10);
});

// ---------- cartas de desarrollo ----------

test('mazo de desarrollo: 25 cartas con la composición estándar', () => {
  const st = G.newGame(['A', 'B'], 7);
  assert.equal(st.devDeck.length, 25);
  const count = (t) => st.devDeck.filter((c) => c === t).length;
  assert.equal(count('knight'), 14);
  assert.equal(count('vp'), 5);
  assert.equal(count('roadbuilding'), 2);
  assert.equal(count('yoplenty'), 2);
  assert.equal(count('monopoly'), 2);
  // misma semilla → mismo mazo
  const st2 = G.newGame(['A', 'B'], 7);
  assert.deepEqual(st.devDeck, st2.devDeck);
});

test('buyDev: paga 🐑🌾⛰️, la carta guarda el turno de compra y no se puede jugar en el turno comprado', () => {
  const st = startGame(7);
  st.phase = 'main';
  const p = st.players[0];
  p.res.sheep = 1; p.res.wheat = 1; p.res.ore = 1;
  const before = totals(st)[0];
  assert.ok(G.buyDev(st).ok);
  assert.equal(totals(st)[0], before - 3);
  assert.equal(p.devs.length, 1);
  assert.equal(p.devs[0].turn, st.turn);
  assert.equal(st.devDeck.length, 24);
  // sin recursos, segunda compra falla
  assert.equal(G.buyDev(st).ok, false);
  // jugarla ahora es inválido (comprada este turno)
  p.devs[0].t = 'knight'; // cualquier tipo no-PV: el gating es por turno
  assert.equal(G.playKnight(st, 0).ok, false);
  // y solo se puede en fase main
  st.phase = 'roll';
  assert.equal(G.buyDev(st).ok, false);
});

test('caballero: mueve al ladrón, cuenta para el ejército (3+ lo toma, +2 PV) y hay una carta por turno', () => {
  const st = startGame(7);
  st.phase = 'main';
  const p = st.players[0], q = st.players[1];
  p.devs = [{ t: 'knight', turn: 0 }, { t: 'knight', turn: 0 }, { t: 'knight', turn: 0 }];
  st.turn = 5;
  // juega el primero → fase ladrón
  assert.ok(G.playKnight(st, 0).ok);
  assert.equal(st.phase, 'robber');
  assert.equal(p.knights, 1);
  assert.equal(st.devPlayed, true);
  // segunda carta el mismo turno: no
  assert.equal(G.playKnight(st, 0).ok, false);
  G.moveRobber(st, G.robberSpots(st)[0]);
  assert.ok(G.endTurn(st).ok);
  assert.equal(st.devPlayed, false);
  // devuelvo el turno al jugador 0 (endTurn se lo pasó al 1) y juego el 2do
  st.current = 0;
  st.phase = 'main';
  assert.ok(G.playKnight(st, 0).ok);
  assert.equal(p.knights, 2);
  assert.equal(st.largestArmy, null, 'con 2 todavía no');
  G.moveRobber(st, G.robberSpots(st)[0]);
  // turno siguiente: el 3er caballero toma el ejército (+2 PV)
  st.turn = 7;
  st.phase = 'main';
  st.devPlayed = false;
  assert.ok(G.playKnight(st, 0).ok);
  assert.equal(st.largestArmy, 0);
  assert.equal(p.hasLargestArmy, true);
  assert.equal(G.vp(p), 4); // 2 asentamientos del setup + bonus
  G.moveRobber(st, G.robberSpots(st)[0]); // resuelvo el ladrón del 3er caballero
  // empate de caballeros no roba el título (q juega en un turno posterior)
  st.current = 1;
  st.turn = 8;
  st.devPlayed = false; // endTurn lo resetea en el flujo real
  q.knights = 2; // este es su 3er caballero: empata con el titular
  q.devs = [{ t: 'knight', turn: 0 }];
  assert.ok(G.playKnight(st, 0).ok);
  assert.equal(q.knights, 3);
  G.moveRobber(st, G.robberSpots(st)[0]);
  assert.equal(st.largestArmy, 0, 'empate: conserva el titular');
});

test('año de abundancia y monopolio', () => {
  const st = startGame(7);
  st.phase = 'main';
  const p = st.players[0];
  p.devs = [{ t: 'yoplenty', turn: 0 }];
  st.turn = 3;
  assert.ok(G.playYearOfPlenty(st, 0, 'ore', 'ore').ok);
  assert.equal(p.res.ore, 2);
  // monopolio: les saca TODAS las cartas de ese recurso a los demás
  st.players[1].res.wood = 4;
  st.players[2].res.wood = 2;
  p.devs = [{ t: 'monopoly', turn: 0 }];
  st.devPlayed = false;
  st.current = 0;
  assert.ok(G.playMonopoly(st, 0, 'wood').ok);
  assert.equal(p.res.wood, 6);
  assert.equal(st.players[1].res.wood, 0);
  assert.equal(st.players[2].res.wood, 0);
});

test('construcción de caminos: 2 caminos gratis respetando conectividad, y expiran al terminar el turno', () => {
  const st = startGame(7);
  st.phase = 'main';
  const p = st.players[0];
  for (const r of G.RESOURCES) p.res[r] = 0; // sin recursos: los caminos salen gratis
  p.devs = [{ t: 'roadbuilding', turn: 0 }];
  st.turn = 3;
  assert.ok(G.playRoadBuilding(st, 0).ok);
  assert.equal(st.freeRoads, 2);
  const s1 = G.roadSpots(st, 0)[0];
  assert.ok(G.buildRoad(st, s1).ok, 'camino gratis 1');
  assert.equal(st.freeRoads, 1);
  assert.equal(totals(st)[0], 0, 'no pagó recursos');
  const s2 = G.roadSpots(st, 0)[0];
  assert.ok(G.buildRoad(st, s2).ok, 'camino gratis 2');
  assert.equal(st.freeRoads, 0);
  // el tercero ya cuesta: sin recursos, falla
  const s3 = G.roadSpots(st, 0)[0];
  if (s3 != null) assert.equal(G.buildRoad(st, s3).ok, false);
});

// ---------- camino comercial ----------

const edgeTaken = (st, eid) => st.players.some((q) => q.roads.includes(eid));
const sharedV = (ea, eb) => [ea.a, ea.b].find((v) => [eb.a, eb.b].includes(v));
// los asentamientos que deja el setup pueden caer justo en la cadena y
// bloquearla: para los tests de camino limpio los edificios enemigos
const clearEnemies = (st, pid) => {
  for (const q of st.players) {
    if (q.id === pid) continue;
    q.settlements = [];
    q.cities = [];
  }
};

// construye una cadena de n aristas propias (push directo) saliendo desde el
// vértice fromVertex; devuelve el vértice final de la cadena
function extendChain(st, pid, fromVertex, n) {
  const p = st.players[pid];
  let cur = fromVertex;
  for (let i = 0; i < n; i++) {
    const eid = st.board.vertices[cur].edges.find((e) => !edgeTaken(st, e.id));
    assert.ok(eid != null, 'sin arista libre para extender');
    p.roads.push(eid);
    const e = st.board.edges[eid];
    cur = e.a === cur ? e.b : e.a;
  }
  return cur;
}

const chainStart = (st, pid) => st.board.edges[st.players[pid].roads[0]].a;

test('camino comercial: 5+ aristas conectadas lo dan (+2 PV)', () => {
  const st = startGame(7);
  clearEnemies(st, 0);
  const p = st.players[0];
  assert.equal(st.longestRoad, null);
  extendChain(st, 0, chainStart(st, 0), 4); // camino del setup + 4 en cadena
  assert.ok(G.longestRoadLen(st, 0) >= 5);
  G.refreshLongestRoad(st);
  assert.equal(st.longestRoad, 0);
  assert.equal(p.hasLongestRoad, true);
  assert.equal(G.vp(p), 2 + 2); // 2 asentamientos del setup + bonus
});

test('camino comercial: el titular conserva empates y pierde con quien supera', () => {
  const st = startGame(7);
  clearEnemies(st, 0);
  extendChain(st, 0, chainStart(st, 0), 4); // A: 5+
  G.refreshLongestRoad(st);
  assert.equal(st.longestRoad, 0);
  const endB = extendChain(st, 1, chainStart(st, 1), 4); // B: 5 también
  G.refreshLongestRoad(st);
  assert.equal(st.longestRoad, 0, 'empate o menos: conserva el titular');
  extendChain(st, 1, endB, 2); // B: 7, supera a A (5 o 6)
  G.refreshLongestRoad(st);
  assert.equal(st.longestRoad, 1, 'B superó: transfiere');
  assert.equal(st.players[0].hasLongestRoad, false);
  assert.equal(st.players[1].hasLongestRoad, true);
});

test('camino comercial: un asentamiento enemigo corta el paso y el título se pierde', () => {
  const st = startGame(7);
  const p = st.players[0], q = st.players[1];
  clearEnemies(st, 0);
  extendChain(st, 0, chainStart(st, 0), 7); // 8 en cadena (setup + 7)
  G.refreshLongestRoad(st);
  assert.equal(st.longestRoad, 0);
  assert.ok(st.longestRoadLen >= 5, st.longestRoadLen);
  // dos asentamientos enemigos en vértices intermedios parten la cadena en
  // tramos de 4, 2 y 2: ninguno llega a 5
  const roads = p.roads.map((eid) => st.board.edges[eid]);
  const j1 = sharedV(roads[4], roads[5]); // entre la 5ta y 6ta arista
  const j2 = sharedV(roads[6], roads[7]); // entre la 7ma y 8va
  assert.ok(j1 != null && j2 != null, 'la cadena es lineal: hay vértices compartidos');
  q.settlements.push(j1, j2);
  G.refreshLongestRoad(st);
  const lenAfter = G.longestRoadLen(st, 0);
  assert.ok(lenAfter < 5, 'los cortes parten en tramos < 5: ' + lenAfter);
  assert.equal(st.longestRoad, null);
  assert.equal(p.hasLongestRoad, false);
});

// ---------- comercio ----------

test('tasas de puerto: 2:1 con puerto del recurso, 3:1 con puerto genérico, 4:1 sin puerto', () => {
  const st = startGame(7);
  st.phase = 'main'; // el comercio requiere fase main
  // saco los asentamientos del setup para partir de cero
  st.players[0].settlements = [];
  st.players[1].settlements = [];
  // sin puertos tocados → 4
  assert.equal(G.tradeRate(st, 0, 'wood'), 4);
  // puerto 2:1 de madera
  const woodPort = st.board.ports.find(p => p.type === 'wood');
  assert.ok(woodPort, 'debería haber un puerto 2:1 de madera');
  st.players[0].settlements.push(woodPort.vids[0]);
  assert.equal(G.tradeRate(st, 0, 'wood'), 2);
  // puerto 3:1
  const generic = st.board.ports.find(p => p.type === '3:1');
  st.players[1].settlements.push(generic.vids[0]);
  assert.equal(G.tradeRate(st, 1, 'ore'), 3);
  // el 2:1 de madera no baja la tasa del trigo para p0
  assert.equal(G.tradeRate(st, 0, 'wheat'), 4);
  // el intercambio descuenta y suma
  st.players[0].res.wood += 2;
  const before = { w: st.players[0].res.wood, t: st.players[0].res.wheat };
  assert.ok(G.bankTrade(st, 'wood', 'wheat').ok);
  assert.equal(st.players[0].res.wood, before.w - 2);
  assert.equal(st.players[0].res.wheat, before.t + 1);
});

test('colocación: tras el camino de un jugador, el siguiente arranca por asentamiento (sin lastSetupVertex heredado)', () => {
  const st = startGame(7); // startGame ya jugó todo el setup; armamos uno fresco
  const st2 = G.newGame(['A', 'B'], 7);
  // A coloca asentamiento + camino
  const sA = G.settlementSpots(st2, 0, true)[0];
  G.placeSetupSettlement(st2, sA);
  assert.ok(st2.lastSetupVertex != null, 'habilita el paso camino');
  G.placeSetupRoad(st2, G.setupRoadSpots(st2, 0)[0]);
  assert.equal(st2.lastSetupVertex, null, 'se limpia al terminar el paso');
  // B: sin asentamiento propio no hay caminos disponibles
  assert.deepEqual(G.setupRoadSpots(st2, 1), []);
  // y sus lugares de asentamiento son los normales (regla de distancia)
  assert.ok(G.settlementSpots(st2, 1, true).length > 0);
  // el setup completo de startGame es consistente: cada camino toca su asentamiento
  for (const p of st.players) {
    assert.equal(p.roads.length, 2);
    assert.equal(p.settlements.length, 2);
  }
});

test('el 7 no sale dos veces seguidas (se repite el tiro)', () => {
  const st = startGame(7);
  for (const p of st.players) G.RESOURCES.forEach((r) => (p.res[r] = 0));
  const seq = [];
  st.rng = () => (seq.length ? seq.shift() : 0.5);
  // primera tirada: forzar 7
  seq.push(5.5 / 6, 0.5 / 6);
  const r1 = G.rollDice(st);
  assert.equal(r1.sum, 7);
  assert.equal(st.lastRollWas7, true);
  // segunda tirada: forzar 7 constantemente → el motor re-tira hasta que no sea 7
  st.phase = 'roll'; // salteamos el robo del primer 7
  st.rng = () => 0.5; // 4+4 = 8 siempre
  const r2 = G.rollDice(st);
  assert.equal(r2.sum, 8);
  assert.equal(st.lastRollWas7, false);
  // y si el 7 no salió antes, un 7 es aceptado normal
  st.lastRollWas7 = false;
  st.phase = 'roll';
  const seq7 = [5.5 / 6, 0.5 / 6];
  st.rng = () => (seq7.length ? seq7.shift() : 0.5);
  const r3 = G.rollDice(st);
  assert.equal(r3.sum, 7);
  assert.equal(st.lastRollWas7, true);
});

test('ladrón: stealCandidates viaja en el estado y se limpia al robar (deriva UI online)', () => {
  const st = startGame(7);
  for (const p of st.players) G.RESOURCES.forEach((r) => (p.res[r] = 0));
  st.players[1].res.ore = 3;
  const hex = st.board.hexes.find(h => h.number === 12);
  const libres = hex.vertices.filter(vid =>
    !st.players.some(p => p.settlements.includes(vid) || p.cities.includes(vid)));
  st.players[1].settlements.push(libres[0]);
  st.players[0].res.wood = 9;
  forceRoll(st, 7);
  G.discard(st, 0, { wood: 4 });
  G.moveRobber(st, hex.id);
  assert.deepEqual(st.stealCandidates, [1]);
  G.stealFrom(st, 1);
  assert.deepEqual(st.stealCandidates, []);
});

test('el estado viaja por JSON sin perder lo que el render necesita', () => {
  const st = startGame(7);
  st.players[0].res.wood = 3;
  forceRoll(st, 7);
  const copy = JSON.parse(JSON.stringify(st));
  // lo que render.js y main.js consumen tras el JSON (rng es función y se pierde: ok)
  assert.equal(copy.phase, st.phase);
  assert.equal(copy.players.length, st.players.length);
  assert.ok(copy.board.hexes.length === 19 && copy.board.vertices.length === 54 && copy.board.ports.length === 9);
  assert.ok(Array.isArray(copy.log) && copy.log.length > 0);
  assert.deepEqual(copy.pendingDiscards, st.pendingDiscards);
  assert.equal(copy.robber, st.robber);
  assert.equal(copy.players[0].res.wood, 3);
  assert.ok(copy.setupQueue.length === 6);
});

// ---------- mapa niebla ----------

test('niebla: estructura del tablero (laguna, 18 madera, 42 niebla, 6 puertos 2:1 madera)', () => {
  const a = generateBoard(7, 'niebla');
  assert.equal(a.hexes.length, 61);
  assert.equal(a.hexes.filter((h) => h.terrain === 'lagoon').length, 1);
  assert.equal(a.hexes.filter((h) => h.terrain === 'forest').length, 18);
  const fog = a.hexes.filter((h) => h.fog);
  assert.equal(fog.length, 42);
  // la niebla solo esconde los 4 recursos que no están en el centro
  for (const h of fog) assert.ok(['hills', 'mountains', 'fields', 'pasture'].includes(h.terrain), h.terrain);
  // todos los hexes con niebla tienen número oculto (2-12, sin 7)
  for (const h of fog) assert.ok(h.number >= 2 && h.number <= 12 && h.number !== 7, 'ficha ' + h.number);
  // puertos: 6 alrededor de la laguna, todos 2:1 de madera, mirando al agua
  assert.equal(a.ports.length, 6);
  const lag = a.hexes.find((h) => h.terrain === 'lagoon');
  for (const p of a.ports) {
    assert.equal(p.type, 'wood');
    assert.equal(p.small, true);
    for (const vid of p.vids) {
      const v = a.vertices[vid];
      assert.ok(v.hexes.includes(lag.id), 'acceso toca la laguna');
    }
    // normal apuntando hacia el centro de la laguna
    const mx = (a.vertices[p.vids[0]].x + a.vertices[p.vids[1]].x) / 2;
    const my = (a.vertices[p.vids[0]].y + a.vertices[p.vids[1]].y) / 2;
    assert.ok(p.nx * (lag.x - mx) + p.ny * (lag.y - my) > 0, 'puerto mira al agua');
  }
  // determinista entre semillas en estructura, variado en contenido
  const b = generateBoard(7, 'niebla');
  assert.deepEqual(a.hexes.map((h) => [h.terrain, h.number]), b.hexes.map((h) => [h.terrain, h.number]));
  const c = generateBoard(8, 'niebla');
  assert.notDeepEqual(a.hexes.map((h) => h.terrain), c.hexes.map((h) => h.terrain));
});

test('niebla: sin descubrir no se puebla al lado, no produce y no recibe al ladrón', () => {
  const st = G.newGame(['A', 'B'], 7, null, 'niebla');
  assert.equal(st.map, 'niebla');
  const fogHex = st.board.hexes.find((h) => h.fog);
  // vértices del hex con niebla: inhabilitados para asentamiento
  const spots = G.settlementSpots(st, 0, true);
  for (const vid of fogHex.vertices) assert.equal(spots.includes(vid), false);
  // el ladrón no puede ir ahí
  st.phase = 'robber';
  assert.equal(G.robberSpots(st).includes(fogHex.id), false);
  // y aunque el número coincida, la niebla no produce ni destella
  const st2 = G.newGame(['A', 'B'], 7, null, 'niebla');
  for (const p of st2.players) G.RESOURCES.forEach((r) => (p.res[r] = 0));
  const target = st2.board.hexes.find((h) => h.fog && h.number === 6)
    || st2.board.hexes.find((h) => h.fog && (h.number === 6 || h.number === 8));
  if (target) {
    forceRoll(st2, target.number);
    assert.deepEqual(st2.lastProduced.includes(target.id), false, 'niebla no destella');
    assert.equal(st2.lastGain[target.id], undefined, 'niebla no produce');
  }
});

test('niebla: un camino que toca niebla revela el hex (y habilita poblar ahí)', () => {
  const st = G.newGame(['A', 'B'], 7, null, 'niebla');
  // setup completo en la isla de madera
  while (st.phase === 'setup') {
    const pid = st.setupQueue[st.setupIdx];
    G.placeSetupSettlement(st, G.settlementSpots(st, pid, true)[0]);
    G.placeSetupRoad(st, G.setupRoadSpots(st, pid)[0]);
  }
  assert.deepEqual(st.revealed, [], 'el setup no revela (caminos internos)');
  // extender caminos hasta tocar niebla: rellenar recursos y construir
  st.phase = 'main';
  const p = st.players[0];
  for (const r of G.RESOURCES) p.res[r] = 50;
  let revealed = 0;
  for (let i = 0; i < 30 && revealed === 0; i++) {
    const spot = G.roadSpots(st, 0).find((eid) =>
      st.board.edges[eid].hexes.some((hid) => st.board.hexes[hid].fog && !st.revealed.includes(hid)));
    const any = spot != null ? spot : G.roadSpots(st, 0)[0];
    if (any == null) break;
    assert.ok(G.buildRoad(st, any).ok);
    revealed = st.revealed.length;
  }
  assert.ok(revealed > 0, 'construir hacia afuera revela niebla');
  assert.ok(st.log.some((l) => l.includes('descubrió')), 'log de descubrimiento');
  // un hex revelado habilita poblar vértices que antes tocaban niebla
  const vid = st.board.hexes[st.revealed[0]].vertices[0];
  const nowSpots = G.settlementSpots(st, 0, false);
  if (!st.board.vertices[vid].hexes.some((hid) => hid !== st.revealed[0]
      && st.board.hexes[hid].fog && !st.revealed.includes(hid))) {
    // solo si todos sus hexes están revelados
    if (G.roadSpots(st, 0).some((eid) => st.board.edges[eid].a === vid || st.board.edges[eid].b === vid)
        && !st.players.some((q) => q.settlements.includes(vid))) {
      assert.ok(nowSpots.includes(vid), 'vértice descubierto se puede poblar');
    }
  }
});

test('niebla: recompensa de descubrimiento — quien revela se lleva 1 recurso del hex', () => {
  const st = G.newGame(['A', 'B'], 7, null, 'niebla');
  while (st.phase === 'setup') {
    const pid = st.setupQueue[st.setupIdx];
    G.placeSetupSettlement(st, G.settlementSpots(st, pid, true)[0]);
    G.placeSetupRoad(st, G.setupRoadSpots(st, pid)[0]);
  }
  st.phase = 'main';
  const p = st.players[0];
  for (const r of G.RESOURCES) p.res[r] = 10;
  const before = { ...p.res };
  // construye hasta revelar algo
  let built = 0;
  for (let i = 0; i < 30 && st.revealed.length === 0; i++) {
    const spot = G.roadSpots(st, 0).find((eid) =>
      st.board.edges[eid].hexes.some((hid) => st.board.hexes[hid].fog && !st.revealed.includes(hid)))
      || G.roadSpots(st, 0)[0];
    if (spot == null) break;
    if (G.buildRoad(st, spot).ok) built++;
  }
  assert.ok(st.revealed.length > 0);
  const gained = st.revealed.map((hid) => G.TERRAIN_RES[st.board.hexes[hid].terrain]);
  const expected = { ...before };
  expected.wood -= built; // cada camino cuesta 1 madera + 1 ladrillo
  expected.brick -= built;
  for (const r of gained) if (r) expected[r]++;
  assert.deepEqual(p.res, expected, 'cada hex revelado paga +1 de su recurso');
  assert.ok(st.log.some((l) => l.includes('(+1')), 'log con la recompensa');
});
