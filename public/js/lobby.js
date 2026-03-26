/**
 * 大厅页逻辑 v2
 * - 服务器返回稳定 playerId（非 socketId）
 * - 跳转时把 roomCode + playerId 带入 URL 参数
 */

const socket = io();
let myPlayerId = null;
let myRoomCode = null;
let myPlayerName = null;
let isHost = false;

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
  socket.emit('create_room', { playerName: name });
}

function joinRoom() {
  const name = document.getElementById('player-name').value.trim();
  const code = document.getElementById('room-code-input').value.trim().toUpperCase();
  if (!name) return showError('entry-error', '请先输入你的昵称');
  if (!code) return showError('entry-error', '请输入房间码');
  myPlayerName = name;
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
  // 构建分享文本
  const shareText = `来和我一起玩 Scout！马戏星探 🎪\n房间码：${code}\n${window.location.origin}`;
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(shareText).then(() => {
      btn.textContent = '✅ 已复制！';
      btn.classList.add('copied');
      setTimeout(() => { btn.textContent = '📋 复制房间码'; btn.classList.remove('copied'); }, 2500);
    });
  } else {
    // 兼容旧版浏览器
    const ta = document.createElement('textarea');
    ta.value = shareText;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    btn.textContent = '✅ 已复制！';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = '📋 复制房间码'; btn.classList.remove('copied'); }, 2500);
  }
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

// Enter 键触发
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const code = document.getElementById('room-code-input').value.trim();
    if (code) joinRoom(); else createRoom();
  }
});
