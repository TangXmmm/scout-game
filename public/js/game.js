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
let isSpectator  = false;  // 旁观者模式标志
let mySpecId     = null;   // 旁观者 ID（旁观模式下使用）

// 挖角 & 挖角并演出
let scoutAndShowMode          = false;
let pendingFinishScoutAndShow = false;
let selPos       = null;    // 'left' | 'right'
let selInsertIdx = 0;
let willFlip     = false;

// 倒计时
let timerInterval  = null;
let timerStartedAt = 0;
let TIMER_TOTAL    = 60;    // 秒，与服务端对齐

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
  isSpectator = p.get('spectator') === '1';
  mySpecId    = p.get('specId') || null;

  if (!myRoomCode || !myPlayerId) {
    window.location.href = '/';
    return;
  }

  if (!isSpectator) {
    saveGameSession({ roomCode: myRoomCode, playerId: myPlayerId, timestamp: Date.now() });
  }

  // 初始化社交面板快捷语
  renderQuickGrid('default');

  socket.on('connect', () => {
    const dot = document.getElementById('conn-dot');
    if (dot) dot.className = '';
    if (myRoomCode && myPlayerId) {
      setActionBtnsDisabled(true);
      if (isSpectator && mySpecId) {
        // 旁观者重连
        socket.emit('rejoin_as_spectator', { roomCode: myRoomCode, specId: mySpecId });
      } else {
        socket.emit('rejoin_game', { roomCode: myRoomCode, playerId: myPlayerId });
      }
    }
  });

  if (socket.connected && myRoomCode && myPlayerId) {
    setActionBtnsDisabled(true);
    if (isSpectator && mySpecId) {
      socket.emit('rejoin_as_spectator', { roomCode: myRoomCode, specId: mySpecId });
    } else {
      socket.emit('rejoin_game', { roomCode: myRoomCode, playerId: myPlayerId });
    }
  }
})();

function saveGameSession(session) {
  localStorage.setItem('scout_game_session', JSON.stringify(session));
}
function clearGameSession() {
  localStorage.removeItem('scout_game_session');
}

// ── 工具 ──────────────────────────────────────────────────────
function showToast(msg, type = '', duration = 3200) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = type;
  el.style.display = 'block';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.display = 'none'; }, duration);
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
  // 方案A增强版：底色与文字颜色同向（低值浅蓝→高值浅红），145°渐变增加纵深感
  const bgs = [
    'linear-gradient(145deg,#e8f0fe,#f4f7ff)', // 1-2 浅蓝（配蓝字）
    'linear-gradient(145deg,#e8f0fe,#f4f7ff)',
    'linear-gradient(145deg,#edf7ed,#f4fbf4)', // 3-4 浅绿（配绿字）
    'linear-gradient(145deg,#edf7ed,#f4fbf4)',
    'linear-gradient(145deg,#fef9e7,#fffdf4)', // 5-6 浅黄（配暗金字）
    'linear-gradient(145deg,#fef9e7,#fffdf4)',
    'linear-gradient(145deg,#fff3e8,#fffaf4)', // 7-8 浅橙（配橙字）
    'linear-gradient(145deg,#fff3e8,#fffaf4)',
    'linear-gradient(145deg,#fde8e8,#fff4f4)', // 9-10 浅红（配红字）
    'linear-gradient(145deg,#fde8e8,#fff4f4)',
  ];
  return bgs[Math.min(val - 1, 9)];
}

// ── 渲染卡牌 HTML ──────────────────────────────────────────────
function cardHtml(card, opts = {}) {
  const val = cv(card), other = co(card);
  // 3.2/3.3：选中时用 in-selection（整段外轮廓由父容器发光，单卡不散亮）
  const selClass   = opts.selected ? 'in-selection' : '';
  const stageClass = opts.stage ? 'stage-card' : '';
  const newClass   = opts.isNew ? 'new-card' : '';
  const edgeClass  = opts.edgeClass || '';
  const onclick    = opts.onClick ? `onclick="${opts.onClick}"` : '';
  const idx        = opts.index !== undefined ? `data-index="${opts.index}"` : '';
  return `
    <div class="game-card ${selClass} ${stageClass} ${newClass} ${edgeClass}"
         ${onclick} ${idx}
         style="background:${cardBg(val)};">
      <div class="card-corner card-tl ${vc(other)}">${other}</div>
      <div class="card-main-val ${vc(val)}">${val}</div>
      <div class="card-corner card-br ${vc(other)}">${other}</div>
    </div>`;
}

function miniCardHtml(card, showBoth = false) {
  const val   = cv(card);
  const other = co(card);
  if (showBoth && card.top !== card.bottom) {
    // 角标用深色（#333），主体大数字继续用颜色类；确保在浅色卡面上清晰可读
    return `<div class="mini-card mini-card-both ${vc(val)}" style="background:${cardBg(val)};color:#1a1a2e;">
      <div class="mini-card-tl" style="color:#444;">${other}</div>
      <span class="mini-card-main ${vc(val)}">${val}</span>
      <div class="mini-card-br" style="color:#444;">${other}</div>
    </div>`;
  }
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
  let _warnedAt10 = false;

  timerInterval = setInterval(() => {
    const elapsed = (Date.now() - timerStartedAt) / 1000;
    const left = Math.max(0, Math.ceil(durationSec - elapsed));
    el.textContent = left + 's';

    // 方向3：最后10秒触发心跳脉冲
    if (left <= 10 && left > 0) {
      el.className = 'warning heartbeat';
      startPulseBorder();
      // 🔊 最后10秒时播放一次超时警告音效
      if (!_warnedAt10) { _warnedAt10 = true; if (typeof SoundFX !== 'undefined') SoundFX.timeWarning(); }
    } else if (left > 10) {
      el.className = '';
      stopPulseBorder();
    }
    if (left <= 0) clearTimer();
  }, 250);
}

function clearTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
  const el = document.getElementById('turn-timer');
  if (el) { el.style.display = 'none'; el.textContent = ''; el.className = ''; }
  stopPulseBorder();
}

// ── 方向3：屏幕边框心跳脉冲 ─────────────────────────────────
function startPulseBorder() {
  const el = document.getElementById('pulse-border');
  if (el && !el.classList.contains('pulse')) el.classList.add('pulse');
}
function stopPulseBorder() {
  const el = document.getElementById('pulse-border');
  if (el) el.classList.remove('pulse');
}

// ── 方向2：高光时刻动效 ──────────────────────────────────────

// 显示大字幕（emoji + 标题 + 副标题），durationMs 后自动隐藏
function showHighlightBanner(emoji, title, sub = '', durationMs = 2200) {
  document.getElementById('hl-emoji').textContent = emoji;
  document.getElementById('hl-title').textContent = title;
  document.getElementById('hl-sub').textContent   = sub;
  const el = document.getElementById('highlight-banner');
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), durationMs);
}

// 显示右上角成就徽章
function showAchievement(icon, title, desc, durationMs = 3500) {
  document.getElementById('ach-icon').textContent  = icon;
  document.getElementById('ach-title').textContent = title;
  document.getElementById('ach-desc').textContent  = desc;
  const el = document.getElementById('achievement-toast');
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), durationMs);
}

