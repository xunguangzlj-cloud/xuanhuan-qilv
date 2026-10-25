const test=require('node:test');
const assert=require('node:assert/strict');
const session=require('../src/session.js');
const config=require('../src/config.js');

function dailySave(day,pendingDay,date='2026-10-14') {
  const save=session.createSave();
  Object.assign(save.daily,{day,pendingDay,dates:[date],cycle:1});
  return save;
}

test('完成主线2解锁首胜，已解锁的无尽胜利也计入',()=>{
  const save=session.createSave();
  session.finishLevel(save,{score:100},'2026-10-14');
  assert.equal(save.daily.day,0);
  session.finishLevel(save,{score:100},'2026-10-14');
  assert.equal(save.daily.day,1);
  save.mainLevel=401;save.mode='endless';
  session.finishLevel(save,{score:100},'2026-10-15');
  assert.equal(save.daily.day,2);
});

test('主线400完成后进入无尽1并采用真实配置顺序',()=>{
  const save=session.createSave();save.mainLevel=400;
  assert.equal(session.levelDefinition(save),config.order.main[399]);
  session.finishLevel(save,{score:700},'2026-10-14');
  assert.equal(save.mode,'endless');assert.equal(save.endlessLevel,1);
  assert.equal(save.lastWin.level,400);assert.equal(save.lastWin.mode,'main');
  assert.equal(session.levelDefinition(save),config.order.endless[0]);
});

test('同一自然日重复胜利不推进首胜周期',()=>{
  const save=dailySave(3,3);
  assert.equal(session.refreshDaily(save,'2026-10-14'),false);
  assert.equal(session.recordDailyWin(save,'2026-10-14'),false);
  assert.equal(save.daily.day,3);assert.equal(save.daily.pendingDay,3);
});

test('连续下一日午夜保持周期，断一天或日期倒退则清day及pending',()=>{
  const save=dailySave(3,3);
  assert.equal(session.refreshDaily(save,'2026-10-15'),false);
  assert.equal(save.daily.day,3);assert.equal(save.daily.pendingDay,3);
  assert.equal(session.refreshDaily(save,'2026-10-16'),true);
  assert.equal(save.daily.day,0);assert.equal(save.daily.pendingDay,0);
  session.recordDailyWin(save,'2026-10-16');assert.equal(save.daily.day,1);
  assert.equal(session.refreshDaily(save,'2026-10-15'),true);
  assert.equal(save.daily.day,0);
});

test('满7天跨日仅重置day，未领取奖励保留且day0午夜检查不再清它',()=>{
  const save=dailySave(7,7);
  assert.equal(session.refreshDaily(save,'2026-10-15'),true);
  assert.equal(save.daily.day,0);assert.equal(save.daily.pendingDay,7);
  assert.equal(session.refreshDaily(save,'2026-10-17'),false);
  assert.equal(save.daily.pendingDay,7);
  session.recordDailyWin(save,'2026-10-17');
  assert.equal(save.daily.day,1);assert.equal(save.daily.pendingDay,7);
});

test('原CheckAndSetPendingReward只在里程碑覆盖，非里程碑保留旧pending',()=>{
  const save=dailySave(3,3,'2026-10-12');
  session.recordDailyWin(save,'2026-10-13');
  assert.equal(save.daily.day,4);assert.equal(save.daily.pendingDay,3);
  session.recordDailyWin(save,'2026-10-14');
  assert.equal(save.daily.day,5);assert.equal(save.daily.pendingDay,5);
});

test('旧周期未领取7日奖励只发一次且不阻止新周期7日领奖',()=>{
  const save=dailySave(7,7);
  session.recordDailyWin(save,'2026-10-15');
  assert.equal(save.daily.day,1);
  assert.equal(session.claimDaily(save),true);
  const coins=save.coins,props=structuredClone(save.props);
  assert.equal(session.claimDaily(save),false);
  assert.equal(save.coins,coins);assert.deepEqual(save.props,props);
  assert.ok(!save.daily.claimedDays.includes(7));
  for(let day=16;day<=21;day++) session.recordDailyWin(save,'2026-10-'+day);
  assert.equal(save.daily.day,7);assert.equal(save.daily.pendingDay,7);
  assert.equal(session.claimDaily(save),true);
});
