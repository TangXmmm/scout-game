/**
 * Scout 游戏客户端逻辑 v5 - PRD 重构版
 * - 全新视台布局
 * - 拖拽连续选牌
 * - 挖角插槽层（可视化插槽）
 * - 事件字幕
 * - 倒计时
 * - 超时/托管状态
 * - 行为记录条
 * - 局内社交面板（快捷语 + 贴纸 + 自动推荐条）
 * - 单轮结算页（高光卡片 + 倒计时自动推进）
 */

const socket = io();

// ── 状态 ──────────────────────────────────────────────────────
let myPlayerId   = null;
let myRoomCode   = null;
let gameState    = null;
let selectedIndices = [];
let isMyTurn     = false;

// 挖角 & 挖角并演出
let scoutAndShowMode          = false;
let pendingFinishScoutAndShow = false;
let selPos       = null;    // 'left' | 'right'
let selInsertIdx = 0;
let willFlip     = false;

// 倒计时
let timerInterval  = null;
let timerStartedAt = 0;
let TIMER_TOTAL    = 30;    // 秒，与服务端对齐

// 托管状态
let isManaged = false;

// 行为记录
const logItems = []; // [{text, ts}]

// 社交冷却
let chatCooldownEnd = 0;
let chatCount3s = 0;
let chatCooldownTimer = null;

// 自动推荐条上下文
let currentSuggestContext = null;
let suggestDismissTimer   = null;

// 单轮结算倒计时
let roundEndCountdown = null;

// ── 情境快捷语词典（必须在 init() IIFE 之前定义，避免 TDZ 报错）──────
const CONTEXT_PHRASES = {
  default: ['加油！', '好球！', '让我想想', '哎呀~', 'GG 吧', '厉害了'],
  show:    ['漂亮！', '这也行？', '太强了', '被压了...', '哇！', '好稳'],
  scout:   ['挖角！', '别跑！', '嘿嘿', '高手操作', '慢着！', '又挖了'],
  scout_and_show: ['太狠了', '漂亮连招！', '这也行？', '服了服了', '无解', '神操作'],
  low_hand:['即将清手！', '危了危了', '快压住他', '加油啊', '快追啊', '马上了！'],
  my_turn: ['轮到我了', '让我出', '我压你', '挖还是出？', '难选...', '这把稳了'],
};

// ── URL 参数 + 会话保存 ────────────────────────────────────────
(function init() {
  const p = new URLSearchParams(window.location.search);
  myRoomCode = p.get('room');
  myPlayerId = p.get('pid');
  if (!myRoomCode || !myPlayerId) {
    window.location.href = '/';
    return;
  }
  saveGameSession({ roomCode: myRoomCode, playerId: myPlayerId, timestamp: Date.now() });

  // 初始化社交面板快捷语
  renderQuickGrid('default');

  // ★ 必须在 IIFE 内注册 connect 事件：
  // socket = io() 在第14行即创建，本地连接极快（<1ms），
  // 若在文件末尾注册 on('connect')，事件可能已经触发过而错过。
  // 放在 IIFE 内、myRoomCode/myPlayerId 赋值之后，保证监听器先于事件触发注册好。
  socket.on('connect', () => {
    const dot = document.getElementById('conn-dot');
    if (dot) dot.className = '';
    if (myRoomCode && myPlayerId) {
      socket.emit('rejoin_game', { roomCode: myRoomCode, playerId: myPlayerId });
    }
  });

  // 若 socket 已经是 connected 状态（极罕见，防御性兜底）
  if (socket.connected && myRoomCode && myPlayerId) {
    socket.emit('rejoin_game', { roomCode: myRoomCode, playerId: myPlayerId });
  }
})();

function saveGameSession(session) {
  localStorage.setItem('scout_game_session', JSON.stringify(session));
}
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
  if (val >= 10) return 'vc10';
  if (val >= 9)  return 'vc9';
  if (val >= 7)  return 'vc7';
  if (val >= 5)  return 'vc5';
  if (val >= 3)  return 'vc3';
  return 'vc1';
}
function cardBg(val) {
  const bgs = ['#fde8e8','#fde8cc','#fef9e7','#e8f8ed','#e8f0fe'];
  return bgs[Math.min(Math.floor((val - 1) / 2), 4)];
}

// ── 渲染卡牌 HTML ──────────────────────────────────────────────
function cardHtml(card, opts = {}) {
  const val = cv(card), other = co(card);
  const selClass   = opts.selected ? 'selected' : '';
  const stageClass = opts.stage ? 'stage-card' : '';
  const newClass   = opts.isNew ? 'new-card' : '';
  const edgeClass  = opts.edgeClass || '';
  const onclick    = opts.onClick ? `onclick="${opts.onClick}"` : '';
  const idx        = opts.index !== undefined ? `data-index="${opts.index}"` : '';
  // draggable 已移除：改为纯点击选牌，draggable 在移动端会拦截 touch 导致 onclick 失效
  return `
    <div class="game-card ${selClass} ${stageClass} ${newClass} ${edgeClass}"
         ${onclick} ${idx}
         style="background:${cardBg(val)};">
      <div class="card-corner card-tl ${vc(other)}">${other}</div>
      <div class="card-main-val ${vc(val)}">${val}</div>
      <div class="card-corner card-br ${vc(other)}">${other}</div>
    </div>`;
}

function miniCardHtml(card) {
  const val = cv(card);
  return `<div class="mini-card ${vc(val)}" style="background:${cardBg(val)};color:#1a1a2e;">${val}</div>`;
}

// ── 倒计时 ────────────────────────────────────────────────────
function startTimer(durationSec) {
  clearTimer();
  TIMER_TOTAL = durationSec;
  timerStartedAt = Date.now();
  const el = document.getElementById('turn-timer');
  el.style.display = 'inline-block';
  el.className = '';

  timerInterval = setInterval(() => {
    const elapsed = (Date.now() - timerStartedAt) / 1000;
    const left = Math.max(0, Math.ceil(durationSec - elapsed));
    el.textContent = left + 's';
    if (left <= 10) el.className = 'warning';
    else el.className = '';
    if (left <= 0) clearTimer();
  }, 250);
}

function clearTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
  const el = document.getElementById('turn-timer');
  if (el) { el.style.display = 'none'; el.textContent = ''; el.className = ''; }
}

// ── 事件字幕 ──────────────────────────────────────────────────
let captionTimer = null;
function showCaption(text) {
  const el = document.getElementById('stage-caption');
  if (!el) return;
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(captionTimer);
  captionTimer = setTimeout(() => { el.classList.remove('show'); }, 1600);
}

// ── 行为记录 ──────────────────────────────────────────────────
function addLog(text) {
  logItems.unshift({ text, ts: Date.now() });
  if (logItems.length > 8) logItems.length = 8;
  renderLogBar();
}

function renderLogBar() {
  const container = document.getElementById('log-items');
  if (!container) return;
  const recent = logItems.slice(0, 5);
  container.innerHTML = recent.map((item, i) =>
    `<span class="log-item ${i === 0 ? 'latest' : ''}">${item.text}</span>`
  ).join('');
}

// ── 实时分数条 ────────────────────────────────────────────────
function renderScoreBar(state) {
  const bar = document.getElementById('score-bar');
  if (!state?.players) { bar.innerHTML = ''; return; }
  bar.innerHTML = state.players.map(p => {
    const cards = p.scoreCards  || 0;
    const tok   = p.scoutTokens || 0;
    const hc    = p.handCount   || 0;
    const live  = cards + tok - hc;
    return `<div class="sc-chip">
      <span class="sc-name">${p.name}</span>
      <span class="sc-tok">🎴${cards}</span>
      <span class="sc-tok">🎫${tok}</span>
      <span class="sc-total ${live < 0 ? 'neg' : ''}">${live >= 0 ? '+' : ''}${live}</span>
      <span style="color:var(--muted);font-size:0.62rem;">(🃏${hc})</span>
    </div>`;
  }).join('');
}