// 简易烟花效果（Canvas 粒子，不依赖外部库）
let _fwAnimId = null;
function launchFireworks(durationMs = 2800) {
  const canvas = document.getElementById('fireworks-canvas');
  if (!canvas) return;
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  canvas.classList.add('active');

  const ctx = canvas.getContext('2d');
  const particles = [];
  const colors = ['#f7c948','#ff6b6b','#51cf66','#74c0fc','#cc5de8','#ff9f43','#fff'];

  // 创建多个爆炸中心
  const bursts = 5 + Math.floor(Math.random() * 3);
  for (let b = 0; b < bursts; b++) {
    const cx = 0.1 * window.innerWidth + Math.random() * 0.8 * window.innerWidth;
    const cy = 0.1 * window.innerHeight + Math.random() * 0.55 * window.innerHeight;
    const count = 22 + Math.floor(Math.random() * 14);
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.4;
      const speed = 2.5 + Math.random() * 3.5;
      particles.push({
        x: cx, y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        alpha: 1,
        color: colors[Math.floor(Math.random() * colors.length)],
        radius: 2 + Math.random() * 2.5,
        decay: 0.012 + Math.random() * 0.01,
        gravity: 0.06,
      });
    }
  }

  const startTime = Date.now();
  function frame() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(p => {
      p.x  += p.vx;
      p.y  += p.vy;
      p.vy += p.gravity;
      p.vx *= 0.98;
      p.alpha -= p.decay;
      if (p.alpha <= 0) return;
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    if (Date.now() - startTime < durationMs) {
      _fwAnimId = requestAnimationFrame(frame);
    } else {
      canvas.classList.remove('active');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }
  cancelAnimationFrame(_fwAnimId);
  frame();
}

// ── 方向4：出牌动效（stage 换主人时触发 fly-in）───────────────
// 用 stageOwner 变化来判断是否有新演出（比 stageLen 更准确）
let _lastStageOwner = null;  // 上一次 stageOwner，变化时说明有新人演出
let _lastStageLen   = 0;     // 上一次 stage 长度（保留，用于空→有的判断）

// ── 方向2：检测 action_log 事件中的高光时刻 ─────────────────────
/**
 * 根据 action_log 事件触发对应的高光动效
 * @param {string} type      - 动作类型
 * @param {string} playerName - 执行者名字
 * @param {object} stateSnap  - 当前 gameState 快照（用于判断清手、危险等）
 */
function triggerHighlightEffect(type, playerName) {
  const isMe = (gameState?.players?.find(p => p.name === playerName)?.id === myPlayerId);
  const mePrefix = isMe ? '你' : playerName;

  if (type === 'scout_and_show') {
    showAchievement('⚡', `挖角并演出！`, `${mePrefix} 使出了绝招`);
  }
  // 手牌极少时的成就（每次出牌后检查自己）
  if (gameState?.state === 'playing') {
    const me = gameState.players?.find(p => p.id === myPlayerId);
    if (me && me.handCount === 1) {
      showAchievement('🔥', '最后一张！', '下次出牌即可清手！');
    }
  }
}

// 在 round_end/game_over 时触发清手烟花 + 大字幕
function triggerRoundEndEffect(data) {
  const isMyWin = data.roundWinnerId === myPlayerId;
  if (data.winnerType === 'empty_hand') {
    launchFireworks(2600);
    if (isMyWin) {
      showHighlightBanner('🎉', '完美清手！', '你率先清空手牌，赢得本轮！', 2400);
    } else {
      showHighlightBanner('👏', `${data.roundWinnerName} 赢得本轮！`, '率先清空手牌，大获全胜！', 2000);
    }
  } else {
    // all_scout 无人压制赢局
    if (isMyWin) {
      showHighlightBanner('🏆', '无敌在场组！', '无人能压制你的出牌！', 2200);
    } else {
      showHighlightBanner('🎭', `${data.roundWinnerName} 赢得本轮！`, '在场组无人能压制，胜利！', 1800);
    }
  }
}

// 游戏结束时触发终局烟花
function triggerGameEndEffect(data) {
  const isMyWin = data.gameWinnerId === myPlayerId;
  launchFireworks(4000);
  if (isMyWin) {
    showHighlightBanner('🏆', '你赢了整局！', '恭喜！你是最终的马戏之星！', 3500);
  } else {
    showHighlightBanner('🎪', `${data.gameWinnerName} 赢了！`, '感谢参与这场精彩的马戏表演', 3000);
  }
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

// ── 实时排行榜（左侧边栏）──────────────────────────────────────
/**
 * 渲染左侧实时排行榜
 * 信息分两层：
 *   核心：排名 | 头像 | 名字 | 总分 | 本局实时得分
 *   辅助：手牌数 | 挖角Token数 | 挖+演是否已用
 */
function renderLeaderboard(state) {
  const body = document.getElementById('lb-body');
  if (!body || !state?.players) return;

  // 按总分降序排列（同分保留游戏顺序）
  const sorted = [...state.players].sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0));
  const rankEmoji = ['🥇', '🥈', '🥉'];

  body.innerHTML = sorted.map((p, idx) => {
    const isMe   = p.id === myPlayerId;
    const active = p.id === state.currentPlayerId;
    const hc     = p.handCount   || 0;
    const tok    = p.scoutTokens || 0;
    const cards  = p.scoreCards  || 0;
    const live   = cards + tok - hc;   // 本局实时得分（正负）
    const total  = p.totalScore  || 0;

    // 排名标志：前三名用奖牌 emoji，之后用数字
    const rankLabel = idx < 3 ? rankEmoji[idx] : `${idx + 1}`;
    const rankCls   = idx === 0 ? 'r1' : idx === 1 ? 'r2' : idx === 2 ? 'r3' : '';

    // 头像
    const avatarInner = p.avatar
      ? `<img src="/avatars/${p.avatar}" alt="" />`
      : `<span>${(p.name || '?').charAt(0).toUpperCase()}</span>`;

    // 本局实时得分（颜色）
    const liveCls  = live > 0 ? 'pos' : live < 0 ? 'neg' : '';
    const liveStr  = `${live >= 0 ? '+' : ''}${live}`;

    // 总分颜色
    const totalCls = total < 0 ? 'neg' : '';

    // 辅助标签：手牌数 / token / 挖+演
    const auxChips = [
      `<span class="lb-chip">🃏${hc}张</span>`,
      tok > 0 ? `<span class="lb-chip">🎫×${tok}</span>` : '',
      p.usedScoutAndShow ? `<span class="lb-chip used">⚡已用</span>` : '',
      hc <= 3 && hc > 0 && state.state === 'playing' ? `<span class="lb-chip danger">⚠危险</span>` : '',
      p.managed ? `<span class="lb-chip">🤖托管</span>` : '',
    ].filter(Boolean).join('');

    const rowCls = ['lb-row', isMe ? 'lb-me' : '', active ? 'lb-active' : ''].filter(Boolean).join(' ');

    return `
      <div class="${rowCls}" onclick="showPlayerInfo('${p.id}')">
        <div class="lb-rank ${rankCls}">${rankLabel}</div>
        <div class="lb-avatar">${avatarInner}</div>
        <div class="lb-info">
          <div class="lb-name ${isMe ? 'lb-name-me' : ''}">${p.name}${isMe ? ' 👤' : ''}</div>
          <div class="lb-scores">
            <span class="lb-total ${totalCls}">${total >= 0 ? '+' : ''}${total}分</span>
            <span class="lb-live ${liveCls}">${liveStr}</span>
          </div>
          <div class="lb-aux">${auxChips}</div>
        </div>
      </div>`;
  }).join('');

  // 📱 移动端：若排行榜抽屉已打开，同步刷新
  const _lbDrawer = document.getElementById('mobile-lb-drawer');
  if (_lbDrawer?.classList.contains('open')) syncMobileLb();
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
    _lastStageLen = 0;
    return;
  }

  const n = state.stage.length;
  // 方向4：stageOwner 变化 = 新人演出 → 触发飞入动效
  // 仅当 stageOwner 发生实际变化时播放动效（挖角只会缩减 stage，不换 owner）
  const currentOwner = state.stageOwner;
  const isNewPlay = currentOwner !== null && currentOwner !== _lastStageOwner;
  _lastStageOwner = currentOwner;
  _lastStageLen = n;

  el.innerHTML = state.stage.map((card, i) => {
    let endBadge = '';
    if (n > 1) {
      if (i === 0)     endBadge = '<div class="stage-end-badge end-left">←左</div>';
      if (i === n - 1) endBadge = '<div class="stage-end-badge end-right">右→</div>';
    }
    const edgeClass = (isMyTurn && i === 0) ? 'edge-left'
                    : (isMyTurn && i === n - 1) ? 'edge-right' : '';
    // 方向4：新演出的牌全部加 fly-in 类
    const flyClass = isNewPlay ? ' fly-in' : '';
    return `<div class="stage-card-wrap${flyClass}">${endBadge}${cardHtml(card, { stage: true, edgeClass })}</div>`;
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

  // 挖角模式（选端阶段）：显示插槽覆盖层
  // 仅在 selPos !== null（用户正在选插入位置）时才渲染插槽 UI。
  // pendingFinishScoutAndShow（演出阶段）走普通渲染路径——不需要插槽，只需正常选牌。
  if (isMyTurn && selPos !== null) {
    renderHandWithSlots(hand, newCardIndex);
    return;
  }

  // 3.2/3.3：整段选中用 hand-sel-wrap 容器包裹，共享外轮廓发光
  if (selectedIndices.length > 0) {
    const lo = selectedIndices[0];
    const hi = selectedIndices[selectedIndices.length - 1];
    let html = '';
    // 选中段之前
    for (let i = 0; i < lo; i++) {
      html += cardHtml(hand[i], { index: i, onClick: `toggleCard(${i})`, isNew: i === newCardIndex });
    }
    // 整段选中区：用 hand-sel-wrap 容器包裹
    html += '<div class="hand-sel-wrap">';
    for (let i = lo; i <= hi; i++) {
      html += cardHtml(hand[i], { index: i, selected: true, onClick: `toggleCard(${i})`, isNew: i === newCardIndex });
    }
    html += '</div>';
    // 选中段之后
    for (let i = hi + 1; i < hand.length; i++) {
      html += cardHtml(hand[i], { index: i, onClick: `toggleCard(${i})`, isNew: i === newCardIndex });
    }
    el.innerHTML = html;
  } else {
    el.innerHTML = hand.map((card, i) =>
      cardHtml(card, { index: i, onClick: `toggleCard(${i})`, isNew: i === newCardIndex })
    ).join('');
  }

  // 手牌交互事件绑定：可扩选提示 + 双击出牌
  el.querySelectorAll('.game-card:not(.stage-card)').forEach(cardEl => {
    // ① mouseenter：有选区时，在选区边界的相邻牌上显示「+」扩选提示（无悬浮）
    cardEl.addEventListener('mouseenter', () => {
      el.querySelectorAll('.game-card').forEach(c => {
        c.classList.remove('can-extend-left', 'can-extend-right');
      });
      if (selectedIndices.length === 0) return; // 无选区时不做任何提示
      const lo  = selectedIndices[0];
      const hi  = selectedIndices[selectedIndices.length - 1];
      const idx = parseInt(cardEl.dataset.index);
      if (isNaN(idx)) return;
      // 只在选区左端-1 和右端+1 的牌上添加提示，场景明确，不产生误导
      if (idx === lo - 1) cardEl.classList.add('can-extend-left');
      if (idx === hi + 1) cardEl.classList.add('can-extend-right');
    });
    cardEl.addEventListener('mouseleave', () => {
      cardEl.classList.remove('can-extend-left', 'can-extend-right');
    });

    // ② dblclick：已选中的牌双击 → 直接出牌（合法时）
    cardEl.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      if (!isMyTurn && !pendingFinishScoutAndShow) return;
      if (!cardEl.classList.contains('in-selection') && !cardEl.classList.contains('selected')) return;
      const hintState = updatePlayHint();
      if (hintState === 'valid-beats' || hintState === 'valid-no-beat') {
        if (typeof SoundFX !== 'undefined') SoundFX.cardPlay();
        doPlay();
      }
    });
  });

  bindHandDragSelect(); // 已置空，无副作用

  // ── 修复：手牌居中 + 卡多时可滚动到最左 ──
  // justify-content:center 与 overflow-x:auto 共存时，flex 左侧溢出被截断无法滚动。
  // 方案：justify-content:flex-start + 首尾 .hand-spacer 动态居中偏移
  //   ⚠️ 不能用 scrollWidth（不溢出时 scrollWidth === clientWidth，永远算出 0）
  //   正确做法：直接累加所有非 spacer 子元素的 offsetWidth + gap
  requestAnimationFrame(() => {
    const container = document.getElementById('my-hand-cards');
    if (!container) return;
    // 先移除旧 spacer，再测量纯内容宽
    container.querySelectorAll('.hand-spacer').forEach(s => s.remove());

    // 展开 hand-sel-wrap 内的子元素一起计算（避免把选区容器当一个宽元素导致 spacer 偏大）
    const rawChildren = Array.from(container.children);
    const cards = rawChildren.flatMap(c =>
      c.classList.contains('hand-sel-wrap') ? Array.from(c.children) : [c]
    );
    if (cards.length === 0) return;

    // 测量所有卡片的实际总宽度
    const GAP = 2; // 与 CSS gap:2px 一致
    let contentW = cards.reduce((sum, c) => sum + c.offsetWidth, 0)
                   + GAP * Math.max(0, cards.length - 1);
    const containerW = container.clientWidth;
    const half = Math.max(0, Math.floor((containerW - contentW) / 2));

    if (half > 0) {
      const makeS = (w) => {
        const s = document.createElement('div');
        s.className = 'hand-spacer';
        s.style.width = w + 'px';
        return s;
      };
      container.insertBefore(makeS(half), container.firstChild);
      container.appendChild(makeS(half));
    }
  });
}

