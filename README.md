# Premium Real-Time Chat Application

A luxury premium real-time chat application with glassmorphism UI, smooth animations, and native Android-style interface.

## Features

- **Splash Screen** - Animated loading with particle effects
- **Authentication** - Name, avatar, and device mode selection
- **Real-Time Chat** - Cross-tab messaging via BroadcastChannel API
- **Message Actions** - Copy, Edit, Resend, Forward, Delete
- **Chat History** - Auto-saved with search and export
- **Multiple Sessions** - Create and manage multiple chats
- **Responsive Design** - Mobile-first with desktop optimized layout
- **Settings** - Profile management, sound toggles, data export
- **Premium UI** - Glassmorphism, gradients, smooth transitions, SVG icons

## Tech Stack

- HTML5
- CSS3 (Glassmorphism, Flexbox, Grid, Animations)
- JavaScript ES6+
- BroadcastChannel API (Real-time cross-tab)
- LocalStorage (Data persistence)
- SVG Icons

## How to Use

1. Open `index.html` in two browser tabs/windows
2. Set one as "Mobile" and the other as "Desktop"
3. Start chatting in real-time!

## Installation

No build tools required. Simply open `index.html` in any modern browser.

```bash
git clone https://github.com/rajatayyiab930-bit/test.git
cd premium-chat
open index.html
```

## Project Structure

```
premium-chat/
├── index.html          # Main application
├── css/
│   ├── main.css        # Core styles
│   ├── responsive.css  # Responsive design
│   └── animations.css  # Keyframe animations
├── js/
│   ├── app.js          # Application entry point
│   ├── storage.js      # LocalStorage management
│   ├── chat.js         # Chat engine (real-time logic)
│   ├── ui.js           # UI rendering and events
│   └── settings.js     # Settings and configuration
├── assets/
│   ├── icons/          # SVG icons
│   └── images/         # Images
├── data/               # Data storage
├── docs/               # Documentation
└── README.md
```

## Live Demo

[View Live](https://rajatayyiab930-bit.github.io/test)

## License

MIT
