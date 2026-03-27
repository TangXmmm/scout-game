/**
 * Scout 游戏客户端逻辑 v4 - 响应式适配（PC + APP）
 * 布局策略：
 *   - 手机 (<900px)：顶部横向滚动玩家条 + 垂直堆叠布局
 *   - PC  (≥900px)：左侧固定玩家栏 + 右侧游戏区
 */

const socket = io();

// ── 状态 ──────────────────────────────────────────────────────
let myPlayerId = null;
let myRoomCode = null;
let gameState = null;
let selectedIndices = [];
let isMyTurn = false;
let scoutAndShowMode = false;
let selPos = null;          // 'left' | 'right'
let selInsertIdx = 0;
let willFlip = false;

// ── URL 参数 + 会话保存 ────────────────────────────────────────
(function init() {
  const p = new URLSearchParams(window.location.search);
  myRoomCode = p.get('room');
  myPlayerId = p.get('pid');
  if (!myRoomCode || !myPlayerId) window.location.href = '/';
  
  // 游戏开始时保存会话信息
  saveGameSession({
    roomCode: myRoomCode,
    playerId: myPlayerId,
    timestamp: Date.now()
  });
})();

// 保存游戏会话到 localStorage
function saveGameSession(session) {
  localStorage.setItem('scout_game_session', JSON.stringify(session));
}

// 清除游戏会话
function clearGameSession() {
  localStorage.removeItem('scout_game_session');
}

// ── 工具 ──────────────────────────────────────────────────────
function showToast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = type;
  el.style.display = 'block';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.display = 'none'; }, 3200);
}

function cv(card) { return card.face === 'top' ? card.top : card.bottom; }
function co(card) { return card.face === 'top' ? card.bottom : card.top; }

function vc(val) {
  if (val <= 2) return 'vc1';
  if (val <= 4) return 'vc3';
  if (val <= 6) return 'vc5';
  if (val <= 8) return 'vc7';
  return 'vc9';
}

function cardBg(val) {
  const bgs = ['#fde8e8','#fde8cc','#fef9e7','#e8f8ed','#e8f0fe'];
  const idx = Math.min(Math.floor((val - 1) / 2), 4);
  return bgs[idx];
}

// ── 渲染卡牌 HTML ──────────────────────────────────────────────
function cardHtml(card, opts = {}) {
  const val = cv(card), other = co(card);
  const selClass = opts.selected ? 'selected' : '';
  const stageClass = opts.stage ? 'stage-card' : '';
  const onclick = opts.onClick ? `onclick="${opts.onClick}"` : '';
  const idx = opts.index !== undefined ? `data-index="${opts.index}"` : '';
  return `
    <div class="game-card ${selClass} ${stageClass}" ${onclick} ${idx}>
      <div class="card-corner card-tl ${vc(other)}">${other}</div>
      <div class="card-main-val ${vc(val)}">${val}</div>
      <div class="card-corner card-br ${vc(other)}">${other}</div>
    </div>`;
}

// ── 渲染小卡牌（用于挖角预览）────────────────────────────────
function miniCardHtml(card) {
  const val = cv(card);
  return `<div class="mini-card ${vc(val)}" style="background:${cardBg(val)};">${val}</div>`;
}

// ── 更新实时分数条 ────────────────────────────────────────────
function renderScoreBar(state) {
  const bar = document.getElementById('score-bar');
  if (!state?.players) { bar.innerHTML = ''; return; }
  bar.innerHTML = state.players.map(p => {
    const cards = p.scoreCards || 0;  // 演出获得的分数卡
    const tok = p.scoutTokens || 0;   // 被挖角获得的补偿
    const hc = p.handCount || 0;      // 剩余手牌
    const live = cards + tok - hc;    // 实时分数 = 分数卡 + 补偿 - 手牌
    return `<div class="sc-chip">
      <span class="sc-name">${p.name}</span>
      <span class="sc-tok">🎴${cards}</span>
      <span class="sc-hand">🎫${tok}</span>
      <span class="sc-total ${live < 0 ? 'neg' : ''}">${live >= 0 ? '+' : ''}${live}</span>
      <span class="sc-hand" style="opacity:0.6">(-${hc})</span>
    </div>`;
  }).join('');
}

