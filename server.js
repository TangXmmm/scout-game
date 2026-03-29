/**
 * Scout 在线多人桌游 - 服务端主程序 v3
 * 新增：高光事件计算、超时托管逻辑
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
  transports: ['websocket', 'polling'],
});

app.use(express.static(path.join(__dirname, 'public')));

// ─────────────────────────────────────────────────────────────
// 超时配置
// ─────────────────────────────────────────────────────────────
const TURN_TIMEOUT_MS = 30000;   // 30秒超时
const WARN_AT_MS      = 20000;   // 20秒发出预警

// 每房间的超时定时器
const roomTimers = {}; // roomCode -> { timer, warnTimer, startedAt }

function clearRoomTimer(roomCode) {
  const t = roomTimers[roomCode];
  if (t) {
    clearTimeout(t.timer);
    clearTimeout(t.warnTimer);
    delete roomTimers[roomCode];
  }
}

function startTurnTimer(room) {
  const roomCode = room.code;
  clearRoomTimer(roomCode);

  const currentPlayer = room.game.getCurrentPlayer();
  if (!currentPlayer) return;

  // 20s 预警（仅通知当前玩家）
  const warnTimer = setTimeout(() => {
    const p = room.players.find(p => p.id === currentPlayer.id);
    if (p?.socketId) {
      io.to(p.socketId).emit('turn_warning', {
        message: '即将自动处理本回合',
        secondsLeft: (TURN_TIMEOUT_MS - WARN_AT_MS) / 1000,
      });
    }
    // 广播超时预警状态给其他人（颜色提示，不强提示音）
    io.to(roomCode).emit('player_timeout_warning', { playerId: currentPlayer.id });
  }, WARN_AT_MS);

  // 30s 超时自动托管
  const timer = setTimeout(() => {
    if (!room.game || room.game.state !== 'playing') return;
    const cp = room.game.getCurrentPlayer();
    if (!cp || cp.id !== currentPlayer.id) return;

    console.log(`[超时托管] ${roomCode} - ${cp.id}`);
    executeManagedAction(room, cp.id);
  }, TURN_TIMEOUT_MS);

  roomTimers[roomCode] = { timer, warnTimer, startedAt: Date.now() };
}

/**
 * 托管策略（PRD 6.5.3）：
 * 1. 若可直接合法 SHOW，则优先最小可行 SHOW（张数最少、最弱的合法组）
 * 2. 若不可 SHOW，则执行 SCOUT（优先取右侧，插入最右）
 * 3. 若 SCOUT 后可最小可行 SHOW 且 scoutAndShow 未用，则执行
 * 4. 否则仅 SCOUT 结束回合
 */
function executeManagedAction(room, playerId) {
  const game = room.game;
  if (!game || game.state !== 'playing') return;

  // 尝试找最小可行 SHOW
  const minShow = findMinimalShow(game, playerId);
  if (minShow) {
    const result = game.show(playerId, minShow);
    if (result.success) {
      broadcastAfterAction(room, result, playerId, 'show_managed');
      return;
    }
  }

  // 没有可行 SHOW，执行 SCOUT（取右侧，插入最右）
  if (game.stage.length > 0) {
    const hand = game.hands[playerId];
    const insertIdx = hand.length; // 插在最右
    const result = game.scout(playerId, 'right', insertIdx, false);
    if (result.success) {
      broadcastAfterAction(room, result, playerId, 'scout_managed');
    }
  } else {
    // ── Bug 修复：在场组已被前面的玩家挖空，本托管玩家无牌可挖
    // 等价于"放弃演出/挖角"，需要递增 consecutiveScouts 并检查 all_scout 结束条件
    // 此时 stageOwner 已被清空，使用 lastStageOwner 找到最后一位演出者作为赢家
    game.consecutiveScouts++;
    const lastOwner = game.lastStageOwner;
    if (game.consecutiveScouts >= game.playerCount - 1 && lastOwner) {
      const result = game.endRound(lastOwner, 'all_scout');
      broadcastAfterAction(room, result, playerId, 'scout_managed');
    } else {
      game.nextPlayer();
      broadcastGameState(room);
      startTurnTimer(room);
    }
  }
}

