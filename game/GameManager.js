/**
 * 游戏房间管理器 v2 - 使用独立 playerId，彻底解耦身份与 socketId
 */

const ScoutGame = require('./ScoutGame');
const crypto = require('crypto');

class GameManager {
  constructor() {
    this.rooms = {};           // roomCode -> Room
    this.socketToRoom = {};    // socketId -> roomCode
    this.socketToPlayerId = {}; // socketId -> playerId (稳定的独立ID)
  }

  generateRoomCode() {
    let code;
    do {
      code = Math.random().toString(36).substring(2, 6).toUpperCase();
    } while (this.rooms[code]);
    return code;
  }

  generatePlayerId() {
    return crypto.randomBytes(8).toString('hex');
  }

  // 创建房间
  createRoom(socketId, playerName, playerAvatar = '') {
    const roomCode = this.generateRoomCode();
    const playerId = this.generatePlayerId();

    this.rooms[roomCode] = {
      code: roomCode,
      hostPlayerId: playerId,
      players: [{ id: playerId, name: playerName, avatar: playerAvatar, socketId, online: true }],
      game: null,
      status: 'waiting',
    };

    this.socketToRoom[socketId] = roomCode;
    this.socketToPlayerId[socketId] = playerId;

    return { success: true, roomCode, playerId };
  }

  // 加入房间（选座位阶段：增加了 seating_phase 事件）
  joinRoom(socketId, roomCode, playerName, playerAvatar = '') {
    const room = this.rooms[roomCode];
    if (!room) return { success: false, message: '房间不存在，请检查房间码' };
    if (room.status !== 'waiting') return { success: false, message: '游戏已经开始，无法加入' };
    if (room.players.length >= 6) return { success: false, message: '房间已满（最多6人）' };
    if (room.players.find(p => p.name === playerName)) {
      return { success: false, message: '该昵称已被使用，请换一个' };
    }

    const playerId = this.generatePlayerId();
    room.players.push({ id: playerId, name: playerName, avatar: playerAvatar, socketId, online: true });
    this.socketToRoom[socketId] = roomCode;
    this.socketToPlayerId[socketId] = playerId;

    return { success: true, roomCode, playerId };
  }

  // 房主发起选座位阶段（替换原 startGame 的直接开始逻辑）
  initSeating(socketId) {
    const roomCode = this.socketToRoom[socketId];
    const room     = this.rooms[roomCode];
    if (!room)                           return { success: false, message: '未加入房间' };
    const playerId = this.socketToPlayerId[socketId];
    if (room.hostPlayerId !== playerId)  return { success: false, message: '只有房主可以开始游戏' };
    if (room.players.length < 2)         return { success: false, message: '至少需要2名玩家' };
    if (room.status !== 'waiting')       return { success: false, message: '游戏已经开始' };

    // 进入选座位阶段，重置所有座位选择
    room.status  = 'seating';
    room.seating = {}; // playerId -> seatIndex (1~N)
    return { success: true };
  }

  // 玩家选择座位
  chooseSeat(socketId, seatIndex) {
    const roomCode = this.socketToRoom[socketId];
    const room     = this.rooms[roomCode];
    const playerId = this.socketToPlayerId[socketId];
    if (!room || room.status !== 'seating') return { success: false, message: '当前不在选座位阶段' };
    if (!playerId) return { success: false, message: '玩家不存在' };

    const n = room.players.length;
    if (seatIndex < 1 || seatIndex > n) return { success: false, message: '座位号不合法' };

    // 检查该座位是否已被他人占用
    const occupantId = Object.entries(room.seating).find(([pid, si]) => si === seatIndex)?.[0];
    if (occupantId && occupantId !== playerId) {
      return { success: false, message: '该座位已被占用' };
    }

    room.seating[playerId] = seatIndex;
    return { success: true, seating: { ...room.seating } };
  }

