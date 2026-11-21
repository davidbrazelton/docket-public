// The Docket relay on this computer: the same pairing as the Cloudflare Worker (pairing.mjs), with plain WebSockets,
// for the tests and for trying two Docket test copies against each other. Run: node relay/desks/local.mjs 4490
// then start each test copy with PORTAL_RELAY_URL=http://localhost:4490
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import { LIMITS, routeOf, hostOwns, guestRefusal, newChan, REFUSAL_STATUS } from './pairing.mjs';

export function startRelay(port = 0, host = '127.0.0.1') {
  const rooms = new Map(); // room -> { host: ws | null, opens: [], waiting: Map(chan -> resolve), pairs: Set }
  const roomOf = (id) => { let r = rooms.get(id); if (!r) rooms.set(id, r = { host: null, opens: [], waiting: new Map(), pairs: new Set() }); return r; };
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
  const refuse = (socket, why) => { socket.end(`HTTP/1.1 ${REFUSAL_STATUS[why] || 400} ${why}\r\nconnection: close\r\ncontent-length: 0\r\n\r\n`); };
  const pipe = (a, b) => {
    let bytes = 0;
    const pass = (from, to) => from.on('message', (data, binary) => {
      bytes += data.length;
      if (bytes > LIMITS.channelBytes) { a.close(1009, 'limit'); b.close(1009, 'limit'); return; }
      if (to.readyState === 1) to.send(data, { binary });
    });
    pass(a, b); pass(b, a);
    for (const [x, y] of [[a, b], [b, a]]) { x.on('close', () => y.close()); x.on('error', () => y.terminate()); }
  };
  const server = http.createServer((req, res) => { res.writeHead(404); res.end(); });
  server.on('upgrade', async (req, socket, head) => {
    const route = routeOf(req.url);
    if (!route) return refuse(socket, 'bad');
    if (route.role === 'host' && !(await hostOwns(route))) return refuse(socket, 'not-yours');
    const room = roomOf(route.room);
    if (route.role === 'host' && !route.chan) { // the host's control line; a new one replaces the old
      return wss.handleUpgrade(req, socket, head, (ws) => {
        room.host?.close(4000, 'replaced'); room.host = ws;
        ws.on('message', (d) => { if (String(d) === 'ping') ws.send('pong'); });
        ws.on('close', () => { if (room.host === ws) room.host = null; });
      });
    }
    if (route.role === 'host') { // the host answering one guest
      const answer = room.waiting.get(route.chan);
      if (!answer) return refuse(socket, 'bad');
      room.waiting.delete(route.chan);
      return wss.handleUpgrade(req, socket, head, answer);
    }
    const why = guestRefusal({ hostThere: room.host?.readyState === 1, opens: room.opens, channels: room.pairs.size });
    if (why) return refuse(socket, why);
    const chan = newChan();
    const hostSide = await new Promise((resolve) => {
      room.waiting.set(chan, resolve);
      room.host.send(JSON.stringify({ t: 'open', chan }));
      setTimeout(() => { room.waiting.delete(chan); resolve(null); }, LIMITS.waitMs).unref();
    });
    if (!hostSide) return refuse(socket, 'timeout');
    wss.handleUpgrade(req, socket, head, (guest) => {
      const pair = { guest, hostSide }; room.pairs.add(pair);
      guest.on('close', () => room.pairs.delete(pair));
      pipe(guest, hostSide);
    });
  });
  return new Promise((resolve) => server.listen(port, host, () => resolve({
    port: server.address().port, rooms,
    close: () => new Promise((r) => { for (const c of wss.clients) c.terminate(); server.close(() => r()); server.closeAllConnections?.(); }),
  })));
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const r = await startRelay(Number(process.argv[2] || 4490));
  console.log(`Docket relay (stand-in) on http://localhost:${r.port}`);
}
