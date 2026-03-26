/**
 * Scout 游戏客户端逻辑 v2
 * - 从 URL 参数读取稳定的 playerId（pid）和 roomCode（room）
 * - 连接后立即用 playerId 重连，彻底解决 socketId 变化问题
 */

const socket = io();

// ── 状态 ──────────────────────────────────────────────────────
let myPlayerId = null;
let myRoomCode = null;
let gameState = null;
let selectedCardIndices = [];
let isMyTurn = false;
let scoutPanelMode = false;
let selectedScoutPos = null;

// ── 从 URL 读取身份信息 ────────────────────────────────────────
(function initFromURL() {
  const params = new URLSearchParams(window.location.search);
  myRoomCode = params.get('room');
  myPlayerId = params.get('pid');
  if (!myRoomCode || !myPlayerId) {
    window.location.href = '/';
  }
})();

// ── 工具函数 ──────────────────────────────────────────────────
function showToast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = type;
  el.style.display = 'block';
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.style.display = 'none'; }, 3500);
}

function getCardValue(card) {
  return card.face === 'top' ? card.top : card.bottom;
}

function getCardOtherValue(card) {
  return card.face === 'top' ? card.bottom : card.top;
}

function getValClass(val) {
  if (val <= 2) return 'val-1';
  if (val <= 4) return 'val-3';
  if (val <= 6) return 'val-5';
  if (val <= 8) return 'val-7';
  return 'val-9';
}

// ── 渲染卡牌 ──────────────────────────────────────────────────
function renderCard(card, options = {}) {
  const val = getCardValue(card);
  const otherVal = getCardOtherValue(card);
  const valClass = getValClass(val);
  const selected = options.selected ? 'selected' : '';
  const isStage = options.isStage ? 'stage-card' : '';
  const clickHandler = options.onClick ? `onclick="${options.onClick}"` : '';

  return `
    <div class="game-card ${selected} ${isStage}" ${clickHandler} data-index="${options.index ?? ''}">
      <div class="card-top-left ${getValClass(otherVal)}">${otherVal}</div>
      <div class="card-main-value ${valClass}">${val}</div>
      <div class="card-back-value ${getValClass(otherVal)}">${otherVal}</div>
    </div>
  `;
}

// ── 渲染玩家信息栏 ────────────────────────────────────────────
function renderPlayersBar(state) {
  const bar = document.getElementById('players-bar');
  bar.innerHTML = state.players.map(p => {
    const isMe = p.id === myPlayerId;
    const isActive = p.id === state.currentPlayerId;
    let classes = 'player-chip';
    if (isMe) classes += ' me';
    if (isActive) classes += ' active';
    return `
      <div class="${classes}">
        <div class="chip-avatar">${p.name.charAt(0)}</div>
        <div class="chip-info">
          <div class="chip-name">${p.name}${isMe ? ' (我)' : ''}</div>
          <div class="chip-score">手牌:${p.handCount} · 总分:${p.totalScore}</div>
          ${isActive ? '<div class="chip-turn">▶ 轮到你</div>' : ''}
          ${p.usedScoutAndShow ? '<div style="font-size:0.65rem;color:#8b949e">已用S&S</div>' : ''}
        </div>
      </div>
    `;
  }).join('');
}

// ── 渲染舞台区 ────────────────────────────────────────────────
function renderStage(state) {
  const stageEl = document.getElementById('stage-cards');
  const stageInfo = document.getElementById('stage-info');
  if (!state.stage || state.stage.length === 0) {
    stageEl.innerHTML = '<div class="stage-empty-hint">舞台空置 — 第一个出牌吧！</div>';
    stageInfo.innerHTML = '';
    return;
  }
  stageEl.innerHTML = state.stage.map(card => renderCard(card, { isStage: true })).join('');
  const ownerName = state.players.find(p => p.id === state.stageOwner)?.name || '?';
  const typeBadge = state.stageType === 'set'
    ? '<span class="stage-type-badge badge-set">同值组</span>'
    : '<span class="stage-type-badge badge-seq">顺子</span>';
  stageInfo.innerHTML = `<div class="stage-owner">${ownerName} 出的牌 ${typeBadge} ${state.stage.length}张</div>`;
}