  // 房主确认座位，真正开始游戏
  confirmSeating(socketId) {
    const roomCode = this.socketToRoom[socketId];
    const room     = this.rooms[roomCode];
    if (!room || room.status !== 'seating') return { success: false, message: '当前不在选座位阶段' };
    const playerId = this.socketToPlayerId[socketId];
    if (room.hostPlayerId !== playerId) return { success: false, message: '只有房主可以确认开始' };

    const n          = room.players.length;
    const assignedN  = Object.keys(room.seating).length;

    // 若部分玩家未选座位，自动分配剩余空位
    const usedSeats = new Set(Object.values(room.seating));
    let nextSeat = 1;
    room.players.forEach(p => {
      if (!room.seating[p.id]) {
        while (usedSeats.has(nextSeat)) nextSeat++;
        room.seating[p.id] = nextSeat;
        usedSeats.add(nextSeat);
        nextSeat++;
      }
    });

    // 按座位号排序玩家顺序
    const orderedPlayers = [...room.players].sort(
      (a, b) => (room.seating[a.id] || 99) - (room.seating[b.id] || 99)
    );

    room.game   = new ScoutGame(orderedPlayers.map(p => ({ id: p.id, name: p.name, avatar: p.avatar || null })));
    room.status = 'playing';
    return { success: true };
  }

  // 开始游戏（兼容旧版：直接跳过选座位）
  startGame(socketId) {
    const roomCode = this.socketToRoom[socketId];
    const room = this.rooms[roomCode];
    if (!room) return { success: false, message: '未加入房间' };
    const playerId = this.socketToPlayerId[socketId];
    if (room.hostPlayerId !== playerId) return { success: false, message: '只有房主可以开始游戏' };
    if (room.players.length < 2) return { success: false, message: '至少需要2名玩家' };
    if (room.status !== 'waiting') return { success: false, message: '游戏已经开始' };

    room.game   = new ScoutGame(room.players.map(p => ({ id: p.id, name: p.name })));
    room.status = 'playing';

    return { success: true };
  }

  // 重新连接（页面刷新/跳转后）
  rejoinGame(socketId, roomCode, playerId) {
    const room = this.rooms[roomCode?.toUpperCase()];
    if (!room || !room.game) {
      return { success: false, message: '游戏不存在或尚未开始' };
    }

    const player = room.players.find(p => p.id === playerId);
    if (!player) {
      return { success: false, message: '找不到该玩家信息，请返回大厅重新加入' };
    }

    // 更新 socketId 绑定
    const oldSocketId = player.socketId;
    if (oldSocketId && oldSocketId !== socketId) {
      // 真正的重连：新 socketId 替换旧的，清理旧映射
      delete this.socketToRoom[oldSocketId];
      delete this.socketToPlayerId[oldSocketId];
    } else if (oldSocketId && oldSocketId === socketId) {
      // 同一 socketId 重复调用（客户端偶发双重 rejoin_game），无需删除映射，直接覆盖写入
      // bugfix(not-in-game): 此处防御性日志，可在线上排查竞态是否还残留
      console.warn(`[rejoinGame] 同一 socketId 重复 rejoin：${socketId} player:${playerId} room:${roomCode}`);
    }
    player.socketId = socketId;
    player.online = true;
    this.socketToRoom[socketId] = roomCode.toUpperCase();
    this.socketToPlayerId[socketId] = playerId;

    return { success: true, room, player };
  }

  // 获取玩家所在房间
  getRoom(socketId) {
    const roomCode = this.socketToRoom[socketId];
    return roomCode ? this.rooms[roomCode] : null;
  }

  // 获取房间码
  getRoomCode(socketId) {
    return this.socketToRoom[socketId];
  }

  // 获取玩家ID（稳定的）
  getPlayerId(socketId) {
    return this.socketToPlayerId[socketId];
  }

