![Cardinal Banner](src/assets/cardinal_banner.png)

# Cardinal

[![Version](https://img.shields.io/badge/version-2.0.0-red.svg)](https://github.com/Beardicuss/Softcurse-Cardinal)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Build Status](https://img.shields.io/badge/build-passing-brightgreen.svg)]()
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)]()

**Cardinal is an autonomous OS Commander & Companion designed to bridge the gap between user directives and high-precision system management through an immersive, AI-driven interface.**

Cardinal monitors system vitals, detects security threats, manages usage habits, and automates OS/Web tasks via its integrated autonomous AI brain.

---

## 📋 Table of Contents

- [Overview](#overview)
- [✨ Features](#-features)
- [📦 Installation](#-installation)
- [🚀 Quick Start](#-quick-start)
- [🏗️ Architecture](#️-architecture)
- [🔧 Configuration](#-configuration)
- [🧪 Testing](#-testing)
- [🤝 Contributing](#-contributing)
- [📄 License](#-license)
- [💬 Support](#-support)

---

## Overview

Cardinal acts as the "Command Station" for your operating system. Built by Softcurse Systems, it combines a stunning cyberpunk aesthetic (the "Cyber S" design language) with powerful backend automation. It doesn't just show you what's happening; it uses its autonomous AI brain to help you maintain system integrity, automate repetitive browser tasks, and stay productive.

### Why Cardinal?
Traditional system monitors are passive. Cardinal is proactive. It learns your habits, warns you of security anomalies, and provides a direct, AI-mediated interface to your machine's core.

---

## ✨ Features

- **🧠 Autonomous AI Brain**: Integrated support for **Ollama** (Local), Anthropic, and OpenAI. The AI is "System Aware" and can autonomously execute actions like killing processes or running security scans.
- **🛰️ Real-time Vitals**: High-frequency monitoring of CPU, RAM, Disk, and Network I/O with historical sparkline charts.
- **🛡️ Security Forensics**: Active threat matrix scanning, startup entry analysis, and one-click repairs (SFC, Defender, Cache clearing).
- **🌐 Web Automation**: Built-in **Puppeteer** integration allows Cardinal to read webpages and fill forms autonomously on your behalf.
- **🕒 Habit Management**: Proactive fatigue alerts (break reminders) and sleep hygiene warnings for late-night sessions.
- **📁 Integrated File Manager**: Navigate, move, and delete files directly from the Commander interface.
- **🧩 Plugin System**: Extend Cardinal's capabilities by dropping simple JavaScript plugins into the `userData/plugins` folder.
- **🌍 Multilingual**: Full support for English, Russian, and Georgian.

---

## 📦 Installation

### Prerequisites
- **Node.js**: v18.0.0 or higher
- **Ollama**: (Optional, for local AI) [Download Ollama](https://ollama.com/)

### Steps
1. **Clone the repository**:
   ```bash
   git clone https://github.com/softcurse/cardinal.git
   cd cardinal
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Install Puppeteer dependencies** (Linux only):
   ```bash
   npx puppeteer browsers install chrome
   ```

---

## 🚀 Quick Start

To launch Cardinal in development mode:

```bash
npm start
```

### Basic Chat Command
Once online, try asking:
- *"Cardinal, what is the current health of my system?"*
- *"Kill the process consuming the most RAM."*
- *"Remind me to check my email in 15 minutes."*

---

## 🏗️ Architecture

Cardinal follows a secure, native-free architecture:
- **Renderer Process**: Vanilla JS/CSS (Cyber S Design System) with a canvas-based "Eye Core."
- **Main Process**: Electron logic handling IPC, SQLite/JSON storage, and Shell integration.
- **Security Bridge**: `preload.js` ensures the renderer only has access to a strictly defined System API.
- **Native-Free Stability**: Uses OS shell commands (PowerShell/AppleScript/xdotool) instead of native C++ modules to ensure cross-platform stability and zero memory buffer errors.

---

## 🔧 Configuration

All settings are stored in `userData/config.json`. You can also configure them via the **⚙ Settings** overlay in the app.

| Key | Description | Default |
| :--- | :--- | :--- |
| `aiModel` | The preferred Ollama model to use | `qwen2.5` |
| `userName` | Your display name for Cardinal | `Dante` |
| `anthropicKey` | API key for Anthropic fallback | `null` |
| `openaiKey` | API key for OpenAI fallback | `null` |
| `lang` | UI Language (`en`, `ru`, `ka`) | `en` |

---

## 🧪 Testing

To run the automated test suite:

```bash
npm test
```

*Note: Cardinal targets 90%+ coverage for core IPC handlers and AI parsing logic.*

---

## 🤝 Contributing

Contributions are the lifeblood of the Softcurse ecosystem! Please read [CONTRIBUTING.md](.github/CONTRIBUTING.md) to get started.

---

## 📄 License

This project is licensed under the **MIT License**. See [LICENSE](LICENSE) for details.

---

## 👥 Acknowledgements

- **[Softcurse Systems](https://softcurse-website.pages.dev/)** for the Cyber S aesthetic.
- **Systeminformation** and **Node-OS-Utils** for the telemetry engine.
- **Puppeteer** for the automation layer.

---

## 💬 Support

- **Bug Reports**: Open an issue [here](https://github.com/softcurse/cardinal/issues).
- **Discussions**: Join our [GitHub Discussions]() for feature requests.
- **Developer**: [Softcurse Systems](https://softcurse-website.pages.dev/)
