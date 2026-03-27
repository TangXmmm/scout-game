/**
 * Scout 核心游戏逻辑 v3
 *
 * 对照官方规则书修复：
 * 1. 发牌数量：3人=12张，4人=11张，5人=9张
 * 2. 顺子可以升序或降序（手牌中的连续性按牌值判断）
 * 3. Scout 挖到的牌可以改变上下方向（翻转）
 * 4. 顺子强弱比较用最小值（规则书图例：56 OK vs 45，最小值5>4）
 * 5. 计分规则（官方）：每张剩余手牌 -1分，每个scoutToken +1分，赢家（条件i）手牌0扣
 * 6. 回合结束条件：i.演出后手牌耗尽 ii.演出后其他所有人都无法/不能演出（只能挖角）
 */

const { createShuffledDeck, getHandSizeForPlayers, getCardValue, flipCard, flipHand } = require('./CardDeck');

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

    // 舞台区（当前在场组）
    this.stage = [];
    this.stageOwner = null;
    this.stageType = null;

    // 行动轮次
    this.currentPlayerIndex = this.startPlayerIndex;
    // consecutiveScouts：从上次 show 后连续 scout 的次数
    // 当 consecutiveScouts >= playerCount - 1 且 stageOwner !== null，回合结束（条件ii）
    this.consecutiveScouts = 0;
    this.roundOver = false;
    this.roundWinner = null;

    // 本轮挖角标记（补偿token）- 每个玩家被挖角获得的补偿分
    this.scoutTokens = {};
    this.players.forEach(p => { this.scoutTokens[p.id] = 0; });

    // 本轮演出获得的分数卡（演出时收集被压制的牌）
    this.scoreCards = {};
    this.players.forEach(p => { this.scoreCards[p.id] = 0; });

    // 本轮是否使用过"挖角并演出"标记
    this.usedScoutAndShow = {};
    this.players.forEach(p => { this.usedScoutAndShow[p.id] = false; });

    // 挖角并演出等待状态
    this.pendingScoutAndShow = null;

    this.state = 'flip_phase';
  }

  // ─────────────────────────────────────────────────────────────
  // 翻牌阶段（每轮开始时，可选择翻转整手牌）
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

  /**
   * 从手牌中按照索引选取的牌（索引必须在手牌中连续）
   * 规则书：必须是手牌中"一组"连续的牌
   */
  getCardsAtIndices(playerId, indices) {
    const hand = this.hands[playerId];
    if (!hand) return null;
    if (indices.length === 0) return null;

    // 检查索引连续性（手牌位置连续）
    const sorted = [...indices].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] !== sorted[i - 1] + 1) return null; // 手牌位置不连续
    }
    // 检查索引范围
    if (sorted[0] < 0 || sorted[sorted.length - 1] >= hand.length) return null;

    return sorted.map(i => hand[i]);
  }

  /** 检查是否为合法的同值组（所有牌数值相同） */
  isValidSet(cards) {
    if (cards.length < 1) return false;
    const val = getCardValue(cards[0]);
    return cards.every(c => getCardValue(c) === val);
  }

  /**
   * 检查是否为合法的顺子（连续数字，升序或降序均可）
   * 规则书明确：数字可以是升序也可以是降序
   */
  isValidSequence(cards) {
    if (cards.length < 2) return false;
    const vals = cards.map(getCardValue);

    // 检查升序（递增）
    let ascending = true;
    for (let i = 1; i < vals.length; i++) {
      if (vals[i] !== vals[i - 1] + 1) { ascending = false; break; }
    }
    if (ascending) return true;

    // 检查降序（递减）
    let descending = true;
    for (let i = 1; i < vals.length; i++) {
      if (vals[i] !== vals[i - 1] - 1) { descending = false; break; }
    }
    return descending;
  }

  /** 判断一组牌的类型 */
  getPlayType(cards) {
    if (cards.length === 1) {
      return 'set'; // 单张统一归set，便于比较（单张能被任何同张数或更多张压）
    }
    if (this.isValidSet(cards)) return 'set';
    if (this.isValidSequence(cards)) return 'sequence';
    return null;
  }

  /**
   * 获取一组牌的"比较数值"
   * 规则书：比较每组中数字最小的卡牌（最小值更大则更强）
   */
  getCompareValue(cards) {
    return Math.min(...cards.map(getCardValue));
  }

  /**
   * 新出牌是否强于当前在场组
   *
   * 官方规则（规则书）：
   * 1. 首先比张数：更多张直接赢；更少张直接输
   * 2. 张数相同比类型：同号组（set）强于连号组（sequence）
   * 3. 张数和类型都相同：比每组中最小的数字，更大则更强；相等则不能出
   */
  beats(newCards, newType) {
    if (this.stage.length === 0) return true; // 无在场组，任何牌都能出

    const oldCount = this.stage.length;
    const newCount = newCards.length;

    // 规则1：张数
    if (newCount > oldCount) return true;
    if (newCount < oldCount) return false;

    // 规则2：类型（set > sequence）
    if (newType === 'set' && this.stageType === 'sequence') return true;
    if (newType === 'sequence' && this.stageType === 'set') return false;

    // 规则3：比最小值（规则书图例确认用最小值比较）
    const newMin = this.getCompareValue(newCards);
    const oldMin = this.getCompareValue(this.stage);
    return newMin > oldMin; // 严格大于，相等不能出
  }

  /**
   * 挖角并演出时，使用挖角前保存的原始在场组进行比较
   * 这样确保挖角后的演出仍然受到正确的大小限制
   */
  beatsOriginalStage(newCards, newType) {
    if (!this.savedStageBeforeScout) {
      // 如果没有保存的原始在场组，回退到普通比较
      return this.beats(newCards, newType);
    }

    const { stage: originalStage, stageType: originalStageType } = this.savedStageBeforeScout;
    
    if (originalStage.length === 0) return true; // 无在场组，任何牌都能出

    const oldCount = originalStage.length;
    const newCount = newCards.length;

    // 规则1：张数
    if (newCount > oldCount) return true;
    if (newCount < oldCount) return false;

    // 规则2：类型（set > sequence）
    if (newType === 'set' && originalStageType === 'sequence') return true;
    if (newType === 'sequence' && originalStageType === 'set') return false;

    // 规则3：比最小值（规则书图例确认用最小值比较）
    const newMin = this.getCompareValue(newCards);
    const oldMin = this.getCompareValue(originalStage);
    return newMin > oldMin; // 严格大于，相等不能出
  }

  // ─────────────────────────────────────────────────────────────
  // 行动 A：演出（SHOW）
  // ─────────────────────────────────────────────────────────────
  show(playerId, cardIndices) {
    if (this.state !== 'playing') return { success: false, message: '游戏未在进行中' };
    if (this.getCurrentPlayer().id !== playerId) return { success: false, message: '还没轮到你' };

    const cards = this.getCardsAtIndices(playerId, cardIndices);
    if (!cards) return { success: false, message: '请选择手牌中位置连续的牌' };

    const type = this.getPlayType(cards);
    if (!type) return { success: false, message: '所选牌不构成合法出牌（同号组或连号顺子）' };

    if (!this.beats(cards, type)) {
      return { success: false, message: '出牌不够强，无法压制当前在场组' };
    }

    // 演出成功：收集被压制的在场组（作为分数卡）
    if (this.stage.length > 0) {
      this.scoreCards[playerId] = (this.scoreCards[playerId] || 0) + this.stage.length;
    }

    // 从手牌移除（从后往前删避免索引偏移）
    const sorted = [...cardIndices].sort((a, b) => a - b);
    for (let i = sorted.length - 1; i >= 0; i--) {
      this.hands[playerId].splice(sorted[i], 1);
    }

    // 更新在场组
    this.stage = cards;
    this.stageOwner = playerId;
    this.stageType = type;
    this.consecutiveScouts = 0;

    // 条件 i：演出后手牌耗尽，回合立即结束
    if (this.hands[playerId].length === 0) {
      return this.endRound(playerId, 'empty_hand');
    }

    this.nextPlayer();
    return { success: true, action: 'show' };
  }

  // ─────────────────────────────────────────────────────────────
  // 行动 B：挖角（SCOUT）
  // ─────────────────────────────────────────────────────────────
  /**
   * @param {string} playerId
   * @param {'left'|'right'} position - 从在场组左端或右端取牌
   * @param {number} insertIndex - 插入手牌的位置（0=最左）
   * @param {boolean} [flipScoutedCard=false] - 是否翻转挖到的牌（规则书：可以改变上下方向）
   */
  scout(playerId, position, insertIndex, flipScoutedCard = false) {
    if (this.state !== 'playing') return { success: false, message: '游戏未在进行中' };
    if (this.getCurrentPlayer().id !== playerId) return { success: false, message: '还没轮到你' };
    if (this.stage.length === 0) return { success: false, message: '在场组没有牌可以挖角' };

    // 从在场组取牌（只能取两端之一）
    let card;
    if (position === 'left') {
      card = this.stage.shift();
    } else {
      card = this.stage.pop();
    }

    // 规则书：挖角时可以改变该牌的上下方向
    if (flipScoutedCard) {
      card = flipCard(card);
    }

    // 插入手牌任意位置
    const hand = this.hands[playerId];
    const safeIndex = Math.max(0, Math.min(insertIndex, hand.length));
    hand.splice(safeIndex, 0, card);

    // 在场组主人获得挖角标记（补偿）
    if (this.stageOwner && this.stageOwner !== playerId) {
      this.scoutTokens[this.stageOwner] = (this.scoutTokens[this.stageOwner] || 0) + 1;
    }

    // 在场组清空后，主人和类型重置
    if (this.stage.length === 0) {
      this.stageOwner = null;
      this.stageType = null;
    }

    this.consecutiveScouts++;

    // 条件 ii：所有其他玩家都连续挖角（无人演出），在场组主人赢
    if (this.consecutiveScouts >= this.playerCount - 1 && this.stageOwner !== null) {
      return this.endRound(this.stageOwner, 'all_scout');
    }

    this.nextPlayer();
    return { success: true, action: 'scout', card };
  }

  // ─────────────────────────────────────────────────────────────
  // 行动 C：挖角并演出（SCOUT & SHOW）每玩家每轮仅限一次
  // 步骤1：先挖角，返回新手牌，等待用户选牌
  // 注意：此方法不增加 consecutiveScouts，不切换玩家，不触发回合结束
  // ─────────────────────────────────────────────────────────────
  prepareScoutAndShow(playerId, scoutPosition, insertIndex, flipScoutedCard = false) {
    if (this.state !== 'playing') return { success: false, message: '游戏未在进行中' };
    if (this.getCurrentPlayer().id !== playerId) return { success: false, message: '还没轮到你' };
    if (this.usedScoutAndShow[playerId]) return { success: false, message: '你已经用过"挖角并演出"了' };
    if (this.pendingScoutAndShow === playerId) return { success: false, message: '挖角已完成，请先完成演出' };
    if (this.stage.length === 0) return { success: false, message: '在场组没有牌可以挖角' };

    // 保存原始在场组信息（用于演出时的比较）
    const originalStageOwner = this.stageOwner;
    const originalStage = [...this.stage];
    const originalStageType = this.stageType;

    // 挖角
    let card;
    if (scoutPosition === 'left') {
      card = this.stage.shift();
    } else {
      card = this.stage.pop();
    }

    if (flipScoutedCard) {
      card = flipCard(card);
    }

    const hand = this.hands[playerId];
    const safeIndex = Math.max(0, Math.min(insertIndex, hand.length));
    hand.splice(safeIndex, 0, card);

    // 给原在场组主人补偿token
    if (originalStageOwner && originalStageOwner !== playerId) {
      this.scoutTokens[originalStageOwner] = (this.scoutTokens[originalStageOwner] || 0) + 1;
    }

    // 在场组清空后，主人和类型重置（但不触发回合结束）
    if (this.stage.length === 0) {
      this.stageOwner = null;
      this.stageType = null;
    }

    // 标记进入"挖角并演出"等待状态，保存原始在场组信息
    // 重要：不增加 consecutiveScouts，不切换玩家
    this.pendingScoutAndShow = playerId;
    this.savedStageBeforeScout = {
      stage: originalStage,
      stageOwner: originalStageOwner,
      stageType: originalStageType
    };

    return { 
      success: true, 
      action: 'scout_prepared',
      newHand: this.hands[playerId],
      message: '✅ 挖角完成！请选择手牌进行演出'
    };
  }

  // 步骤2：执行演出部分（必须在 prepareScoutAndShow 之后调用）
  finishScoutAndShow(playerId, showIndices) {
    if (this.state !== 'playing') return { success: false, message: '游戏未在进行中' };
    if (this.getCurrentPlayer().id !== playerId) return { success: false, message: '还没轮到你' };
    if (this.pendingScoutAndShow !== playerId) {
      return { success: false, message: '请先执行挖角步骤' };
    }

    const cards = this.getCardsAtIndices(playerId, showIndices);
    if (!cards) {
      return { success: false, message: '出牌索引不合法，请重新操作' };
    }

    const type = this.getPlayType(cards);
    if (!type) return { success: false, message: '所选牌不构成合法出牌' };

    // 重要：使用挖角之前保存的原始在场组进行比较（而不是挖角后的在场组）
    if (!this.beatsOriginalStage(cards, type)) {
      return { success: false, message: '出牌不够强，无法压制挖角前的在场组' };
    }

    // 演出成功：收集被压制的在场组（收集的是挖角后剩余的牌）
    if (this.stage.length > 0) {
      this.scoreCards[playerId] = (this.scoreCards[playerId] || 0) + this.stage.length;
    }

    const sorted = [...showIndices].sort((a, b) => a - b);
    for (let i = sorted.length - 1; i >= 0; i--) {
      this.hands[playerId].splice(sorted[i], 1);
    }

    this.stage = cards;
    this.stageOwner = playerId;
    this.stageType = type;
    this.consecutiveScouts = 0;
    this.usedScoutAndShow[playerId] = true;
    this.pendingScoutAndShow = null;
    this.savedStageBeforeScout = null; // 清除保存的信息

    if (this.hands[playerId].length === 0) {
      return this.endRound(playerId, 'empty_hand');
    }

    this.nextPlayer();
    return { success: true, action: 'scout_and_show' };
  }

  // 兼容旧接口：一次性完成挖角并演出（已弃用，保留向后兼容）
  scoutAndShow(playerId, scoutPosition, insertIndex, showIndices, flipScoutedCard = false) {
    const prep = this.prepareScoutAndShow(playerId, scoutPosition, insertIndex, flipScoutedCard);
    if (!prep.success) return prep;
    return this.finishScoutAndShow(playerId, showIndices);
  }

  // ─────────────────────────────────────────────────────────────
  // 回合结束与计分（官方规则）
  // ─────────────────────────────────────────────────────────────
  /**
   * 官方计分规则（正确版本）：
   * - 每张演出获得的分数卡 +1分（演出时收集被压制的牌）
   * - 每个挖角标记 +1分（被挖角时获得的补偿）
   * - 每张剩余手牌 -1分
   * - 达成条件 i（手牌耗尽）的玩家：手牌0张，不扣分
   * - 达成条件 ii（其他人全部挖角）的玩家：手牌不为0，但不因手牌扣分
   */
  endRound(winnerId, winnerType = 'empty_hand') {
    this.roundOver = true;
    this.roundWinner = winnerId;
    this.state = 'round_end';

    const roundScores = {};

    this.players.forEach(p => {
      const scoreCardsCount = this.scoreCards[p.id] || 0;  // 演出获得的分数卡
      const tokens = this.scoutTokens[p.id] || 0;          // 被挖角获得的补偿
      const handCount = this.hands[p.id].length;           // 剩余手牌

      if (p.id === winnerId) {
        // 赢家：分数卡 + 挖角标记，不扣手牌
        roundScores[p.id] = scoreCardsCount + tokens;
      } else {
        // 非赢家：分数卡 + 挖角标记 - 剩余手牌
        roundScores[p.id] = scoreCardsCount + tokens - handCount;
      }
    });

    // 累积到总分
    this.players.forEach(p => {
      this.totalScores[p.id] = (this.totalScores[p.id] || 0) + roundScores[p.id];
    });

    // 判断是否游戏结束（总轮次 = 玩家数）
    if (this.roundNumber >= this.playerCount) {
      this.state = 'game_end';
    } else {
      this.startPlayerIndex = (this.startPlayerIndex + 1) % this.playerCount;
    }

    // 构建计分明细（供前端展示计算过程）
    const scoreCardsSnapshot = {};
    const scoutTokensSnapshot = {};
    const handCountsSnapshot = {};
    this.players.forEach(p => {
      scoreCardsSnapshot[p.id] = this.scoreCards[p.id] || 0;
      scoutTokensSnapshot[p.id] = this.scoutTokens[p.id] || 0;
      handCountsSnapshot[p.id] = this.hands[p.id].length;
    });

    return {
      success: true,
      action: 'round_end',
      roundWinner: winnerId,
      winnerType,
      roundScores,
      totalScores: this.totalScores,
      scoreCards: scoreCardsSnapshot,
      scoutTokens: scoutTokensSnapshot,
      handCounts: handCountsSnapshot,
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
  }

  /** 获取供客户端渲染的游戏状态 */
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
        scoreCards: this.scoreCards[p.id] || 0,    // 演出获得的分数卡
        scoutTokens: this.scoutTokens[p.id] || 0,  // 被挖角获得的补偿
        totalScore: this.totalScores[p.id] || 0,
        usedScoutAndShow: this.usedScoutAndShow[p.id] || false,
        flipConfirmed: this.flipConfirmed[p.id] || false,
      })),
      usedScoutAndShow: this.usedScoutAndShow[viewPlayerId] || false,
    };
  }
}

module.exports = ScoutGame;