function renderHandWithSlots(hand, newCardIndex = -1) {
  const el = document.getElementById('my-hand-cards');

  // ── 修复：插槽用 position:absolute 悬浮，不参与 flex 布局 ──
  // 先只渲染卡片（维持原有间距），插槽层叠加在卡片之间
  const CARD_W  = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--card-w')) || 52;
  const CARD_GAP = 2; // 与 CSS gap:2px 保持一致

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

  // ── 挖+演出模式：绑定与 renderHand 一致的交互事件 ──
  // （自动扩选 + 双击出牌 + 可扩选提示）
  if (pendingFinishScoutAndShow) {
    el.querySelectorAll('.game-card:not(.stage-card)').forEach(cardEl => {
      // ① mouseenter：有选区时在选区边界相邻牌显示「+」扩选提示
      cardEl.addEventListener('mouseenter', () => {
        el.querySelectorAll('.game-card').forEach(c => {
          c.classList.remove('can-extend-left', 'can-extend-right');
        });
        if (selectedIndices.length === 0) return;
        const lo  = selectedIndices[0];
        const hi  = selectedIndices[selectedIndices.length - 1];
        const idx = parseInt(cardEl.dataset.index);
        if (isNaN(idx)) return;
        if (idx === lo - 1) cardEl.classList.add('can-extend-left');
        if (idx === hi + 1) cardEl.classList.add('can-extend-right');
      });
      cardEl.addEventListener('mouseleave', () => {
        cardEl.classList.remove('can-extend-left', 'can-extend-right');
      });
      // ② dblclick：已选中牌双击 → 直接出牌（合法时）
      cardEl.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        if (!pendingFinishScoutAndShow) return;
        if (!cardEl.classList.contains('in-selection') && !cardEl.classList.contains('selected')) return;
        const hintState = updatePlayHint();
        if (hintState === 'valid-beats' || hintState === 'valid-no-beat') {
          if (typeof SoundFX !== 'undefined') SoundFX.cardPlay();
          doPlay();
        }
      });
    });
  }

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
      slot.style.left = `${leftX - 13}px`;  // 居中在卡片左边界（宽26px，居中偏移13px）
      slot.setAttribute('data-idx', i + 1);  // 显示插入后的序位（第几张）
      slot.onclick = () => setInsertFromHand(i);
      el.appendChild(slot);
    });

    // 最后一个插槽（最右端）
    const lastCard = cards[cards.length - 1];
    const lastRect = lastCard.getBoundingClientRect();
    const lastX = lastRect.right - containerRect.left + el.scrollLeft;
    const lastSlot = document.createElement('div');
    lastSlot.className = `insert-slot-overlay${(hand.length === selInsertIdx && selPos !== null) ? ' active-slot' : ''}`;
    lastSlot.style.left = `${lastX - 13}px`;
    lastSlot.setAttribute('data-idx', hand.length + 1);  // 最右端插槽序位
    lastSlot.onclick = () => setInsertFromHand(hand.length);
    el.appendChild(lastSlot);

    // ── 与 renderHand 一致：动态 spacer 居中手牌 ──
    el.querySelectorAll('.hand-spacer').forEach(s => s.remove());
    const allChildren = Array.from(el.querySelectorAll('.game-card'));
    if (allChildren.length > 0) {
      const GAP = 2;
      let contentW = allChildren.reduce((sum, c) => sum + c.offsetWidth, 0)
                     + GAP * Math.max(0, allChildren.length - 1);
      const containerW = el.clientWidth;
      const half = Math.max(0, Math.floor((containerW - contentW) / 2));
      if (half > 0) {
        const makeS = (w) => {
          const s = document.createElement('div');
          s.className = 'hand-spacer';
          s.style.width = w + 'px';
          return s;
        };
        // 插到第一张 .game-card 前面（避免 insertBefore 绝对定位的插槽覆盖层）
        const firstCard = el.querySelector('.game-card');
        el.insertBefore(makeS(half), firstCard || el.firstChild);
        el.appendChild(makeS(half));
      }
    }
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

