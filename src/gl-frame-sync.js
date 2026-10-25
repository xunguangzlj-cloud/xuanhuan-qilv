'use strict';
// 微信原生2D合成前等待离屏GPU提交；在V30 Pro同机诊断中已恢复圆环显示。
function finishGLFrame(gl) {
  if (typeof wx !== 'undefined' && gl && gl.finish) gl.finish();
}
module.exports = { finishGLFrame };
