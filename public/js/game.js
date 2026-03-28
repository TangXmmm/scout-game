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
let pendingFinishScoutAndShow = false; // 挖角已完成，等待演出第二步
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
  // 正确的颜色映射：10最强（红色），1最弱（蓝色）
  if (val >= 10) return 'vc10'; // 10 红色（最强）
  if (val >= 9) return 'vc9';   // 9 橙色
  if (val >= 7) return 'vc7';   // 7-8 黄色
  if (val >= 5) return 'vc5';   // 5-6 绿色
  if (val >= 3) return 'vc3';   // 3-4 青色
  return 'vc1';                  // 1-2 蓝色（最弱）
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

// ── 更新实时分数条（移动端）────────────────────────────────────
function renderScoreBar(state) {
  const bar = document.getElementById('score-bar');
  if (!bar || !state?.players) { if (bar) bar.innerHTML = ''; return; }
  bar.innerHTML = state.players.map(p => {
    const cards = p.scoreCards || 0;
    const tok = p.scoutTokens || 0;
    const hc = p.handCount || 0;
    const live = cards + tok - hc;
    return `<div class="sc-chip">
      <span class="sc-name">${p.name}</span>
      <span class="sc-tok"> · T${tok}</span>
      <span class="sc-hand"> · 🃏${hc}</span>
      <span class="sc-total ${live < 0 ? 'neg' : ''}">=<strong>${live >= 0 ? '+' : ''}${live}</strong></span>
    </div>`;
  }).join('');
}

