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

// 保存昵称到 localStorage
function saveNickname(name) {
  localStorage.setItem('scout_game_nickname', name);
}

// ── 游戏会话检测与恢复 ────────────────────────────────────────
(function checkGameSession() {
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

// ── URL参数检测（房间链接分享） ────────────────────────────────
(function checkUrlParams() {
  const urlParams = new URLSearchParams(window.location.search);
  const roomCode = urlParams.get('room');
  
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
  saveNickname(name); // 保存昵称
  socket.emit('create_room', { playerName: name });
}

function joinRoom() {
  const name = document.getElementById('player-name').value.trim();
  const code = document.getElementById('room-code-input').value.trim().toUpperCase();
  if (!name) return showError('entry-error', '请先输入你的昵称');
  if (!code) return showError('entry-error', '请输入房间码');
  myPlayerName = name;
  saveNickname(name); // 保存昵称
  socket.emit('join_room', { roomCode: code, playerName: name });
}

function startGame() {
  socket.emit('start_game');
}

function renderPlayers(players) {
  const container = document.getElementById('player-list-container');
  const countEl = document.getElementById('player-count');
  countEl.textContent = players.length;
  container.innerHTML = players.map(p => `
    <div class="player-item">
      <div class="player-avatar">${p.name.charAt(0).toUpperCase()}</div>
      <div class="player-info">
        <div class="name">${p.name}${p.id === myPlayerId ? ' (我)' : ''}</div>
        ${p.isHost ? '<div class="role">👑 房主</div>' : ''}
      </div>
      ${isHost && p.id !== myPlayerId ? 
        `<button class="btn-kick" onclick="kickPlayer('${p.id}')">❌</button>` 
        : ''}
    </div>
  `).join('');
}

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
    btn.style.display = players.length >= 2 ? 'block' : 'none';
    hint.textContent = players.length < 2
      ? '还需要至少1名玩家才能开始...'
      : `${players.length} 人已就绪，可以开始游戏！`;
  } else {
    btn.style.display = 'none';
    hint.textContent = '等待房主开始游戏...';
  }
}

// ── Socket 事件 ──────────────────────────────────────────────
socket.on('room_created', ({ roomCode, playerId, players }) => {
  myPlayerId = playerId;
  myRoomCode = roomCode;
  isHost = true;
  showWaitingRoom(roomCode, players);
});

socket.on('room_joined', ({ roomCode, playerId, players }) => {
  myPlayerId = playerId;
  myRoomCode = roomCode;
  isHost = false;
  showWaitingRoom(roomCode, players);
});

socket.on('player_joined', ({ players }) => {
  renderPlayers(players);
  updateStartButton(players);
});

socket.on('player_left', ({ players }) => {
  renderPlayers(players);
  updateStartButton(players);
});

socket.on('game_started', () => {
  // 跳转时传递稳定的 playerId（不是 socketId）
  const params = new URLSearchParams({
    room: myRoomCode,
    pid: myPlayerId,
  });
  window.location.href = '/game.html?' + params.toString();
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
