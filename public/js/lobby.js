/**
 * 大厅页逻辑 v3 - 用户体验优化
 * - 昵称记忆（localStorage）
 * - 房间链接分享
 * - 游戏会话保存与恢复
 */

const socket = io();
let myPlayerId = null;
let myRoomCode = null;
let myPlayerName = null;
let isHost = false;

// ── 昵称记忆功能 ──────────────────────────────────────────────
// 页面加载时读取保存的昵称
(function loadSavedNickname() {
  const savedNickname = localStorage.getItem('scout_game_nickname');
  if (savedNickname) {
    document.getElementById('player-name').value = savedNickname;
  }
})();

// 保存昵称到 localStorage（同时写入历史记录，供首页 chips 使用）
function saveNickname(name) {
  if (!name?.trim()) return;
  // 1. 保存"上次昵称"（用于自动回填，含定语）
  localStorage.setItem('scout_game_nickname', name.trim());
  // 2. 历史记录只存纯 base 昵称（不含定语）
  //    index.html 内联脚本会把 base 挂到 window._nicknameBase
  const baseName = (window._nicknameBase?.trim()) || name.trim();
  const HISTORY_KEY = 'scout_nickname_history';
  const MAX = 8;
  let history = [];
  try { history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch (e) {}
  history = [baseName, ...history.filter(n => n !== baseName)].slice(0, MAX);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

// ── 房主房间记忆 ───────────────────────────────────────────────
// 检测房主房间并显示返回提示
(function checkHostRoom() {
  const hostRoom = localStorage.getItem('scout_host_room');
  if (hostRoom) {
    try {
      const { roomCode, playerId, playerName, timestamp } = JSON.parse(hostRoom);
      const now = Date.now();
      const elapsed = now - timestamp;
      
      // 如果房间在5分钟内，显示返回等待室提示
      if (elapsed < 5 * 60 * 1000) {
        showHostRoomModal(roomCode, playerId, playerName);
      } else {
        // 房间过期，清除
        localStorage.removeItem('scout_host_room');
      }
    } catch (e) {
      console.error('解析房主房间失败:', e);
      localStorage.removeItem('scout_host_room');
    }
  }
})();

// 显示返回等待室提示框
function showHostRoomModal(roomCode, playerId, playerName) {
  const modal = document.createElement('div');
  modal.id = 'host-room-modal';
  // 强制 fixed 全屏遮罩，避免插入文档流导致页面布局偏移
  Object.assign(modal.style, {
    position: 'fixed',
    top: '0', left: '0', right: '0', bottom: '0',
    background: 'rgba(0,0,0,0.75)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: '10000',
    backdropFilter: 'blur(4px)',
    animation: 'fadeIn 0.25s ease',
  });
  modal.innerHTML = `
    <div class="continue-modal-content">
      <h3>👑 检测到您的房间</h3>
      <p>房间码: <strong>${roomCode}</strong></p>
      <p>玩家: <strong>${playerName}</strong></p>
      <p>是否返回等待室?</p>
      <div class="continue-modal-btns">
        <button class="btn-primary" onclick="rejoinHostRoom('${roomCode}', '${playerId}')">返回等待室</button>
        <button class="btn-secondary" onclick="dismissHostRoomModal()">创建新房间</button>
      </div>
    </div>
  `;
  
  // 点击遮罩背景关闭
  modal.addEventListener('click', (e) => {
    if (e.target === modal) dismissHostRoomModal();
  });
  
  document.body.appendChild(modal);
}

// 返回等待室（房主重连）
function rejoinHostRoom(roomCode, playerId) {
  socket.emit('rejoin_as_host', { roomCode, playerId });
}

// 关闭房主房间提示框
function dismissHostRoomModal() {
  const modal = document.getElementById('host-room-modal');
  if (modal) modal.remove();
  localStorage.removeItem('scout_host_room');
}

// 保存房主房间信息
function saveHostRoom(roomCode, playerId, playerName) {
  localStorage.setItem('scout_host_room', JSON.stringify({
    roomCode,
    playerId,
    playerName,
    timestamp: Date.now()
  }));
}

// ── 游戏会话检测与恢复 ────────────────────────────────────────
(function checkGameSession() {
  // 如果是从游戏结束页返回（?returnRoom=...），跳过会话恢复弹窗
  if (new URLSearchParams(window.location.search).get('returnRoom')) return;

  const session = localStorage.getItem('scout_game_session');
  if (session) {
    try {
      const { roomCode, playerId, timestamp } = JSON.parse(session);
      const now = Date.now();
      const elapsed = now - timestamp;
      
      // 如果会话在30分钟内,显示继续游戏提示
      if (elapsed < 30 * 60 * 1000) {
        showContinueGameModal(roomCode, playerId);
      } else {
        // 会话过期,清除
        localStorage.removeItem('scout_game_session');
      }
    } catch (e) {
      console.error('解析游戏会话失败:', e);
      localStorage.removeItem('scout_game_session');
    }
  }
})();

// 显示继续游戏提示框
function showContinueGameModal(roomCode, playerId) {
  const modal = document.createElement('div');
  modal.id = 'continue-game-modal';
  modal.innerHTML = `
    <div class="continue-modal-content">
      <h3>🎮 检测到未完成的游戏</h3>
      <p>房间码: <strong>${roomCode}</strong></p>
      <p>是否继续之前的游戏?</p>
      <div class="continue-modal-btns">
        <button class="btn-primary" onclick="continueGame('${roomCode}', '${playerId}')">继续游戏</button>
        <button class="btn-secondary" onclick="dismissContinueModal()">开始新游戏</button>
      </div>
    </div>
  `;
  
  // 点击模态框背景关闭
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      dismissContinueModal();
    }
  });
  
  document.body.appendChild(modal);
}

