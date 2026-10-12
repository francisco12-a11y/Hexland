// Hexland — UI orchestration: lobby, turn flow, modals.
// Two modes share this file: pass & play (state is local and actions run
// directly in game.js) and online rooms (host-authoritative: the host runs
// game.js, clients send action envelopes and mirror the broadcast state).

import { renderBoard } from './render.js';
import * as G from './game.js';
import * as Net from './net.js';

let game = null;
let mode = null; // {kind:'settlement'|'city'|'road'|'robber', setup:bool}

const session = {
  online: false,
  isHost: false,
  myId: 0,
  code: null,
  lobby: [],          // host side: [{pid, name, peerId}]
  hostApi: null,
  clientApi: null,
  started: false,     // online: game already created
};
let lobbyTab = 'local';
let mapPick = 'clasico';
const pendingActs = new Map(); // rid → resolve (client waiting host result)
let ridSeq = 1;

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
let colorPick = [0, 1, 2, 3];

const houseHTML = (color, size = 26) =>
  `<svg viewBox="-14 -14 28 28" width="${size}" height="${size}" style="vertical-align:middle;overflow:visible"><path d="M-9 4 L-9 -4 L0 -12 L9 -4 L9 4 Z" fill="${color}" stroke="#17324f" stroke-width="1.8" stroke-linejoin="round"/></svg>`;

function buildLobby() {
  $('#modetabs').querySelectorAll('button').forEach((b) => {
    b.classList.toggle('on', b.dataset.m === lobbyTab);
    b.onclick = () => { lobbyTab = b.dataset.m; buildLobby(); };
  });
  $('#localbox').hidden = lobbyTab !== 'local';
  $('#onlinebox').hidden = lobbyTab !== 'online';
  // selector de mapa: visible en ambas pestañas (en online lo usa el host)
  document.querySelectorAll('#mapseg button').forEach((b) => {
    b.classList.toggle('on', b.dataset.map === mapPick);
    b.onclick = () => { mapPick = b.dataset.map; buildLobby(); };
  });
  if (lobbyTab === 'online') return; // el panel online es HTML estático

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
  game = G.newGame(names, seed, colorPick.slice(), mapPick);
  mode = { kind: 'settlement', setup: true };
  shownDice = null;
  lastDiceKey = null;
  enterGameScreen();
}

function enterGameScreen() {
  $('#lobby').hidden = true;
  $('#game').hidden = false;
  renderAll();
}

/* ---------------- online session ---------------- */

const onlineErr = (msg) => { $('#online-err').textContent = msg || ''; };

function myName() {
  return ($('#my-name').value || '').trim() || (session.isHost ? 'Host' : 'Jugador');
}

function renderRoom() {
  $('#room-code').textContent = session.code || '····';
  const ul = $('#room-players');
  ul.innerHTML = '';
  session.lobby.forEach((l, i) => {
    const li = document.createElement('li');
    li.innerHTML = `${houseHTML(G.PLAYER_COLORS[i], 20)} ${l.name}${i === 0 ? ' <small style="color:var(--muted)">(host)</small>' : ''}`;
    ul.appendChild(li);
  });
  const start = $('#start-online');
  start.hidden = !session.isHost;
  start.disabled = session.lobby.length < 2;
  $('#room-note').textContent = session.isHost
    ? (session.lobby.length < 2 ? 'Esperando que se sume alguien (mínimo 2)…' : 'Listo para arrancar.')
    : 'Esperando que el host arranque la partida…';
}

function broadcastLobby() {
  session.hostApi?.broadcast({ t: 'lobby', players: session.lobby.map((l) => ({ pid: l.pid, name: l.name })) });
  renderRoom();
}

function createRoom() {
  if (!Net.peerAvailable()) return onlineErr('PeerJS no cargó (¿sin internet?)');
  onlineErr('');
  session.online = true;
  session.isHost = true;
  session.code = Net.randomCode();
  session.lobby = [{ pid: 0, name: myName(), peerId: 'host' }];
  session.hostApi = Net.hostRoom(session.code, {
    onOpen: () => {
      $('#online-home').hidden = true;
      $('#room-panel').hidden = false;
      broadcastLobby();
    },
    onJoin: (peerId) => {
      // el pid real se asigna cuando manda {t:'join'}
      if (!session.hostApi) return;
      session.hostApi.sendTo(peerId, { t: 'lobby', players: session.lobby.map((l) => ({ pid: l.pid, name: l.name })) });
    },
    onLeave: (peerId) => {
      const l = session.lobby.find((x) => x.peerId === peerId);
      if (l && game && game.phase !== 'over') log(game, `🔌 ${l.name} se desconectó.`);
      broadcastLobby();
      renderAll();
    },
    onMessage: hostMessage,
    onError: (e) => onlineErr(`Error de sala: ${e.type || e}`),
  });
}

