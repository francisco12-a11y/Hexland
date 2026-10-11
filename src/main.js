// Hexland — UI orchestration: lobby, turn flow, modals. Pure rules live in game.js.

import { renderBoard } from './render.js';
import * as G from './game.js';

let game = null;
let mode = null; // {kind:'settlement'|'city'|'road'|'robber', setup:bool}

const $ = (s) => document.querySelector(s);
const svg = () => $('#board');

const PHASE_LABEL = {
  setup: 'Colocación inicial',
  roll: 'Tirá los dados',
  main: 'Construí o comerciá',
  discard: 'Descarte',
  robber: 'Mové al ladrón',
  over: 'Partida terminada',
};

/* ---------------- lobby ---------------- */

let playerCount = 4;
let colorPick = [0, 1, 2, 3]; // per player: index into PLAYER_COLORS

const houseHTML = (color, size = 26) =>
  `<svg viewBox="-14 -14 28 28" width="${size}" height="${size}" style="vertical-align:middle;overflow:visible"><path d="M-9 4 L-9 -4 L0 -12 L9 -4 L9 4 Z" fill="${color}" stroke="#17324f" stroke-width="1.8" stroke-linejoin="round"/></svg>`;

function buildLobby() {
  const seg = $('#countseg');
  seg.querySelectorAll('button').forEach((b) => {
    b.classList.toggle('on', Number(b.dataset.n) === playerCount);
    b.onclick = () => { playerCount = Number(b.dataset.n); buildLobby(); };
  });
  const names = $('#names');
  const prev = [...names.querySelectorAll('input')].map((i) => i.value);
  names.innerHTML = '';
  for (let i = 0; i < playerCount; i++) {
    const row = document.createElement('div');
    row.className = 'row';
    const color = G.PLAYER_COLORS[colorPick[i]];
    const icon = document.createElement('span');
    icon.className = 'hicon';
    icon.innerHTML = houseHTML(color);
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 14;
    input.placeholder = `Nombre del jugador ${i + 1}`;
    input.value = prev[i] || '';
    const pal = document.createElement('span');
    pal.className = 'pal';
    pal.innerHTML = G.PLAYER_COLORS.map((c, ci) =>
      `<button data-ci="${ci}" class="${ci === colorPick[i] ? 'on' : ''}" title="Elegir este color">${houseHTML(c, 20)}</button>`
    ).join('');
    pal.querySelectorAll('button').forEach((btn) => {
      btn.onclick = () => {
        const ci = Number(btn.dataset.ci);
        const other = colorPick.indexOf(ci);
        if (other !== -1 && other !== i) colorPick[other] = colorPick[i]; // swap
        colorPick[i] = ci;
        buildLobby();
      };
    });
    row.append(icon, input, pal);
    names.appendChild(row);
  }
}

function startGame() {
  const names = [...$('#names').querySelectorAll('input')].map((i) => i.value.trim());
  const seedRaw = $('#seed').value.trim();
  const seed = seedRaw ? Math.abs(parseInt(seedRaw, 10)) || 1 : undefined;
  game = G.newGame(names, seed, colorPick.slice());
  mode = { kind: 'settlement', setup: true };
  $('#lobby').hidden = true;
  $('#game').hidden = false;
  renderAll();
}

/* ---------------- rendering ---------------- */

function cur() { return game.players[game.current]; }

function targetsForMode() {
  const t = { vertices: new Set(), edges: new Set(), hexes: new Set() };
  if (!game || game.phase === 'over') return t;
  if (game.phase === 'setup') {
    if (mode?.kind === 'settlement') G.settlementSpots(game, game.current, true).forEach((v) => t.vertices.add(v));
    if (mode?.kind === 'road') G.setupRoadSpots(game, game.current).forEach((e) => t.edges.add(e));
  } else if (game.phase === 'main' && mode) {
    if (mode.kind === 'settlement') G.settlementSpots(game, game.current, false).forEach((v) => t.vertices.add(v));
    if (mode.kind === 'city') G.citySpots(game, game.current).forEach((v) => t.vertices.add(v));
    if (mode.kind === 'road') G.roadSpots(game, game.current).forEach((e) => t.edges.add(e));
  } else if (game.phase === 'robber') {
    G.robberSpots(game).forEach((h) => t.hexes.add(h));
  }
  return t;
}

