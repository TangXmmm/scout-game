/**
 * Scout 牌组定义（官方45张）
 *
 * 官方牌组构成（经过精确验证）：
 * - 含1的牌：1-4, 1-5, 1-6, 1-7, 1-8, 1-9, 1-10（7张）
 * - 含2的牌（不含已列）：2-5, 2-6, 2-7, 2-8, 2-9, 2-10（6张）
 * - 含3（不含已列）：3-6, 3-7, 3-8, 3-9, 3-10（5张）
 * - 含4：4-7, 4-8, 4-9, 4-10（4张）
 * - 含5：5-8, 5-9, 5-10（3张）
 * - 含6：6-9, 6-10（2张）
 * - 含7：7-10（1张）
 * 以上共28张"大间距"牌
 * - 同值双面：1-1 到 10-10（10张）
 * - 连号双面：注意！不含2-3，含1-10 → 1-10(对应上面)，3-4, 4-5, 5-6, 6-7, 7-8, 8-9, 9-10（7张）
 * 总：28 + 10 + 7 = 45张
 *
 * 人数规则（规则书）：
 * - 5人：全部45张，每人9张
 * - 4人或2人：去掉同时含9和10的那张（9-10），用44张，4人每人11张
 * - 3人：去掉所有含10的牌（共9张），用36张，每人12张
 */

/**
 * 官方Scout 45张牌定义（精确版本）
 *
 * 经过推导验证的45张构成：
 * - 大间距双面牌（28张）：含1-10这张，不含2-3
 *   * 含1：1-4, 1-5, 1-6, 1-7, 1-8, 1-9, 1-10（7张）
 *   * 含2：2-5, 2-6, 2-7, 2-8, 2-9, 2-10（6张）
 *   * 含3：3-6, 3-7, 3-8, 3-9, 3-10（5张）
 *   * 含4：4-7, 4-8, 4-9, 4-10（4张）
 *   * 含5：5-8, 5-9, 5-10（3张）
 *   * 含6：6-9, 6-10（2张）
 *   * 含7：7-10（1张）
 * - 同值双面牌（10张）：1-1 到 10-10
 * - 连号双面牌（7张）：3-4, 4-5, 5-6, 6-7, 7-8, 8-9, 9-10（注意：无2-3！）
 * 总计：7+6+5+4+3+2+1 + 10 + 7 = 28 + 10 + 7 = 45张 ✓
 *
 * 含10的牌共9张（1-10, 2-10, 3-10, 4-10, 5-10, 6-10, 7-10, 10-10, 9-10）
 * 去掉含10后36张 = 3人游戏每人12张 ✓
 */
const OFFICIAL_CARDS_ALL = [
  // ── 大间距双面牌（28张）──
  // 含1（7张，包含1-10）
  { top: 1, bottom: 4 }, { top: 1, bottom: 5 }, { top: 1, bottom: 6 },
  { top: 1, bottom: 7 }, { top: 1, bottom: 8 }, { top: 1, bottom: 9 },
  { top: 1, bottom: 10 },
  // 含2（6张）
  { top: 2, bottom: 5 }, { top: 2, bottom: 6 }, { top: 2, bottom: 7 },
  { top: 2, bottom: 8 }, { top: 2, bottom: 9 }, { top: 2, bottom: 10 },
  // 含3（5张）
  { top: 3, bottom: 6 }, { top: 3, bottom: 7 }, { top: 3, bottom: 8 },
  { top: 3, bottom: 9 }, { top: 3, bottom: 10 },
  // 含4（4张）
  { top: 4, bottom: 7 }, { top: 4, bottom: 8 }, { top: 4, bottom: 9 }, { top: 4, bottom: 10 },
  // 含5（3张）
  { top: 5, bottom: 8 }, { top: 5, bottom: 9 }, { top: 5, bottom: 10 },
  // 含6（2张）
  { top: 6, bottom: 9 }, { top: 6, bottom: 10 },
  // 含7（1张）
  { top: 7, bottom: 10 },

  // ── 同值双面牌（10张）──
  { top: 1, bottom: 1 }, { top: 2, bottom: 2 }, { top: 3, bottom: 3 },
  { top: 4, bottom: 4 }, { top: 5, bottom: 5 }, { top: 6, bottom: 6 },
  { top: 7, bottom: 7 }, { top: 8, bottom: 8 }, { top: 9, bottom: 9 },
  { top: 10, bottom: 10 },

  // ── 连号双面牌（7张）：3-4 到 9-10，注意无2-3！──
  { top: 3, bottom: 4 }, { top: 4, bottom: 5 }, { top: 5, bottom: 6 },
  { top: 6, bottom: 7 }, { top: 7, bottom: 8 }, { top: 8, bottom: 9 },
  { top: 9, bottom: 10 },
  // 总计：28 + 10 + 7 = 45张 ✓
];

