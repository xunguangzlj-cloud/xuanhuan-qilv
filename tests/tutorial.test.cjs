'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {createTutorial,sampleHand,drawHand} = require('../src/tutorial.js');
const handData = require('../assets/tutorial/hand-frames.json');

function board() {
  return {parts:[{id:'ring_2',kind:'ring',x:5,y:-2,rotationDeg:0,solved:false,data:{InnerRadius:36,OuterRadius:48}}]};
}

test('首关文字使用GenericSetup最终覆盖的Tutorial_Operation，手势在0.8秒后开场', () => {
  const scene=board(), before=JSON.stringify(scene), guide=createTutorial(scene,true);
  assert.equal(guide.textKey,'Tutorial_Operation');assert.equal(guide.pose(),null);
  guide.update(.79);assert.equal(guide.pose(),null);
  guide.update(.02);assert.equal(guide.pose().phase,'open');
  assert.equal(JSON.stringify(scene),before);
});

test('原开场时长和0.15等待后，手及环影顺时针同步180度且不改变真环', () => {
  const scene=board(), guide=createTutorial(scene,true), original=JSON.stringify(scene);
  guide.update(.800000011920929+handData.animations.guide_drag_open.duration+.15000000596046448+.3499999940395355);
  const pose=guide.pose();assert.equal(pose.phase,'rotate');
  assert.ok(Math.abs(pose.ring.deltaDeg+90)<1e-8);
  const angle=(136-90)*Math.PI/180;
  assert.ok(Math.abs(pose.hand.worldX-(5+1.75*Math.cos(angle)))<1e-8);
  assert.ok(Math.abs(pose.hand.worldY-(-2+1.75*Math.sin(angle)))<1e-8);
  assert.equal(JSON.stringify(scene),original);
});

test('起手即隐藏、长按不重现，松手后三秒才重现并跳过0.8延迟', () => {
  const guide=createTutorial(board(),true);guide.update(1);guide.gesture();
  guide.update(10);assert.equal(guide.pose(),null);assert.equal(guide.textKey,'');
  guide.release();guide.update(2.99);assert.equal(guide.pose(),null);
  guide.update(.02);assert.equal(guide.pose().phase,'open');assert.equal(guide.textKey,'Tutorial_Operation');
  assert.ok(guide.pose().hand.time<.02);
});

test('任一圆环释放后引导结束，不因后续松手或等待重新出现', () => {
  const guide=createTutorial(board(),true);guide.collect('ring');guide.release();guide.update(100);
  assert.equal(guide.state,'Completed');assert.equal(guide.pose(),null);assert.equal(guide.textKey,'');
});

test('原骨骼自适应帧保持37顶点和44三角形，开关透明度符合原动画', () => {
  assert.equal(handData.uvs.length,74);assert.equal(handData.triangles.length,132);
  const start=sampleHand('guide_drag_open',0), open=sampleHand('guide_drag_open',handData.animations.guide_drag_open.duration);
  const close=sampleHand('guide_drag_close',.21);
  assert.equal(start.vertices.length,74);assert.equal(start.alpha,0);
  assert.equal(open.alpha,1);assert.ok(Math.abs(close.alpha)<1e-6);
  assert.notDeepEqual(start.vertices,open.vertices);
  for(const value of open.vertices) assert.ok(Number.isFinite(value));
});

test('原骨骼的两个分段跳变保留精确边界且不产生NaN', () => {
  assert.equal(handData.formatVersion, 2);
  const frames = handData.animations.guide_drag_open.frames;
  for (const time of [.321066677570343, .34666669368743896]) {
    const rows = frames.filter(row => row[0] === time);
    assert.equal(rows.length, 3);
    const at = sampleHand('guide_drag_open', time);
    assert.equal(at.alpha, rows[1][1]);
    assert.deepEqual(at.vertices, rows[1].slice(2));
    for (const offset of [-1e-8, 1e-8]) {
      const pose = sampleHand('guide_drag_open', time + offset);
      for (const value of [pose.alpha, ...pose.vertices]) assert.ok(Number.isFinite(value));
    }
  }
});

test('再次显示时按真实环当前角度刷新轨道和引导旋转量', () => {
  const scene=board(), guide=createTutorial(scene,true);
  guide.update(1);guide.gesture();scene.parts[0].rotationDeg=60;guide.release();
  guide.update(3+handData.animations.guide_drag_open.duration+.15000000596046448+.3499999940395355);
  const pose=guide.pose();assert.equal(pose.phase,'rotate');
  assert.ok(Math.abs(pose.ring.deltaDeg+120)<1e-8);
  assert.ok(Math.abs(pose.ring.rotationDeg+60)<1e-8);
  const angle=(60+136-120)*Math.PI/180;
  assert.ok(Math.abs(pose.hand.worldX-(5+1.75*Math.cos(angle)))<1e-8);
  assert.equal(scene.parts[0].rotationDeg,60);
});

test('原手网格所有三角形经Canvas仿射映射后坐标有限并恢复绘制状态', () => {
  let saves=0, clips=0, draws=0, transforms=0;
  const positions=[], ctx={globalAlpha:.5,
    save(){saves++;},restore(){saves--;},
    translate(...values){positions.push(values);},scale(...values){positions.push(values);},
    beginPath(){},moveTo(...values){positions.push(values);},lineTo(...values){positions.push(values);},closePath(){},
    clip(){clips++;},transform(...values){positions.push(values);transforms++;},
    drawImage(){draws++;}
  };
  const guide=createTutorial(board(),true);guide.update(1.4);
  drawHand(ctx,{},guide.pose().hand,{x:420,y:800},.5);
  assert.equal(saves,0);assert.equal(clips,44);assert.equal(draws,44);assert.equal(transforms,44);
  assert.deepEqual(positions.slice(0,4),[[420,800],[.5,-.5],[22,-118],[.7599999904632568,.7599999904632568]]);
  for(const value of positions.flat()) assert.ok(Number.isFinite(value));
});