// 继续游戏
function continueGame(roomCode, playerId) {
  const params = new URLSearchParams({ room: roomCode, pid: playerId });
  window.location.href = '/game.html?' + params.toString();
}

// 关闭继续游戏提示框
function dismissContinueModal() {
  const modal = document.getElementById('continue-game-modal');
  if (modal) modal.remove();
  localStorage.removeItem('scout_game_session');
}

// ── URL参数检测（房间链接分享 + 游戏结束返回等待室） ─────────────
(function checkUrlParams() {
  const urlParams = new URLSearchParams(window.location.search);
  const roomCode  = urlParams.get('room');
  const returnRoom = urlParams.get('returnRoom');
  const returnPid  = urlParams.get('pid');

  // 从游戏结束页返回：自动 rejoin 等待室
  if (returnRoom && returnPid) {
    // 清理 URL，避免刷新重复触发
    history.replaceState(null, '', '/');
    // 清除旧游戏会话（避免会话弹窗干扰）
    localStorage.removeItem('scout_game_session');
    localStorage.removeItem('scout_host_room');
    // 关闭任何已弹出的会话弹窗
    ['continue-game-modal', 'host-room-modal'].forEach(id => {
      document.getElementById(id)?.remove();
    });
    // 等 socket 连接好后自动发送
    const doRejoin = () => {
      socket.emit('rejoin_waiting_room', { roomCode: returnRoom, playerId: returnPid });
    };
    if (socket.connected) {
      doRejoin();
    } else {
      socket.once('connect', doRejoin);
    }
    return;
  }

  if (roomCode) {
    // 自动填充房间码
    document.getElementById('room-code-input').value = roomCode.toUpperCase();
    
    // 显示提示信息
    const hint = document.createElement('div');
    hint.style.cssText = `
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(63,185,80,0.15);
      border: 1px solid rgba(63,185,80,0.4);
      color: #3fb950;
      padding: 12px 24px;
      border-radius: 12px;
      font-size: 14px;
      z-index: 1000;
      animation: slideDown 0.3s;
    `;
    hint.textContent = `✅ 已自动填入房间码：${roomCode.toUpperCase()}`;
    document.body.appendChild(hint);
    
    setTimeout(() => {
      hint.style.animation = 'fadeOut 0.3s';
      setTimeout(() => hint.remove(), 300);
    }, 3000);
  }
})();

// 监听 rejoin_waiting_room 成功
socket.on('waiting_room_rejoined', ({ roomCode, playerId, players, isHost: h }) => {
  myPlayerId = playerId;
  myRoomCode = roomCode;
  isHost = h;
  showWaitingRoom(roomCode, players);
});

// rejoin_waiting_room 失败
socket.on('rejoin_waiting_failed', ({ message }) => {
  showError('entry-error', message || '返回等待室失败，请手动输入房间码');
});

function showError(elId, msg) {
  const el = document.getElementById(elId);
  el.textContent = msg;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 4000);
}

function createRoom() {
  const name = document.getElementById('player-name').value.trim();
  if (!name) return showError('entry-error', '请先输入你的昵称');
  myPlayerName = name;
  saveNickname(name);
  const avatar = localStorage.getItem('scout_game_avatar') || '';
  socket.emit('create_room', { playerName: name, playerAvatar: avatar });
}

