// Hexland — SVG board rendering, Colonist-style reskin.
// Full redraw on every state change (it's cheap).

import { S, PIPS } from './board.js';

export const TERRAIN_FILL = {
  hills: '#e2703a',
  forest: '#2f9e57',
  mountains: '#a9adb3',
  fields: '#f2c94c',
  pasture: '#8cc63f',
  desert: '#eae3b9',
};

function shade(hex, pct) {
  // pct > 0 aclara, < 0 oscurece
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = (c) => Math.max(0, Math.min(255, Math.round(pct > 0 ? c + (255 - c) * (pct / 100) : c * (1 + pct / 100))));
  return `#${((f(r) << 16) | (f(g) << 8) | f(b)).toString(16).padStart(6, '0')}`;
}

// texturas sutiles por terreno (pattern userSpaceOnUse)
function terrainPattern(defs, terrain, base) {
  const pat = el('pattern', { id: `tp-${terrain}`, width: 16, height: 16, patternUnits: 'userSpaceOnUse' }, defs);
  const dark = shade(base, -20);
  const light = shade(base, 25);
  if (terrain === 'pasture' || terrain === 'forest') {
    el('circle', { cx: 3, cy: 4, r: 1.7, fill: dark, opacity: 0.45 }, pat);
    el('circle', { cx: 11, cy: 11, r: 1.7, fill: light, opacity: 0.5 }, pat);
  } else if (terrain === 'fields') {
    el('path', { d: 'M0,7 Q4,3.5 8,7 T16,7', stroke: dark, 'stroke-width': 1.6, fill: 'none', opacity: 0.45 }, pat);
    el('path', { d: 'M0,15 Q4,11.5 8,15 T16,15', stroke: dark, 'stroke-width': 1.6, fill: 'none', opacity: 0.3 }, pat);
  } else if (terrain === 'hills') {
    el('path', { d: 'M3,13 L13,3', stroke: dark, 'stroke-width': 2, 'stroke-linecap': 'round', opacity: 0.4 }, pat);
  } else if (terrain === 'mountains') {
    el('circle', { cx: 4, cy: 5, r: 1.9, fill: dark, opacity: 0.55 }, pat);
    el('circle', { cx: 12, cy: 12, r: 1.5, fill: light, opacity: 0.7 }, pat);
  } else {
    el('circle', { cx: 4, cy: 4, r: 1.4, fill: shade(base, -18), opacity: 0.55 }, pat);
    el('circle', { cx: 12, cy: 11, r: 1.2, fill: shade(base, -18), opacity: 0.45 }, pat);
  }
}

const SEA = '#2f6fb5';
const SAND = '#f0dfb2';

// faint decorations floating in the sea
const DOODLES = [
  [-300, -180, '⚓'], [290, -170, '🐚'], [-330, 120, '🐟'], [320, 160, '🐬'],
  [-260, 250, '🦀'], [250, -270, '⛵'], [-80, -310, '🐙'], [130, 300, '🐡'],
  [-360, -30, '🪸'], [360, 30, '🧭'],
];

const SVG_NS = 'http://www.w3.org/2000/svg';

function el(tag, attrs = {}, parent = null) {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
}

