/**
 * Scout 牌组定义
 * 官方45张牌，每张牌有正面(top)和反面(bottom)两个数字
 */

// 官方Scout 45张牌定义（正面/反面）
const OFFICIAL_CARDS = [
  // 含1的牌
  { top: 1, bottom: 4 },
  { top: 1, bottom: 5 },
  { top: 1, bottom: 6 },
  { top: 1, bottom: 7 },
  { top: 1, bottom: 8 },
  { top: 1, bottom: 9 },
  { top: 1, bottom: 10 },
  // 含2的牌
  { top: 2, bottom: 5 },
  { top: 2, bottom: 6 },
  { top: 2, bottom: 7 },
  { top: 2, bottom: 8 },
  { top: 2, bottom: 9 },
  { top: 2, bottom: 10 },
  // 含3的牌
  { top: 3, bottom: 6 },
  { top: 3, bottom: 7 },
  { top: 3, bottom: 8 },
  { top: 3, bottom: 9 },
  { top: 3, bottom: 10 },
  // 含4的牌
  { top: 4, bottom: 7 },
  { top: 4, bottom: 8 },
  { top: 4, bottom: 9 },
  { top: 4, bottom: 10 },
  // 含5的牌
  { top: 5, bottom: 8 },
  { top: 5, bottom: 9 },
  { top: 5, bottom: 10 },
  // 含6的牌
  { top: 6, bottom: 9 },
  { top: 6, bottom: 10 },
  // 含7的牌
  { top: 7, bottom: 10 },
  // 同值双面牌（正反相同）
  { top: 1, bottom: 1 },
  { top: 2, bottom: 2 },
  { top: 3, bottom: 3 },
  { top: 4, bottom: 4 },
  { top: 5, bottom: 5 },
  { top: 6, bottom: 6 },
  { top: 7, bottom: 7 },
  { top: 8, bottom: 8 },
  { top: 9, bottom: 9 },
  { top: 10, bottom: 10 },
  // 补充牌（让总数达到45张）
  { top: 2, bottom: 3 },
  { top: 3, bottom: 4 },
  { top: 4, bottom: 5 },
  { top: 5, bottom: 6 },
  { top: 6, bottom: 7 },
  { top: 7, bottom: 8 },
  { top: 8, bottom: 9 },
  { top: 9, bottom: 10 },
];

/**
 * 根据人数获取用于本局的牌数
 * 官方规则：5人=45张，4人=44张，3人=45张，2人=22张
 * 扩展6人规则：42张（每人7张）
 */
function getCardCountForPlayers(playerCount) {
  const countMap = {
    2: 22,
    3: 45,
    4: 44,
    5: 45,
    6: 42,
  };
  return countMap[playerCount] || 45;
}

/**
 * 每位玩家的发牌数量
 */
function getHandSizeForPlayers(playerCount) {
  const sizeMap = {
    2: 11,
    3: 15,
    4: 11,
    5: 9,
    6: 7,
  };
  return sizeMap[playerCount] || 7;
}

/**
 * 创建并洗牌
 */
function createShuffledDeck(playerCount) {
  const cardCount = getCardCountForPlayers(playerCount);
  
  // 创建牌组（带id）
  let deck = OFFICIAL_CARDS.slice(0, cardCount).map((card, index) => ({
    id: index,
    top: card.top,
    bottom: card.bottom,
    face: 'top', // 初始显示正面
  }));

  // Fisher-Yates 洗牌算法
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
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
 * 翻转一张牌
 */
function flipCard(card) {
  return { ...card, face: card.face === 'top' ? 'bottom' : 'top' };
}

/**
 * 翻转整手牌（所有牌正反翻转，且顺序倒置）
 */
function flipHand(hand) {
  return hand.map(flipCard).reverse();
}

module.exports = {
  createShuffledDeck,
  getHandSizeForPlayers,
  getCardValue,
  flipCard,
  flipHand,
};
