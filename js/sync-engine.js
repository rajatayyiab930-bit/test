const DB_PATHS = {
  sessions: 'premium-chat/sessions',
  messages: 'premium-chat/messages',
  events: 'premium-chat/events',
  users: 'premium-chat/users',
  presence: 'premium-chat/presence',
  typing: 'premium-chat/typing'
};

class SyncEngine {
  constructor() {
    this._handlers = new Map();
    this._cleanups = [];
    this._bc = null;
    this._bcKey = 'premium-chat-sync';
    this._app = null;
    this._db = null;
    this._ready = false;
    this._roomId = null;
    this._userId = null;
    this._userInfo = null;
    this._pending = [];

    this._initBC();
    this._initFirebase();
  }

  get ready() { return this._ready; }
  get roomId() { return this._roomId; }
  get userId() { return this._userId; }

  // ── BroadcastChannel (same-browser tabs) ──
  _initBC() {
    try {
      this._bc = new BroadcastChannel(this._bcKey);
      this._bc.onmessage = (e) => this._emit('raw', e.data);
    } catch {
      this._bc = null;
    }
  }

  // ── Firebase init (compat SDK via window.firebase) ──
  _initFirebase() {
    if (typeof firebase === 'undefined' || !firebase.initializeApp) {
      console.warn('[Sync] Firebase compat SDK not loaded — cross-device sync disabled');
      return;
    }
    if (!FIREBASE_CONFIG || !FIREBASE_CONFIG.apiKey) {
      console.warn('[Sync] No Firebase config — cross-device sync disabled');
      return;
    }
    try {
      if (!firebase.apps.length) {
        this._app = firebase.initializeApp(FIREBASE_CONFIG);
      } else {
        this._app = firebase.app();
      }
      this._db = firebase.database();
      this._ready = true;
      const q = this._pending;
      this._pending = null;
      q.forEach(([type, data]) => this._write(type, data));
    } catch (e) {
      console.error('[Sync] Firebase init error:', e);
    }
  }

  // ── Connection monitoring ──
  onConnection(cb) {
    if (!this._ready) { cb(false); return () => {}; }
    const r = this._db.ref('.info/connected');
    const fn = r.on('value', (s) => cb(s.val() === true));
    return () => r.off('value', fn);
  }

  // ── Join / leave room ──
  joinRoom(roomId, userId, info = {}) {
    this.leaveRoom();
    this._roomId = roomId;
    this._userId = userId;
    this._userInfo = info;
    if (!this._ready) return;

    // 1. Messages
    const msgRef = this._db.ref(`${DB_PATHS.messages}/${roomId}`).limitToLast(100);
    const msgFn = msgRef.on('child_added', (snap) => {
      const d = snap.val();
      if (!d || d.senderId === userId) return;
      this._emit('msg', { ...d, _key: snap.key });
    });
    this._cleanups.push(() => msgRef.off('child_added', msgFn));

    // 2. Events
    const evtRef = this._db.ref(`${DB_PATHS.events}/${roomId}`).limitToLast(50);
    const evtFn = evtRef.on('child_added', (snap) => {
      const d = snap.val();
      if (!d) return;
      this._emit('evt', { ...d, _key: snap.key });
    });
    this._cleanups.push(() => evtRef.off('child_added', evtFn));

    // 3. Presence listener
    const presRef = this._db.ref(`${DB_PATHS.presence}/${roomId}`);
    const presFn = presRef.on('value', (s) => {
      this._emit('presence', { roomId, users: s.val() || {} });
    });
    this._cleanups.push(() => presRef.off('value', presFn));

    // 4. My presence
    const myP = this._db.ref(`${DB_PATHS.presence}/${roomId}/${userId}`);
    myP.onDisconnect().remove();
    myP.set({ ...info, online: true, lastSeen: Date.now() });

    // 5. Typing listener
    const typRef = this._db.ref(`${DB_PATHS.typing}/${roomId}`);
    const typFn = typRef.on('value', (s) => {
      const all = s.val() || {};
      Object.entries(all).forEach(([uid, v]) => {
        if (uid !== userId && v.typing && Date.now() - (v.ts || 0) < 4000) {
          this._emit('typing', { roomId, userId: uid });
        }
      });
    });
    this._cleanups.push(() => typRef.off('value', typFn));
  }

  leaveRoom() {
    if (this._ready && this._roomId && this._userId) {
      this._db.ref(`${DB_PATHS.presence}/${this._roomId}/${this._userId}`).remove();
      this._db.ref(`${DB_PATHS.typing}/${this._roomId}/${this._userId}`).remove();
    }
    this._cleanups.forEach(f => { try { f(); } catch {} });
    this._cleanups = [];
    this._roomId = null;
    this._userId = null;
  }

  // ── Send message ──
  sendMessage(msg) {
    const rid = msg.sessionId || this._roomId;
    if (!rid) return null;

    const payload = {
      id: msg.id,
      sessionId: rid,
      senderId: msg.senderId,
      text: msg.text,
      ts: msg.timestamp || Date.now(),
      edited: !!msg.edited,
      replyTo: msg.replyTo || null,
      forwarded: !!msg.forwarded,
      status: 'sent'
    };

    if (this._bc) {
      try { this._bc.postMessage({ ...payload, type: 'new_message' }); } catch {}
    }
    this._write('new_message', payload);
    return payload;
  }

  sendEdit(sessionId, msgId, newText) {
    const evt = { type: 'edit', sessionId, msgId, text: newText, edited: true, senderId: this._userId };
    if (this._bc) { try { this._bc.postMessage({ ...evt }); } catch {} }
    this._write('event', evt);
  }

  sendDelete(sessionId, msgId) {
    const evt = { type: 'delete', sessionId, msgId, senderId: this._userId };
    if (this._bc) { try { this._bc.postMessage({ ...evt }); } catch {} }
    this._write('event', evt);
  }

  sendTyping(sessionId, userId, typing) {
    if (!this._ready || !sessionId) return;
    const r = this._db.ref(`${DB_PATHS.typing}/${sessionId}/${userId}`);
    if (typing) {
      r.set({ typing: true, ts: Date.now() });
      setTimeout(() => r.update({ typing: false }), 3000);
    } else {
      r.set({ typing: false });
    }
  }

  saveSessionMeta(sessionId, meta) {
    this._write('meta', { sessionId, meta });
  }

  _write(type, data) {
    if (!this._ready) {
      if (this._pending) this._pending.push([type, data]);
      return;
    }
    const rid = data.sessionId || this._roomId;
    if (!rid) return;

    try {
      switch (type) {
        case 'new_message':
          this._db.ref(`${DB_PATHS.messages}/${rid}`).push(data);
          break;
        case 'event':
          this._db.ref(`${DB_PATHS.events}/${rid}`).push(data);
          break;
        case 'meta':
          this._db.ref(`${DB_PATHS.sessions}/${data.sessionId}`).update({ ...data.meta, updatedAt: Date.now() });
          break;
      }
    } catch (e) {
      console.error('[Sync] write error:', e);
    }
  }

  on(event, fn) {
    if (!this._handlers.has(event)) this._handlers.set(event, []);
    this._handlers.get(event).push(fn);
    return () => {
      const a = this._handlers.get(event);
      if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }
    };
  }

  _emit(event, data) {
    const a = this._handlers.get(event);
    if (a) a.forEach(f => f(data));
  }

  destroy() {
    this.leaveRoom();
    this._handlers.clear();
    if (this._bc) { try { this._bc.close(); } catch {}; this._bc = null; }
  }
}

window.SyncEngine = SyncEngine;