function hexPoints(h) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = ((60 * i - 90) * Math.PI) / 180;
    pts.push(`${(h.x + S * Math.cos(a)).toFixed(1)},${(h.y + S * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(' ');
}

/**
 * Draw the whole board. targets: { vertices:Set, edges:Set, hexes:Set } of
 * clickable ids for the current UI mode.
 */
export function renderBoard(svg, st, targets, onPick) {
  svg.innerHTML = '';
  svg.setAttribute('viewBox', '-400 -360 800 720');

  // defs: arena, sombras y clips por hexágono
  const defs = el('defs', {}, svg);
  const sandLg = el('linearGradient', { id: 'tg-sand', x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
  el('stop', { offset: '0%', 'stop-color': '#f6e8c3' }, sandLg);
  el('stop', { offset: '100%', 'stop-color': '#e6cf9e' }, sandLg);
  const fTok = el('filter', { id: 'f-tok', x: '-40%', y: '-40%', width: '180%', height: '180%' }, defs);
  el('feDropShadow', { dx: 0, dy: 2.5, stdDeviation: 1.8, 'flood-color': '#08243e', 'flood-opacity': 0.4 }, fTok);
  const fPiece = el('filter', { id: 'f-piece', x: '-40%', y: '-40%', width: '180%', height: '180%' }, defs);
  el('feDropShadow', { dx: 0, dy: 2, stdDeviation: 1.5, 'flood-color': '#08243e', 'flood-opacity': 0.45 }, fPiece);

  // sea
  el('rect', { x: -400, y: -360, width: 800, height: 720, fill: SEA }, svg);
  for (const [x, y, e] of DOODLES) {
    el('text', { x, y, 'font-size': 40, opacity: 0.08, 'text-anchor': 'middle' }, svg).textContent = e;
  }

  // island coast: shadow + white foam + sand platform
  const coastPts = st.board.coast
    .map((vid) => st.board.vertices[vid])
    .map((v) => `${v.x.toFixed(1)},${v.y.toFixed(1)}`)
    .join(' ');
  el('polygon', { points: coastPts, fill: 'rgba(8,30,55,0.30)', transform: 'translate(0 9)' }, svg);
  el('polygon', {
    points: coastPts, fill: SAND, stroke: '#eef6ff', 'stroke-width': 56,
    'stroke-linejoin': 'round', opacity: 0.95,
  }, svg);
  el('polygon', { points: coastPts, fill: 'url(#tg-sand)', stroke: '#d9bf8d', 'stroke-width': 2.5, 'stroke-linejoin': 'round' }, svg);

  // hex tiles: la ilustración de Fran recortada al hex + borde
  const TW = Math.sqrt(3) * S, TH = 2 * S;
  const gShadow = el('g', { 'pointer-events': 'none' }, svg);
  for (const h of st.board.hexes) {
    el('polygon', { points: hexPoints(h), fill: 'rgba(8,30,55,0.22)', transform: 'translate(0 4.5)' }, gShadow);
  }
  const gHex = el('g', {}, svg);
  for (const h of st.board.hexes) {
    const clipId = `hc-${h.id}`;
    const cp = el('clipPath', { id: clipId }, defs);
    el('polygon', { points: hexPoints(h) }, cp);
    const g = el('g', { 'clip-path': `url(#${clipId})` }, gHex);
    el('image', {
      href: `tiles/${h.terrain}.png?v=2`,
      x: (h.x - TW / 2).toFixed(1), y: (h.y - TH / 2).toFixed(1),
      width: TW, height: TH,
      preserveAspectRatio: 'xMidYMid slice',
    }, g);
    el('polygon', {
      points: hexPoints(h), fill: 'none',
      stroke: shade(TERRAIN_FILL[h.terrain], -30),
      'stroke-width': 4, 'stroke-linejoin': 'round',
      'data-hid': h.id,
    }, gHex);
  }

  // flashing border on every hex matching the last roll (white on navy: visible on any terrain)
  if (Array.isArray(st.lastProduced) && st.lastProduced.length) {
    const gP = el('g', { 'pointer-events': 'none' }, svg);
    for (const hid of st.lastProduced) {
      const h = st.board.hexes[hid];
      el('polygon', {
        points: hexPoints(h), fill: 'none', stroke: '#1d3557',
        'stroke-width': 14, 'stroke-linejoin': 'round', class: 'prodflash',
      }, gP);
      el('polygon', {
        points: hexPoints(h), fill: 'none', stroke: '#ffffff',
        'stroke-width': 8, 'stroke-linejoin': 'round', class: 'prodflash',
      }, gP);
    }
  }

  // number tokens: carta blanca sobre el claro del tile
  const gNum = el('g', { 'pointer-events': 'none', filter: 'url(#f-tok)' }, svg);
  for (const h of st.board.hexes) {
    if (!h.number) continue;
    const red = h.number === 6 || h.number === 8;
    const g = el('g', { transform: `translate(${h.x} ${h.y})` }, gNum);
    el('rect', { x: -17, y: -20, width: 34, height: 40, rx: 9, fill: '#fdfcf7', stroke: '#d8d2c2', 'stroke-width': 1 }, g);
    el('text', {
      y: 1, 'text-anchor': 'middle', 'font-size': 15, 'font-weight': 800,
      fill: red ? '#c0392b' : '#33383d', 'font-family': 'system-ui',
    }, g).textContent = h.number;
    const pips = PIPS[h.number] || 0;
    for (let i = 0; i < pips; i++) {
      el('circle', { cx: (i - (pips - 1) / 2) * 3.4, cy: 13, r: 1.4, fill: '#c0392b' }, g);
    }
  }

  // "+N" badges on hexes that paid out this roll
  if (st.lastGain && Object.keys(st.lastGain).length) {
    const gG = el('g', { 'pointer-events': 'none' }, svg);
    for (const [hid, info] of Object.entries(st.lastGain)) {
      const h = st.board.hexes[Number(hid)];
      const g = el('g', { transform: `translate(${h.x.toFixed(1)} ${(h.y - 54).toFixed(1)})` }, gG);
      el('rect', { x: -28, y: -13, width: 56, height: 24, rx: 12, fill: '#fdfcf7', stroke: '#c9b48a', 'stroke-width': 1.5 }, g);
      el('text', {
        y: 5, 'text-anchor': 'middle', 'font-size': 13, 'font-weight': 800,
        fill: '#3d3325', 'font-family': 'system-ui',
      }, g).textContent = `+${info.n} ${portEmoji(info.res)}`;
    }
  }

  // robber token
  const rHex = st.board.hexes.find((h) => h.id === st.robber);
  const gRob = el('g', { transform: `translate(${rHex.x + 32} ${rHex.y + 34})`, 'pointer-events': 'none', filter: 'url(#f-piece)' }, svg);
  el('circle', { r: 13, fill: '#5a5f66', stroke: '#fff', 'stroke-width': 2.5 }, gRob);
  el('text', { y: 4.5, 'text-anchor': 'middle', 'font-size': 14 }, gRob).textContent = '🦹';

  // ports: muelle en V — desde el ápice en el mar hacia CADA uno de los dos
  // vértices de acceso; cartel sobre el ápice y velero más afuera
  const gPort = el('g', { 'pointer-events': 'none' }, svg);
  for (const p of st.board.ports) {
    const [va, vb] = p.vids.map((vid) => st.board.vertices[vid]);
    const leg = (v) => {
      el('line', { x1: v.x, y1: v.y, x2: p.px, y2: p.py, stroke: '#a4713d', 'stroke-width': 8, 'stroke-linecap': 'round' }, gPort);
      el('line', { x1: v.x, y1: v.y, x2: p.px, y2: p.py, stroke: '#8a5a2b', 'stroke-width': 8, 'stroke-linecap': 'round', 'stroke-dasharray': '3 10' }, gPort);
    };
    leg(va);
    leg(vb);
    const g = el('g', { transform: `translate(${p.sx.toFixed(1)} ${p.sy.toFixed(1)})` }, gPort);
    el('rect', { x: -26, y: -13, width: 52, height: 26, rx: 7, fill: '#fdfcf7', stroke: '#c9b48a', 'stroke-width': 1.5 }, g);
    const label = p.type === '3:1' ? '3:1 ❓' : `2:1 ${portEmoji(p.type)}`;
    el('text', {
      y: 1, 'text-anchor': 'middle', 'dominant-baseline': 'middle', 'font-size': 13,
      'font-weight': 800, fill: '#3d3325', 'font-family': 'system-ui',
    }, g).textContent = label;
    el('text', { x: p.ix.toFixed(1), y: (p.iy + 10).toFixed(1), 'font-size': 30, 'text-anchor': 'middle' }, gPort).textContent = '⛵';
  }

  // roads: player color with white outline
  const gRoad = el('g', { filter: 'url(#f-piece)' }, svg);
  for (const p of st.players) {
    for (const eid of p.roads) {
      const e = st.board.edges[eid];
      const a = st.board.vertices[e.a], b = st.board.vertices[e.b];
      el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: '#f8f8f2', 'stroke-width': 12, 'stroke-linecap': 'round' }, gRoad);
      el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: p.color, 'stroke-width': 7.5, 'stroke-linecap': 'round' }, gRoad);
    }
  }

  // buildings: two-tone (sombra base + techo claro) con borde blanco
  const gB = el('g', { filter: 'url(#f-piece)' }, svg);
  for (const p of st.players) {
    const dark = shade(p.color, -18);
    const light = shade(p.color, 28);
    for (const vid of p.settlements) {
      const v = st.board.vertices[vid];
      const g = el('g', { transform: `translate(${v.x} ${v.y})` }, gB);
      el('path', { d: 'M-9 4 L-9 -4 L9 -4 L9 4 Z', fill: dark, stroke: '#f8f8f2', 'stroke-width': 2.2, 'stroke-linejoin': 'round' }, g);
      el('path', { d: 'M-10 -4 L0 -13 L10 -4 Z', fill: p.color, stroke: '#f8f8f2', 'stroke-width': 2.2, 'stroke-linejoin': 'round' }, g);
      el('path', { d: 'M-6 -6 L0 -11 L6 -6', fill: 'none', stroke: light, 'stroke-width': 2, 'stroke-linecap': 'round' }, g);
    }
    for (const vid of p.cities) {
      const v = st.board.vertices[vid];
      const g = el('g', { transform: `translate(${v.x} ${v.y})` }, gB);
      el('path', { d: 'M-12 4 L-12 -4 L12 -4 L12 4 Z', fill: dark, stroke: '#f8f8f2', 'stroke-width': 2.2, 'stroke-linejoin': 'round' }, g);
      el('path', { d: 'M-12 4 L-12 -4 L-5 -4 L-5 -11 L-11 -11 L-11 -4', fill: p.color, stroke: '#f8f8f2', 'stroke-width': 2.2, 'stroke-linejoin': 'round' }, g);
      el('path', { d: 'M-5 -4 L-5 -11 L12 -11 L12 4 L5 4 L5 -4 Z', fill: p.color, stroke: '#f8f8f2', 'stroke-width': 2.2, 'stroke-linejoin': 'round' }, g);
      el('path', { d: 'M-9 -6 L-5 -9', fill: 'none', stroke: light, 'stroke-width': 2, 'stroke-linecap': 'round' }, g);
    }
  }

  // interactive targets on top
  const gT = el('g', {}, svg);
  for (const hid of targets.hexes || []) {
    const h = st.board.hexes[hid];
    el('polygon', {
      points: hexPoints(h), fill: '#ffffff', opacity: 0.32, stroke: '#fff',
      'stroke-width': 3, 'stroke-dasharray': '7 5', 'data-hid': hid, class: 'target',
    }, gT);
  }
  for (const eid of targets.edges || []) {
    const e = st.board.edges[eid];
    const a = st.board.vertices[e.a], b = st.board.vertices[e.b];
    el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: '#ffffff', 'stroke-width': 13, 'stroke-linecap': 'round', opacity: 0.55, 'data-eid': eid, class: 'target' }, gT);
  }
  for (const vid of targets.vertices || []) {
    const v = st.board.vertices[vid];
    el('circle', { cx: v.x, cy: v.y, r: 9, fill: '#ffffff', stroke: '#1d4e89', 'stroke-width': 2, 'data-vid': vid, class: 'target pulse' }, gT);
  }

  svg.onclick = (ev) => {
    const t = ev.target.closest('[data-vid],[data-eid],[data-hid]');
    if (!t) return;
    if (t.dataset.vid != null) onPick('vertex', Number(t.dataset.vid));
    else if (t.dataset.eid != null) onPick('edge', Number(t.dataset.eid));
    else if (t.dataset.hid != null) onPick('hex', Number(t.dataset.hid));
  };
}

function portEmoji(type) {
  return { wood: '🌲', brick: '🧱', sheep: '🐑', wheat: '🌾', ore: '⛰️' }[type] || '';
}
