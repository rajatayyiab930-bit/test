import { AppStorage } from './storage.js';
import { ChatEngine } from './chat.js';
import { UIManager } from './ui.js';
import { SettingsManager } from './settings.js';

if (!window.__chatInitialized) {
  window.__chatInitialized = true;

  const chat = new ChatEngine();
  const ui = new UIManager(chat);
  const settings = new SettingsManager(chat, ui);

  window.chat = chat;
  window.ui = ui;
  window.settings = settings;

  const savedUser = AppStorage.getCurrentUser();
  const savedSessionId = AppStorage.getActiveSession();
  const joinParam = new URLSearchParams(window.location.search).get('join');
  window._pendingJoin = joinParam;

  function afterAuth() {
    ui.animateSplash(() => {
      ui.showScreen('chat-screen');
      settings.updateSidebarUser(savedUser);
      ui.renderChatList();

      if (joinParam) {
        chat.joinSessionByLink(joinParam);
        if (window.innerWidth < 768) {
          ui.els['sidebar'].classList.add('hidden');
        }
        return;
      }

      if (savedSessionId) {
        const session = AppStorage.getSession(savedSessionId);
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
  }

  if (savedUser) {
    chat.setCurrentUser(savedUser);
    afterAuth();
  } else {
    ui.animateSplash(() => {
      ui.showScreen('auth-screen');
      const names = ['Ahmed', 'Sara', 'Ali', 'Fatima', 'Hassan', 'Zainab', 'Bilal', 'Ayesha'];
      const randomName = names[Math.floor(Math.random() * names.length)];
      ui.els['auth-name'].value = randomName;
    });
  }

  console.log('PremiumChat v3.0.0 — Firebase Realtime Sync');
}