function joinRoomByCode() {
  if (!Net.peerAvailable()) return onlineErr('PeerJS no cargó (¿sin internet?)');
  const code = ($('#join-code').value || '').trim().toUpperCase();
  if (code.length < 3) return onlineErr('Poné el código de la sala');
  onlineErr('');
  session.online = true;
  session.isHost = false;
  session.code = code;
  session.clientApi = Net.joinRoom(code, {
    onOpen: (api) => api.send({ t: 'join', name: myName() }),
    onMessage: clientMessage,
    onClose: () => {
      showModal(`
        <h2>🔌 Conexión perdida</h2>
        <p class="sub">Se cortó la conexión con el host.</p>
        <div class="btnrow"><button class="btn primary big" id="m-reload">Volver a empezar</button></div>`)
        .querySelector('#m-reload').onclick = () => location.reload();
    },
    onError: (e) => {
      if (e.type === 'peer-unavailable') onlineErr('No existe esa sala (¿código bien escrito?)');
      else onlineErr(`Error: ${e.type || e}`);
    },
  });
}

function clientMessage(msg) {
  if (msg.t === 'welcome') {
    session.myId = msg.pid;
    $('#online-home').hidden = true;
    $('#room-panel').hidden = false;
    renderRoom();
  } else if (msg.t === 'lobby') {
    session.lobby = msg.players;
    renderRoom();
  } else if (msg.t === 'state') {
    applyRemoteState(msg.state);
  } else if (msg.t === 'result') {
    pendingActs.get(msg.rid)?.({ ok: msg.ok, err: msg.err });
    pendingActs.delete(msg.rid);
  } else if (msg.t === 'err') {
    flash(msg.msg);
  }
}

function sendAct(kind, args = []) {
  return new Promise((res) => {
    const rid = ridSeq++;
    pendingActs.set(rid, res);
    session.clientApi.send({ t: 'act', rid, kind, args });
    setTimeout(() => {
      if (pendingActs.has(rid)) {
        pendingActs.delete(rid);
        res({ ok: false, err: 'El host no respondió' });
      }
    }, 8000);
  });
}

// ruta única de acciones en online: el host aplica en su engine (autoridad),
// los clientes mandan el sobre y resuelven con el {ok,err} del host
function act(kind, args = []) {
  if (session.isHost) {
    const r = hostApply(kind, args, session.myId);
    afterHostApply();
    return Promise.resolve(r);
  }
  return sendAct(kind, args);
}

const HOST_ACTIONS = {
  placeSetupSettlement: (st, a) => G.placeSetupSettlement(st, a[0]),
  placeSetupRoad: (st, a) => G.placeSetupRoad(st, a[0]),
  roll: (st) => G.rollDice(st),
  buildRoad: (st, a) => G.buildRoad(st, a[0]),
  buildSettlement: (st, a) => G.buildSettlement(st, a[0]),
  buildCity: (st, a) => G.buildCity(st, a[0]),
  bankTrade: (st, a) => G.bankTrade(st, a[0], a[1]),
  moveRobber: (st, a) => G.moveRobber(st, a[0]),
  stealFrom: (st, a) => G.stealFrom(st, a[0]),
  discard: (st, a) => G.discard(st, a[0], a[1]),
  buyDev: (st) => G.buyDev(st),
  playKnight: (st, a) => G.playKnight(st, a[0]),
  playRoadBuilding: (st, a) => G.playRoadBuilding(st, a[0]),
  playYearOfPlenty: (st, a) => G.playYearOfPlenty(st, a[0], a[1], a[2]),
  playMonopoly: (st, a) => G.playMonopoly(st, a[0], a[1]),
  endTurn: (st) => G.endTurn(st),
};

function hostApply(kind, args, byPid) {
  if (!game) return { ok: false, err: 'La partida no arrancó' };
  const fn = HOST_ACTIONS[kind];
  if (!fn) return { ok: false, err: 'Acción desconocida' };
  const owner = kind === 'discard'
    ? game.pendingDiscards[0]
    : game.phase === 'setup'
      ? game.setupQueue[game.setupIdx]
      : game.current;
  if (owner !== byPid) return { ok: false, err: 'No es tu turno' };
  return fn(game, args);
}

function broadcastState() {
  if (!session.isHost || !game) return;
  try {
    // JSON limpia la función rng (los clientes nunca la usan; el host es la autoridad)
    const plain = JSON.parse(JSON.stringify(game));
    session.hostApi?.broadcast({ t: 'state', state: plain });
  } catch (e) {
    console.error('broadcast falló', e);
  }
}

