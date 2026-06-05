class AppStorage {
  static KEYS = {
    USERS: 'pc_users',
    MESSAGES: 'pc_messages_',
    SESSIONS: 'pc_sessions',
    SETTINGS: 'pc_settings',
    CURRENT_USER: 'pc_current_user',
    ACTIVE_SESSION: 'pc_active_session'
  };

  static get(key, def = null) {
    try {
      const val = localStorage.getItem(key);
      return val ? JSON.parse(val) : def;
    } catch { return def; }
  }

  static set(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; }
    catch (e) {
      if (e.name === 'QuotaExceededError' || e.code === 22) {
        console.warn('[Storage] localStorage quota exceeded — data may not persist');
      }
      return false;
    }
  }

  static remove(key) {
    try { localStorage.removeItem(key); return true; }
    catch { return false; }
  }

  static getUsers() { return this.get(this.KEYS.USERS, {}); }
  static saveUser(id, data) {
    const users = this.getUsers();
    users[id] = { ...users[id], ...data, lastSeen: Date.now() };
    return this.set(this.KEYS.USERS, users);
  }
  static getUser(id) { return this.getUsers()[id] || null; }

  static getSessions() { return this.get(this.KEYS.SESSIONS, []); }
  static saveSessions(sessions) { return this.set(this.KEYS.SESSIONS, sessions); }
  static getSession(id) { return this.getSessions().find(s => s.id === id) || null; }
  static saveSession(session) {
    const sessions = this.getSessions();
    const idx = sessions.findIndex(s => s.id === session.id);
    if (idx >= 0) sessions[idx] = session;
    else sessions.unshift(session);
    return this.saveSessions(sessions);
  }
  static deleteSession(id) {
    const sessions = this.getSessions().filter(s => s.id !== id);
    this.remove(this.KEYS.MESSAGES + id);
    return this.saveSessions(sessions);
  }

  static getMessages(sessionId) { return this.get(this.KEYS.MESSAGES + sessionId, []); }
  static saveMessages(sessionId, msgs) { return this.set(this.KEYS.MESSAGES + sessionId, msgs); }
  static addMessage(sessionId, msg) {
    const msgs = this.getMessages(sessionId);
    msg.id = msg.id || 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    msg.timestamp = msg.timestamp || Date.now();
    msgs.push(msg);
    this.saveMessages(sessionId, msgs);
    return msg;
  }
  static updateMessage(sessionId, msgId, updates) {
    const msgs = this.getMessages(sessionId);
    const idx = msgs.findIndex(m => m.id === msgId);
    if (idx >= 0) { msgs[idx] = { ...msgs[idx], ...updates }; this.saveMessages(sessionId, msgs); return msgs[idx]; }
    return null;
  }
  static deleteMessage(sessionId, msgId) {
    let msgs = this.getMessages(sessionId);
    msgs = msgs.filter(m => m.id !== msgId);
    this.saveMessages(sessionId, msgs);
  }

  static getSettings() { return this.get(this.KEYS.SETTINGS, { enterToSend: true, sound: true }); }
  static saveSettings(s) { return this.set(this.KEYS.SETTINGS, s); }

  static getCurrentUser() { return this.get(this.KEYS.CURRENT_USER); }
  static setCurrentUser(u) { return this.set(this.KEYS.CURRENT_USER, u); }

  static getActiveSession() { return this.get(this.KEYS.ACTIVE_SESSION); }
  static setActiveSession(id) { return this.set(this.KEYS.ACTIVE_SESSION, id); }

  static generateId() { return 'id_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10); }

  static exportAll() {
    const keys = Object.keys(localStorage).filter(k => k.startsWith('pc_'));
    const data = {};
    keys.forEach(k => { data[k] = this.get(k); });
    return data;
  }

  static importAll(data) {
    Object.entries(data).forEach(([k, v]) => this.set(k, v));
  }

  static clearAll() {
    const keys = Object.keys(localStorage).filter(k => k.startsWith('pc_'));
    keys.forEach(k => this.remove(k));
  }
}

window.AppStorage = AppStorage;