/**
 * 智能自动扩选：当选区恰好为 2 张时，识别牌型（同号/顺子）并自动向两侧延伸。
 * 同号组：继续纳入两侧相邻的同号牌
 * 顺子：继续纳入两侧相邻且数字连续的牌
 * @param {number[]} baseIndices 当前 2 张牌的索引（必须相邻）
 * @returns {number[]} 自动扩展后的完整索引数组
 */
function autoExpandSelection(baseIndices) {
  const hand = gameState?.myHand || [];
  if (baseIndices.length !== 2) return baseIndices;

  const lo = baseIndices[0];
  const hi = baseIndices[1];
  if (hi !== lo + 1) return baseIndices; // 必须相邻

  const valLo = cv(hand[lo]);
  const valHi = cv(hand[hi]);

  const isSet = valLo === valHi;           // 同号
  const diff = valHi - valLo;
  const isSeq = Math.abs(diff) === 1;      // 顺子：差值为 ±1（兼容升序/降序排列）

  if (!isSet && !isSeq) return baseIndices; // 两张牌本身无法形成合法组合，不自动扩选

  let newLo = lo;
  let newHi = hi;

  if (isSet) {
    // 同号组：向左延伸同号牌
    while (newLo - 1 >= 0 && cv(hand[newLo - 1]) === valLo) newLo--;
    // 向右延伸同号牌
    while (newHi + 1 < hand.length && cv(hand[newHi + 1]) === valLo) newHi++;
  } else {
    // 顺子：根据实际排列方向（diff = +1 升序 / -1 降序）向两侧延伸
    const step = diff; // valHi - valLo：正值=升序，负值=降序
    // 向左延伸：左侧牌值应等于当前最左值减去 step（即沿相同方向往回一步）
    while (newLo - 1 >= 0 && cv(hand[newLo - 1]) === cv(hand[newLo]) - step) newLo--;
    // 向右延伸：右侧牌值应等于当前最右值加上 step
    while (newHi + 1 < hand.length && cv(hand[newHi + 1]) === cv(hand[newHi]) + step) newHi++;
  }

  const expanded = [];
  for (let k = newLo; k <= newHi; k++) expanded.push(k);
  return expanded;
}

function toggleCard(i) {
  // 翻牌阶段：不处理选牌
  if (gameState?.state === 'flip_phase') return;

  // 非我方回合且不在挣角后演出阶段
  if (!isMyTurn && !pendingFinishScoutAndShow) {
    showToast('还没轮到你', 'error');
    if (typeof SoundFX !== 'undefined') SoundFX.error();
    return;
  }

  if (selectedIndices.length === 0) {
    // 空选状态：直接选中这张
    selectedIndices = [i];
    if (typeof SoundFX !== 'undefined') SoundFX.cardSelect();
  } else {
    const lo = selectedIndices[0];
    const hi = selectedIndices[selectedIndices.length - 1];

    if (selectedIndices.includes(i)) {
      // 点击已选中的牌：
      if (i === lo && i === hi) {
        // 唯一已选 → 取消
        selectedIndices = [];
        if (typeof SoundFX !== 'undefined') SoundFX.cardDeselect();
      } else if (i === lo) {
        // 取消左端
        selectedIndices = selectedIndices.slice(1);
        if (typeof SoundFX !== 'undefined') SoundFX.cardDeselect();
      } else if (i === hi) {
        // 取消右端
        selectedIndices = selectedIndices.slice(0, -1);
        if (typeof SoundFX !== 'undefined') SoundFX.cardDeselect();
      } else {
        // 点击中间牌 → 重新单选这张
        selectedIndices = [i];
        if (typeof SoundFX !== 'undefined') SoundFX.cardSelect();
      }
    } else {
      // 点击未选中的牌：
      let newSelection;
      if (i === lo - 1) {
        // 左端扩展
        newSelection = [i, ...selectedIndices];
      } else if (i === hi + 1) {
        // 右端扩展
        newSelection = [...selectedIndices, i];
      } else {
        // 不相邻 → 重新单选
        newSelection = [i];
      }

      // ── 智能自动扩选：选区恰好变成 2 张相邻牌时，自动延伸同类牌 ──
      if (newSelection.length === 2) {
        const expanded = autoExpandSelection(newSelection);
        if (expanded.length > 2) {
          // 成功自动扩选：用特殊音效区分（或复用 cardSelect）
          selectedIndices = expanded;
          if (typeof SoundFX !== 'undefined') SoundFX.cardSelect();
          // 给用户一个视觉提示
          showToast(`✨ 自动选中 ${expanded.length} 张`, 'info', 1200);
          if (gameState) renderHand(gameState.myHand);
          updateActionBtns();
          return;
        }
      }

      selectedIndices = newSelection;
      if (typeof SoundFX !== 'undefined') SoundFX.cardSelect();
    }
  }

  if (gameState) renderHand(gameState.myHand);
  updateActionBtns();
}

// ── 3.4 前端实时合法性判定（复刻服务端逻辑）────────────────────
function clientGetCardValue(card) {
  return card.face === 'top' ? card.top : card.bottom;
}
function clientIsValidSet(cards) {
  if (cards.length < 2) return false;
  const vals = cards.map(clientGetCardValue);
  return vals.every(v => v === vals[0]);
}
function clientIsValidSequence(cards) {
  if (cards.length < 2) return false;
  const vals = cards.map(clientGetCardValue).sort((a, b) => a - b);
  for (let i = 1; i < vals.length; i++) {
    if (vals[i] !== vals[i - 1] + 1) return false;
  }
  return true;
}
function clientGetPlayType(cards) {
  if (!cards || cards.length === 0) return null;
  if (cards.length === 1) return 'set';
  if (clientIsValidSet(cards)) return 'set';
  if (clientIsValidSequence(cards)) return 'sequence';
  return null;
}
function clientBeats(myCards, myType, stage, stageType) {
  if (!stage || stage.length === 0) return true; // 无在场组，任何合法牌都能出
  const oldCount = stage.length;
  const newCount = myCards.length;
  if (newCount > oldCount) return true;
  if (newCount < oldCount) return false;
  // 张数相同比类型：set > sequence
  if (myType === 'set' && stageType === 'sequence') return true;
  if (myType === 'sequence' && stageType === 'set') return false;
  // 比最小值
  const newMin = Math.min(...myCards.map(clientGetCardValue));
  const oldMin = Math.min(...stage.map(clientGetCardValue));
  return newMin > oldMin;
}

