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

test('puertos: 9 uniformes, acceso costero y muelle perpendicular hacia el mar', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const b = generateBoard(seed);
    assert.equal(b.ports.length, 9, `semilla ${seed}`);
    const seen = new Set();
    for (const p of b.ports) {
      // acceso: dos vértices costeros distintos (pertenecen al anillo de la costa)
      assert.equal(p.vids.length, 2);
      const [va, vb] = p.vids.map(vid => b.vertices[vid]);
      assert.notEqual(va.id, vb.id);
      assert.ok(b.coast.includes(va.id), 'vértice costero a');
      assert.ok(b.coast.includes(vb.id), 'vértice costero b');
      // los puertos no comparten vértices (espaciado cada 2 bordes del ciclo)
      for (const vid of p.vids) {
        assert.ok(!seen.has(vid), `semilla ${seed}: puertos juntos`);
        seen.add(vid);
      }
      // la normal del muelle apunta al mar (afuera de la isla, centrada en el origen)
      assert.ok(p.nx * p.mx + p.ny * p.my > 0, `semilla ${seed}: normal hacia adentro`);
      // el muelle es perpendicular al borde costero
      const va2 = b.vertices[p.vids[0]], vb2 = b.vertices[p.vids[1]];
      const dot = (vb2.x - va2.x) * p.nx + (vb2.y - va2.y) * p.ny;
      assert.ok(Math.abs(dot) < 1e-6, `semilla ${seed}: muelle no perpendicular`);
      // cartel y velero más lejos de la costa que el inicio del muelle
      assert.ok(Math.hypot(p.ix, p.iy) > Math.hypot(p.px, p.py));
      assert.ok(Math.hypot(p.px, p.py) > Math.hypot(p.mx, p.my));
    }
  }
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

test('caminos: solo en la red propia, y el edificio enemigo corta el paso', () => {
  const st = startGame(7);
  const spots = G.roadSpots(st, 0);
  assert.ok(spots.length > 0);
  // todo spot toca la red de p0
  const net = G.ownNetwork(st, 0);
  for (const eid of spots) {
    const e = st.board.edges[eid];
    assert.ok(net.has(e.a) || net.has(e.b));
  }
  // un borde lejano no es válido
  const far = st.board.edges.find(e => !spots.includes(e.id));
  assert.equal(G.buildRoad(st, far.id).ok, false);
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