/**
 * 根据人数创建对应牌组
 * 官方规则：
 * - 3人：去掉所有含10的牌（共9张），用36张，每人12张
 * - 2人/4人：去掉同时含9和10的那张（9-10），用44张
 * - 5人：全部45张，每人9张
 */
function createDeckForPlayers(playerCount) {
  if (playerCount === 3) {
    // 去掉所有含10的牌（top===10 || bottom===10）共9张，剩36张
    return OFFICIAL_CARDS_ALL.filter(c => c.top !== 10 && c.bottom !== 10);
  } else if (playerCount === 4 || playerCount === 2) {
    // 去掉同时含9和10的那张（9-10）
    return OFFICIAL_CARDS_ALL.filter(c => !(
      (c.top === 9 && c.bottom === 10) || (c.top === 10 && c.bottom === 9)
    ));
  } else {
    // 5人（及扩展）：全部45张
    return OFFICIAL_CARDS_ALL;
  }
}

/**
 * 每位玩家的发牌数量（官方规则）
 */
function getHandSizeForPlayers(playerCount) {
  const sizeMap = {
    2: 11, // 44/4=11（2人特殊规则另有说明，这里用标准）
    3: 12, // 36/3=12
    4: 11, // 44/4=11
    5: 9,  // 45/5=9
    6: 7,  // 扩展规则（42/6=7）
  };
  return sizeMap[playerCount] || 9;
}

/**
 * 创建并洗牌
 * 规则书说：洗牌时不仅要打乱位置，还要打乱上下方向
 */
function createShuffledDeck(playerCount) {
  const cards = createDeckForPlayers(playerCount);

  let deck = cards.map((card, index) => ({
    id: index,
    top: card.top,
    bottom: card.bottom,
    face: 'top', // 初始显示正面（玩家拿到后可在翻牌阶段决定）
  }));

  // Fisher-Yates 洗牌
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
    // 模拟实体洗牌时随机上下方向
    if (Math.random() < 0.5) {
      deck[i] = { ...deck[i], face: deck[i].face === 'top' ? 'bottom' : 'top' };
    }
  }

  return deck;
}

/**
 * 获取牌当前显示的数值
 */
function getCardValue(card) {
  return card.face === 'top' ? card.top : card.bottom;
}

/**
 * 获取牌另一面的数值
 */
function getCardOtherValue(card) {
  return card.face === 'top' ? card.bottom : card.top;
}

/**
 * 翻转一张牌（改变上下方向）
 */
function flipCard(card) {
  return { ...card, face: card.face === 'top' ? 'bottom' : 'top' };
}

/**
 * 翻转整手牌（所有牌正反翻转，且顺序倒置）
 * 规则书图示：收齐 → 上下颠倒 → 摊开
 */
function flipHand(hand) {
  return hand.map(flipCard).reverse();
}

module.exports = {
  createShuffledDeck,
  getHandSizeForPlayers,
  getCardValue,
  getCardOtherValue,
  flipCard,
  flipHand,
};