/**
 * 更新 #play-hint 实时提示条
 * @returns {'valid-beats'|'valid-no-beat'|'invalid'|'empty'}
 */
function updatePlayHint() {
  const hint = document.getElementById('play-hint');
  if (!hint) return 'empty';

  // 修复：用 visible class 控制显隐（absolute 定位，不占高度，不推挤手牌）
  // display 始终保持 flex，只通过 opacity/transform transition 淡入淡出
  hint.style.display = 'flex';

  const isActive = isMyTurn || pendingFinishScoutAndShow;
  if (!isActive || selectedIndices.length === 0) {
    hint.className = 'play-hint';   // 移除状态类 → opacity:0 淡出
    return 'empty';
  }

  const hand  = gameState?.myHand || [];
  const cards = selectedIndices.map(i => hand[i]).filter(Boolean);
  const type  = clientGetPlayType(cards);

  if (!type) {
    hint.className = 'play-hint invalid visible';
    hint.textContent = '❌ 未形成合法组合';
    return 'invalid';
  }

  const stage     = gameState?.stage || [];
  const stageType = gameState?.stageType || null;
  const canBeat   = clientBeats(cards, type, stage, stageType);
  const typeLabel = type === 'set' ? '同号组' : '顺子';

  if (canBeat) {
    hint.className = 'play-hint valid-beats visible';
    hint.textContent = `✅ 可演出 · ${cards.length}张${typeLabel}`;
    return 'valid-beats';
  } else {
    hint.className = 'play-hint valid-no-beat visible';
    hint.textContent = `⚠️ 压不过 · ${cards.length}张${typeLabel}`;
    return 'valid-no-beat';
  }
}

// ── 按钮状态 ──────────────────────────────────────────────────

/**
 * bugfix(not-in-game): 临时禁用/恢复所有操作按钮。
 * 在 connect 触发（rejoin_game 发出）时调用 disabled=true，
 * 在 rejoin_result 成功回调中调用 disabled=false，
 * 确保服务端 socketId 映射完全建立后才允许玩家操作，
 * 消除「操作在映射空白窗口内到达服务端」这一竞态场景。
 */
function setActionBtnsDisabled(disabled) {
  ['btn-show', 'btn-scout', 'btn-scout-show', 'btn-managed'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = disabled;
  });
}

function updateActionBtns() {
  const btnShow  = document.getElementById('btn-show');
  const btnScout = document.getElementById('btn-scout');
  const btnSS    = document.getElementById('btn-scout-show');
  const btnManaged = document.getElementById('btn-managed');
  const playing  = isMyTurn && gameState?.state === 'playing';

  if (btnManaged) {
    btnManaged.style.display = playing ? 'inline-flex' : 'none';
  }

  // 3.4：每次按钮状态变化时同步更新实时提示
  const hintStatus = updatePlayHint();

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
  // 合法且能压才允许演出；合法但压不过显示 disabled（提示条已说明原因）
  btnShow.disabled  = selectedIndices.length === 0 || hintStatus === 'invalid' || hintStatus === 'valid-no-beat';
  btnScout.disabled = !hasStage;
  btnSS.disabled    = !hasStage || gameState.usedScoutAndShow;
}

