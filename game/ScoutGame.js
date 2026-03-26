/**
 * Scout 核心游戏逻辑
 */

const { createShuffledDeck, getHandSizeForPlayers, getCardValue, flipHand } = require('./CardDeck');

class ScoutGame {
  constructor(players) {
    this.players = players; // [{ id, name }]
    this.playerCount = players.length;
    this.state = 'flip_phase'; // flip_phase | playing | round_end | game_end

    // 各玩家总分（多轮累积）
    this.totalScores = {};
    players.forEach(p => { this.totalScores[p.id] = 0; });

    this.roundNumber = 0;
    this.startPlayerIndex = 0;
    this.startNewRound();
  }

  // ─────────────────────────────────────────────────────────────
  // 回合初始化
  // ─────────────────────────────────────────────────────────────
  startNewRound() {
    this.roundNumber++;
    const deck = createShuffledDeck(this.playerCount);
    const handSize = getHandSizeForPlayers(this.playerCount);

    // 发牌
    this.hands = {};
    this.players.forEach((p, i) => {
      this.hands[p.id] = deck.slice(i * handSize, (i + 1) * handSize);
    });

    // 翻牌确认状态
    this.flipConfirmed = {};
    this.players.forEach(p => { this.flipConfirmed[p.id] = false; });

    // 舞台区（当前出的牌组）
    this.stage = [];
    this.stageOwner = null; // 谁出的当前舞台牌
    this.stageType = null;  // 'set' | 'sequence'

    // 当前回合轮次顺序
    this.currentPlayerIndex = this.startPlayerIndex;
    this.consecutiveScouts = 0; // 连续scout次数（无人能show时回合结束）
    this.roundOver = false;
    this.roundWinner = null;

    // 本轮scout补偿记录
    this.scoutTokens = {};
    this.players.forEach(p => { this.scoutTokens[p.id] = 0; });

    // 本轮是否使用过"scout & show"
    this.usedScoutAndShow = {};
    this.players.forEach(p => { this.usedScoutAndShow[p.id] = false; });

    this.state = 'flip_phase';
  }

  // ─────────────────────────────────────────────────────────────
  // 翻牌阶段：玩家可以选择翻转整手牌
  // ─────────────────────────────────────────────────────────────
  flipPlayerHand(playerId) {
    if (this.state !== 'flip_phase') return { success: false, message: '不在翻牌阶段' };
    if (this.flipConfirmed[playerId]) return { success: false, message: '你已经确认过了' };

    this.hands[playerId] = flipHand(this.hands[playerId]);
    return { success: true, message: '已翻转手牌' };
  }

  confirmFlip(playerId) {
    if (this.state !== 'flip_phase') return { success: false, message: '不在翻牌阶段' };
    this.flipConfirmed[playerId] = true;

    // 所有人确认后进入游戏阶段
    if (Object.values(this.flipConfirmed).every(v => v)) {
      this.state = 'playing';
    }
    return { success: true };
  }

  // ─────────────────────────────────────────────────────────────
  // 出牌合法性校验
  // ─────────────────────────────────────────────────────────────