function renderAll() {
  if (!game) return;
  renderBoard(svg(), game, targetsForMode(), onPick);
  renderSide();
  updateDice();
  $('#turninfo').textContent = `Semilla ${game.seed} · Turno ${game.turn}`;
}

const DICE_PIPS = {
  1: [[16, 16]],
  2: [[10, 10], [22, 22]],
  3: [[10, 10], [16, 16], [22, 22]],
  4: [[10, 10], [22, 10], [10, 22], [22, 22]],
  5: [[10, 10], [22, 10], [16, 16], [10, 22], [22, 22]],
  6: [[10, 8], [22, 8], [10, 16], [22, 16], [10, 24], [22, 24]],
};

function diceSVG(v) {
  const pips = DICE_PIPS[v].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3.1" fill="#2b2f36"/>`).join('');
  return `<svg width="42" height="42" viewBox="0 0 32 32"><rect x="1" y="1" width="30" height="30" rx="8" fill="#fdfcf7" stroke="#c9c2b0" stroke-width="1.5"/>${pips}</svg>`;
}

let lastDiceKey = null;
function updateDice() {
  const box = $('#diceres');
  if (!game || !game.dice || game.phase === 'setup') { box.hidden = true; return; }
  const [a, b] = game.dice;
  box.hidden = false;
  box.classList.toggle('seven', a + b === 7);
  box.innerHTML = `<span class="die">${diceSVG(a)}</span><span class="die">${diceSVG(b)}</span>
    <span class="sum">= ${a + b}</span>${a + b === 7 ? '<span class="lbl7">¡mueven al ladrón!</span>' : ''}`;
  const key = `${a}-${b}-${game.turn}-${game.current}`;
  if (key !== lastDiceKey) {
    lastDiceKey = key;
    box.classList.remove('pop');
    void box.offsetWidth; // restart the pop animation
    box.classList.add('pop');
  }
}

const RES_NAMES = { wood: 'madera', brick: 'ladrillo', sheep: 'oveja', wheat: 'trigo', ore: 'mineral' };
const resName = (r) => RES_NAMES[r];
const totalCards = (p) => G.RESOURCES.reduce((s, r) => s + p.res[r], 0);

function renderSide() {
  // player rows, Colonist-style
  $('#players').innerHTML = `<h3>Jugadores · ${PHASE_LABEL[game.phase]}</h3>` +
    game.players.map((q) => `
      <div class="prow ${q.id === game.current ? 'me' : ''}">
        <span class="hicon">${houseHTML(q.color, 22)}</span>
        <span class="pnm">${q.name}</span>
        <span class="pinfo">🃏 ${totalCards(q)}</span>
        <span class="pvp">${G.vp(q)}</span>
      </div>`).join('');

  // bank stock
  $('#bankrow').innerHTML = `<h3>Banco</h3><div class="bankrow">${G.RESOURCES.map((r) => {
    const left = 19 - game.players.reduce((s, q) => s + q.res[r], 0);
    return `<span class="rescard ${r}" title="${resName(r)}">${G.RES_EMOJI[r]}<small>${left}</small></span>`;
  }).join('')}</div>`;

  // current player's hand as resource cards (hide zero counts)
  const p = cur();
  const held = G.RESOURCES.filter((r) => p.res[r] > 0);
  $('#hand').innerHTML = `<h3>Mano de ${p.name}</h3>` + (held.length
    ? `<div class="bankrow">${held.map((r) =>
        `<span class="rescard big ${r}" title="${resName(r)}">${G.RES_EMOJI[r]}<small>×${p.res[r]}</small></span>`
      ).join('')}</div>`
    : `<p class="empty">Sin cartas 🃏</p>`);

  renderActions();
  renderPrompt();

  const ul = $('#log');
  ul.innerHTML = '';
  [...game.log].reverse().slice(0, 40).forEach((m) => {
    const li = document.createElement('li');
    li.textContent = m;
    ul.appendChild(li);
  });
}

