import { initializeApp } from 'firebase/app';
import { getDatabase, ref, onChildAdded, onValue, off, push, set, update, remove, onDisconnect, limitToLast, query } from 'firebase/database';
import { FIREBASE_CONFIG } from './firebase-config.js';

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

  // ── Firebase init (modular SDK v10) ──
  _initFirebase() {
    if (!FIREBASE_CONFIG || !FIREBASE_CONFIG.apiKey) {
      console.warn('[Sync] No Firebase config — cross-device sync disabled');
      return;
    }
    try {
      this._app = initializeApp(FIREBASE_CONFIG);
      this._db = getDatabase(this._app);
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
    const r = ref(this._db, '.info/connected');
    const fn = onValue(r, (s) => cb(s.val() === true));
    return () => off(r, 'value', fn);
  }

  // ── Join / leave room ──
  joinRoom(roomId, userId, info = {}) {
    this.leaveRoom();
    this._roomId = roomId;
    this._userId = userId;
    this._userInfo = info;
    if (!this._ready) return;

    const p = (base) => `${base}/${roomId}`;

    // 1. Messages (actual chat messages only)
    const msgQ = query(ref(this._db, p(DB_PATHS.messages)), limitToLast(100));
    const msgFn = onChildAdded(msgQ, (snap) => {
      const d = snap.val();
      if (!d || d.senderId === userId) return;
      this._emit('msg', { ...d, _key: snap.key });
    });
    this._cleanups.push(() => off(msgQ, 'child_added', msgFn));

    // 2. Events (edit/delete operations)
    const evtQ = query(ref(this._db, p(DB_PATHS.events)), limitToLast(50));
    const evtFn = onChildAdded(evtQ, (snap) => {
      const d = snap.val();
      if (!d) return;
      this._emit('evt', { ...d, _key: snap.key });
    });
    this._cleanups.push(() => off(evtQ, 'child_added', evtFn));

    // 3. Presence
    const presR = ref(this._db, p(DB_PATHS.presence));
    const presFn = onValue(presR, (s) => {
      this._emit('presence', { roomId, users: s.val() || {} });
    });
    this._cleanups.push(() => off(presR, 'value', presFn));

    // 4. My presence
    const myP = ref(this._db, `${p(DB_PATHS.presence)}/${userId}`);
    onDisconnect(myP).remove();
    set(myP, { ...info, online: true, lastSeen: Date.now() });

    // 5. Typing
    const typR = ref(this._db, p(DB_PATHS.typing));
    const typFn = onValue(typR, (s) => {
      const all = s.val() || {};
      Object.entries(all).forEach(([uid, v]) => {
        if (uid !== userId && v.typing && Date.now() - (v.ts || 0) < 4000) {
          this._emit('typing', { roomId, userId: uid });
        }
      });
    });
    this._cleanups.push(() => off(typR, 'value', typFn));
  }

  leaveRoom() {
    if (this._ready && this._roomId && this._userId) {
      remove(ref(this._db, `${DB_PATHS.presence}/${this._roomId}/${this._userId}`));
      remove(ref(this._db, `${DB_PATHS.typing}/${this._roomId}/${this._userId}`));
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

  // ── Edit message ──
  sendEdit(sessionId, msgId, newText) {
    const evt = { type: 'edit', sessionId, msgId, text: newText, edited: true, senderId: this._userId };
    if (this._bc) { try { this._bc.postMessage({ ...evt, _bc: true }); } catch {} }
    this._write('event', evt);
  }

  // ── Delete message ──
  sendDelete(sessionId, msgId) {
    const evt = { type: 'delete', sessionId, msgId, senderId: this._userId };
    if (this._bc) { try { this._bc.postMessage({ ...evt, _bc: true }); } catch {} }
    this._write('event', evt);
  }

  // ── Typing indicator ──
  sendTyping(sessionId, userId, typing) {
    if (!this._ready || !sessionId) return;
    const r = ref(this._db, `${DB_PATHS.typing}/${sessionId}/${userId}`);
    if (typing) {
      set(r, { typing: true, ts: Date.now() });
      setTimeout(() => update(r, { typing: false }), 3000);
    } else {
      set(r, { typing: false });
    }
  }

  // ── Session metadata ──
  saveSessionMeta(sessionId, meta) {
    this._write('meta', { sessionId, meta });
  }

  // ── Internal write ──
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
          push(ref(this._db, `${DB_PATHS.messages}/${rid}`), data);
          break;
        case 'event':
          push(ref(this._db, `${DB_PATHS.events}/${rid}`), data);
          break;
        case 'meta':
          update(ref(this._db, `${DB_PATHS.sessions}/${data.sessionId}`), { ...data.meta, updatedAt: Date.now() });
          break;
      }
    } catch (e) {
      console.error('[Sync] write error:', e);
    }
  }

  // ── Event system ──
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

export { SyncEngine };
