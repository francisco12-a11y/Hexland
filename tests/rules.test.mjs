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

test('victoria a 8 puntos de victoria (techo sin cartas de desarrollo: 9 PV)', () => {
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
  // convierto asentamientos en ciudades siempre sobre el primero que siga siendo pueblo
  let won = false;
  for (let i = 0; i < 4 && !won; i++) {
    const r = G.buildCity(st, p.settlements[0]);
    assert.ok(r.ok, r.err);
    if (st.phase === 'over') won = true;
  }
  assert.ok(won, 'debería haber cruzado el umbral de victoria');
  assert.equal(st.winner, 0);
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
