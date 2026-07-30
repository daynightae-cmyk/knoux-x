# ═══════════════════════════════════════════════════════════════════════
# KNOUX Player X™ Ultimate
## Next-Generation Media Player with OpenRouter AI
# ═══════════════════════════════════════════════════════════════════════

![KNOUX Player X](assets/logo.png)

[![Version](https://img.shields.io/badge/version-2.0.0-cyan)](https://knoux.dev)
[![Electron](https://img.shields.io/badge/Electron-28.0.0-9feaf9)](https://electronjs.org)
[![React](https://img.shields.io/badge/React-18.2.0-61dafb)](https://reactjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3.0-3178c6)](https://typescriptlang.org)
[![OpenRouter](https://img.shields.io/badge/OpenRouter-AI-ff00f0)](https://openrouter.ai)
[![License](https://img.shields.io/badge/License-MIT-purple)](LICENSE)

---

## ✨ Features

### 🎬 Media Playback
- **Video Formats**: MP4, MKV, AVI, MOV, WMV, FLV, WebM, and more
- **Audio Formats**: MP3, WAV, FLAC, AAC, OGG, M4A, and more
- **Hardware Acceleration**: GPU-accelerated decoding for smooth playback
- **Advanced Controls**: Playback speed, loop, shuffle, A-B repeat
- **4K HDR Support**: High-quality video rendering

### 🔊 Audio Enhancement
- **Neural DSP Processing**: Real-time digital signal processing
- **10-Band Equalizer**: 18 presets + custom settings
- **Audio Effects**: Bass boost, surround sound, night mode, voice enhancement
- **Visualizer**: Real-time audio visualization with WebGL

### 📝 Subtitles
- **Multiple Formats**: SRT, VTT, ASS, SSA
- **AI Sync**: Automatic subtitle synchronization using AI
- **AI Translation**: Translate subtitles to any language
- **Custom Styling**: Font, size, color, position

### 🤖 OpenRouter AI Integration (FREE!)
- **Multiple AI Models**: Llama 3.2, Gemma 2, Phi 3.5, Nemotron 70B, DeepSeek, Qwen 2, Zephyr, MythoMist
- **Smart Recommendations**: Get personalized media suggestions
- **Natural Language**: Control the player with voice/text commands
- **Media Analysis**: AI-powered content analysis
- **Playlist Generation**: Create playlists by mood or theme
- **Streaming Responses**: Real-time AI chat with typing indicators
- **100% Free**: No paid API required - just get a free key at [openrouter.ai](https://openrouter.ai)

### 🎨 Stunning Neon UI
- **Glassmorphism Design**: Futuristic translucent interfaces
- **Animated Splash Screen**: Eye-catching startup experience
- **Neon Glow Effects**: Cyan, Magenta, Purple, and more
- **Dark Theme**: Easy on the eyes with customizable accent colors
- **Smooth Animations**: Powered by Framer Motion
- **Responsive Layout**: Works on all screen sizes

---

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- npm or yarn

### Installation

```bash
# Clone the repository
git clone https://github.com/knoux/player-x.git
cd player-x

# Install dependencies
npm install

# Start development server
npm start
```

### Setting up AI (Optional but Recommended)

1. Visit [openrouter.ai](https://openrouter.ai) and create a free account
2. Get your free API key
3. Open KNOUX Player X settings
4. Paste your API key in the AI settings
5. Choose your preferred AI model
6. Enjoy AI-powered features!

### Building

```bash
# Build for current platform
npm run make

# Build for Windows
npm run make:win

# Build for macOS
npm run make:mac

# Build for Linux
npm run make:linux
```

---

## 🛠️ Tech Stack

| Category | Technology |
|----------|------------|
| Framework | Electron 28 |
| Frontend | React 18 + TypeScript |
| Styling | CSS3 + Glassmorphism + Neon Effects |
| State Management | Zustand |
| Animations | Framer Motion |
| Icons | Lucide React |
| AI | OpenRouter API (Free Tier) |
| Build | Vite + Webpack |

---

## 📁 Project Structure

```
KNOUX/
├── electron/              # Electron main process
│   ├── main.ts           # Main entry point
│   ├── preload.ts        # Preload script
│   ├── ipc/              # IPC handlers
│   └── menu/             # Application menus
├── src/
│   ├── components/       # React components
│   │   ├── neon/        # Neon UI components (Card, Text, Input, Progress, Badge)
│   │   └── layout/      # Layout components
│   ├── core/            # Core systems
│   │   ├── orchestrator/# System orchestrator
│   │   ├── dsp/         # DSP system
│   │   ├── security/    # Security manager
│   │   └── services/    # Business services
│   │       └── ai/      # OpenRouter AI Service
│   ├── features/        # Feature modules
│   │   ├── player/      # Player view
│   │   ├── library/     # Library view
│   │   ├── settings/    # Settings view
│   │   └── ai/          # AI assistant (Enhanced)
│   ├── store/           # Zustand stores
│   ├── styles/          # Global styles + Splash styles
│   ├── App.tsx          # Main app component
│   └── main.tsx         # React entry point
├── assets/              # Static assets (Logo, icons)
├── native/              # Native modules
└── docs/                # Documentation
```

---

## 🎮 Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Space` | Play/Pause |
| `← / →` | Seek backward/forward 10s |
| `↑ / ↓` | Volume up/down |
| `M` | Mute toggle |
| `F` | Fullscreen toggle |
| `L` | Loop toggle |
| `S` | Shuffle toggle / Screenshot |
| `V` | Toggle subtitles |
| `Ctrl + O` | Open file |
| `Ctrl + Shift + O` | Open folder |
| `Ctrl + L` | Show library |
| `F11` | Fullscreen mode |

---

## 🌟 What's New in v2.0.0 Ultimate

### 🎨 Enhanced Visual Design
- **New Animated Splash Screen**: Floating particles, glowing orbs, rotating rings
- **Stunning Logo**: AI-generated neon logo with sound wave aesthetics
- **Enhanced Neon Components**: Card, Text, Input, Progress, Badge components
- **Glassmorphism Effects**: Advanced translucent UI elements

### 🤖 OpenRouter AI Integration
- **Replaced Gemini**: Now uses free OpenRouter API
- **8+ AI Models**: Choose from Llama, Gemma, Phi, Nemotron, DeepSeek, Qwen, Zephyr, MythoMist
- **Streaming Chat**: Real-time AI responses with typing indicators
- **Smart Settings**: Easy API key configuration and model selection

### ⚡ Performance Improvements
- **Optimized Rendering**: Better FPS during video playback
- **Memory Management**: Reduced memory footprint
- **Faster Startup**: Improved initialization speed

---

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- [Electron](https://electronjs.org) - Cross-platform desktop apps
- [React](https://reactjs.org) - UI library
- [Framer Motion](https://framer.com/motion) - Animations
- [OpenRouter](https://openrouter.ai) - Free AI API
- [Llama](https://ai.meta.com/llama/) - Meta's AI model
- [Google Gemma](https://ai.google.dev/gemma) - Open models
- [Microsoft Phi](https://azure.microsoft.com/en-us/products/phi) - Microsoft's model

---

<p align="center">
  <strong>Made with 💜 by the KNOUX Development Team</strong>
</p>

<p align="center">
  <a href="https://knoux.dev">Website</a> •
  <a href="https://docs.knoux.dev">Documentation</a> •
  <a href="https://github.com/knoux/player-x">GitHub</a>
</p>