function applyRemoteState(state) {
  const phaseChanged = !game || game.phase !== state.phase;
  game = state;
  if (phaseChanged) mode = null; // conservar la selección si la fase sigue igual
  if ($('#lobby') && !$('#lobby').hidden) enterGameScreen();
  renderAll();
  onlineUiFromState();
}

// derivaciones de UI que antes eran resultado directo de la acción local
function onlineUiFromState() {
  if (!game || !session.online) return;
  const modalOpen = !!$('#overlay .modal');
  if (game.phase === 'discard' && game.pendingDiscards[0] === session.myId && !modalOpen) discardChain();
  if (game.stealCandidates?.length && game.current === session.myId && !modalOpen) showStealModal(game.stealCandidates);
  if (game.phase === 'over' && !modalOpen) showWin();
}

function hostMessage(peerId, msg) {
  if (msg.t === 'join') {
    if (game) return session.hostApi.sendTo(peerId, { t: 'err', msg: 'La partida ya arrancó' });
    if (session.lobby.length >= 4) return session.hostApi.sendTo(peerId, { t: 'err', msg: 'La sala está llena' });
    session.lobby.push({ pid: session.lobby.length, name: (msg.name || 'Jugador').slice(0, 14), peerId });
    session.hostApi.sendTo(peerId, { t: 'welcome', pid: session.lobby.length - 1 });
    broadcastLobby();
  } else if (msg.t === 'act') {
    const pid = session.lobby.find((l) => l.peerId === peerId)?.pid;
    if (pid == null) return;
    const r = hostApply(msg.kind, msg.args || [], pid);
    session.hostApi.sendTo(peerId, { t: 'result', rid: msg.rid, ok: r.ok, err: r.err || null });
    afterHostApply();
  }
}

function afterHostApply() {
  broadcastState();
  renderAll();
  onlineUiFromState();
}

function startOnlineGame() {
  const names = session.lobby.map((l) => l.name);
  const seed = Math.floor(Math.random() * 2 ** 31);
  game = G.newGame(names, seed, null, mapPick);
  session.myId = 0;
  session.started = true;
  mode = { kind: 'settlement', setup: true };
  shownDice = null;
  lastDiceKey = null;
  broadcastState();
  enterGameScreen();
}

/* ---------------- rendering ---------------- */

const mePlayer = () => (session.online ? game.players[session.myId] : cur());

function cur() { return game.players[game.current]; }

function targetsForMode() {
  const t = { vertices: new Set(), edges: new Set(), hexes: new Set() };
  if (!game || game.phase === 'over') return t;
  const myTurnSetup = !session.online || game.setupQueue[game.setupIdx] === session.myId;
  if (game.phase === 'setup') {
    if (!myTurnSetup) return t;
    // en online el paso lo dicta el estado (¿ya colocó el asentamiento?), no el mode local
    const roadStep = session.online ? game.lastSetupVertex != null : mode?.kind === 'road';
    if (!roadStep) G.settlementSpots(game, game.current, true).forEach((v) => t.vertices.add(v));
    else G.setupRoadSpots(game, game.current).forEach((e) => t.edges.add(e));
  } else if (game.phase === 'main') {
    if (session.online && game.current !== session.myId) return t;
    if (mode?.kind === 'settlement') G.settlementSpots(game, game.current, false).forEach((v) => t.vertices.add(v));
    if (mode?.kind === 'city') G.citySpots(game, game.current).forEach((v) => t.vertices.add(v));
    // los caminos gratis van solos (sin mode): el estado manda, anda online
    if (mode?.kind === 'road' || game.freeRoads > 0) G.roadSpots(game, game.current).forEach((e) => t.edges.add(e));
  } else if (game.phase === 'robber') {
    if (session.online && game.current !== session.myId) return t;
    G.robberSpots(game).forEach((h) => t.hexes.add(h));
  }
  return t;
}

