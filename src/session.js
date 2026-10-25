const config = require('./config');

function createSave() {
  return {
    version: 1, mainLevel: 1, endlessLevel: 1, mode: 'main', coins: 0, themeId: 0,
    props: { 201: 0, 202: 0 }, unlockedProps: [], introducedProps: [], guidedProps: [], usedProps: [], guideInteractedProps: [], pendingFreeProps: {}, pendingPropIntro: null, totalScore: 0,
    settings: { music: true, sound: true, vibration: true },
    profile: { name: '', avatar: 0 }, daily: { dates: [], claimedDays: [], day: 0, pendingDay: 0, cycle: 0 },
    chest: { cycle: -1, progress: 0, lastClaimed: -1, transactions: [] }, snapshot: null, snapshotKey: null, lastWin: null
  };
}

function currentLevel(save) {
  return save.mode === 'endless' ? save.endlessLevel : save.mainLevel;
}

function levelDefinition(save) {
  const order = config.order[save.mode];
  return order[(currentLevel(save) - 1) % order.length];
}

function grantReward(save, rewardId) {
  const reward = config.RewardConfig[String(rewardId)];
  if (!reward) return false;
  for (const [key, count] of Object.entries(reward.get)) {
    if (key === '101') save.coins += count;
    else save.props[key] = (save.props[key] || 0) + count;
  }
  return true;
}

function chestThreshold(save) {
  const rule = config.StageReward['1'];
  const index = rule.looptype === 2
    ? Math.min(Math.max(0, save.chest.cycle), rule.Progress.length - 1)
    : Math.max(0, save.chest.cycle) % rule.Progress.length;
  return { count: rule.Progress[index], reward: rule.Reward[index] };
}

function isChestClaimable(save) {
  const chest = save.chest;
  const threshold = chestThreshold(save);
  return chest.cycle >= 0 && chest.progress >= threshold.count && chest.lastClaimed < chest.cycle;
}

function claimChest(save) {
  const transaction = reserveChestReward(save);
  return !!transaction && grantChestReward(save, transaction.id);
}

// 原命令先预约持久事务并换下一轮；打开领奖页不等于库存已增加。
function reserveChestReward(save, { isAutoClaim = false } = {}) {
  if (!isChestClaimable(save)) return false;
  const chest = save.chest;
  const threshold = chestThreshold(save);
  const id = `chest:${config.defaults.ChestFunction.StageRewardId}:${chest.cycle}`;
  const transactions = chest.transactions || (chest.transactions = []);
  let transaction = transactions.find(item => item.id === id);
  if (!transaction) {
    transaction = { id, cycle: chest.cycle, reward: threshold.reward, items: { ...config.RewardConfig[String(threshold.reward)].get }, isAutoClaim, granted: false };
    transactions.push(transaction);
  }
  chest.lastClaimed = chest.cycle;
  chest.cycle++;
  chest.progress = 0;
  return transaction;
}

function pendingChestRewards(save) {
  return (save.chest.transactions || []).filter(item => !item.granted);
}

// 库存和已发标记由同一个存档对象一次持久化；重复点击、回调或重启不重复发奖。
function grantChestReward(save, transactionId, multiplier = 1) {
  const transaction = (save.chest.transactions || []).find(item => item.id === transactionId);
  if (!transaction) return false;
  if (transaction.granted) return true;
  multiplier = Math.max(1, Math.floor(multiplier));
  for (const [key, count] of Object.entries(transaction.items)) {
    if (key === '101') save.coins += count * multiplier;
    else save.props[key] = (save.props[key] || 0) + count * multiplier;
  }
  transaction.granted = true;
  transaction.multiplier = multiplier;
  return true;
}

