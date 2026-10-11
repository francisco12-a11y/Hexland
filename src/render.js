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
const TERRAIN_ICON = { hills: '🧱', forest: '🌲', mountains: '🪨', fields: '🌾', pasture: '🐑', desert: '🌵' };
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

  // sea
  el('rect', { x: -400, y: -360, width: 800, height: 720, fill: SEA }, svg);
  for (const [x, y, e] of DOODLES) {
    el('text', { x, y, 'font-size': 40, opacity: 0.08, 'text-anchor': 'middle' }, svg).textContent = e;
  }

  // island coast: white foam ring + sand ring under the hexes
  const coastPts = st.board.coast
    .map((vid) => st.board.vertices[vid])
    .map((v) => `${v.x.toFixed(1)},${v.y.toFixed(1)}`)
    .join(' ');
  el('polygon', {
    points: coastPts, fill: SAND, stroke: '#eef6ff', 'stroke-width': 58,
    'stroke-linejoin': 'round', opacity: 0.95,
  }, svg);
  el('polygon', {
    points: coastPts, fill: SAND, stroke: SAND, 'stroke-width': 40, 'stroke-linejoin': 'round',
  }, svg);

  // hexes
  const gHex = el('g', {}, svg);
  for (const h of st.board.hexes) {
    el('polygon', {
      points: hexPoints(h),
      fill: TERRAIN_FILL[h.terrain],
      stroke: 'rgba(255,255,255,0.5)',
      'stroke-width': 2,
      'stroke-linejoin': 'round',
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

  // terrain icons
  const gIcon = el('g', { 'pointer-events': 'none' }, svg);
  for (const h of st.board.hexes) {
    el('text', {
      x: h.x, y: h.y - 22, 'font-size': 36, 'text-anchor': 'middle', opacity: 0.95,
    }, gIcon).textContent = TERRAIN_ICON[h.terrain];
  }

  // number tokens: white rounded cards
  const gNum = el('g', { 'pointer-events': 'none' }, svg);
  for (const h of st.board.hexes) {
    if (!h.number) continue;
    const red = h.number === 6 || h.number === 8;
    const g = el('g', { transform: `translate(${h.x} ${h.y})` }, gNum);
    el('rect', { x: -17, y: -14, width: 34, height: 40, rx: 9, fill: '#fdfcf7', stroke: '#d8d2c2', 'stroke-width': 1 }, g);
    el('text', {
      y: 5, 'text-anchor': 'middle', 'font-size': 17, 'font-weight': 800,
      fill: red ? '#c0392b' : '#33383d', 'font-family': 'system-ui',
    }, g).textContent = h.number;
    const pips = PIPS[h.number] || 0;
    for (let i = 0; i < pips; i++) {
      el('circle', { cx: (i - (pips - 1) / 2) * 3.4, cy: 15, r: 1.4, fill: '#c0392b' }, g);
    }
  }

  // robber token
  const rHex = st.board.hexes.find((h) => h.id === st.robber);
  const gRob = el('g', { transform: `translate(${rHex.x + 32} ${rHex.y + 34})`, 'pointer-events': 'none' }, svg);
  el('circle', { r: 13, fill: '#5a5f66', stroke: '#fff', 'stroke-width': 2.5 }, gRob);
  el('text', { y: 4.5, 'text-anchor': 'middle', 'font-size': 14 }, gRob).textContent = '🦹';

  // ports: wooden pier out to a ship, ratio sign above it
  const gPort = el('g', { 'pointer-events': 'none' }, svg);
  for (const p of st.board.ports) {
    el('line', { x1: p.mx, y1: p.my, x2: p.px, y2: p.py, stroke: '#a4713d', 'stroke-width': 9, 'stroke-linecap': 'round' }, gPort);
    el('line', { x1: p.mx, y1: p.my, x2: p.px, y2: p.py, stroke: '#8a5a2b', 'stroke-width': 9, 'stroke-linecap': 'round', 'stroke-dasharray': '3 10' }, gPort);
    const g = el('g', { transform: `translate(${p.ix.toFixed(1)} ${p.iy.toFixed(1)})` }, gPort);
    el('text', { y: 12, 'font-size': 30, 'text-anchor': 'middle' }, g).textContent = '⛵';
    el('rect', { x: -26, y: -40, width: 52, height: 26, rx: 7, fill: '#fdfcf7', stroke: '#c9b48a', 'stroke-width': 1.5 }, g);
    const label = p.type === '3:1' ? '3:1 ❓' : `2:1 ${portEmoji(p.type)}`;
    el('text', {
      y: -22, 'text-anchor': 'middle', 'font-size': 13, 'font-weight': 800,
      fill: '#3d3325', 'font-family': 'system-ui',
    }, g).textContent = label;
  }

  // roads: player color with white outline
  const gRoad = el('g', {}, svg);
  for (const p of st.players) {
    for (const eid of p.roads) {
      const e = st.board.edges[eid];
      const a = st.board.vertices[e.a], b = st.board.vertices[e.b];
      el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: '#f8f8f2', 'stroke-width': 12, 'stroke-linecap': 'round' }, gRoad);
      el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: p.color, 'stroke-width': 7.5, 'stroke-linecap': 'round' }, gRoad);
    }
  }

  // buildings: player color with white outline
  const gB = el('g', {}, svg);
  for (const p of st.players) {
    for (const vid of p.settlements) {
      const v = st.board.vertices[vid];
      el('path', {
        d: 'M-9 4 L-9 -4 L0 -12 L9 -4 L9 4 Z',
        transform: `translate(${v.x} ${v.y})`,
        fill: p.color, stroke: '#f8f8f2', 'stroke-width': 2.4, 'stroke-linejoin': 'round',
      }, gB);
    }
    for (const vid of p.cities) {
      const v = st.board.vertices[vid];
      el('path', {
        d: 'M-12 4 L-12 -4 L-5 -10 L-5 -4 L5 -4 L5 -12 L12 -12 L12 4 Z',
        transform: `translate(${v.x} ${v.y})`,
        fill: p.color, stroke: '#f8f8f2', 'stroke-width': 2.4, 'stroke-linejoin': 'round',
      }, gB);
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
