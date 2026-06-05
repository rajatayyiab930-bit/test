class SyncEngine {
  constructor() {
    this.handlers = [];
    this.firebaseReady = false;
    this.currentSessionId = null;
    this.currentUserId = null;
    this._firebaseListeners = [];
    this._localStorageKey = 'pc_sync_channel';

    this._initBroadcastChannel();
    this._initLocalStorage();
    this._initFirebase();
  }

  // ── BroadcastChannel (same-browser same-origin tabs) ──
  _initBroadcastChannel() {
    try {
      this.bc = new BroadcastChannel('premium-chat');
      this.bc.onmessage = (e) => this._dispatch(e.data);
    } catch (e) {
      this.bc = null;
    }
  }

  // ── localStorage 'storage' event (fallback for same-browser) ──
  _initLocalStorage() {
    window.addEventListener('storage', (e) => {
      if (e.key === this._localStorageKey && e.newValue) {
        try {
          const data = JSON.parse(e.newValue);
          this._dispatch(data);
        } catch {}
      }
    });
  }

  // ── Firebase Realtime Database (cross-device) ──
  _initFirebase() {
    if (!window.firebase || !FIREBASE_CONFIG || !FIREBASE_CONFIG.apiKey) return;

    try {
      if (!firebase.apps.length) {
        firebase.initializeApp(FIREBASE_CONFIG);
      }
      this.db = firebase.database();
      this.firebaseReady = true;
    } catch (e) {
      console.warn('Firebase init failed:', e.message);
    }
  }

  // ── Join a room (session) via Firebase ──
  joinRoom(sessionId, userId, userInfo = {}) {
    this.leaveRoom();
    this.currentSessionId = sessionId;
    this.currentUserId = userId;

    if (!this.firebaseReady) return;

    // Listen for new messages in this room
    const msgsRef = this.db.ref(`rooms/${sessionId}/messages`);
    const msgsCB = msgsRef.limitToLast(50).on('child_added', (snapshot) => {
      const data = snapshot.val();
      if (data && data.userId !== userId) {
        data._firebase = true;
        this._dispatch(data);
      }
    });
    this._firebaseListeners.push({ ref: msgsRef, cb: msgsCB, event: 'child_added' });

    // Listen for events (status updates, typing, etc.)
    const evtsRef = this.db.ref(`rooms/${sessionId}/events`);
    const evtsCB = evtsRef.limitToLast(20).on('child_added', (snapshot) => {
      const data = snapshot.val();
      if (data && data.userId !== userId) {
        data._firebase = true;
        this._dispatch(data);
      }
    });
    this._firebaseListeners.push({ ref: evtsRef, cb: evtsCB, event: 'child_added' });

    // Listen for session metadata
    const metaRef = this.db.ref(`rooms/${sessionId}/meta`);
    const metaCB = metaRef.on('value', (snapshot) => {
      const meta = snapshot.val();
      if (meta) {
        this._dispatch({ type: 'session_meta', sessionId, meta });
      }
    });
    this._firebaseListeners.push({ ref: metaRef, cb: metaCB, event: 'value' });

    // Set presence with user info
    const presenceRef = this.db.ref(`rooms/${sessionId}/users/${userId}`);
    presenceRef.onDisconnect().remove();
    presenceRef.set({ ...userInfo, online: true, lastSeen: Date.now() });

    // Listen for user presence changes
    const usersRef = this.db.ref(`rooms/${sessionId}/users`);
    const usersCB = usersRef.on('value', (snapshot) => {
      const users = snapshot.val() || {};
      this._dispatch({ type: 'presence', users, sessionId });
    });
    this._firebaseListeners.push({ ref: usersRef, cb: usersCB, event: 'value' });

    // Update session metadata with creator info
    if (userInfo.name) {
      this.db.ref(`rooms/${sessionId}/meta`).update({
        updatedAt: Date.now(),
        lastActive: Date.now()
      });
    }
  }

  leaveRoom() {
    if (this.firebaseReady && this.currentSessionId && this.currentUserId) {
      const presenceRef = this.db.ref(`rooms/${this.currentSessionId}/users/${this.currentUserId}`);
      presenceRef.remove();
    }

    this._firebaseListeners.forEach(({ ref, cb, event }) => {
      try { ref.off(event, cb); } catch {}
    });
    this._firebaseListeners = [];

    this.currentSessionId = null;
  }

  // ── Send message to all channels ──
  send(data) {
    if (this.bc) {
      try { this.bc.postMessage(data); } catch {}
    }

    try {
      localStorage.setItem(this._localStorageKey, JSON.stringify(data));
    } catch {}

    this._sendFirebase(data);
  }

  _sendFirebase(data) {
    if (!this.firebaseReady) return;

    const sessionId = data.sessionId || this.currentSessionId;
    if (!sessionId) return;

    if (data.type === 'new_message') {
      this.db.ref(`rooms/${sessionId}/messages`).push(data);
    } else {
      this.db.ref(`rooms/${sessionId}/events`).push(data);
    }
  }

  // ── Listen for messages ──
  onMessage(handler) {
    this.handlers.push(handler);
    return () => {
      const idx = this.handlers.indexOf(handler);
      if (idx >= 0) this.handlers.splice(idx, 1);
    };
  }

  _dispatch(data) {
    this.handlers.forEach(h => h(data));
  }

  // ── Cleanup ──
  destroy() {
    this.leaveRoom();
    this.handlers = [];
    if (this.bc) {
      try { this.bc.close(); } catch {}
    }
  }
}

window.SyncEngine = SyncEngine;
