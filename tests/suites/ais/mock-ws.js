/* A tiny WebSocket server (RFC 6455, no dependencies) standing in for
   wss://stream.aisstream.io/v0/stream in the edge-function tests.
     const srv = await startWsServer(conn => { conn.on('message', m => …); conn.send(text) ; conn.send(buf, true) });
     srv.url  → 'ws://127.0.0.1:<port>/v0/stream';  srv.connections; await srv.close();
   conn.connectedAt, conn.received ([{at, data}]), conn.send(data, binary),
   conn.close(code, reason). Only what the tests need: unfragmented frames,
   masked client frames, text/binary/close/ping. */
const http = require('http');
const crypto = require('crypto');
const { EventEmitter } = require('events');

class Conn extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.connectedAt = Date.now();
    this.received = [];
    this.closed = false;
    socket.on('data', d => { this.buf = Buffer.concat([this.buf, d]); this._parse(); });
    socket.on('close', () => { if (!this.closed) { this.closed = true; this.emit('close'); } });
    socket.on('error', () => {});
  }
  _parse() {
    for (;;) {
      const b = this.buf;
      if (b.length < 2) return;
      const op = b[0] & 0x0f, masked = b[1] & 0x80;
      let len = b[1] & 0x7f, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
      let mask = null;
      if (masked) { if (b.length < off + 4) return; mask = b.subarray(off, off + 4); off += 4; }
      if (b.length < off + len) return;
      const payload = Buffer.from(b.subarray(off, off + len));
      if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
      this.buf = b.subarray(off + len);
      if (op === 1 || op === 2) {
        const data = op === 1 ? payload.toString('utf8') : payload;
        this.received.push({ at: Date.now(), data });
        this.emit('message', data);
      } else if (op === 8) {
        this._frame(8, payload.subarray(0, 2));
        this.closed = true;
        this.socket.end();
        this.emit('close');
        return;
      } else if (op === 9) this._frame(10, payload);
    }
  }
  _frame(op, payload) {
    if (this.socket.destroyed || this.socket.writableEnded) return;
    const len = payload.length;
    let head;
    if (len < 126) head = Buffer.from([0x80 | op, len]);
    else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(len, 2); }
    else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
    this.socket.write(Buffer.concat([head, payload]));
  }
  send(data, binary) {
    if (this.closed) return;
    const p = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
    this._frame(binary ? 2 : 1, p);
  }
  close(code, reason) {
    if (this.closed) return;
    const r = Buffer.from(String(reason || ''), 'utf8');
    const p = Buffer.alloc(2 + r.length); p.writeUInt16BE(code || 1000, 0); r.copy(p, 2);
    this._frame(8, p);
    this.closed = true;
    setTimeout(() => this.socket.end(), 20);
  }
}

function startWsServer(onConnection) {
  return new Promise(resolve => {
    const connections = [];
    const server = http.createServer((req, res) => { res.writeHead(404); res.end(); });
    server.on('upgrade', (req, socket) => {
      const key = req.headers['sec-websocket-key'];
      const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
      socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
      const conn = new Conn(socket);
      connections.push(conn);
      try { onConnection(conn, req); } catch (e) { console.error('mock ws handler threw', e); }
    });
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        url: 'ws://127.0.0.1:' + port + '/v0/stream',
        connections,
        close: () => new Promise(r => { connections.forEach(c => { try { c.socket.destroy(); } catch (e) {} }); server.close(() => r()); }),
      });
    });
  });
}

module.exports = { startWsServer };
