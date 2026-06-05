class UIManager {
  constructor(chat) {
    this.chat = chat;
    this.els = {};
    this.cacheElements();
    this.setupListeners();
    this.setupEmojiPicker();
  }

  cacheElements() {
    const ids = [
      'splash-screen', 'auth-screen', 'chat-screen',
      'splash-progress', 'splash-percent', 'splash-logo',
      'auth-name', 'avatar-grid', 'auth-start',
      'sidebar', 'sb-avatar', 'sb-name', 'sb-status',
      'sb-search', 'sb-settings', 'sidebar-search', 'search-input', 'search-close',
      'chat-list', 'new-chat-btn', 'no-chat', 'active-chat',
      'chat-back', 'cu-avatar', 'cu-name', 'cu-status',
      'ch-search-msg', 'ch-menu',
      'messages-container', 'messages-wrapper', 'messages-list',
      'reply-preview', 'reply-text', 'reply-close',
      'message-input', 'send-btn', 'emoji-btn', 'emoji-picker', 'char-counter',
      'msg-context-menu', 'chat-menu-dropdown',
      'settings-modal', 'settings-close',
      'settings-avatar', 'settings-name-display', 'settings-change-name',
      'setting-enter-send', 'setting-sound',
      'settings-export', 'settings-clear',
      'toast-container', 'start-chat-btn'
    ];
    ids.forEach(id => { this.els[id] = document.getElementById(id); });
  }

  setupListeners() {
    this.chat.addListener('new_message', () => this.scrollToBottom());
    this.chat.addListener('message_updated', () => this.scrollToBottom());
    this.chat.addListener('render_messages', () => this.renderMessageList());
    this.chat.addListener('session_opened', (s) => this.updateChatHeader(s));
    this.chat.addListener('session_updated', () => this.renderChatList());
    this.chat.addListener('user_status', (d) => this.updateUserStatus(d));
    this.chat.addListener('typing', () => this.showTyping());
  }

  // ===== SPLASH =====
  animateSplash(callback) {
    let progress = 0;
    const interval = setInterval(() => {
      progress += Math.random() * 8 + 2;
      if (progress > 100) progress = 100;
      this.els['splash-progress'].style.width = progress + '%';
      this.els['splash-percent'].textContent = Math.round(progress) + '%';
      if (progress >= 100) {
        clearInterval(interval);
        setTimeout(callback, 400);
      }
    }, 150);
  }

  showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const screen = document.getElementById(id);
    if (screen) screen.classList.add('active');
  }

  // ===== AUTH =====
  getAuthData() {
    const name = this.els['auth-name'].value.trim() || 'User';
    const avatar = parseInt(document.querySelector('.avatar-option.active')?.dataset.avatar || '0');
    const device = document.querySelector('.device-btn.active')?.dataset.device || 'mobile';
    return { name, avatar, device };
  }

  // ===== CHAT LIST =====
  renderChatList() {
    const sessions = this.chat.getSessions().filter(s => !s.archived);
    const search = this.els['search-input']?.value?.trim();
    const filtered = search ? this.chat.getSessionsBySearch(search) : sessions;

    if (filtered.length === 0) {
      this.els['chat-list'].innerHTML = `
        <div style="text-align:center;padding:40px 20px;color:var(--text-muted);font-size:13px;">
          ${search ? 'No chats found' : 'No chats yet. Start a new conversation!'}
        </div>`;
      return;
    }

    const gradients = [
      'var(--gradient-purple)', 'var(--gradient-pink)', 'var(--gradient-green)',
      'var(--gradient-orange)', 'var(--gradient-blue)', 'var(--gradient-indigo)'
    ];
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

    this.els['chat-list'].innerHTML = filtered.map(s => {
      const other = this.chat.getOtherUser(s);
      if (!other) return '';
      const isActive = s.id === this.chat.activeSession?.id;
      const time = s.updatedAt ? this.formatTime(s.updatedAt) : '';
      const avatarLetter = other.name.charAt(0).toUpperCase();
      const bg = gradients[other.avatar % gradients.length];

      return `
        <div class="chat-item ${isActive ? 'active' : ''}" data-session="${s.id}">
          <div class="ci-avatar" style="background:${bg}">${avatarLetter}</div>
          <div class="ci-info">
            <div class="ci-top">
              <span class="ci-name">${this.escapeHtml(other.name)}</span>
              <span class="ci-time">${time}</span>
            </div>
            <div class="ci-bottom">
              <span class="ci-preview">${this.escapeHtml(s.lastMessage || 'No messages yet')}</span>
              ${s.unread > 0 ? `<span class="ci-badge">${s.unread}</span>` : ''}
            </div>
          </div>
        </div>`;
    }).join('');

    this.els['chat-list'].querySelectorAll('.chat-item').forEach(el => {
      el.addEventListener('click', () => {
        const sid = el.dataset.session;
        const session = AppStorage.getSession(sid);
        if (session) {
          this.chat.openSession(session);
          if (window.innerWidth < 768) {
            this.els['sidebar'].classList.add('hidden');
          }
        }
      });
    });
  }

  // ===== CHAT HEADER =====
  updateChatHeader(session) {
    const other = this.chat.getOtherUser(session);
    if (!other) return;

    const gradients = [
      'var(--gradient-purple)', 'var(--gradient-pink)', 'var(--gradient-green)',
      'var(--gradient-orange)', 'var(--gradient-blue)', 'var(--gradient-indigo)'
    ];
    const bg = gradients[other.avatar % gradients.length];
    const letter = other.name.charAt(0).toUpperCase();

    this.els['cu-avatar'].style.background = bg;
    this.els['cu-avatar'].textContent = letter;
    this.els['cu-name'].textContent = this.escapeHtml(other.name);

    this.els['no-chat'].style.display = 'none';
    this.els['active-chat'].style.display = 'flex';
    this.els['message-input'].focus();
    this.renderMessageList();
  }

  // ===== MESSAGES =====
  renderMessageList() {
    const list = this.els['messages-list'];
    const msgs = this.chat.messages;
    if (!msgs || msgs.length === 0) {
      list.innerHTML = `
        <div style="text-align:center;padding:40px;color:var(--text-muted);font-size:13px;">
          No messages yet. Say hello!
        </div>`;
      return;
    }

    const gradients = [
      'var(--gradient-purple)', 'var(--gradient-pink)', 'var(--gradient-green)',
      'var(--gradient-orange)', 'var(--gradient-blue)', 'var(--gradient-indigo)'
    ];

    list.innerHTML = msgs.map(m => {
      const isSent = m.senderId === this.chat.currentUser?.id;
      const time = this.formatTime(m.timestamp);
      const isSelected = this.chat.selectedMessages.has(m.id);
      const isEditing = this.chat.editingMessage === m.id;

      let statusHtml = '';
      if (isSent) {
        const statusIcons = {
          sending: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="31.4" stroke-dashoffset="10"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite"/></circle></svg>',
          sent: '<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" fill="currentColor"/></svg>',
          delivered: '<svg viewBox="0 0 24 24"><path d="M18 7l-1.41-1.41-6.34 6.34 1.41 1.41L18 7zm4.24-1.41L11.66 16.17 7.48 12l-1.41 1.41L11.66 19 23 5.59l-.76-.76z" fill="currentColor"/></svg>',
          read: '<svg viewBox="0 0 24 24"><path d="M18 7l-1.41-1.41-6.34 6.34 1.41 1.41L18 7zm4.24-1.41L11.66 16.17 7.48 12l-1.41 1.41L11.66 19 23 5.59l-.76-.76z" fill="#60a5fa"/></svg>'
        };
        statusHtml = `<span class="message-status ${m.status}">${statusIcons[m.status] || statusIcons.sent}</span>`;
      }

      const replyHtml = m.replyTo ? `
        <div style="font-size:11px;color:rgba(255,255,255,0.4);border-left:2px solid var(--accent-1);padding-left:8px;margin-bottom:4px;">
          ${this.escapeHtml(m.replyTo.text?.slice(0, 40))}
        </div>` : '';

      const editedHtml = m.edited ? ' <span style="font-size:10px;opacity:0.5">(edited)</span>' : '';
      const forwardedHtml = m.forwarded ? ' <span style="font-size:10px;opacity:0.5">↗</span>' : '';

      return `
        <div class="message ${isSent ? 'sent' : 'received'} ${isSelected ? 'selected' : ''} ${isEditing ? 'editing' : ''}"
             data-msg-id="${m.id}">
          <div class="message-bubble">
            ${forwardedHtml}
            ${replyHtml}
            <div class="message-text">${this.escapeHtml(m.text)}</div>
            <div class="message-time">
              ${time}${editedHtml}
              ${statusHtml}
            </div>
          </div>
        </div>`;
    }).join('');

    this.setupMessageListeners();
    this.scrollToBottom();
  }

  setupMessageListeners() {
    this.els['messages-list'].querySelectorAll('.message').forEach(el => {
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.showContextMenu(e, el.dataset.msgId);
      });
      el.addEventListener('click', (e) => {
        if (this.chat.selectedMessages.size > 0) {
          const id = el.dataset.msgId;
          if (this.chat.selectedMessages.has(id)) this.chat.selectedMessages.delete(id);
          else this.chat.selectedMessages.add(id);
          el.classList.toggle('selected');
        }
      });
    });
  }

  showContextMenu(e, msgId) {
    const menu = this.els['msg-context-menu'];
    const msg = this.chat.messages.find(m => m.id === msgId);
    if (!msg) return;

    const isSent = msg.senderId === this.chat.currentUser?.id;
    menu.style.display = 'block';
    menu.style.left = Math.min(e.clientX, window.innerWidth - 180) + 'px';
    menu.style.top = Math.min(e.clientY, window.innerHeight - 220) + 'px';

    menu.querySelectorAll('.ctx-item').forEach(btn => {
      const action = btn.dataset.action;
      btn.style.display = 'flex';
      btn.onclick = () => {
        menu.style.display = 'none';
        switch (action) {
          case 'copy': this.copyMessage(msg); break;
          case 'edit': if (isSent) this.startEdit(msg); else this.toast('Can only edit your messages', 'error'); break;
          case 'resend': if (isSent) this.chat.resendMessage(msgId); else this.toast('Can only resend your messages', 'error'); break;
          case 'forward': this.forwardMessage(msg); break;
          case 'delete': this.deleteMessage(msgId); break;
        }
      };
    });

    const hide = (e2) => { menu.style.display = 'none'; document.removeEventListener('click', hide); };
    setTimeout(() => document.addEventListener('click', hide), 100);
  }

  copyMessage(msg) {
    navigator.clipboard.writeText(msg.text).then(() => {
      this.toast('Message copied', 'success');
    }).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = msg.text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      this.toast('Message copied', 'success');
    });
  }

  startEdit(msg) {
    this.chat.editingMessage = msg.id;
    this.els['message-input'].value = msg.text;
    this.els['message-input'].focus();
    this.els['message-input'].setSelectionRange(msg.text.length, msg.text.length);
    this.autoResizeInput();
    this.renderMessageList();
    this.toast('Editing message', 'info');
  }

  forwardMessage(msg) {
    const sessions = this.chat.getSessions().filter(s => s.id !== this.chat.activeSession?.id);
    if (sessions.length === 0) {
      this.toast('No other chats to forward to', 'error');
      return;
    }
    const names = sessions.map(s => {
      const other = this.chat.getOtherUser(s);
      return other?.name || 'Unknown';
    });
    const choice = prompt('Forward to:\n' + names.map((n, i) => (i+1) + '. ' + n).join('\n') + '\n\nEnter number:');
    const idx = parseInt(choice) - 1;
    if (idx >= 0 && idx < sessions.length) {
      this.chat.forwardMessage(msg.id, sessions[idx].id);
      this.toast('Message forwarded', 'success');
    }
  }

  deleteMessage(msgId) {
    if (this.chat.selectedMessages.size > 0) {
      const ids = [...this.chat.selectedMessages];
      if (confirm('Delete ' + ids.length + ' messages?')) {
        this.chat.deleteMessages(ids);
        this.chat.selectedMessages.clear();
        this.toast('Messages deleted', 'success');
      }
    } else {
      if (confirm('Delete this message?')) {
        this.chat.deleteMessage(msgId);
        this.toast('Message deleted', 'success');
      }
    }
  }

  // ===== INPUT =====
  getInputText() { return this.els['message-input'].value; }
  setInputText(t) { this.els['message-input'].value = t; this.autoResizeInput(); this.updateCharCount(); }

  autoResizeInput() {
    const el = this.els['message-input'];
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }

  updateCharCount() {
    this.els['char-counter'].textContent = this.els['message-input'].value.length;
  }

  sendCurrentMessage() {
    const text = this.getInputText().trim();
    if (!text) return;

    if (this.chat.editingMessage) {
      this.chat.editMessage(this.chat.editingMessage, text);
      this.chat.editingMessage = null;
    } else {
      this.chat.sendMessage(text);
    }

    this.setInputText('');
    this.els['reply-preview'].style.display = 'none';
    this.chat.replyTo = null;
  }

  // ===== REPLY =====
  setReply(msg) {
    this.chat.replyTo = msg;
    this.els['reply-text'].textContent = msg.text.slice(0, 80) + (msg.text.length > 80 ? '...' : '');
    this.els['reply-preview'].style.display = 'flex';
    this.els['message-input'].focus();
  }

  // ===== EMOJI =====
  setupEmojiPicker() {
    const emojis = ['😀','😁','😂','🤣','😃','😄','😅','😆','😉','😊','😋','😎','😍','🥰','😘','😜','😝','🤑','🤗','🤩',
      '👍','👎','👊','✊','🤛','🤜','👏','🙌','🤝','💪','✌️','🤞','🖕','💅','👀','👁️','🧠','❤️','💔','💖',
      '🔥','⭐','✨','💯','🎉','🎊','🎈','🎁','💎','🚀','💰','💵','💸','📱','💻','⌚','🎮','🕹️','📸','💡',
      '🙏','👋','🤝','💪','✋','👌','🤘','💀','☠️','👽','🤖','🎃','😈','👿','👹','👺','💩','👻','💋','👤'];

    this.els['emoji-picker'].innerHTML = emojis.map(e =>
      `<span class="emoji-item">${e}</span>`
    ).join('');

    this.els['emoji-picker'].querySelectorAll('.emoji-item').forEach(el => {
      el.addEventListener('click', () => {
        const input = this.els['message-input'];
        const start = input.selectionStart;
        const val = input.value;
        input.value = val.slice(0, start) + el.textContent + val.slice(start);
        input.selectionStart = input.selectionEnd = start + el.textContent.length;
        input.focus();
        this.autoResizeInput();
        this.updateCharCount();
      });
    });
  }

  toggleEmojiPicker() {
    this.els['emoji-picker'].style.display =
      this.els['emoji-picker'].style.display === 'none' ? 'grid' : 'none';
  }

  // ===== SEARCH =====
  toggleSearch() {
    const el = this.els['sidebar-search'];
    el.style.display = el.style.display === 'none' ? 'block' : 'none';
    if (el.style.display === 'block') this.els['search-input'].focus();
  }

  // ===== SETTINGS =====
  openSettings() {
    const user = this.chat.currentUser;
    if (!user) return;
    const gradients = [
      'var(--gradient-purple)', 'var(--gradient-pink)', 'var(--gradient-green)',
      'var(--gradient-orange)', 'var(--gradient-blue)', 'var(--gradient-indigo)'
    ];
    this.els['settings-avatar'].style.background = gradients[user.avatar % gradients.length];
    this.els['settings-avatar'].textContent = user.name.charAt(0).toUpperCase();
    this.els['settings-name-display'].textContent = user.name;
    this.els['settings-modal'].style.display = 'flex';

    const settings = AppStorage.getSettings();
    this.els['setting-enter-send'].checked = settings.enterToSend !== false;
    this.els['setting-sound'].checked = settings.sound !== false;
  }

  // ===== TOAST =====
  toast(msg, type = 'info') {
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = msg;
    this.els['toast-container'].appendChild(el);
    setTimeout(() => {
      el.style.animation = 'toastOut 0.3s ease forwards';
      setTimeout(() => el.remove(), 300);
    }, 2500);
  }

  // ===== UTILITIES =====
  escapeHtml(text) {
    const d = document.createElement('div');
    d.textContent = text;
    return d.innerHTML;
  }

  formatTime(ts) {
    const d = new Date(ts);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  scrollToBottom() {
    requestAnimationFrame(() => {
      this.els['messages-container'].scrollTop = this.els['messages-container'].scrollHeight;
    });
  }

  showTyping() {
    // Could show typing indicator in header
  }

  updateUserStatus(data) {
    if (data.sessionId === this.chat.activeSession?.id) {
      this.els['cu-status'].innerHTML = `<span class="status-dot"></span> Online`;
    }
  }
}

window.UIManager = UIManager;