function finishLevel(save, result, localDate) {
  const definition = levelDefinition(save);
  save.lastWin = { ...result, level: currentLevel(save), mode: save.mode, difficulty: definition.difficulty };
  save.totalScore += result.score || 0;
  if (save.chest.cycle < 0) save.chest.cycle = 0;
  save.chest.progress++;
  if (save.mode === 'main') {
    save.mainLevel++;
    if (save.mainLevel > config.order.main.length) save.mode = 'endless';
  } else save.endlessLevel++;
  // 原胜利入口始终传isMainMode=true；首胜按已完成主线解锁，无尽胜利也计入。
  const openLevel = config.DailyFirstWinConfig['1001'].OpenLevel;
  if (openLevel > 0 && Math.max(0, save.mainLevel - 1) >= openLevel) recordDailyWin(save, localDate);
  save.snapshot = null;
  save.snapshotKey = null;
}

function refreshDaily(save, localDate) {
  const daily = save.daily;
  // 原午夜检查在day=0时直接返回，包括满周期后留下的未领取奖励。
  if (daily.day <= 0) return false;
  const lastDate = daily.dates[daily.dates.length - 1];
  if (lastDate === localDate) return false;
  const daysBetween = lastDate ? (Date.parse(localDate + 'T00:00:00Z') - Date.parse(lastDate + 'T00:00:00Z')) / 86400000 : Infinity;
  if (daysBetween !== 1) {
    daily.day = 0; daily.pendingDay = 0; daily.claimedDays = [];
    return true;
  }
  const configuredPeriod = config.DailyFirstWinConfig['1001'].Period;
  const period = configuredPeriod <= 0 || configuredPeriod > 7 ? 7 : configuredPeriod;
  if (daily.day < period) return false;
  daily.day = 0; daily.claimedDays = [];
  return true;
}

function recordDailyWin(save, localDate) {
  refreshDaily(save, localDate);
  const daily = save.daily;
  const lastDate = daily.dates[daily.dates.length - 1];
  if (lastDate === localDate) return false;
  if (daily.day <= 0) { daily.day = 1; daily.cycle = (daily.cycle || 0) + 1; daily.claimedDays = []; }
  else daily.day++;
  daily.dates.push(localDate);
  if (config.DailyFirstWinConfig['1001'].Days.split(',').map(Number).includes(daily.day)) daily.pendingDay = daily.day;
  return true;
}

function claimDaily(save) {
  const daily = save.daily;
  if (!daily.pendingDay) return false;
  const row = config.DailyFirstWinConfig['1001'];
  const index = row.Days.split(',').map(Number).indexOf(daily.pendingDay);
  if (index < 0) return false;
  if (!grantReward(save, Number(row.Rewards.split(',')[index].split('|')[0]))) return false;
  // 上一周期保留的奖励可以领取，但不能把新周期未来的同名日标为已领。
  if (daily.pendingDay <= daily.day && !daily.claimedDays.includes(daily.pendingDay)) daily.claimedDays.push(daily.pendingDay);
  daily.pendingDay = 0;
  return true;
}

function unlockIntro(save) {
  if (save.mode !== 'main') return null;
  propState(save);
  if (save.pendingPropIntro) return config.PropConfig[String(save.pendingPropIntro.propId)];
  const prop = Object.values(config.PropConfig).filter(row => row.Id >= 200 && row.Id < 300).sort((a, b) => a.UnlockLv - b.UnlockLv).find(row => row.UnlockLv <= save.mainLevel && !save.introducedProps.includes(row.Id));
  return prop || null;
}

function propState(save) {
  for (const key of ['unlockedProps', 'introducedProps', 'guidedProps', 'usedProps', 'guideInteractedProps']) if (!save[key]) save[key] = [];
  if (!save.props) save.props = {};
  if (!save.pendingFreeProps) save.pendingFreeProps = {};
}

