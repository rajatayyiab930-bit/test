class SettingsManager {
  constructor(chat, ui) {
    this.chat = chat;
    this.ui = ui;
    this.els = ui.els;
    this.init();
  }

  init() {
    this.setupAuth();
    this.setupSidebar();
    this.setupChatInput();
    this.setupChatHeader();
    this.setupSettingsModal();
    this.setupGlobal();
  }

  setupAuth() {
    this.els['avatar-grid'].addEventListener('click', (e) => {
      const opt = e.target.closest('.avatar-option');
      if (!opt) return;
      this.els['avatar-grid'].querySelectorAll('.avatar-option').forEach(o => o.classList.remove('active'));
      opt.classList.add('active');
    });

    this.els['auth-start'].addEventListener('click', () => {
      const data = this.ui.getAuthData();
      const userId = AppStorage.generateId();
      const user = {
        id: userId,
        name: data.name,
        avatar: data.avatar,
        device: data.device,
        createdAt: Date.now()
      };
      AppStorage.saveUser(userId, user);
      this.chat.setCurrentUser(user);
      this.updateSidebarUser(user);

      this.ui.showScreen('chat-screen');

      const sessions = this.chat.getSessions();
      if (sessions.length === 0) {
        this.createDefaultSession(user);
      } else {
        this.ui.renderChatList();
        if (window.innerWidth >= 768) {
          this.chat.openSession(sessions[0]);
        }
      }

      this.ui.toast('Welcome, ' + user.name + '!', 'success');
    });

    this.els['auth-name'].addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.els['auth-start'].click();
    });
  }

  createDefaultSession(user) {
    const otherName = user.device === 'mobile' ? 'Sarah Khan' : 'Ahmed Ali';
    const otherAvatar = user.device === 'mobile' ? 1 : 3;
    const session = this.chat.createSession(otherName, otherAvatar);
    this.ui.renderChatList();
    if (window.innerWidth >= 768) {
      this.chat.openSession(session);
    }
  }

  updateSidebarUser(user) {
    const gradients = [
      'var(--gradient-purple)', 'var(--gradient-pink)', 'var(--gradient-green)',
      'var(--gradient-orange)', 'var(--gradient-blue)', 'var(--gradient-indigo)'
    ];
    this.els['sb-avatar'].style.background = gradients[user.avatar % gradients.length];
    this.els['sb-avatar'].textContent = user.name.charAt(0).toUpperCase();
    this.els['sb-name'].textContent = user.name;
    this.els['sb-status'].textContent = 'Online';
  }

  setupSidebar() {
    this.els['sb-search'].addEventListener('click', () => this.ui.toggleSearch());
    this.els['sb-settings'].addEventListener('click', () => this.ui.openSettings());
    this.els['search-close'].addEventListener('click', () => {
      this.els['sidebar-search'].style.display = 'none';
      this.els['search-input'].value = '';
      this.ui.renderChatList();
    });

    this.els['search-input'].addEventListener('input', () => {
      this.ui.renderChatList();
    });

    this.els['new-chat-btn'].addEventListener('click', () => this.createNewChat());
    this.els['start-chat-btn'].addEventListener('click', () => {
      if (window.innerWidth < 768) {
        this.els['sidebar'].classList.remove('hidden');
      }
      this.createNewChat();
    });
  }

  createNewChat() {
    const name = prompt('Enter the name of the person you want to chat with:');
    if (!name || !name.trim()) return;
    const session = this.chat.createSession(name.trim());
    this.chat.openSession(session);
    this.ui.renderChatList();
    this.ui.toast('Chat with ' + name.trim() + ' created!', 'success');
  }

  setupChatInput() {
    const input = this.els['message-input'];
    const send = this.els['send-btn'];

    input.addEventListener('input', () => {
      this.ui.autoResizeInput();
      this.ui.updateCharCount();
    });

    input.addEventListener('keydown', (e) => {
      const settings = AppStorage.getSettings();
      if (e.key === 'Enter' && !e.shiftKey && settings.enterToSend !== false) {
        e.preventDefault();
        this.ui.sendCurrentMessage();
      }
    });

    send.addEventListener('click', () => this.ui.sendCurrentMessage());

    this.els['emoji-btn'].addEventListener('click', () => this.ui.toggleEmojiPicker());

    document.addEventListener('click', (e) => {
      if (!e.target.closest('#emoji-btn') && !e.target.closest('#emoji-picker')) {
        this.els['emoji-picker'].style.display = 'none';
      }
    });

    this.els['reply-close'].addEventListener('click', () => {
      this.els['reply-preview'].style.display = 'none';
      this.chat.replyTo = null;
    });
  }

  setupChatHeader() {
    this.els['chat-back'].addEventListener('click', () => {
      this.els['sidebar'].classList.remove('hidden');
    });

    this.els['ch-search-msg'].addEventListener('click', () => {
      const q = prompt('Search in chat:');
      if (q && q.trim()) {
        const results = this.chat.searchMessages(q.trim());
        if (results.length === 0) {
          this.ui.toast('No messages found', 'info');
        } else {
          this.ui.toast('Found ' + results.length + ' messages', 'success');
        }
      }
    });

    this.els['ch-menu'].addEventListener('click', (e) => {
      const menu = this.els['chat-menu-dropdown'];
      menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
      const hide = (e2) => { menu.style.display = 'none'; document.removeEventListener('click', hide); };
      setTimeout(() => document.addEventListener('click', hide), 100);
    });

    this.els['chat-menu-dropdown'].querySelectorAll('.drop-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        this.els['chat-menu-dropdown'].style.display = 'none';
        switch (action) {
          case 'clear-chat':
            if (confirm('Clear all messages in this chat?')) {
              AppStorage.saveMessages(this.chat.activeSession.id, []);
              this.chat.messages = [];
              this.ui.renderMessageList();
              this.ui.toast('Chat cleared', 'success');
            }
            break;
          case 'export-chat':
            this.chat.exportChat(this.chat.activeSession.id);
            this.ui.toast('Chat exported', 'success');
            break;
          case 'archive-chat':
            if (this.chat.activeSession) {
              this.chat.activeSession.archived = true;
              AppStorage.saveSession(this.chat.activeSession);
              this.ui.renderChatList();
              this.els['no-chat'].style.display = 'flex';
              this.els['active-chat'].style.display = 'none';
              this.ui.toast('Chat archived', 'success');
            }
            break;
          case 'delete-chat':
            if (confirm('Delete this entire chat? This cannot be undone!')) {
              AppStorage.deleteSession(this.chat.activeSession.id);
              this.chat.activeSession = null;
              this.chat.messages = [];
              this.ui.renderChatList();
              this.els['no-chat'].style.display = 'flex';
              this.els['active-chat'].style.display = 'none';
              this.ui.toast('Chat deleted', 'success');
            }
            break;
        }
      });
    });
  }

  setupSettingsModal() {
    this.els['settings-close'].addEventListener('click', () => {
      this.els['settings-modal'].style.display = 'none';
    });

    this.els['settings-modal'].addEventListener('click', (e) => {
      if (e.target === this.els['settings-modal']) {
        this.els['settings-modal'].style.display = 'none';
      }
    });

    this.els['settings-change-name'].addEventListener('click', () => {
      const newName = prompt('Enter your new name:', this.chat.currentUser?.name || '');
      if (newName && newName.trim()) {
        this.chat.currentUser.name = newName.trim();
        AppStorage.saveUser(this.chat.currentUser.id, this.chat.currentUser);
        this.ui.els['settings-name-display'].textContent = newName.trim();
        this.updateSidebarUser(this.chat.currentUser);
        this.ui.toast('Name updated to: ' + newName.trim(), 'success');
      }
    });

    this.els['setting-enter-send'].addEventListener('change', () => {
      const settings = AppStorage.getSettings();
      settings.enterToSend = this.els['setting-enter-send'].checked;
      AppStorage.saveSettings(settings);
    });

    this.els['setting-sound'].addEventListener('change', () => {
      const settings = AppStorage.getSettings();
      settings.sound = this.els['setting-sound'].checked;
      AppStorage.saveSettings(settings);
    });

    this.els['settings-export'].addEventListener('click', () => {
      const data = AppStorage.exportAll();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'premium-chat-backup-' + Date.now() + '.json';
      a.click();
      URL.revokeObjectURL(url);
      this.ui.toast('Data exported', 'success');
    });

    this.els['settings-clear'].addEventListener('click', () => {
      if (confirm('Clear ALL data? This will delete all chats and settings!')) {
        AppStorage.clearAll();
        location.reload();
      }
    });
  }

  setupGlobal() {
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.context-menu')) {
        this.els['msg-context-menu'].style.display = 'none';
      }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.els['settings-modal'].style.display = 'none';
        this.els['msg-context-menu'].style.display = 'none';
        this.els['chat-menu-dropdown'].style.display = 'none';
        this.els['emoji-picker'].style.display = 'none';
        if (this.chat.editingMessage) {
          this.chat.editingMessage = null;
          this.ui.setInputText('');
        }
        if (this.chat.selectedMessages.size > 0) {
          this.chat.selectedMessages.clear();
          this.ui.renderMessageList();
        }
      }

      if (e.key === 'Backspace' && e.ctrlKey && document.activeElement !== this.els['message-input']) {
        if (this.chat.activeSession && confirm('Delete current chat?')) {
          this.els['chat-menu-dropdown'].querySelector('[data-action="delete-chat"]')?.click();
        }
      }
    });

    // Prevent zoom on double tap
    let lastTouch = 0;
    document.addEventListener('touchstart', (e) => {
      const now = Date.now();
      if (now - lastTouch <= 300) e.preventDefault();
      lastTouch = now;
    }, { passive: false });

    // Handle resize for responsive
    window.addEventListener('resize', () => {
      if (window.innerWidth >= 768) {
        this.els['sidebar'].classList.remove('hidden');
      }
    });
  }
}

window.SettingsManager = SettingsManager;
