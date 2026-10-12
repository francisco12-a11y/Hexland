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

// ---------- mapa volcán: rectángulo 10×7 con borde de desierto y oro central ----------

// rectángulo de 10 columnas × 7 filas (70 hexes). Layout FIJO como la foto:
//  - perímetro: desierto puro (30 hexes, sin números)
//  - interior 8×5 (40): masa de piedra al centro, bosque/oveja/ladrillo en el
//    borde interior, y el ORO en el centro exacto con ficha 8 fija
//  - los números del interior se mezclan en cada partida (TOKENS×2 + [2,3,4,5]),
//    sin 6/8 pegados entre sí ni con el oro
// F = bosque, P = oveja, H = ladrillo, M = piedra, G = oro
const VOLCAN_ROWS = [
  ['F', 'P', 'M', 'M', 'M', 'M', 'P', 'F'],
  ['H', 'M', 'M', 'M', 'M', 'M', 'M', 'H'],
  ['F', 'M', 'M', 'M', 'G', 'M', 'M', 'F'],
  ['H', 'M', 'M', 'M', 'M', 'M', 'M', 'H'],
  ['F', 'P', 'M', 'M', 'M', 'M', 'P', 'F'],
];
const VOLCAN_TERRAIN = { F: 'forest', P: 'pasture', H: 'hills', M: 'mountains', G: 'gold' };

export function generateOroBoard(seed) {
  const rng = mulberry32(seed);
  const cells = [];
  for (let r = -3; r <= 3; r++) {
    const q0 = -Math.round(4.5 + r / 2); // centra cada fila de 10
    for (let q = q0; q < q0 + 10; q++) {
      const borde = Math.abs(r) === 3 || q === q0 || q === q0 + 9;
      if (borde) {
        cells.push({ q, r, kind: 'desert', terrain: 'desert', number: 0 });
        continue;
      }
      const row = VOLCAN_ROWS[r + 2];
      const c = q - (q0 + 1);
      const code = row[c];
      cells.push({
        q, r,
        kind: code === 'G' ? 'gold' : 'land',
        terrain: VOLCAN_TERRAIN[code],
        number: code === 'G' ? 8 : 0,
      });
    }
  }

  // números para los 39 hexes interiores sin oro: dos mazos estándar + [2,3,4,5]
  const pool = [...TOKENS, ...TOKENS, 2, 3, 4, 5];
  const interior = cells.filter((c) => c.kind !== 'desert');
  for (let attempt = 0; attempt < 800; attempt++) {
    const cand = shuffle([...pool], rng);
    interior.forEach((c, i) => { if (c.kind !== 'gold') c.number = cand[i]; });
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
    if (attempt === 799) {
      const last = shuffle([...pool], rng);
      interior.forEach((c, i) => { if (c.kind !== 'gold') c.number = last[i]; });
    }
  }

  const hexes = [], vertices = [], edges = [];
  const vMap = new Map(), eMap = new Map();
  cells.forEach((cell, i) => {
    const { x, y } = hexCenter(cell.q, cell.r);
    const hex = { id: i, q: cell.q, r: cell.r, x, y, terrain: cell.terrain, number: cell.number, vertices: [], edges: [] };
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

  // costa exterior (el desierto es tierra: el ciclo rodea todo el rectángulo)
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

  // puertos: 9 en marco fijo, repartidos parejo por la costa
  const PORT_TYPES = ['3:1', 'wood', '3:1', 'sheep', '3:1', 'ore', '3:1', 'brick', 'wheat'];
  const ports = PORT_TYPES.map((type, i) => {
    const s = Math.round((i * coast.length) / PORT_TYPES.length) % coast.length;
    const ia = coast[s], ib = coast[(s + 1) % coast.length];
    const a = vertices[ia], b = vertices[ib];
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const dx = b.x - a.x, dy = b.y - a.y;
    const elen = Math.hypot(dx, dy) || 1;
    let nx = -dy / elen, ny = dx / elen;
    if (nx * mx + ny * my < 0) { nx = -nx; ny = -ny; }
    return {
      id: i, type, vids: [ia, ib],
      mx, my, nx, ny,
      px: mx + nx * 40, py: my + ny * 40,
      sx: mx + nx * 68, sy: my + ny * 68,
      ix: mx + nx * 98, iy: my + ny * 98,
    };
  });

  // el ladrón arranca en el desierto
  const desert = hexes.find((h) => h.terrain === 'desert');

  return { hexes, vertices, edges, ports, coast, robber: desert.id, seed, map: 'oro' };
}