// ── 渲染手牌 ──────────────────────────────────────────────────
function renderHand(hand) {
  const container = document.getElementById('my-hand-cards');
  const badge = document.getElementById('hand-count-badge');
  badge.textContent = `(${hand.length}张)`;
  container.innerHTML = hand.map((card, i) => {
    const selected = selectedCardIndices.includes(i);
    return renderCard(card, { index: i, selected, onClick: `toggleCard(${i})` });
  }).join('');
}

// ── 切换选牌 ──────────────────────────────────────────────────
function toggleCard(index) {
  if (!isMyTurn) return showToast('还没轮到你', 'error');
  const idx = selectedCardIndices.indexOf(index);
  if (idx === -1) {
    selectedCardIndices.push(index);
    selectedCardIndices.sort((a, b) => a - b);
  } else {
    selectedCardIndices.splice(idx, 1);
  }
  renderHand(gameState.myHand);
  updateActionButtons();
}

// ── 更新操作按钮 ──────────────────────────────────────────────
function updateActionButtons() {
  const btnShow = document.getElementById('btn-show');
  const btnScout = document.getElementById('btn-scout');
  const btnScoutShow = document.getElementById('btn-scout-show');

  if (!isMyTurn || !gameState || gameState.state !== 'playing') {
    btnShow.disabled = true;
    btnScout.disabled = true;
    btnScoutShow.disabled = true;
    return;
  }

  btnShow.disabled = selectedCardIndices.length === 0;
  const hasStage = gameState.stage && gameState.stage.length > 0;
  btnScout.disabled = !hasStage;
  btnScoutShow.disabled = !hasStage || gameState.usedScoutAndShow;
}

// ── 渲染完整游戏状态 ──────────────────────────────────────────
function renderGameState(state) {
  gameState = state;
  isMyTurn = state.currentPlayerId === myPlayerId && state.state === 'playing';

  document.getElementById('round-num').textContent = state.roundNumber;
  renderPlayersBar(state);
  renderStage(state);
  renderHand(state.myHand || []);
  updateActionButtons();

  const waitingEl = document.getElementById('waiting-overlay');
  waitingEl.style.display = (!isMyTurn && state.state === 'playing') ? 'block' : 'none';

  if (state.state === 'flip_phase') {
    showFlipPhase(state);
  } else {
    document.getElementById('flip-phase').style.display = 'none';
  }
}

// ── 翻牌阶段 ──────────────────────────────────────────────────
function showFlipPhase(state) {
  const panel = document.getElementById('flip-phase');
  panel.style.display = 'flex';

  const preview = document.getElementById('flip-preview');
  preview.innerHTML = (state.myHand || []).map(card => renderCard(card)).join('');

  const statusEl = document.getElementById('flip-wait-status');
  statusEl.innerHTML = state.players.map(p => `
    <div class="flip-status-item ${p.flipConfirmed ? 'confirmed' : ''}">
      ${p.name}: ${p.flipConfirmed ? '✅ 已确认' : '⏳ 等待中'}
    </div>
  `).join('');
}

function doFlip() {
  socket.emit('flip_hand');
}

function doConfirmFlip() {
  socket.emit('confirm_flip');
}

// ── SHOW ──────────────────────────────────────────────────────
function doShow() {
  if (selectedCardIndices.length === 0) return showToast('请先点击手牌中要出的牌（需连续）', 'error');
  socket.emit('show', { cardIndices: selectedCardIndices });
  selectedCardIndices = [];
}

