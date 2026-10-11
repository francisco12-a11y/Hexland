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

export function generateBoard(seed) {
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
      const key = `${p.x.toFixed(1)}|${p.y.toFixed(1)}`;
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

  // 9 puertos uniformes sobre el perímetro: el muelle sale PERPENDICULAR al
  // borde costero (no radial), con el cartel sobre el muelle y el velero
  // más afuera. Acceso desde los dos vértices costeros del borde.
  const PORT_TYPES = shuffle(['3:1', '3:1', '3:1', '3:1', 'wood', 'sheep', 'ore', 'brick', 'wheat'], rng);
  const off = Math.floor(rng() * 2);
  const ports = [];
  for (let i = 0; i < 9; i++) {
    const e = edges[cycle[(off + 2 * i) % cycle.length]];
    const a = vertices[e.a], b = vertices[e.b];
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const dx = b.x - a.x, dy = b.y - a.y;
    const elen = Math.hypot(dx, dy) || 1;
    let nx = -dy / elen, ny = dx / elen;               // normal al borde
    if (nx * mx + ny * my < 0) { nx = -nx; ny = -ny; } // apuntando al mar
    ports.push({
      id: i, type: PORT_TYPES[i], vids: [e.a, e.b],
      mx, my, nx, ny,
      px: mx + nx * 36, py: my + ny * 36,   // fin del muelle
      sx: mx + nx * 62, sy: my + ny * 62,   // cartel
      ix: mx + nx * 94, iy: my + ny * 94,   // velero
    });
  }

  return { hexes, vertices, edges, ports, coast, robber: desert.id, seed };
}
