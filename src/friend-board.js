// 好友身份与好友成绩只在开放数据域内读取，主域仅合成共享画布。
function createFriendBoard(api = typeof wx === 'undefined' ? null : wx) {
  let context = null, opened = false, page = 0, authorized = false, pendingScore = 0, request = 0;
  let hint = '请在微信小游戏中查看好友榜';
  const getContext = () => {
    if (!context && api && api.getOpenDataContext) {
      context = api.getOpenDataContext();
      // 共享画布的尺寸只能由主域设置。
      if (context.canvas) { context.canvas.width = 652; context.canvas.height = 760; }
    }
    return context;
  };
  const post = message => {
    try { const target = getContext(); if (target) target.postMessage(message); return !!target; }
    catch (error) { console.warn('好友榜暂不可用', error); return false; }
  };
  return {
    get hint() { return hint; },
    sync(score) { pendingScore = Math.max(pendingScore, Math.max(0, Math.floor(Number(score) || 0))); return authorized && post({ type: 'score', score: pendingScore }); },
    async open() {
      opened = true; page = 0; const current = ++request;
      if (!api) return false;
      hint = '等待微信隐私授权…';
      const allowed = authorized || !api.requirePrivacyAuthorize || await new Promise(resolve => api.requirePrivacyAuthorize({ success: () => resolve(true), fail: () => resolve(false) }));
      if (!opened || current !== request) return false;
      if (!allowed) { hint = '好友榜需隐私授权，可点击刷新重试'; return false; }
      authorized = true; post({ type: 'score', score: pendingScore });
      return post({ type: 'show', page });
    },
    close() { opened = false; request++; if (context) post({ type: 'hide' }); },
    turn(delta) { post({ type: 'page', delta }); },
    refresh() { return authorized ? post({ type: 'show', page }) : this.open(); },
    draw(ctx, box) {
      if (!opened || !authorized) return false;
      try { const target = getContext(); if (!target || !target.canvas) return false; ctx.drawImage(target.canvas, box.x, box.y, box.w, box.h); return true; }
      catch (error) { return false; }
    }
  };
}
module.exports = { createFriendBoard };
