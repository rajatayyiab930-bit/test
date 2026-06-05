class ChatEngine {
  constructor() {
    this.currentUser = null;
    this.activeSession = null;
    this.messages = [];
    this.selectedMessages = new Set();
    this.editingMessage = null;
    this.replyTo = null;
    this._listeners = new Map();
    this._typingTimer = null;

    this.sync = new SyncEngine();
    this._initSync();

    this.sync.onConnection((connected) => {
      this._emit('connection', connected);
    });
  }

  // ── Wire up sync engine events ──
  _initSync() {
    // From Firebase: new messages
    this.sync.on('msg', (data) => {
      if (!this.activeSession || data.sessionId !== this.activeSession.id) return;
      this._ingestMessage(data);
    });

    // From Firebase: events (edit/delete)
    this.sync.on('evt', (data) => {
      if (!data.senderId || data.senderId === this.currentUser?.id) return;
      if (!this.activeSession || data.sessionId !== this.activeSession.id) return;
      if (data.type === 'edit') this._applyEdit(data);
      else if (data.type === 'delete') this._applyDelete(data);
    });

    // From BroadcastChannel: same-browser messages and events
    this.sync.on('raw', (data) => {
      if (data.senderId === this.currentUser?.id) return;
      if (!this.activeSession || data.sessionId !== this.activeSession.id) return;
      if (data.type === 'new_message') {
        // Already handled by Firebase — dedup via id check in _ingestMessage
        this._ingestMessage(data);
      } else if (data.type === 'edit') {
        this._applyEdit(data);
      } else if (data.type === 'delete') {
        this._applyDelete(data);
      }
    });

    // Presence updates
    this.sync.on('presence', (data) => this._onPresence(data));

    // Typing indicators
    this.sync.on('typing', (data) => {
      if (data.roomId === this.activeSession?.id && data.userId !== this.currentUser?.id) {
        this._emit('typing', { userId: data.userId, sessionId: data.roomId });
      }
    });
  }

  // ── Ingest an incoming message (dedup by id) ──
  _ingestMessage(msg) {
    if (this.messages.find(m => m.id === msg.id)) return;
    msg.status = 'read';
    msg.timestamp = msg.ts || msg.timestamp || Date.now();
    AppStorage.addMessage(this.activeSession.id, msg);
    this.messages.push(msg);
    this._updateSessionLastMsg(msg.text);
    this._emit('new_message', msg);
    this._emit('render_messages', this.messages);
  }

  // ── Apply edit event from remote ──
  _applyEdit(data) {
    const msg = this.messages.find(m => m.id === data.msgId);
    if (!msg) return;
    msg.text = data.text;
    msg.edited = true;
    AppStorage.updateMessage(this.activeSession.id, data.msgId, { text: data.text, edited: true });
    this._emit('message_updated', msg);
    this._emit('render_messages', this.messages);
  }

  // ── Apply delete event from remote ──
  _applyDelete(data) {
    AppStorage.deleteMessage(this.activeSession.id, data.msgId);
    this.messages = this.messages.filter(m => m.id !== data.msgId);
    this.selectedMessages.delete(data.msgId);
    this._emit('message_deleted', data.msgId);
    this._emit('render_messages', this.messages);
  }

  // ── Presence ──
  _onPresence(data) {
    if (data.roomId !== this.activeSession?.id) return;
    const otherId = Object.keys(data.users).find(id => id !== this.currentUser?.id);
    if (!otherId) return;
    const info = data.users[otherId];
    const other = this.getOtherUser(this.activeSession);
    if (other && info) {
      if (info.name) other.name = info.name;
      if (info.avatar !== undefined) other.avatar = info.avatar;
      other.online = info.online === true;
      other.lastSeen = info.lastSeen || Date.now();
      AppStorage.saveUser(other.id, other);
      this._emit('user_status', {
        userId: otherId,
        status: other.online ? 'online' : 'offline',
        sessionId: data.roomId
      });
      this._emit('session_updated', this.activeSession);
    }
  }

  // ── User management ──
  setCurrentUser(user) {
    this.currentUser = user;
    AppStorage.setCurrentUser(user);
  }

  getOtherUser(session) {
    if (!session || !this.currentUser) return null;
    const otherId = session.participants.find(id => id !== this.currentUser.id);
    return otherId ? AppStorage.getUser(otherId) : null;
  }

  // ── Session ──
  createSession(name, avatarIdx) {
    const otherId = AppStorage.generateId();
    const otherUser = {
      id: otherId,
      name: name || 'User ' + (Math.floor(Math.random() * 900) + 100),
      avatar: avatarIdx ?? Math.floor(Math.random() * 6),
      device: this.currentUser?.device === 'mobile' ? 'desktop' : 'mobile',
      createdAt: Date.now(),
      lastSeen: Date.now()
    };
    AppStorage.saveUser(otherId, otherUser);

    const session = {
      id: AppStorage.generateId(),
      participants: [this.currentUser.id, otherId],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastMessage: '',
      archived: false,
      unread: 0
    };
    AppStorage.saveSession(session);

    if (this.sync.ready) {
      this.sync.saveSessionMeta(session.id, {
        createdBy: this.currentUser.id,
        createdByName: this.currentUser.name,
        createdByDevice: this.currentUser.device,
        participantIds: [this.currentUser.id, otherId],
        createdAt: session.createdAt
      });
    }

    return session;
  }

  async openSession(session) {
    this.activeSession = session;
    AppStorage.setActiveSession(session.id);
    this.messages = AppStorage.getMessages(session.id);
    session.unread = 0;
    AppStorage.saveSession(session);

    this.sync.joinRoom(session.id, this.currentUser.id, {
      name: this.currentUser.name,
      avatar: this.currentUser.avatar,
      device: this.currentUser.device
    });

    this._emit('session_opened', session);
    return this.messages;
  }

  closeSession() {
    this.sync.leaveRoom();
    this.activeSession = null;
    AppStorage.setActiveSession(null);
  }

  // ── Send message ──
  sendMessage(text) {
    if (!this.activeSession || !text.trim()) return null;

    const msg = {
      id: 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      sessionId: this.activeSession.id,
      senderId: this.currentUser.id,
      text: text.trim(),
      timestamp: Date.now(),
      status: 'sending',
      edited: false,
      replyTo: this.replyTo || null,
      forwarded: false
    };

    const sessionId = this.activeSession.id;
    AppStorage.addMessage(sessionId, msg);
    this.messages.push(msg);
    this._updateSessionLastMsg(msg.text);
    this.replyTo = null;

    this.sync.sendMessage(msg);

    // Simulate delivery status locally (capture sessionId to avoid stale closures)
    const sid = sessionId;
    setTimeout(() => this._setStatus(msg.id, 'sent', sid), 300);
    setTimeout(() => this._setStatus(msg.id, 'delivered', sid), 800);
    setTimeout(() => this._setStatus(msg.id, 'read', sid), 2000);

    this._emit('new_message', msg);
    return msg;
  }

  _setStatus(msgId, status, sessionId) {
    if (!this.activeSession || this.activeSession.id !== sessionId) return;
    const msg = this.messages.find(m => m.id === msgId);
    if (!msg) return;
    msg.status = status;
    AppStorage.updateMessage(this.activeSession.id, msgId, { status });
    this._emit('message_updated', msg);
    this._emit('render_messages', this.messages);
  }

  // ── Edit message ──
  editMessage(msgId, newText) {
    if (!this.activeSession) return;
    const msg = this.messages.find(m => m.id === msgId);
    if (!msg) return;

    msg.text = newText;
    msg.edited = true;
    AppStorage.updateMessage(this.activeSession.id, msgId, { text: newText, edited: true });
    this._updateSessionLastMsg(newText);

    this.sync.sendEdit(this.activeSession.id, msgId, newText);
    this._emit('message_updated', msg);
    this._emit('render_messages', this.messages);
  }

  // ── Delete message(s) ──
  deleteMessage(msgId) {
    if (!this.activeSession) return;
    AppStorage.deleteMessage(this.activeSession.id, msgId);
    this.messages = this.messages.filter(m => m.id !== msgId);
    this.selectedMessages.delete(msgId);
    this.sync.sendDelete(this.activeSession.id, msgId);
    this._emit('render_messages', this.messages);
  }

  deleteMessages(msgIds) {
    msgIds.forEach(id => this.deleteMessage(id));
  }

  // ── Resend ──
  resendMessage(msgId) {
    const msg = this.messages.find(m => m.id === msgId);
    if (msg) this.sendMessage(msg.text);
  }

  // ── Forward ──
  forwardMessage(msgId, targetSessionId) {
    const msg = this.messages.find(m => m.id === msgId);
    if (!msg) return null;

    const fwd = {
      id: 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      sessionId: targetSessionId,
      senderId: this.currentUser.id,
      text: msg.text,
      timestamp: Date.now(),
      status: 'sending',
      edited: false,
      forwarded: true,
      replyTo: null
    };

    AppStorage.addMessage(targetSessionId, fwd);
    this.sync.sendMessage(fwd);
    return fwd;
  }

  // ── Typing ──
  sendTypingIndicator() {
    if (!this.activeSession) return;
    if (this._typingTimer) clearTimeout(this._typingTimer);
    this.sync.sendTyping(this.activeSession.id, this.currentUser.id, true);
    this._typingTimer = setTimeout(() => {
      this.sync.sendTyping(this.activeSession.id, this.currentUser.id, false);
    }, 2500);
  }

  // ── Share link ──
  getShareableLink(sessionId) {
    if (!sessionId) sessionId = this.activeSession?.id;
    if (!sessionId) return '';
    if (this.sync.ready) {
      this.sync.saveSessionMeta(sessionId, {
        createdBy: this.currentUser.id,
        createdByName: this.currentUser.name,
        createdByDevice: this.currentUser.device
      });
    }
    const base = window.location.href.split('#')[0].split('?')[0];
    return base + '?join=' + encodeURIComponent(sessionId);
  }

  joinSessionByLink(linkOrId) {
    const sessionId = linkOrId.replace(/.*[?&]join=/, '');
    if (!sessionId) return null;

    const existing = AppStorage.getSession(sessionId);
    if (existing) {
      this.openSession(existing);
      return existing;
    }

    const otherUserId = 'remote_' + sessionId.slice(-8);
    const otherUser = {
      id: otherUserId,
      name: 'Connected User',
      avatar: Math.floor(Math.random() * 6),
      device: this.currentUser?.device === 'mobile' ? 'desktop' : 'mobile',
      createdAt: Date.now(),
      lastSeen: Date.now()
    };
    AppStorage.saveUser(otherUserId, otherUser);

    const session = {
      id: sessionId,
      participants: [this.currentUser.id, otherUserId],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastMessage: '',
      archived: false,
      unread: 0
    };
    AppStorage.saveSession(session);
    this.openSession(session);
    return session;
  }

  // ── Helpers ──
  _updateSessionLastMsg(text) {
    if (!this.activeSession) return;
    this.activeSession.lastMessage = text.slice(0, 60) + (text.length > 60 ? '...' : '');
    this.activeSession.updatedAt = Date.now();
    AppStorage.saveSession(this.activeSession);
    this._emit('session_updated', this.activeSession);
  }

  getSessions() {
    return AppStorage.getSessions().filter(s => s.participants.includes(this.currentUser?.id));
  }

  searchMessages(query) {
    if (!query.trim()) return this.messages;
    const q = query.toLowerCase();
    return this.messages.filter(m => m.text.toLowerCase().includes(q));
  }

  getSessionsBySearch(query) {
    if (!query.trim()) return this.getSessions();
    const q = query.toLowerCase();
    return this.getSessions().filter(s => {
      const other = this.getOtherUser(s);
      return other?.name.toLowerCase().includes(q) || s.lastMessage?.toLowerCase().includes(q);
    });
  }

  exportChat(sessionId) {
    const msgs = AppStorage.getMessages(sessionId);
    const session = AppStorage.getSession(sessionId);
    const other = session ? this.getOtherUser(session) : null;
    const user = this.currentUser;

    let text = `=== PremiumChat Export ===\nDate: ${new Date().toLocaleString()}\n`;
    text += `Participants: ${user?.name || 'Me'} & ${other?.name || 'Unknown'}\n`;
    text += `Messages: ${msgs.length}\n${'='.repeat(30)}\n\n`;

    msgs.forEach(m => {
      const sender = m.senderId === user?.id ? user.name : other?.name || 'Unknown';
      text += `[${new Date(m.timestamp).toLocaleString()}] ${sender}: ${m.text}${m.edited ? ' (edited)' : ''}${m.forwarded ? ' (forwarded)' : ''}\n`;
    });

    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chat-export-${sessionId.slice(-8)}-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Internal event system ──
  on(event, fn) {
    if (!this._listeners.has(event)) this._listeners.set(event, []);
    this._listeners.get(event).push(fn);
    return () => {
      const a = this._listeners.get(event);
      if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }
    };
  }

  _emit(event, data) {
    const a = this._listeners.get(event);
    if (a) a.forEach(f => f(data));
  }
}

window.ChatEngine = ChatEngine;