// ── 渲染玩家条（移动端 top bar）──────────────────────────────
function renderPlayersTop(state) {
  const bar = document.getElementById('players-top-bar');
  bar.innerHTML = state.players.map(p => {
    const isMe = p.id === myPlayerId;
    const active = p.id === state.currentPlayerId;
    let cls = 'player-chip';
    if (isMe) cls += ' is-me';
    if (active) cls += ' active';
    const cards = p.scoreCards || 0;  // 演出获得的分数卡
    const tok = p.scoutTokens || 0;   // 被挖角获得的补偿
    const hc = p.handCount || 0;      // 剩余手牌
    const live = cards + tok - hc;    // 实时分数 = 分数卡 + 补偿 - 手牌
    return `<div class="${cls}">
      <div class="chip-av">${p.name[0]}</div>
      <div>
        <div class="chip-name">${p.name}${isMe ? ' 👤' : ''}</div>
        <div class="chip-meta">
          总${p.totalScore} · <span class="chip-live">${live >= 0 ? '+' : ''}${live}</span>
        </div>
        ${active ? '<div style="font-size:0.6rem;color:var(--gold);">▶ 行动中</div>' : ''}
      </div>
    </div>`;
  }).join('');
}

// ── 渲染玩家侧栏（PC端）──────────────────────────────────────
function renderPlayersSidebar(state) {
  const sidebar = document.getElementById('players-sidebar');
  if (!sidebar) return;
  const roundInfo = `<div class="sidebar-title">第 ${state.roundNumber} 局 · 玩家</div>`;
  const players = state.players.map(p => {
    const isMe = p.id === myPlayerId;
    const active = p.id === state.currentPlayerId;
    const cards = p.scoreCards || 0;
    const tok = p.scoutTokens || 0;
    const hc = p.handCount || 0;
    const live = cards + tok - hc;
    return `<div class="sidebar-player ${active ? 'active' : ''}">
      <div class="sp-name">${p.name}${isMe ? ' 👤' : ''}</div>
      <div class="sp-score">
        总分 ${p.totalScore} · 🎴${cards} · 🎫${tok} · 🃏-${hc}
      </div>
      <div class="sp-live">${live >= 0 ? '+' : ''}${live} 实时</div>
      ${active ? '<div class="sp-turn">▶ 行动中</div>' : ''}
      ${p.usedScoutAndShow ? '<div style="font-size:0.62rem;color:var(--muted);margin-top:2px;">已用挖+演</div>' : ''}
    </div>`;
  }).join('');
  sidebar.innerHTML = roundInfo + players;
}

// ── 渲染舞台 ──────────────────────────────────────────────────
function renderStage(state) {
  const el = document.getElementById('stage-cards');
  const meta = document.getElementById('stage-meta');

  if (!state.stage?.length) {
    el.innerHTML = '<div class="stage-empty">在场组为空 — 第一个出牌吧！</div>';
    meta.innerHTML = '';
    return;
  }

  const n = state.stage.length;
  el.innerHTML = state.stage.map((card, i) => {
    let endBadge = '';
    if (n > 1) {
      if (i === 0) endBadge = '<div class="stage-end-badge end-left">←左</div>';
      if (i === n - 1) endBadge = '<div class="stage-end-badge end-right">右→</div>';
    }
    return `<div class="stage-card-wrap">${endBadge}${cardHtml(card, { stage: true })}</div>`;
  }).join('');

  const ownerName = state.players.find(p => p.id === state.stageOwner)?.name || '?';
  const typeBadge = state.stageType === 'set'
    ? '<span class="type-badge badge-set">同号组</span>'
    : '<span class="type-badge badge-seq">顺子</span>';
  meta.innerHTML = `${ownerName} 出了 ${n} 张${typeBadge}`;
}

// ── 渲染手牌 ──────────────────────────────────────────────────
function renderHand(hand) {
  const el = document.getElementById('my-hand-cards');
  const badge = document.getElementById('hand-count-badge');
  badge.textContent = `(${hand.length}张)`;
  el.innerHTML = hand.map((card, i) =>
    cardHtml(card, { index: i, selected: selectedIndices.includes(i), onClick: `toggleCard(${i})` })
  ).join('');
}