function renderAll() {
  if (!game) return;
  // el modo de colocación no sobrevive al setup (quedaba residual y el prompt
  // decía "elegí un lugar libre" en el primer turno principal)
  if (mode?.setup && game.phase !== 'setup') mode = null;
  renderBoard(svg(), game, targetsForMode(), onPick);
  renderChips();
  renderLog();
  renderBank();
  renderMe();
  renderHand();
  renderPieceButtons();
  renderPrompt();
  updateDice();
  const mapLbl = game.map === 'niebla' ? ' · 🌫️ niebla' : '';
  $('#seedchip').textContent = `⬡${mapLbl} · semilla ${game.seed} · turno ${game.turn}`;
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
let shownDice = null; // last real roll stays on screen until the next one
function updateDice() {
  const box = $('#diceres');
  if (!game || game.phase === 'setup') { box.hidden = true; return; }
  if (game.dice) shownDice = game.dice;
  const placeholder = !shownDice;
  const [a, b] = shownDice || [6, 6]; // 12 as the "waiting for first roll" face
  const canRoll = game.phase === 'roll' && (!session.online || game.current === session.myId);
  box.hidden = false;
  box.classList.toggle('placeholder', placeholder);
  box.classList.toggle('seven', !placeholder && a + b === 7);
  box.classList.toggle('attn', canRoll);
  box.innerHTML = `<span class="die">${diceSVG(a)}</span><span class="die">${diceSVG(b)}</span>
    <span class="sum">= ${a + b}</span>${canRoll
      ? '<span class="lblroll">¡tocá para tirar!</span>'
      : (!placeholder && a + b === 7 ? '<span class="lbl7">¡mueven al ladrón!</span>' : '')}`;
  if (game.dice) {
    const key = `${a}-${b}-${game.turn}-${game.current}`;
    if (key !== lastDiceKey) {
      lastDiceKey = key;
      box.classList.remove('pop');
      void box.offsetWidth; // restart the pop animation
      box.classList.add('pop');
    }
  }
}

let rolling = false;
function doRoll() {
  if (rolling) return;
  if (!game) return;
  if (session.online) {
    if (game.phase !== 'roll' || game.current !== session.myId) return;
    rolling = true;
    $('#diceres').classList.remove('attn');
    act('roll').then((r) => {
      rolling = false;
      if (!r.ok) return flash(r.err);
      renderAll(); // state already arrived via broadcast (or is local-host)
    });
    return;
  }
  const r = G.rollDice(game);
  if (!r.ok) return flash(r.err);
  // quick dice animation, then settle into the new phase
  let n = 0;
  const iv = setInterval(() => {
    $('#diceres').innerHTML = `<span class="die">${diceSVG(1 + Math.floor(Math.random() * 6))}</span><span class="die">${diceSVG(1 + Math.floor(Math.random() * 6))}</span><span class="sum">…</span>`;
    if (++n >= 7) {
      clearInterval(iv);
      renderAll();
      if (game.phase === 'discard') discardChain();
    }
  }, 70);
}

/* ---------------- sidebar ---------------- */

const RES_NAMES = { wood: 'madera', brick: 'ladrillo', sheep: 'oveja', wheat: 'trigo', ore: 'mineral' };
const resName = (r) => RES_NAMES[r];
const totalCards = (p) => G.RESOURCES.reduce((s, r) => s + p.res[r], 0);

function renderChips() {
  $('#scorechips').innerHTML = game.players.map((q) => {
    const badges = `
      ${q.hasLongestRoad ? '<span class="bdg" title="Camino comercial">🛣️</span>' : ''}
      ${q.hasLargestArmy ? '<span class="bdg" title="Ejército más grande">⚔️</span>' : ''}`;
    return `
    <div class="chip ${q.id === game.current ? 'me' : ''}">
      ${houseHTML(q.color, 18)}<span class="cnm">${q.name}</span>${badges}<span class="cvp">${G.vp(q)}</span>
    </div>`;
  }).join('');
}

function renderLog() {
  const ul = $('#log');
  ul.innerHTML = '';
  [...game.log].reverse().slice(0, 40).forEach((m) => {
    const li = document.createElement('li');
    li.textContent = m;
    ul.appendChild(li);
  });
}

function renderBank() {
  $('#bankrow').innerHTML = G.RESOURCES.map((r) => {
    const left = 19 - game.players.reduce((s, q) => s + q.res[r], 0);
    return `<span class="rescard ${r}" title="${resName(r)}">${G.RES_EMOJI[r]}<small>${left}</small></span>`;
  }).join('');
}

function renderMe() {
  const p = mePlayer();
  const extra = `${p.knights ? ` · ⚔️ ${p.knights}` : ''}${p.devs?.length ? ` · 🃏 ${p.devs.length}` : ''}`;
  $('#me').innerHTML = `
    <span class="hicon">${houseHTML(p.color, 34)}</span>
    <div>
      <div class="menm">${session.online ? `${p.name} (vos)` : p.name}</div>
      <div class="mesub">🛣️ ${p.roads.length}/15 · 🏠 ${p.settlements.length}/5 · 🏛️ ${p.cities.length}/4${extra}</div>
    </div>
    <span class="pvp">${G.vp(p)} PV</span>`;
}

const DEV_SHORT = { knight: 'Caballero', vp: 'P. Victoria', roadbuilding: 'Caminos', yoplenty: 'Abundancia', monopoly: 'Monopolio' };

function renderHand() {
  const p = mePlayer();
  const resHtml = G.RESOURCES.filter((r) => p.res[r] > 0).map((r) =>
    `<span class="rescard big ${r}" title="${resName(r)}">${G.RES_EMOJI[r]}<small>×${p.res[r]}</small></span>`
  ).join('');
  // cartas de desarrollo con su índice original. Ninguna va disabled: si no
  // es jugable, el click explica por qué (el motor sigue siendo la autoridad).
  // Los PV no se juegan nunca: cuentan solos.
  const canBase = game.phase === 'main' && myTurn() && !game.devPlayed;
  const devHtml = (p.devs || []).map((c, i) => {
    const can = canBase && c.t !== 'vp' && c.turn < game.turn;
    const why = c.t === 'vp'
      ? ' (cuenta 1 PV sola, no se juega)'
      : c.turn >= game.turn ? ' (recién comprada: jugable en tu próximo turno)' : '';
    return `<button class="devcard ${can ? 'canplay' : ''}" data-dev="${i}" data-t="${c.t}"
      title="${G.DEV_NAME[c.t]}${why}">
      <span class="dico">${G.DEV_EMOJI[c.t]}</span><small>${DEV_SHORT[c.t]}</small></button>`;
  }).join('');
  $('#hand').innerHTML = (resHtml || devHtml)
    ? resHtml + devHtml
    : `<p class="empty">Sin cartas 🃏</p>`;
  $('#hand').querySelectorAll('.devcard').forEach((b) => {
    b.onclick = () => playDevCard(Number(b.dataset.dev), b.dataset.t);
  });
}

// juega la carta idx del tipo t: knight y caminos salen derecho; monopolio y
// abundancia abren su modal para elegir recursos
function playDevCard(idx, t) {
  if (t === 'vp') return flash('🏆 Los Puntos de Victoria cuentan solos, no se juegan');
  const finish = (r) => {
    if (!r.ok) return flash(r.err); // ej: "La compraste este turno: jugala en el próximo"
    if (t === 'roadbuilding') mode = { kind: 'road', setup: false };
    renderAll();
    if (game.phase === 'over') showWin();
  };
  if (t === 'monopoly') return showMonopolyModal(idx);
  if (t === 'yoplenty') return showYoplentyModal(idx);
  const kind = t === 'knight' ? 'playKnight' : 'playRoadBuilding';
  if (session.online) act(kind, [idx]).then(finish);
  else finish(G[kind](game, idx));
}

const myTurn = () => !session.online || game.current === session.myId;

function renderPieceButtons() {
  const box = $('#piecebtns');
  const p = cur();
  if (game.phase === 'setup' || game.phase === 'robber' || game.phase === 'discard' || game.phase === 'over') {
    box.innerHTML = '';
    return;
  }
  if (game.phase === 'roll') {
    box.innerHTML = session.online && !myTurn()
      ? `<button class="pbtn wide" disabled>⏳ Turno de ${p.name}…</button>`
      : `<button class="pbtn wide" disabled>🎲 Esperando tirada…</button>`;
    return;
  }
  const afford = (cost) => G.RESOURCES.every((r) => p.res[r] >= (cost[r] || 0));
  const left = { road: 15 - p.roads.length, settlement: 5 - p.settlements.length, city: 4 - p.cities.length };
  const has = (k) => {
    if (k === 'road') return G.roadSpots(game, game.current).length > 0 && left.road > 0;
    if (k === 'settlement') return G.settlementSpots(game, game.current, false).length > 0 && left.settlement > 0;
    if (k === 'city') return G.citySpots(game, game.current).length > 0 && left.city > 0;
    return false;
  };
  const btn = (kind, icon, title) => {
    // disabled si no es tu turno (solo online), no te alcanza o no hay lugar
    const dis = (session.online && !myTurn()) || !afford(G.COSTS[kind]) || !has(kind);
    return `<button class="pbtn ${mode?.kind === kind ? 'on' : ''}" data-k="${kind}" title="${title}" ${dis ? 'disabled' : ''}>${icon}<span class="n">×${left[kind]}</span></button>`;
  };
  const devLeft = game.devDeck.length;
  const devDis = !myTurn() || !afford(G.COSTS.dev) || devLeft === 0;
  box.innerHTML = `
    <button class="pbtn" id="b-trade" title="Comerciar con el banco" ${!myTurn() ? 'disabled' : ''}>🔄</button>
    ${btn('road', '🛣️', 'Construir camino — 1🧱 1🌲')}
    ${btn('settlement', '🏠', 'Fundar asentamiento — 1🧱 1🌲 1🐑 1🌾')}
    ${btn('city', '🏛️', 'Fundar ciudad — 3⛰️ 2🌾')}
    <button class="pbtn" id="b-dev" title="Carta de desarrollo — 1🐑 1🌾 1⛰️" ${devDis ? 'disabled' : ''}>🃏<span class="n">×${devLeft}</span></button>
    <button class="pbtn wide" id="b-end" ${!myTurn() ? 'disabled' : ''}>⏩ Terminar turno</button>`;
  box.querySelectorAll('button[data-k]').forEach((b) => {
    b.onclick = () => {
      const k = b.dataset.k;
      mode = mode?.kind === k ? null : { kind: k, setup: false };
      renderAll();
    };
  });
  $('#b-trade').onclick = showTradeModal;
  $('#b-dev').onclick = () => {
    if (session.online) return act('buyDev').then((r) => { if (!r.ok) flash(r.err); });
    if (!G.buyDev(game).ok) return;
    renderAll();
    if (game.phase === 'over') showWin(); // una carta de PV puede ganar en el acto
  };
  $('#b-end').onclick = () => {
    if (session.online) {
      act('endTurn').then((r) => { if (!r.ok) flash(r.err); });
      return;
    }
    const r = G.endTurn(game);
    if (!r.ok) return flash(r.err);
    mode = null;
    showHandoff(game.players[r.next]);
  };
}

function renderPrompt() {
  const pr = $('#prompt');
  const p = cur();
  const waiting = session.online && game.current !== session.myId;
  let msg = '';
  if (game.phase === 'setup') {
    const roadStep = session.online ? game.lastSetupVertex != null : mode?.kind === 'road';
    msg = roadStep
      ? `🛣️ ${p.name}: elegí el camino junto a tu asentamiento`
      : `🏠 ${p.name}: elegí dónde fundar tu asentamiento`;
    if (waiting) msg = `⏳ ${p.name} está colocando…`;
  } else if (game.phase === 'roll') {
    msg = waiting ? `⏳ ${p.name} está por tirar…` : `🎲 ${session.online ? 'Tocá el panel de dados' : p.name + ': tirá los dados'}`;
  } else if (game.phase === 'main') {
    if (game.freeRoads > 0 && !waiting) {
      msg = `🛣️ ${p.name}: colocá un camino gratis (${game.freeRoads} restante${game.freeRoads === 1 ? '' : 's'})`;
    } else {
      msg = mode ? `👉 ${p.name}: ${modeHint(mode)}` : `🔨 ${p.name}: construí, comerciá o terminá tu turno`;
    }
    if (waiting) msg = `⏳ Turno de ${p.name}…`;
  } else if (game.phase === 'robber') {
    msg = waiting ? `🦹 ${p.name} mueve al ladrón…` : `🦹 ${p.name}: mové al ladrón`;
  } else if (game.phase === 'discard') {
    msg = `🃏 Esperando descartes…`;
  }
  pr.textContent = msg;
  // con modo de construcción activo el pill es un botón de cancelar
  const cancelable = !!mode && game.phase === 'main' && !waiting;
  pr.classList.toggle('cancelable', cancelable);
  pr.onclick = cancelable ? () => { mode = null; renderAll(); } : null;
}

let flashTimer = null;
function flash(msg) {
  const pr = $('#prompt');
  pr.textContent = `⚠️ ${msg}`;
  pr.style.color = '#c0392b';
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { pr.style.color = ''; renderPrompt(); }, 1800);
}