function renderActions() {
  const box = $('#actions');
  const p = cur();
  if (game.phase === 'setup') {
    box.innerHTML = `<h3>Acciones</h3><p class="sub" style="color:var(--muted);margin:0;font-size:13px">Colocación inicial: primero el asentamiento, después el camino. Sin costos.</p>`;
    return;
  }
  if (game.phase === 'robber') {
    box.innerHTML = `<h3>Acciones</h3><p class="sub" style="color:var(--muted);margin:0;font-size:13px">Hacé clic en un hexágono para mover al ladrón.</p>`;
    return;
  }
  if (game.phase === 'discard' || game.phase === 'over') {
    box.innerHTML = '';
    return;
  }
  if (game.phase === 'roll') {
    box.innerHTML = `<h3>Acciones</h3>
      <div class="grid"><button class="btn primary wide" id="b-roll">🎲 Tirar los dados</button></div>`;
    $('#b-roll').onclick = doRoll;
    return;
  }
  // main phase
  const afford = (cost) => G.RESOURCES.every((r) => p.res[r] >= (cost[r] || 0));
  const left = { road: 15 - p.roads.length, settlement: 5 - p.settlements.length, city: 4 - p.cities.length };
  const has = (k) => {
    if (k === 'road') return G.roadSpots(game, game.current).length > 0 && left.road > 0;
    if (k === 'settlement') return G.settlementSpots(game, game.current, false).length > 0 && left.settlement > 0;
    if (k === 'city') return G.citySpots(game, game.current).length > 0 && left.city > 0;
    return false;
  };
  const b = (kind, label, cost) => {
    const dis = !afford(cost) || !has(kind);
    return `<button class="btn ${mode?.kind === kind ? 'on' : ''}" data-k="${kind}" ${dis ? 'disabled' : ''}>
      ${label}<span class="cnt">×${left[kind]}</span><span class="cost">${cost}</span></button>`;
  };
  box.innerHTML = `<h3>Acciones</h3>
    <div class="grid">
      ${b('road', '🛣️ Camino', '1🧱 1🌲')}
      ${b('settlement', '🏠 Asentamiento', '1🧱 1🌲 1🐑 1🌾')}
      ${b('city', '🏛️ Ciudad', '3⛰️ 2🌾')}
      <button class="btn" id="b-trade">🔁 Comerciar<span class="cost">con el banco</span></button>
      <button class="btn primary wide" id="b-end">✔ Terminar turno</button>
    </div>`;
  box.querySelectorAll('button[data-k]').forEach((btn) => {
    btn.onclick = () => {
      const k = btn.dataset.k;
      mode = mode?.kind === k ? null : { kind: k, setup: false };
      renderAll();
    };
  });
  $('#b-trade').onclick = showTradeModal;
  $('#b-end').onclick = () => {
    const r = G.endTurn(game);
    if (!r.ok) return flash(r.err);
    mode = null;
    showHandoff(game.players[r.next]);
  };
}

function renderPrompt() {
  const pr = $('#prompt');
  const p = cur();
  let msg = '';
  if (game.phase === 'setup') {
    msg = mode?.kind === 'road'
      ? `🛣️ ${p.name}: elegí el camino junto a tu asentamiento`
      : `🏠 ${p.name}: elegí dónde fundar tu asentamiento`;
  } else if (game.phase === 'roll') msg = `🎲 ${p.name}: tirá los dados`;
  else if (game.phase === 'main') {
    msg = mode ? `👉 ${p.name}: ${modeHint(mode)}` : `🔨 ${p.name}: construí, comerciá o terminá tu turno`;
  } else if (game.phase === 'robber') msg = `🦹 ${p.name}: mové al ladrón`;
  else if (game.phase === 'discard') msg = `🃏 Esperando descartes…`;
  pr.textContent = msg;
}

const MODE_HINT = { settlement: 'elegí un lugar libre', city: 'elegí uno de tus asentamientos', road: 'elegí un borde libre' };
const modeHint = (m) => (m.kind === 'robber' ? 'tocá un hexágono' : MODE_HINT[m.kind]);

let flashTimer = null;
function flash(msg) {
  const pr = $('#prompt');
  const prev = pr.textContent;
  pr.textContent = `⚠️ ${msg}`;
  pr.style.color = '#ffd166';
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { pr.style.color = ''; renderPrompt(); }, 1800);
}

/* ---------------- board clicks ---------------- */

function onPick(kind, id) {
  if (!game) return;
  const wasSetupRoad = game.phase === 'setup' && kind === 'edge' && mode?.kind === 'road';
  const r = pick(game, kind, id);
  if (!r.ok) { if (!r.silent) flash(r.err); return; }
  if (game.phase === 'over') { mode = null; renderAll(); showWin(); return; }
  if (game.phase === 'setup') {
    mode = kind === 'vertex' ? { kind: 'road', setup: true } : { kind: 'settlement', setup: true };
    renderAll();
    return;
  }
  mode = null;
  renderAll();
  if (wasSetupRoad) { showHandoff(game.players[game.current]); return; } // setup just finished
  if (r.victims && r.victims.length) showStealModal(r.victims);
}