  /** 从手牌中按照索引选取的牌（索引必须连续） */
  getCardsAtIndices(playerId, indices) {
    const hand = this.hands[playerId];
    if (!hand) return null;
    // 检查连续性
    const sorted = [...indices].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] !== sorted[i - 1] + 1) return null; // 非连续
    }
    return sorted.map(i => hand[i]);
  }

  /** 检查是否为合法的同值组 */
  isValidSet(cards) {
    if (cards.length < 1) return false;
    const val = getCardValue(cards[0]);
    return cards.every(c => getCardValue(c) === val);
  }

  /** 检查是否为合法的顺子 */
  isValidSequence(cards) {
    if (cards.length < 2) return false;
    const vals = cards.map(getCardValue);
    for (let i = 1; i < vals.length; i++) {
      if (vals[i] !== vals[i - 1] + 1) return false;
    }
    return true;
  }

  /** 判断一组牌的类型 */
  getPlayType(cards) {
    if (cards.length === 1) {
      return 'set'; // 单张既是set也是sequence，统一归set
    }
    if (this.isValidSet(cards)) return 'set';
    if (this.isValidSequence(cards)) return 'sequence';
    return null;
  }

  /**
   * 新出牌是否强于当前舞台牌
   * 规则：
   * - 同类型：数量更多获胜；数量相同时，数值（最大值或同值）更大获胜
   * - 跨类型：只有数量更多才能获胜
   */
  beats(newCards, newType) {
    if (this.stage.length === 0) return true; // 舞台为空，任何牌都能出

    const oldCount = this.stage.length;
    const newCount = newCards.length;

    if (newCount > oldCount) return true;
    if (newCount < oldCount) return false;

    // 数量相同，只有同类型才比较数值
    if (newType !== this.stageType) return false;

    // 比较数值（取最大值或同值）
    const newMax = Math.max(...newCards.map(getCardValue));
    const oldMax = Math.max(...this.stage.map(getCardValue));
    return newMax > oldMax;
  }

  // ─────────────────────────────────────────────────────────────
  // 行动：SHOW（出牌）
  // ─────────────────────────────────────────────────────────────
  show(playerId, cardIndices) {
    if (this.state !== 'playing') return { success: false, message: '游戏未在进行中' };
    if (this.getCurrentPlayer().id !== playerId) return { success: false, message: '还没轮到你' };

    const cards = this.getCardsAtIndices(playerId, cardIndices);
    if (!cards) return { success: false, message: '请选择手牌中连续的牌' };

    const type = this.getPlayType(cards);
    if (!type) return { success: false, message: '所选牌不构成合法出牌（同值组或连续顺子）' };

    if (!this.beats(cards, type)) {
      return { success: false, message: '出牌不够强，无法压制当前舞台' };
    }

    // 从手牌中移除
    const sorted = [...cardIndices].sort((a, b) => a - b);
    for (let i = sorted.length - 1; i >= 0; i--) {
      this.hands[playerId].splice(sorted[i], 1);
    }

    // 更新舞台
    this.stage = cards;
    this.stageOwner = playerId;
    this.stageType = type;
    this.consecutiveScouts = 0;

    // 检查是否手牌清空
    if (this.hands[playerId].length === 0) {
      return this.endRound(playerId);
    }

    this.nextPlayer();
    return { success: true, action: 'show' };
  }

  // ─────────────────────────────────────────────────────────────
  // 行动：SCOUT（挖角）
  // ─────────────────────────────────────────────────────────────
  scout(playerId, position, insertIndex) {
    // position: 'left' | 'right' - 从舞台左端或右端取牌
    // insertIndex: 插入手牌的位置（0=最左）
    if (this.state !== 'playing') return { success: false, message: '游戏未在进行中' };
    if (this.getCurrentPlayer().id !== playerId) return { success: false, message: '还没轮到你' };
    if (this.stage.length === 0) return { success: false, message: '舞台上没有牌可以scout' };

    // 取牌
    let card;
    if (position === 'left') {
      card = this.stage.shift();
    } else {
      card = this.stage.pop();
    }

    // 插入手牌
    const hand = this.hands[playerId];
    const safeIndex = Math.max(0, Math.min(insertIndex, hand.length));
    hand.splice(safeIndex, 0, card);

    // 给舞台主人scout补偿
    if (this.stageOwner && this.stageOwner !== playerId) {
      this.scoutTokens[this.stageOwner] = (this.scoutTokens[this.stageOwner] || 0) + 1;
    }

    // 舞台清空处理
    if (this.stage.length === 0) {
      this.stageOwner = null;
      this.stageType = null;
    }

    this.consecutiveScouts++;
    // 检查是否所有其他玩家都连续scout（无人能show）
    if (this.consecutiveScouts >= this.playerCount - 1 && this.stageOwner !== null) {
      return this.endRound(this.stageOwner);
    }

    this.nextPlayer();
    return { success: true, action: 'scout', card };
  }

  // ─────────────────────────────────────────────────────────────
  // 行动：SCOUT & SHOW（挖角后出牌，每玩家每局只能用一次）
  // ─────────────────────────────────────────────────────────────
  scoutAndShow(playerId, scoutPosition, insertIndex, showIndices) {
    if (this.state !== 'playing') return { success: false, message: '游戏未在进行中' };
    if (this.getCurrentPlayer().id !== playerId) return { success: false, message: '还没轮到你' };
    if (this.usedScoutAndShow[playerId]) return { success: false, message: '你已经用过 Scout & Show 了' };
    if (this.stage.length === 0) return { success: false, message: '舞台上没有牌可以scout' };

    // 先Scout
    let card;
    if (scoutPosition === 'left') {
      card = this.stage.shift();
    } else {
      card = this.stage.pop();
    }

    const hand = this.hands[playerId];
    const safeIndex = Math.max(0, Math.min(insertIndex, hand.length));
    hand.splice(safeIndex, 0, card);

    if (this.stageOwner && this.stageOwner !== playerId) {
      this.scoutTokens[this.stageOwner] = (this.scoutTokens[this.stageOwner] || 0) + 1;
    }

    if (this.stage.length === 0) {
      this.stageOwner = null;
      this.stageType = null;
    }

    // 再Show（使用更新后的手牌）
    const cards = this.getCardsAtIndices(playerId, showIndices);
    if (!cards) {
      // 回滚scout（简单处理：失败提示）
      return { success: false, message: '出牌索引不合法，请重新操作' };
    }

    const type = this.getPlayType(cards);
    if (!type) return { success: false, message: '所选牌不构成合法出牌' };
    if (!this.beats(cards, type)) return { success: false, message: '出牌不够强，无法压制当前舞台' };

    const sorted = [...showIndices].sort((a, b) => a - b);
    for (let i = sorted.length - 1; i >= 0; i--) {
      this.hands[playerId].splice(sorted[i], 1);
    }

    this.stage = cards;
    this.stageOwner = playerId;
    this.stageType = type;
    this.consecutiveScouts = 0;
    this.usedScoutAndShow[playerId] = true;

    if (this.hands[playerId].length === 0) {
      return this.endRound(playerId);
    }

    this.nextPlayer();
    return { success: true, action: 'scout_and_show' };
  }

  // ─────────────────────────────────────────────────────────────
  // 回合结束与计分
  // ─────────────────────────────────────────────────────────────
  endRound(winnerId) {
    this.roundOver = true;
    this.roundWinner = winnerId;
    this.state = 'round_end';

    const roundScores = {};
    this.players.forEach(p => { roundScores[p.id] = 0; });

    // 赢家获得其他玩家手牌总数的分数
    let othersCards = 0;
    this.players.forEach(p => {
      if (p.id !== winnerId) {
        othersCards += this.hands[p.id].length;
      }
    });
    roundScores[winnerId] += othersCards;

    // 加上scout补偿
    this.players.forEach(p => {
      roundScores[p.id] += (this.scoutTokens[p.id] || 0);
    });

    // 累积到总分
    this.players.forEach(p => {
      this.totalScores[p.id] = (this.totalScores[p.id] || 0) + roundScores[p.id];
    });

    // 判断是否游戏结束（轮数 = 玩家数）
    if (this.roundNumber >= this.playerCount) {
      this.state = 'game_end';
    } else {
      this.startPlayerIndex = (this.startPlayerIndex + 1) % this.playerCount;
    }

    return {
      success: true,
      action: 'round_end',
      roundWinner: winnerId,
      roundScores,
      totalScores: this.totalScores,
      gameOver: this.state === 'game_end',
    };
  }

  // ─────────────────────────────────────────────────────────────
  // 辅助方法
  // ─────────────────────────────────────────────────────────────
  getCurrentPlayer() {
    return this.players[this.currentPlayerIndex];
  }

  nextPlayer() {
    this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.playerCount;
    // 跳过轮到舞台主人自己（因为主人不能自己scout自己的牌）- 无需跳，自然流转即可
  }

  /** 获取供客户端渲染的游戏状态（隐藏其他玩家手牌背面） */
  getStateForPlayer(viewPlayerId) {
    const currentPlayer = this.getCurrentPlayer();
    return {
      state: this.state,
      roundNumber: this.roundNumber,
      currentPlayerId: currentPlayer ? currentPlayer.id : null,
      stage: this.stage,
      stageOwner: this.stageOwner,
      stageType: this.stageType,
      myHand: this.hands[viewPlayerId] || [],
      players: this.players.map(p => ({
        id: p.id,
        name: p.name,
        handCount: (this.hands[p.id] || []).length,
        scoutTokens: this.scoutTokens[p.id] || 0,
        totalScore: this.totalScores[p.id] || 0,
        usedScoutAndShow: this.usedScoutAndShow[p.id] || false,
        flipConfirmed: this.flipConfirmed[p.id] || false,
      })),
      usedScoutAndShow: this.usedScoutAndShow[viewPlayerId] || false,
    };
  }

  /** 获取完整游戏状态（用于调试或旁观） */
  getFullState() {
    return {
      state: this.state,
      roundNumber: this.roundNumber,
      currentPlayerId: this.getCurrentPlayer()?.id,
      stage: this.stage,
      stageOwner: this.stageOwner,
      stageType: this.stageType,
      hands: this.hands,
      totalScores: this.totalScores,
      scoutTokens: this.scoutTokens,
    };
  }
}

module.exports = ScoutGame;