const MODE_HINT = { settlement: 'elegí un lugar libre', city: 'elegí uno de tus asentamientos', road: 'elegí un borde libre' };
const modeHint = (m) => (m.kind === 'robber' ? 'tocá un hexágono' : MODE_HINT[m.kind]);

/* ---------------- board clicks ---------------- */

function onPick(kind, id) {
  if (!game) return;
  // click en el mar: cancela el modo de construcción (fuera del setup)
  if (kind === 'sea') {
    if (mode && game.phase === 'main') { mode = null; renderAll(); }
    return;
  }
  if (session.online) return onlinePick(kind, id);
  const wasSetupRoad = game.phase === 'setup' && kind === 'edge' && mode?.kind === 'road';
  const r = pick(game, kind, id);
  if (!r.ok) {
    // en fase main con un modo activo, tocar un lugar inválido = cambiar de opinión
    if (game.phase === 'main' && mode) { mode = null; renderAll(); return; }
    if (!r.silent) flash(r.err);
    return;
  }
  if (game.phase === 'over') { mode = null; renderAll(); showWin(); return; }
  if (game.phase === 'setup') {
    mode = kind === 'vertex' ? { kind: 'road', setup: true } : { kind: 'settlement', setup: true };
    renderAll();
    return;
  }
  // mientras queden caminos gratis (construcción de caminos) el modo camino
  // se re-arma solo; puedes fundar un asentamiento en el medio y sigue
  mode = game.freeRoads > 0 ? { kind: 'road', setup: false } : null;
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
  if (g.phase === 'main' && (mode || g.freeRoads > 0)) {
    if (kind === 'vertex' && mode?.kind === 'settlement') return G.buildSettlement(g, id);
    if (kind === 'vertex' && mode?.kind === 'city') return G.buildCity(g, id);
    if (kind === 'edge' && (mode?.kind === 'road' || g.freeRoads > 0)) return G.buildRoad(g, id);
  }
  return { ok: false, err: 'Elegí un destino válido', silent: !mode };
}

