const platform = require('./src/platform');
function failed(error) {
  console.error('游戏加载失败', error);
  platform.showStartup('加载失败，请重新进入');
}
// 先提交一帧加载画面，再解析玩法和特效模块，缩短入口之后的空白阶段。
platform.showStartup('加载中…');
platform.frame(() => platform.frame(() => {
  Promise.resolve().then(() => require('./src/app').boot()).catch(failed);
}));