function beginPropIntro(save) {
  const prop = unlockIntro(save);
  if (!prop) return null;
  if (save.pendingPropIntro) return save.pendingPropIntro;
  const free = config.defaults.PropFunction.NewUserFreeSend.split('|').map(value => value.split('-').map(Number));
  const grantCount = (free.find(row => row[0] === prop.Id) || [prop.Id, 0])[1];
  const fromCount = save.props[prop.Id] || 0;
  // 原解锁演出开始前已发库存；事务随库存持久化，重启仅恢复演出。
  save.props[prop.Id] = fromCount + grantCount;
  save.introducedProps.push(prop.Id);
  if (!save.unlockedProps.includes(prop.Id)) save.unlockedProps.push(prop.Id);
  return save.pendingPropIntro = { propId: prop.Id, grantCount, fromCount, toCount: save.props[prop.Id] };
}

function finishPropIntro(save, propId) {
  propState(save);
  if (!save.pendingPropIntro || save.pendingPropIntro.propId !== propId) return false;
  save.pendingPropIntro = null;
  if (save.usedProps.includes(propId)) return false;
  // 免费首用来自解锁回飞结束或同级重播，不从未使用状态凭空产生。
  save.pendingFreeProps[propId] = 1;
  return true;
}

function canUseProp(save, propId) {
  propState(save);
  return save.unlockedProps.includes(propId) && ((save.pendingFreeProps[propId] || 0) > 0 || (save.props[propId] || 0) > 0);
}

function beginPropGuide(save, propId, { fromUnlock = false } = {}) {
  if (!canUseProp(save, propId)) return null;
  const first = fromUnlock || !save.guidedProps.includes(propId);
  if (!save.guidedProps.includes(propId)) save.guidedProps.push(propId);
  save.guideInteractedProps = save.guideInteractedProps.filter(id => id !== propId);
  return { propId, first };
}

function markPropGuideInteracted(save, propId) {
  propState(save);
  if (!save.guidedProps.includes(propId)) return false;
  if (!save.guideInteractedProps.includes(propId)) save.guideInteractedProps.push(propId);
  return true;
}

function consumeProp(save, propId) {
  if (!canUseProp(save, propId)) return false;
  let reason = 'stock';
  if ((save.pendingFreeProps[propId] || 0) > 0) {
    reason = 'free';
    if (--save.pendingFreeProps[propId] === 0) delete save.pendingFreeProps[propId];
  } else save.props[propId]--;
  if (!save.usedProps.includes(propId)) save.usedProps.push(propId);
  return reason;
}

function clearPendingFreeProps(save, level = currentLevel(save)) {
  propState(save);
  for (const id of Object.keys(save.pendingFreeProps)) if (config.PropConfig[id]?.UnlockLv !== level) delete save.pendingFreeProps[id];
}

function replayPropGuide(save) {
  propState(save);
  if (save.mode !== 'main') return null;
  // 旧存档没有引导历史，不能把缺失字段推断为未互动并再送免费次数。
  const prop = Object.values(config.PropConfig).find(row => row.Id >= 200 && row.Id < 300 && row.UnlockLv === currentLevel(save) && save.unlockedProps.includes(row.Id) && save.guidedProps.includes(row.Id) && !save.guideInteractedProps.includes(row.Id));
  if (!prop) return null;
  save.pendingFreeProps[prop.Id] = 1;
  return prop;
}

function acceptIntro(save, propId) {
  propState(save);
  if (save.introducedProps.includes(propId) || unlockIntro(save)?.Id !== propId) return false;
  const pending = beginPropIntro(save);
  return !!pending && pending.propId === propId && finishPropIntro(save, propId);
}

module.exports = { createSave, currentLevel, levelDefinition, grantReward, chestThreshold, isChestClaimable, claimChest, reserveChestReward, pendingChestRewards, grantChestReward, finishLevel, unlockIntro, acceptIntro, beginPropIntro, finishPropIntro, canUseProp, beginPropGuide, markPropGuideInteracted, consumeProp, clearPendingFreeProps, replayPropGuide, refreshDaily, recordDailyWin, claimDaily };