// ── 渲染玩家条（移动端 top bar）──────────────────────────────
function renderPlayersTop(state) {
  const bar = document.getElementById('players-top-bar');
  if (!bar) return;
  bar.innerHTML = state.players.map(p => {
    const isMe = p.id === myPlayerId;
    const active = p.id === state.currentPlayerId;
    let cls = 'player-chip';
    if (isMe) cls += ' is-me';
    if (active) cls += ' active';
    const tok = p.scoutTokens || 0;
    const hc = p.handCount || 0;
    const live = (p.scoreCards || 0) + tok - hc;
    return `<div class="${cls}">
      <div class="chip-av">${p.name[0]}</div>
      <div>
        <div class="chip-name">${p.name}${isMe ? ' 我' : ''}</div>
        <div class="chip-meta">总${p.totalScore} · <span class="chip-live">${live >= 0 ? '+' : ''}${live}</span></div>
        ${active ? '<div style="font-size:0.58rem;color:var(--accent-primary);">▶ 行动中</div>' : ''}
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
    const statusText = active ? '<span style="color:var(--accent-primary);font-weight:700;">▶ 行动中</span>' : '<span style="color:var(--text-tertiary);">等待中</span>';
    return `<div class="sidebar-player ${active ? 'active' : ''}">
      ${active ? '<div style="font-size:0.6rem;color:var(--accent-primary);letter-spacing:1px;margin-bottom:6px;">当前行动</div>' : ''}
      <div class="sp-head">
        <div class="player-avatar" style="width:28px;height:28px;font-size:0.75rem;flex-shrink:0;">${p.name[0]}</div>
        <div class="sp-name">${p.name}${isMe ? ' (我)' : ''}</div>
      </div>
      <div class="sp-stats">
        <div class="sp-stat"><div class="sp-stat-label">总分</div><div class="sp-stat-val">${p.totalScore}</div></div>
        <div class="sp-stat"><div class="sp-stat-label">Token</div><div class="sp-stat-val tok">${tok}</div></div>
        <div class="sp-stat"><div class="sp-stat-label">手牌</div><div class="sp-stat-val hand">${hc}</div></div>
        <div class="sp-stat"><div class="sp-stat-label">实时</div><div class="sp-stat-val" style="color:${live>=0?'var(--state-success)':'var(--state-danger)'}">${live >= 0 ? '+' : ''}${live}</div></div>
      </div>
      <div class="sp-status">${statusText}${p.usedScoutAndShow ? ' · <span style="font-size:0.65rem;color:var(--text-tertiary);">已用挖+演</span>' : ''}</div>
    </div>`;
  }).join('');
  sidebar.innerHTML = roundInfo + players;
}

// ── 渲染舞台 ──────────────────────────────────────────────────
function renderStage(state) {
  const el = document.getElementById('stage-cards');
  const meta = document.getElementById('stage-meta');
  const hint = document.getElementById('stage-hint');
  const emptyView = document.getElementById('stage-empty-view');
  const emptyWho = document.getElementById('stage-empty-who');

  if (!state.stage?.length) {
    el.innerHTML = '';
    if (emptyView) {
      el.appendChild(emptyView);
      emptyView.style.display = 'flex';
      const starter = state.players.find(p => p.id === state.currentPlayerId)?.name || '？';
      if (emptyWho) emptyWho.textContent = `本轮由 ${starter} 先出牌`;
    } else {
      el.innerHTML = '<div class="stage-empty"><div class="stage-empty-slot"></div><div class="stage-empty-main">在场组为空</div><div class="stage-empty-sub">请选择连续牌进行演出</div></div>';
    }
    if (meta) meta.textContent = '';
    if (hint) hint.textContent = '';
    return;
  }

  if (emptyView) emptyView.style.display = 'none';

  const n = state.stage.length;
  el.innerHTML = state.stage.map((card, i) => {
    let endBadge = '';
    if (n > 1) {
      if (i === 0) endBadge = '<div class="stage-end-badge end-left">←左端</div>';
      if (i === n - 1) endBadge = '<div class="stage-end-badge end-right">右端→</div>';
    }
    return `<div class="stage-card-wrap">${endBadge}${cardHtml(card, { stage: true })}</div>`;
  }).join('');

  const ownerName = state.players.find(p => p.id === state.stageOwner)?.name || '?';
  const typeStr = state.stageType === 'set' ? '同号组' : '顺子';
  const minVal = Math.min(...state.stage.map(c => cv(c)));
  if (meta) meta.innerHTML = `<span style="color:var(--accent-primary);font-weight:700;">${ownerName}</span> 的 ${n}张${typeStr} · 最小值 ${minVal}`;
  if (hint) {
    hint.className = 'hint-emphasis';
    hint.textContent = isMyTurn ? `需压过：${n}张${typeStr}（最小值>${minVal}）或更多张数` : `等待当前玩家出牌`;
  }
}

// ── 渲染手牌 ──────────────────────────────────────────────────
function renderHand(hand) {
  const el = document.getElementById('my-hand-cards');
  const badge = document.getElementById('hand-count-badge');
  if (badge) badge.textContent = `${hand.length}张`;
  el.innerHTML = hand.map((card, i) =>
    cardHtml(card, { index: i, selected: selectedIndices.includes(i), onClick: `toggleCard(${i})` })
  ).join('');
}

// ── 切换选牌 ──────────────────────────────────────────────────
function toggleCard(i) {
  // Bug2修复：pendingFinishScoutAndShow 状态下也允许选牌（挖角已完成，等待选牌演出）
  if (!isMyTurn && !pendingFinishScoutAndShow) return showToast('还没轮到你', 'error');
  const pos = selectedIndices.indexOf(i);
  if (pos === -1) selectedIndices.push(i);
  else selectedIndices.splice(pos, 1);
  selectedIndices.sort((a, b) => a - b);
  renderHand(gameState.myHand);
  updateActionBtns();
}

// ── 按钮状态（动态优先级）────────────────────────────────────
function updateActionBtns() {
  const btnShow = document.getElementById('btn-show');
  const btnScout = document.getElementById('btn-scout');
  const btnSS = document.getElementById('btn-scout-show');
  if (!btnShow || !btnScout || !btnSS) return;
  const playing = isMyTurn && gameState?.state === 'playing';

  // ── pendingFinishScoutAndShow：挖角已完成，等待选牌演出 ──
  if (pendingFinishScoutAndShow) {
    const hasSelected = selectedIndices.length > 0;
    btnShow.disabled = !hasSelected;
    btnShow.textContent = hasSelected ? '⚡ 演出（完成挖角并演出）' : '演出';
    btnShow.classList.toggle('act-primary', hasSelected);
    btnScout.disabled = true;
    btnScout.classList.remove('act-primary');
    btnSS.disabled = true;
    btnSS.classList.remove('act-primary');
    return;
  }

  // 恢复演出按钮文字
  btnShow.textContent = '演出';

  if (!playing) {
    [btnShow, btnScout, btnSS].forEach(b => {
      b.disabled = true;
      b.classList.remove('act-primary');
    });
    return;
  }

  const hasStage = !!gameState.stage?.length;
  const hasSelected = selectedIndices.length > 0;

  // 重置所有按钮为次按钮
  [btnShow, btnScout, btnSS].forEach(b => b.classList.remove('act-primary'));

  if (!hasStage) {
    // 桌面为空：只能演出（先手），挖角/挖+演禁用
    btnShow.disabled = !hasSelected;
    if (!hasSelected) btnShow.classList.add('act-primary'); // 提示用户选牌
    else btnShow.classList.add('act-primary');
    btnScout.disabled = true;
    btnSS.disabled = true;
  } else if (hasSelected) {
    // 选了牌：演出为主按钮
    btnShow.disabled = false;
    btnShow.classList.add('act-primary');
    btnScout.disabled = false;
    btnSS.disabled = gameState.usedScoutAndShow;
  } else {
    // 有场组但没选牌：挖角为主按钮
    btnShow.disabled = true;
    btnScout.disabled = false;
    btnScout.classList.add('act-primary');
    btnSS.disabled = gameState.usedScoutAndShow;
  }
}

// ── 渲染完整游戏状态 ──────────────────────────────────────────
function renderState(state) {
  gameState = state;
  isMyTurn = state.currentPlayerId === myPlayerId && state.state === 'playing';

  // 更新轮次
  const roundEl = document.getElementById('round-num');
  const turnEl = document.getElementById('turn-num');
  if (roundEl) roundEl.textContent = state.roundNumber;
  if (turnEl && state.turnNumber) turnEl.textContent = state.turnNumber;

  // 更新顶部状态条
  const actionLog = document.getElementById('action-log');
  const headerRight = document.getElementById('header-right');
  if (actionLog) {
    const activeName = state.players.find(p => p.id === state.currentPlayerId)?.name || '...';
    if (state.state === 'playing') {
      actionLog.innerHTML = `当前行动：<span class="active-player">${activeName}</span>`;
    } else if (state.state === 'flip_phase') {
      actionLog.textContent = '请决定是否翻转手牌';
    }
  }
  if (headerRight) {
    if (isMyTurn) headerRight.textContent = '请选择手牌';
    else if (!pendingFinishScoutAndShow && state.state === 'playing') headerRight.textContent = '等待其他玩家';
    else headerRight.textContent = '';
  }

  renderPlayersTop(state);
  renderPlayersSidebar(state);
  renderScoreBar(state);
  renderStage(state);
  renderHand(state.myHand || []);
  updateActionBtns();

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
  if (pendingFinishScoutAndShow) {
    // 挖角并演出第二步：用已更新的手牌索引完成演出
    // 注意：先不重置 pendingFinishScoutAndShow，等服务端成功响应（game_state）后
    // renderState 会正常渲染，pendingFinishScoutAndShow=false 在收到响应后重置
    // 如果失败（action_error），保留 pending 让用户重新选牌
    socket.emit('finish_scout_and_show', { showIndices: selectedIndices });
    // 乐观重置（如果失败，action_error 处理器会保留 pending 状态）
    pendingFinishScoutAndShow = false;
    selectedIndices = [];
  } else {
    socket.emit('show', { cardIndices: selectedIndices });
    selectedIndices = [];
  }
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
    desc.textContent = '选择挖角位置，确认后牌会进入手牌，再从手牌中选牌演出。每轮限用1次。';
    ssHint.style.display = 'block';
    confirmBtn.textContent = '✅ 确认挖角（挖完再选牌演出）';
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
    // 只有两面值不同的牌才有翻转意义
    fLeft.style.display = (leftCard.top !== leftCard.bottom) ? 'block' : 'none';
    document.getElementById('flip-left-cb').checked = false;
  } else {
    pLeft.innerHTML = '<div style="color:var(--muted);font-size:0.75rem;">无</div>';
    fLeft.style.display = 'none';
  }

  // 右端：当在场组只有1张时，右端与左端是同一张，仍应显示该张牌（可翻转）
  const pRight = document.getElementById('preview-right');
  const fRight = document.getElementById('flip-right-wrap');
  if (stage.length === 0) {
    pRight.innerHTML = '<div style="color:var(--muted);font-size:0.75rem;">无</div>';
    fRight.style.display = 'none';
  } else if (stage.length === 1) {
    // 只有1张时右端就是左端那张，同样显示并允许翻转
    pRight.innerHTML = miniCardHtml(rightCard);
    fRight.style.display = (rightCard.top !== rightCard.bottom) ? 'block' : 'none';
    document.getElementById('flip-right-cb').checked = false;
  } else {
    pRight.innerHTML = miniCardHtml(rightCard);
    fRight.style.display = (rightCard.top !== rightCard.bottom) ? 'block' : 'none';
    document.getElementById('flip-right-cb').checked = false;
  }
}

// ── 选择左/右端 ──────────────────────────────────────────────
function selectPos(pos) {
  selPos = pos;
  // Bug3修复：切换端时不重置 willFlip，让用户保持翻转意图
  // 仅重置两端的 checkbox 到未选中（用户需重新选择）
  document.getElementById('pos-left').classList.toggle('selected', pos === 'left');
  document.getElementById('pos-right').classList.toggle('selected', pos === 'right');
  // 清除另一端的 checkbox，保留当前端（不重置willFlip，由onFlipChange驱动）
  if (pos === 'left') {
    document.getElementById('flip-right-cb').checked = false;
  } else {
    document.getElementById('flip-left-cb').checked = false;
  }
  // 读取当前端 checkbox 状态同步 willFlip
  const cbId = pos === 'left' ? 'flip-left-cb' : 'flip-right-cb';
  willFlip = document.getElementById(cbId).checked;

  // 显示挖到的牌预览
  const stage = gameState?.stage || [];
  const card = pos === 'left' ? stage[0] : stage[stage.length - 1];
  if (card) {
    const prev = document.getElementById('scouted-preview');
    prev.style.display = 'flex';
    document.getElementById('scouted-card-show').innerHTML = renderScoutedCardBig(card, willFlip);
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
    // Bug1+Bug2修复：两步流程
    // 第一步：仅发送 prepare_scout_and_show（挖角入手），不要求事先选好手牌
    // 第二步：等服务端返回 scout_prepared 后，用户在手牌中选牌，再点「演出」
    socket.emit('prepare_scout_and_show', {
      scoutPosition: selPos,
      insertIndex: selInsertIdx,
      flipCard: willFlip        // Bug1修复：翻转参数正确传递
    });
    closeScoutModal();
    selectedIndices = [];       // 清空，等服务端更新手牌后重新选
  } else {
    socket.emit('scout', { position: selPos, insertIndex: selInsertIdx, flipCard: willFlip });
    closeScoutModal();
    selectedIndices = [];
  }
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
    const logEl = document.getElementById('action-log');
    if (logEl) logEl.textContent = '连接中…';
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
    show: `${playerName} 出牌成功`,
    scout: `${playerName} 从${position === 'left' ? '左' : '右'}端挖了1张`,
    scout_and_show: `${playerName} 挖角并演出！`,
  };
  const logEl = document.getElementById('action-log');
  if (logEl) logEl.innerHTML = `<span class="active-player">${playerName}</span> · ${msgs[type]?.split(' · ')?.[1] || (msgs[type] || '').replace(playerName + ' ', '')}`;
});

// ── scout_prepared：挖角第一步成功，等待用户选牌演出 ─────────
// 注意：服务端会同时广播 game_state（手牌已更新），
// game_state 和 scout_prepared 到达顺序不固定，
// 所以 pendingFinishScoutAndShow=true 必须在两个事件各自设置，
// renderState 里读取 pendingFinishScoutAndShow 时它已是 true（幂等）
socket.on('scout_prepared', () => {
  pendingFinishScoutAndShow = true;
  selectedIndices = [];
  showToast('✅ 挖角成功！请在手牌中选连续的牌，然后点「演出」完成操作', 'success');
  updateActionBtns();
});

socket.on('action_error', ({ message }) => {
  showToast('❌ ' + message, 'error');
  selectedIndices = [];
  if (gameState) renderHand(gameState.myHand);
  // 注意：不在这里恢复 pendingFinishScoutAndShow，
  // 挖+演第二步失败时由专用事件 finish_scout_error 处理，
  // 避免普通演出失败误将 pendingFinishScoutAndShow 设为 true
  updateActionBtns();
});

// ── finish_scout_error：挖+演第二步（演出）失败专用事件 ──────────
// 服务端 pendingScoutAndShow 仍有效（挖角已发生），用户可重新选牌再演出
socket.on('finish_scout_error', ({ message }) => {
  showToast('❌ ' + message, 'error');
  pendingFinishScoutAndShow = true;  // 恢复 pending，让用户重选手牌
  selectedIndices = [];
  if (gameState) renderHand(gameState.myHand);
  updateActionBtns();
});

socket.on('round_end', (data) => showRoundEnd(data));

socket.on('game_over', (data) => {
  showRoundEnd(data);
  setTimeout(() => showGameEnd(data), 1200);
});

socket.on('round_started', ({ roundNumber }) => {
  const roundEl = document.getElementById('round-num');
  if (roundEl) roundEl.textContent = roundNumber;
  const logEl = document.getElementById('action-log');
  if (logEl) logEl.textContent = `第 ${roundNumber} 局开始！`;
  selectedIndices = [];
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
  // 生成常用 emoji（12个，6x2）
  const COMMON_EMOJI = EMOJI_LIST.slice(0, 12);
  const emojiList = document.getElementById('emoji-list');
  if (emojiList) {
    emojiList.innerHTML = EMOJI_LIST.map(emoji =>
      `<button class="emoji-btn" onclick="sendEmoji('${emoji}')">${emoji}</button>`
    ).join('');
  }

  // 监听聊天消息
  socket.on('chat_message', (message) => {
    displayChatMessage(message);
  });
})();

// ── 展开/收起更多快捷语 ───────────────────────────────────────
function toggleMorePhrases() {
  const more = document.getElementById('quick-more');
  const btn = document.getElementById('qp-more-btn');
  if (!more) return;
  const open = more.classList.toggle('expanded');
  if (btn) btn.textContent = open ? '收起' : '+ 更多';
}

// 切换聊天输入面板
function toggleChatInput() {
  const panel = document.getElementById('chat-input-panel');
  if (!panel) return;
  const isHidden = panel.style.display === 'none' || !panel.style.display;
  panel.style.display = isHidden ? 'block' : 'none';
  const toggleBtn = document.getElementById('chat-toggle-btn');
  if (toggleBtn) toggleBtn.classList.toggle('has-new', false);
  if (isHidden) {
    const input = document.getElementById('chat-input');
    if (input) setTimeout(() => input.focus(), 100);
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
  // 收起面板
  const panel = document.getElementById('chat-input-panel');
  if (panel) panel.style.display = 'none';
}

// 发送Emoji
function sendEmoji(emoji) {
  socket.emit('send_chat', { type: 'emoji', content: emoji });
}

// 显示聊天消息（弹幕式）
function displayChatMessage(message) {
  const container = document.getElementById('chat-messages');
  if (!container) return;

  const div = document.createElement('div');
  div.className = 'chat-message';

  const senderSpan = document.createElement('span');
  senderSpan.className = 'sender';
  senderSpan.textContent = message.playerName + (message.type === 'text' || message.type === 'quick' ? ':' : '');
  div.appendChild(senderSpan);
  div.appendChild(document.createTextNode(' ' + message.content));

  container.appendChild(div);

  // 面板未打开时，给聊天按钮加脉冲提示
  const panel = document.getElementById('chat-input-panel');
  const toggleBtn = document.getElementById('chat-toggle-btn');
  if (panel && panel.style.display === 'none' && toggleBtn) {
    toggleBtn.classList.add('has-new');
  }

  // 停留时间：文本1.4s后淡出，emoji 1.2s后淡出；DOM 5s后移除
  const stayMs = message.type === 'emoji' ? 1200 : 1400;
  setTimeout(() => { div.style.opacity = '0'; div.style.transition = 'opacity 0.5s'; }, stayMs);
  setTimeout(() => { if (div.parentNode) div.remove(); }, 5000);

  // 限制最多显示8条
  while (container.children.length > 8) container.removeChild(container.firstChild);
}
