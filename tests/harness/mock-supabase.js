/* Browser-side fake of the supabase-js UMD bundle, for tests only.
   Every DB/RPC call is forwarded to window.__mockDb (exposed by harness.js
   from Node), so several pages/contexts ("devices") share one database. */
(function () {
  function call(op) { return window.__mockDb(JSON.stringify(op)).then(function (r) { return JSON.parse(r); }); }

  function Query(table) {
    this.op = { table: table, action: 'select', filters: [], columns: '*', returning: false, single: null };
  }
  Query.prototype.select = function (cols) {
    if (this.op.action === 'select') this.op.columns = cols || '*';
    else this.op.returning = true;
    return this;
  };
  Query.prototype.eq = function (col, val) { this.op.filters.push(['eq', col, val]); return this; };
  Query.prototype.neq = function (col, val) { this.op.filters.push(['neq', col, val]); return this; };
  Query.prototype.in = function (col, val) { this.op.filters.push(['in', col, val]); return this; };
  Query.prototype.order = function () { return this; };
  Query.prototype.limit = function () { return this; };
  Query.prototype.maybeSingle = function () { this.op.single = 'maybe'; return this; };
  Query.prototype.single = function () { this.op.single = 'one'; return this; };
  Query.prototype.upsert = function (rows, opts) { this.op.action = 'upsert'; this.op.rows = rows; this.op.opts = opts || {}; return this; };
  Query.prototype.insert = function (rows) { this.op.action = 'insert'; this.op.rows = rows; return this; };
  Query.prototype.update = function (vals) { this.op.action = 'update'; this.op.values = vals; return this; };
  Query.prototype.delete = function () { this.op.action = 'delete'; return this; };
  Query.prototype.then = function (res, rej) {
    var op = Object.assign({ uid: window.__mockUid }, this.op);
    return call(op).then(res, rej);
  };

  /* Realtime: channel(name).on('postgres_changes', filter, cb).subscribe(statusCb).
     subscribe reports 'SUBSCRIBED' (or 'CHANNEL_ERROR' while
     window.__mockRealtimeDown is true). harness.js pushes row-change events in
     through window.__mockRealtimeDeliver(events) whenever the shared fake DB
     changes an abps_workspace row. window.__mockRealtime exposes the open
     channels and counters for tests. */
  var RT = window.__mockRealtime = { channels: [], created: 0, removed: 0, delivered: 0 };
  function makeChannel(name) {
    var c = {
      topic: 'realtime:' + name, name: name, state: 'joining', handlers: [], statusCb: null,
      on: function (type, filter, cb) { if (type === 'postgres_changes') c.handlers.push({ filter: filter || {}, cb: cb }); return c; },
      subscribe: function (cb) {
        c.statusCb = cb || null;
        if (RT.channels.indexOf(c) === -1) RT.channels.push(c);
        setTimeout(function () {
          if (c.state === 'closed') return;
          if (window.__mockRealtimeDown) { c.state = 'errored'; if (c.statusCb) c.statusCb('CHANNEL_ERROR', new Error('mock realtime down')); return; }
          c.state = 'joined';
          if (c.statusCb) c.statusCb('SUBSCRIBED');
        }, 30);
        return c;
      },
      unsubscribe: function () {
        var i = RT.channels.indexOf(c);
        if (i !== -1) { RT.channels.splice(i, 1); RT.removed++; }
        var was = c.state; c.state = 'closed';
        if (was !== 'closed' && c.statusCb) c.statusCb('CLOSED');
        return Promise.resolve('ok');
      }
    };
    RT.created++;
    return c;
  }
  window.__mockRealtimeDeliver = function (events) {
    (events || []).forEach(function (ev) {
      RT.channels.slice().forEach(function (c) {
        if (c.state !== 'joined') return;
        c.handlers.forEach(function (h) {
          var f = h.filter;
          if (f.schema && f.schema !== ev.schema) return;
          if (f.table && f.table !== ev.table) return;
          if (f.event && f.event !== '*' && f.event !== ev.eventType) return;
          RT.delivered++;
          try { h.cb(JSON.parse(JSON.stringify(ev))); } catch (e) { console.error('realtime handler threw: ' + (e && e.message)); }
        });
      });
    });
  };
  // Mirrors a server-side drop of every channel (e.g. network loss).
  window.__mockRealtimeDrop = function (status) {
    RT.channels.slice().forEach(function (c) { c.state = 'errored'; if (c.statusCb) c.statusCb(status || 'CHANNEL_ERROR', new Error('mock drop')); });
  };

  function createClient() {
    var uid = window.__mockUid || 'user-operator';
    var session = { user: { id: uid, email: uid + '@test' }, access_token: 'x', expires_at: Math.floor(Date.now() / 1000) + 86400 };
    var signedIn = !window.__mockSignedOut;
    return {
      auth: {
        getSession: function () { return Promise.resolve({ data: { session: signedIn ? session : null }, error: null }); },
        refreshSession: function () { return Promise.resolve({ data: { session: signedIn ? session : null }, error: null }); },
        signInWithPassword: function () { signedIn = true; return Promise.resolve({ data: { session: session, user: session.user }, error: null }); },
        signOut: function () { signedIn = false; return Promise.resolve({ error: null }); },
        onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
        getUser: function () { return Promise.resolve({ data: { user: signedIn ? session.user : null }, error: null }); }
      },
      from: function (t) { return new Query(t); },
      rpc: function (name, args) { return call({ uid: uid, action: 'rpc', name: name, args: args }); },
      storage: {
        from: function () {
          return {
            upload: function () { return Promise.resolve({ data: {}, error: null }); },
            createSignedUrl: function () { return Promise.resolve({ data: { signedUrl: 'about:blank' }, error: null }); },
            remove: function () { return Promise.resolve({ data: {}, error: null }); }
          };
        }
      },
      // functions.invoke → harness handleInvoke (db.functions[name]). A non-2xx
      // answer comes back as a FunctionsHttpError whose context mimics the
      // Response (status + json()), like supabase-js.
      functions: {
        invoke: function (name, opts) {
          return call({ uid: uid, action: 'invoke', name: name, body: opts && opts.body !== undefined ? opts.body : null }).then(function (r) {
            if (r && r.error && r.error.context) {
              var c = r.error.context, body = c.body;
              r.error.context = { status: c.status, json: function () { return body == null ? Promise.reject(new Error('no body')) : Promise.resolve(body); } };
            }
            return r;
          });
        }
      },
      channel: function (name) { return makeChannel(name); },
      removeChannel: function (c) { return c && c.unsubscribe ? c.unsubscribe() : Promise.resolve('ok'); },
      getChannels: function () { return RT.channels.slice(); }
    };
  }
  window.supabase = { createClient: createClient };
})();
