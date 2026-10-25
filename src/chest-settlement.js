'use strict';
const session = require('./session');

// 原 UILevelWinController / PreStageRewardProgress / UIClaimRewardController 的定时链。
const timing = Object.freeze({ progressStart: 1.75, grow: 0.4, lightFade: 0.4, finalEffect: 0.5, boxFly: 0.5, rewardLead: 1.4, instantiateDelay: 0.1, propFly: 0.5, propStagger: 0.05 });
const clamp = value => Math.max(0, Math.min(1, value));

function createChestSettlement(save, { onPersist = () => {}, transaction: resumedTransaction = null } = {}) {
  const threshold = session.chestThreshold(save);
  const progress = Math.min(save.chest.progress, threshold.count);
  const wasClaimable = session.isChestClaimable(save);
  let age = 0, phase = resumedTransaction ? 'reward' : 'progress', transaction = resumedTransaction;
  let rewardOpenedAt = 0, flyStartedAt = 0, firstArrived = false;
  let progressStarted = false, progressComplete = false, opened = !!resumedTransaction;
  let closed = false;

  function openReward(openAge) {
    if (opened) return [];
    transaction = session.reserveChestReward(save);
    if (!transaction) return [];
    onPersist(); opened = true; phase = 'reward'; rewardOpenedAt = openAge;
    return [{ type: 'open-reward', transaction }];
  }

  function requestOpen() {
    // 原 Gift 按钮可在自动涨条结束前触发同一命令，预约逻辑不能分成两套。
    return openReward(age);
  }

  function update(elapsed) {
    const events = [];
    age = Math.max(age, elapsed);
    if (!progressStarted && phase === 'progress' && age >= timing.progressStart) {
      progressStarted = true; events.push({ type: 'progress-start' });
    }
    if (!progressComplete && phase === 'progress' && age >= timing.progressStart + timing.grow) {
      progressComplete = true; events.push({ type: 'progress-complete', final: progress === threshold.count });
    }
    if (!opened && wasClaimable && age >= timing.progressStart + timing.grow + timing.finalEffect) {
      events.push(...openReward(timing.progressStart + timing.grow + timing.finalEffect));
    }
    if (phase === 'flying') {
      if (!firstArrived && age - flyStartedAt >= timing.propFly) { firstArrived = true; events.push({ type: 'first-arrive' }); }
      const itemCount = Object.keys(transaction.items).length;
      if (age - flyStartedAt >= timing.propFly + Math.max(0, itemCount - 1) * timing.propStagger) {
        closed = true; phase = 'closed'; events.push({ type: 'closed' });
      }
    }
    return events;
  }

  function claim(multiplier = 1) {
    // 多倍只接受调用方已实际确认的广告结果；普通按钮传 1。
    if (phase !== 'reward' || age - rewardOpenedAt < timing.rewardLead + timing.instantiateDelay) return false;
    if (!session.grantChestReward(save, transaction.id, multiplier)) return false;
    onPersist(); phase = 'flying'; flyStartedAt = age;
    return true;
  }

  function view() {
    const growTime = age - timing.progressStart;
    const linear = clamp(growTime / timing.grow);
    // 原 DOTween Ease.OutQuad（枚举 3），只增长本关对应的一格。
    const growFraction = 1 - (1 - linear) * (1 - linear);
    return {
      phase, age, count: closed ? session.chestThreshold(save).count : threshold.count, preLit: opened ? 0 : Math.max(0, progress - 1), lit: opened ? 0 : progress,
      currentFraction: opened || age < timing.progressStart ? 0 : growFraction,
      lightAlpha: opened || growTime < 0 ? 0 : growTime <= timing.grow ? 1 : 1 - clamp((growTime - timing.grow) / timing.lightFade),
      finalAge: progress === threshold.count && progressComplete ? age - timing.progressStart - timing.grow : -1,
      rewardAge: opened ? age - rewardOpenedAt : -1,
      flyAge: phase === 'flying' || closed ? age - flyStartedAt : -1,
      claimEnabled: phase === 'reward' && age - rewardOpenedAt >= timing.rewardLead + timing.instantiateDelay,
      nextEnabled: age >= 1.1 && (!wasClaimable && !resumedTransaction || closed),
      transaction, opened, closed
    };
  }

  return { update, claim, requestOpen, view };
}

module.exports = { createChestSettlement, timing };
