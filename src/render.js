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
  gold: '#d9a50f',
};

function shade(hex, pct) {
  // pct > 0 aclara, < 0 oscurece
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = (c) => Math.max(0, Math.min(255, Math.round(pct > 0 ? c + (255 - c) * (pct / 100) : c * (1 + pct / 100))));
  return `#${((f(r) << 16) | (f(g) << 8) | f(b)).toString(16).padStart(6, '0')}`;
}

// ---------- ilustraciones vectoriales por terreno (coords locales al hex) ----------

function tree(x, y, s) {
  return `<g transform="translate(${x} ${y}) scale(${s})">
    <rect x="-4" y="8" width="8" height="15" rx="2" fill="#6b4226"/>
    <polygon points="0,-27 15,-3 -15,-3" fill="#1d7343"/>
    <polygon points="0,-14 17,12 -17,12" fill="#2a8a4f"/>
    <polygon points="0,-24 9,-8 -7,-8" fill="#3da363" opacity="0.8"/>
  </g>`;
}

function sheep(x, y, s) {
  return `<g transform="translate(${x} ${y}) scale(${s})">
    <rect x="-15" y="9" width="5" height="13" rx="2" fill="#5a544a"/>
    <rect x="-3" y="11" width="5" height="11" rx="2" fill="#5a544a"/>
    <rect x="9" y="10" width="5" height="12" rx="2" fill="#5a544a"/>
    <ellipse cx="0" cy="4" rx="25" ry="17" fill="#fdfcf7" stroke="#b9b3a2" stroke-width="2"/>
    <circle cx="-13" cy="-2" r="8.5" fill="#fdfcf7" stroke="#b9b3a2" stroke-width="2"/>
    <circle cx="-1" cy="-6" r="9" fill="#fdfcf7" stroke="#b9b3a2" stroke-width="2"/>
    <circle cx="11" cy="-2" r="8" fill="#fdfcf7" stroke="#b9b3a2" stroke-width="2"/>
    <ellipse cx="21" cy="0" rx="7" ry="6.5" fill="#4a443c"/>
    <ellipse cx="25" cy="-6" rx="3" ry="5" fill="#4a443c" transform="rotate(24 25 -6)"/>
  </g>`;
}

function wheatStalk(x, y, s, rot) {
  const grains = [-16, -10, -4, 2]
    .map((gy, i) => `<ellipse cx="${i % 2 ? 4 : -4}" cy="${gy}" rx="3" ry="5" fill="#d9ae2e"/>
      <ellipse cx="${i % 2 ? -4 : 4}" cy="${gy + 3}" rx="3" ry="5" fill="#c99b1f"/>`)
    .join('');
  return `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})">
    <path d="M0,30 C1,10 0,-8 0,-20" stroke="#c99b1f" stroke-width="3" fill="none" stroke-linecap="round"/>
    <path d="M0,4 C6,-2 9,-8 10,-14" stroke="#c99b1f" stroke-width="2.5" fill="none" stroke-linecap="round"/>
    <path d="M0,10 C-6,4 -9,-2 -10,-8" stroke="#c99b1f" stroke-width="2.5" fill="none" stroke-linecap="round"/>
    <g transform="translate(0 -22)">${grains}</g>
  </g>`;
}