// ── 切换选牌 ──────────────────────────────────────────────────
function toggleCard(i) {
  if (!isMyTurn) return showToast('还没轮到你', 'error');
  const pos = selectedIndices.indexOf(i);
  if (pos === -1) selectedIndices.push(i);
  else selectedIndices.splice(pos, 1);
  selectedIndices.sort((a, b) => a - b);
  renderHand(gameState.myHand);
  updateActionBtns();
}

// ── 按钮状态 ──────────────────────────────────────────────────
function updateActionBtns() {
  const btnShow = document.getElementById('btn-show');
  const btnScout = document.getElementById('btn-scout');
  const btnSS = document.getElementById('btn-scout-show');
  const playing = isMyTurn && gameState?.state === 'playing';
  
  // 如果正在等待完成"挖角并演出"，禁用挖角相关按钮
  if (window._scoutAndShowPending) {
    btnShow.disabled = selectedIndices.length === 0;
    btnScout.disabled = true;
    btnSS.disabled = true;
    return;
  }
  
  if (!playing) {
    [btnShow, btnScout, btnSS].forEach(b => b.disabled = true);
    return;
  }
  const hasStage = !!gameState.stage?.length;
  btnShow.disabled = selectedIndices.length === 0;
  btnScout.disabled = !hasStage;
  btnSS.disabled = !hasStage || gameState.usedScoutAndShow;
}

// ── 渲染完整游戏状态 ──────────────────────────────────────────
function renderState(state) {
  gameState = state;
  isMyTurn = state.currentPlayerId === myPlayerId && state.state === 'playing';

  document.getElementById('round-num').textContent = state.roundNumber;
  renderPlayersTop(state);
  renderPlayersSidebar(state);
  renderScoreBar(state);
  renderStage(state);
  renderHand(state.myHand || []);
  updateActionBtns();

  const waiting = document.getElementById('waiting-bar');
  waiting.style.display = (!isMyTurn && state.state === 'playing') ? 'block' : 'none';

  if (state.state === 'flip_phase') showFlipModal(state);
  else document.getElementById('flip-modal').style.display = 'none';
}

// ── 翻牌阶段 ──────────────────────────────────────────────────
function showFlipModal(state) {
  document.getElementById('flip-modal').style.display = 'flex';
  const preview = document.getElementById('flip-preview');
  preview.innerHTML = (state.myHand || []).map(c => cardHtml(c)).join('');

  const statusEl = document.getElementById('flip-status-row');
  statusEl.innerHTML = state.players.map(p => `
    <div class="flip-stat-chip ${p.flipConfirmed ? 'done' : ''}">
      ${p.name} ${p.flipConfirmed ? '✅' : '⏳'}
    </div>
  `).join('');
}

function doFlip() { socket.emit('flip_hand'); }
function doConfirmFlip() { socket.emit('confirm_flip'); }

// ── 演出（SHOW）──────────────────────────────────────────────
function doShow() {
  if (!selectedIndices.length) return showToast('请先点击手牌（需连续位置）', 'error');
  socket.emit('show', { cardIndices: selectedIndices });
  selectedIndices = [];
}

// ── Scout面板 ─────────────────────────────────────────────────
function openScoutModal(isAndShow = false) {
  scoutAndShowMode = isAndShow;
  selPos = null; selInsertIdx = 0; willFlip = false;

  const title = document.getElementById('scout-modal-title');
  const desc = document.getElementById('scout-modal-desc');
  const ssHint = document.getElementById('scout-and-show-hint');
  const confirmBtn = document.getElementById('scout-confirm-btn');

  if (isAndShow) {
    title.textContent = '⚡ 挖角并演出';
    desc.textContent = '先挖角取1张牌插入手牌，然后选连续手牌演出。每轮限用1次。';
    ssHint.style.display = 'block';
    confirmBtn.textContent = '确认挖角（去选牌演出）';
  } else {
    title.textContent = '🔍 挖角';
    desc.textContent = '从在场组两端取1张牌（每次只取1张！），插入手牌任意位置。';
    ssHint.style.display = 'none';
    confirmBtn.textContent = '确认挖角';
  }

  renderScoutPositions();
  renderInsertPreview();
  document.getElementById('scouted-preview').style.display = 'none';
  document.getElementById('scout-modal').style.display = 'flex';
}

function closeScoutModal() {
  document.getElementById('scout-modal').style.display = 'none';
  selPos = null; willFlip = false;
}

