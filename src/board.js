// Hexland — board generation: island geometry, terrain & number shuffle, ports.

export const S = 60; // hex radius in board units
const SQRT3 = Math.sqrt(3);

// 19-land island in axial coords: |q| <= 2, |r| <= 2, |q + r| <= 2
const ISLAND = [];
for (let r = -2; r <= 2; r++)
  for (let q = Math.max(-2, -2 - r); q <= Math.min(2, 2 - r); q++)
    ISLAND.push({ q, r });

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const TERRAIN_DECK = [
  'hills', 'hills', 'hills',
  'forest', 'forest', 'forest', 'forest',
  'mountains', 'mountains', 'mountains',
  'fields', 'fields', 'fields', 'fields',
  'pasture', 'pasture', 'pasture', 'pasture',
  'desert',
];

const TOKENS = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];

export const PIPS = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 };

function hexCenter(q, r) {
  return { x: SQRT3 * S * (q + r / 2), y: 1.5 * S * r };
}

function hexCorner(cx, cy, i) {
  const a = ((60 * i - 90) * Math.PI) / 180;
  return { x: cx + S * Math.cos(a), y: cy + S * Math.sin(a) };
}

function axialDist(a, b) {
  const dq = a.q - b.q, dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

export function generateBoard(seed, map = 'clasico') {
  if (map === 'niebla') return generateFogBoard(seed);
  if (map === 'oro') return generateOroBoard(seed);
  const rng = mulberry32(seed);
  const terrains = shuffle([...TERRAIN_DECK], rng);

  // number tokens: reshuffle until no two 6/8 land on adjacent hexes
  let numbers = null;
  for (let attempt = 0; attempt < 800 && !numbers; attempt++) {
    const cand = shuffle([...TOKENS], rng);
    const hexNums = [];
    let ti = 0;
    for (const t of terrains) hexNums.push(t === 'desert' ? 0 : cand[ti++]);
    let ok = true;
    outer: for (let i = 0; i < hexNums.length; i++) {
      if (hexNums[i] !== 6 && hexNums[i] !== 8) continue;
      for (let j = i + 1; j < hexNums.length; j++) {
        if ((hexNums[j] === 6 || hexNums[j] === 8) && axialDist(ISLAND[i], ISLAND[j]) === 1) {
          ok = false; break outer;
        }
      }
    }
    if (ok) numbers = hexNums;
  }
  if (!numbers) numbers = shuffle([...TOKENS], rng); // should never hit

  const hexes = [], vertices = [], edges = [];
  const vMap = new Map(), eMap = new Map();

  ISLAND.forEach(({ q, r }, i) => {
    const { x, y } = hexCenter(q, r);
    const hex = { id: i, q, r, x, y, terrain: terrains[i], number: numbers[i], vertices: [], edges: [] };
    const cornerIds = [];
    for (let c = 0; c < 6; c++) {
      const p = hexCorner(x, y, c);
      // clave entera: toFixed distingue "-0.0" de "0.0" y desfusiona esquinas
      // (residuo de cos(±90°)), partiendo el perímetro en dos
      const key = `${Math.round(p.x * 10)}|${Math.round(p.y * 10)}`;
      if (!vMap.has(key)) {
        const v = { id: vMap.size, x: p.x, y: p.y, hexes: [], edges: [] };
        vMap.set(key, v); vertices.push(v);
      }
      const v = vMap.get(key);
      v.hexes.push(hex.id);
      hex.vertices.push(v.id);
      cornerIds.push(v.id);
    }
    for (let c = 0; c < 6; c++) {
      const a = cornerIds[c], b = cornerIds[(c + 1) % 6];
      const key = `${Math.min(a, b)}-${Math.max(a, b)}`;
      if (!eMap.has(key)) {
        const e = { id: eMap.size, a: Math.min(a, b), b: Math.max(a, b), hexes: [] };
        eMap.set(key, e); edges.push(e);
      }
      const e = eMap.get(key);
      e.hexes.push(hex.id);
      hex.edges.push(e.id);
    }
    hexes.push(hex);
  });

  for (const v of vertices) v.neighbors = [];
  for (const e of edges) {
    vertices[e.a].edges.push(e.id);
    vertices[e.b].edges.push(e.id);
    vertices[e.a].neighbors.push(e.b);
    vertices[e.b].neighbors.push(e.a);
  }

  // robber starts on the desert
  const desert = hexes.find(h => h.terrain === 'desert');

  // perimeter cycle (edges touching only one land hex) + ordered coast ring
  const perim = edges.filter(e => e.hexes.length === 1);
  const atVertex = new Map();
  for (const e of perim) {
    for (const vid of [e.a, e.b]) {
      if (!atVertex.has(vid)) atVertex.set(vid, []);
      atVertex.get(vid).push(e.id);
    }
  }
  const cycle = [perim[0].id];
  let prev = perim[0], curV = perim[0].b;
  while (cycle.length < perim.length) {
    const nextId = atVertex.get(curV).find(eid => eid !== prev.id);
    cycle.push(nextId);
    prev = edges[nextId];
    curV = prev.a === curV ? prev.b : prev.a;
  }
  const coast = [];
  {
    let v = perim[0].a;
    for (const eid of cycle) {
      coast.push(v);
      const e = edges[eid];
      v = e.a === v ? e.b : e.a;
    }
  }

  // Los puertos son parte del MARCO: 9 posiciones y 9 tipos FIJOS. Sobre el
  // ciclo costero de 30 vértices, cada puerto cubre 2 vértices adyacentes —
  // uno que toca 2 hexágonos y uno que toca 1 — con huecos de 1,1,2 vértices
  // entre puertos (ritmo ppn ppn ppn nn), que cierra exacto en 30 con 9
  // puertos. El muelle sale perpendicular al borde; cartel y velero afuera.
  const PORT_TYPES = ['3:1', 'wood', '3:1', 'sheep', '3:1', 'ore', '3:1', 'brick', 'wheat'];
  const starts = [0, 3, 6, 10, 13, 16, 20, 23, 26];
  const counts = coast.map((vid) => vertices[vid].hexes.length);
  const mixed = (s) => {
    const a = counts[s % 30], b = counts[(s + 1) % 30];
    return (a === 1 && b === 2) || (a === 2 && b === 1);
  };
  let off = 0;
  for (let s = 0; s < 30; s++) {
    if (starts.every((st) => mixed(s + st))) { off = s; break; }
  }
  const ports = [];
  starts.forEach((st, i) => {
    const ia = coast[(off + st) % 30], ib = coast[(off + st + 1) % 30];
    const a = vertices[ia], b = vertices[ib];
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const dx = b.x - a.x, dy = b.y - a.y;
    const elen = Math.hypot(dx, dy) || 1;
    let nx = -dy / elen, ny = dx / elen;               // normal al borde
    if (nx * mx + ny * my < 0) { nx = -nx; ny = -ny; } // apuntando al mar
    ports.push({
      id: i, type: PORT_TYPES[i], vids: [ia, ib],
      mx, my, nx, ny,
      px: mx + nx * 40, py: my + ny * 40,   // ápice del muelle (en el mar)
      sx: mx + nx * 68, sy: my + ny * 68,   // cartel
      ix: mx + nx * 98, iy: my + ny * 98,   // velero
    });
  });

  return { hexes, vertices, edges, ports, coast, robber: desert.id, seed };
}

// ---------- mapa niebla: isla de madera + laguna con puertos + 2 anillos ocultos ----------

// isla de madera: anillos 1 y 2 alrededor del centro (18 hexes)
const WOOD_DIST = 2;
// niebla: anillos 3 y 4 (18 + 24 = 42 hexes ocultos)
const FOG_DIST = 4;

// recursos ocultos: solo los 4 que no están en la isla de madera
const FOG_DECK = [
  ...Array(11).fill('hills'),
  ...Array(9).fill('mountains'),
  ...Array(11).fill('fields'),
  ...Array(11).fill('pasture'),
];
// 60 fichas para los 60 hexes con número (18 madera + 42 niebla):
// tres mazos estándar + 6 medias (sin 7, no produce)
const NUMBERS_60 = [...TOKENS, ...TOKENS, ...TOKENS, 3, 4, 5, 6, 8, 9];

// asigna números evitando 6/8 pegados entre TODOS los hexes con ficha
// (isla de madera + niebla). Si en 800 intentos no sale, deja sin restricción.
function assignNumbers(cells, rng) {
  const landIdx = cells.map((c, i) => (c.kind !== 'lagoon' ? i : -1)).filter((i) => i >= 0);
  for (let attempt = 0; attempt < 800; attempt++) {
    const pool = shuffle([...NUMBERS_60], rng);
    landIdx.forEach((i, k) => { cells[i].number = pool[k]; });
    let ok = true;
    outer: for (let i = 0; i < cells.length; i++) {
      if (cells[i].number !== 6 && cells[i].number !== 8) continue;
      for (let j = i + 1; j < cells.length; j++) {
        if ((cells[j].number === 6 || cells[j].number === 8) && axialDist(cells[i], cells[j]) === 1) {
          ok = false; break outer;
        }
      }
    }
    if (ok) return cells.map((c) => c.number);
  }
  return cells.map((c) => c.number); // fallback sin restricción
}

export function generateFogBoard(seed) {
  const rng = mulberry32(seed);
  // celdas: laguna (agua, centro) + madera (anillos 1-2) + niebla (anillos 3-4)
  const cells = [];
  for (let r = -FOG_DIST; r <= FOG_DIST; r++) {
    for (let q = Math.max(-FOG_DIST, -FOG_DIST - r); q <= Math.min(FOG_DIST, FOG_DIST - r); q++) {
      const d = (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2;
      if (d === 0) cells.push({ q, r, kind: 'lagoon', terrain: 'lagoon' });
      else if (d <= WOOD_DIST) cells.push({ q, r, kind: 'land', terrain: 'forest' });
      else cells.push({ q, r, kind: 'fog', terrain: 'fog', fog: true });
    }
  }
  // recursos ocultos: baraja sobre los hexes de niebla (42 y 42, exacto)
  const fogCells = cells.filter((c) => c.kind === 'fog');
  shuffle([...FOG_DECK], rng).forEach((t, i) => { fogCells[i].terrain = t; });

  // números (madera 18 fichas estándar + niebla 42 fichas), sin 6/8 pegados
  const numbers = assignNumbers(cells, rng);

  const hexes = [], vertices = [], edges = [];
  const vMap = new Map(), eMap = new Map();
  cells.forEach((cell, i) => {
    const { x, y } = hexCenter(cell.q, cell.r);
    const hex = {
      id: i, q: cell.q, r: cell.r, x, y,
      terrain: cell.terrain, number: numbers[i],
      fog: !!cell.fog, vertices: [], edges: [],
    };
    const cornerIds = [];
    for (let c = 0; c < 6; c++) {
      const p = hexCorner(x, y, c);
      const key = `${Math.round(p.x * 10)}|${Math.round(p.y * 10)}`;
      if (!vMap.has(key)) {
        const v = { id: vMap.size, x: p.x, y: p.y, hexes: [], edges: [] };
        vMap.set(key, v); vertices.push(v);
      }
      const v = vMap.get(key);
      v.hexes.push(hex.id);
      hex.vertices.push(v.id);
      cornerIds.push(v.id);
    }
    for (let c = 0; c < 6; c++) {
      const a = cornerIds[c], b = cornerIds[(c + 1) % 6];
      const key = `${Math.min(a, b)}-${Math.max(a, b)}`;
      if (!eMap.has(key)) {
        const e = { id: eMap.size, a: Math.min(a, b), b: Math.max(a, b), hexes: [] };
        eMap.set(key, e); edges.push(e);
      }
      const e = eMap.get(key);
      e.hexes.push(hex.id);
      hex.edges.push(e.id);
    }
    hexes.push(hex);
  });

  for (const v of vertices) v.neighbors = [];
  for (const e of edges) {
    vertices[e.a].edges.push(e.id);
    vertices[e.b].edges.push(e.id);
    vertices[e.a].neighbors.push(e.b);
    vertices[e.b].neighbors.push(e.a);
  }

  // costa exterior: ciclo de bordes con un solo hex (los bordes de laguna
  // tienen 2, así que no entran y el ciclo queda limpio)
  const perim = edges.filter((e) => e.hexes.length === 1);
  const atVertex = new Map();
  for (const e of perim) {
    for (const vid of [e.a, e.b]) {
      if (!atVertex.has(vid)) atVertex.set(vid, []);
      atVertex.get(vid).push(e.id);
    }
  }
  const cycle = [perim[0].id];
  let prev = perim[0], curV = perim[0].b;
  while (cycle.length < perim.length) {
    const nextId = atVertex.get(curV).find((eid) => eid !== prev.id);
    if (nextId == null) break; // no debería pasar: el perímetro es un ciclo
    cycle.push(nextId);
    prev = edges[nextId];
    curV = prev.a === curV ? prev.b : prev.a;
  }
  const coast = [];
  {
    let v = perim[0].a;
    for (const eid of cycle) {
      coast.push(v);
      const e = edges[eid];
      v = e.a === v ? e.b : e.a;
    }
  }

  // puertos: 6 × 2:1 madera, uno por borde de la laguna, mirando al agua
  const lagoon = hexes.find((h) => h.terrain === 'lagoon');
  const ports = lagoon.edges.map((eid, i) => {
    const e = edges[eid];
    const a = vertices[e.a], b = vertices[e.b];
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    let nx = lagoon.x - mx, ny = lagoon.y - my;
    const len = Math.hypot(nx, ny) || 1;
    nx /= len; ny /= len;
    return {
      id: i, type: 'wood', vids: [e.a, e.b], small: true,
      mx, my, nx, ny,
      px: mx + nx * 20, py: my + ny * 20, // ápice del muelle, dentro de la laguna
      sx: mx + nx * 10, sy: my + ny * 10, // cartel junto a la orilla (no en el centro)
      ix: lagoon.x, iy: lagoon.y,         // el velero va en el centro de la laguna
    };
  });

  // el ladrón arranca en un hex de madera (elegido con la semilla)
  const wood = hexes.filter((h) => h.terrain === 'forest');
  const robber = wood[Math.floor(rng() * wood.length)].id;

  return { hexes, vertices, edges, ports, coast, robber, seed, map: 'niebla' };
}

// ---------- mapa volcán: rombo de 71 hexes con piedra fija, niebla y oro ----------

// Grilla FIJA de Fran (71 casillas, filas de 10/11/10/9/10/11/10):
//  - P = piedra fija (18): el anillo alrededor del oro + manchas
//  - D = desierto fijo (14): las puntas del rombo, ahí arranca el ladrón
//  - N = niebla fija (18): esconden recurso variable SIN piedra, se revelan
//    con caminos (+1 de recompensa) y bloquean poblados hasta descubrirse
//  - O = oro (1, centro exacto, ficha 8 fija): elegir madera/trigo/ladrillo/piedra
//  - R = recurso variable (20): bosque/pasto/campo/ladrillo — SIN piedra
// Los puertos mantienen posiciones fijas; solo se baraja lo que canjean.
const VOLCAN_GRID = [
  'RRDPNNPDRR',
  'RRDNPNPNDRR',
  'RDNNPPNNDR',
  'DPPPOPPPD',
  'RDNNPPNNDR',
  'RRDNPNPNDRR',
  'RRDPNNPDRR',
];
// reparto balanceado para las 38 casillas de recurso variable (20 R + 18 N),
// siempre los 4 que no son piedra
const VOLCAN_VAR_DECK = [
  ...Array(10).fill('forest'),
  ...Array(10).fill('pasture'),
  ...Array(9).fill('fields'),
  ...Array(9).fill('hills'),
];
// Números por zonas (balance de Fran): las esquinas (R) solo pueden llevar
// 4-10 sin 7; el interior (piedra, niebla y el oro) es totalmente aleatorio
// 2-12 sin 7. En total 8 fichas rojas para que la regla de no 6/8 pegados
// siempre tenga solución.
const VOLCAN_CORNER_NUMBERS = [
  ...Array(4).fill(4), ...Array(4).fill(5), ...Array(3).fill(6),
  ...Array(3).fill(8), ...Array(3).fill(9), ...Array(3).fill(10),
]; // 20 esquinas
const VOLCAN_INTERIOR_NUMBERS = [
  ...TOKENS,
  ...Array(2).fill(2), ...Array(2).fill(3), ...Array(2).fill(4), ...Array(2).fill(5),
  ...Array(2).fill(9), ...Array(2).fill(10), ...Array(2).fill(11), ...Array(2).fill(12),
  2, 4,
]; // 37 interiores, solo 4 rojas (con más no se satisface el no 6/8 pegado)

export function generateOroBoard(seed) {
  const rng = mulberry32(seed);
  const cells = [];
  VOLCAN_GRID.forEach((row, f) => {
    const r = f - 3;
    const q0 = -Math.round((row.length - 1) / 2 + r / 2); // centra cada fila
    [...row].forEach((code, c) => {
      const q = q0 + c;
      if (code === 'D') cells.push({ q, r, kind: 'desert', terrain: 'desert', number: 0 });
      else if (code === 'P') cells.push({ q, r, kind: 'land', terrain: 'mountains', number: 0 });
      else if (code === 'O') cells.push({ q, r, kind: 'gold', terrain: 'gold', number: 8 });
      else if (code === 'N') cells.push({ q, r, kind: 'fog', terrain: 'fog', fog: true, number: 0 });
      else cells.push({ q, r, kind: 'var', terrain: 'var', number: 0, plain: true });
    });
  });

  // recursos variables: reparto balanceado sobre R + N (la niebla esconde uno,
  // nunca piedra: la piedra es exclusiva de las P fijas)
  const variables = cells.filter((c) => c.kind === 'var' || c.kind === 'fog');
  shuffle([...VOLCAN_VAR_DECK], rng).forEach((t, i) => { variables[i].terrain = t; });

  // números: esquinas del mazo acotado 4-10; interior (piedra/niebla/oro)
  // al azar; sin 6/8 pegados entre TODAS las fichas (el número del oro incluido)
  const corners = cells.filter((c) => c.kind === 'var');
  const interior = cells.filter((c) => c.kind !== 'desert' && c.kind !== 'var');
  const goldCell = interior.find((c) => c.kind === 'gold');
  const interiorSinOro = interior.filter((c) => c.kind !== 'gold');
  for (let attempt = 0; attempt < 800; attempt++) {
    const cc = shuffle([...VOLCAN_CORNER_NUMBERS], rng);
    corners.forEach((c, i) => { c.number = cc[i]; });
    const ic = shuffle([...VOLCAN_INTERIOR_NUMBERS], rng);
    goldCell.number = ic[0];
    interiorSinOro.forEach((c, i) => { c.number = ic[i + 1]; });
    let ok = true;
    outer: for (let i = 0; i < cells.length; i++) {
      if (cells[i].number !== 6 && cells[i].number !== 8) continue;
      for (let j = i + 1; j < cells.length; j++) {
        if ((cells[j].number === 6 || cells[j].number === 8) && axialDist(cells[i], cells[j]) === 1) {
          ok = false; break outer;
        }
      }
    }
    if (ok) break;
  }

  const hexes = [], vertices = [], edges = [];
  const vMap = new Map(), eMap = new Map();
  cells.forEach((cell, i) => {
    const { x, y } = hexCenter(cell.q, cell.r);
    const hex = {
      id: i, q: cell.q, r: cell.r, x, y,
      terrain: cell.terrain, number: cell.number, fog: !!cell.fog, plain: !!cell.plain,
      vertices: [], edges: [],
    };
    const cornerIds = [];
    for (let c = 0; c < 6; c++) {
      const p = hexCorner(x, y, c);
      const key = `${Math.round(p.x * 10)}|${Math.round(p.y * 10)}`;
      if (!vMap.has(key)) {
        const v = { id: vMap.size, x: p.x, y: p.y, hexes: [], edges: [] };
        vMap.set(key, v); vertices.push(v);
      }
      const v = vMap.get(key);
      v.hexes.push(hex.id);
      hex.vertices.push(v.id);
      cornerIds.push(v.id);
    }
    for (let c = 0; c < 6; c++) {
      const a = cornerIds[c], b = cornerIds[(c + 1) % 6];
      const key = `${Math.min(a, b)}-${Math.max(a, b)}`;
      if (!eMap.has(key)) {
        const e = { id: eMap.size, a: Math.min(a, b), b: Math.max(a, b), hexes: [] };
        eMap.set(key, e); edges.push(e);
      }
      const e = eMap.get(key);
      e.hexes.push(hex.id);
      hex.edges.push(e.id);
    }
    hexes.push(hex);
  });

  for (const v of vertices) v.neighbors = [];
  for (const e of edges) {
    vertices[e.a].edges.push(e.id);
    vertices[e.b].edges.push(e.id);
    vertices[e.a].neighbors.push(e.b);
    vertices[e.b].neighbors.push(e.a);
  }

  // costa exterior
  const perim = edges.filter((e) => e.hexes.length === 1);
  const atVertex = new Map();
  for (const e of perim) {
    for (const vid of [e.a, e.b]) {
      if (!atVertex.has(vid)) atVertex.set(vid, []);
      atVertex.get(vid).push(e.id);
    }
  }
  const cycle = [perim[0].id];
  let prev = perim[0], curV = perim[0].b;
  while (cycle.length < perim.length) {
    const nextId = atVertex.get(curV).find((eid) => eid !== prev.id);
    if (nextId == null) break;
    cycle.push(nextId);
    prev = edges[nextId];
    curV = prev.a === curV ? prev.b : prev.a;
  }
  const coast = [];
  {
    let v = perim[0].a;
    for (const eid of cycle) {
      coast.push(v);
      const e = edges[eid];
      v = e.a === v ? e.b : e.a;
    }
  }

  // puertos: posiciones FIJAS (reparto parejo por la costa), tipo barajado
  const PORT_TYPES = ['3:1', 'wood', '3:1', 'sheep', '3:1', 'ore', '3:1', 'brick', 'wheat'];
  const portTypes = shuffle([...PORT_TYPES], rng);
  const ports = PORT_TYPES.map((_, i) => {
    const s = Math.round((i * coast.length) / PORT_TYPES.length) % coast.length;
    const ia = coast[s], ib = coast[(s + 1) % coast.length];
    const a = vertices[ia], b = vertices[ib];
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const dx = b.x - a.x, dy = b.y - a.y;
    const elen = Math.hypot(dx, dy) || 1;
    let nx = -dy / elen, ny = dx / elen;
    if (nx * mx + ny * my < 0) { nx = -nx; ny = -ny; }
    return {
      id: i, type: portTypes[i], vids: [ia, ib],
      mx, my, nx, ny,
      px: mx + nx * 40, py: my + ny * 40,
      sx: mx + nx * 68, sy: my + ny * 68,
      ix: mx + nx * 98, iy: my + ny * 98,
    };
  });

  // el ladrón arranca en el primer desierto (determinístico)
  const desert = hexes.find((h) => h.terrain === 'desert');

  return { hexes, vertices, edges, ports, coast, robber: desert.id, seed, map: 'oro', firstRoundPlain: true };
}