export function hexArt(t) {
  switch (t) {
    case 'forest': return `
      <ellipse cx="0" cy="40" rx="88" ry="26" fill="#237a41" opacity="0.5"/>
      ${tree(-54, -4, 0.72)}
      ${tree(54, 0, 0.78)}
      ${tree(-16, -20, 0.95)}
      ${tree(24, -18, 0.88)}
      ${tree(-36, 24, 1)}
      ${tree(38, 26, 1.05)}
      ${tree(2, 14, 1.2)}
      <ellipse cx="-58" cy="34" rx="11" ry="6" fill="#237a41"/>
      <ellipse cx="62" cy="38" rx="12" ry="6" fill="#237a41"/>`;
    case 'pasture': return `
      <ellipse cx="0" cy="42" rx="88" ry="24" fill="#6fae33" opacity="0.5"/>
      <g stroke="#5a9e2f" stroke-width="2.5" stroke-linecap="round" fill="none">
        <path d="M-62,26 q3,-8 6,-10"/><path d="M-58,28 q1,-9 4,-12"/>
        <path d="M58,32 q3,-8 6,-10"/><path d="M62,34 q1,-9 4,-12"/>
      </g>
      ${sheep(4, -12, 1.15)}
      ${sheep(-34, 30, 0.62)}`;
    case 'fields': return `
      <g stroke="#d9a927" stroke-width="3" opacity="0.5" fill="none">
        <path d="M-80,14 Q0,2 80,14"/>
        <path d="M-80,38 Q0,26 80,38"/>
      </g>
      ${wheatStalk(-38, -4, 0.85, -14)}
      ${wheatStalk(38, -4, 0.85, 14)}
      ${wheatStalk(0, -14, 1.15, 0)}`;
    case 'hills': return `
      <ellipse cx="0" cy="40" rx="86" ry="26" fill="#c25a2e" opacity="0.55"/>
      <g fill="#b3492a" stroke="#8f3620" stroke-width="1.5">
        <rect x="-46" y="-30" width="21" height="12" rx="1"/>
        <rect x="-23" y="-30" width="21" height="12" rx="1"/>
        <rect x="0" y="-30" width="21" height="12" rx="1"/>
        <rect x="23" y="-30" width="23" height="12" rx="1"/>
        <rect x="-57" y="-16" width="21" height="12" rx="1"/>
        <rect x="-34" y="-16" width="21" height="12" rx="1"/>
        <rect x="-11" y="-16" width="21" height="12" rx="1"/>
        <rect x="12" y="-16" width="21" height="12" rx="1"/>
        <rect x="35" y="-16" width="21" height="12" rx="1"/>
        <rect x="-46" y="-2" width="21" height="12" rx="1"/>
        <rect x="-23" y="-2" width="21" height="12" rx="1"/>
        <rect x="0" y="-2" width="21" height="12" rx="1"/>
        <rect x="23" y="-2" width="23" height="12" rx="1"/>
        <rect x="-34" y="12" width="21" height="12" rx="1"/>
        <rect x="-11" y="12" width="21" height="12" rx="1"/>
        <rect x="12" y="12" width="21" height="12" rx="1"/>
      </g>
      <g fill="#d4693f" opacity="0.7">
        <rect x="-46" y="-30" width="21" height="3"/>
        <rect x="-34" y="-16" width="21" height="3"/>
        <rect x="-46" y="-2" width="21" height="3"/>
        <rect x="-34" y="12" width="21" height="3"/>
      </g>`;
    case 'mountains': return `
      <ellipse cx="0" cy="40" rx="88" ry="26" fill="#8d99ae" opacity="0.5"/>
      <polygon points="-66,40 -24,-32 22,40" fill="#98a4b8" stroke="#5f6a78" stroke-width="2" stroke-linejoin="round"/>
      <polygon points="14,40 46,-14 80,40" fill="#8d99ae" stroke="#5f6a78" stroke-width="2" stroke-linejoin="round"/>
      <polygon points="40,-4 46,-14 52,-4 46,-8" fill="#f4f7fb"/>
      <polygon points="-30,40 2,-16 34,40" fill="#8d99ae" stroke="#5f6a78" stroke-width="2" stroke-linejoin="round"/>
      <polygon points="-6,-8 2,-16 10,-8 2,-12" fill="#f4f7fb"/>
      <ellipse cx="-34" cy="38" rx="12" ry="7" fill="#7d838c"/>
      <ellipse cx="46" cy="40" rx="14" ry="7" fill="#7d838c"/>`;
    case 'desert': return `
      <ellipse cx="0" cy="42" rx="88" ry="24" fill="#d9c88f" opacity="0.6"/>
      <path d="M-70,28 Q-30,14 10,26 T80,22" stroke="#d9c88f" stroke-width="3" fill="none" opacity="0.7"/>
      <g fill="#4c9e4a" stroke="#3d7d3a" stroke-width="2">
        <rect x="-9" y="-30" width="18" height="56" rx="9"/>
        <rect x="-26" y="-12" width="12" height="26" rx="6"/>
        <rect x="-26" y="6" width="22" height="9" rx="4.5"/>
        <rect x="14" y="-20" width="12" height="30" rx="6"/>
        <rect x="12" y="2" width="22" height="9" rx="4.5"/>
      </g>
      <g stroke="#3d7d3a" stroke-width="1.5" opacity="0.5">
        <line x1="-4" y1="-24" x2="-4" y2="22"/>
        <line x1="3" y1="-24" x2="3" y2="22"/>
      </g>
      <ellipse cx="-40" cy="44" rx="8" ry="4" fill="#c9b782"/>
      <ellipse cx="52" cy="46" rx="7" ry="3.5" fill="#c9b782"/>`;
    default: return '';
  }
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
  // el mapa niebla es más grande: viewBox a medida; el clásico queda fijo
  let VB = { x: -400, y: -360, w: 800, h: 720 };
  if (st.board.map === 'niebla') {
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (const h of st.board.hexes) {
      minX = Math.min(minX, h.x); maxX = Math.max(maxX, h.x);
      minY = Math.min(minY, h.y); maxY = Math.max(maxY, h.y);
    }
    const M = 120;
    VB = { x: minX - M, y: minY - M, w: maxX - minX + 2 * M, h: maxY - minY + 2 * M };
  }
  svg.setAttribute('viewBox', `${VB.x} ${VB.y} ${VB.w} ${VB.h}`);

  // defs: gradientes por terreno, arena y sombras
  const defs = el('defs', {}, svg);
  for (const [terrain, base] of Object.entries(TERRAIN_FILL)) {
    const lg = el('linearGradient', { id: `tg-${terrain}`, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    el('stop', { offset: '0%', 'stop-color': shade(base, 18) }, lg);
    el('stop', { offset: '55%', 'stop-color': base }, lg);
    el('stop', { offset: '100%', 'stop-color': shade(base, -12) }, lg);
  }
  const lagoonLg = el('linearGradient', { id: 'tg-lagoon', x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
  el('stop', { offset: '0%', 'stop-color': '#6cb2e2' }, lagoonLg);
  el('stop', { offset: '100%', 'stop-color': '#3f7cb8' }, lagoonLg);
  const fogLg = el('linearGradient', { id: 'tg-fog', x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
  el('stop', { offset: '0%', 'stop-color': '#b6c3d2' }, fogLg);
  el('stop', { offset: '100%', 'stop-color': '#8b9cb0' }, fogLg);
  const sandLg = el('linearGradient', { id: 'tg-sand', x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
  el('stop', { offset: '0%', 'stop-color': '#f6e8c3' }, sandLg);
  el('stop', { offset: '100%', 'stop-color': '#e6cf9e' }, sandLg);
  const fTok = el('filter', { id: 'f-tok', x: '-40%', y: '-40%', width: '180%', height: '180%' }, defs);
  el('feDropShadow', { dx: 0, dy: 2.5, stdDeviation: 1.8, 'flood-color': '#08243e', 'flood-opacity': 0.4 }, fTok);
  const fPiece = el('filter', { id: 'f-piece', x: '-40%', y: '-40%', width: '180%', height: '180%' }, defs);
  el('feDropShadow', { dx: 0, dy: 2, stdDeviation: 1.5, 'flood-color': '#08243e', 'flood-opacity': 0.45 }, fPiece);

  // sea
  el('rect', { x: VB.x, y: VB.y, width: VB.w, height: VB.h, fill: SEA }, svg);
  for (const [x, y, e] of DOODLES) {
    el('text', { x, y, 'font-size': 40, opacity: 0.08, 'text-anchor': 'middle' }, svg).textContent = e;
  }

  // island coast: shadow + shallow water + scalloped foam + sand platform
  const coastPts = st.board.coast
    .map((vid) => st.board.vertices[vid])
    .map((v) => `${v.x.toFixed(1)},${v.y.toFixed(1)}`)
    .join(' ');
  el('polygon', { points: coastPts, fill: 'rgba(8,30,55,0.30)', transform: 'translate(0 10)' }, svg);
  el('polygon', { points: coastPts, fill: 'none', stroke: '#5aa9dd', 'stroke-width': 100, 'stroke-linejoin': 'round', opacity: 0.6 }, svg);
  el('polygon', {
    points: coastPts, fill: 'none', stroke: '#e8f4fb', 'stroke-width': 64,
    'stroke-linejoin': 'round', 'stroke-dasharray': '22 14', 'stroke-linecap': 'round', opacity: 0.95,
  }, svg);
  el('polygon', { points: coastPts, fill: 'url(#tg-sand)', stroke: '#ffffff', 'stroke-width': 42, 'stroke-linejoin': 'round' }, svg);
  el('polygon', { points: coastPts, fill: 'none', stroke: '#e0c893', 'stroke-width': 3 }, svg);

  // hexes: gradiente + ilustración vectorial, recortados al hex
  const TW = Math.sqrt(3) * S, TH = 2 * S;
  const gShadow = el('g', { 'pointer-events': 'none' }, svg);
  for (const h of st.board.hexes) {
    el('polygon', { points: hexPoints(h), fill: 'rgba(8,30,55,0.22)', transform: 'translate(0 4.5)' }, gShadow);
  }
  const gHex = el('g', {}, svg);
  for (const h of st.board.hexes) {
    const hidden = !!h.fog && !(st.revealed || []).includes(h.id);
    const clipId = `hc-${h.id}`;
    const cp = el('clipPath', { id: clipId }, defs);
    el('polygon', { points: hexPoints(h) }, cp);
    const g = el('g', { 'clip-path': `url(#${clipId})` }, gHex);
    if (h.terrain === 'lagoon') {
      // laguna central: agua clara
      el('rect', {
        x: (h.x - TW / 2).toFixed(1), y: (h.y - TH / 2).toFixed(1), width: TW, height: TH,
        fill: 'url(#tg-lagoon)',
      }, g);
    } else if (hidden) {
      // niebla sin descubrir: nubes y signo de pregunta
      el('rect', {
        x: (h.x - TW / 2).toFixed(1), y: (h.y - TH / 2).toFixed(1), width: TW, height: TH,
        fill: 'url(#tg-fog)',
      }, g);
      el('g', { fill: '#e9eef4', opacity: 0.85 }, g).innerHTML = `
        <ellipse cx="${h.x - 18}" cy="${h.y - 12}" rx="22" ry="12"/>
        <ellipse cx="${h.x + 16}" cy="${h.y - 2}" rx="25" ry="13"/>
        <ellipse cx="${h.x - 6}" cy="${h.y + 14}" rx="21" ry="12"/>`;
      el('text', {
        x: h.x, y: h.y + 8, 'text-anchor': 'middle', 'font-size': 26,
        'font-weight': 800, fill: '#5a6b80', 'font-family': 'system-ui',
      }, g).textContent = '?';
    } else {
      el('image', {
        href: `tiles/${h.terrain}.png?v=3`,
        x: (h.x - TW / 2).toFixed(1), y: (h.y - TH / 2).toFixed(1),
        width: TW, height: TH,
        preserveAspectRatio: 'xMidYMid slice',
      }, g);
    }
    el('polygon', {
      points: hexPoints(h), fill: 'none',
      stroke: hidden ? '#77879b'
        : h.terrain === 'lagoon' ? '#bfe3f7'
        : shade(TERRAIN_FILL[h.terrain], -30),
      'stroke-width': 4, 'stroke-linejoin': 'round',
      'data-hid': h.id,
    }, gHex);
  }

  // velero decorativo en la laguna (mapa niebla)
  const lag = st.board.hexes.find((h) => h.terrain === 'lagoon');
  if (lag) {
    el('text', { x: lag.x, y: lag.y + 7, 'font-size': 20, 'text-anchor': 'middle', opacity: 0.9 }, svg).textContent = '⛵';
  }

  // flashing border on every hex matching the last roll (white on navy: visible on any terrain)
  if (Array.isArray(st.lastProduced) && st.lastProduced.length) {
    const gP = el('g', { 'pointer-events': 'none' }, svg);
    for (const hid of st.lastProduced) {
      const h = st.board.hexes[hid];
      el('polygon', {
        points: hexPoints(h), fill: '#0d2239', 'stroke-linejoin': 'round', class: 'prodflash',
      }, gP);
    }
  }

  // number tokens: carta centrada en el hex (oculta en niebla sin descubrir)
  const gNum = el('g', { 'pointer-events': 'none', filter: 'url(#f-tok)' }, svg);
  for (const h of st.board.hexes) {
    if (!h.number) continue;
    if (h.fog && !(st.revealed || []).includes(h.id)) continue;
    const red = h.number === 6 || h.number === 8;
    const g = el('g', { transform: `translate(${h.x} ${h.y})` }, gNum);
    el('rect', { x: -15, y: -18, width: 30, height: 36, rx: 8, fill: '#fdfcf7', stroke: '#c9bfa8', 'stroke-width': 1.5 }, g);
    el('text', {
      y: 4, 'text-anchor': 'middle', 'font-size': 13.5, 'font-weight': 800,
      fill: red ? '#c0392b' : '#33383d', 'font-family': 'system-ui',
    }, g).textContent = h.number;
    const pips = PIPS[h.number] || 0;
    for (let i = 0; i < pips; i++) {
      el('circle', { cx: (i - (pips - 1) / 2) * 3, cy: 10, r: 1.2, fill: '#c0392b' }, g);
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

  // robber token: centrado, en el tercio superior (encima de la ficha de número)
  const rHex = st.board.hexes.find((h) => h.id === st.robber);
  const gRob = el('g', { transform: `translate(${rHex.x} ${rHex.y - 32})`, 'pointer-events': 'none', filter: 'url(#f-piece)' }, svg);
  el('circle', { r: 13, fill: '#5a5f66', stroke: '#fff', 'stroke-width': 2.5 }, gRob);
  el('text', { y: 4.5, 'text-anchor': 'middle', 'font-size': 14 }, gRob).textContent = '🦹';

  // ports: muelle en V — desde el ápice en el mar hacia CADA uno de los dos
  // vértices de acceso; cartel sobre el ápice y velero más afuera.
  // Los puertos chicos (laguna del mapa niebla) usan cartel compacto y sin velero.
  const gPort = el('g', { 'pointer-events': 'none' }, svg);
  for (const p of st.board.ports) {
    const [va, vb] = p.vids.map((vid) => st.board.vertices[vid]);
    const W = p.small ? 5 : 8;
    const leg = (v) => {
      el('line', { x1: v.x, y1: v.y, x2: p.px, y2: p.py, stroke: '#a4713d', 'stroke-width': W, 'stroke-linecap': 'round' }, gPort);
      el('line', { x1: v.x, y1: v.y, x2: p.px, y2: p.py, stroke: '#8a5a2b', 'stroke-width': W, 'stroke-linecap': 'round', 'stroke-dasharray': p.small ? '2 7' : '3 10' }, gPort);
    };
    leg(va);
    leg(vb);
    if (p.small) {
      const g = el('g', { transform: `translate(${p.sx.toFixed(1)} ${p.sy.toFixed(1)})` }, gPort);
      el('rect', { x: -18, y: -9, width: 36, height: 18, rx: 5, fill: '#fdfcf7', stroke: '#c9b48a', 'stroke-width': 1.2 }, g);
      el('text', {
        y: 1, 'text-anchor': 'middle', 'dominant-baseline': 'middle', 'font-size': 9.5,
        'font-weight': 800, fill: '#3d3325', 'font-family': 'system-ui',
      }, g).textContent = `2:1 ${portEmoji(p.type)}`;
      continue;
    }
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
    if (!t) return onPick('sea', -1); // click fuera de todo: sirve para cancelar
    if (t.dataset.vid != null) onPick('vertex', Number(t.dataset.vid));
    else if (t.dataset.eid != null) onPick('edge', Number(t.dataset.eid));
    else if (t.dataset.hid != null) onPick('hex', Number(t.dataset.hid));
  };
}

function portEmoji(type) {
  return { wood: '🌲', brick: '🧱', sheep: '🐑', wheat: '🌾', ore: '⛰️', gold: '🪙' }[type] || '';
}
