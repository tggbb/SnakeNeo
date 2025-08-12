# Snake Neo — Deluxe

A modern, polished Snake game you can run locally in any browser. No build tools required.

Features
- Fast, smooth gameplay with keyboard and touch controls
- Tailwind UI with a sleek neon theme
- Saved leaderboard (localStorage)
- Admin panel (backquote `) with cheats: add score, grow/shrink, god mode, spawn specials, toggle wrap, teleport
- Settings: grid size, speed, wrap, obstacles, sound
- Achievements, sounds, special fruits (golden + portal), obstacles
- Export/Import data

Quick start
1. Open `index.html` in your browser.
2. Controls: Arrow keys or WASD to move. Space to pause, R to reset. ` to toggle Admin.

Files
- `index.html` — App shell and modals
- `styles.css` — Small layer for components and modals (Tailwind via CDN)
- `script.js` — Game logic, UI, storage, audio

Notes
- Data is stored in your browser (localStorage). Clearing site data resets progress.
- For best results, serve the folder via a local server (optional).
