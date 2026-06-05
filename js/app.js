(function() {
  'use strict';

  if (window.__chatInitialized) return;
  window.__chatInitialized = true;

  const chat = new ChatEngine();
  const ui = new UIManager(chat);
  const settings = new SettingsManager(chat, ui);

  window.chat = chat;
  window.ui = ui;
  window.settings = settings;

  const savedUser = AppStorage.getCurrentUser();
  const savedSession = AppStorage.getActiveSession();

  if (savedUser) {
    chat.setCurrentUser(savedUser);
    ui.animateSplash(() => {
      ui.showScreen('chat-screen');
      settings.updateSidebarUser(savedUser);
      ui.renderChatList();

      if (savedSession) {
        const session = AppStorage.getSession(savedSession);
        if (session) {
          chat.openSession(session);
          if (window.innerWidth >= 768) {
            ui.renderChatList();
          } else {
            ui.els['sidebar'].classList.remove('hidden');
          }
          return;
        }
      }

      const sessions = chat.getSessions();
      if (sessions.length > 0) {
        if (window.innerWidth >= 768) {
          chat.openSession(sessions[0]);
        }
      } else {
        settings.createDefaultSession(savedUser);
      }
      ui.renderChatList();
    });
  } else {
    ui.animateSplash(() => {
      ui.showScreen('auth-screen');
      const names = ['Ahmed', 'Sara', 'Ali', 'Fatima', 'Hassan', 'Zainab', 'Bilal', 'Ayesha'];
      const randomName = names[Math.floor(Math.random() * names.length)];
      ui.els['auth-name'].value = randomName;
    });
  }

  console.log('PremiumChat initialized v1.0.0');
})();
