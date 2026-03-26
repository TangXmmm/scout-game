/**
 * Scout 在线多人桌游 - 服务端主程序 v2
 * 修复：使用独立 playerId，彻底解耦身份与 socketId
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const gameManager = require('./game/GameManager');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  // 支持 WebSocket 和轮询，兼容 Railway 等云平台
  transports: ['websocket', 'polling'],
});

app.use(express.static(path.join(__dirname, 'public')));

// ─────────────────────────────────────────────────────────────
// 辅助函数（全局）
// ─────────────────────────────────────────────────────────────

function broadcastGameState(room) {
  room.players.forEach(p => {
    if (p.socketId && p.online !== false) {
      const state = room.game.getStateForPlayer(p.id);
      io.to(p.socketId).emit('game_state', state);
    }
  });
}

function getPlayersInfo(room) {
  return room.players.map(p => ({
    id: p.id,
    name: p.name,
    isHost: p.id === room.hostPlayerId,
    online: p.online !== false,
  }));
}

function handleRoundEnd(room, result) {
  broadcastGameState(room);

  const roundEndData = {
    roundWinnerId: result.roundWinner,
    roundWinnerName: room.players.find(p => p.id === result.roundWinner)?.name,
    roundScores: result.roundScores,
    totalScores: result.totalScores,
    playerNames: {},
    gameOver: result.gameOver,
  };
  room.players.forEach(p => { roundEndData.playerNames[p.id] = p.name; });

  if (result.gameOver) {
    let maxScore = -Infinity, gameWinnerId = null;
    Object.entries(result.totalScores).forEach(([id, score]) => {
      if (score > maxScore) { maxScore = score; gameWinnerId = id; }
    });
    roundEndData.gameWinnerId = gameWinnerId;
    roundEndData.gameWinnerName = room.players.find(p => p.id === gameWinnerId)?.name;
    io.to(room.code).emit('game_over', roundEndData);
    room.status = 'finished';
  } else {
    io.to(room.code).emit('round_end', roundEndData);
  }
}

// ─────────────────────────────────────────────────────────────
// Socket.io 事件处理
// ─────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`[连接] ${socket.id}`);

  // ── 创建房间 ──────────────────────────────────────────────
  socket.on('create_room', ({ playerName }) => {
    if (!playerName?.trim()) return socket.emit('error', { message: '请输入玩家昵称' });

    const result = gameManager.createRoom(socket.id, playerName.trim());
    if (result.success) {
      socket.join(result.roomCode);
      const room = gameManager.rooms[result.roomCode];
      socket.emit('room_created', {
        roomCode: result.roomCode,
        playerId: result.playerId,  // 发给客户端存储的稳定ID
        players: getPlayersInfo(room),
      });
      console.log(`[创建房间] ${result.roomCode} by ${playerName} (pid:${result.playerId})`);
    } else {
      socket.emit('error', { message: result.message });
    }
  });

  // ── 加入房间 ──────────────────────────────────────────────
  socket.on('join_room', ({ roomCode, playerName }) => {
    if (!playerName?.trim()) return socket.emit('error', { message: '请输入玩家昵称' });

    const result = gameManager.joinRoom(socket.id, roomCode?.toUpperCase(), playerName.trim());
    if (result.success) {
      socket.join(result.roomCode);
      const room = gameManager.rooms[result.roomCode];
      const playersInfo = getPlayersInfo(room);

      socket.emit('room_joined', {
        roomCode: result.roomCode,
        playerId: result.playerId,
        players: playersInfo,
      });
      socket.to(result.roomCode).emit('player_joined', {
        players: playersInfo,
        newPlayer: playerName.trim(),
      });
      console.log(`[加入房间] ${result.roomCode} by ${playerName} (pid:${result.playerId})`);
    } else {
      socket.emit('error', { message: result.message });
    }
  });

  // ── 重新加入（页面跳转/刷新重连）──────────────────────────
  socket.on('rejoin_game', ({ roomCode, playerId }) => {
    const result = gameManager.rejoinGame(socket.id, roomCode, playerId);
    if (result.success) {
      socket.join(roomCode.toUpperCase());
      const state = result.room.game
        ? result.room.game.getStateForPlayer(playerId)
        : null;
      socket.emit('rejoin_result', {
        success: true,
        state,
        roomCode: roomCode.toUpperCase(),
        players: getPlayersInfo(result.room),
      });
      console.log(`[重连] ${result.player.name} 重新加入 ${roomCode}`);
    } else {
      socket.emit('rejoin_result', { success: false, message: result.message });
    }
  });

  // ── 开始游戏 ──────────────────────────────────────────────
  socket.on('start_game', () => {
    const result = gameManager.startGame(socket.id);
    if (result.success) {
      const room = gameManager.getRoom(socket.id);
      room.players.forEach(p => {
        const state = room.game.getStateForPlayer(p.id);
        io.to(p.socketId).emit('game_started', state);
      });
      console.log(`[游戏开始] ${room.code}`);
    } else {
      socket.emit('error', { message: result.message });
    }
  });

  // ── 翻转手牌 ──────────────────────────────────────────────
  socket.on('flip_hand', () => {
    const room = gameManager.getRoom(socket.id);
    const playerId = gameManager.getPlayerId(socket.id);
    if (!room?.game) return socket.emit('error', { message: '未在游戏中' });

    const result = room.game.flipPlayerHand(playerId);
    if (result.success) {
      socket.emit('hand_updated', {
        myHand: room.game.hands[playerId],
        message: result.message,
      });
      // 广播翻牌状态（让其他人看到谁确认了）
      broadcastGameState(room);
    } else {
      socket.emit('action_error', { message: result.message });
    }
  });

  // ── 确认手牌 ──────────────────────────────────────────────
  socket.on('confirm_flip', () => {
    const room = gameManager.getRoom(socket.id);
    const playerId = gameManager.getPlayerId(socket.id);
    if (!room?.game) return socket.emit('error', { message: '未在游戏中' });

    const result = room.game.confirmFlip(playerId);
    if (result.success) {
      broadcastGameState(room);
      if (room.game.state === 'playing') {
        io.to(room.code).emit('phase_changed', { phase: 'playing' });
      }
    }
  });

  // ── SHOW（出牌）──────────────────────────────────────────
  socket.on('show', ({ cardIndices }) => {
    const room = gameManager.getRoom(socket.id);
    const playerId = gameManager.getPlayerId(socket.id);
    if (!room?.game) return socket.emit('error', { message: '未在游戏中' });

    const result = room.game.show(playerId, cardIndices);
    if (result.success) {
      if (result.action === 'round_end') {
        handleRoundEnd(room, result);
      } else {
        broadcastGameState(room);
        io.to(room.code).emit('action_log', {
          type: 'show',
          playerName: room.players.find(p => p.id === playerId)?.name,
          count: cardIndices.length,
        });
      }
    } else {
      socket.emit('action_error', { message: result.message });
    }
  });

  // ── SCOUT（挖角）────────────────────────────────────────
  socket.on('scout', ({ position, insertIndex }) => {
    const room = gameManager.getRoom(socket.id);
    const playerId = gameManager.getPlayerId(socket.id);
    if (!room?.game) return socket.emit('error', { message: '未在游戏中' });

    const result = room.game.scout(playerId, position, insertIndex);
    if (result.success) {
      if (result.action === 'round_end') {
        handleRoundEnd(room, result);
      } else {
        broadcastGameState(room);
        io.to(room.code).emit('action_log', {
          type: 'scout',
          playerName: room.players.find(p => p.id === playerId)?.name,
          position,
        });
      }
    } else {
      socket.emit('action_error', { message: result.message });
    }
  });

  // ── SCOUT & SHOW ──────────────────────────────────────────
  socket.on('scout_and_show', ({ scoutPosition, insertIndex, showIndices }) => {
    const room = gameManager.getRoom(socket.id);
    const playerId = gameManager.getPlayerId(socket.id);
    if (!room?.game) return socket.emit('error', { message: '未在游戏中' });

    const result = room.game.scoutAndShow(playerId, scoutPosition, insertIndex, showIndices);
    if (result.success) {
      if (result.action === 'round_end') {
        handleRoundEnd(room, result);
      } else {
        broadcastGameState(room);
        io.to(room.code).emit('action_log', {
          type: 'scout_and_show',
          playerName: room.players.find(p => p.id === playerId)?.name,
        });
      }
    } else {
      socket.emit('action_error', { message: result.message });
    }
  });

  // ── 下一轮 ────────────────────────────────────────────────
  socket.on('next_round', () => {
    const room = gameManager.getRoom(socket.id);
    if (!room?.game) return;
    if (room.game.state === 'round_end') {
      room.game.startNewRound();
      broadcastGameState(room);
      io.to(room.code).emit('round_started', { roundNumber: room.game.roundNumber });
    }
  });

  // ── 断线处理 ──────────────────────────────────────────────
  socket.on('disconnect', () => {
    const result = gameManager.handleDisconnect(socket.id);
    if (result && !result.roomDeleted) {
      if (result.type === 'offline') {
        // 游戏中：只通知玩家离线，不踢出
        io.to(result.roomCode).emit('player_offline', { playerName: result.player.name });
      } else if (result.players) {
        // 等待室：玩家离开
        io.to(result.roomCode).emit('player_left', {
          players: result.players.map(p => ({
            id: p.id, name: p.name,
            isHost: p.id === gameManager.rooms[result.roomCode]?.hostPlayerId,
          })),
          leftPlayer: result.player?.name,
        });
      }
    }
    console.log(`[断线] ${socket.id}`);
  });
});

// 启动服务器
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🎪 Scout 游戏服务器已启动！`);
  console.log(`📡 访问地址：http://localhost:${PORT}\n`);
});