// ── SCOUT 面板 ────────────────────────────────────────────────
function openScoutPanel(isScoutAndShow = false) {
  scoutPanelMode = isScoutAndShow;
  selectedScoutPos = null;

  const desc = document.getElementById('scout-panel-desc');
  const scoutShowSelect = document.getElementById('scout-show-select');
  const confirmBtn = document.getElementById('scout-confirm-btn');

  if (isScoutAndShow) {
    desc.textContent = '先从舞台取一张牌插入手牌，然后从手牌中选择连续的牌出牌。';
    scoutShowSelect.style.display = 'block';
    confirmBtn.textContent = '确认 Scout';
  } else {
    desc.textContent = '从舞台两端取一张牌，插入你的手牌（可插任意位置），并给出牌人1分补偿。';
    scoutShowSelect.style.display = 'none';
    confirmBtn.textContent = '确认 Scout';
  }

  const stage = gameState?.stage || [];
  document.getElementById('scout-left-card').textContent = stage.length > 0 ? getCardValue(stage[0]) : '-';
  document.getElementById('scout-right-card').textContent = stage.length > 0 ? getCardValue(stage[stage.length - 1]) : '-';

  const slider = document.getElementById('insert-slider');
  slider.max = gameState?.myHand?.length || 0;
  slider.value = 0;
  updateInsertDisplay(0);

  document.getElementById('scout-left-btn').classList.remove('selected');
  document.getElementById('scout-right-btn').classList.remove('selected');
  document.getElementById('scout-panel').style.display = 'flex';
}

function selectScoutPos(pos) {
  selectedScoutPos = pos;
  document.getElementById('scout-left-btn').classList.toggle('selected', pos === 'left');
  document.getElementById('scout-right-btn').classList.toggle('selected', pos === 'right');
}

function updateInsertDisplay(val) {
  document.getElementById('insert-pos-display').textContent = parseInt(val) + 1;
}

function closeScoutPanel() {
  document.getElementById('scout-panel').style.display = 'none';
  selectedScoutPos = null;
}

function confirmScout() {
  if (!selectedScoutPos) return showToast('请选择从哪端取牌', 'error');
  const insertIndex = parseInt(document.getElementById('insert-slider').value);

  if (scoutPanelMode) {
    // Scout & Show：先关闭面板，让用户选牌
    window._pendingScoutPos = selectedScoutPos;
    window._pendingInsertIndex = insertIndex;
    closeScoutPanel();
    showToast('✅ Scout 位置已定，请点选手牌后点"SHOW"', 'success');
    document.getElementById('btn-show').textContent = '⚡ 确认 SCOUT+SHOW';
    document.getElementById('btn-show').onclick = () => confirmScoutAndShow();
  } else {
    socket.emit('scout', { position: selectedScoutPos, insertIndex });
    closeScoutPanel();
    selectedCardIndices = [];
  }
}

function confirmScoutAndShow() {
  if (selectedCardIndices.length === 0) return showToast('请先选择要出的连续手牌', 'error');
  socket.emit('scout_and_show', {
    scoutPosition: window._pendingScoutPos,
    insertIndex: window._pendingInsertIndex,
    showIndices: selectedCardIndices,
  });
  selectedCardIndices = [];
  resetShowButton();
}

function resetShowButton() {
  const btn = document.getElementById('btn-show');
  btn.textContent = '🎭 SHOW 出牌';
  btn.onclick = () => doShow();
}

// ── 下一轮/返回大厅 ──────────────────────────────────────────
function nextRound() {
  document.getElementById('round-end-modal').style.display = 'none';
  socket.emit('next_round');
}

function backToLobby() {
  window.location.href = '/';
}

// ── 回合结束弹窗 ──────────────────────────────────────────────
function showRoundEnd(data) {
  document.getElementById('round-winner-name').textContent = `🏆 ${data.roundWinnerName} 赢得了本轮！`;

  const sorted = Object.entries(data.totalScores).sort(([, a], [, b]) => b - a);
  document.getElementById('round-scores-body').innerHTML = sorted.map(([id, total]) => {
    const name = data.playerNames[id] || id;
    const roundScore = data.roundScores[id] || 0;
    const isWinner = id === data.roundWinnerId;
    return `<tr class="${isWinner ? 'winner-row' : ''}">
      <td>${name}${isWinner ? ' 🏆' : ''}</td>
      <td>+${roundScore}</td>
      <td>${total}</td>
    </tr>`;
  }).join('');

  document.getElementById('round-end-modal').style.display = 'flex';
}

