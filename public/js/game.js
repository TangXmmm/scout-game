/**
 * Scout 游戏客户端逻辑 v3
 * 修复：
 * 1. 挖角面板显示完整卡牌（含翻转选项），明确"只取1张"
 * 2. 支持挖角时翻转牌（传flipCard参数）
 * 3. 实时分数明细展示（tokens - handCount）
 * 4. 回合结束详细计分过程
 * 5. 挖角插入位置可视化（手牌间点击插入）
 */

const socket = io();

// ── 状态 ──────────────────────────────────────────────────────
let myPlayerId = null;
let myRoomCode = null;
let gameState = null;
let selectedCardIndices = [];
let isMyTurn = false;
let scoutPanelMode = false;
let selectedScoutPos = null;  // 'left' | 'right'
let selectedInsertIndex = 0;  // 插入位置
let willFlipScoutedCard = false; // 是否翻转挖到的牌

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

// ── 渲染卡牌 HTML ──────────────────────────────────────────────
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

// ── 渲染迷你卡牌（用于Scout插入预览） ───────────────────────────
function renderMiniCard(card, isInsertTarget = false) {
  const val = getCardValue(card);
  const valClass = getValClass(val);
  const targetClass = isInsertTarget ? 'insert-target' : '';
  return `<div class="mini-card ${targetClass} ${valClass}">${val}</div>`;
}

