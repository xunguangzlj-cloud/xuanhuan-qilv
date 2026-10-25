const KEY = 'rr_classic_total_v1';
const canvas = wx.getSharedCanvas();
const ctx = canvas.getContext('2d');
let visible = false, rows = [], page = 0, message = '好友成绩加载中…';
let generation = 0, pendingScore = 0, syncing = false, uploaded = -1;
const pageSize = 6;
const scoreOf = user => {
  const item = (user.KVDataList || []).find(item => item.key === KEY);
  const value = item ? Number(item.value) : NaN;
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
};
function draw() {
  if (!visible) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#fff5df'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.font = '26px sans-serif'; ctx.fillStyle = '#75452d';
  if (message) { ctx.textAlign = 'center'; ctx.fillText(message, 326, 320); return; }
  const last = Math.max(0, Math.ceil(rows.length / pageSize) - 1); page = Math.min(last, page);
  rows.slice(page * pageSize, (page + 1) * pageSize).forEach((user, index) => {
    const y = 50 + index * 103;
    ctx.fillStyle = index % 2 ? '#f7e6c7' : '#fffaf0'; ctx.fillRect(8, y - 38, 636, 85);
    ctx.fillStyle = '#75452d'; ctx.textAlign = 'left'; ctx.font = 'bold 29px sans-serif'; ctx.fillText(String(page * pageSize + index + 1), 25, y);
    ctx.font = '25px sans-serif'; ctx.fillText(Array.from(user.nickname || '微信好友').slice(0, 9).join(''), 83, y);
    ctx.textAlign = 'right'; ctx.fillText(String(user.score), 622, y);
  });
  ctx.textAlign = 'center'; ctx.font = '23px sans-serif'; ctx.fillStyle = '#8c6645';
  ctx.fillText(`第 ${page + 1} / ${last + 1} 页`, 326, 682);
  ctx.font = '21px sans-serif'; ctx.fillText('仅显示同玩好友已同步的通关成绩', 326, 728);
}
function loadFriends() {
  const request = ++generation;
  message = '好友成绩加载中…'; draw();
  wx.getFriendCloudStorage({ keyList: [KEY], success(result) {
    if (request !== generation) return;
    rows = (result.data || []).map(user => ({ ...user, score: scoreOf(user) })).filter(user => user.score !== null)
      .sort((a, b) => b.score - a.score || String(a.openid).localeCompare(String(b.openid)));
    message = rows.length ? '' : '暂无好友成绩，邀请好友一起挑战吧'; draw();
  }, fail(error) { if (request !== generation) return; message = '好友榜加载失败，请点击刷新'; console.warn('好友榜读取失败', error.errMsg); draw(); } });
}
// 先比较云端累计最佳值，避免新设备或旧存档把已有高分覆盖成低分。
function sync() {
  if (syncing || pendingScore <= uploaded) return;
  syncing = true;
  wx.getUserCloudStorage({ keyList: [KEY], success(result) {
    const current = scoreOf(result) || 0, target = Math.max(current, pendingScore);
    wx.setUserCloudStorage({ KVDataList: [{ key: KEY, value: String(target) }], success() {
      uploaded = target; syncing = false;
      if (visible) loadFriends();
      if (pendingScore > uploaded) sync();
    }, fail(error) { syncing = false; console.warn('好友成绩同步失败，稍后重试', error.errMsg); if (visible) { message = '成绩同步失败，请点击刷新重试'; draw(); } } });
  }, fail(error) { syncing = false; console.warn('云端成绩读取失败，保留本地成绩', error.errMsg); if (visible) { message = '成绩同步失败，请点击刷新重试'; draw(); } } });
}
wx.onMessage(event => {
  if (event.type === 'score') { if (Number.isSafeInteger(event.score) && event.score >= 0) { pendingScore = Math.max(pendingScore, event.score); sync(); } }
  else if (event.type === 'show') { visible = true; page = Math.max(0, event.page || 0); loadFriends(); sync(); }
  else if (event.type === 'hide') { visible = false; generation++; }
  else if (event.type === 'page') { page = Math.max(0, page + (event.delta || 0)); draw(); }
});