/**
 * 找最小可行 SHOW 的索引组合（张数最少、最弱）
 * 返回 indices 数组，找不到返回 null
 */
function findMinimalShow(game, playerId) {
  const hand = game.hands[playerId];
  if (!hand || hand.length === 0) return null;

  // 枚举所有连续子段（张数从小到大）
  for (let len = 1; len <= hand.length; len++) {
    for (let start = 0; start <= hand.length - len; start++) {
      const indices = Array.from({ length: len }, (_, i) => start + i);
      const cards = indices.map(i => hand[i]);
      const type = game.getPlayType(cards);
      if (type && game.beats(cards, type)) {
        return indices;
      }
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// 高光事件计算（PRD Page 07）
// ─────────────────────────────────────────────────────────────

/**
 * 每个房间维护本轮高光事件列表
 * highlightLogs[roomCode] = [ { type, playerId, meta } ]
 */
const highlightLogs = {}; // roomCode -> []

function initHighlightLog(roomCode) {
  highlightLogs[roomCode] = [];
}

function addHighlight(roomCode, type, playerId, meta = {}) {
  if (!highlightLogs[roomCode]) highlightLogs[roomCode] = [];
  highlightLogs[roomCode].push({ type, playerId, meta, ts: Date.now() });
}

/**
 * 高光类型池（对应 PRD 7.4.3）：
 * - empty_hand_win   : 率先清手
 * - all_scout_win    : 反压逃脱（其他人都挖角）
 * - counter_show     : 挖角后直接反压（scout & show）
 * - consecutive_scout: 连续挖角 ≥3 次
 * - low_hand_warning : 手牌仅剩 1-2 张（清手预警）
 */

/**
 * 根据本轮高光日志生成供前端展示的高光卡片（优先级排序，最多3条）
 */
function buildHighlightCards(roomCode, playerNames) {
  const logs = highlightLogs[roomCode] || [];
  const cards = [];

  // 优先级1：清手相关
  const win = logs.find(l => l.type === 'empty_hand_win');
  if (win) {
    cards.push({
      icon: '🏆',
      title: '率先清手',
      desc: `${playerNames[win.playerId]} 率先出完手牌，抢下舞台`,
      playerId: win.playerId,
    });
  }

  // 优先级2：反压相关
  const counterShow = logs.filter(l => l.type === 'counter_show');
  if (counterShow.length) {
    const last = counterShow[counterShow.length - 1];
    cards.push({
      icon: '⚡',
      title: '挖角后直接反压',
      desc: `${playerNames[last.playerId]} 挖角后立即打出，完美连招`,
      playerId: last.playerId,
    });
  }

  // 优先级3：all_scout 赢
  const allScoutWin = logs.find(l => l.type === 'all_scout_win');
  if (allScoutWin) {
    cards.push({
      icon: '🛡️',
      title: '以逸待劳',
      desc: `${playerNames[allScoutWin.playerId]} 的在场组无人敢压，赢得本轮`,
      playerId: allScoutWin.playerId,
    });
  }

  // 优先级4：连续挖角
  const consScout = logs.find(l => l.type === 'consecutive_scout');
  if (consScout) {
    cards.push({
      icon: '🎯',
      title: `连续挖角 ${consScout.meta.count} 次`,
      desc: `${playerNames[consScout.playerId]} 接连挖角，手牌积累中`,
      playerId: consScout.playerId,
    });
  }

  return cards.slice(0, 3);
}

// ─────────────────────────────────────────────────────────────
// 辅助函数
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
    avatar: p.avatar || '',
    isHost: p.id === room.hostPlayerId,
    online: p.online !== false,
  }));
}

function broadcastAfterAction(room, result, playerId, actionType) {
  if (result.action === 'round_end') {
    handleRoundEnd(room, result);
  } else {
    broadcastGameState(room);
    const playerName = room.players.find(p => p.id === playerId)?.name;
    io.to(room.code).emit('action_log', {
      type: actionType || result.action || 'unknown',
      playerName,
    });
    // 启动下一个玩家的倒计时
    startTurnTimer(room);
  }
}