function joinRoom() {
  const name = document.getElementById('player-name').value.trim();
  const code = document.getElementById('room-code-input').value.trim().toUpperCase();
  if (!name) return showError('entry-error', '请先输入你的昵称');
  if (!code) return showError('entry-error', '请输入房间码');
  myPlayerName = name;
  saveNickname(name);
  const avatar = localStorage.getItem('scout_game_avatar') || '';
  socket.emit('join_room', { roomCode: code, playerName: name, playerAvatar: avatar });
}

function joinAsSpectator() {
  const name = document.getElementById('player-name').value.trim();
  const code = document.getElementById('room-code-input').value.trim().toUpperCase();
  if (!name) return showError('entry-error', '请先输入你的昵称');
  if (!code) return showError('entry-error', '请输入要旁观的房间码');

  // 禁用按钮防止重复点击
  const btn = document.getElementById('btn-spectate');
  if (btn) { btn.disabled = true; btn.textContent = '连接中...'; }

  socket.emit('join_as_spectator', { roomCode: code, spectatorName: name });
}

socket.on('spectator_joined', ({ spectatorId, roomCode, state, players }) => {
  // 跳转到游戏页面，带旁观标记
  const params = new URLSearchParams({
    room: roomCode,
    pid: spectatorId,
    spectator: '1',
    specId: spectatorId,
  });
  window.location.href = '/game.html?' + params.toString();
});

// 旁观加入失败处理（复用 error 事件）
const _origErrorHandler = null;
socket.on('error', ({ message }) => {
  const btn = document.getElementById('btn-spectate');
  if (btn) { btn.disabled = false; btn.textContent = '👁️ 旁观进行中的游戏'; }
  showError('entry-error', message || '旁观失败');
});

function startGame() {
  socket.emit('start_game');
}

function leaveRoom() {
  socket.emit('leave_room');
  // 清理本地状态后跳回首页（服务端也会广播玩家列表更新）
  myPlayerId  = null;
  myRoomCode  = null;
  myPlayerName = null;
  isHost      = false;
  localStorage.removeItem('scout_host_room');
  window.location.href = '/';
}

function renderPlayers(players) {
  const container = document.getElementById('player-list-container');
  const countEl = document.getElementById('player-count');
  countEl.textContent = players.length;
  container.innerHTML = players.map(p => {
    // returned 字段：如果有则显示返回状态标签
    const returnTag = (p.returned === true || p.returned === false)
      ? `<span class="return-status ${p.returned ? 'returned' : 'not-returned'}">${p.returned ? '✅ 已返回' : '⏳ 未返回'}</span>`
      : '';
    const cardClass = p.returned === false ? 'not-returned-card'
      : p.returned === true ? 'returned-card' : '';
    return `
    <div class="player-item ${cardClass}">
      <div class="player-avatar">${p.avatar
        ? `<img src="/avatars/${p.avatar}" alt="" />`
        : p.name.charAt(0).toUpperCase()
      }</div>
      <div class="player-info">
        <div class="name">${p.name}${p.id === myPlayerId ? ' (我)' : ''}</div>
        ${p.isHost ? '<div class="role">👑 房主</div>' : ''}
        ${returnTag}
      </div>
      ${isHost && p.id !== myPlayerId ?
        `<button class="btn-kick" onclick="kickPlayer('${p.id}')">❌</button>`
        : ''}
    </div>`;
  }).join('');
}

// 监听玩家返回状态广播（再来一局过程中实时更新）
socket.on('players_return_status', ({ players }) => {
  renderPlayers(players);
  updateStartButton(players);
});

function showWaitingRoom(roomCode, players) {
  document.getElementById('lobby-entry').style.display = 'none';
  document.getElementById('lobby-waiting').style.display = 'block';
  document.getElementById('display-room-code').textContent = roomCode;
  renderPlayers(players);
  updateStartButton(players);
}

function copyRoomCode() {
  const code = myRoomCode || document.getElementById('display-room-code').textContent;
  const btn = document.getElementById('copy-btn');
  
  // 生成带房间码的链接
  const link = `${window.location.origin}/?room=${code}`;
  
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(link).then(() => {
      btn.textContent = '✅ 已复制链接！';
      btn.classList.add('copied');
      setTimeout(() => { btn.textContent = '📋 复制房间链接'; btn.classList.remove('copied'); }, 2500);
    }).catch(() => {
      fallbackCopy(link, btn);
    });
  } else {
    fallbackCopy(link, btn);
  }
}

function fallbackCopy(text, btn) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
  btn.textContent = '✅ 已复制链接！';
  btn.classList.add('copied');
  setTimeout(() => { btn.textContent = '📋 复制房间链接'; btn.classList.remove('copied'); }, 2500);
}