// online: pre-validación local (para resaltar), autoridad final en el host
function onlinePick(kind, id) {
  const g = game;
  const me = session.myId;
  if (g.phase === 'setup' && g.setupQueue[g.setupIdx] === me) {
    const roadStep = g.lastSetupVertex != null;
    if (kind === 'vertex' && !roadStep && G.settlementSpots(g, me, true).includes(id)) {
      act('placeSetupSettlement', [id]).then((r) => { if (!r.ok) flash(r.err); });
    } else if (kind === 'edge' && roadStep && G.setupRoadSpots(g, me).includes(id)) {
      act('placeSetupRoad', [id]).then((r) => { if (!r.ok) flash(r.err); });
    }
    return;
  }
  if (g.phase === 'robber' && g.current === me && kind === 'hex') {
    act('moveRobber', [id]).then((r) => { if (!r.ok) flash(r.err); });
    return;
  }
  if (g.phase === 'main' && g.current === me) {
    const roadOk = mode?.kind === 'road' || g.freeRoads > 0;
    if (kind === 'vertex' && mode?.kind === 'settlement') {
      act('buildSettlement', [id]).then((r) => { if (r.ok) { mode = g.freeRoads > 0 ? { kind: 'road', setup: false } : null; renderAll(); } else flash(r.err); });
    } else if (kind === 'vertex' && mode?.kind === 'city') {
      act('buildCity', [id]).then((r) => { if (r.ok) { mode = null; renderAll(); } else flash(r.err); });
    } else if (kind === 'edge' && roadOk) {
      act('buildRoad', [id]).then((r) => { if (r.ok) { mode = game.freeRoads > 0 ? { kind: 'road', setup: false } : null; renderAll(); } else flash(r.err); });
    } else if (mode && g.freeRoads === 0) {
      mode = null; // click inválido con modo activo = cancelar
      renderAll();
    }
  }
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
  const m = showModal(`
    <div class="wintrophy">🏆</div>
    <h2>¡Ganó <span style="color:${p.color}">${p.name}</span>!</h2>
    <p class="sub">${G.vp(p)} puntos de victoria en ${game.turn} turnos.</p>
    <div class="btnrow"><button class="btn primary big" id="m-again">${session.online ? 'Ok' : 'Jugar de nuevo'}</button></div>`);
  m.querySelector('#m-again').onclick = () => {
    if (session.online) { hideModal(); renderAll(); } else location.reload();
  };
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
    const commit = () => {
      hideModal();
      if (!session.online) {
        if (game.pendingDiscards.length) discardChain();
        else renderAll(); // phase is now 'robber'
      }
    };
    if (session.online) {
      act('discard', [pid, { ...sel }]).then((r) => { if (r.ok) commit(); else flash(r.err); });
    } else {
      const r = G.discard(game, pid, { ...sel });
      if (!r.ok) return;
      commit();
    }
  };
}