// ── 渲染左右端选项 ────────────────────────────────────────────
function renderScoutPositions() {
  const stage = gameState?.stage || [];
  const leftCard = stage[0];
  const rightCard = stage[stage.length - 1];

  // 左端
  const pLeft = document.getElementById('preview-left');
  const fLeft = document.getElementById('flip-left-wrap');
  if (leftCard) {
    pLeft.innerHTML = miniCardHtml(leftCard);
    fLeft.style.display = (leftCard.top !== leftCard.bottom) ? 'block' : 'none';
    document.getElementById('flip-left-cb').checked = false;
  } else {
    pLeft.innerHTML = '<div style="color:var(--muted);font-size:0.75rem;">无</div>';
    fLeft.style.display = 'none';
  }

  // 右端
  const pRight = document.getElementById('preview-right');
  const fRight = document.getElementById('flip-right-wrap');
  if (rightCard && stage.length > 1) {
    pRight.innerHTML = miniCardHtml(rightCard);
    fRight.style.display = (rightCard.top !== rightCard.bottom) ? 'block' : 'none';
    document.getElementById('flip-right-cb').checked = false;
  } else {
    pRight.innerHTML = stage.length === 1
      ? '<div style="font-size:0.65rem;color:var(--muted);">(同左端)</div>'
      : '<div style="color:var(--muted);font-size:0.75rem;">无</div>';
    fRight.style.display = 'none';
  }
}

// ── 选择左/右端 ──────────────────────────────────────────────
function selectPos(pos) {
  selPos = pos;
  willFlip = false;
  document.getElementById('pos-left').classList.toggle('selected', pos === 'left');
  document.getElementById('pos-right').classList.toggle('selected', pos === 'right');
  document.getElementById('flip-left-cb').checked = false;
  document.getElementById('flip-right-cb').checked = false;

  // 显示挖到的牌预览
  const stage = gameState?.stage || [];
  const card = pos === 'left' ? stage[0] : stage[stage.length - 1];
  if (card) {
    const prev = document.getElementById('scouted-preview');
    prev.style.display = 'flex';
    document.getElementById('scouted-card-show').innerHTML = renderScoutedCardBig(card, false);
  }
  renderInsertPreview();
}

// ── 翻转checkbox变化 ──────────────────────────────────────────
function onFlipChange() {
  if (!selPos) return;
  const cbId = selPos === 'left' ? 'flip-left-cb' : 'flip-right-cb';
  willFlip = document.getElementById(cbId).checked;
  const stage = gameState?.stage || [];
  const card = selPos === 'left' ? stage[0] : stage[stage.length - 1];
  if (card) {
    document.getElementById('scouted-card-show').innerHTML = renderScoutedCardBig(card, willFlip);
  }
  renderInsertPreview();
}

// ── 渲染"将挖到的牌"大预览 ───────────────────────────────────
function renderScoutedCardBig(card, flipped) {
  const displayCard = flipped
    ? { ...card, face: card.face === 'top' ? 'bottom' : 'top' }
    : card;
  const val = cv(displayCard), other = co(displayCard);
  return `
    <div style="display:inline-block;width:44px;height:60px;border-radius:7px;background:#fff;
                position:relative;display:flex;flex-direction:column;align-items:center;
                justify-content:center;box-shadow:0 2px 10px rgba(0,0,0,0.4);border:1.5px solid var(--gold);">
      <div style="position:absolute;top:2px;left:3px;font-size:0.52rem;color:#aaa;">${other}</div>
      <div style="font-size:1.4rem;font-weight:900;color:#1a1a2e;" class="${vc(val)}">${val}</div>
      <div style="position:absolute;bottom:2px;right:3px;font-size:0.52rem;color:#aaa;">${other}</div>
    </div>
    <div style="font-size:0.68rem;color:var(--muted);margin-top:4px;">
      ${flipped ? '（已翻转）' : '（以当前面插入）'}
    </div>`;
}

