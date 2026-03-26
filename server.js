/**
 * Scout 在线多人桌游 - 服务端主程序
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
});

// 静态文件服务
app.use(express.static(path.join(__dirname, 'public')));

// ─────────────────────────────────────────────────────────────
// Socket.io 事件处理
// ─────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`[连接] ${socket.id}`);

  // ── 创建房间 ──────────────────────────────────────────────
  socket.on('create_room', ({ playerName }) => {
    if (!playerName || !playerName.trim()) {
      return socket.emit('error', { message: '请输入玩家昵称' });
    }
    const result = gameManager.createRoom(socket.id, playerName.trim());
    if (result.success) {
      socket.join(result.roomCode);
      socket.emit('room_created', {
        roomCode: result.roomCode,
        playerId: result.playerId,
        players: gameManager.rooms[result.roomCode].players.map(p => ({
          id: p.id,
          name: p.name,
          isHost: p.socketId === gameManager.rooms[result.roomCode].hostId,
        })),
      });
      console.log(`[房间创建] ${result.roomCode} by ${playerName}`);
    } else {
      socket.emit('error', { message: result.message });
    }
  });

  // ── 加入房间 ──────────────────────────────────────────────
  socket.on('join_room', ({ roomCode, playerName }) => {
    if (!playerName || !playerName.trim()) {
      return socket.emit('error', { message: '请输入玩家昵称' });
    }
    const result = gameManager.joinRoom(socket.id, roomCode.toUpperCase(), playerName.trim());
    if (result.success) {
      socket.join(result.roomCode);
      const room = gameManager.rooms[result.roomCode];
      const playersInfo = room.players.map(p => ({
        id: p.id,
        name: p.name,
        isHost: p.socketId === room.hostId,
      }));

      // 通知加入者
      socket.emit('room_joined', {
        roomCode: result.roomCode,
        playerId: result.playerId,
        players: playersInfo,
      });

      // 通知房间其他人
      socket.to(result.roomCode).emit('player_joined', {
        players: playersInfo,
        newPlayer: playerName.trim(),
      });
      console.log(`[加入房间] ${result.roomCode} by ${playerName}`);
    } else {
      socket.emit('error', { message: result.message });
    }
  });

  // ── 开始游戏 ──────────────────────────────────────────────
  socket.on('start_game', () => {
    const result = gameManager.startGame(socket.id);
    if (result.success) {
      const room = gameManager.getRoom(socket.id);
      // 给每个玩家发送各自的游戏状态（手牌私密）
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
    if (!room || !room.game) return socket.emit('error', { message: '未在游戏中' });

    const result = room.game.flipPlayerHand(playerId);
    if (result.success) {
      // 只发给自己更新后的手牌
      socket.emit('hand_updated', {
        myHand: room.game.hands[playerId],
        message: result.message,
      });
    } else {
      socket.emit('error', { message: result.message });
    }
  });

  // ── 确认手牌（不翻或已翻完毕） ────────────────────────────
  socket.on('confirm_flip', () => {
    const room = gameManager.getRoom(socket.id);
    const playerId = gameManager.getPlayerId(socket.id);
    if (!room || !room.game) return socket.emit('error', { message: '未在游戏中' });

    const result = room.game.confirmFlip(playerId);
    if (result.success) {
      broadcastGameState(room);
      // 如果进入游戏阶段
      if (room.game.state === 'playing') {
        io.to(room.code).emit('game_phase_changed', { phase: 'playing' });
      }
    }
  });

  // ── SHOW（出牌） ──────────────────────────────────────────
  socket.on('show', ({ cardIndices }) => {
    const room = gameManager.getRoom(socket.id);
    const playerId = gameManager.getPlayerId(socket.id);
    if (!room || !room.game) return socket.emit('error', { message: '未在游戏中' });

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

  // ── SCOUT（挖角） ─────────────────────────────────────────
  socket.on('scout', ({ position, insertIndex }) => {
    const room = gameManager.getRoom(socket.id);
    const playerId = gameManager.getPlayerId(socket.id);
    if (!room || !room.game) return socket.emit('error', { message: '未在游戏中' });

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
    if (!room || !room.game) return socket.emit('error', { message: '未在游戏中' });

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
    if (!room || !room.game) return;
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
      io.to(result.roomCode).emit('player_left', {
        players: result.players.map(p => ({
          id: p.id,
          name: p.name,
          isHost: p.socketId === gameManager.rooms[result.roomCode]?.hostId,
        })),
        leftPlayer: result.disconnectedPlayer?.name,
      });
    }
    console.log(`[断线] ${socket.id}`);
  });

  // ─────────────────────────────────────────────────────────
  // 辅助函数
  // ─────────────────────────────────────────────────────────

  function broadcastGameState(room) {
    room.players.forEach(p => {
      const state = room.game.getStateForPlayer(p.id);
      io.to(p.socketId).emit('game_state', state);
    });
  }

  function handleRoundEnd(room, result) {
    // 先广播游戏状态
    broadcastGameState(room);

    // 发送回合结束信息（所有人同样的内容）
    const roundEndData = {
      roundWinnerId: result.roundWinner,
      roundWinnerName: room.players.find(p => p.id === result.roundWinner)?.name,
      roundScores: result.roundScores,
      totalScores: result.totalScores,
      gameOver: result.gameOver,
    };

    // 加上玩家名字映射
    roundEndData.playerNames = {};
    room.players.forEach(p => { roundEndData.playerNames[p.id] = p.name; });

    if (result.gameOver) {
      // 找最终赢家
      let maxScore = -Infinity;
      let gameWinnerId = null;
      Object.entries(result.totalScores).forEach(([id, score]) => {
        if (score > maxScore) {
          maxScore = score;
          gameWinnerId = id;
        }
      });
      roundEndData.gameWinnerId = gameWinnerId;
      roundEndData.gameWinnerName = room.players.find(p => p.id === gameWinnerId)?.name;
      io.to(room.code).emit('game_over', roundEndData);
      room.status = 'finished';
    } else {
      io.to(room.code).emit('round_end', roundEndData);
    }
  }
});

// 启动服务器
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🎪 Scout 游戏服务器已启动！`);
  console.log(`📡 访问地址：http://localhost:${PORT}`);
  console.log(`🎮 邀请朋友：将链接分享给同一网络下的朋友即可多人游玩\n`);
});
