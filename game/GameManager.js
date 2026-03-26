/**
 * 游戏房间管理器
 * 管理所有房间的创建、加入、游戏状态
 */

const ScoutGame = require('./ScoutGame');

class GameManager {
  constructor() {
    this.rooms = {}; // roomCode -> Room
    this.socketToRoom = {}; // socketId -> roomCode
    this.socketToPlayer = {}; // socketId -> playerId
  }

  // 生成4位随机房间码
  generateRoomCode() {
    let code;
    do {
      code = Math.random().toString(36).substring(2, 6).toUpperCase();
    } while (this.rooms[code]);
    return code;
  }

  // 创建房间
  createRoom(socketId, playerName) {
    const roomCode = this.generateRoomCode();
    const playerId = socketId;

    this.rooms[roomCode] = {
      code: roomCode,
      hostId: playerId,
      players: [{ id: playerId, name: playerName, socketId }],
      game: null,
      status: 'waiting', // waiting | playing | finished
    };

    this.socketToRoom[socketId] = roomCode;
    this.socketToPlayer[socketId] = playerId;

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

    const playerId = socketId;
    room.players.push({ id: playerId, name: playerName, socketId });
    this.socketToRoom[socketId] = roomCode;
    this.socketToPlayer[socketId] = playerId;

    return { success: true, roomCode, playerId };
  }

  // 开始游戏
  startGame(socketId) {
    const roomCode = this.socketToRoom[socketId];
    const room = this.rooms[roomCode];
    if (!room) return { success: false, message: '未加入房间' };
    if (room.hostId !== socketId) return { success: false, message: '只有房主可以开始游戏' };
    if (room.players.length < 2) return { success: false, message: '至少需要2名玩家' };
    if (room.status !== 'waiting') return { success: false, message: '游戏已经开始' };

    room.game = new ScoutGame(room.players.map(p => ({ id: p.id, name: p.name })));
    room.status = 'playing';

    return { success: true };
  }

  // 获取玩家所在房间
  getRoom(socketId) {
    const roomCode = this.socketToRoom[socketId];
    return roomCode ? this.rooms[roomCode] : null;
  }

  // 获取玩家ID
  getPlayerId(socketId) {
    return this.socketToPlayer[socketId];
  }

  // 玩家断线处理
  handleDisconnect(socketId) {
    const roomCode = this.socketToRoom[socketId];
    if (!roomCode) return null;

    const room = this.rooms[roomCode];
    if (!room) return null;

    delete this.socketToRoom[socketId];
    delete this.socketToPlayer[socketId];

    // 从玩家列表移除
    const playerIndex = room.players.findIndex(p => p.socketId === socketId);
    if (playerIndex !== -1) {
      const [disconnectedPlayer] = room.players.splice(playerIndex, 1);

      // 如果房间没人了，删除房间
      if (room.players.length === 0) {
        delete this.rooms[roomCode];
        return { roomCode, players: [], disconnectedPlayer, roomDeleted: true };
      }

      // 如果断线的是房主，转移房主权
      if (room.hostId === socketId) {
        room.hostId = room.players[0].socketId;
      }

      return { roomCode, players: room.players, disconnectedPlayer, roomDeleted: false };
    }

    return null;
  }

  // 获取房间内所有玩家的socketId列表
  getRoomSocketIds(roomCode) {
    const room = this.rooms[roomCode];
    if (!room) return [];
    return room.players.map(p => p.socketId);
  }
}

module.exports = new GameManager(); // 单例模式