// ── 圆桌渲染（替代 renderPlayersTop + renderPlayersSidebar）──────
/**
 * 椭圆席位坐标算法：
 * - 当前玩家（我）固定在底部正中（角度 90° = 6点钟方向）
 * - 其他人按游戏顺序顺时针排列
 * - 使用椭圆参数方程：x = cx + rx*cos(θ)，y = cy + ry*sin(θ)
 */
function renderTable(state) {
  const section = document.getElementById('table-section');
  if (!section) return;

  // 移除旧席位
  section.querySelectorAll('.seat').forEach(el => el.remove());

  const players  = state.players || [];
  const n        = players.length;
  if (n === 0) return;

  // 找到自己在数组中的索引
  const myIdx    = players.findIndex(p => p.id === myPlayerId);

  // 椭圆中心（相对 section，百分比）
  const cx = 50;   // %
  const cy = 50;   // %
  // 椭圆半径：2.05:1 横向椭圆桌，桌面 felt inset=24px
  // 目标：席位中心点距桌边外轮廓 24~40px（取中间值约 32px）
  // table-section @ max 680px → felt 宽 = 632px，半轴 = 316px
  // felt 高 = 680/2.05 - 48 ≈ 284px，半轴 = 142px
  // rx(%) = (316 + 32) / 680 * 100 ≈ 51.2% → 取 51
  // ry(%) = (142 + 32) / (680/2.05) * 100 ≈ 52.6% → 取 53
  const rx = 51;   // % 水平半径（2.05:1 椭圆 + ~32px 溢出）
  const ry = 53;   // % 垂直半径（同比，使席位中心在桌边外 24~40px）

  // 计算每个玩家的角度（0°=右，90°=下）
  // 我们让自己在底部（θ = 90°），其他人等间隔顺时针排列
  players.forEach((p, i) => {
    const isMe   = p.id === myPlayerId;
    const active = p.id === state.currentPlayerId;
    const hc     = p.handCount   || 0;
    const tok    = p.scoutTokens || 0;
    const cards  = p.scoreCards  || 0;
    const live   = cards + tok - hc;

    // 相对于自己的偏移量（顺时针）
    let offset = (i - myIdx + n) % n;
    // θ(度) = 90 + offset * (360/n)，转换为弧度
    const angleDeg = 90 + offset * (360 / n);
    const angleRad = angleDeg * Math.PI / 180;

    // 座位中心坐标（%）
    const sx = cx + rx * Math.cos(angleRad);
    const sy = cy + ry * Math.sin(angleRad);

    // 构造 classes
    let cls = 'seat';
    if (isMe)   cls += ' is-me';
    if (active) cls += ' active';
    if (hc <= 3 && hc > 0 && state.state === 'playing') cls += ' danger';
    if (p.managed) cls += ' managed-seat';

    // ── 卡片式玩家信息组件 ──
    const avatarHtml = p.avatar
      ? `<img src="/avatars/${p.avatar}" alt="" style="width:100%;height:100%;object-fit:contain;" />`
      : (p.name || '?').charAt(0).toUpperCase();
    const isDanger  = hc <= 3 && hc > 0 && state.state === 'playing';
    const liveClass = live < 0 ? 'neg' : '';
    const liveStr   = `${live >= 0 ? '+' : ''}${live}`;
    // 手牌数颜色：危险时橙红
    const cardsClass = isDanger ? 's-cards warn' : 's-cards';

    // 状态 badge（优先级：行动中 > 危险 > 托管）
    // 行动中：区分托管状态（托管中）和正常（正在思考/正在出牌）
    let badgeHtml = '';
    if (active) {
      if (p.managed) {
        badgeHtml = `<span class="seat-badge-managed">🤖 托管中</span>`;
      } else if (state.stageOwner === p.id && (state.stage?.length || 0) > 0) {
        // 刚出过牌，等待其他人响应 → "正在出牌"
        badgeHtml = `<span class="seat-badge-active">🃏 正在出牌</span>`;
      } else {
        badgeHtml = `<span class="seat-badge-active">💭 正在思考</span>`;
      }
    } else if (p.managed) {
      badgeHtml = `<span class="seat-badge-managed">🤖 托管中</span>`;
    } else if (isDanger) {
      badgeHtml = `<span class="seat-badge-danger">⚠ 危险</span>`;
    }

    const el = document.createElement('div');
    el.className = cls;
    el.style.left = `${sx}%`;
    el.style.top  = `${sy}%`;
    el.dataset.playerId = p.id;
    el.onclick = () => showPlayerInfo(p.id);
    // 昵称截断：超过 20 字用 ... 补位
    const MAX_NAME = 20;
    const displayName = (p.name || '').length > MAX_NAME
      ? p.name.slice(0, MAX_NAME) + '…'
      : (p.name || '');

    el.innerHTML = `
      <div class="seat-card">
        <div class="seat-avatar-wrap">
          <div class="seat-avatar" style="${p.avatar ? 'background:rgba(0,0,0,0.25);padding:2px;' : ''}">${avatarHtml}</div>
        </div>
        <div class="seat-info">
          <div class="seat-name">${displayName}${isMe ? ' 👤' : ''}</div>
          <div class="seat-stats">
            <span class="${cardsClass}">🃏${hc}</span>
            <span class="s-sep">·</span>
            <span class="s-score ${liveClass}">${liveStr}</span>
          </div>
          <div class="seat-status">${badgeHtml}</div>
        </div>
      </div>`;

    section.appendChild(el);
  });
}

// ── 渲染玩家条（移动端顶部）──────────────────────────────────
function renderPlayersTop(state) {
  const bar = document.getElementById('players-top-bar');
  if (!bar) return;
  bar.innerHTML = state.players.map(p => {
    const isMe   = p.id === myPlayerId;
    const active = p.id === state.currentPlayerId;
    const hc     = p.handCount || 0;
    const tok    = p.scoutTokens || 0;
    const cards  = p.scoreCards || 0;
    const live   = cards + tok - hc;
    let cls = 'player-chip';
    if (isMe)   cls += ' is-me';
    if (active) cls += ' active';
    if (hc <= 2 && state.state === 'playing') cls += ' danger';
    if (p.managed) cls += ' managed-chip';
    return `<div class="${cls}" onclick="showPlayerInfo('${p.id}')">
      <div class="chip-av" style="${p.avatar ? 'background:rgba(0,0,0,0.3);padding:1px;overflow:hidden;' : ''}">${p.avatar ? `<img src="/avatars/${p.avatar}" style="width:100%;height:100%;object-fit:contain;"/>` : p.name[0]}</div>
      <div>
        <div class="chip-name">${p.name}${isMe ? ' 👤' : ''}</div>
        <div class="chip-meta">
          总${p.totalScore} · <span class="chip-live">${live >= 0 ? '+' : ''}${live}</span>
        </div>
        ${hc <= 2 && state.state === 'playing' ? '<div class="chip-danger">⚠️ 即将清手</div>' : ''}
        ${active ? '<div style="font-size:0.58rem;color:var(--gold);">▶ 行动中</div>' : ''}
        ${p.managed ? '<div class="chip-managed-tag">🤖托管中</div>' : ''}
      </div>
    </div>`;
  }).join('');
}

// ── PC端侧边栏 ────────────────────────────────────────────────
function renderPlayersSidebar(state) {
  const sidebar = document.getElementById('players-sidebar');
  if (!sidebar) return;
  sidebar.innerHTML = `<div class="sidebar-title">第 ${state.roundNumber}/${state.players.length} 轮 · 玩家</div>` +
    state.players.map(p => {
      const isMe   = p.id === myPlayerId;
      const active = p.id === state.currentPlayerId;
      const hc     = p.handCount   || 0;
      const tok    = p.scoutTokens || 0;
      const cards  = p.scoreCards  || 0;
      const live   = cards + tok - hc;
      return `<div class="sidebar-player ${active ? 'active' : ''}">
        <div class="sp-name">${p.name}${isMe ? ' 👤' : ''}</div>
        <div class="sp-score">总分 ${p.totalScore} · 🎴${cards} · 🎫${tok} · 🃏${hc}</div>
        <div class="sp-live">${live >= 0 ? '+' : ''}${live} 实时</div>
        ${active ? '<div class="sp-turn">▶ 行动中</div>' : ''}
        ${p.usedScoutAndShow ? '<div style="font-size:0.62rem;color:var(--muted);margin-top:2px;">已用挖+演</div>' : ''}
        ${p.managed ? '<div class="sp-managed">🤖 托管中</div>' : ''}
      </div>`;
    }).join('');
}