// ── 插入位置可视化 ────────────────────────────────────────────
function renderInsertPreview() {
  const container = document.getElementById('insert-preview-row');
  const hint = document.getElementById('insert-hint');
  const hand = gameState?.myHand || [];
  const stage = gameState?.stage || [];
  const scoutedCard = selPos ? (selPos === 'left' ? stage[0] : stage[stage.length - 1]) : null;

  let html = '';
  for (let i = 0; i <= hand.length; i++) {
    if (i === selInsertIdx && scoutedCard) {
      // 橙色插入线 + 挖到的牌
      html += `<div class="mini-insert-line"></div>`;
      const dc = willFlip
        ? { ...scoutedCard, face: scoutedCard.face === 'top' ? 'bottom' : 'top' }
        : scoutedCard;
      const val = cv(dc);
      html += `<div class="mini-scouted ${vc(val)}" style="background:${cardBg(val)};color:#1a1a2e;">${val}</div>`;
    } else {
      html += `<div class="mini-slot" onclick="setInsert(${i})"></div>`;
    }
    if (i < hand.length) {
      html += miniCardHtml(hand[i]).replace('mini-card', 'mini-card').replace('<div', `<div onclick="setInsert(${i + 1})"`);
    }
  }
  container.innerHTML = html;
  hint.textContent = scoutedCard
    ? `将插在第 ${selInsertIdx + 1} 位（点击位置线或牌面调整）`
    : '请先选择取哪端的牌';
}

function setInsert(idx) {
  selInsertIdx = idx;
  renderInsertPreview();
}

// ── 确认挖角 ──────────────────────────────────────────────────
function confirmScout() {
  if (!selPos) return showToast('请先选择左端或右端', 'error');

  if (scoutAndShowMode) {
    // 挖角并演出模式：调用专门的准备接口
    window._scoutAndShowPending = true;
    socket.emit('prepare_scout_and_show', { 
      scoutPosition: selPos, 
      insertIndex: selInsertIdx, 
      flipCard: willFlip 
    });
    closeScoutModal();
    showToast('⏳ 正在挖角...请稍候', 'info');
    selectedIndices = [];
  } else {
    socket.emit('scout', { position: selPos, insertIndex: selInsertIdx, flipCard: willFlip });
    closeScoutModal();
    selectedIndices = [];
  }
}

function doPendingScoutAndShow() {
  if (!selectedIndices.length) return showToast('请先选择要演出的连续手牌', 'error');
  // 挖角已完成，现在完成演出部分
  socket.emit('finish_scout_and_show', { showIndices: selectedIndices });
  selectedIndices = [];
  window._scoutAndShowPending = false;
  resetShowBtn();
}

function resetShowBtn() {
  const btn = document.getElementById('btn-show');
  btn.textContent = '🎭 演出';
  btn.onclick = doShow;
}

// ── 下一轮 / 返回大厅 ────────────────────────────────────────
function nextRound() {
  document.getElementById('round-end-modal').style.display = 'none';
  socket.emit('next_round');
}

function backToLobby() {
  clearGameSession(); // 返回大厅时清除会话
  window.location.href = '/';
}

// ── 回合结束弹窗 ──────────────────────────────────────────────
function showRoundEnd(data) {
  document.getElementById('round-winner-text').textContent = `🏆 ${data.roundWinnerName} 赢得了本轮！`;

  const sorted = Object.entries(data.totalScores).sort(([, a], [, b]) => b - a);
  document.getElementById('round-scores-body').innerHTML = sorted.map(([id, total]) => {
    const name = data.playerNames[id] || id;
    const rs = data.roundScores[id] || 0;
    const isWin = id === data.roundWinnerId;
    const cards = data.scoreCards?.[id] || 0;  // 演出获得的分数卡
    const tok = data.scoutTokens?.[id] || 0;   // 被挖角获得的补偿
    const hc = data.handCounts?.[id] || 0;     // 剩余手牌
    const detail = isWin
      ? `🎴${cards} + 🎫${tok}（赢家不扣）`
      : `🎴${cards} + 🎫${tok} − 🃏${hc} = ${rs}`;
    return `<tr class="${isWin ? 'winner' : ''}">
      <td>${name}${isWin ? ' 🏆' : ''}</td>
      <td style="font-size:0.7rem;color:var(--muted);">${detail}</td>
      <td style="color:${rs >= 0 ? 'var(--green)' : 'var(--red)'};">${rs >= 0 ? '+' : ''}${rs}</td>
      <td><strong>${total}</strong></td>
    </tr>`;
  }).join('');

  document.getElementById('btn-next-round').style.display = data.gameOver ? 'none' : 'block';
  document.getElementById('round-end-modal').style.display = 'flex';
}