function handleRoundEnd(room, result) {
  clearRoomTimer(room.code);
  broadcastGameState(room);

  const playerNames = {};
  room.players.forEach(p => { playerNames[p.id] = p.name; });

  // 记录清手高光
  if (result.winnerType === 'empty_hand') {
    addHighlight(room.code, 'empty_hand_win', result.roundWinner);
  } else if (result.winnerType === 'all_scout') {
    addHighlight(room.code, 'all_scout_win', result.roundWinner);
  }

  const highlightCards = buildHighlightCards(room.code, playerNames);

  const roundEndData = {
    roundNumber: room.game.roundNumber,   // ★ 补上缺失的本轮编号
    roundWinnerId: result.roundWinner,
    roundWinnerName: room.players.find(p => p.id === result.roundWinner)?.name,
    winnerType: result.winnerType,
    roundScores: result.roundScores,
    totalScores: result.totalScores,
    playerNames,
    gameOver: result.gameOver,
    scoreCards: result.scoreCards || {},
    scoutTokens: result.scoutTokens || {},
    handCounts: result.handCounts || {},
    highlightCards,
  };

  // 下一轮先手信息
  if (!result.gameOver) {
    const nextStartIdx = (room.game.startPlayerIndex) % room.game.playerCount;
    roundEndData.nextFirstPlayerId = room.game.players[nextStartIdx]?.id;
    roundEndData.nextFirstPlayerName = room.game.players[nextStartIdx]?.name;
    roundEndData.nextRoundNumber = room.game.roundNumber + 1;
    roundEndData.totalRounds = room.game.playerCount;
  }

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
    // 清空高光日志，为下一轮准备
    initHighlightLog(room.code);
  }
}