// ── 渲染视台 ──────────────────────────────────────────────────
function renderStage(state) {
  const el   = document.getElementById('stage-cards');
  const meta = document.getElementById('stage-meta');

  if (!state.stage?.length) {
    el.innerHTML = '<div class="stage-empty">舞台空置 · 等待首秀</div>';
    meta.innerHTML = '';
    return;
  }

  const n = state.stage.length;
  el.innerHTML = state.stage.map((card, i) => {
    let endBadge = '';
    if (n > 1) {
      if (i === 0)     endBadge = '<div class="stage-end-badge end-left">←左</div>';
      if (i === n - 1) endBadge = '<div class="stage-end-badge end-right">右→</div>';
    }
    const edgeClass = (isMyTurn && i === 0) ? 'edge-left'
                    : (isMyTurn && i === n - 1) ? 'edge-right' : '';
    return `<div class="stage-card-wrap">${endBadge}${cardHtml(card, { stage: true, edgeClass })}</div>`;
  }).join('');

  const ownerName = state.players.find(p => p.id === state.stageOwner)?.name || '?';
  const typeBadge = state.stageType === 'set'
    ? '<span class="type-badge badge-set">同号组</span>'
    : '<span class="type-badge badge-seq">顺子</span>';
  meta.innerHTML = `<strong style="color:var(--gold-light);">${ownerName}</strong> 出了 ${n} 张${typeBadge}`;
}

// ── 渲染手牌 ──────────────────────────────────────────────────
function renderHand(hand, newCardIndex = -1) {
  const el    = document.getElementById('my-hand-cards');
  const badge = document.getElementById('hand-count-badge');
  badge.textContent = `(${hand.length}张)`;

  // 挖角模式：显示插槽覆盖层
  if (isMyTurn && (selPos !== null || pendingFinishScoutAndShow)) {
    renderHandWithSlots(hand, newCardIndex);
    return;
  }

  el.innerHTML = hand.map((card, i) =>
    cardHtml(card, {
      index: i,
      selected: selectedIndices.includes(i),
      onClick: `toggleCard(${i})`,
      isNew: i === newCardIndex,
      })
  ).join('');

  bindHandDragSelect(); // 已置空，无副作用
}

function renderHandWithSlots(hand, newCardIndex = -1) {
  const el = document.getElementById('my-hand-cards');

  // ── 修复：插槽用 position:absolute 悬浮，不参与 flex 布局 ──
  // 先只渲染卡片（维持原有间距），插槽层叠加在卡片之间
  const CARD_W  = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--card-w')) || 52;
  const CARD_GAP = 3; // 与 CSS gap:3px 保持一致

  // 1. 渲染卡片（不含插槽，flex 布局不变）
  let cardHtmlStr = '';
  for (let i = 0; i < hand.length; i++) {
    cardHtmlStr += cardHtml(hand[i], {
      index: i,
      selected: selectedIndices.includes(i),
      onClick: pendingFinishScoutAndShow ? `toggleCard(${i})` : null,
      isNew: i === newCardIndex,
    });
  }
  el.innerHTML = cardHtmlStr;

  // 2. 延迟一帧等 flex 布局完成，再计算插槽位置叠加
  requestAnimationFrame(() => {
    const cards = el.querySelectorAll('.game-card');
    if (!cards.length) return;

    // 在容器上增加插槽层（绝对定位，不影响 flex）
    // 移除旧插槽层
    el.querySelectorAll('.insert-slot-overlay').forEach(s => s.remove());

    const containerRect = el.getBoundingClientRect();

    cards.forEach((card, i) => {
      // 在卡片左侧插入插槽
      const rect = card.getBoundingClientRect();
      const leftX = rect.left - containerRect.left + el.scrollLeft;
      const slot = document.createElement('div');
      slot.className = `insert-slot-overlay${(i === selInsertIdx && selPos !== null) ? ' active-slot' : ''}`;
      slot.style.left = `${leftX - 8}px`;  // 居中在卡片左边界
      slot.onclick = () => setInsertFromHand(i);
      el.appendChild(slot);
    });

    // 最后一个插槽（最右端）
    const lastCard = cards[cards.length - 1];
    const lastRect = lastCard.getBoundingClientRect();
    const lastX = lastRect.right - containerRect.left + el.scrollLeft;
    const lastSlot = document.createElement('div');
    lastSlot.className = `insert-slot-overlay${(hand.length === selInsertIdx && selPos !== null) ? ' active-slot' : ''}`;
    lastSlot.style.left = `${lastX - 8}px`;
    lastSlot.onclick = () => setInsertFromHand(hand.length);
    el.appendChild(lastSlot);
  });
}

function setInsertFromHand(idx) {
  selInsertIdx = idx;
  renderInsertPreview();
  // 同时更新主手牌区的插槽高亮
  if (gameState) renderHand(gameState.myHand);
}

// ── 拖拽选牌（已移除）──────────────────────────────────────────────────
// 选牌改为纯点击方式：点击单张切换选中状态，自动向两端扩展选区
let _dragBound     = false; // 保留标志避免破坏其他引用

function bindHandDragSelect() {
  // 已改为点击选牌，无需全局事件绑定。
  // 每张牌的 onclick="toggleCard(i)" 直接处理选中逻辑
}

function updateDragSelection() {
  const lo = Math.min(dragStartIndex, dragEndIndex);
  const hi = Math.max(dragStartIndex, dragEndIndex);
  selectedIndices = [];
  for (let i = lo; i <= hi; i++) selectedIndices.push(i);
  if (gameState) renderHand(gameState.myHand);
  updateActionBtns();
}

// ── 点击选牌（纯点击交互）────────────────────────────────────────────
function toggleCard(i) {
  // 翻牌阶段：不处理选牌
  if (gameState?.state === 'flip_phase') return;

  // 非我方回合且不在挣角后演出阶段
  if (!isMyTurn && !pendingFinishScoutAndShow) {
    showToast('还没轮到你', 'error');
    return;
  }

  if (selectedIndices.length === 0) {
    // 空选状态：直接选中这张
    selectedIndices = [i];
  } else {
    const lo = selectedIndices[0];
    const hi = selectedIndices[selectedIndices.length - 1];

    if (selectedIndices.includes(i)) {
      // 点击已选中的牌：
      if (i === lo && i === hi) {
        // 唯一已选 → 取消
        selectedIndices = [];
      } else if (i === lo) {
        // 取消左端
        selectedIndices = selectedIndices.slice(1);
      } else if (i === hi) {
        // 取消右端
        selectedIndices = selectedIndices.slice(0, -1);
      } else {
        // 点击中间牌 → 重新单选这张
        selectedIndices = [i];
      }
    } else {
      // 点击未选中的牌：
      if (i === lo - 1) {
        // 左端扩展
        selectedIndices = [i, ...selectedIndices];
      } else if (i === hi + 1) {
        // 右端扩展
        selectedIndices = [...selectedIndices, i];
      } else {
        // 不相邻 → 重新单选
        selectedIndices = [i];
      }
    }
  }

  if (gameState) renderHand(gameState.myHand);
  updateActionBtns();
}