function showGameEnd(data) {
  document.getElementById('round-end-modal').style.display = 'none';
  document.getElementById('game-winner-name').textContent = `🏆 ${data.gameWinnerName}`;

  const sorted = Object.entries(data.totalScores).sort(([, a], [, b]) => b - a);
  const medals = ['🥇','🥈','🥉'];
  document.getElementById('game-scores-body').innerHTML = sorted.map(([id, sc], rank) => {
    const name = data.playerNames[id] || id;
    return `<tr class="${id === data.gameWinnerId ? 'winner' : ''}">
      <td>${medals[rank] || (rank + 1)}</td>
      <td>${name}</td>
      <td><strong>${sc}</strong></td>
    </tr>`;
  }).join('');

  document.getElementById('game-end-modal').style.display = 'flex';
}

// ── Socket 事件 ───────────────────────────────────────────────

socket.on('connect', () => {
  if (myRoomCode && myPlayerId) {
    socket.emit('rejoin_game', { roomCode: myRoomCode, playerId: myPlayerId });
    document.getElementById('action-log').textContent = '🔄 连接中...';
  }
});

socket.on('rejoin_result', ({ success, state, message }) => {
  if (success && state) {
    renderState(state);
    document.getElementById('action-log').textContent =
      state.state === 'flip_phase' ? '游戏开始！请决定是否翻转手牌' : '游戏进行中';
  } else {
    showToast('⚠️ ' + (message || '连接失败'), 'error');
    clearGameSession(); // 重连失败,清除会话
    setTimeout(() => { window.location.href = '/'; }, 2500);
  }
});

socket.on('game_state', (state) => renderState(state));

socket.on('hand_updated', ({ myHand, message }) => {
  if (gameState) {
    gameState.myHand = myHand;
    renderHand(myHand);
    const fprev = document.getElementById('flip-preview');
    if (fprev) fprev.innerHTML = myHand.map(c => cardHtml(c)).join('');
  }
  showToast(message, 'success');
});

socket.on('phase_changed', ({ phase }) => {
  if (phase === 'playing') {
    document.getElementById('flip-modal').style.display = 'none';
    document.getElementById('action-log').textContent = '游戏正式开始！轮流出牌...';
  }
});

socket.on('action_log', ({ type, playerName, position }) => {
  const msgs = {
    show: `${playerName} 出牌`,
    scout: `${playerName} 从${position === 'left' ? '左' : '右'}端挖了1张`,
    scout_and_show: `${playerName} 挖角并演出！`,
  };
  document.getElementById('action-log').textContent = msgs[type] || '';
});

socket.on('scout_prepared', ({ message }) => {
  showToast(message, 'success');
  const btn = document.getElementById('btn-show');
  btn.textContent = '⚡ 确认演出（完成挖+演）';
  btn.onclick = doPendingScoutAndShow;
  updateActionBtns(); // 更新按钮状态，禁用挖角按钮
});

socket.on('action_error', ({ message }) => {
  showToast('❌ ' + message, 'error');
  selectedIndices = [];
  window._scoutAndShowPending = false;
  if (gameState) renderHand(gameState.myHand);
  updateActionBtns();
  resetShowBtn();
});

socket.on('round_end', (data) => showRoundEnd(data));

socket.on('game_over', (data) => {
  showRoundEnd(data);
  setTimeout(() => showGameEnd(data), 1200);
});

socket.on('round_started', ({ roundNumber }) => {
  document.getElementById('round-num').textContent = roundNumber;
  document.getElementById('action-log').textContent = `第 ${roundNumber} 轮开始！`;
  selectedIndices = [];
  resetShowBtn();
});

socket.on('player_offline', ({ playerName }) => {
  showToast(`${playerName} 暂时离线`, 'error');
});

socket.on('error', ({ message }) => showToast('⚠️ ' + message, 'error'));

// ── 聊天系统 ───────────────────────────────────────────────────

// 快捷用语和Emoji定义
const QUICK_PHRASES = {
  gg: { text: 'GG！', emoji: '🎉' },
  nice: { text: '漂亮！', emoji: '👍' },
  think: { text: '让我想想...', emoji: '🤔' },
  oops: { text: '哎呀！', emoji: '😅' },
  wow: { text: '哇！', emoji: '😲' },
  sorry: { text: '抱歉~', emoji: '🙏' },
  hurry: { text: '快点啦！', emoji: '⏰' },
  lucky: { text: '运气真好！', emoji: '🍀' },
  unlucky: { text: '太背了...', emoji: '💔' },
  comeOn: { text: '加油！', emoji: '💪' }
};

