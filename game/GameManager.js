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
  createRoom(socketId, playerName) {
    const roomCode = this.generateRoomCode();
    const playerId = this.generatePlayerId(); // 独立稳定ID

    this.rooms[roomCode] = {
      code: roomCode,
      hostPlayerId: playerId,
      players: [{ id: playerId, name: playerName, socketId, online: true }],
      game: null,
      status: 'waiting',
    };

    this.socketToRoom[socketId] = roomCode;
    this.socketToPlayerId[socketId] = playerId;

    return { success: true, roomCode, playerId };
  }

  // 加入房间
  joinRoom(socketId, roomCode, playerName) {
    const room = this.rooms[roomCode];
    if (!room) return { success: false, message: '房间不存在，请检查房间码' };
    if (room.status !== 'waiting') return { success: false, message: '游戏已经开始，无法加入' };
    if (room.players.length >= 6) return { success: false, message: '房间已满（最多6人）' };
    if (room.players.find(p => p.name === playerName)) {
      return { success: false, message: '该昵称已被使用，请换一个' };
    }

    const playerId = this.generatePlayerId();
    room.players.push({ id: playerId, name: playerName, socketId, online: true });
    this.socketToRoom[socketId] = roomCode;
    this.socketToPlayerId[socketId] = playerId;

    return { success: true, roomCode, playerId };
  }

  // 开始游戏
  startGame(socketId) {
    const roomCode = this.socketToRoom[socketId];
    const room = this.rooms[roomCode];
    if (!room) return { success: false, message: '未加入房间' };
    const playerId = this.socketToPlayerId[socketId];
    if (room.hostPlayerId !== playerId) return { success: false, message: '只有房主可以开始游戏' };
    if (room.players.length < 2) return { success: false, message: '至少需要2名玩家' };
    if (room.status !== 'waiting') return { success: false, message: '游戏已经开始' };

    room.game = new ScoutGame(room.players.map(p => ({ id: p.id, name: p.name })));
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
      delete this.socketToRoom[oldSocketId];
      delete this.socketToPlayerId[oldSocketId];
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

  // 获取玩家ID（稳定的）
  getPlayerId(socketId) {
    return this.socketToPlayerId[socketId];
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
      // 等待室：直接移除
      room.players = room.players.filter(p => p.id !== playerId);
      if (room.players.length === 0) {
        delete this.rooms[roomCode];
        return { roomCode, type: 'removed', player, roomDeleted: true };
      }
      // 转移房主
      if (room.hostPlayerId === playerId) {
        room.hostPlayerId = room.players[0].id;
      }
      return { roomCode, type: 'removed', player, roomDeleted: false, players: room.players };
    }

    return null;
  }
}

module.exports = new GameManager();