function showMonopolyModal(idx) {
  const m = showModal(`
    <h2>💰 Monopolio</h2>
    <p class="sub">Elegí un recurso: te llevás TODAS las cartas de ese tipo que tengan los demás.</p>
    <div class="pickgrid" id="mongrid"></div>`);
  const grid = m.querySelector('#mongrid');
  for (const r of G.RESOURCES) {
    const b = document.createElement('button');
    b.className = 'pick';
    b.innerHTML = `${G.RES_EMOJI[r]}<small style="display:block;font-size:11px;color:var(--muted)">${resName(r)}</small>`;
    b.onclick = () => {
      const done = () => { hideModal(); renderAll(); };
      if (session.online) act('playMonopoly', [idx, r]).then((x) => { if (x.ok) done(); else flash(x.err); });
      else { const x = G.playMonopoly(game, idx, r); if (x.ok) done(); else flash(x.err); }
    };
    grid.appendChild(b);
  }
}

function showYoplentyModal(idx) {
  const sel = [];
  const m = showModal(`
    <h2>🎁 Año de Abundancia</h2>
    <p class="sub">Elegí 2 recursos (pueden repetirse).</p>
    <div class="pickgrid" id="ygrid"></div>
    <p id="ysel" style="color:#ffd166;min-height:18px;margin:8px 0 0;font-size:13px">—</p>
    <div class="btnrow">
      <button class="btn" id="y-cancel">Cerrar</button>
      <button class="btn primary" id="y-ok" disabled>Tomar</button>
    </div>`);
  const grid = m.querySelector('#ygrid');
  const redraw = () => {
    grid.innerHTML = '';
    for (const r of G.RESOURCES) {
      const b = document.createElement('button');
      b.className = 'pick';
      b.innerHTML = `${G.RES_EMOJI[r]}<small style="display:block;font-size:11px;color:var(--muted)">${resName(r)}</small>`;
      b.disabled = sel.length >= 2;
      b.onclick = () => { if (sel.length < 2) { sel.push(r); redraw(); } };
      grid.appendChild(b);
    }
    m.querySelector('#ysel').textContent = sel.length ? sel.map((r) => G.RES_EMOJI[r]).join(' + ') : '—';
    m.querySelector('#y-ok').disabled = sel.length !== 2;
  };
  redraw();
  m.querySelector('#y-cancel').onclick = hideModal;
  m.querySelector('#y-ok').onclick = () => {
    const done = () => { hideModal(); renderAll(); };
    if (session.online) act('playYearOfPlenty', [idx, sel[0], sel[1]]).then((x) => { if (x.ok) done(); else flash(x.err); });
    else { const x = G.playYearOfPlenty(game, idx, sel[0], sel[1]); if (x.ok) done(); else flash(x.err); }
  };
}