const EMOJI_LIST = [
  '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂',
  '🙂', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗',
  '😚', '😙', '🥲', '😋', '😛', '😜', '🤪', '😝',
  '🤗', '🤭', '🫢', '🫣', '🤫', '🤔', '🫡', '🤐',
  '🤨', '😐', '😑', '😶', '😏', '😒', '🙄', '😬',
  '🤗', '🤔', '😎', '🤓', '🥳', '😱', '😭', '😤',
  '👍', '👎', '👌', '✌️', '🤞', '🤝', '🙏', '💪',
  '🎉', '🎊', '🎈', '🎁', '🏆', '🥇', '❤️', '💔',
  '💯', '🔥', '⭐', '✨', '⚡', '💰', '🍀'
];

// 初始化聊天系统
(function initChatSystem() {
  // 生成emoji列表
  const emojiList = document.getElementById('emoji-list');
  if (emojiList) {
    emojiList.innerHTML = EMOJI_LIST.map(emoji => 
      `<button onclick="sendEmoji('${emoji}')">${emoji}</button>`
    ).join('');
  }
  
  // 监听聊天消息
  socket.on('chat_message', (message) => {
    displayChatMessage(message);
  });
})();

// 切换聊天输入面板
function toggleChatInput() {
  const panel = document.getElementById('chat-input-panel');
  panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  
  if (panel.style.display === 'block') {
    const input = document.getElementById('chat-input');
    if (input) input.focus();
  }
}

// 发送文本消息
function sendTextMessage() {
  const input = document.getElementById('chat-input');
  const content = input.value.trim();
  
  if (!content) return;
  if (content.length > 50) {
    showToast('消息最多50字符', 'error');
    return;
  }
  
  socket.emit('send_chat', { type: 'text', content });
  input.value = '';
}

// 发送快捷用语
function sendQuick(phraseId) {
  const phrase = QUICK_PHRASES[phraseId];
  if (!phrase) return;
  
  socket.emit('send_chat', { 
    type: 'quick', 
    content: `${phrase.text} ${phrase.emoji}` 
  });
  toggleChatInput();
}

// 发送Emoji
function sendEmoji(emoji) {
  socket.emit('send_chat', { type: 'emoji', content: emoji });
}

// 显示聊天消息（弹幕式）
function displayChatMessage(message) {
  console.log('[聊天] 收到消息:', message);
  const container = document.getElementById('chat-messages');
  if (!container) {
    console.error('[聊天] 找不到chat-messages容器');
    return;
  }
  
  const div = document.createElement('div');
  div.className = 'chat-message';
  
  // 根据类型显示不同样式
  let content = '';
  if (message.type === 'text') {
    const senderSpan = document.createElement('span');
    senderSpan.className = 'sender';
    senderSpan.textContent = message.playerName + ':';
    
    const contentText = document.createTextNode(' ' + message.content);
    
    div.appendChild(senderSpan);
    div.appendChild(contentText);
  } else if (message.type === 'emoji') {
    const senderSpan = document.createElement('span');
    senderSpan.className = 'sender';
    senderSpan.textContent = message.playerName;
    
    const emojiText = document.createTextNode(' ' + message.content);
    
    div.appendChild(senderSpan);
    div.appendChild(emojiText);
  } else if (message.type === 'quick') {
    const senderSpan = document.createElement('span');
    senderSpan.className = 'sender';
    senderSpan.textContent = message.playerName + ':';
    
    const contentText = document.createTextNode(' ' + message.content);
    
    div.appendChild(senderSpan);
    div.appendChild(contentText);
  }
  
  container.appendChild(div);
  console.log('[聊天] 消息已添加到DOM，当前消息数:', container.children.length);
  
  // 5秒后自动移除
  setTimeout(() => {
    if (div.parentNode) {
      div.remove();
      console.log('[聊天] 消息已淡出移除');
    }
  }, 5000);
  
  // 限制最多显示10条
  while (container.children.length > 10) {
    container.removeChild(container.firstChild);
  }
}
