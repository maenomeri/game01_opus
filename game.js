// ============================================================
//  Chromatic Collapse — クロマティック・コラプス
//  同色セルをなぞって消すパズルゲーム
// ============================================================

(function () {
  "use strict";

  // ---------- 定数 ----------
  const COLS = 8;
  const ROWS = 10;
  const CELL = 52;
  const GAP = 4;
  const BOARD_W = COLS * (CELL + GAP) + GAP;
  const BOARD_H = ROWS * (CELL + GAP) + GAP;
  const MIN_CHAIN = 3;

  const COLORS = [
    { name: "red",    fill: "#ff6b6b", glow: "#ff6b6b80" },
    { name: "yellow", fill: "#ffd93d", glow: "#ffd93d80" },
    { name: "green",  fill: "#6bcb77", glow: "#6bcb7780" },
    { name: "blue",   fill: "#4d96ff", glow: "#4d96ff80" },
    { name: "purple", fill: "#c77dff", glow: "#c77dff80" },
  ];

  const STAGES = [
    { target: 300,  colors: 4, riseInterval: 12000, rows: 2 },
    { target: 800,  colors: 4, riseInterval: 10000, rows: 2 },
    { target: 1500, colors: 5, riseInterval: 9000,  rows: 3 },
    { target: 2500, colors: 5, riseInterval: 8000,  rows: 3 },
    { target: 4000, colors: 5, riseInterval: 7000,  rows: 3 },
  ];

  // ---------- State ----------
  let board = [];       // board[row][col] = colorIndex | -1
  let state = "title";  // title | playing | paused | clearing | gameover | stageclear
  let stage = 0;
  let score = 0;
  let totalScore = 0;
  let selected = [];    // [{r,c}, ...]
  let selectedColor = -1;
  let dangerRows = 0;   // ボード上端にどれだけ近いか
  let riseTimer = 0;
  let lastRise = 0;
  let animating = false;
  let particles = [];
  let comboCount = 0;
  let canvas, ctx;
  let mouseDown = false;
  let lastCell = null;
  let highScore = 0;

  // ---------- Storage ----------
  function loadData() {
    try {
      highScore = parseInt(localStorage.getItem("cc_highscore") || "0", 10);
    } catch(e) { highScore = 0; }
  }

  function saveData() {
    try {
      localStorage.setItem("cc_highscore", String(highScore));
    } catch(e) {}
  }

  // ---------- Board ----------
  function createBoard(numColors, prefillRows) {
    board = [];
    for (let r = 0; r < ROWS; r++) {
      board[r] = [];
      for (let c = 0; c < COLS; c++) {
        if (r >= ROWS - prefillRows) {
          board[r][c] = Math.floor(Math.random() * numColors);
        } else {
          board[r][c] = -1;
        }
      }
    }
  }

  function addBottomRow(numColors) {
    // ボード全体を1行上にシフト
    for (let r = 0; r < ROWS - 1; r++) {
      board[r] = board[r + 1].slice();
    }
    // 最下行に新しい行を追加
    board[ROWS - 1] = [];
    for (let c = 0; c < COLS; c++) {
      board[ROWS - 1][c] = Math.floor(Math.random() * numColors);
    }
  }

  function isTopRowOccupied() {
    return board[0].some(v => v >= 0);
  }

  // ---------- Selection Logic ----------
  function cellAt(x, y) {
    const col = Math.floor((x - GAP) / (CELL + GAP));
    const row = Math.floor((y - GAP) / (CELL + GAP));
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return null;
    // セル内にいるか確認
    const cx = GAP + col * (CELL + GAP);
    const cy = GAP + row * (CELL + GAP);
    if (x < cx || x > cx + CELL || y < cy || y > cy + CELL) return null;
    return { r: row, c: col };
  }

  function isAdjacent(a, b) {
    return Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;
  }

  function isInSelected(r, c) {
    return selected.some(s => s.r === r && s.c === c);
  }

  function startSelect(cell) {
    if (animating || state !== "playing") return;
    const color = board[cell.r][cell.c];
    if (color < 0) return;
    selected = [cell];
    selectedColor = color;
    mouseDown = true;
    lastCell = cell;
  }

  function continueSelect(cell) {
    if (!mouseDown || animating || state !== "playing") return;
    if (!cell) return;
    const color = board[cell.r][cell.c];
    if (color !== selectedColor) return;

    // 一つ前のセルに戻る場合は取り消し
    if (selected.length >= 2) {
      const prev = selected[selected.length - 2];
      if (prev.r === cell.r && prev.c === cell.c) {
        selected.pop();
        lastCell = cell;
        return;
      }
    }

    if (isInSelected(cell.r, cell.c)) return;
    if (!isAdjacent(selected[selected.length - 1], cell)) return;

    selected.push(cell);
    lastCell = cell;
  }

  function endSelect() {
    if (!mouseDown) return;
    mouseDown = false;

    if (selected.length >= MIN_CHAIN) {
      clearSelected();
    } else {
      selected = [];
      selectedColor = -1;
    }
  }

  // ---------- Clear & Collapse ----------
  async function clearSelected() {
    if (animating) return;
    animating = true;
    state = "clearing";

    const count = selected.length;
    const color = COLORS[selectedColor];

    // パーティクル生成
    for (const s of selected) {
      spawnParticles(s.c, s.r, color.fill, 6);
      board[s.r][s.c] = -1;
    }

    // スコア計算: 個数 × (個数 - MIN_CHAIN + 1) でボーナス
    const bonus = count - MIN_CHAIN + 1;
    const pts = count * bonus * 10;
    score += pts;
    totalScore += pts;

    comboCount++;
    showChainText(comboCount, pts, color.fill);

    selected = [];
    selectedColor = -1;

    // 落下アニメーション
    await sleep(150);
    collapseBoard();
    await sleep(200);

    // 連鎖チェック（自動消去はなし）
    comboCount = 0;
    animating = false;
    state = "playing";

    // ステージクリア判定
    checkStageClear();
  }

  function collapseBoard() {
    for (let c = 0; c < COLS; c++) {
      let writeRow = ROWS - 1;
      for (let r = ROWS - 1; r >= 0; r--) {
        if (board[r][c] >= 0) {
          board[writeRow][c] = board[r][c];
          if (writeRow !== r) board[r][c] = -1;
          writeRow--;
        }
      }
      for (let r = writeRow; r >= 0; r--) {
        board[r][c] = -1;
      }
    }
  }

  // ---------- Stage ----------
  function checkStageClear() {
    const stg = STAGES[stage];
    if (score >= stg.target) {
      state = "stageclear";
      showStageClearModal();
    }
  }

  function nextStage() {
    stage++;
    if (stage >= STAGES.length) {
      // 全ステージクリア
      showGameClearModal();
      return;
    }
    score = 0;
    const stg = STAGES[stage];
    createBoard(stg.colors, stg.rows);
    lastRise = performance.now();
    state = "playing";
  }

  // ---------- Game Over ----------
  function triggerGameOver() {
    state = "gameover";
    if (totalScore > highScore) {
      highScore = totalScore;
      saveData();
    }
    showGameOverModal();
  }

  // ---------- Rise Timer ----------
  function updateRise(now) {
    if (state !== "playing") return;
    const stg = STAGES[stage];
    if (now - lastRise > stg.riseInterval) {
      lastRise = now;
      if (isTopRowOccupied()) {
        triggerGameOver();
        return;
      }
      addBottomRow(stg.colors);
    }
  }

  // ---------- Particles ----------
  function spawnParticles(col, row, color, count) {
    const cx = GAP + col * (CELL + GAP) + CELL / 2;
    const cy = GAP + row * (CELL + GAP) + CELL / 2;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1 + Math.random() * 3;
      particles.push({
        x: cx, y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        decay: 0.02 + Math.random() * 0.02,
        color: color,
        size: 3 + Math.random() * 4,
      });
    }
  }

  function updateParticles() {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.05;
      p.life -= p.decay;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  // ---------- Rendering ----------
  function render() {
    ctx.clearRect(0, 0, BOARD_W, BOARD_H);

    // 背景グリッド
    ctx.fillStyle = "#0e0e24";
    ctx.fillRect(0, 0, BOARD_W, BOARD_H);

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const x = GAP + c * (CELL + GAP);
        const y = GAP + r * (CELL + GAP);

        // グリッドセル背景
        ctx.fillStyle = "#181838";
        ctx.beginPath();
        roundRect(ctx, x, y, CELL, CELL, 6);
        ctx.fill();

        const colorIdx = board[r][c];
        if (colorIdx < 0) continue;

        const col = COLORS[colorIdx];
        const isSelected = isInSelected(r, c);

        // グロー
        if (isSelected) {
          ctx.shadowColor = col.glow;
          ctx.shadowBlur = 15;
        }

        // セル
        ctx.fillStyle = isSelected ? lighten(col.fill, 0.3) : col.fill;
        ctx.beginPath();
        roundRect(ctx, x + 2, y + 2, CELL - 4, CELL - 4, 5);
        ctx.fill();

        // ハイライト
        ctx.fillStyle = "rgba(255,255,255,0.2)";
        ctx.beginPath();
        roundRect(ctx, x + 4, y + 4, CELL - 8, (CELL - 8) * 0.4, 3);
        ctx.fill();

        ctx.shadowColor = "transparent";
        ctx.shadowBlur = 0;
      }
    }

    // 選択線
    if (selected.length > 1) {
      ctx.strokeStyle = COLORS[selectedColor] ? lighten(COLORS[selectedColor].fill, 0.5) : "#fff";
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      for (let i = 0; i < selected.length; i++) {
        const s = selected[i];
        const sx = GAP + s.c * (CELL + GAP) + CELL / 2;
        const sy = GAP + s.r * (CELL + GAP) + CELL / 2;
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.stroke();
    }

    // パーティクル
    for (const p of particles) {
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // 危険ライン（最上行）
    if (state === "playing") {
      const hasTopContent = board[1] && board[1].some(v => v >= 0);
      if (hasTopContent) {
        ctx.strokeStyle = "rgba(255, 80, 80, 0.4)";
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(0, GAP + CELL + GAP / 2);
        ctx.lineTo(BOARD_W, GAP + CELL + GAP / 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function lighten(hex, amount) {
    const num = parseInt(hex.slice(1), 16);
    let r = (num >> 16) & 255;
    let g = (num >> 8) & 255;
    let b = num & 255;
    r = Math.min(255, r + (255 - r) * amount);
    g = Math.min(255, g + (255 - g) * amount);
    b = Math.min(255, b + (255 - b) * amount);
    return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
  }

  // ---------- UI Updates ----------
  function updateUI() {
    const stg = STAGES[stage];
    const progressPct = Math.min(100, (score / stg.target) * 100);
    const dangerEl = document.getElementById("danger-bar");
    if (dangerEl) dangerEl.style.width = progressPct + "%";

    const scoreEl = document.getElementById("score-val");
    if (scoreEl) scoreEl.textContent = totalScore.toLocaleString();

    const stageEl = document.getElementById("stage-val");
    if (stageEl) stageEl.textContent = (stage + 1) + " / " + STAGES.length;

    const targetEl = document.getElementById("target-val");
    if (targetEl) targetEl.textContent = score + " / " + stg.target;

    // 残り時間バー
    if (state === "playing") {
      const elapsed = performance.now() - lastRise;
      const pct = Math.min(100, (elapsed / stg.riseInterval) * 100);
      const riseEl = document.getElementById("rise-bar");
      if (riseEl) riseEl.style.width = pct + "%";
    }
  }

  // ---------- Chain Text ----------
  function showChainText(combo, pts, color) {
    const el = document.getElementById("chain-display");
    if (!el) return;
    if (combo >= 1) {
      el.textContent = "+" + pts;
      el.style.color = color;
      el.style.opacity = "1";
      el.style.transform = "translate(-50%, -50%) scale(1.2)";
      setTimeout(() => {
        el.style.opacity = "0";
        el.style.transform = "translate(-50%, -60%) scale(0.8)";
      }, 600);
    }
  }

  // ---------- Modals ----------
  function showTitleScreen() {
    const app = document.getElementById("app");
    const hsText = highScore > 0 ? `<div class="high-score-display">ハイスコア: ${highScore.toLocaleString()}</div>` : "";
    app.innerHTML = `
      <div id="title-screen">
        <h1>Chromatic Collapse</h1>
        <p class="subtitle">クロマティック・コラプス</p>
        <div class="how-to">
          <h3>遊び方</h3>
          ・隣り合う<strong>同じ色</strong>のセルをドラッグでつなげよう<br>
          ・<strong>3つ以上</strong>つなげると消せる！<br>
          ・たくさんつなげるほど高得点<br>
          ・一定スコアに達するとステージクリア<br>
          ・下から色が<strong>せり上がって</strong>くる！<br>
          ・最上段まで埋まると<strong>ゲームオーバー</strong><br>
        </div>
        ${hsText}
        <button class="btn btn-primary" id="btn-start">ゲームスタート</button>
      </div>
    `;
    document.getElementById("btn-start").addEventListener("click", startGame);
  }

  function showGameUI() {
    const app = document.getElementById("app");
    app.innerHTML = `
      <div id="header">
        <h1>Chromatic Collapse</h1>
        <div class="stat">STAGE<br><span class="stat-value" id="stage-val">1 / ${STAGES.length}</span></div>
        <div class="stat">SCORE<br><span class="stat-value" id="score-val">0</span></div>
        <div class="stat">TARGET<br><span class="stat-value" id="target-val">0 / ${STAGES[0].target}</span></div>
      </div>
      <div id="danger-bar-container"><div id="danger-bar"></div></div>
      <div id="board-container">
        <canvas id="gameCanvas" width="${BOARD_W}" height="${BOARD_H}"></canvas>
      </div>
      <div id="info-row">
        <span>次のせり上がり</span>
        <div style="flex:1;margin:0 10px;height:6px;background:#1a1a3a;border-radius:3px;position:relative;top:4px;overflow:hidden;">
          <div id="rise-bar" style="height:100%;width:0%;background:linear-gradient(90deg,#4d96ff,#ff6b6b);border-radius:3px;transition:width 0.2s;"></div>
        </div>
      </div>
    `;

    canvas = document.getElementById("gameCanvas");
    ctx = canvas.getContext("2d");

    // イベント
    canvas.addEventListener("mousedown", onMouseDown);
    canvas.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("touchstart", onTouchStart, { passive: false });
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd);
  }

  function showStageClearModal() {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal">
        <h2 style="color:#6bcb77;">ステージクリア！</h2>
        <p>ステージ ${stage + 1} をクリアしました！</p>
        <div class="final-score">${totalScore.toLocaleString()}</div>
        <p style="margin-top:12px;">スコア</p>
        <button class="btn btn-primary" id="btn-next">次のステージへ</button>
      </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("show"));
    document.getElementById("btn-next").addEventListener("click", () => {
      overlay.remove();
      nextStage();
    });
  }

  function showGameClearModal() {
    state = "gameclear";
    if (totalScore > highScore) {
      highScore = totalScore;
      saveData();
    }
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal">
        <h2 style="background:linear-gradient(90deg,#ffd93d,#ff6b6b,#c77dff);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">全ステージクリア！</h2>
        <p>おめでとうございます！<br>すべてのステージをクリアしました！</p>
        <div class="final-score">${totalScore.toLocaleString()}</div>
        <p style="margin-top:12px;">最終スコア</p>
        <br>
        <button class="btn btn-primary" id="btn-restart-clear">もう一度遊ぶ</button>
        <button class="btn btn-secondary" id="btn-title-clear">タイトルへ</button>
      </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("show"));
    document.getElementById("btn-restart-clear").addEventListener("click", () => {
      overlay.remove();
      startGame();
    });
    document.getElementById("btn-title-clear").addEventListener("click", () => {
      overlay.remove();
      state = "title";
      showTitleScreen();
    });
  }

  function showGameOverModal() {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal">
        <h2 style="color:#ff6b6b;">ゲームオーバー</h2>
        <p>ステージ ${stage + 1} で力尽きました...</p>
        <div class="final-score">${totalScore.toLocaleString()}</div>
        <p style="margin-top:12px;">スコア</p>
        <br>
        <button class="btn btn-danger" id="btn-retry">リトライ</button>
        <button class="btn btn-secondary" id="btn-title">タイトルへ</button>
      </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("show"));
    document.getElementById("btn-retry").addEventListener("click", () => {
      overlay.remove();
      startGame();
    });
    document.getElementById("btn-title").addEventListener("click", () => {
      overlay.remove();
      state = "title";
      showTitleScreen();
    });
  }

  // ---------- Input ----------
  function getCanvasPos(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  function onMouseDown(e) {
    const pos = getCanvasPos(e);
    const cell = cellAt(pos.x, pos.y);
    if (cell) startSelect(cell);
  }

  function onMouseMove(e) {
    const pos = getCanvasPos(e);
    const cell = cellAt(pos.x, pos.y);
    if (cell) continueSelect(cell);
  }

  function onMouseUp() { endSelect(); }

  function onTouchStart(e) {
    e.preventDefault();
    const touch = e.touches[0];
    const pos = getCanvasPos(touch);
    const cell = cellAt(pos.x, pos.y);
    if (cell) startSelect(cell);
  }

  function onTouchMove(e) {
    e.preventDefault();
    const touch = e.touches[0];
    const pos = getCanvasPos(touch);
    const cell = cellAt(pos.x, pos.y);
    if (cell) continueSelect(cell);
  }

  function onTouchEnd(e) { endSelect(); }

  // ---------- Game Loop ----------
  function gameLoop(now) {
    requestAnimationFrame(gameLoop);

    if (state === "playing" || state === "clearing") {
      updateRise(now);
      updateParticles();
      render();
      updateUI();
    }
  }

  // ---------- Start ----------
  function startGame() {
    stage = 0;
    score = 0;
    totalScore = 0;
    comboCount = 0;
    selected = [];
    selectedColor = -1;
    particles = [];
    animating = false;

    const stg = STAGES[stage];
    createBoard(stg.colors, stg.rows);

    showGameUI();
    lastRise = performance.now();
    state = "playing";
  }

  // ---------- Util ----------
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ---------- Init ----------
  function init() {
    loadData();
    showTitleScreen();
    requestAnimationFrame(gameLoop);
  }

  init();
})();