// ── 按钮状态 ──────────────────────────────────────────────────
function updateActionBtns() {
  const btnShow  = document.getElementById('btn-show');
  const btnScout = document.getElementById('btn-scout');
  const btnSS    = document.getElementById('btn-scout-show');
  const btnManaged = document.getElementById('btn-managed');
  const playing  = isMyTurn && gameState?.state === 'playing';

  if (btnManaged) {
    btnManaged.style.display = playing ? 'inline-flex' : 'none';
  }

  if (pendingFinishScoutAndShow) {
    btnShow.disabled  = selectedIndices.length === 0;
    btnShow.textContent = selectedIndices.length ? '⚡ 演出（完成挖+演）' : '🎭 演出';
    btnScout.disabled = true;
    btnSS.disabled    = true;
    btnShow.classList.toggle('pulsing', selectedIndices.length > 0);
    return;
  }

  btnShow.textContent = '🎭 演出';
  btnShow.classList.remove('pulsing');

  if (!playing) {
    [btnShow, btnScout, btnSS].forEach(b => b.disabled = true);
    return;
  }
  const hasStage = !!gameState.stage?.length;
  btnShow.disabled  = selectedIndices.length === 0;
  btnScout.disabled = !hasStage;
  btnSS.disabled    = !hasStage || gameState.usedScoutAndShow;
}

// ── 渲染完整游戏状态 ──────────────────────────────────────────
function renderState(state) {
  gameState = state;
  isMyTurn  = state.currentPlayerId === myPlayerId && state.state === 'playing';

  document.getElementById('round-num').textContent = state.roundNumber;

  const mid = document.getElementById('header-mid');
  if (isMyTurn) {
    mid.innerHTML = '<span style="color:var(--green);font-weight:800;">▶ 轮到你了！</span>';
  } else {
    const cp = state.players.find(p => p.id === state.currentPlayerId);
    mid.innerHTML = cp ? `<span style="color:var(--gold);">${cp.name}</span> 行动中` : '';
  }

  renderTable(state);        // 圆桌席位（主玩家视图）
  renderPlayersTop(state);   // 移动端顶部（已隐藏，保留兼容）
  renderPlayersSidebar(state); // PC侧栏（已隐藏，保留兼容）
  renderScoreBar(state);
  renderStage(state);
  renderHand(state.myHand || []);
  updateActionBtns();

  // 倒计时逻辑：进入 playing 状态时重置
  if (isMyTurn && state.state === 'playing') {
    startTimer(TIMER_TOTAL);
  } else {
    clearTimer();
  }

  const waiting = document.getElementById('waiting-bar');
  waiting.style.display = (!isMyTurn && !pendingFinishScoutAndShow && state.state === 'playing') ? 'block' : 'none';

  if (state.state === 'flip_phase') showFlipModal(state);
  else document.getElementById('flip-modal').style.display = 'none';

  // 危险状态预警 + 自动推荐
  state.players.forEach(p => {
    if (p.handCount <= 2 && p.handCount > 0 && state.state === 'playing') {
      if (p.id !== myPlayerId) {
        const isThisTurn = p.id === state.currentPlayerId;
        if (!isThisTurn) {
          showAutoSuggest('low_hand', p.name);
        }
      }
    }
  });

  // 连接状态更新
  const dot = document.getElementById('conn-dot');
  if (dot) dot.className = '';
}

// ── 翻牌阶段 ──────────────────────────────────────────────────
let _hasFlipped = false; // 本轮是否已翻转手牌

function showFlipModal(state) {
  document.getElementById('flip-modal').style.display = 'flex';

  // 更新手牌预览
  const preview = document.getElementById('flip-preview');
  preview.innerHTML = (state.myHand || []).map(c => cardHtml(c)).join('');

  // 同步翻转状态（flipConfirmed=true 说明已确认，但不代表翻了；
  // 实际翻转靠 hand_updated 事件更新手牌预览即可）
  updateFlipBtnState();

  // 等待状态列表
  const statusEl = document.getElementById('flip-status-row');
  statusEl.innerHTML = state.players.map(p => `
    <div class="flip-stat-chip ${p.flipConfirmed ? 'done' : ''}">
      ${p.name} ${p.flipConfirmed ? '✅' : '⏳'}
    </div>`).join('');
}

function updateFlipBtnState() {
  const btnFlip   = document.getElementById('btn-do-flip');
  const btnUnflip = document.getElementById('btn-undo-flip');
  if (!btnFlip || !btnUnflip) return;
  if (_hasFlipped) {
    btnFlip.style.display   = 'none';
    btnUnflip.style.display = 'block';
  } else {
    btnFlip.style.display   = 'block';
    btnUnflip.style.display = 'none';
  }
}

function doFlip() {
  socket.emit('flip_hand');
  _hasFlipped = !_hasFlipped;
  updateFlipBtnState();
  showToast(_hasFlipped ? '✅ 已翻转，点「确认手牌，开始游戏」继续' : '已撤销翻转', 'success');
}

function doConfirmFlip() {
  socket.emit('confirm_flip');
}

// ── 演出（SHOW）──────────────────────────────────────────────
function doShow() {
  if (!selectedIndices.length) return showToast('请先点击手牌（需连续位置）', 'error');
  if (pendingFinishScoutAndShow) {
    socket.emit('finish_scout_and_show', { showIndices: selectedIndices });
    pendingFinishScoutAndShow = false;
    selectedIndices = [];
  } else {
    socket.emit('show', { cardIndices: selectedIndices });
    selectedIndices = [];
  }
}