// ── 渲染挖到的牌预览（带翻转状态） ───────────────────────────────
function renderScoutedCardPreview(card, flipped = false) {
  const displayCard = flipped
    ? { ...card, face: card.face === 'top' ? 'bottom' : 'top' }
    : card;
  const val = getCardValue(displayCard);
  const otherVal = getCardOtherValue(displayCard);
  const valClass = getValClass(val);
  return `
    <div class="scout-card-preview">
      <div class="ctop ${getValClass(otherVal)}">${otherVal}</div>
      <div class="cmv ${valClass}">${val}</div>
      <div class="cbot ${getValClass(otherVal)}">${otherVal}</div>
    </div>
    <div style="font-size:0.72rem;color:#8b949e;margin-top:4px;">
      ${flipped ? '（已翻转，将以此面朝上插入）' : '（以当前方向插入）'}
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

    // 实时预估得分（tokens - handCount，赢家不扣）
    const tokens = p.scoutTokens || 0;
    const handCount = p.handCount || 0;
    const liveScore = tokens - handCount;
    const liveScoreDisplay = liveScore >= 0 ? `+${liveScore}` : `${liveScore}`;

    return `
      <div class="${classes}">
        <div class="chip-avatar">${p.name.charAt(0)}</div>
        <div class="chip-info">
          <div class="chip-name">${p.name}${isMe ? ' (我)' : ''}</div>
          <div class="chip-score">
            手牌:${handCount} · 总:${p.totalScore}
            <span class="live-score">(${liveScoreDisplay})</span>
          </div>
          ${isActive ? '<div class="chip-turn">▶ 行动中</div>' : ''}
          ${p.usedScoutAndShow ? '<div style="font-size:0.65rem;color:#8b949e">已用挖+演</div>' : ''}
        </div>
      </div>
    `;
  }).join('');
}

// ── 渲染实时分数明细条 ────────────────────────────────────────
function renderScoreDetailBar(state) {
  const bar = document.getElementById('score-detail-bar');
  if (!state || !state.players) { bar.innerHTML = ''; return; }

  bar.innerHTML = state.players.map(p => {
    const tokens = p.scoutTokens || 0;
    const handCount = p.handCount || 0;
    const thisRound = tokens - handCount;
    const totalIfWin = p.totalScore + tokens; // 如果赢（不扣手牌）
    const totalIfLose = p.totalScore + thisRound; // 如果输

    return `
      <div class="score-chip">
        <span class="sc-name">${p.name}</span>
        <span class="sc-tokens">🎫×${tokens}</span>
        <span class="sc-hands">🃏×${handCount}</span>
        <span class="sc-total ${thisRound < 0 ? 'neg' : ''}">(${thisRound >= 0 ? '+' : ''}${thisRound})</span>
      </div>
    `;
  }).join('');
}

// ── 渲染舞台区 ────────────────────────────────────────────────
function renderStage(state) {
  const stageEl = document.getElementById('stage-cards');
  const stageInfo = document.getElementById('stage-info');

  if (!state.stage || state.stage.length === 0) {
    stageEl.innerHTML = '<div class="stage-empty-hint">在场组为空 — 第一个出牌吧！</div>';
    stageInfo.innerHTML = '';
    return;
  }

  // 舞台牌带左右端标记（方便玩家知道挖哪端）
  stageEl.innerHTML = state.stage.map((card, i) => {
    const isLeft = i === 0;
    const isRight = i === state.stage.length - 1;
    let endLabel = '';
    if (state.stage.length > 1 && isLeft) {
      endLabel = '<div class="stage-end-label stage-end-left">←左</div>';
    } else if (state.stage.length > 1 && isRight) {
      endLabel = '<div class="stage-end-label stage-end-right">右→</div>';
    }
    return `<div class="stage-card-wrap">${endLabel}${renderCard(card, { isStage: true })}</div>`;
  }).join('');

  const ownerName = state.players.find(p => p.id === state.stageOwner)?.name || '?';
  const typeBadge = state.stageType === 'set'
    ? '<span class="stage-type-badge badge-set">同号组</span>'
    : '<span class="stage-type-badge badge-seq">连号顺子</span>';
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

// ── 更新操作按钮状态 ──────────────────────────────────────────
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
  renderScoreDetailBar(state);
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
  document.getElementById('flip-phase').style.display = 'flex';
  const preview = document.getElementById('flip-preview');
  preview.innerHTML = (state.myHand || []).map(card => renderCard(card)).join('');

  const statusEl = document.getElementById('flip-wait-status');
  statusEl.innerHTML = state.players.map(p => `
    <div class="flip-status-item ${p.flipConfirmed ? 'confirmed' : ''}">
      ${p.name}: ${p.flipConfirmed ? '✅ 已确认' : '⏳ 等待中'}
    </div>
  `).join('');
}

function doFlip() { socket.emit('flip_hand'); }
function doConfirmFlip() { socket.emit('confirm_flip'); }

// ── SHOW ──────────────────────────────────────────────────────
function doShow() {
  if (selectedCardIndices.length === 0) return showToast('请先点击手牌中要出的牌（需位置连续）', 'error');
  socket.emit('show', { cardIndices: selectedCardIndices });
  selectedCardIndices = [];
}

// ── SCOUT 面板（全新可视化版本）────────────────────────────────
function openScoutPanel(isScoutAndShow = false) {
  scoutPanelMode = isScoutAndShow;
  selectedScoutPos = null;
  selectedInsertIndex = 0;
  willFlipScoutedCard = false;

  const title = document.getElementById('scout-panel-title');
  const desc = document.getElementById('scout-panel-desc');
  const scoutShowSelect = document.getElementById('scout-show-select');
  const confirmBtn = document.getElementById('scout-confirm-btn');

  if (isScoutAndShow) {
    title.textContent = '⚡ 挖角并演出';
    desc.textContent = '先挖角取1张牌，插入手牌，然后再选连续手牌演出。每轮只能用1次。';
    scoutShowSelect.style.display = 'block';
    confirmBtn.textContent = '确认挖角（再去选牌演出）';
  } else {
    title.textContent = '🔍 挖角';
    desc.textContent = '从在场组两端取1张牌（注意：每次只取1张！），插入你手牌任意位置，在场组主人获得1个挖角Token。';
    scoutShowSelect.style.display = 'none';
    confirmBtn.textContent = '确认挖角';
  }

  // 渲染左右端牌选择
  updateScoutPositionBtns();

  // 重置插入位置可视化
  updateInsertHandPreview();

  // 隐藏已选预览
  document.getElementById('scouted-card-preview-area').style.display = 'none';

  document.getElementById('scout-panel').style.display = 'flex';
}

// ── 更新左右端牌的显示 ────────────────────────────────────────
function updateScoutPositionBtns() {
  const stage = gameState?.stage || [];
  const leftCard = stage.length > 0 ? stage[0] : null;
  const rightCard = stage.length > 0 ? stage[stage.length - 1] : null;

  // 左端按钮
  const leftPreview = document.getElementById('scout-left-preview');
  const leftFlip = document.getElementById('scout-left-flip');
  if (leftCard) {
    const val = getCardValue(leftCard);
    const otherVal = getCardOtherValue(leftCard);
    leftPreview.innerHTML = `
      <div class="scout-card-preview" style="margin:4px auto;">
        <div class="ctop ${getValClass(otherVal)}">${otherVal}</div>
        <div class="cmv ${getValClass(val)}">${val}</div>
        <div class="cbot ${getValClass(otherVal)}">${otherVal}</div>
      </div>
    `;
    // 只有两面不同时才显示翻转选项
    if (leftCard.top !== leftCard.bottom) {
      leftFlip.style.display = 'block';
      document.getElementById('flip-left-cb').checked = false;
    } else {
      leftFlip.style.display = 'none';
    }
  } else {
    leftPreview.innerHTML = '<div style="color:#8b949e;font-size:0.8rem;">无</div>';
    leftFlip.style.display = 'none';
  }

  // 右端按钮
  const rightPreview = document.getElementById('scout-right-preview');
  const rightFlip = document.getElementById('scout-right-flip');
  if (rightCard) {
    const val = getCardValue(rightCard);
    const otherVal = getCardOtherValue(rightCard);
    // 只有一张牌时左右是同一张，显示"仅一张"
    const isSingle = stage.length === 1;
    rightPreview.innerHTML = isSingle
      ? '<div style="font-size:0.7rem;color:#8b949e;">(同左端)</div>'
      : `<div class="scout-card-preview" style="margin:4px auto;">
          <div class="ctop ${getValClass(otherVal)}">${otherVal}</div>
          <div class="cmv ${getValClass(val)}">${val}</div>
          <div class="cbot ${getValClass(otherVal)}">${otherVal}</div>
        </div>`;
    if (!isSingle && rightCard.top !== rightCard.bottom) {
      rightFlip.style.display = 'block';
      document.getElementById('flip-right-cb').checked = false;
    } else {
      rightFlip.style.display = 'none';
    }
  } else {
    rightPreview.innerHTML = '<div style="color:#8b949e;font-size:0.8rem;">无</div>';
    rightFlip.style.display = 'none';
  }
}

// ── 选择左/右端 ──────────────────────────────────────────────
function selectScoutPos(pos) {
  selectedScoutPos = pos;
  willFlipScoutedCard = false; // 切换端时重置翻转

  document.getElementById('scout-left-btn').classList.toggle('selected', pos === 'left');
  document.getElementById('scout-right-btn').classList.toggle('selected', pos === 'right');

  // 重置对应的翻转checkbox
  if (pos === 'left') {
    document.getElementById('flip-left-cb').checked = false;
    document.getElementById('flip-right-cb').checked = false;
  } else {
    document.getElementById('flip-right-cb').checked = false;
    document.getElementById('flip-left-cb').checked = false;
  }

  // 显示将挖到的牌
  const stage = gameState?.stage || [];
  const card = pos === 'left' ? stage[0] : stage[stage.length - 1];
  if (card) {
    const previewArea = document.getElementById('scouted-card-preview-area');
    previewArea.style.display = 'block';
    document.getElementById('scouted-card-display').innerHTML = renderScoutedCardPreview(card, false);
  }

  // 更新插入预览
  updateInsertHandPreview();
}

// ── 翻转checkbox变化 ──────────────────────────────────────────
function onFlipCheckChange() {
  if (!selectedScoutPos) return;
  const cbId = selectedScoutPos === 'left' ? 'flip-left-cb' : 'flip-right-cb';
  willFlipScoutedCard = document.getElementById(cbId).checked;

  // 更新挖到的牌预览
  const stage = gameState?.stage || [];
  const card = selectedScoutPos === 'left' ? stage[0] : stage[stage.length - 1];
  if (card) {
    document.getElementById('scouted-card-display').innerHTML =
      renderScoutedCardPreview(card, willFlipScoutedCard);
  }

  // 更新插入预览中的目标牌
  updateInsertHandPreview();
}

// ── 插入位置可视化（点击手牌之间的位置）────────────────────────
function updateInsertHandPreview() {
  const container = document.getElementById('insert-hand-preview');
  const hint = document.getElementById('insert-hint-text');
  const hand = gameState?.myHand || [];

  if (hand.length === 0) {
    container.innerHTML = '<div style="font-size:0.8rem;color:#8b949e;">手牌为空，将插在唯一位置</div>';
    hint.textContent = '';
    return;
  }

  // 获取当前挖到的牌（用于在插入位置显示）
  const stage = gameState?.stage || [];
  const scoutedCard = selectedScoutPos
    ? (selectedScoutPos === 'left' ? stage[0] : stage[stage.length - 1])
    : null;

  // 构建手牌+插入线的预览
  // 在每张手牌前可以点击插入（共 hand.length+1 个位置）
  let html = '';

  for (let i = 0; i <= hand.length; i++) {
    // 插入位置点击区域
    const isCurrentInsertPos = i === selectedInsertIndex;
    if (isCurrentInsertPos && scoutedCard) {
      // 显示橙色插入线 + 挖到的牌
      html += `<div class="mini-insert-line"></div>`;
      const displayCard = willFlipScoutedCard
        ? { ...scoutedCard, face: scoutedCard.face === 'top' ? 'bottom' : 'top' }
        : scoutedCard;
      const val = getCardValue(displayCard);
      html += `<div class="mini-scouted-card ${getValClass(val)}" style="background:${getCardBg(val)};color:#1a1a2e;">${val}</div>`;
    } else {
      // 可点击的插入位置（竖线占位符）
      html += `<div onclick="setInsertIndex(${i})" style="width:12px;height:42px;cursor:pointer;display:flex;align-items:center;justify-content:center;border-radius:3px;" title="插在第${i+1}位">
        <div style="width:2px;height:28px;background:rgba(255,255,255,0.1);border-radius:2px;"></div>
      </div>`;
    }

    // 手牌
    if (i < hand.length) {
      html += renderMiniCard(hand[i]);
    }
  }

  container.innerHTML = html;
  hint.textContent = scoutedCard
    ? `将插在第 ${selectedInsertIndex + 1} 位（点击位置线调整）`
    : '请先选择取哪端的牌';
}

function getCardBg(val) {
  // 返回迷你挖到的牌背景色
  if (val <= 2) return '#fde8e8';
  if (val <= 4) return '#fde8cc';
  if (val <= 6) return '#fef9e7';
  if (val <= 8) return '#e8f8ed';
  return '#e8f0fe';
}

function setInsertIndex(idx) {
  selectedInsertIndex = idx;
  updateInsertHandPreview();
}

function closeScoutPanel() {
  document.getElementById('scout-panel').style.display = 'none';
  selectedScoutPos = null;
  willFlipScoutedCard = false;
}

function confirmScout() {
  if (!selectedScoutPos) return showToast('请先选择从哪端取牌', 'error');

  if (scoutPanelMode) {
    // Scout & Show：先保存Scout参数，关闭面板，让用户选牌
    window._pendingScoutPos = selectedScoutPos;
    window._pendingInsertIndex = selectedInsertIndex;
    window._pendingFlipCard = willFlipScoutedCard;
    closeScoutPanel();
    showToast('✅ 挖角位置已定！请在手牌中选择要出的连续牌，再点"演出"按钮', 'info');
    // 更改演出按钮为确认S&S
    document.getElementById('btn-show').textContent = '⚡ 确认挖角+演出';
    document.getElementById('btn-show').onclick = () => confirmScoutAndShow();
  } else {
    socket.emit('scout', {
      position: selectedScoutPos,
      insertIndex: selectedInsertIndex,
      flipCard: willFlipScoutedCard,
    });
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
    flipCard: window._pendingFlipCard || false,
  });
  selectedCardIndices = [];
  resetShowButton();
}

function resetShowButton() {
  const btn = document.getElementById('btn-show');
  btn.textContent = '🎭 演出';
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

// ── 回合结束弹窗（含详细计分过程）────────────────────────────
function showRoundEnd(data) {
  document.getElementById('round-winner-name').textContent = `🏆 ${data.roundWinnerName} 赢得了本轮！`;

  const sorted = Object.entries(data.totalScores).sort(([, a], [, b]) => b - a);
  document.getElementById('round-scores-body').innerHTML = sorted.map(([id, total]) => {
    const name = data.playerNames[id] || id;
    const roundScore = data.roundScores[id] || 0;
    const isWinner = id === data.roundWinnerId;
    const tokens = data.scoutTokens?.[id] || 0;
    const handCount = data.handCounts?.[id] || 0;

    // 显示详细计分过程
    let detailStr = '';
    if (isWinner) {
      detailStr = `Token(${tokens}) + 手牌=0（赢家不扣）`;
    } else {
      detailStr = `Token(${tokens}) - 手牌(${handCount}) = ${roundScore}`;
    }

    return `<tr class="${isWinner ? 'winner-row' : ''}">
      <td>${name}${isWinner ? ' 🏆' : ''}</td>
      <td class="score-detail-col">${detailStr}</td>
      <td style="color:${roundScore >= 0 ? '#3fb950' : '#f85149'};font-weight:700;">${roundScore >= 0 ? '+' : ''}${roundScore}</td>
      <td style="font-weight:700;">${total}</td>
    </tr>`;
  }).join('');

  document.getElementById('round-end-modal').style.display = 'flex';

  // 只有未游戏结束时显示"下一轮"按钮
  const nextBtn = document.getElementById('btn-next-round');
  if (data.gameOver) {
    nextBtn.style.display = 'none';
  } else {
    nextBtn.style.display = 'inline-block';
  }
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
      ? '🎮 游戏开始！请决定是否翻转手牌'
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
    document.getElementById('action-log').textContent = '🎮 游戏正式开始！轮流出牌...';
  }
});

socket.on('action_log', ({ type, playerName, count, position }) => {
  const msgs = {
    show: `${playerName} 出了 ${count} 张牌`,
    scout: `${playerName} 从在场组${position === 'left' ? '左' : '右'}端挖了1张牌`,
    scout_and_show: `${playerName} 挖角并演出！`,
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