  // 房主踢出玩家（仅限等待室）
  kickPlayer(hostSocketId, targetPlayerId) {
    const roomCode = this.socketToRoom[hostSocketId];
    const room = this.rooms[roomCode];
    
    // 验证：房间存在
    if (!room) return { success: false, message: '房间不存在' };
    
    // 验证：只能在等待状态踢人
    if (room.status !== 'waiting') {
      return { success: false, message: '游戏已开始，无法踢人' };
    }
    
    // 验证：操作者是房主
    const hostPlayerId = this.socketToPlayerId[hostSocketId];
    if (room.hostPlayerId !== hostPlayerId) {
      return { success: false, message: '只有房主可以踢人' };
    }
    
    // 验证：不能踢自己
    if (targetPlayerId === hostPlayerId) {
      return { success: false, message: '无法踢出自己' };
    }
    
    // 验证：目标玩家存在
    const targetPlayer = room.players.find(p => p.id === targetPlayerId);
    if (!targetPlayer) {
      return { success: false, message: '玩家不存在' };
    }
    
    // 移除玩家
    room.players = room.players.filter(p => p.id !== targetPlayerId);
    
    // 清理映射
    if (targetPlayer.socketId) {
      delete this.socketToRoom[targetPlayer.socketId];
      delete this.socketToPlayerId[targetPlayer.socketId];
    }
    
    return { 
      success: true, 
      kickedPlayer: targetPlayer, 
      remainingPlayers: room.players 
    };
  }

  // 断线处理（游戏中不踢出玩家，只标记离线）
  handleDisconnect(socketId) {
    const roomCode = this.socketToRoom[socketId];
    const playerId = this.socketToPlayerId[socketId];
    if (!roomCode) return null;

    const room = this.rooms[roomCode];
    if (!room) return null;

    delete this.socketToRoom[socketId];
    delete this.socketToPlayerId[socketId];

    const player = room.players.find(p => p.id === playerId);
    if (player) {
      player.online = false;
      
      // 游戏中：不踢出，只标记离线，等待重连
      if (room.status === 'playing') {
        return { roomCode, type: 'offline', player, roomDeleted: false };
      }
      
      // 等待室：房主离线时保留房间5分钟
      const isHost = (room.hostPlayerId === playerId);
      if (isHost && room.status === 'waiting') {
        // 设置房间过期时间（5分钟）
        room.hostOfflineAt = Date.now();
        room.hostOfflineTimeout = setTimeout(() => {
          // 5分钟后删除房间
          if (this.rooms[roomCode]) {
            console.log(`[房间过期] ${roomCode} - 房主5分钟未返回`);
            delete this.rooms[roomCode];
          }
        }, 5 * 60 * 1000);
        
        console.log(`[房主离线] ${roomCode} - 保留房间5分钟等待返回`);
        return { roomCode, type: 'host_offline', player, roomDeleted: false, players: room.players };
      }
      
      // 非房主离线：直接移除
      room.players = room.players.filter(p => p.id !== playerId);
      if (room.players.length === 0) {
        delete this.rooms[roomCode];
        return { roomCode, type: 'removed', player, roomDeleted: true };
      }
      
      // 转移房主（如果当前房主离线了但不应该到这里）
      if (room.hostPlayerId === playerId) {
        room.hostPlayerId = room.players[0].id;
      }
      
      return { roomCode, type: 'removed', player, roomDeleted: false, players: room.players };
    }

    return null;
  }
  
  // 房主重新进入等待室
  rejoinAsHost(socketId, roomCode, playerId) {
    const room = this.rooms[roomCode];
    if (!room) {
      return { success: false, message: '房间不存在或已过期' };
    }
    
    if (room.status !== 'waiting') {
      return { success: false, message: '房间已开始游戏，请使用重连功能' };
    }
    
    if (room.hostPlayerId !== playerId) {
      return { success: false, message: '您不是该房间的房主' };
    }
    
    // 找到房主玩家并重新上线
    const player = room.players.find(p => p.id === playerId);
    if (!player) {
      return { success: false, message: '玩家信息丢失' };
    }
    
    // 清除房间过期定时器
    if (room.hostOfflineTimeout) {
      clearTimeout(room.hostOfflineTimeout);
      delete room.hostOfflineTimeout;
      delete room.hostOfflineAt;
    }
    
    // 更新socket映射
    player.socketId = socketId;
    player.online = true;
    this.socketToRoom[socketId] = roomCode;
    this.socketToPlayerId[socketId] = playerId;
    
    console.log(`[房主返回] ${roomCode} - ${player.name}`);
    return { success: true, room, player };
  }
}

module.exports = new GameManager();