function showStealModal(victims) {  const m = showModal(`
    <h2>🤏 Robo</h2>
    <p class="sub">¿A quién le robás una carta (al azar)?</p>
    <div class="pickgrid" id="vics"></div>`);
  const grid = m.querySelector('#vics');
  for (const pid of victims) {
    const p = game.players[pid];
    const total = totalCards(p);
    const b = document.createElement('button');
    b.className = 'pick';
    b.innerHTML = `${houseHTML(p.color, 20)} ${p.name} (${total})`;
    b.onclick = () => {
      const done = () => { hideModal(); renderAll(); };
      if (session.online) {
        act('stealFrom', [pid]).then((r) => { if (r.ok) { done(); flash(`Robaste una carta 👌`); } else flash(r.err); });
      } else {
        const r = G.stealFrom(game, pid);
        if (r.ok) { done(); flash(`Robaste ${G.RES_EMOJI[r.card]}`); }
      }
    };
    grid.appendChild(b);
  }
}

function showTradeModal() {
  const p = mePlayer();
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
    if (session.online) {
      act('bankTrade', [give, get]).then((r) => {
        if (r.ok) { hideModal(); renderAll(); } else m.querySelector('#terr').textContent = r.err;
      });
      return;
    }
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

// the dice panel itself is the roll button
$('#diceres').addEventListener('click', () => doRoll());

// drawer de registro/banco en mobile
$('#panel-toggle').onclick = () => $('#rightpanel').classList.toggle('open');
$('#rightpanel').addEventListener('click', (e) => {
  if (e.target.id === 'rightpanel') $('#rightpanel').classList.remove('open');
});

buildLobby();
$('#play').onclick = startGame;
$('#mk-room').onclick = createRoom;
$('#join-room').onclick = joinRoomByCode;
$('#copy-link').onclick = () => {
  const url = `${location.origin}${location.pathname}?sala=${session.code}`;
  navigator.clipboard?.writeText(url).then(() => {
    $('#copy-link').textContent = '✅ Link copiado';
    setTimeout(() => { $('#copy-link').textContent = '🔗 Copiar link de invitación'; }, 1500);
  });
};
$('#start-online').onclick = startOnlineGame;

// ?sala=CODE → prender la pestaña online con el código cargado
const urlRoom = new URLSearchParams(location.search).get('sala');
if (urlRoom) {
  lobbyTab = 'online';
  buildLobby();
  $('#join-code').value = urlRoom.toUpperCase();
  $('#my-name').focus();
}

// debug / test hook
window.__hexland = {
  get game() { return game; },
  G,
  refresh: () => renderAll(),
  setMode: (m) => { mode = m; renderAll(); },
  get mode() { return mode; },
  session,
};
