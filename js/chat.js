class ChatEngine {
  constructor() {
    this.currentUser = null;
    this.activeSession = null;
    this.messages = [];
    this.selectedMessages = new Set();
    this.editingMessage = null;
    this.replyTo = null;
    this.listeners = [];
    this.sync = new SyncEngine();
    this.initSync();
  }

  initSync() {
    this.sync.onMessage((data) => {
      switch (data.type) {
        case 'new_message':
          if (data.sessionId === this.activeSession?.id && data.userId !== this.currentUser?.id) {
            this.receiveMessage(data.message);
          }
          break;
        case 'message_updated':
          if (data.sessionId === this.activeSession?.id) {
            this.updateMessageInList(data.messageId, data.updates);
          }
          break;
        case 'message_deleted':
          if (data.sessionId === this.activeSession?.id) {
            this.removeMessageFromList(data.messageId);
          }
          break;
        case 'user_online':
          this.notifyListeners('user_status', { userId: data.userId, status: 'online', sessionId: data.sessionId });
          break;
        case 'typing':
          if (data.sessionId === this.activeSession?.id && data.userId !== this.currentUser?.id) {
            this.notifyListeners('typing', { userId: data.userId, sessionId: data.sessionId });
          }
          break;
        case 'presence':
          this.handlePresence(data);
          break;
        case 'session_meta':
          this.handleSessionMeta(data);
          break;
      }
    });
  }

  handlePresence(data) {
    if (data.sessionId !== this.activeSession?.id || !data.users) {
      this.notifyListeners('presence', data);
      return;
    }

    const otherUserId = Object.keys(data.users).find(id => id !== this.currentUser?.id);
    if (otherUserId && data.users[otherUserId]) {
      const otherInfo = data.users[otherUserId];
      const otherUser = this.getOtherUser(this.activeSession);
      if (otherUser && otherInfo.name) {
        otherUser.name = otherInfo.name;
        if (otherInfo.avatar !== undefined) otherUser.avatar = otherInfo.avatar;
        if (otherInfo.device) otherUser.device = otherInfo.device;
        otherUser.online = otherInfo.online;
        otherUser.lastSeen = otherInfo.lastSeen || Date.now();
        AppStorage.saveUser(otherUser.id, otherUser);
        this.notifyListeners('user_status', {
          userId: otherUserId,
          status: otherInfo.online ? 'online' : 'offline',
          sessionId: data.sessionId
        });
        this.notifyListeners('session_updated', this.activeSession);
      }
    }

    this.notifyListeners('presence', data);
  }

  handleSessionMeta(data) {
    if (data.sessionId !== this.activeSession?.id || !data.meta) return;

    const meta = data.meta;
    if (meta.createdBy && meta.createdBy !== this.currentUser?.id) {
      const otherUser = this.getOtherUser(this.activeSession);
      if (otherUser && meta.createdByName) {
        otherUser.name = meta.createdByName;
        AppStorage.saveUser(otherUser.id, otherUser);
        this.notifyListeners('session_updated', this.activeSession);
      }
    }
  }

  addListener(event, fn) {
    this.listeners.push({ event, fn });
    return () => { this.listeners = this.listeners.filter(l => l.event !== event || l.fn !== fn); };
  }

  notifyListeners(event, data) {
    this.listeners.filter(l => l.event === event).forEach(l => l.fn(data));
  }

  setCurrentUser(user) {
    this.currentUser = user;
    AppStorage.setCurrentUser(user);
  }

  getOtherUser(session) {
    if (!session || !this.currentUser) return null;
    const otherId = session.participants.find(id => id !== this.currentUser?.id);
    return otherId ? AppStorage.getUser(otherId) : null;
  }

  createSession(name, avatarIdx) {
    const otherId = AppStorage.generateId();
    const otherUser = {
      id: otherId,
      name: name || 'User ' + (Math.floor(Math.random() * 900) + 100),
      avatar: avatarIdx || Math.floor(Math.random() * 6),
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

    this.notifyListeners('session_opened', session);
    this.sync.send({
      type: 'user_online',
      userId: this.currentUser.id,
      sessionId: session.id
    });
    return this.messages;
  }

  closeSession() {
    this.sync.leaveRoom();
    this.activeSession = null;
    AppStorage.setActiveSession(null);
  }

  sendMessage(text) {
    if (!this.activeSession || !text.trim()) return null;
    const msg = {
      id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
      sessionId: this.activeSession.id,
      senderId: this.currentUser.id,
      text: text.trim(),
      timestamp: Date.now(),
      status: 'sending',
      edited: false,
      replyTo: this.replyTo || null
    };

    AppStorage.addMessage(this.activeSession.id, msg);
    this.messages.push(msg);
    this.updateSessionLastMsg(msg.text);
    this.replyTo = null;

    this.sync.send({
      type: 'new_message',
      sessionId: this.activeSession.id,
      userId: this.currentUser.id,
      message: msg
    });

    setTimeout(() => {
      msg.status = 'sent';
      AppStorage.updateMessage(this.activeSession.id, msg.id, { status: 'sent' });
      this.notifyListeners('message_updated', msg);
      this.renderMessages();
    }, 300);

    setTimeout(() => {
      msg.status = 'delivered';
      AppStorage.updateMessage(this.activeSession.id, msg.id, { status: 'delivered' });
      this.notifyListeners('message_updated', msg);
      this.renderMessages();
    }, 800);

    setTimeout(() => {
      msg.status = 'read';
      AppStorage.updateMessage(this.activeSession.id, msg.id, { status: 'read' });
      this.notifyListeners('message_updated', msg);
      this.renderMessages();
    }, 2000);

    this.notifyListeners('new_message', msg);
    return msg;
  }

  receiveMessage(msg) {
    if (!this.activeSession || msg.sessionId !== this.activeSession.id) return;

    const exists = this.messages.find(m => m.id === msg.id);
    if (exists) return;

    msg.status = 'read';
    AppStorage.addMessage(this.activeSession.id, msg);
    this.messages.push(msg);
    this.updateSessionLastMsg(msg.text);
    this.notifyListeners('new_message', msg);
    this.renderMessages();
  }

  editMessage(msgId, newText) {
    if (!this.activeSession) return;
    const msg = this.messages.find(m => m.id === msgId);
    if (!msg) return;

    msg.text = newText;
    msg.edited = true;
    AppStorage.updateMessage(this.activeSession.id, msgId, { text: newText, edited: true });

    this.sync.send({
      type: 'message_updated',
      sessionId: this.activeSession.id,
      messageId: msgId,
      updates: { text: newText, edited: true }
    });

    this.notifyListeners('message_updated', msg);
    this.renderMessages();
  }

  deleteMessage(msgId) {
    if (!this.activeSession) return;
    AppStorage.deleteMessage(this.activeSession.id, msgId);
    this.messages = this.messages.filter(m => m.id !== msgId);
    this.selectedMessages.delete(msgId);

    this.sync.send({
      type: 'message_deleted',
      sessionId: this.activeSession.id,
      messageId: msgId
    });

    this.notifyListeners('message_deleted', msgId);
    this.renderMessages();
  }

  deleteMessages(msgIds) {
    msgIds.forEach(id => this.deleteMessage(id));
  }

  resendMessage(msgId) {
    const msg = this.messages.find(m => m.id === msgId);
    if (msg) this.sendMessage(msg.text);
  }

  forwardMessage(msgId, targetSessionId) {
    const msg = this.messages.find(m => m.id === msgId);
    if (!msg) return;

    const forwardMsg = {
      id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
      sessionId: targetSessionId,
      senderId: this.currentUser.id,
      text: msg.text,
      timestamp: Date.now(),
      status: 'sent',
      edited: false,
      forwarded: true,
      replyTo: null
    };

    AppStorage.addMessage(targetSessionId, forwardMsg);
    this.sync.send({
      type: 'new_message',
      sessionId: targetSessionId,
      userId: this.currentUser.id,
      message: forwardMsg
    });

    return forwardMsg;
  }

  updateMessageInList(msgId, updates) {
    const msg = this.messages.find(m => m.id === msgId);
    if (msg) {
      Object.assign(msg, updates);
      this.notifyListeners('message_updated', msg);
      this.renderMessages();
    }
  }

  removeMessageFromList(msgId) {
    this.messages = this.messages.filter(m => m.id !== msgId);
    this.notifyListeners('message_deleted', msgId);
    this.renderMessages();
  }

  updateSessionLastMsg(text) {
    if (!this.activeSession) return;
    this.activeSession.lastMessage = text.slice(0, 60) + (text.length > 60 ? '...' : '');
    this.activeSession.updatedAt = Date.now();
    AppStorage.saveSession(this.activeSession);
    this.notifyListeners('session_updated', this.activeSession);
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

  getShareableLink(sessionId) {
    if (!sessionId) sessionId = this.activeSession?.id;
    if (!sessionId) return '';

    if (this.sync.firebaseReady) {
      this.sync.db.ref(`rooms/${sessionId}/meta`).update({
        createdBy: this.currentUser.id,
        createdByName: this.currentUser.name,
        createdByAvatar: this.currentUser.avatar,
        createdAt: Date.now()
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

  exportChat(sessionId) {
    const msgs = AppStorage.getMessages(sessionId);
    const session = AppStorage.getSession(sessionId);
    const other = session ? this.getOtherUser(session) : null;
    const user = this.currentUser;

    let text = `=== PremiumChat Export ===\n`;
    text += `Date: ${new Date().toLocaleString()}\n`;
    text += `Participants: ${user?.name || 'Me'} & ${other?.name || 'Unknown'}\n`;
    text += `Messages: ${msgs.length}\n${'='.repeat(30)}\n\n`;

    msgs.forEach(m => {
      const sender = m.senderId === user?.id ? user.name : other?.name || 'Unknown';
      const time = new Date(m.timestamp).toLocaleString();
      text += `[${time}] ${sender}: ${m.text}${m.edited ? ' (edited)' : ''}${m.forwarded ? ' (forwarded)' : ''}\n`;
    });

    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chat-export-${sessionId.slice(-8)}-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  sendTypingIndicator() {
    if (!this.activeSession) return;
    this.sync.send({
      type: 'typing',
      userId: this.currentUser.id,
      sessionId: this.activeSession.id
    });
  }

  renderMessages() {
    this.notifyListeners('render_messages', this.messages);
  }
}

window.ChatEngine = ChatEngine;