function pick(g, kind, id) {
  if (g.phase === 'setup') {
    if (kind === 'vertex' && mode?.kind === 'settlement') return G.placeSetupSettlement(g, id);
    if (kind === 'edge' && mode?.kind === 'road') return G.placeSetupRoad(g, id);
    return { ok: false, err: 'Seguí las instrucciones de arriba', silent: !mode };
  }
  if (g.phase === 'robber' && kind === 'hex') {
    const r = G.moveRobber(g, id);
    if (r.ok) mode = null;
    return r;
  }
  if (g.phase === 'main' && mode) {
    if (kind === 'vertex' && mode.kind === 'settlement') return G.buildSettlement(g, id);
    if (kind === 'vertex' && mode.kind === 'city') return G.buildCity(g, id);
    if (kind === 'edge' && mode.kind === 'road') return G.buildRoad(g, id);
  }
  return { ok: false, err: 'Elegí un destino válido', silent: !mode };
}

/* ---------------- dice ---------------- */

function doRoll() {
  const r = G.rollDice(game);
  if (!r.ok) return flash(r.err);
  // quick dice animation, then settle into the new phase
  let n = 0;
  const iv = setInterval(() => {
    $('#turninfo').textContent = `🎲 ${1 + Math.floor(Math.random() * 6)} + ${1 + Math.floor(Math.random() * 6)}`;
    if (++n >= 7) {
      clearInterval(iv);
      renderAll();
      if (game.phase === 'discard') discardChain();
    }
  }, 70);
  renderSide();
}

/* ---------------- modals ---------------- */

function showModal(html) {
  const ov = $('#overlay');
  ov.hidden = false;
  ov.innerHTML = `<div class="modal">${html}</div>`;
  return ov.firstElementChild;
}
function hideModal() {
  const ov = $('#overlay');
  ov.hidden = true;
  ov.innerHTML = '';
}

function showHandoff(player) {
  const m = showModal(`
    <h2>🎮 Le toca a <span style="color:${player.color}">${houseHTML(player.color, 26)} ${player.name}</span></h2>
    <p class="sub">Pasale la pantalla cuando esté listo.</p>
    <div class="btnrow"><button class="btn primary big" id="m-ready">Estoy listo 👌</button></div>`);
  m.querySelector('#m-ready').onclick = () => { hideModal(); renderAll(); };
}

function showWin() {
  const p = game.players[game.winner];
  showModal(`
    <div class="wintrophy">🏆</div>
    <h2>¡Ganó <span style="color:${p.color}">${p.name}</span>!</h2>
    <p class="sub">${G.vp(p)} puntos de victoria en ${game.turn} turnos.</p>
    <div class="btnrow"><button class="btn primary big" id="m-again">Jugar de nuevo</button></div>`)
    .querySelector('#m-again').onclick = () => location.reload();
}

function discardChain() {
  const pid = game.pendingDiscards[0];
  if (pid == null) { renderAll(); return; }
  const p = game.players[pid];
  const need = G.requiredDiscard(p);
  const sel = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
  const m = showModal(`
    <h2>🃏 Descarte</h2>
    <p class="sub"><b>${p.name}</b> tiene ${G.RESOURCES.reduce((s, r) => s + p.res[r], 0)} cartas y debe descartar <b>${need}</b>.</p>
    <div id="steps"></div>
    <div class="btnrow"><button class="btn primary" id="m-conf" disabled>Descartar</button></div>`);
  const steps = m.querySelector('#steps');
  const redraw = () => {
    steps.innerHTML = '';
    const total = G.RESOURCES.reduce((s, r) => s + sel[r], 0);
    for (const r of G.RESOURCES) {
      const row = document.createElement('div');
      row.className = 'stepper';
      row.innerHTML = `<span>${G.RES_EMOJI[r]} ${resName(r)} <small style="color:var(--muted)">(tenés ${p.res[r]})</small></span>
        <span><button data-r="${r}" data-d="-1" ${sel[r] === 0 ? 'disabled' : ''}>−</button>
        <span class="cnt">${sel[r]}</span>
        <button data-r="${r}" data-d="1" ${sel[r] >= p.res[r] || total >= need ? 'disabled' : ''}>+</button></span>`;
      steps.appendChild(row);
    }
    steps.querySelectorAll('button').forEach((b) => {
      b.onclick = () => {
        sel[b.dataset.r] += Number(b.dataset.d);
        m.querySelector('#m-conf').disabled = G.RESOURCES.reduce((s, r) => s + sel[r], 0) !== need;
        redraw();
      };
    });
  };
  redraw();
  m.querySelector('#m-conf').onclick = () => {
    const r = G.discard(game, pid, { ...sel });
    if (!r.ok) return;
    hideModal();
    if (game.pendingDiscards.length) discardChain();
    else renderAll(); // phase is now 'robber'
  };
}