// ── 挖角弹窗 ──────────────────────────────────────────────────
function openScoutModal(isAndShow = false) {
  scoutAndShowMode = isAndShow;
  selPos = null; selInsertIdx = 0; willFlip = false;

  const title       = document.getElementById('scout-modal-title');
  const desc        = document.getElementById('scout-modal-desc');
  const ssHint      = document.getElementById('scout-and-show-hint');
  const confirmBtn  = document.getElementById('scout-confirm-btn');

  if (isAndShow) {
    title.textContent   = '⚡ 挖角并演出';
    desc.textContent    = '先挖角，再立即从手牌选牌演出。每轮限用1次。';
    ssHint.style.display = 'block';
    confirmBtn.textContent = '✅ 确认挖角（挖完再选牌演出）';
  } else {
    title.textContent   = '🔍 挖角';
    desc.textContent    = '从在场组两端取1张牌，插入手牌任意位置。';
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

function renderScoutPositions() {
  const stage = gameState?.stage || [];
  const leftCard  = stage[0];
  const rightCard = stage[stage.length - 1];

  const pLeft  = document.getElementById('preview-left');
  const fLeft  = document.getElementById('flip-left-wrap');
  const cbLeft = document.getElementById('flip-left-cb');
  if (leftCard) {
    pLeft.innerHTML = miniCardHtml(leftCard);
    fLeft.style.display = (leftCard.top !== leftCard.bottom) ? 'block' : 'none';
    // ⚠️ Bug2 修复：只在弹窗首次打开（selPos===null 且未选择）时才重置 checkbox，
    // 避免用户已勾选翻转后因 gameState 更新触发重渲导致状态丢失
    if (selPos === null) cbLeft.checked = false;
  } else {
    pLeft.innerHTML = '<div style="color:var(--muted);font-size:0.75rem;">无</div>';
    fLeft.style.display = 'none';
  }

  const pRight = document.getElementById('preview-right');
  const fRight = document.getElementById('flip-right-wrap');
  const cbRight = document.getElementById('flip-right-cb');
  if (stage.length === 0) {
    pRight.innerHTML = '<div style="color:var(--muted);font-size:0.75rem;">无</div>';
    fRight.style.display = 'none';
  } else {
    pRight.innerHTML = miniCardHtml(rightCard);
    fRight.style.display = (rightCard.top !== rightCard.bottom) ? 'block' : 'none';
    // ⚠️ Bug2 修复：同上，只在未选择端时才重置
    if (selPos === null) cbRight.checked = false;
  }
}

function selectPos(pos) {
  selPos = pos;
  document.getElementById('pos-left').classList.toggle('selected',  pos === 'left');
  document.getElementById('pos-right').classList.toggle('selected', pos === 'right');

  if (pos === 'left')  document.getElementById('flip-right-cb').checked = false;
  else                 document.getElementById('flip-left-cb').checked  = false;

  const cbId = pos === 'left' ? 'flip-left-cb' : 'flip-right-cb';
  willFlip = document.getElementById(cbId).checked;

  const stage = gameState?.stage || [];
  const card  = pos === 'left' ? stage[0] : stage[stage.length - 1];
  if (card) {
    const prev = document.getElementById('scouted-preview');
    prev.style.display = 'flex';
    document.getElementById('scouted-card-show').innerHTML = renderScoutedCardBig(card, willFlip);
  }
  renderInsertPreview();
}

function onFlipChange() {
  if (!selPos) return;
  const cbId = selPos === 'left' ? 'flip-left-cb' : 'flip-right-cb';
  willFlip = document.getElementById(cbId).checked;
  const stage = gameState?.stage || [];
  const card  = selPos === 'left' ? stage[0] : stage[stage.length - 1];
  if (card) {
    document.getElementById('scouted-card-show').innerHTML = renderScoutedCardBig(card, willFlip);
  }
  renderInsertPreview();
}

function renderScoutedCardBig(card, flipped) {
  const displayCard = flipped
    ? { ...card, face: card.face === 'top' ? 'bottom' : 'top' }
    : card;
  const val = cv(displayCard), other = co(displayCard);
  return `
    <div style="display:inline-flex;flex-direction:column;align-items:center;
                justify-content:center;width:44px;height:60px;border-radius:7px;
                background:${cardBg(val)};position:relative;
                box-shadow:0 2px 10px rgba(0,0,0,0.4);border:1.5px solid var(--gold);">
      <div style="position:absolute;top:2px;left:3px;font-size:0.52rem;color:#aaa;">${other}</div>
      <div style="font-size:1.4rem;font-weight:900;color:#1a1a2e;" class="${vc(val)}">${val}</div>
      <div style="position:absolute;bottom:2px;right:3px;font-size:0.52rem;color:#aaa;">${other}</div>
    </div>
    <div style="font-size:0.68rem;color:var(--muted);margin-top:4px;">
      ${flipped ? '（已翻转）' : '（以当前面插入）'}
    </div>`;
}

function renderInsertPreview() {
  const container = document.getElementById('insert-preview-row');
  const hint      = document.getElementById('insert-hint');
  const hand      = gameState?.myHand || [];
  const stage     = gameState?.stage  || [];
  const scoutedCard = selPos ? (selPos === 'left' ? stage[0] : stage[stage.length - 1]) : null;

  let html = '';
  for (let i = 0; i <= hand.length; i++) {
    if (i === selInsertIdx && scoutedCard) {
      html += `<div class="mini-insert-line"></div>`;
      const dc  = willFlip
        ? { ...scoutedCard, face: scoutedCard.face === 'top' ? 'bottom' : 'top' }
        : scoutedCard;
      const val = cv(dc);
      html += `<div class="mini-scouted ${vc(val)}" style="background:${cardBg(val)};color:#1a1a2e;">${val}</div>`;
    } else {
      html += `<div class="mini-slot" onclick="setInsert(${i})"></div>`;
    }
    if (i < hand.length) {
      html += miniCardHtml(hand[i]).replace(
        '<div class="mini-card',
        `<div class="mini-card" onclick="setInsert(${i + 1})"`
      );
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

function confirmScout() {
  if (!selPos) return showToast('请先选择左端或右端', 'error');
  if (scoutAndShowMode) {
    socket.emit('prepare_scout_and_show', {
      scoutPosition: selPos,
      insertIndex: selInsertIdx,
      flipCard: willFlip,
    });
    closeScoutModal();
    selectedIndices = [];
  } else {
    socket.emit('scout', { position: selPos, insertIndex: selInsertIdx, flipCard: willFlip });
    closeScoutModal();
    selectedIndices = [];
  }
}

// ── 托管相关 ──────────────────────────────────────────────────
function requestManaged() {
  socket.emit('request_managed');
  isManaged = true;
  showManagedOverlay('你已进入托管状态', '系统将代为完成后续操作\n你可随时回来接管', true);
}

function takeOver() {
  socket.emit('take_over');
  isManaged = false;
  closeManagedOverlay();
  showToast('✅ 已恢复手动操作', 'success');
}

function showManagedOverlay(title, sub, showTakeOver = false) {
  document.getElementById('managed-title').textContent = title;
  document.getElementById('managed-sub').textContent   = sub;
  document.getElementById('btn-take-over').style.display  = showTakeOver ? 'flex' : 'none';
  document.getElementById('managed-overlay').classList.add('open');
}

function closeManagedOverlay() {
  document.getElementById('managed-overlay').classList.remove('open');
}

// ── 下一轮 / 返回大厅 ────────────────────────────────────────
function nextRound() {
  stopRoundEndCountdown();
  document.getElementById('round-end-modal').style.display = 'none';
  socket.emit('next_round');
}

function backToLobby() {
  clearGameSession();
  window.location.href = '/';
}

// ── 单轮结算页（Page 07）────────────────────────────────────
function showRoundEnd(data) {
  clearTimer();
  stopRoundEndCountdown();

  // 结果总览
  document.getElementById('re-round-tag').textContent = `第 ${data.roundNumber || '?'} 轮结束`;
  const wt = data.winnerType === 'empty_hand'
    ? `${data.roundWinnerName} 率先清手，抢下舞台`
    : `${data.roundWinnerName} 的在场组无人压制，赢得本轮`;
  document.getElementById('re-winner-title').textContent = `🏆 ${wt}`;
  document.getElementById('re-winner-sub').textContent   = '本轮结束';

  // 得分明细
  const sorted = Object.entries(data.totalScores).sort(([, a], [, b]) => b - a);
  document.getElementById('round-scores-body').innerHTML = sorted.map(([id]) => {
    const name   = data.playerNames[id] || id;
    const rs     = data.roundScores[id] || 0;
    const total  = data.totalScores[id] || 0;
    const cards  = data.scoreCards?.[id]  || 0;
    const tok    = data.scoutTokens?.[id] || 0;
    const hc     = data.handCounts?.[id]  || 0;
    const isWin  = id === data.roundWinnerId;
    const detail = isWin
      ? `🎫${tok}（赢家不扣手牌）`
      : `🎫${tok} − 🃏${hc} = <strong>${rs}</strong>`;
    const scoreClass = rs > 0 ? 'score-pos' : rs < 0 ? 'score-neg' : 'score-zero';
    return `<tr class="${isWin ? 'winner' : ''}">
      <td>${name}${isWin ? ' 🏆' : ''}</td>
      <td style="font-size:0.72rem;color:var(--muted);">${detail}</td>
      <td class="${scoreClass}">${rs >= 0 ? '+' : ''}${rs}</td>
      <td><strong>${total}</strong></td>
    </tr>`;
  }).join('');

  // 高光卡片
  const hlSection = document.getElementById('highlight-section');
  const hlCards   = document.getElementById('highlight-cards');
  if (data.highlightCards?.length) {
    hlSection.style.display = 'block';
    hlCards.innerHTML = data.highlightCards.map(hl =>
      `<div class="hl-card">
        <div class="hl-icon">${hl.icon}</div>
        <div class="hl-title">${hl.title}</div>
        <div class="hl-desc">${hl.desc}</div>
      </div>`
    ).join('');
  } else {
    hlSection.style.display = 'none';
  }

  // 下一轮预告 & 按钮（移除自动倒计时，改为手动确认）
  const nextRow = document.getElementById('re-next-row');
  const btnNext = document.getElementById('btn-next-round');
  if (!data.gameOver) {
    nextRow.style.display = 'flex';
    document.getElementById('re-next-label').textContent = '下一轮先手';
    document.getElementById('re-next-val').textContent   = data.nextFirstPlayerName || '';
    btnNext.style.display = 'block';
    // 不再自动倒计时推进，等待玩家手动点击
  } else {
    nextRow.style.display = 'none';
    btnNext.style.display = 'none';
  }

  document.getElementById('round-end-modal').style.display = 'flex';
}

function startRoundEndCountdown(data) {
  // 已废弃：自动倒计时已移除，改为手动点击「准备好了，开始下一轮」
}

function stopRoundEndCountdown() {
  clearInterval(roundEndCountdown);
  roundEndCountdown = null;
}

// ── 游戏结束弹窗 ──────────────────────────────────────────────
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

// ── 聊天区（底部常显条 + 展开面板）──────────────────────────────
// 聊天历史，最多保留 50 条
const chatMessages = [];

// 切换底部聊天条展开/收起
function toggleChatBar() {
  const bar = document.getElementById('chat-bar');
  if (!bar) return;
  const isExpanded = bar.classList.toggle('expanded');
  if (isExpanded) {
    // 清除未读角标
    const badge = document.getElementById('chat-bar-badge');
    if (badge) badge.classList.remove('show');
    // 渲染快捷语
    const ctx = currentSuggestContext || (isMyTurn ? 'my_turn' : 'default');
    renderQuickGrid(ctx);
    // 滚动到底部
    const history = document.getElementById('chat-history');
    if (history) setTimeout(() => { history.scrollTop = history.scrollHeight; }, 50);
  }
}

// 兼容旧版调用
function toggleChatDrawer() {
  // 新布局用 toggleChatBar() 替代；兼容旧 JS 引用
  toggleChatBar();
}

// ── 功能A：席位气泡（发消息时在对应席位旁浮现气泡）─────────
function showSeatBubble(playerId, text) {
  const section = document.getElementById('table-section');
  if (!section) return;
  const seatEl = section.querySelector(`.seat[data-player-id="${playerId}"]`);
  if (!seatEl) return;

  // 确保 .seat 为相对定位（CSS 已设置），直接创建气泡子元素
  // 移除同一席位已有的气泡（避免重叠）
  const old = seatEl.querySelector('.seat-speech-bubble');
  if (old) old.remove();

  const bubble = document.createElement('div');
  bubble.className = 'seat-speech-bubble';
  // 截断超长文本
  const displayText = text.length > 12 ? text.slice(0, 12) + '…' : text;
  bubble.textContent = displayText;
  seatEl.appendChild(bubble);

  // 2.5s 后淡出并销毁
  setTimeout(() => {
    bubble.classList.add('fading');
    setTimeout(() => bubble.remove(), 450);
  }, 2500);
}

// 追加聊天消息到持久化面板（同时写入 #chat-sidebar-history）
function appendChatMessage(playerName, content, type, isOwn = false) {
  const isSticker = type === 'sticker';
  const now = new Date();
  const timeStr = now.getHours().toString().padStart(2,'0') + ':' + now.getMinutes().toString().padStart(2,'0');

  chatMessages.push({ playerName, content, type, time: timeStr, isOwn });
  if (chatMessages.length > 50) chatMessages.shift();

  // ── 写入侧边栏聊天区（新版主入口）──────────────────────
  const sidebar = document.getElementById('chat-sidebar-history');
  if (sidebar) {
    // 移除空消息提示
    const emptyEl = document.getElementById('chat-sidebar-empty');
    if (emptyEl) emptyEl.remove();

    const sbDiv = document.createElement('div');
    if (type === 'system') {
      sbDiv.className = 'sb-msg sb-msg-system';
      sbDiv.innerHTML = `<div class="sb-msg-text">${escapeXSS(content)}</div>`;
    } else {
      sbDiv.className = `sb-msg${isOwn ? ' mine' : ''}`;
      const senderLabel = isOwn ? '我' : escapeXSS(playerName);
      const contentText = isSticker ? content : escapeXSS(content);
      sbDiv.innerHTML = `<div class="sb-msg-sender">${senderLabel}</div><div class="sb-msg-text">${contentText}</div>`;
    }
    sidebar.appendChild(sbDiv);
    while (sidebar.children.length > 60) sidebar.removeChild(sidebar.firstChild);
    // 自动滚到底
    sidebar.scrollTop = sidebar.scrollHeight;
  }

  // ── 兼容旧版隐藏面板（#chat-history）──────────────────
  const history = document.getElementById('chat-history');
  if (history) {
    const div = document.createElement('div');
    if (type === 'system') {
      div.className = 'chat-msg';
      div.innerHTML = `<div class="chat-msg-system">${escapeXSS(content)}</div>`;
    } else {
      div.className = `chat-msg${isOwn ? ' mine' : ''}`;
      const initials = (playerName || '?').charAt(0).toUpperCase();
      // 从当前状态找发言者头像
      const senderP = gameState?.players?.find(pl => isOwn ? pl.id === myPlayerId : pl.name === playerName);
      const avatarHtmlChat = senderP?.avatar
        ? `<img src="/avatars/${senderP.avatar}" alt="" style="width:100%;height:100%;object-fit:contain;" />`
        : initials;
      const avatarStyleChat = senderP?.avatar ? 'background:rgba(0,0,0,0.3);padding:2px;overflow:hidden;' : '';
      const bubbleContent = isSticker
        ? `<div class="chat-msg-sticker">${content}</div>`
        : `<div class="chat-msg-bubble">${escapeXSS(content)}</div>`;
      div.innerHTML = `
        <div class="chat-msg-avatar" style="${avatarStyleChat}">${avatarHtmlChat}</div>
        <div class="chat-msg-body">
          <div class="chat-msg-name">${isOwn ? '我' : escapeXSS(playerName)}</div>
          ${bubbleContent}
          <div class="chat-msg-time">${timeStr}</div>
        </div>`;
    }
    history.appendChild(div);
    while (history.children.length > 50) history.removeChild(history.firstChild);
  }

  const countEl = document.getElementById('chat-msg-count');
  if (countEl) countEl.textContent = `${chatMessages.length} 条消息`;
}

// 显示弹幕气泡（快速浮现，用于他人消息）
function showChatBubble(playerName, content, type) {
  const container = document.getElementById('chat-float');
  if (!container) return;
  const bubble = document.createElement('div');
  const isSticker = type === 'sticker';
  bubble.className = `chat-bubble${isSticker ? ' sticker-bubble' : ''}`;
  if (isSticker) {
    bubble.textContent = content;
  } else {
    bubble.innerHTML = `<span class="bubble-sender">${escapeXSS(playerName)}</span>${escapeXSS(content)}`;
  }
  container.appendChild(bubble);
  while (container.children.length > 3) container.removeChild(container.firstChild);
  setTimeout(() => {
    bubble.style.transition = 'opacity 0.4s';
    bubble.style.opacity = '0';
    setTimeout(() => bubble.remove(), 450);
  }, isSticker ? 1200 : 2500);
}

// 快捷语网格渲染
function renderQuickGrid(ctx = 'default') {
  const grid    = document.getElementById('quick-grid');
  const phrases = CONTEXT_PHRASES[ctx] || CONTEXT_PHRASES.default;
  if (!grid) return;
  grid.innerHTML = phrases.map(p =>
    `<button class="quick-btn" onclick="sendQuick('${escapeHtml(p)}')">${p}</button>`
  ).join('');
}

function escapeHtml(s) {
  return String(s).replace(/'/g, "\\'");
}

// 兼容旧代码调用（social-panel 按钮）
function toggleSocialPanel() { toggleChatBar(); }

// ── 局内社交面板（Page 05）──────────────────────────────────────

function sendQuick(text) {
  if (!checkChatCooldown()) return;
  socket.emit('send_chat', { type: 'quick', content: text });
  // 关闭面板但不冻结
}

function sendSticker(emoji) {
  if (!checkChatCooldown()) return;
  socket.emit('send_chat', { type: 'sticker', content: emoji });
}

function sendChatText() {
  // 兼容旧版 #chat-text（隐藏壳）和新版 #sidebar-chat-text（侧边栏）
  const input = document.getElementById('sidebar-chat-text') || document.getElementById('chat-text');
  const content = input ? input.value.trim() : '';
  if (!content) return;
  if (content.length > 20) return showToast('消息不超过20字', 'error');
  if (!checkChatCooldown()) return;
  socket.emit('send_chat', { type: 'text', content });
  if (input) input.value = '';
}

// ── 侧边栏聊天输入（新版常显侧边栏入口）────────────────────
function sendSidebarText() {
  sendChatText();  // 直接复用，已优先读取 #sidebar-chat-text
}

function sendSidebarSticker(emoji) {
  sendSticker(emoji);  // 直接复用 sendSticker
}

// ── 聊天快捷面板（emoji + 快捷话术）──────────────────────────
const CHAT_EMOJIS = ['😄','😂','🤔','😮','😭','🔥','👍','👏','🎉','💪','😏','🫡','🥲','😤','🤯'];
const CHAT_PHRASES = ['加油！','好球！','让我想想','哎呀~','GG','厉害了','漂亮！','这也行？','服了','要输了'];

function initChatQuickPanel() {
  const emojiRow  = document.getElementById('chat-emoji-row');
  const phraseRow = document.getElementById('chat-phrase-row');
  if (!emojiRow || !phraseRow) return;

  emojiRow.innerHTML = CHAT_EMOJIS.map(e =>
    `<span class="chat-emoji-item" onclick="sendSticker('${e}')">${e}</span>`
  ).join('');

  phraseRow.innerHTML = CHAT_PHRASES.map(p =>
    `<button class="chat-phrase-btn" onclick="sendQuick('${escapeHtml(p)}')">${p}</button>`
  ).join('');
}

function toggleChatQuickPanel() {
  const panel = document.getElementById('chat-quick-panel');
  if (!panel) return;
  const isHidden = panel.style.display === 'none' || panel.style.display === '';
  panel.style.display = isHidden ? 'flex' : 'none';
  if (isHidden) {
    panel.style.flexDirection = 'column';
    initChatQuickPanel();
  }
}

// ── 功能C：侧边栏话术动态刷新 ──────────────────────────────
function refreshSidebarPhrases(ctx) {
  const phraseRow = document.getElementById('chat-phrase-row');
  const panel     = document.getElementById('chat-quick-panel');
  // 只在面板已展开时刷新
  if (!phraseRow || !panel || panel.style.display === 'none') return;
  const phrases = CONTEXT_PHRASES[ctx] || CONTEXT_PHRASES.default;
  phraseRow.innerHTML = phrases.map(p =>
    `<button class="chat-phrase-btn" onclick="sendQuick('${escapeHtml(p)}')">` +
    `<span style="opacity:0.55;font-size:0.55rem;margin-right:2px;">▶</span>${p}</button>`
  ).join('');
}

function checkChatCooldown() {
  const now = Date.now();
  if (now < chatCooldownEnd) {
    const left = Math.ceil((chatCooldownEnd - now) / 1000);
    showToast(`操作太频繁，请等 ${left}s`, 'error');
    return false;
  }
  chatCount3s++;
  if (chatCount3s >= 2) {
    chatCooldownEnd = now + 2000;
    chatCount3s = 0;
    // 禁用快捷按钮
    document.querySelectorAll('.quick-btn, .sticker-btn').forEach(b => {
      b.disabled = true;
      setTimeout(() => { b.disabled = false; }, 2100);
    });
  } else {
    // 3s 内计数窗口
    clearTimeout(chatCooldownTimer);
    chatCooldownTimer = setTimeout(() => { chatCount3s = 0; }, 3000);
  }
  return true;
}

// 显示弹幕气泡（快速浮现提示，保留用于非自己的消息）
// showChatBubble 已移至聊天抽屉区块

function escapeXSS(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// 自动推荐条
function showAutoSuggest(ctx, playerName = '') {
  currentSuggestContext = ctx;
  const phrases = CONTEXT_PHRASES[ctx] || CONTEXT_PHRASES.default;
  const show3   = phrases.slice(0, 3);

  show3.forEach((p, i) => {
    const el = document.getElementById(`suggest-${i}`);
    if (el) el.textContent = p;
  });

  const bar = document.getElementById('auto-suggest-bar');
  if (bar) {
    bar.classList.add('visible');
    clearTimeout(suggestDismissTimer);
    suggestDismissTimer = setTimeout(() => bar.classList.remove('visible'), 2500);
  }
}

function sendQuickFromSuggest(idx) {
  const el = document.getElementById(`suggest-${idx}`);
  if (el?.textContent) sendQuick(el.textContent);
  document.getElementById('auto-suggest-bar')?.classList.remove('visible');
}

// ── 功能B：玩家详情卡浮层 ────────────────────────────────────
let playerInfoTarget = null; // 当前弹层的玩家ID

function showPlayerInfo(playerId) {
  const p = gameState?.players?.find(x => x.id === playerId);
  if (!p) return;
  playerInfoTarget = playerId;

  const isMe    = p.id === myPlayerId;
  const hc      = p.handCount   || 0;
  const tok     = p.scoutTokens || 0;
  const cards   = p.scoreCards  || 0;
  const live    = cards + tok - hc;

  // 头像 & 名字
  const avatarEl = document.getElementById('pi-avatar');
  const nameEl   = document.getElementById('pi-name');
  const subEl    = document.getElementById('pi-sub');
  if (p.avatar) {
    avatarEl.innerHTML = `<img src="/avatars/${p.avatar}" alt="" style="width:100%;height:100%;object-fit:contain;border-radius:50%;" />`;
    avatarEl.style.background = 'rgba(0,0,0,0.3)';
    avatarEl.style.padding = '4px';
  } else {
    avatarEl.textContent = (p.name || '?').charAt(0).toUpperCase();
    avatarEl.style.background = '';
    avatarEl.style.padding = '';
  }
  avatarEl.className = 'pi-avatar' + (isMe ? ' me' : '');
  nameEl.textContent   = p.name + (isMe ? '  👤 我' : '');
  subEl.textContent    = `总积分 ${p.totalScore ?? 0} 分`;

  // 数据格子
  const statsEl = document.getElementById('pi-stats-grid');
  const liveClass = live < 0 ? 'neg' : live > 0 ? 'pos' : '';
  const hcClass   = hc <= 3 && hc > 0 ? 'warn' : '';
  statsEl.innerHTML = [
    { label: '手牌数',    val: `🃏 ${hc}张`, cls: hcClass },
    { label: '挖角 Token', val: `🎫 ${tok}`,  cls: '' },
    { label: '演出分卡',  val: `🎴 ${cards}`, cls: '' },
    { label: '本轮实时',  val: `${live >= 0 ? '+' : ''}${live}`, cls: liveClass },
  ].map(s => `
    <div class="pi-stat">
      <div class="pi-stat-label">${s.label}</div>
      <div class="pi-stat-value ${s.cls}">${s.val}</div>
    </div>`).join('');

  // 标签行
  const tagsEl = document.getElementById('pi-tags');
  const tags = [];
  if (p.id === gameState?.currentPlayerId) tags.push({ cls: 'active',  text: '▶ 行动中' });
  if (hc <= 3 && hc > 0 && gameState?.state === 'playing') tags.push({ cls: 'danger',  text: '⚠ 危险' });
  if (p.usedScoutAndShow)  tags.push({ cls: 'used',    text: '已用挖+演' });
  if (p.managed)           tags.push({ cls: 'managed', text: '🤖 托管中' });
  if (isMe)                tags.push({ cls: 'used',    text: '这是你' });
  tagsEl.innerHTML = tags.map(t => `<span class="pi-tag ${t.cls}">${t.text}</span>`).join('');

  // @TA 按钮文案
  const atBtn = document.getElementById('pi-at-btn');
  if (atBtn) atBtn.textContent = isMe ? '💬 说话（全体）' : `💬 @${p.name} 说话`;

  // 显示浮层
  const modal = document.getElementById('player-info-modal');
  if (modal) modal.style.display = 'flex';
}

function closePlayerInfoModal() {
  const modal = document.getElementById('player-info-modal');
  if (modal) modal.style.display = 'none';
  playerInfoTarget = null;
}

function quickAtPlayer() {
  closePlayerInfoModal();
  const p = gameState?.players?.find(x => x.id === playerInfoTarget);
  const input = document.getElementById('chat-text');
  if (input && p && p.id !== myPlayerId) {
    input.value = `@${p.name} `;
    input.focus();
  } else if (input) {
    input.focus();
  }
}

// ── Socket 事件处理 ────────────────────────────────────────────

socket.on('connect', () => {
  const dot = document.getElementById('conn-dot');
  if (dot) dot.className = '';
  // ★ 首次连接 + 断线重连都统一在这里发 rejoin_game
  // Socket.io 的 connect 事件在连接建立后必然触发（含首次），所以这是最可靠的位置
  if (myRoomCode && myPlayerId) {
    socket.emit('rejoin_game', { roomCode: myRoomCode, playerId: myPlayerId });
  }
});

socket.on('disconnect', () => {
  const dot = document.getElementById('conn-dot');
  if (dot) dot.className = 'offline';
  showToast('🔌 连接断开，正在重连...', 'error');
  clearTimer();
});

socket.on('rejoin_result', ({ success, state, message }) => {
  if (success && state) {
    renderState(state);
    document.getElementById('header-mid').textContent = '已重新连接';
    if (isManaged) {
      showManagedOverlay('已恢复连接', '当前处于托管状态，是否立即接管？', true);
    }
  } else {
    showToast('⚠️ ' + (message || '连接失败'), 'error');
    clearGameSession();
    setTimeout(() => { window.location.href = '/'; }, 2500);
  }
});

socket.on('game_state', (state) => {
  renderState(state);
  // 新一轮开始（翻牌阶段）
  if (state.state === 'flip_phase') {
    document.getElementById('round-num').textContent = state.roundNumber;
  }
});

socket.on('hand_updated', ({ myHand, message }) => {
  if (gameState) {
    gameState.myHand = myHand;
    const preview = document.getElementById('flip-preview');
    if (preview) preview.innerHTML = myHand.map(c => cardHtml(c)).join('');
    renderHand(myHand);
  }
  showToast(message, 'success');
});

socket.on('phase_changed', ({ phase }) => {
  if (phase === 'playing') {
    document.getElementById('flip-modal').style.display = 'none';
    showCaption('游戏正式开始！');
  }
});

socket.on('action_log', ({ type, playerName, position }) => {
  const msgs = {
    show:           `${playerName} 出牌`,
    show_managed:   `${playerName}（托管）出牌`,
    scout:          `${playerName} 从${position === 'left' ? '左' : '右'}端挖了1张`,
    scout_managed:  `${playerName}（托管）挖角`,
    scout_and_show: `${playerName} 挖角并演出！`,
  };
  const text = msgs[type] || `${playerName} 行动`;
  addLog(text);

  // 更新 header 中央
  const mid = document.getElementById('header-mid');
  if (mid) mid.textContent = text;

  // 事件字幕
  const captionMap = {
    show:           `🎭 ${playerName} 出牌！`,
    scout_and_show: `⚡ ${playerName} 挖角并演出！`,
  };
  if (captionMap[type]) showCaption(captionMap[type]);

  // 自动推荐条
  if (type === 'scout_and_show') showAutoSuggest('scout_and_show', playerName);
  else if (type === 'show')      showAutoSuggest('show', playerName);
  else if (type === 'scout')     showAutoSuggest('scout', playerName);

  // ── 功能C：动态刷新侧边栏话术 ──
  const phraseCtx = type === 'scout_and_show' ? 'scout_and_show'
                  : type === 'show'      ? 'show'
                  : type === 'scout'     ? 'scout'
                  : 'default';
  refreshSidebarPhrases(phraseCtx);
});

socket.on('scout_prepared', () => {
  pendingFinishScoutAndShow = true;
  selectedIndices = [];
  showToast('✅ 挖角成功！请在手牌中选连续的牌，然后点「演出」', 'success');
  updateActionBtns();
});

socket.on('action_error', ({ message }) => {
  showToast('❌ ' + message, 'error');
  selectedIndices = [];
  if (gameState) renderHand(gameState.myHand);
  updateActionBtns();
  // 出牌失败：重启倒计时
  if (isMyTurn) startTimer(TIMER_TOTAL);
});

socket.on('finish_scout_error', ({ message }) => {
  showToast('❌ ' + message, 'error');
  pendingFinishScoutAndShow = true;
  selectedIndices = [];
  if (gameState) renderHand(gameState.myHand);
  updateActionBtns();
});

socket.on('turn_warning', ({ message }) => {
  showToast('⏰ ' + message, 'error');
  const el = document.getElementById('turn-timer');
  if (el) el.className = 'warning';
});

socket.on('player_timeout_warning', ({ playerId }) => {
  // 其他玩家超时视觉提示（不弹toast）
  addLog(`⏰ ${gameState?.players?.find(p => p.id === playerId)?.name || '玩家'} 超时中...`);
});

socket.on('player_managed', ({ playerId, playerName }) => {
  addLog(`🤖 ${playerName} 进入托管`);
  showCaption(`🤖 ${playerName} 进入托管状态`);
  if (playerId === myPlayerId) {
    showManagedOverlay('你已进入托管状态', '系统将代为完成操作，你可随时接管', true);
  }
});

socket.on('player_took_over', ({ playerId }) => {
  const name = gameState?.players?.find(p => p.id === playerId)?.name;
  if (name) addLog(`⚡ ${name} 已接管`);
  if (playerId === myPlayerId) closeManagedOverlay();
});

socket.on('take_over_result', ({ success, message }) => {
  if (success) showToast('✅ ' + message, 'success');
});

socket.on('round_end', (data) => {
  pendingFinishScoutAndShow = false;
  selectedIndices = [];
  showRoundEnd(data);
});

socket.on('game_over', (data) => {
  pendingFinishScoutAndShow = false;
  selectedIndices = [];
  showRoundEnd(data);
  setTimeout(() => showGameEnd(data), 3500);
});

socket.on('round_started', ({ roundNumber }) => {
  document.getElementById('round-num').textContent = roundNumber;
  selectedIndices = [];
  pendingFinishScoutAndShow = false;
  isManaged = false;
  logItems.length = 0;
  showCaption(`🎪 第 ${roundNumber} 轮开始！`);
  addLog(`第 ${roundNumber} 轮开始`);
});

socket.on('player_offline', ({ playerName }) => {
  showToast(`📵 ${playerName} 暂时离线`, 'error');
  addLog(`📵 ${playerName} 掉线`);
});

socket.on('chat_message', ({ playerName, content, type, senderId }) => {
  const myName = gameState?.players?.find(p => p.id === myPlayerId)?.name;
  const isOwn = (playerName === myName);
  // 1. 追加到持久化聊天记录
  appendChatMessage(playerName, content, type, isOwn);
  // 2. 同时显示浮动气泡（仅他人消息）
  if (!isOwn) showChatBubble(playerName, content, type);
  // 3. ── 功能A：在对应席位旁显示对话气泡（自己和他人都显示）──
  if (type !== 'system') {
    const senderPlayer = isOwn
      ? gameState?.players?.find(p => p.id === myPlayerId)
      : gameState?.players?.find(p => p.name === playerName);
    if (senderPlayer) showSeatBubble(senderPlayer.id, content);
  }
});

socket.on('lobby_error', ({ message }) => showToast('⚠️ ' + message, 'error'));
socket.on('error',       ({ message }) => showToast('⚠️ ' + message, 'error'));

// ── 初始化：添加游戏开始系统消息 ─────────────────────────────
socket.on('game_started', (state) => {
  appendChatMessage('', '🎪 游戏开始！欢迎来到 Scout！', 'system');
  renderState(state);
});

// ── ESC 收起底部聊天条 ────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const bar = document.getElementById('chat-bar');
    if (bar?.classList.contains('expanded')) toggleChatBar();
  }
});