// ── 渲染完整游戏状态 ──────────────────────────────────────────
let _prevIsMyTurn = false; // 用于检测轮次切换
function renderState(state) {
  gameState = state;
  const prevTurn = _prevIsMyTurn;

  if (isSpectator) {
    // 旁观者：不绑定自己的回合，不启动倒计时
    isMyTurn = false;
    // 更新旁观者工具栏
    updateSpectatorBar(state);
  } else {
    isMyTurn  = state.currentPlayerId === myPlayerId && state.state === 'playing';
    _prevIsMyTurn = isMyTurn;
    // 🔊 刚轮到自己时播放提示音
    if (isMyTurn && !prevTurn && state.state === 'playing') {
      if (typeof SoundFX !== 'undefined') SoundFX.yourTurn();
    }
  }

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
  renderLeaderboard(state);  // 左侧实时排行榜
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
  if (isSpectator) {
    // 旁观者：隐藏等待条和操作按钮区，显示旁观工具栏
    waiting.style.display = 'none';
    const actionWrap = document.getElementById('action-area-wrap');
    if (actionWrap) actionWrap.style.display = 'none';
  } else {
    waiting.style.display = (!isMyTurn && !pendingFinishScoutAndShow && state.state === 'playing') ? 'block' : 'none';
  }

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

// ── 旁观者工具栏更新 ─────────────────────────────────────────
function updateSpectatorBar(state) {
  const bar = document.getElementById('spectator-bar');
  if (!bar) return;
  bar.style.display = 'flex';

  // 当前观看的玩家名
  const viewId  = state.spectatorViewingId;
  const viewP   = state.players?.find(p => p.id === viewId);
  const nameEl  = document.getElementById('spectator-view-name');
  if (nameEl) nameEl.textContent = viewP ? viewP.name : '—';

  // 视角切换按钮（每个玩家一个）
  const btnsEl = document.getElementById('spectator-view-btns');
  if (btnsEl && state.players) {
    btnsEl.innerHTML = state.players.map(p => {
      const active = p.id === viewId ? ' spec-btn-active' : '';
      return `<button class="spec-view-btn${active}" onclick="switchSpectatorView('${p.id}','${p.name}')">${p.name}</button>`;
    }).join('');
  }

  // 手牌标签提示
  const label = document.getElementById('spectator-hand-label');
  if (label) label.textContent = viewP ? `👁️ ${viewP.name} 的手牌` : '旁观中';
}

// 切换旁观视角
function switchSpectatorView(playerId, playerName) {
  socket.emit('spectator_switch_view', { viewPlayerId: playerId });
  // 乐观更新名字
  const nameEl = document.getElementById('spectator-view-name');
  if (nameEl) nameEl.textContent = playerName;
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
  // 🔊 翻书音效（翻转 vs 撤销翻转音调不同）
  if (typeof SoundFX !== 'undefined') SoundFX.pageFlip(_hasFlipped);
}

function doConfirmFlip() {
  socket.emit('confirm_flip');
}

// ── 演出（SHOW）──────────────────────────────────────────────
function doShow() {
  if (!selectedIndices.length) {
    showToast('请先点击手牌（需连续位置）', 'error');
    if (typeof SoundFX !== 'undefined') SoundFX.error();
    return;
  }
  if (pendingFinishScoutAndShow) {
    socket.emit('finish_scout_and_show', { showIndices: selectedIndices });
    pendingFinishScoutAndShow = false;
    selectedIndices = [];
    hideScoutPendingBanner(); // 2.4 演出完成，隐藏 Banner
    if (typeof SoundFX !== 'undefined') SoundFX.scoutAndShow();
  } else {
    socket.emit('show', { cardIndices: selectedIndices });
    selectedIndices = [];
    if (typeof SoundFX !== 'undefined') SoundFX.cardPlay();
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

  // ── 2.5 disable 确认按钮，直到用户选端 ──
  confirmBtn.disabled = true;

  // ── 2.3 模式标签 ──
  const modeTag = document.getElementById('scout-mode-tag');
  if (modeTag) {
    modeTag.style.display = isAndShow ? 'inline-flex' : 'none';
  }

  // ── 2.1 重置分步进度条到 Step 1 ──
  setScoutStep(1);

  // ── 重置时显示引导提示
  const pickHint = document.getElementById('scout-pick-hint');
  if (pickHint) pickHint.style.display = 'flex';

  renderScoutPositions();
  renderInsertPreview();
  document.getElementById('scouted-preview').style.display = 'none';
  // 2.2 重置翻转 toggle
  const toggleWrap = document.getElementById('flip-face-toggle-wrap');
  if (toggleWrap) toggleWrap.style.display = 'none';
  willFlip = false;
  updateFlipFaceToggle();
  document.getElementById('scout-modal').style.display = 'flex';
}

function closeScoutModal() {
  document.getElementById('scout-modal').style.display = 'none';
  selPos = null; willFlip = false;
  // 清除选中状态，避免下次打开时视觉残留
  document.getElementById('pos-left')?.classList.remove('selected');
  document.getElementById('pos-right')?.classList.remove('selected');
}

function renderScoutPositions() {
  const stage = gameState?.stage || [];
  const leftCard  = stage[0];
  const rightCard = stage[stage.length - 1];

  const pLeft  = document.getElementById('preview-left');
  if (leftCard) {
    pLeft.innerHTML = miniCardHtml(leftCard, true);
  } else {
    pLeft.innerHTML = '<div style="color:var(--muted);font-size:0.75rem;">无</div>';
  }

  const pRight = document.getElementById('preview-right');
  if (stage.length === 0) {
    pRight.innerHTML = '<div style="color:var(--muted);font-size:0.75rem;">无</div>';
  } else {
    pRight.innerHTML = miniCardHtml(rightCard, true);
  }
}

function selectPos(pos) {
  selPos = pos;
  document.getElementById('pos-left').classList.toggle('selected',  pos === 'left');
  document.getElementById('pos-right').classList.toggle('selected', pos === 'right');

  // 用户已点选后，隐藏引导提示
  const pickHint = document.getElementById('scout-pick-hint');
  if (pickHint) pickHint.style.display = 'none';

  // 重置翻转状态（每次选新端时重置）
  willFlip = false;

  const stage = gameState?.stage || [];
  const card  = pos === 'left' ? stage[0] : stage[stage.length - 1];
  if (card) {
    document.getElementById('scouted-preview').style.display = 'flex';
    // 原地更新卡片内容（不重建 DOM，默认不加动画）
    updateScoutedCardDisplay(card, false);

    // 2.2 翻转 toggle / 无翻转提示
    const toggleWrap = document.getElementById('flip-face-toggle-wrap');
    const noFlipTip  = document.getElementById('no-flip-tip');
    const canFlip = card.top !== card.bottom;
    if (toggleWrap) toggleWrap.style.display = canFlip ? 'block' : 'none';
    if (noFlipTip)  noFlipTip.style.display  = canFlip ? 'none'  : 'block';
    updateFlipFaceToggle();
  }

  // ── 2.5 解锁确认按钮 ──
  const confirmBtn = document.getElementById('scout-confirm-btn');
  if (confirmBtn) confirmBtn.disabled = false;

  // ── 2.1 进入 Step 2 ──
  setScoutStep(2);

  renderInsertPreview();
}

// 原地更新大牌预览内容（不重建 DOM ，防止跳动）
function updateScoutedCardDisplay(card, flipped) {
  const displayCard = flipped
    ? { ...card, face: card.face === 'top' ? 'bottom' : 'top' }
    : card;
  const val   = cv(displayCard);
  const other = co(displayCard);
  const bg    = cardBg(val);

  const shell = document.getElementById('scouted-card-shell');
  const valEl = document.getElementById('scouted-card-val');
  const topEl = document.getElementById('scouted-card-top');
  const botEl = document.getElementById('scouted-card-bot');
  const subEl = document.getElementById('scouted-card-sub');

  if (!shell) return;

  // 更新颜色类名（先清除旧的）
  valEl.className = 'scouted-card-val ' + vc(val);
  valEl.textContent = val;
  shell.style.background = bg;
  topEl.textContent = other;
  botEl.textContent = other;
  subEl.textContent = flipped ? '（已翻转，以反面插入）' : '（以正面插入）';
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

// ── 2.1/2.2/2.4 辅助函数 ───────────────────────────────────

// 2.2 翻转 toggle 按钮（正/反面切换）
function toggleFlipFace() {
  willFlip = !willFlip;
  updateFlipFaceToggle();
  // 原地更新大牌预览（无跳动）
  const stage = gameState?.stage || [];
  const card  = selPos === 'left' ? stage[0] : stage[stage.length - 1];
  if (card) updateScoutedCardDisplay(card, willFlip);
  renderInsertPreview();
}

function updateFlipFaceToggle() {
  const btn   = document.getElementById('flip-face-toggle');
  const icon  = document.getElementById('flip-face-icon');
  const label = document.getElementById('flip-face-label');
  if (!btn || !icon || !label) return;
  if (willFlip) {
    btn.classList.add('flipped');
    icon.textContent  = '▼';
    label.textContent = '以反面插入';
  } else {
    btn.classList.remove('flipped');
    icon.textContent  = '▲';
    label.textContent = '以正面插入';
  }
}

// ── 2.4 挖+演持久 Banner ───────────────────────────────────
function showScoutPendingBanner() {
  const el = document.getElementById('scout-pending-banner');
  if (el) el.classList.add('show');
}

function hideScoutPendingBanner() {
  const el = document.getElementById('scout-pending-banner');
  if (el) el.classList.remove('show');
}

// ── 通用自定义 Confirm 弹窗 ───────────────────────────────────
let _confirmCallback = null;

/**
 * showConfirm({ title, message, confirmText, danger, onConfirm })
 * 替代原生 window.confirm()
 */
function showConfirm({ title = '请确认', message = '', confirmText = '确定', danger = false, icon = '⚠️', onConfirm }) {
  _confirmCallback = onConfirm || null;
  document.getElementById('confirm-title').textContent   = title;
  document.getElementById('confirm-message').textContent = message;
  document.getElementById('confirm-icon').textContent    = icon;
  document.getElementById('confirm-ok-btn').textContent  = confirmText;
  document.getElementById('confirm-ok-btn').className    = 'mbtn' + (danger ? ' danger' : ' mbtn-gold');
  document.getElementById('custom-confirm-modal').style.display = 'flex';
}

function closeCustomConfirm(confirmed) {
  document.getElementById('custom-confirm-modal').style.display = 'none';
  if (confirmed && typeof _confirmCallback === 'function') {
    _confirmCallback();
  }
  _confirmCallback = null;
}

function confirmDismissScoutBanner() {
  showConfirm({
    title:       '放弃演出？',
    message:     '放弃后本回合结束，挖到的牌保留在手牌中。',
    confirmText: '确定放弃',
    danger:      true,
    icon:        '⚠️',
    onConfirm:   dismissScoutBanner,
  });
}

function dismissScoutBanner() {
  // 放弃演出步骤：向服务端发送取消指令，服务端会结束本回合
  // 挖角不可逆，挖到的牌保留在手牌中
  socket.emit('cancel_scout_and_show');
  // 客户端状态在 scout_and_show_cancelled 事件回调中重置
}

function setScoutStep(step) {
  const s1 = document.getElementById('scout-step-1');
  const s2 = document.getElementById('scout-step-2');
  const insertSection = document.getElementById('insert-section-wrap');
  if (!s1 || !s2) return;
  s1.classList.toggle('active',  step === 1);
  s1.classList.toggle('done',    step > 1);
  s2.classList.toggle('active',  step === 2);
  // 选端前弱化插入区
  if (insertSection) {
    insertSection.style.opacity = step === 1 ? '0.35' : '1';
    insertSection.style.pointerEvents = step === 1 ? 'none' : 'auto';
  }
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

// ── 返回房间（点击后立刻跳转，不再有遮罩等待）─────────────────
let _hasClickedReturn = false;

function returnToRoom() {
  if (_hasClickedReturn) return;
  _hasClickedReturn = true;
  // 先通知服务端（服务端重置房间并回传 redirect_to_waiting）
  socket.emit('return_to_lobby');
}

// 兼容旧遮罩相关调用（保留空函数防止报错）
function returnToRoomFromOverlay() { returnToRoom(); }
function showReturnWaitingOverlay() {}
function hideReturnWaitingOverlay() {}

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

  // 📱 移动端：同步消息到底部聊天抽屉
  appendMobileChatMessage(playerName, content, type, isOwn);
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
  // 🔊 发快捷语音效
  if (typeof SoundFX !== 'undefined') SoundFX.chatSend();
  // 关闭面板但不冻结
}

function sendSticker(emoji) {
  if (!checkChatCooldown()) return;
  socket.emit('send_chat', { type: 'sticker', content: emoji });
  // 🔊 发贴纸音效
  if (typeof SoundFX !== 'undefined') SoundFX.chatSend();
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
  // 🔊 发消息音效
  if (typeof SoundFX !== 'undefined') SoundFX.chatSend();
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

// ★ bugfix(not-in-game): 原 socket.on('connect', ...) 已移入 init() IIFE（见文件顶部第81行）。
// 此处不再重复注册，避免 rejoin_game 被发送两次导致服务端 socketId 映射短暂空白。

socket.on('disconnect', () => {
  const dot = document.getElementById('conn-dot');
  if (dot) dot.className = 'offline';
  showToast('🔌 连接断开，正在重连...', 'error');
  clearTimer();
});

socket.on('rejoin_result', ({ success, state, message }) => {
  if (success && state) {
    renderState(state);
    // ★ bugfix(not-in-game): rejoin 确认成功后才恢复操作按钮，防止服务端映射建立前触发操作
    if (!isSpectator) setActionBtnsDisabled(false);
    document.getElementById('header-mid').textContent = '已重新连接';
    if (isManaged) {
      showManagedOverlay('已恢复连接', '当前处于托管状态，是否立即接管？', true);
    }
  } else {
    // rejoin 失败时也恢复按钮（会跳转回首页，但避免卡死）
    if (!isSpectator) setActionBtnsDisabled(false);
    showToast('⚠️ ' + (message || '连接失败'), 'error');
    clearGameSession();
    setTimeout(() => { window.location.href = '/'; }, 2500);
  }
});

// ── 旁观者相关事件 ──────────────────────────────────────────────
socket.on('spectator_joined', ({ spectatorId, spectatorName, roomCode, state, players }) => {
  // 保存旁观者 ID（用于重连）
  mySpecId = spectatorId;
  if (state) {
    renderState(state);
    // 旁观者视角：显示旁观工具栏，隐藏操作区
    const actionWrap = document.getElementById('action-area-wrap');
    if (actionWrap) actionWrap.style.display = 'none';
    updateSpectatorBar(state);
  }
  showToast(`👁️ 已进入旁观模式`, 'success');
});

socket.on('spectator_rejoined', ({ spectatorId, spectatorName, roomCode, state, players }) => {
  mySpecId = spectatorId;
  if (state) {
    renderState(state);
    const actionWrap = document.getElementById('action-area-wrap');
    if (actionWrap) actionWrap.style.display = 'none';
    updateSpectatorBar(state);
  }
  showToast(`👁️ 旁观重连成功`, 'success');
});

socket.on('spectator_rejoin_failed', ({ message }) => {
  showToast('⚠️ 旁观重连失败：' + message, 'error');
  setTimeout(() => { window.location.href = '/'; }, 2500);
});

socket.on('spectator_update', ({ spectators, joined, left }) => {
  // 显示旁观人数提示
  if (joined) showToast(`👁️ ${joined} 开始旁观`, 'info');
  if (left)   showToast(`👁️ ${left} 离开旁观`, 'info');
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
    // 🔊 翻牌完成 → 开始背景音乐
    if (typeof SoundFX !== 'undefined') {
      SoundFX.flip();
      setTimeout(() => SoundFX.startBgm(), 800);
    }
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

  // ── 方向2：高光时刻成就检测 ──
  triggerHighlightEffect(type, playerName);

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
  showToast('✅ 挖角成功！', 'success');
  showScoutPendingBanner(); // 2.4 持久 Banner
  updateActionBtns();
  // 🔊 挖角音效
  if (typeof SoundFX !== 'undefined') SoundFX.scout();
});

// 超时托管取消了"挖角并演出"的中间态 → 重置客户端状态
socket.on('scout_and_show_cancelled', ({ message }) => {
  pendingFinishScoutAndShow = false;
  scoutAndShowMode = false;
  selPos = null;
  selectedIndices = [];
  hideScoutPendingBanner(); // 2.4 隐藏 Banner
  showToast('⏰ ' + (message || '挖角并演出已超时取消'), 'error');
  updateActionBtns();
});

socket.on('action_error', ({ message }) => {
  showToast('❌ ' + message, 'error');
  selectedIndices = [];
  if (gameState) renderHand(gameState.myHand);
  updateActionBtns();
  // 出牌失败：重启倒计时
  if (isMyTurn) startTimer(TIMER_TOTAL);
  // 🔊 错误音效
  if (typeof SoundFX !== 'undefined') SoundFX.error();
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
  // 方向2：结算时触发高光动效（先播动效，稍后再弹结算弹窗）
  triggerRoundEndEffect(data);
  setTimeout(() => showRoundEnd(data), 600);
  // 🔊 回合结束音效
  if (typeof SoundFX !== 'undefined') SoundFX.roundEnd();
});

socket.on('game_over', (data) => {
  pendingFinishScoutAndShow = false;
  selectedIndices = [];
  // 方向2：游戏结束终局烟花
  triggerGameEndEffect(data);
  setTimeout(() => { showRoundEnd(data); }, 600);
  setTimeout(() => showGameEnd(data), 4200);
  // 🔊 游戏结束音效（胜者 vs 其他玩家）
  if (typeof SoundFX !== 'undefined') {
    SoundFX.stopBgm();
    const isWinner = data.gameWinnerId === myPlayerId;
    setTimeout(() => isWinner ? SoundFX.victory() : SoundFX.defeat(), 800);
  }
});

socket.on('round_started', ({ roundNumber }) => {
  document.getElementById('round-num').textContent = roundNumber;
  selectedIndices = [];
  pendingFinishScoutAndShow = false;
  isManaged = false;
  logItems.length = 0;
  showCaption(`🎪 第 ${roundNumber} 轮开始！`);
  addLog(`第 ${roundNumber} 轮开始`);
  // 🔊 新轮开始音效
  if (typeof SoundFX !== 'undefined') SoundFX.gameStart();
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
  // 🔊 收到他人消息时播放提示音
  if (!isOwn && type !== 'system' && typeof SoundFX !== 'undefined') SoundFX.chatReceive();
});

socket.on('lobby_error', ({ message }) => showToast('⚠️ ' + message, 'error'));
socket.on('error',       ({ message }) => showToast('⚠️ ' + message, 'error'));

// ── 返回房间：服务端通知立刻跳转 ────────────────────────────
socket.on('redirect_to_waiting', ({ roomCode, playerId }) => {
  const pid = playerId || myPlayerId;
  if (!pid) { window.location.href = '/'; return; }
  const params = new URLSearchParams({ returnRoom: roomCode, pid });
  window.location.href = '/?' + params.toString();
});

// ── 兼容旧事件（保留空处理，防止报错） ───────────────────────
socket.on('player_return_ready', () => {});
socket.on('room_reset', () => {});

// ── 初始化：添加游戏开始系统消息 ─────────────────────────────
socket.on('game_started', (state) => {
  appendChatMessage('', '🎪 游戏开始！欢迎来到 Scout！', 'system');
  renderState(state);
  // 🔊 游戏开始音效 + 启动背景音乐
  if (typeof SoundFX !== 'undefined') {
    SoundFX.gameStart();
    setTimeout(() => SoundFX.startBgm(), 1500);
  }
});

// ── 手牌容器 resize 时重新计算 spacer 居中 ─────────────────────
// 解决：拖动窗口改变宽度 / 移动端横竖屏切换时 spacer 宽度过时导致手牌偏移
(function initHandResizeObserver() {
  const el = document.getElementById('my-hand-cards');
  if (!el || typeof ResizeObserver === 'undefined') return;
  let _lastW = 0;
  const ro = new ResizeObserver(() => {
    const w = el.clientWidth;
    if (Math.abs(w - _lastW) < 2) return; // 微小抖动忽略
    _lastW = w;
    if (gameState?.myHand) renderHand(gameState.myHand);
  });
  ro.observe(el);
})();

// ── ESC 收起底部聊天条 ────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const bar = document.getElementById('chat-bar');
    if (bar?.classList.contains('expanded')) toggleChatBar();
    closeMobileLbDrawer();
    closeMobileChatDrawer();
  }
});

// ══════════════════════════════════════════════════════════════
//   📱 移动端抽屉控制（排行榜 + 聊天）
// ══════════════════════════════════════════════════════════════

let _mobileChatUnread = 0; // 未读计数（聊天抽屉未打开时）

// ── 排行榜抽屉 ────────────────────────────────────────────────
function openMobileLbDrawer() {
  const drawer = document.getElementById('mobile-lb-drawer');
  if (!drawer) return;
  // 同步最新数据
  syncMobileLb();
  drawer.style.display = 'flex';
  requestAnimationFrame(() => drawer.classList.add('open'));
  // 阻止背景滚动
  document.body.style.overflow = 'hidden';
}

function closeMobileLbDrawer() {
  const drawer = document.getElementById('mobile-lb-drawer');
  if (!drawer || !drawer.classList.contains('open')) return;
  drawer.classList.remove('open');
  drawer.addEventListener('transitionend', () => {
    drawer.style.display = 'none';
  }, { once: true });
  document.body.style.overflow = '';
}

function handleMobileLbOverlayClick(e) {
  // 点击遮罩（而非 sheet）时关闭
  if (e.target === document.getElementById('mobile-lb-drawer')) {
    closeMobileLbDrawer();
  }
}

// 将 #lb-body 的内容同步到移动端排行榜抽屉
function syncMobileLb() {
  const src  = document.getElementById('lb-body');
  const dest = document.getElementById('mobile-lb-body');
  if (!src || !dest) return;
  dest.innerHTML = src.innerHTML;
}

// ── 聊天抽屉 ──────────────────────────────────────────────────
function openMobileChatDrawer() {
  const drawer = document.getElementById('mobile-chat-drawer');
  if (!drawer) return;
  // 初始化快捷语
  initMobileQuickGrid();
  drawer.style.display = 'flex';
  requestAnimationFrame(() => drawer.classList.add('open'));
  document.body.style.overflow = 'hidden';
  // 清除未读徽章
  _mobileChatUnread = 0;
  const badge = document.getElementById('mobile-chat-badge');
  if (badge) badge.classList.remove('show');
  // 滚到底部
  const hist = document.getElementById('mobile-chat-history');
  if (hist) setTimeout(() => { hist.scrollTop = hist.scrollHeight; }, 60);
}

function closeMobileChatDrawer() {
  const drawer = document.getElementById('mobile-chat-drawer');
  if (!drawer || !drawer.classList.contains('open')) return;
  drawer.classList.remove('open');
  drawer.addEventListener('transitionend', () => {
    drawer.style.display = 'none';
  }, { once: true });
  document.body.style.overflow = '';
}

function handleMobileChatOverlayClick(e) {
  if (e.target === document.getElementById('mobile-chat-drawer')) {
    closeMobileChatDrawer();
  }
}

// 发送移动端聊天输入框内容
function sendMobileChatText() {
  const input = document.getElementById('mobile-chat-text');
  if (!input) return;
  const content = input.value.trim();
  if (!content) return;
  if (content.length > 20) { showToast('消息不超过20字', 'error'); return; }
  if (!checkChatCooldown()) return;
  socket.emit('send_chat', { type: 'text', content });
  input.value = '';
}

// 初始化移动端快捷语网格
function initMobileQuickGrid() {
  const grid = document.getElementById('mobile-quick-grid');
  if (!grid || grid.children.length > 0) return; // 已初始化则跳过
  const phrases = CONTEXT_PHRASES['default'];
  grid.innerHTML = phrases.map(p =>
    `<button class="mobile-quick-btn" onclick="sendQuick('${escapeHtml(p)}')">${p}</button>`
  ).join('');
}

// 刷新移动端快捷语（根据上下文切换）
function refreshMobileQuickGrid(ctx) {
  const grid    = document.getElementById('mobile-quick-grid');
  if (!grid) return;
  const phrases = CONTEXT_PHRASES[ctx] || CONTEXT_PHRASES.default;
  grid.innerHTML = phrases.map(p =>
    `<button class="mobile-quick-btn" onclick="sendQuick('${escapeHtml(p)}')">${p}</button>`
  ).join('');
}

// ── 消息同步到移动端聊天抽屉 ─────────────────────────────────
// 在 appendChatMessage 之后调用，将消息同步到 #mobile-chat-history
function appendMobileChatMessage(playerName, content, type, isOwn = false) {
  const hist = document.getElementById('mobile-chat-history');
  if (!hist) return;

  const div = document.createElement('div');
  if (type === 'system') {
    div.className = 'chat-msg';
    div.innerHTML = `<div class="chat-msg-system">${escapeXSS(content)}</div>`;
  } else {
    const isSticker = type === 'sticker';
    div.className = `chat-msg${isOwn ? ' mine' : ''}`;
    const initials = (playerName || '?').charAt(0).toUpperCase();
    const senderP = gameState?.players?.find(pl => isOwn ? pl.id === myPlayerId : pl.name === playerName);
    const avatarInner = senderP?.avatar
      ? `<img src="/avatars/${senderP.avatar}" alt="" style="width:100%;height:100%;object-fit:contain;" />`
      : initials;
    const avatarStyle = senderP?.avatar ? 'background:rgba(0,0,0,0.3);padding:2px;overflow:hidden;' : '';
    const bubbleContent = isSticker
      ? `<div class="chat-msg-sticker">${content}</div>`
      : `<div class="chat-msg-bubble">${escapeXSS(content)}</div>`;
    div.innerHTML = `
      <div class="chat-msg-avatar" style="${avatarStyle}">${avatarInner}</div>
      <div class="chat-msg-body">
        <div class="chat-msg-name">${isOwn ? '我' : escapeXSS(playerName)}</div>
        ${bubbleContent}
      </div>`;
  }
  hist.appendChild(div);
  while (hist.children.length > 60) hist.removeChild(hist.firstChild);
  hist.scrollTop = hist.scrollHeight;

  // 如果聊天抽屉未打开，累加未读徽章
  const drawer = document.getElementById('mobile-chat-drawer');
  if (!drawer?.classList.contains('open') && !isOwn && type !== 'system') {
    _mobileChatUnread++;
    const badge = document.getElementById('mobile-chat-badge');
    if (badge) {
      badge.textContent = _mobileChatUnread > 9 ? '9+' : String(_mobileChatUnread);
      badge.classList.add('show');
    }
  }
}

// ── 移动端排行榜同步（由原 renderLeaderboard 末尾调用）────────
// 注意：不在此重新定义 renderLeaderboard，避免 hoisting 导致覆盖！
// 同步逻辑已直接注入到 renderLeaderboard 函数体末尾（见上方）。
