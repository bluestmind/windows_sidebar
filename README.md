# Windows App Group Sidebar

A fast, lightweight, macOS-style frosted glass desktop sidebar for Windows built with **Rust**, **Tauri v2**, **React 19**, and **Tailwind CSS**.

---

## Features

- **macOS Dark Glass Sidebar & Taskbar-Aware Docking**:
  - Uses native Windows DWM blur (`window-vibrancy`) with zero mouse-hover flicker.
  - Queries Windows Work Area (`SPI_GETWORKAREA`) so it docks cleanly above the taskbar on the **Right** or **Left** screen edge.
  - Supports **Overlay** mode and Windows **AppBar** mode (`SHAppBarMessage`), plus adjustable sidebar width.
- **Application Groups & Native Windows Shell Integration**:
  - Organize `.exe`, `.lnk`, `.bat`, and `.cmd` shortcuts into color-coded collapsible groups (list or 2-column grid view).
  - Native Windows icon extraction (`SHGetFileInfoW` + GDI DIBits) and `.lnk` shortcut target resolution (`IShellLinkW` / `IPersistFile`).
  - Drag-and-drop support, instant search, and right-click context menu (**Launch**, **Run as Administrator**, **Open in File Explorer**, **Remove**).
- **Live Market Rates Card (Apps Tab)**:
  - Real-time Binance WebSocket price streaming (`wss://stream.binance.com:9443`) for **BTC**, **ETH**, **Gold (PAXG/oz)**, and **Gram (TON)** with tick-direction flash indicators.
- **Standalone Account Cooldown Tracker (Apps Tab)**:
  - Track model remaining percentages (`PRO`, `ULTRA`, `FREE`) and live 1-second token reset countdowns across accounts locally in `localStorage`, with quick `5h` / `2d` / `7d` cooldown presets and automatic restoration upon timer expiration.
- **Built-in Telegram Music Player (Music Tab)**:
  - Streams cataloged tracks with play/pause, seek bar, volume/mute, shuffle, repeat modes, search filtering, iTunes cover art lookup, and continuous background playback while switching tabs.
- **Integrated IT-Tools Suite (IT-Tools Tab)**:
  - Offline-bundled [IT-Tools](https://github.com/CorentinTh/it-tools) developer utilities suite (`70+` tools including Token Generator, Hash, Bcrypt, UUID/ULID, JWT Parser, QR Generator, Regex Tester, Formatters/Converters) with one-click sidebar width expansion (`260px` <-> `480px`).

---

## Configuration

Sidebar layout and app groups are saved locally in:
```text
%APPDATA%\WindowsAppGroupSidebar\config.json
```

---

## Development & Build

### Prerequisites
- Node.js & npm
- Rust toolchain (`cargo`)

### Commands
```powershell
# Install frontend dependencies
npm install

# Type-check & build frontend bundle
npm run build

# Run in development mode
npm run tauri dev

# Build release binary
cd src-tauri
cargo build --release
```