function showGameEnd(data) {
  document.getElementById('round-end-modal').style.display = 'none';
  document.getElementById('game-winner-name').textContent = `🏆 ${data.gameWinnerName}`;

  const sorted = Object.entries(data.totalScores).sort(([, a], [, b]) => b - a);
  document.getElementById('game-scores-body').innerHTML = sorted.map(([id, score], rank) => {
    const name = data.playerNames[id] || id;
    const medal = ['🥇', '🥈', '🥉'][rank] || `${rank + 1}.`;
    return `<tr class="${id === data.gameWinnerId ? 'winner-row' : ''}">
      <td>${medal}</td><td>${name}</td><td>${score} 分</td>
    </tr>`;
  }).join('');

  document.getElementById('game-end-modal').style.display = 'flex';
}

// ── Socket 事件 ───────────────────────────────────────────────

// 连接成功后立即用稳定 playerId 重连
socket.on('connect', () => {
  if (myRoomCode && myPlayerId) {
    socket.emit('rejoin_game', { roomCode: myRoomCode, playerId: myPlayerId });
    document.getElementById('action-log').textContent = '🔄 正在连接游戏...';
  }
});

socket.on('rejoin_result', ({ success, state, message }) => {
  if (success && state) {
    renderGameState(state);
    document.getElementById('action-log').textContent = state.state === 'flip_phase'
      ? '🎮 游戏已开始！请决定是否翻转手牌'
      : '🎮 游戏进行中...';
  } else {
    showToast('⚠️ ' + (message || '连接失败，请返回大厅'), 'error');
    setTimeout(() => { window.location.href = '/'; }, 2500);
  }
});

socket.on('game_state', (state) => {
  renderGameState(state);
});

socket.on('hand_updated', ({ myHand, message }) => {
  if (gameState) {
    gameState.myHand = myHand;
    renderHand(myHand);
    const preview = document.getElementById('flip-preview');
    if (preview) preview.innerHTML = myHand.map(card => renderCard(card)).join('');
  }
  showToast(message, 'success');
});

socket.on('phase_changed', ({ phase }) => {
  if (phase === 'playing') {
    document.getElementById('flip-phase').style.display = 'none';
    document.getElementById('action-log').textContent = '游戏正式开始！轮流出牌...';
  }
});

socket.on('action_log', ({ type, playerName, count, position }) => {
  const msgs = {
    show: `${playerName} 出了 ${count} 张牌`,
    scout: `${playerName} 从舞台${position === 'left' ? '左' : '右'}端挖了一张牌`,
    scout_and_show: `${playerName} 挖角后出牌！`,
  };
  document.getElementById('action-log').textContent = msgs[type] || '';
});

socket.on('action_error', ({ message }) => {
  showToast('❌ ' + message, 'error');
  selectedCardIndices = [];
  if (gameState) renderHand(gameState.myHand);
  updateActionButtons();
});

socket.on('round_end', (data) => {
  showRoundEnd(data);
});

socket.on('game_over', (data) => {
  showRoundEnd(data);
  setTimeout(() => showGameEnd(data), 1500);
});

socket.on('round_started', ({ roundNumber }) => {
  document.getElementById('round-num').textContent = roundNumber;
  document.getElementById('action-log').textContent = `第 ${roundNumber} 轮开始！`;
  selectedCardIndices = [];
  resetShowButton();
});

socket.on('player_offline', ({ playerName }) => {
  showToast(`${playerName} 暂时离线`, 'error');
});

socket.on('error', ({ message }) => {
  showToast('⚠️ ' + message, 'error');
});