// ─────────────────────────────────────────────────────────────
// Socket.io 事件处理
// ─────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`[连接] ${socket.id}`);

  // ── 创建房间 ──────────────────────────────────────────────
  socket.on('create_room', ({ playerName, playerAvatar }) => {
    if (!playerName?.trim()) return socket.emit('error', { message: '请输入玩家昵称' });

    const result = gameManager.createRoom(socket.id, playerName.trim(), playerAvatar || '');
    if (result.success) {
      socket.join(result.roomCode);
      const room = gameManager.rooms[result.roomCode];
      socket.emit('room_created', {
        roomCode: result.roomCode,
        playerId: result.playerId,
        players: getPlayersInfo(room),
      });
      console.log(`[创建房间] ${result.roomCode} by ${playerName} (pid:${result.playerId})`);
    } else {
      socket.emit('error', { message: result.message });
    }
  });

  // ── 加入房间 ──────────────────────────────────────────────
  socket.on('join_room', ({ roomCode, playerName, playerAvatar }) => {
    if (!playerName?.trim()) return socket.emit('error', { message: '请输入玩家昵称' });

    const result = gameManager.joinRoom(socket.id, roomCode?.toUpperCase(), playerName.trim(), playerAvatar || '');
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

  // ── 房主返回等待室 ──────────────────────────────────────────
  socket.on('rejoin_as_host', ({ roomCode, playerId }) => {
    const result = gameManager.rejoinAsHost(socket.id, roomCode?.toUpperCase(), playerId);
    if (result.success) {
      socket.join(result.room.code);
      socket.emit('host_rejoined', {
        roomCode: result.room.code,
        playerId: result.player.id,
        players: getPlayersInfo(result.room),
      });
      socket.to(result.room.code).emit('player_joined', {
        players: getPlayersInfo(result.room),
        newPlayer: result.player.name,
      });
      console.log(`[房主返回] ${result.room.code} by ${result.player.name}`);
    } else {
      socket.emit('lobby_error', { message: result.message });
    }
  });

  // ── 开始游戏（触发选座位阶段）──────────────────────────────
  socket.on('start_game', () => {
    // 先尝试进入选座位阶段
    const result = gameManager.initSeating(socket.id);
    if (result.success) {
      const room = gameManager.getRoom(socket.id);
      const n = room.players.length;
      // 广播选座位阶段开始
      io.to(room.code).emit('seating_phase', {
        players: room.players.map(p => ({ id: p.id, name: p.name, isHost: p.id === room.hostPlayerId })),
        totalSeats: n,
        seating: {},
        hostPlayerId: room.hostPlayerId,
      });
      console.log(`[选座位阶段] ${room.code}`);
    } else {
      socket.emit('error', { message: result.message });
    }
  });

  // ── 选座位 ────────────────────────────────────────────────
  socket.on('choose_seat', ({ seatIndex }) => {
    const room     = gameManager.getRoom(socket.id);
    const playerId = gameManager.getPlayerId(socket.id);
    if (!room) return socket.emit('error', { message: '房间不存在' });

    const result = gameManager.chooseSeat(socket.id, seatIndex);
    if (result.success) {
      // 广播最新座位状态
      io.to(room.code).emit('seat_updated', {
        seating: result.seating,
        players: room.players.map(p => ({ id: p.id, name: p.name })),
      });
      console.log(`[选座位] ${room.code} - ${playerId} -> 座位${seatIndex}`);
    } else {
      socket.emit('error', { message: result.message });
    }
  });

  // ── 确认座位，正式开始游戏 ─────────────────────────────────
  socket.on('confirm_seating', () => {
    const result = gameManager.confirmSeating(socket.id);
    if (result.success) {
      const room = gameManager.getRoom(socket.id);
      initHighlightLog(room.code);
      room.players.forEach(p => {
        const state = room.game.getStateForPlayer(p.id);
        io.to(p.socketId).emit('game_started', state);
      });
      console.log(`[游戏开始] ${room.code}（含选座位）`);
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
        // 进入游戏阶段后启动第一个玩家的倒计时
        startTurnTimer(room);
      }
    }
  });

  // ── SHOW（出牌）──────────────────────────────────────────
  socket.on('show', ({ cardIndices }) => {
    const room = gameManager.getRoom(socket.id);
    const playerId = gameManager.getPlayerId(socket.id);
    if (!room?.game) return socket.emit('error', { message: '未在游戏中' });

    clearRoomTimer(room.code); // 停止当前倒计时
    const result = room.game.show(playerId, cardIndices);
    if (result.success) {
      broadcastAfterAction(room, result, playerId, 'show');
    } else {
      startTurnTimer(room); // 出牌失败，重新计时
      socket.emit('action_error', { message: result.message });
    }
  });

  // ── SCOUT（挖角）────────────────────────────────────────
  socket.on('scout', ({ position, insertIndex, flipCard }) => {
    const room = gameManager.getRoom(socket.id);
    const playerId = gameManager.getPlayerId(socket.id);
    if (!room?.game) return socket.emit('error', { message: '未在游戏中' });

    clearRoomTimer(room.code);
    const result = room.game.scout(playerId, position, insertIndex, !!flipCard);
    if (result.success) {
      // 高光：连续挖角 >=3
      const consCount = room.game.consecutiveScouts;
      if (consCount >= 3) {
        addHighlight(room.code, 'consecutive_scout', playerId, { count: consCount });
      }
      broadcastAfterAction(room, result, playerId, 'scout');
    } else {
      startTurnTimer(room);
      socket.emit('action_error', { message: result.message });
    }
  });

  // ── PREPARE SCOUT & SHOW（第一步）──────────────────────
  socket.on('prepare_scout_and_show', ({ scoutPosition, insertIndex, flipCard }) => {
    const room = gameManager.getRoom(socket.id);
    const playerId = gameManager.getPlayerId(socket.id);
    if (!room?.game) return socket.emit('error', { message: '未在游戏中' });

    // 注意：prepare 阶段不停止计时，仍在同一回合
    const result = room.game.prepareScoutAndShow(playerId, scoutPosition, insertIndex, !!flipCard);
    if (result.success) {
      broadcastGameState(room);
      io.to(room.code).emit('action_log', {
        type: 'scout',
        playerName: room.players.find(p => p.id === playerId)?.name,
        position: scoutPosition,
      });
      socket.emit('scout_prepared', { message: result.message });
    } else {
      socket.emit('action_error', { message: result.message });
    }
  });

  // ── FINISH SCOUT & SHOW（第二步）────────────────────────
  socket.on('finish_scout_and_show', ({ showIndices }) => {
    const room = gameManager.getRoom(socket.id);
    const playerId = gameManager.getPlayerId(socket.id);
    if (!room?.game) return socket.emit('error', { message: '未在游戏中' });

    clearRoomTimer(room.code);
    const result = room.game.finishScoutAndShow(playerId, showIndices);
    if (result.success) {
      // 高光：挖角后直接演出
      addHighlight(room.code, 'counter_show', playerId);
      broadcastAfterAction(room, result, playerId, 'scout_and_show');
    } else {
      startTurnTimer(room);
      socket.emit('finish_scout_error', { message: result.message });
    }
  });

  // ── 下一轮 ────────────────────────────────────────────────
  socket.on('next_round', () => {
    const room = gameManager.getRoom(socket.id);
    if (!room?.game) return;
    if (room.game.state === 'round_end') {
      room.game.startNewRound();
      initHighlightLog(room.code);
      broadcastGameState(room);
      io.to(room.code).emit('round_started', { roundNumber: room.game.roundNumber });
      startTurnTimer(room);
    }
  });

  // ── 房主踢人 ──────────────────────────────────────────────
  socket.on('kick_player', ({ targetPlayerId }) => {
    const result = gameManager.kickPlayer(socket.id, targetPlayerId);

    if (!result.success) {
      socket.emit('lobby_error', { message: result.message });
      return;
    }

    const roomCode = gameManager.getRoomCode(socket.id);
    const room = gameManager.getRoom(socket.id);

    if (result.kickedPlayer.socketId) {
      io.to(result.kickedPlayer.socketId).emit('kicked_out', {
        message: '你已被房主移出房间'
      });
    }

    io.to(roomCode).emit('players_updated', {
      players: room.players.map(p => ({
        id: p.id,
        name: p.name,
        isHost: p.id === room.hostPlayerId
      }))
    });

    socket.emit('kick_success', {
      message: `已踢出 ${result.kickedPlayer.name}`
    });
  });

  // ── 主动托管 ──────────────────────────────────────────────
  socket.on('request_managed', () => {
    const room = gameManager.getRoom(socket.id);
    const playerId = gameManager.getPlayerId(socket.id);
    if (!room?.game || room.game.state !== 'playing') return;

    // 通知全房间该玩家进入托管
    io.to(room.code).emit('player_managed', { playerId, playerName: room.players.find(p => p.id === playerId)?.name });
  });

  // ── 接管（退出托管）────────────────────────────────────────
  socket.on('take_over', () => {
    const room = gameManager.getRoom(socket.id);
    const playerId = gameManager.getPlayerId(socket.id);
    if (!room?.game) return;

    socket.emit('take_over_result', { success: true, message: '已恢复手动操作' });
    io.to(room.code).emit('player_took_over', { playerId });
  });

  // ── 聊天消息 ──────────────────────────────────────────────
  socket.on('send_chat', ({ type, content }) => {
    const room = gameManager.getRoom(socket.id);
    if (!room) {
      socket.emit('lobby_error', { message: '未找到房间' });
      return;
    }

    const playerId = gameManager.getPlayerId(socket.id);
    const player = room.players.find(p => p.id === playerId);
    if (!player) {
      socket.emit('lobby_error', { message: '玩家不存在' });
      return;
    }

    // 内容长度限制
    if (typeof content === 'string' && content.length > 20) {
      socket.emit('action_error', { message: '消息不超过20字' });
      return;
    }

    const message = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      roomCode: room.code,
      playerId: player.id,
      playerName: player.name,
      type,
      content,
      timestamp: Date.now()
    };

    io.to(room.code).emit('chat_message', message);
  });

  // ── 断线处理 ──────────────────────────────────────────────
  socket.on('disconnect', () => {
    const result = gameManager.handleDisconnect(socket.id);
    if (result && !result.roomDeleted) {
      if (result.type === 'offline') {
        io.to(result.roomCode).emit('player_offline', { playerName: result.player.name });
      } else if (result.players) {
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