function showStealModal(victims) {
  const m = showModal(`
    <h2>🤏 Robo</h2>
    <p class="sub">¿A quién le robás una carta (al azar)?</p>
    <div class="pickgrid" id="vics"></div>`);
  const grid = m.querySelector('#vics');
  for (const pid of victims) {
    const p = game.players[pid];
    const total = G.RESOURCES.reduce((s, r) => s + p.res[r], 0);
    const b = document.createElement('button');
    b.className = 'pick';
    b.innerHTML = `${houseHTML(p.color, 20)} ${p.name} (${total})`;
    b.onclick = () => {
      const r = G.stealFrom(game, pid);
      hideModal();
      renderAll();
      if (r.ok) flash(`Robaste ${G.RES_EMOJI[r.card]}`);
    };
    grid.appendChild(b);
  }
}

function showTradeModal() {
  const p = cur();
  let give = null, get = null;
  const m = showModal(`
    <h2>🔁 Comercio con el banco</h2>
    <p class="sub">Elegí qué dar y qué recibir. Los puertos bajan la tasa.</p>
    <h3 style="margin:14px 0 6px;color:var(--muted);font-size:12px;text-transform:uppercase">Dar</h3>
    <div class="pickgrid" id="ggrid"></div>
    <h3 style="margin:14px 0 6px;color:var(--muted);font-size:12px;text-transform:uppercase">Recibir</h3>
    <div class="pickgrid" id="rgrid"></div>
    <p id="terr" style="color:#ffd166;min-height:18px;margin:8px 0 0;font-size:13px"></p>
    <div class="btnrow">
      <button class="btn" id="m-cancel">Cerrar</button>
      <button class="btn primary" id="m-ok" disabled>Intercambiar</button>
    </div>`);
  const ggrid = m.querySelector('#ggrid'), rgrid = m.querySelector('#rgrid');
  const redraw = () => {
    ggrid.innerHTML = ''; rgrid.innerHTML = '';
    for (const r of G.RESOURCES) {
      const rate = G.tradeRate(game, p.id, r);
      const b = document.createElement('button');
      b.className = 'pick' + (give === r ? ' on' : '');
      b.innerHTML = `${G.RES_EMOJI[r]} ×${rate}<small style="display:block;font-size:11px;color:var(--muted)">tenés ${p.res[r]}</small>`;
      b.disabled = p.res[r] < rate;
      b.onclick = () => { give = r; redraw(); };
      ggrid.appendChild(b);
    }
    for (const r of G.RESOURCES) {
      const b = document.createElement('button');
      b.className = 'pick' + (get === r ? ' on' : '');
      b.textContent = G.RES_EMOJI[r];
      b.onclick = () => { get = r; redraw(); };
      rgrid.appendChild(b);
    }
    m.querySelector('#m-ok').disabled = !(give && get);
  };
  redraw();
  m.querySelector('#m-cancel').onclick = hideModal;
  m.querySelector('#m-ok').onclick = () => {
    const r = G.bankTrade(game, give, get);
    if (!r.ok) { m.querySelector('#terr').textContent = r.err; return; }
    hideModal();
    renderAll();
  };
}

/* ---------------- boot ---------------- */

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && mode) { mode = null; renderAll(); }
});

buildLobby();
$('#play').onclick = startGame;

// debug / test hook
window.__hexland = {
  get game() { return game; },
  G,
  refresh: () => renderAll(),
  setMode: (m) => { mode = m; renderAll(); },
  get mode() { return mode; },
};
