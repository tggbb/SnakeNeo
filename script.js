/* Snake Neo — Deluxe
   Single-file JS game engine + UI. No build required.
   Features:
   - Tailwind-based UI
   - Smooth game loop with delta time and tick accumulator
   - LocalStorage-backed settings, leaderboard, achievements
   - Admin panel (`) with cheats and runtime controls
   - Sounds, particles, special fruit types (golden, portal)
   - Touch controls for mobile
*/

(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const rnd = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
  const now = () => performance.now();

  // Storage helpers
  const STORE_KEY = 'snake-neo-deluxe';
  const defaultStore = {
    settings: {
      gridW: 28,
      gridH: 22,
      baseSpeed: 6, // ticks per second at 1x
      wrap: true,
      obstacles: false,
  sound: true,
  mode: 'classic', // 'classic' | 'timed' | 'daily'
  theme: 'neo', // 'neo' | 'retro' | 'sunset'
    },
    leaderboard: [], // {name, score, date}
    achievements: {},
    best: 0,
  };
  const loadStore = () => {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return structuredClone(defaultStore);
      const parsed = JSON.parse(raw);
      return { ...structuredClone(defaultStore), ...parsed, settings: { ...defaultStore.settings, ...(parsed.settings||{}) } };
    } catch (e) {
      console.warn('store parse failed', e);
      return structuredClone(defaultStore);
    }
  };
  const saveStore = (s) => localStorage.setItem(STORE_KEY, JSON.stringify(s));

  let store = loadStore();

  // DOM refs
  const canvas = $('#game');
  const ctx = canvas.getContext('2d');
  const overlay = $('#overlay');
  const overlayText = $('#overlayText');

  const hudScore = $('#hudScore');
  const hudBest = $('#hudBest');
  const hudSpeed = $('#hudSpeed');
  const achievementsList = $('#achievementsList');
  const hudTimer = $('#hudTimer');
  const modeSelect = $('#modeSelect');
  const themeSelect = $('#themeSelect');

  // Modals
  const modals = {
    leaderboard: $('#modalLeaderboard'),
    settings: $('#modalSettings'),
    help: $('#modalHelp'),
    name: $('#modalName'),
  };

  // UI buttons
  $('#btnLeaderboard').addEventListener('click', () => openModal('leaderboard'));
  $('#btnSettings').addEventListener('click', () => openModal('settings'));
  $('#btnHelp').addEventListener('click', () => openModal('help'));

  $$('#modalLeaderboard [data-close], #modalSettings [data-close], #modalHelp [data-close], #modalName [data-close]').forEach(b => b.addEventListener('click', (e) => closeModal(e.target.closest('.modal').id.replace('modal','').toLowerCase())));

  // Settings controls
  const setGridW = $('#setGridW');
  const setGridH = $('#setGridH');
  const setSpeed = $('#setSpeed');
  const setWrap = $('#setWrap');
  const setObstacles = $('#setObstacles');
  const setSound = $('#setSound');

  const btnApplySettings = $('#btnApplySettings');
  const btnResetSettings = $('#btnResetSettings');

  // Name modal controls
  const finalScoreEl = $('#finalScore');
  const playerNameEl = $('#playerName');
  $('#btnSaveScore').addEventListener('click', saveScoreFromModal);
  $('#btnSkipSave').addEventListener('click', () => closeModal('name'));

  // Export/Import
  $('#btnExport').addEventListener('click', () => {
    const data = JSON.stringify(store, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'snake-neo-deluxe-export.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $('#btnImport').addEventListener('click', async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const text = await file.text();
      try {
        const data = JSON.parse(text);
        if (!data || typeof data !== 'object') throw new Error('Invalid file');
        store = { ...structuredClone(defaultStore), ...data, settings: { ...defaultStore.settings, ...(data.settings||{}) } };
        saveStore(store);
        // Apply imported settings to runtime
        Object.assign(state, {
          gridW: store.settings.gridW,
          gridH: store.settings.gridH,
          baseSpeed: store.settings.baseSpeed,
          wrap: store.settings.wrap,
          obstacles: store.settings.obstacles,
          sound: store.settings.sound,
          mode: store.settings.mode,
          theme: store.settings.theme,
        });
        applyTheme(state.theme || 'neo');
        hardReset();
        syncSettingsUI();
        renderLeaderboard();
        notify('Data imported');
      } catch (e) {
        notify('Import failed');
      }
    };
    input.click();
  });

  // Admin Panel
  const admin = {
    panel: $('#adminPanel'),
    speed: $('#adminSpeed'),
    obstacles: $('#adminObstacles'),
    isOpen: false,
    open() { this.panel.style.transform = 'translateX(0)'; this.isOpen = true; },
    close() { this.panel.style.transform = 'translateX(100%)'; this.isOpen = false; },
    toggle() { this.isOpen ? this.close() : this.open(); }
  };
  $('#btnAdminClose').addEventListener('click', () => admin.close());
  admin.speed.addEventListener('input', () => { state.speedMul = parseFloat(admin.speed.value); updateHud(); });
  admin.obstacles.addEventListener('change', () => {
    state.obstacles = admin.obstacles.checked;
    if (state.obstacles) initObstacles(); else state.obstaclesMap.clear();
  });
  $$('#adminPanel [data-cheat]').forEach(b => b.addEventListener('click', () => handleCheat(b.dataset.cheat)));
  // Admin action buttons
  $('#btnAdminReset')?.addEventListener('click', () => softReset());
  $('#btnAdminHardReset')?.addEventListener('click', () => hardReset());
  $('#btnClearLB')?.addEventListener('click', () => { store.leaderboard = []; saveStore(store); renderLeaderboard(); notify('Leaderboard cleared'); });
  $('#btnClearAll')?.addEventListener('click', () => { 
    localStorage.removeItem(STORE_KEY); 
    store = loadStore(); 
    saveStore(store); 
    Object.assign(state, { 
      gridW:store.settings.gridW, gridH:store.settings.gridH, baseSpeed:store.settings.baseSpeed, wrap:store.settings.wrap, 
      obstacles:store.settings.obstacles, sound:store.settings.sound, mode: store.settings.mode, theme: store.settings.theme 
    }); 
    applyTheme(state.theme || 'neo');
    hardReset(); 
    notify('Factory reset complete'); 
  });

  // Pause/Reset
  $('#btnPause').addEventListener('click', togglePause);
  $('#btnReset').addEventListener('click', hardReset);

  // Touch controls
  $$('.touch-btn').forEach(btn => btn.addEventListener('click', () => {
    const dir = btn.getAttribute('data-dir');
    if (dir) {
      if (!state.started) { state.started = true; state.paused = false; }
      queueDir(dir);
      hidePressToStart();
  try { if (navigator && 'vibrate' in navigator) navigator.vibrate(10); } catch {}
    }
  }));

  // Mobile: swipe gestures on canvas + haptic feedback
  function haptics(ms = 10) {
    try { if (navigator && 'vibrate' in navigator) navigator.vibrate(ms); } catch {}
  }
  (function addSwipeHandlers() {
    let sx = 0, sy = 0;
    const thresholdPx = () => Math.max(24, state.cell); // adaptive threshold
    const onStart = (e) => {
      if (e.touches && e.touches.length > 1) return; // ignore multi-touch
      const t = e.touches ? e.touches[0] : e;
      sx = t.clientX; sy = t.clientY;
      e.preventDefault();
    };
    const onEnd = (e) => {
      const t = (e.changedTouches && e.changedTouches[0]) || e;
      const dx = t.clientX - sx;
      const dy = t.clientY - sy;
      const ax = Math.abs(dx), ay = Math.abs(dy);
      const thr = thresholdPx();
      if (ax < thr && ay < thr) {
        // treat as tap to start
        if (!state.started) { state.started = true; state.paused = false; hidePressToStart(); }
        e.preventDefault();
        return;
      }
      let dir;
      if (ax > ay) dir = dx > 0 ? 'right' : 'left'; else dir = dy > 0 ? 'down' : 'up';
      if (dir) {
        if (!state.started) { state.started = true; state.paused = false; hidePressToStart(); }
        queueDir(dir);
        haptics(10);
      }
      e.preventDefault();
    };
  canvas.addEventListener('touchstart', onStart, { passive: false });
    canvas.addEventListener('touchend', onEnd, { passive: false });
  canvas.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  })();

  // Mobile: Admin quick toggle button
  const btnAdminMobile = $('#btnAdminMobile');
  if (btnAdminMobile) btnAdminMobile.addEventListener('click', () => admin.toggle());
  const btnPauseMobile = $('#btnPauseMobile');
  if (btnPauseMobile) btnPauseMobile.addEventListener('click', () => togglePause());

  // Keyboard controls
  window.addEventListener('keydown', (e) => {
    if (e.key === '`') { e.preventDefault(); admin.toggle(); return; }
    if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); togglePause(); return; }
    if (e.key === 'r' || e.key === 'R') { e.preventDefault(); hardReset(); return; }
    const keyMap = { ArrowUp:'up', ArrowDown:'down', ArrowLeft:'left', ArrowRight:'right', w:'up', a:'left', s:'down', d:'right', W:'up', A:'left', S:'down', D:'right' };
    const dir = keyMap[e.key];
    if (dir) {
      e.preventDefault();
      if (!state.started) { state.started = true; state.paused = false; }
      queueDir(dir);
      hidePressToStart();
    }
  });

  // Game state
  const state = {
    gridW: store.settings.gridW,
    gridH: store.settings.gridH,
    cell: 24, // pixels per cell (scaled to fit)
    wrap: store.settings.wrap,
    obstacles: store.settings.obstacles,
    sound: store.settings.sound,
  mode: store.settings.mode,
  theme: store.settings.theme,
    baseSpeed: store.settings.baseSpeed, // ticks/sec
    speedMul: 1,
    started: false,
    paused: false,
    over: false,
    god: false,

    snake: [], // array of {x,y}
    dir: 'right',
    dirQueue: [],
    food: null,
    special: null, // {type:'golden'|'portal', x,y, ttl}
    score: 0,
    best: store.best || 0,
  obstaclesMap: new Set(), // key `${x},${y}`
  // Modes
  timerSec: 120,
  timeLeft: 120,
  dailySeed: 0,
  rng: Math.random,
  };

  // Sounds (simple oscillator-based beeps to avoid assets)
  const audioCtx = () => {
    if (!state.sound) return null;
    try { return new (window.AudioContext||window.webkitAudioContext)(); } catch { return null; }
  };
  const playBeep = (freq = 440, dur = 0.06, type = 'sine', vol = 0.04) => {
    const ctx = audioCtx(); if (!ctx) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.value = vol; o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + dur);
  };

  // Utilities
  const key = (x,y) => `${x},${y}`;
  function seedRNG(seed) {
    let t = seed >>> 0;
    return function() {
      t += 0x6D2B79F5;
      let x = t;
      x = Math.imul(x ^ (x >>> 15), x | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }
  function dailySeedFromDate(d = new Date()) {
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth()+1;
    const day = d.getUTCDate();
    return (y * 10000 + m * 100 + day) | 0;
  }
  const emptyCell = () => {
    const occ = new Set(state.snake.map(s => key(s.x,s.y)));
    if (state.food) occ.add(key(state.food.x, state.food.y));
    state.obstaclesMap.forEach(k => occ.add(k));
    if (state.special) occ.add(key(state.special.x, state.special.y));
    let tries = 0;
    while (tries++ < 5000) {
      const rand = state.rng || Math.random;
      const x = Math.floor(rand() * state.gridW);
      const y = Math.floor(rand() * state.gridH);
      if (!occ.has(key(x,y))) return {x,y};
    }
    // Fallback
    return { x: 0, y: 0 };
  };

  function initObstacles() {
    state.obstaclesMap.clear();
    if (!state.obstacles) return;
    const count = Math.floor((state.gridW * state.gridH) * 0.04);
    for (let i=0;i<count;i++) {
      const c = emptyCell();
      state.obstaclesMap.add(key(c.x,c.y));
    }
  }

  function startGame() {
    state.started = false; state.paused = true; state.over = false; state.dirQueue.length = 0; state.dir = 'right';
    const cx = Math.floor(state.gridW/2);
    const cy = Math.floor(state.gridH/2);
    state.snake = [ {x:cx-1,y:cy}, {x:cx-2,y:cy}, {x:cx-3,y:cy} ];
    state.score = 0; state.special = null; state.god = false;
    // Modes init
    if (state.mode === 'timed') {
      state.timeLeft = state.timerSec;
      if (hudTimer) { hudTimer.classList.remove('hidden'); updateTimerHud(); }
      state.rng = Math.random;
    } else if (state.mode === 'daily') {
      state.dailySeed = dailySeedFromDate();
      state.rng = seedRNG(state.dailySeed);
      if (hudTimer) hudTimer.classList.add('hidden');
    } else {
      if (hudTimer) hudTimer.classList.add('hidden');
      state.rng = Math.random;
    }
    initObstacles();
    state.food = emptyCell();
    ensureCanvasSize();
    updateHud();
    showPressToStart();
  }

  function softReset() {
    const keep = { speedMul: state.speedMul, wrap: state.wrap, obstacles: state.obstacles, sound: state.sound, baseSpeed: state.baseSpeed, gridW: state.gridW, gridH: state.gridH };
    startGame();
    Object.assign(state, keep);
    ensureCanvasSize();
    updateHud();
  }

  function hardReset() { startGame(); }

  function togglePause() {
    if (!state.started) return; state.paused = !state.paused; showOverlay(state.paused ? 'Paused' : '');
  }

  function queueDir(dir) {
    const last = state.dirQueue.at(-1) || state.dir;
    if ((dir === 'up' && last === 'down') || (dir === 'down' && last === 'up') || (dir === 'left' && last === 'right') || (dir === 'right' && last === 'left')) return;
    state.dirQueue.push(dir);
  }

  function stepDir() {
    if (state.dirQueue.length) state.dir = state.dirQueue.shift();
  }

  // Achievements
  const ACHS = [
    { id: 'first-bite', name: 'First Bite', cond: () => state.score >= 1 },
    { id: 'ten', name: 'Double Digits', cond: () => state.score >= 10 },
    { id: 'gold', name: 'Golden Touch', cond: () => store.achievements['gold'] },
    { id: 'portal', name: 'Portal Pioneer', cond: () => store.achievements['portal'] },
    { id: 'fast', name: 'Speed Demon', cond: () => state.speedMul >= 2 },
  ];

  function grantAch(id) {
    if (store.achievements[id]) return;
    store.achievements[id] = true;
    saveStore(store);
    renderAchievements();
    notify('Achievement unlocked!');
  }

  function renderAchievements() {
    achievementsList.innerHTML = '';
    for (const a of ACHS) {
      const unlocked = !!store.achievements[a.id] || a.cond();
      const li = document.createElement('li');
      li.className = `flex items-center justify-between px-3 py-2 rounded-md border text-xs ${unlocked? 'bg-emerald-500/10 border-emerald-400/30 text-emerald-200':'bg-white/5 border-white/10 text-slate-300'}`;
      li.innerHTML = `<span>${a.name}</span><span>${unlocked? '✔' : '•'}</span>`;
      achievementsList.appendChild(li);
    }
  }

  // Leaderboard
  function renderLeaderboard() {
    const list = $('#lbList');
    list.innerHTML = '';
    const top = [...store.leaderboard].sort((a,b) => b.score - a.score).slice(0, 20);
    if (!top.length) {
      const li = document.createElement('li');
      li.className = 'text-slate-400';
      li.textContent = 'No scores yet. Be the first!';
      list.appendChild(li);
      return;
    }
    top.forEach((e,i) => {
      const li = document.createElement('li');
      li.className = 'flex items-center justify-between bg-white/5 border border-white/10 rounded-md px-3 py-2';
      const date = new Date(e.date||Date.now()).toLocaleString();
      li.innerHTML = `<span class="font-semibold">#${i+1} ${escapeHtml(e.name||'Player')}</span><span class="tabular-nums">${e.score}</span><span class="text-slate-400 text-xs">${date}</span>`;
      list.appendChild(li);
    });
  }

  function saveScoreFromModal() {
    const name = (playerNameEl.value || 'Player').slice(0,20).trim();
    const entry = { name, score: state.score, date: Date.now() };
    store.leaderboard.push(entry);
    store.best = Math.max(store.best||0, state.score);
    saveStore(store);
    closeModal('name');
    renderLeaderboard();
    updateHud();
  }

  // UI helpers
  function openModal(name) {
    const el = modals[name]; if (!el) return;
    el.classList.remove('hidden');
    if (name === 'settings') syncSettingsUI();
    if (name === 'leaderboard') renderLeaderboard();
  }
  function closeModal(name) {
    const el = modals[name]; if (!el) return;
    el.classList.add('hidden');
  }
  function showOverlay(text) {
    overlayText.textContent = text;
    overlayText.style.opacity = text ? '1' : '0';
  }
  function showPressToStart() {
    overlayText.innerHTML = '<h3 class="text-3xl sm:text-4xl font-extrabold drop-shadow">Press any arrow key to start</h3><p class="text-slate-400 mt-2">WASD supported • Space to pause • ` for admin</p>';
    overlayText.style.opacity = '1';
  }
  function hidePressToStart() { overlayText.style.opacity = '0'; }
  function updateHud() {
    hudScore.textContent = state.score;
    hudBest.textContent = Math.max(store.best||0, state.best||0, state.score||0);
    hudSpeed.textContent = `${(state.speedMul||1).toFixed(1)}x`;
  }
  function updateTimerHud() {
    if (!hudTimer) return;
    const total = Math.max(0, Math.floor(state.timeLeft));
    const m = Math.floor(total/60).toString().padStart(2,'0');
    const s = (total%60).toString().padStart(2,'0');
    hudTimer.textContent = `${m}:${s}`;
  }
  function notify(msg) {
    const el = document.createElement('div');
    el.className = 'fixed bottom-4 left-1/2 -translate-x-1/2 bg-slate-900/90 text-slate-100 px-4 py-2 rounded-md border border-white/10 shadow z-50';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1400);
  }
  function escapeHtml(s){ return s.replace(/[&<>"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c])); }

  // Theme helpers
  function applyTheme(theme) {
    const body = document.body;
    ['theme-neo','theme-retro','theme-sunset'].forEach(c => body.classList.remove(c));
    body.classList.add(`theme-${theme||'neo'}`);
  }

  // Settings sync
  function syncSettingsUI() {
    setGridW.value = state.gridW;
    setGridH.value = state.gridH;
    setSpeed.value = state.baseSpeed;
    setWrap.checked = state.wrap;
    setObstacles.checked = state.obstacles;
    setSound.checked = state.sound;
    admin.speed.value = state.speedMul;
    admin.obstacles.checked = state.obstacles;
  if (modeSelect) modeSelect.value = state.mode || 'classic';
  if (themeSelect) themeSelect.value = state.theme || 'neo';
  }
  btnApplySettings.addEventListener('click', () => {
    const s = {
      gridW: clamp(parseInt(setGridW.value||28), 10, 80),
      gridH: clamp(parseInt(setGridH.value||22), 10, 60),
      baseSpeed: clamp(parseInt(setSpeed.value||6), 1, 10),
      wrap: !!setWrap.checked,
      obstacles: !!setObstacles.checked,
      sound: !!setSound.checked,
    };
  store.settings = { ...store.settings, ...s }; saveStore(store);
    Object.assign(state, { gridW:s.gridW, gridH:s.gridH, baseSpeed:s.baseSpeed, wrap:s.wrap, obstacles:s.obstacles, sound:s.sound });
    hardReset();
    closeModal('settings');
  });
  btnResetSettings.addEventListener('click', () => {
    store.settings = structuredClone(defaultStore.settings); saveStore(store);
  Object.assign(state, structuredClone(defaultStore.settings));
  if (modeSelect) modeSelect.value = state.mode || 'classic';
  if (themeSelect) themeSelect.value = state.theme || 'neo';
  applyTheme(state.theme || 'neo');
    hardReset();
    closeModal('settings');
  });

  // Canvas sizing responsive
  function ensureCanvasSize() {
    const rect = canvas.getBoundingClientRect();
    // Compute integer scale to fit width and height
    const scaleX = Math.floor(rect.width / state.gridW);
    const scaleY = Math.floor(rect.height / state.gridH);
    const scale = Math.max(8, Math.min(scaleX, scaleY));
    state.cell = scale;
    canvas.width = state.gridW * state.cell;
    canvas.height = state.gridH * state.cell;
  }
  window.addEventListener('resize', ensureCanvasSize);

  // Mode/Theme selectors
  if (modeSelect) {
    modeSelect.addEventListener('change', () => {
      const m = modeSelect.value || 'classic';
      state.mode = m;
      store.settings.mode = m;
      saveStore(store);
      hardReset();
    });
  }
  if (themeSelect) {
    themeSelect.addEventListener('change', () => {
      const t = themeSelect.value || 'neo';
      state.theme = t;
      store.settings.theme = t;
      saveStore(store);
      applyTheme(t);
    });
  }

  // Rendering
  function drawCell(x,y, color, radius=6) {
    const cs = state.cell;
    const r = Math.min(radius, cs/2 - 1);
    const px = x*cs, py = y*cs;
    ctx.fillStyle = color;
    roundRect(ctx, px+1, py+1, cs-2, cs-2, r);
    ctx.fill();
  }
  function roundRect(ctx, x, y, w, h, r) {
    if (w<2*r) r = w/2; if (h<2*r) r = h/2;
    ctx.beginPath();
    ctx.moveTo(x+r, y);
    ctx.arcTo(x+w, y, x+w, y+h, r);
    ctx.arcTo(x+w, y+h, x, y+h, r);
    ctx.arcTo(x, y+h, x, y, r);
    ctx.arcTo(x, y, x+w, y, r);
    ctx.closePath();
  }

  function render() {
    // background
  ctx.fillStyle = getCssVar('--bg-color', '#0b1220');
    ctx.fillRect(0,0,canvas.width, canvas.height);

    // grid subtle
  ctx.strokeStyle = getCssVar('--grid-line', 'rgba(255,255,255,0.04)');
    ctx.lineWidth = 1;
    for (let x=0; x<=state.gridW; x++) {
      ctx.beginPath(); ctx.moveTo(x*state.cell+0.5, 0); ctx.lineTo(x*state.cell+0.5, canvas.height); ctx.stroke();
    }
    for (let y=0; y<=state.gridH; y++) {
      ctx.beginPath(); ctx.moveTo(0, y*state.cell+0.5); ctx.lineTo(canvas.width, y*state.cell+0.5); ctx.stroke();
    }

    // obstacles
    if (state.obstacles) {
      state.obstaclesMap.forEach(k => {
        const [x,y] = k.split(',').map(Number);
        drawCell(x,y,'#1f2937', 4);
      });
    }

    // food
    if (state.food) drawCell(state.food.x, state.food.y, getCssVar('--food', '#10b981'), 6);

    // special
    if (state.special) {
      const col = state.special.type === 'golden' ? getCssVar('--golden', '#f59e0b') : getCssVar('--portal', '#60a5fa');
      drawCell(state.special.x, state.special.y, col, 8);
    }

    // snake
    state.snake.forEach((s,i) => {
      const head = i === 0;
      const headCol = getCssVar('--snake-head', '#22d3ee');
      const bodyCol = getCssVar('--snake-body', '#0ea5e9');
      drawCell(s.x, s.y, head ? headCol : bodyCol, head ? 8 : 6);
      if (head) {
        // eyes
        const cx = s.x*state.cell + state.cell/2;
        const cy = s.y*state.cell + state.cell/2;
        ctx.fillStyle = 'black';
        ctx.beginPath(); ctx.arc(cx-4, cy-3, 1.5, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(cx+4, cy-3, 1.5, 0, Math.PI*2); ctx.fill();
      }
    });
  }

  function getCssVar(name, fallback) {
    const v = getComputedStyle(document.body).getPropertyValue(name).trim();
    return v || fallback;
  }

  // Game loop
  let last = now();
  let acc = 0; // accumulated time
  function loop(t) {
    const dt = (t - last) / 1000; last = t; acc += dt;
    const ticksPerSec = Math.max(1, state.baseSpeed * state.speedMul);
    const step = 1 / ticksPerSec;

    if (!state.paused && state.started) {
      while (acc >= step) {
        tick(); acc -= step;
      }
    }

    render();
    requestAnimationFrame(loop);
  }

  function inBounds(x,y) { return x>=0 && x<state.gridW && y>=0 && y<state.gridH; }

  function tick() {
    if (state.over) return;
    stepDir();
    const head = { ...state.snake[0] };
    if (state.dir === 'up') head.y -= 1;
    if (state.dir === 'down') head.y += 1;
    if (state.dir === 'left') head.x -= 1;
    if (state.dir === 'right') head.x += 1;

    if (state.wrap) {
      if (head.x < 0) head.x = state.gridW-1;
      if (head.x >= state.gridW) head.x = 0;
      if (head.y < 0) head.y = state.gridH-1;
      if (head.y >= state.gridH) head.y = 0;
    }

    // collisions
    const out = !inBounds(head.x, head.y);
    const hitSelf = state.snake.some((s,i) => i>0 && s.x===head.x && s.y===head.y);
    const hitObs = state.obstacles && state.obstaclesMap.has(key(head.x, head.y));
    if (!state.god && (out || hitSelf || hitObs)) {
      gameOver();
      return;
    }

    // move
    state.snake.unshift(head);

    // eat
    if (state.food && head.x===state.food.x && head.y===state.food.y) {
      state.score += 1; playBeep(660,0.06,'triangle',0.05); grantAch('first-bite');
      // chance to spawn special
      if (!state.special && Math.random() < 0.1) spawnSpecial();
      state.food = emptyCell();
    } else if (state.special && head.x===state.special.x && head.y===state.special.y) {
      if (state.special.type === 'golden') {
        state.score += 5; store.achievements['gold'] = true; playBeep(880,0.08,'sawtooth',0.06);
      } else if (state.special.type === 'portal') {
        store.achievements['portal'] = true; playBeep(520,0.06,'square',0.06);
        // teleport near food
        const nx = clamp(state.food.x + rnd(-2,2), 0, state.gridW-1);
        const ny = clamp(state.food.y + rnd(-2,2), 0, state.gridH-1);
        state.snake[0].x = nx; state.snake[0].y = ny;
      }
      state.special = null;
    } else {
      state.snake.pop();
    }

    // decay special
    if (state.special) {
      state.special.ttl -= 1;
      if (state.special.ttl <= 0) state.special = null;
    }

    // grant other achievements
    if (state.score >= 10) grantAch('ten');
    if (state.speedMul >= 2) grantAch('fast');

    // timed mode countdown
    if (state.mode === 'timed' && state.started) {
      const ticksPerSec = Math.max(1, state.baseSpeed * state.speedMul);
      state.timeLeft = Math.max(0, state.timeLeft - 1 / ticksPerSec);
      updateTimerHud();
      if (state.timeLeft <= 0) {
        gameOver();
        return;
      }
    }

    updateHud();
  }

  function spawnSpecial() {
    const rand = state.rng || Math.random;
    const t = rand() < 0.5 ? 'golden' : 'portal';
    const c = emptyCell();
    const ttl = 30 + Math.floor(rand() * 31);
    state.special = { type: t, x: c.x, y: c.y, ttl };
  }

  function gameOver() {
    playBeep(140,0.12,'square',0.06);
    state.over = true; state.started = false; state.paused = true;
    store.best = Math.max(store.best||0, state.score);
    saveStore(store);
    finalScoreEl.textContent = state.score;
  openModal('name');
    showOverlay('Game Over');
  }

  function handleCheat(code) {
    switch(code) {
      case 'addScore': state.score += 50; break;
      case 'grow': for (let i=0;i<3;i++) state.snake.push({...state.snake.at(-1)}); break;
      case 'shrink': for (let i=0;i<3 && state.snake.length>3;i++) state.snake.pop(); break;
  case 'teleportFood': state.snake[0].x = state.food.x; state.snake[0].y = state.food.y; break;
      case 'spawnGolden': state.special = { type:'golden', ...emptyCell(), ttl: 80 }; break;
      case 'spawnPortal': state.special = { type:'portal', ...emptyCell(), ttl: 80 }; break;
      case 'toggleGod': state.god = !state.god; notify(`God mode ${state.god?'ON':'OFF'}`); break;
      case 'toggleWrap': state.wrap = !state.wrap; notify(`Wrap ${state.wrap?'ON':'OFF'}`); break;
    }
    updateHud();
  }

  // Press to start behavior
  canvas.addEventListener('click', () => { hidePressToStart(); if (!state.started) { state.started = true; state.paused = false; }});

  // Initialize
  function bootstrap() {
    ensureCanvasSize();
  // Initialize selectors and theme
  if (modeSelect) modeSelect.value = state.mode || 'classic';
  if (themeSelect) themeSelect.value = state.theme || 'neo';
  applyTheme(state.theme || 'neo');
    startGame();
    renderAchievements();
    updateHud();
    renderLeaderboard();
    requestAnimationFrame(loop);
  }

  // Helpers
  function showModalBackdropClickClose() {
    Object.values(modals).forEach(m => m.addEventListener('click', (e) => { if (e.target === m) m.classList.add('hidden'); }));
  }
  showModalBackdropClickClose();

  bootstrap();
})();