function updateStartButton(players) {
  const btn = document.getElementById('btn-start');
  const hint = document.getElementById('waiting-hint');
  if (isHost) {
    // 检查是否有玩家「未返回」（再来一局流程中）
    const notReturnedPlayers = players.filter(p => p.returned === false);
    const hasNotReturned = notReturnedPlayers.length > 0;

    if (players.length < 2) {
      btn.style.display = 'none';
      hint.textContent = '还需要至少1名玩家才能开始...';
    } else if (hasNotReturned) {
      // 有人未返回：按钮显示但禁用，提示踢掉才能开始
      btn.style.display = 'block';
      btn.disabled = true;
      btn.style.opacity = '0.45';
      btn.style.cursor = 'not-allowed';
      const names = notReturnedPlayers.map(p => p.name).join('、');
      hint.textContent = `⏳ ${names} 尚未返回房间，请等待或将其踢出后开始`;
    } else {
      btn.style.display = 'block';
      btn.disabled = false;
      btn.style.opacity = '';
      btn.style.cursor = '';
      hint.textContent = `${players.length} 人已就绪，可以开始游戏！`;
    }
  } else {
    btn.style.display = 'none';
    // 检查是否有人未返回，给非房主也显示状态
    const notReturnedPlayers = players.filter(p => p.returned === false);
    if (notReturnedPlayers.length > 0) {
      const names = notReturnedPlayers.map(p => p.name).join('、');
      hint.textContent = `⏳ 等待 ${names} 返回房间...`;
    } else {
      hint.textContent = '等待房主开始游戏...';
    }
  }
}

// ── Socket 事件 ──────────────────────────────────────────────
socket.on('room_created', ({ roomCode, playerId, players }) => {
  myPlayerId = playerId;
  myRoomCode = roomCode;
  isHost = true;
  // 保存房主房间信息
  saveHostRoom(roomCode, playerId, myPlayerName);
  showWaitingRoom(roomCode, players);
});

socket.on('room_joined', ({ roomCode, playerId, players }) => {
  myPlayerId = playerId;
  myRoomCode = roomCode;
  isHost = false;
  showWaitingRoom(roomCode, players);
});

// 房主返回等待室成功
socket.on('host_rejoined', ({ roomCode, playerId, players }) => {
  myPlayerId = playerId;
  myRoomCode = roomCode;
  isHost = true;
  // 关闭提示框
  dismissHostRoomModal();
  // 进入等待室
  showWaitingRoom(roomCode, players);
  console.log('[房主返回] 成功返回等待室');
});

// 房主重连失败（兼容新旧事件名）
socket.on('lobby_error', ({ message }) => {
  dismissHostRoomModal();
  showError('entry-error', message || '返回失败，房间可能已过期');
  localStorage.removeItem('scout_host_room');
});
socket.on('rejoin_failed', ({ message }) => {
  dismissHostRoomModal();
  showError('entry-error', message || '返回失败，房间可能已过期');
  localStorage.removeItem('scout_host_room');
});

socket.on('player_joined', ({ players }) => {
  renderPlayers(players);
  updateStartButton(players);
});

socket.on('player_left', ({ players }) => {
  renderPlayers(players);
  updateStartButton(players);
});

// ── 选座位阶段（由 start_game 触发） ─────────────────────────
let seatingData = null; // { players, totalSeats, seating, hostPlayerId }

socket.on('seating_phase', (data) => {
  seatingData = data;
  openSeatingModal(data);
});

socket.on('seat_updated', ({ seating, players }) => {
  if (seatingData) {
    seatingData.seating  = seating;
    seatingData.players  = players;
    renderSeatingModal(seatingData);
  }
});

function openSeatingModal(data) {
  const modal = document.getElementById('seating-modal');
  if (!modal) return;
  modal.classList.add('open');
  renderSeatingModal(data);
  // 房主才显示「确认开始」按钮
  const btnConfirm = document.getElementById('btn-seating-confirm');
  if (btnConfirm) btnConfirm.style.display = data.hostPlayerId === myPlayerId ? 'inline-flex' : 'none';
}

