// The Docket relay for Remote Desks (#1052), as a Cloudflare Worker: one Durable Object per room holds the host's
// control line and pairs each guest with a line the host opens for it. The rules are in ../pairing.mjs; README.md
// says how it is deployed. The Durable Object uses WebSocket hibernation, so a host waiting all day costs nothing
// while nobody connects. It keeps nothing on disk.
import { LIMITS, routeOf, hostOwns, guestRefusal, newChan, REFUSAL_STATUS } from '../pairing.mjs';

const refuse = (why) => new Response(why, { status: REFUSAL_STATUS[why] || 400 });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/') return new Response('Docket relay for Remote Desks. Nothing to see here.\n', { headers: { 'content-type': 'text/plain' } });
    if (request.headers.get('upgrade') !== 'websocket') return refuse('bad');
    const route = routeOf(url.pathname + url.search);
    if (!route) return refuse('bad');
    // A few connections a minute from one address (the RATE binding, wrangler.toml); left out when not set up.
    if (env.RATE) {
      const { success } = await env.RATE.limit({ key: request.headers.get('cf-connecting-ip') || 'unknown' });
      if (!success) return refuse('busy');
    }
    if (route.role === 'host' && !(await hostOwns(route))) return refuse('not-yours');
    return env.ROOMS.get(env.ROOMS.idFromName(route.room)).fetch(request);
  },
};

export class Room {
  constructor(ctx) {
    this.ctx = ctx;
    this.opens = []; // guest connection times in the last minute (lost when the object sleeps, which is fine)
    this.waiting = new Map(); // chan -> resolve(host side), while a guest waits for the host to answer
    this.bytes = new Map(); // chan -> bytes passed
    // The host's keep-alive, answered without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(request) {
    const url = new URL(request.url);
    const route = routeOf(url.pathname + url.search);
    if (route.role === 'host' && !route.chan) { // the host's control line; a new one replaces the old
      for (const old of this.ctx.getWebSockets('ctl')) old.close(4000, 'replaced');
      return this.accept(['ctl'], { kind: 'ctl' });
    }
    if (route.role === 'host') { // the host answering one guest
      const answer = this.waiting.get(route.chan);
      if (!answer) return refuse('bad');
      this.waiting.delete(route.chan);
      const res = this.accept(['host', `h:${route.chan}`], { kind: 'host', chan: route.chan });
      answer(true);
      return res;
    }
    const control = this.ctx.getWebSockets('ctl')[0];
    const why = guestRefusal({ hostThere: !!control, opens: this.opens, channels: this.ctx.getWebSockets('guest').length });
    if (why) return refuse(why);
    const chan = newChan();
    const answered = await new Promise((resolve) => {
      this.waiting.set(chan, resolve);
      try { control.send(JSON.stringify({ t: 'open', chan })); } catch { resolve(false); }
      setTimeout(() => resolve(false), LIMITS.waitMs);
    });
    this.waiting.delete(chan);
    if (!answered) return refuse('timeout');
    return this.accept(['guest', `g:${chan}`], { kind: 'guest', chan });
  }

  accept(tags, attachment) {
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server, tags);
    server.serializeAttachment(attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  partner(ws) {
    const a = ws.deserializeAttachment();
    if (!a?.chan) return null;
    return this.ctx.getWebSockets(`${a.kind === 'guest' ? 'h' : 'g'}:${a.chan}`)[0] || null;
  }

  async webSocketMessage(ws, message) {
    const a = ws.deserializeAttachment();
    if (a?.kind === 'ctl') return; // only its keep-alive, answered above
    const other = this.partner(ws);
    if (!other) return ws.close(1011, 'no partner');
    const n = (this.bytes.get(a.chan) || 0) + (typeof message === 'string' ? message.length : message.byteLength);
    this.bytes.set(a.chan, n);
    if (n > LIMITS.channelBytes) { ws.close(1009, 'limit'); other.close(1009, 'limit'); return; }
    other.send(message);
  }

  async webSocketClose(ws, code, reason) {
    const a = ws.deserializeAttachment();
    if (a?.chan) this.bytes.delete(a.chan);
    try { this.partner(ws)?.close(1000, 'other side closed'); } catch {}
    try { ws.close(code === 1005 || code === 1006 ? 1000 : code, reason); } catch {}
  }

  async webSocketError(ws) { await this.webSocketClose(ws, 1011, 'error'); }
}
