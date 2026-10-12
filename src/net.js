// Hexland — PeerJS wrapper. Thin layer over window.Peer (CDN): the host owns
// the game state; clients only send action envelopes and receive full state.

const PREFIX = 'hexland-';

export function randomCode() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 4; i++) c += abc[Math.floor(Math.random() * abc.length)];
  return c;
}

export const peerAvailable = () => typeof window !== 'undefined' && typeof window.Peer === 'function';

/**
 * Host: listens for room connections.
 * handlers: { onOpen(api), onJoin(peerId, api), onLeave(peerId, api),
 *             onMessage(peerId, msg, api), onError(err) }
 * api: { broadcast(msg), sendTo(peerId, msg), destroy() }
 */
export function hostRoom(code, handlers) {
  const peer = new Peer(PREFIX + code);
  const conns = new Map();
  const api = {
    broadcast: (msg) => { for (const c of conns.values()) if (c.open) c.send(msg); },
    sendTo: (peerId, msg) => conns.get(peerId)?.send(msg),
    destroy: () => peer.destroy(),
  };
  peer.on('open', () => handlers.onOpen?.(api));
  peer.on('error', (e) => handlers.onError?.(e));
  peer.on('connection', (conn) => {
    conn.on('open', () => {
      conns.set(conn.peer, conn);
      handlers.onJoin?.(conn.peer, api);
    });
    conn.on('data', (msg) => handlers.onMessage?.(conn.peer, msg, api));
    conn.on('close', () => {
      conns.delete(conn.peer);
      handlers.onLeave?.(conn.peer, api);
    });
  });
  return api;
}

/**
 * Client: connects to a room.
 * handlers: { onOpen(api), onMessage(msg, api), onClose(), onError(err) }
 * api: { send(msg), destroy() }
 */
export function joinRoom(code, handlers) {
  const peer = new Peer();
  let conn = null;
  const api = {
    send: (msg) => { if (conn?.open) conn.send(msg); },
    destroy: () => peer.destroy(),
  };
  peer.on('open', () => {
    conn = peer.connect(PREFIX + code, { reliable: true });
    conn.on('open', () => handlers.onOpen?.(api));
    conn.on('data', (msg) => handlers.onMessage?.(msg, api));
    conn.on('close', () => handlers.onClose?.());
  });
  peer.on('error', (e) => handlers.onError?.(e));
  return api;
}