function renderSeatingModal(data) {
  const wrap = document.getElementById('seating-table-wrap');
  if (!wrap) return;

  const { players, totalSeats, seating } = data;
  const felt  = wrap.querySelector('.seating-felt');
  // 清除旧 seat-btn
  wrap.querySelectorAll('.seat-btn').forEach(el => el.remove());

  // 椭圆参数（与游戏圆桌一致）
  const cx = 50, cy = 50;
  const rx = 38, ry = 38;

  for (let seatIdx = 1; seatIdx <= totalSeats; seatIdx++) {
    const angleDeg = 90 + (seatIdx - 1) * (360 / totalSeats);
    const rad      = angleDeg * Math.PI / 180;
    const sx       = cx + rx * Math.cos(rad);
    const sy       = cy + ry * Math.sin(rad);

    // 查找该座位的玩家
    const occupantId = Object.entries(seating).find(([pid, si]) => si === seatIdx)?.[0];
    const occupant   = occupantId ? players.find(p => p.id === occupantId) : null;
    const isMe       = occupantId === myPlayerId;

    const btn = document.createElement('button');
    btn.className = `seat-btn${occupant ? ' taken' : ''}${isMe ? ' mine' : ''}`;
    btn.style.left = `${sx}%`;
    btn.style.top  = `${sy}%`;
    btn.onclick    = () => chooseSeatClick(seatIdx);

    const label = occupant ? occupant.name.slice(0, 3) : `${seatIdx}`;
    const sub   = occupant ? (isMe ? '👤 我' : occupant.name) : '空位';
    btn.innerHTML = `
      <div class="seat-circle">${seatIdx}</div>
      <div class="seat-label">${sub}</div>`;
    wrap.appendChild(btn);
  }

  // 状态文字
  const chosen  = Object.keys(seating).length;
  const total   = totalSeats;
  const statusEl = document.getElementById('seating-status');
  if (statusEl) {
    statusEl.textContent = chosen === total
      ? `✅ 所有玩家已选座位，房主可以确认开始！`
      : `已选 ${chosen}/${total} 位，等待玩家选座...`;
  }
}

function chooseSeatClick(seatIndex) {
  socket.emit('choose_seat', { seatIndex });
}

function seatingRandom() {
  // 找一个还没有被自己或他人占用的随机空座位
  if (!seatingData) return;
  const { totalSeats, seating } = seatingData;
  const myCurrentSeat = seating[myPlayerId];
  const usedByOthers  = new Set(
    Object.entries(seating).filter(([pid]) => pid !== myPlayerId).map(([, si]) => si)
  );
  const available = [];
  for (let i = 1; i <= totalSeats; i++) {
    if (!usedByOthers.has(i)) available.push(i);
  }
  if (available.length === 0) return;
  const pick = available[Math.floor(Math.random() * available.length)];
  socket.emit('choose_seat', { seatIndex: pick });
}

function seatingConfirm() {
  socket.emit('confirm_seating');
}

// 游戏正式开始（选座位后跳转）
socket.on('game_started', () => {
  // 游戏开始时清除房主房间记录
  localStorage.removeItem('scout_host_room');
  // 关闭选座位弹窗（如果打开）
  const modal = document.getElementById('seating-modal');
  if (modal) modal.classList.remove('open');

  // 🔊 游戏开始提示音
  if (typeof SoundFX !== 'undefined') {
    SoundFX.unlock();
    SoundFX.gameStart();
  }

  // 稍作延迟让音效播完再跳转
  setTimeout(() => {
    const params = new URLSearchParams({
      room: myRoomCode,
      pid: myPlayerId,
    });
    window.location.href = '/game.html?' + params.toString();
  }, 400);
});

socket.on('error', ({ message }) => {
  showError('entry-error', message);
});

// ── 踢人功能 ──────────────────────────────────────────────
function kickPlayer(targetPlayerId) {
  if (!confirm('确定要踢出这名玩家吗？')) return;
  socket.emit('kick_player', { targetPlayerId });
}

// 监听踢人成功
socket.on('kick_success', ({ message }) => {
  showToast(message, 'success');
});

// 监听踢人失败
socket.on('kick_failed', ({ message }) => {
  showToast(message, 'error');
});

// 监听被踢出
socket.on('kicked_out', ({ message }) => {
  alert(message);
  window.location.href = '/';
});

// 监听玩家列表更新（踢人后）
socket.on('players_updated', ({ players }) => {
  // 更新isHost状态
  const me = players.find(p => p.id === myPlayerId);
  if (me) {
    isHost = me.isHost;
  }
  renderPlayers(players);
  updateStartButton(players);
});

// Toast提示
function showToast(msg, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = msg;
  toast.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 12px 20px;
    background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6'};
    color: white;
    border-radius: 8px;
    font-size: 14px;
    z-index: 10000;
    animation: slideIn 0.3s ease-out;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  `;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s ease-out';
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

// Enter 键触发
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const code = document.getElementById('room-code-input').value.trim();
    if (code) joinRoom(); else createRoom();
  }
});
