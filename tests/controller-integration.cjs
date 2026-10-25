'use strict';

const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),zlib=require('node:zlib'),assert=require('node:assert/strict');
const gameRoot=path.resolve(__dirname,'..');
const session=require(path.join(gameRoot,'src/session.js'));
const appPath=path.join(gameRoot,'src/app.js'), appCode=fs.readFileSync(appPath,'utf8');
const cache=new Map();
const runtimeFactory=require('./load-runtime-physics.cjs').createFactory();
function readData(name) {
  if(!cache.has(name)) cache.set(name,JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(gameRoot,'packages',name,'data.gz'))).toString('utf8')));
  return cache.get(name);
}

async function harness(initialSave, withHomeRenderer = false, withTouchSet = false, startupResize = null) {
  const state={saved:initialSave?structuredClone(initialSave):null,frames:null,pointer:null,touch:null,hide:null,resize:null,model:null,clock:1,sounds:[],toasts:[],muteCalls:[],soundStops:[],homeEntryDraws:[],homeEntryResizes:0,vibrations:0,view:{width:540,height:960,ratio:1}};
  if (startupResize) state.view={...startupResize.initial};
  state.canvas={getContext:()=>({setTransform(){}})};
  const platform={
    viewport:()=>({...state.view}),createCanvas:()=>state.canvas,showStartup(){},
    readSave:()=>state.saved,writeSave:value=>{state.saved=structuredClone(value);},
    readData:async name=>{const data=readData(name);if(name==='geometry'&&startupResize){state.view={...startupResize.ready};state.startupResizeBeforeListener=!state.resize;}return data;},readNativeLevel:async(name,key,geometries)=>require('./load-game-data.cjs').loadNativeLevel(key,geometries),ensurePackage:async()=>{},loadImage:()=>null,loadImageAsync:async()=>({}),
    onPointer:(canvas,...handlers)=>{state.pointer=handlers;},onHide:handler=>{state.hide=handler;},
    onResize:handler=>{state.resize=handler;},reportInteractive:()=>{state.interactiveReports=(state.interactiveReports||0)+1;assert(state.model,'交互标记必须位于首个场景绘制之后');},
    vibrate(){state.vibrations++;},toast(message){state.toasts.push(message);},frame:handler=>{state.frames=handler;}
  };
  if (withTouchSet) platform.onTouchSet=(canvas,handler)=>{state.touch=handler;};
  if (withHomeRenderer) platform.createRenderCanvas=()=>({});
  const fakeUI={createUI:options=>{state.uiDimensions={width:options.width,height:options.height};return {hit:()=>null,propAnchor:()=>({x:720,y:1700}),draw:(screen,model)=>{state.model=model;}};}};
  const audio={play:async name=>{state.sounds.push(name);},stopMusic(){},resumeMusic(){},setSoundMuted:muted=>{state.muteCalls.push(muted);},stopSound:name=>{state.soundStops.push(name);}};
  const module={exports:{}};
  const rendererStubs=withHomeRenderer?{
    './ring-renderer':{createRingRenderer:async()=>null},
    './character-animation':{...require(path.join(gameRoot,'src/character-animation')),createCharacterRenderer:async()=>({draw(){},resize(){}})},
    './home-entry-animation':{...require(path.join(gameRoot,'src/home-entry-animation')),createHomeEntryRenderer:async()=>({available:true,draw(ctx,key,pose){state.homeEntryDraws.push({key,pose});},resize(){state.homeEntryResizes++;}})},
    './release-effects':{createReleaseEffects:async()=>null},
    './ambient-effects':{createAmbientEffects:async()=>null},
    './chest-effects':{createChestEffects:async()=>null},
    './prop-effects':{...require(path.join(gameRoot,'src/prop-effects')),createPropEffects:async({model})=>Object.assign(model,{draw(){},resize(){}})},
    './prop-unlock-effects':{createPropUnlockEffects:async()=>({draw(){},resize(){}})},
    './background-renderer':{createBackgroundRenderer:async()=>null}
  }:{};
  const requireLocal=name=>name==='./load-ring-physics-v1'?{loadRingPhysicsFactory:async()=>runtimeFactory}:name==='./platform'?platform:name==='./ui'?fakeUI:name==='./audio'?audio:rendererStubs[name]||require(path.resolve(gameRoot,'src',name));
  vm.runInNewContext(appCode,{module,exports:module.exports,require:requireLocal,console,window:{},Date,Math});
  state.debug=await module.exports.boot();
  // 先建立零增量首帧，后续可直接核验0.35/0.75秒边界，不把首帧丢失算作原时序。
  state.frames(state.clock);
  state.tick=duration=>{for(let elapsed=0;elapsed<duration;){const delta=Math.min(50,duration-elapsed);state.clock+=delta;state.frames(state.clock);elapsed+=delta;}};
  return state;
}

function unlockProp(state, id) {
  state.debug.save.props[id]=2;
  state.debug.save.unlockedProps=[201,202];state.debug.save.introducedProps=[201,202];
  state.debug.save.guidedProps=[201,202];state.debug.save.usedProps=[201,202];state.debug.save.guideInteractedProps=[201,202];
}

function ringPoint(state, id='ring_1') {
  const part=state.debug.board.parts.find(value=>value.id===id),camera=state.debug.camera;
  return {x:(part.x-camera.x)*camera.scale+camera.cx,y:(camera.y-part.y-1.8)*camera.scale+camera.cy};
}

async function startProp(state, id) {
  await state.debug.activate(`prop:${id}`);
  if(id===202) await state.debug.activate('BtnUse');
  if(id===201){const point=ringPoint(state);state.pointer[0](point.x,point.y);state.pointer[2](point.x,point.y);}
  assert.equal(state.debug.props.actions.length,1);
  return state.debug.props.actions[0];
}

async function main() {
  const checks=[];
  const h=await harness();
  assert.equal(h.interactiveReports,1);h.tick(100);assert.equal(h.interactiveReports,1);
  checks.push({name:'完成首个可交互场景绘制后上报一次，后续帧不重复上报',passed:true});
  const lateViewport=await harness(null,false,false,{initial:{width:360,height:780,ratio:2},ready:{width:540,height:1170,ratio:2}});
  assert(lateViewport.startupResizeBeforeListener);
  assert.equal(lateViewport.canvas.width,1080);assert.equal(lateViewport.canvas.height,2340);
  assert.deepEqual(lateViewport.uiDimensions,{width:540,height:1170});
  assert.equal(lateViewport.debug.camera.cx,270);assert.equal(lateViewport.debug.camera.cy,585);
  checks.push({name:'异步初始化期间先发生尺寸变化，首次交互前仍同步最终画布、UI和取景尺寸',passed:true});
  unlockProp(h,201);
  await h.debug.activate('prop:201');assert.equal(h.debug.board.propMode,'hammer');
  await h.debug.activate('close');assert.equal(h.debug.board.propMode,null);
  h.tick(350);
  await h.debug.activate('prop:201');
  const ring=h.debug.board.parts.find(part=>part.id==='ring_1'),{x,y}=ringPoint(h);
  h.pointer[0](x,y);h.pointer[2](x,y);
  assert.equal(h.debug.save.props[201],2);assert.equal(ring.solved,false);assert.equal(h.debug.props.actions.length,1);
  assert.equal(h.debug.modal,'propGuide');
  h.pointer[0](x,y);h.pointer[2](x,y);assert.equal(h.debug.props.actions.length,1);
  h.tick(340);assert.equal(h.sounds.filter(name=>name==='rr_sfx_item_hammer_hit').length,0);
  h.tick(10);assert.equal(h.sounds.filter(name=>name==='rr_sfx_item_hammer_hit').length,1);assert.equal(h.debug.modal,'propGuide');
  assert.equal(h.debug.save.props[201],2);assert.equal(ring.solved,false);
  h.tick(390);assert.equal(h.debug.save.props[201],2);assert.equal(ring.solved,false);assert.equal(h.debug.modal,'propGuide');
  h.tick(10);assert.equal(h.debug.save.props[201],1);assert.equal(ring.solved,true);
  h.pointer[0](x,y);h.pointer[2](x,y);assert.equal(h.debug.save.props[201],1);
  assert.equal(h.sounds.filter(name=>name==='rr_sfx_item_hammer_hit').length,1);
  checks.push({name:'锤子取消、0.35秒音效及0.75秒命中只扣一次，动作中重复点击被挡',passed:true});
  assert.equal(h.sounds.filter(name=>name==='rr_sfx_ceramicring_break').length,1);
  assert.equal(h.sounds.filter(name=>name==='rr_sfx_ceramicring_release').length,1);assert.equal(h.vibrations,1);
  checks.push({name:'同帧多件消除只播放一次原破碎释放组合并振动一次',passed:true});
  h.hide();
  const restored=await harness(h.saved);restored.tick(300);restored.hide();
  assert.equal(restored.saved.mainLevel,2);assert.equal(restored.saved.totalScore,400);assert.equal(restored.saved.snapshot,null);
  const after=await harness(restored.saved);after.tick(500);
  assert.equal(after.debug.save.mainLevel,2);assert.equal(after.debug.save.totalScore,400);
  checks.push({name:'won快照退后台重启只结算一次',passed:true});
  for(const id of [201,202]){
    const kind=id===201?'hammer':'rocket',label=id===201?'锤子':'火箭';
    const pending=await harness();unlockProp(pending,id);
    const action=await startProp(pending,id);pending.tick(200);pending.hide();
    assert.equal(pending.saved.props[id],2);assert.equal(pending.saved.propAction.effects.actions[0].hitEmitted,false);
    const continued=await harness(pending.saved);
    assert.equal(continued.debug.props.actions[0].targetId,action.targetId);
    assert.equal(continued.debug.props.actions[0].age,.2);
    let hitCalls=0;const execute=continued.debug.board[kind];
    continued.debug.board[kind]=(...args)=>{hitCalls++;return execute(...args);};
    continued.tick((action.hitAt-.2)*1000+10);
    assert.equal(hitCalls,1);assert.equal(continued.debug.save.props[id],1);
    assert.equal(continued.debug.board.parts.find(part=>part.id===action.targetId).solved,true);
    continued.hide();assert.equal(continued.saved.propAction.effects.actions[0].hitEmitted,true);
    const submitted=await harness(continued.saved);
    let duplicateHits=0;const submitExecute=submitted.debug.board[kind];
    submitted.debug.board[kind]=(...args)=>{duplicateHits++;return submitExecute(...args);};
    submitted.tick(1300);submitted.hide();
    assert.equal(duplicateHits,0);assert.equal(submitted.debug.save.props[id],1);assert.equal(submitted.saved.props[id],1);
    checks.push({name:`${label}命中前退后台重启续播并命中一次，命中后重启不重复移除或扣数`,passed:true});
  }
  const rocket=await harness();unlockProp(rocket,202);
  const rocketAction=await startProp(rocket,202),rocketTarget=rocket.debug.board.parts.find(part=>part.id===rocketAction.targetId),rocketScore=rocket.debug.board.score;
  assert.equal(rocket.debug.save.props[202],2);assert.equal(rocketTarget.solved,false);
  await rocket.debug.activate('prop:202');assert.equal(rocket.debug.props.actions.length,1);
  rocket.tick(rocketAction.hitAt*1000-10);
  assert.equal(rocket.debug.save.props[202],2);assert.equal(rocketTarget.solved,false);assert.equal(rocket.debug.board.score,rocketScore);
  rocket.tick(10);assert.equal(rocket.debug.save.props[202],1);assert.equal(rocketTarget.solved,true);
  rocket.tick(500);assert.equal(rocket.debug.save.props[202],1);
  assert.equal(rocket.sounds.filter(name=>name==='rr_sfx_item_rocket_hit_1').length,1);
  checks.push({name:'火箭预选目标后先播放原准备和飞行，命中前不移除不扣数，命中才扣一次',passed:true});
  const replay=await harness();replay.debug.board.hammer('ring_1');
  await replay.debug.activate('restart');replay.tick(950);assert.equal(replay.debug.screen,'game');replay.tick(150);
  checks.push({name:'win动画延迟中重开不丢胜利',passed:replay.debug.save.mainLevel===2,actual:{mainLevel:replay.debug.save.mainLevel,totalScore:replay.debug.save.totalScore,screen:replay.debug.screen}});
  const guided=await harness();guided.tick(1000);
  assert.equal(guided.debug.tutorial.textKey,'Tutorial_Operation');
  const target=guided.debug.board.parts.find(part=>part.id==='ring_2'),framing=guided.debug.camera;
  const gx=(target.x-framing.x)*framing.scale+framing.cx,gy=(framing.y-target.y-1.75)*framing.scale+framing.cy;
  guided.pointer[0](gx,gy);guided.tick(5000);
  assert.equal(guided.debug.tutorial.pose(),null);assert.equal(guided.debug.tutorial.textKey,'');
  guided.pointer[2](gx,gy);guided.tick(2900);assert.equal(guided.debug.tutorial.pose(),null);
  guided.tick(200);assert.ok(guided.debug.tutorial.pose());
  checks.push({name:'真实控制器起手隐藏教程且松手三秒后重现',passed:true});
  const before=JSON.stringify(guided.debug.board.getSnapshot());
  guided.view={width:600,height:1200,ratio:1,safeArea:{top:108,bottom:1200}};guided.resize();
  assert.equal(guided.debug.camera.cx,300);assert.equal(guided.debug.camera.cy,600);
  assert.equal(JSON.stringify(guided.debug.board.getSnapshot()),before);
  checks.push({name:'视口和安全区变化后重新取景且保持关卡状态',passed:true});
  const previousY=guided.debug.camera.y;
  guided.view={...guided.view,safeArea:{top:148,bottom:1200}};guided.resize();
  assert.notEqual(guided.debug.camera.y,previousY);
  assert.equal(JSON.stringify(guided.debug.board.getSnapshot()),before);
  checks.push({name:'仅安全区变化也重新取景，不依赖屏幕尺寸改变',passed:true});
  const multi=await harness(null,false,true),multiBoard=multi.debug.board;
  assert.equal(multi.pointer,null);assert.equal(typeof multi.touch,'function');assert.equal(multi.debug.gestures.enabled,false);
  let downCalls=0,upCalls=0,moveCalls=0,selected=null;
  const rawDown=multiBoard.pointerDown,rawUp=multiBoard.pointerUp,rawMove=multiBoard.pointerMove;
  multiBoard.pointerDown=(...args)=>{downCalls++;selected=rawDown(...args);return selected;};
  multiBoard.pointerMove=(...args)=>{moveCalls++;return rawMove(...args);};
  multiBoard.pointerUp=(...args)=>{upCalls++;return rawUp(...args);};
  const first={id:1,...ringPoint(multi,'ring_2')},second={id:2,x:10,y:10},third={id:3,x:30,y:30},multiCamera=JSON.stringify(multi.debug.camera);
  const touch=(type,touches,changedTouches)=>multi.touch({type,touches,changedTouches});
  touch('start',[first],[first]);assert.ok(selected);assert.equal(downCalls,1);
  touch('start',[first,second],[second]);assert.equal(upCalls,1);assert.equal(multi.debug.gestures.suppressed,true);
  touch('move',[first,second],[first,second]);
  touch('end',[first],[second]);touch('move',[first],[first]);
  touch('start',[first,third],[third]);touch('end',[first],[third]);
  assert.equal(downCalls,1);assert.equal(moveCalls,0);assert.equal(upCalls,1);
  assert.equal(JSON.stringify(multi.debug.camera),multiCamera);
  touch('end',[],[first]);assert.equal(multi.debug.gestures.suppressed,false);
  touch('start',[first],[first]);assert.equal(downCalls,2);assert.ok(selected);
  touch('move',[first],[first]);assert.equal(moveCalls,1);
  touch('end',[],[first]);assert.equal(upCalls,2);
  checks.push({name:'全触点桥在默认镜头实验0下第二指仍终止拖动，余留单指和新加入手指均等到全抬起才重新接受',passed:true});
  const hidden=await harness(null,false,true),hiddenBoard=hidden.debug.board;
  let hiddenDowns=0,hiddenMoves=0,hiddenUps=0;
  const hiddenRawDown=hiddenBoard.pointerDown,hiddenRawMove=hiddenBoard.pointerMove,hiddenRawUp=hiddenBoard.pointerUp;
  hiddenBoard.pointerDown=(...args)=>{hiddenDowns++;return hiddenRawDown(...args);};
  hiddenBoard.pointerMove=(...args)=>{hiddenMoves++;return hiddenRawMove(...args);};
  hiddenBoard.pointerUp=(...args)=>{hiddenUps++;return hiddenRawUp(...args);};
  const hiddenFirst={id:1,...ringPoint(hidden,'ring_2')},hiddenSecond={id:2,x:10,y:10};
  hidden.touch({type:'start',touches:[hiddenFirst],changedTouches:[hiddenFirst]});hidden.hide();
  assert.equal(hiddenUps,1);assert.equal(JSON.stringify(hidden.saved.snapshot),JSON.stringify(hiddenBoard.getSnapshot()));
  hidden.touch({type:'move',touches:[hiddenFirst],changedTouches:[hiddenFirst]});
  hidden.touch({type:'end',touches:[],changedTouches:[hiddenFirst]});
  assert.equal(hiddenMoves,0);assert.equal(hiddenUps,1);
  hidden.touch({type:'start',touches:[hiddenFirst],changedTouches:[hiddenFirst]});assert.equal(hiddenDowns,2);
  hidden.touch({type:'start',touches:[hiddenFirst,hiddenSecond],changedTouches:[hiddenSecond]});
  assert.equal(hiddenUps,2);assert.equal(hidden.debug.gestures.suppressed,true);
  hidden.hide();assert.equal(hidden.debug.gestures.suppressed,false);
  hidden.touch({type:'start',touches:[hiddenFirst],changedTouches:[hiddenFirst]});assert.equal(hiddenDowns,3);
  hidden.touch({type:'end',touches:[],changedTouches:[hiddenFirst]});assert.equal(hiddenUps,3);
  checks.push({name:'onHide先断开单指拖动再保存，旧move/up不续拖；同时清除多指抑制以接受恢复后的新触点',passed:true});
  const chestSave=session.createSave();chestSave.chest.cycle=0;chestSave.chest.progress=session.chestThreshold(chestSave).count-1;
  const chest=await harness(chestSave);chest.debug.board.hammer('ring_1');chest.tick(2600);
  assert.equal(chest.debug.screen,'win');assert.ok(session.isChestClaimable(chest.debug.save));
  await chest.debug.activate('Btn_Next');assert.equal(chest.debug.screen,'win');
  chest.tick(1300);assert.equal(chest.debug.save.chest.cycle,1);assert.equal(chest.debug.modal,'claimReward');
  const inventory=JSON.stringify(chest.debug.save.props);
  await chest.debug.activate('btnClaim');assert.equal(JSON.stringify(chest.debug.save.props),inventory);
  chest.tick(1500);await chest.debug.activate('btnClaim');
  assert.equal(chest.debug.settlement.view().phase,'flying');
  const granted=JSON.stringify(chest.debug.save.props);
  await chest.debug.activate('btnClaim');assert.equal(JSON.stringify(chest.debug.save.props),granted);
  await chest.debug.activate('Btn_Next');assert.equal(chest.debug.screen,'win');
  chest.tick(650);assert.equal(chest.debug.modal,null);
  await chest.debug.activate('Btn_Next');assert.equal(chest.debug.screen,'game');
  checks.push({name:'满箱涨条后自动打开原领奖页，入场前禁领且飞回完成才解锁下一关',passed:true});
  const interrupted=await harness(chestSave);interrupted.debug.board.hammer('ring_1');interrupted.tick(3900);interrupted.hide();
  const resumed=await harness(interrupted.saved);assert.equal(resumed.debug.modal,'claimReward');
  assert.equal(resumed.debug.save.chest.cycle,1);assert.equal(session.pendingChestRewards(resumed.debug.save).length,1);
  resumed.tick(1600);await resumed.debug.activate('btnClaim');resumed.hide();
  const claimed=await harness(resumed.saved);assert.equal(claimed.debug.modal,null);
  assert.equal(session.pendingChestRewards(claimed.debug.save).length,0);
  assert.deepEqual(claimed.debug.save.props,resumed.saved.props);
  checks.push({name:'预约后重启补领奖，发奖后重启不重复发库存且不残留Next锁',passed:true});
  const beforeReservation=await harness(chestSave);beforeReservation.debug.board.hammer('ring_1');beforeReservation.tick(1600);beforeReservation.hide();
  const compensated=await harness(beforeReservation.saved);assert.equal(compensated.debug.modal,'claimReward');
  assert.equal(compensated.debug.save.chest.cycle,1);assert.equal(session.pendingChestRewards(compensated.debug.save).length,1);
  checks.push({name:'胜利已保存但满箱预约前中断，冷启动仍补发同轮奖励',passed:true});
  const homeSave=session.createSave();homeSave.mainLevel=2;
  const home=await harness(homeSave,true);assert.ok(home.debug.home);assert.equal(home.debug.screen,'home');
  await home.debug.activate('btnNormal');await home.debug.activate('btnNormal');
  home.tick(300);assert.equal(home.debug.screen,'home');
  home.tick(100);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(home.debug.screen,'game');assert.equal(home.sounds.filter(name=>name==='rr_sfx_round_start').length,1);
  checks.push({name:'主页真实关闭曲线结束后只进一次关卡，关闭过程中重复点击被挡',passed:true});
  // 此处仅核验真实控制器给原图标播放器/渲染器的桥接；桩不代表GPU绘制通过。
  const entrySave=session.createSave();entrySave.mainLevel=3;
  const entryHome=await harness(entrySave,true);entryHome.tick(50);
  entryHome.model.drawHomeEntry({},'firstwin',{x:0,y:0,w:192,h:192});
  assert.equal(entryHome.homeEntryDraws.at(-1).pose.animation,'idle');
  assert.equal(entryHome.homeEntryDraws.at(-1).pose.time,0);
  entryHome.tick(6100);entryHome.model.drawHomeEntry({},'rank',{x:0,y:0,w:192,h:192});
  assert.equal(entryHome.homeEntryDraws.at(-1).pose.animation,'show');
  entryHome.view.height=1100;entryHome.resize();assert.equal(entryHome.homeEntryResizes,1);
  await entryHome.debug.enterGame();entryHome.tick(50);
  await entryHome.debug.activate('home');entryHome.tick(50);
  entryHome.model.drawHomeEntry({},'firstwin',{x:0,y:0,w:192,h:192});
  assert.equal(entryHome.homeEntryDraws.at(-1).pose.animation,'setup');
  entryHome.tick(50);entryHome.model.drawHomeEntry({},'firstwin',{x:0,y:0,w:192,h:192});
  assert.equal(entryHome.homeEntryDraws.at(-1).pose.animation,'idle');assert.equal(entryHome.homeEntryDraws.at(-1).pose.time,0);
  checks.push({name:'真实主页控制器桥接首胜/排行轮播、视口resize及返回重置；渲染器为桩不表示GPU画面通过',passed:true});
  const firstSave=session.createSave();firstSave.mainLevel=4;
  const firstUnlock=await harness(firstSave);await firstUnlock.debug.enterGame();
  assert.equal(firstUnlock.debug.modal,'propUnlock');assert.equal(firstUnlock.debug.save.props[202],3);
  assert.equal(firstUnlock.debug.save.pendingPropIntro.grantCount,3);firstUnlock.hide();
  const unlockReload=await harness(firstUnlock.saved);await unlockReload.debug.enterGame();
  assert.equal(unlockReload.debug.modal,'propUnlock');assert.equal(unlockReload.debug.save.props[202],3);
  await unlockReload.debug.activate('MaskBtn');unlockReload.tick(2010);
  assert.equal(unlockReload.debug.modal,'propUnlock');assert.deepEqual(unlockReload.debug.save.pendingFreeProps,{});
  unlockReload.tick(20);assert.equal(unlockReload.debug.modal,'propGuide');assert.equal(unlockReload.model.propGuide.stage,'tip');
  assert.equal(unlockReload.debug.save.pendingFreeProps[202],1);assert.equal(unlockReload.debug.props.actions.length,0);
  await unlockReload.debug.activate('BtnUse');assert.equal(unlockReload.debug.props.actions.length,0);
  await unlockReload.debug.activate('GuidePropConfirm');assert.equal(unlockReload.debug.props.actions.length,0);
  await unlockReload.debug.activate('BtnUse');assert.equal(unlockReload.debug.props.actions.length,1);
  const freeAction=unlockReload.debug.props.actions[0];unlockReload.tick(freeAction.hitAt*1000+20);
  assert.equal(unlockReload.debug.save.props[202],3);assert.equal(unlockReload.debug.save.pendingFreeProps[202],undefined);
  assert.ok(unlockReload.debug.save.usedProps.includes(202));
  checks.push({name:'解锁展示前送三件且重载不重发，三粒回飞约2.02秒后开首次引导，确认后免费命中保留三件库存',passed:true});
  const firstGuide=await harness();unlockProp(firstGuide,202);firstGuide.debug.save.guidedProps=[];firstGuide.debug.save.guideInteractedProps=[];
  await firstGuide.debug.activate('prop:202');firstGuide.tick(1);
  assert.equal(firstGuide.debug.modal,'propGuide');assert.equal(firstGuide.model.propGuide.stage,'tip');
  await firstGuide.debug.activate('BtnUse');assert.equal(firstGuide.debug.props.actions.length,0);
  await firstGuide.debug.activate('GuidePropConfirm');firstGuide.tick(1);
  assert.equal(firstGuide.model.propGuide.stage,'ready');assert.equal(firstGuide.debug.props.actions.length,0);
  await firstGuide.debug.activate('Mask');firstGuide.tick(350);
  assert.equal(firstGuide.debug.modal,null);assert.equal(firstGuide.debug.save.props[202],2);
  assert.ok(firstGuide.debug.save.guideInteractedProps.includes(202));assert.deepEqual(firstGuide.debug.save.pendingFreeProps,{});
  checks.push({name:'库存火箭首次提示确认只切阶段，Mask取消不发射不扣数，也不凭未使用记录送免费',passed:true});
  const cancelled=await harness();unlockProp(cancelled,201);cancelled.debug.save.guideInteractedProps=[];
  await cancelled.debug.activate('prop:201');await cancelled.debug.activate('close');cancelled.tick(350);
  assert.equal(cancelled.debug.save.props[201],2);assert.ok(cancelled.debug.save.guideInteractedProps.includes(201));
  checks.push({name:'非首次锤子取消同样标记真实互动且不扣库存',passed:true});
  const empty=await harness();unlockProp(empty,202);empty.debug.save.props[202]=0;
  await empty.debug.activate('prop:202');assert.equal(empty.debug.modal,null);assert.equal(empty.debug.props.actions.length,0);
  assert.equal(empty.toasts.at(-1),empty.debug.config.text.Ads_NoNetwork_Desc_1);assert.equal(empty.debug.save.props[202],0);
  checks.push({name:'零库存点击走原广告失败离线提示，不弹库存引导或金币购买窗口',passed:true});
  const popup=await harness();await popup.debug.activate('setting');await popup.debug.activate('howtoplay');
  assert.equal(popup.debug.modal,'howtoplay');await popup.debug.activate('btnFinish');assert.equal(popup.debug.modal,'settings');
  await popup.debug.activate('language');assert.equal(popup.debug.modal,'language');await popup.debug.activate('close');assert.equal(popup.debug.modal,null);
  await popup.debug.activate('home');await popup.debug.activate('setting');await popup.debug.activate('about');
  assert.equal(popup.debug.modal,'about');await popup.debug.activate('close');assert.equal(popup.debug.modal,'settings');
  checks.push({name:'设置上打开教程或关于关闭后回父设置，语言替换设置后关闭直接回基础画面',passed:true});
  const winAudio=await harness();winAudio.debug.board.hammer('ring_1');winAudio.tick(1100);
  assert.equal(winAudio.debug.screen,'win');
  for(const name of ['rr_sfx_level_complete','rr_vo_complete_squirrel']) assert.equal(winAudio.sounds.filter(sound=>sound===name).length,1);
  winAudio.tick(5000);winAudio.hide();
  for(const name of ['rr_sfx_level_complete','rr_vo_complete_squirrel']) assert.equal(winAudio.sounds.filter(sound=>sound===name).length,1);
  const winAudioReload=await harness(winAudio.saved);
  for(const name of ['rr_sfx_level_complete','rr_vo_complete_squirrel']) assert.equal(winAudioReload.sounds.filter(sound=>sound===name).length,0);
  checks.push({name:'胜利入口仅发一次原通关效果音和松鼠随机事件，连续帧与重启不重复发',passed:true});
  const muted=await harness();await muted.debug.activate('sound');
  assert.equal(muted.debug.save.settings.sound,false);assert.deepEqual(muted.muteCalls,[true]);
  await muted.debug.activate('sound');assert.equal(muted.debug.save.settings.sound,true);assert.deepEqual(muted.muteCalls,[true,false]);
  checks.push({name:'声音开关当场调用音频层静音与解除静音，并同步保存设置',passed:true});
  const ratchet=await harness(), ratchetRing=ratchet.debug.board.parts.find(part=>part.id==='ring_2'), ratchetCamera=ratchet.debug.camera;
  const ratchetPoint=angle=>({x:(ratchetRing.x+Math.sin(angle*Math.PI/180)*1.8-ratchetCamera.x)*ratchetCamera.scale+ratchetCamera.cx,y:(ratchetCamera.y-ratchetRing.y-Math.cos(angle*Math.PI/180)*1.8)*ratchetCamera.scale+ratchetCamera.cy});
  const ratchetStart=ratchetPoint(0);ratchet.pointer[0](ratchetStart.x,ratchetStart.y);
  const ratchetInitial=ratchetRing.rotationDeg;
  for(let angle=2;angle<=14;angle+=2){ratchet.tick(50);const point=ratchetPoint(angle);ratchet.pointer[1](point.x,point.y);}
  assert.ok(Math.abs(ratchetRing.rotationDeg-ratchetInitial)>13.9);
  assert.equal(ratchet.sounds.filter(name=>name==='rr_sfx_ring_ratchet_click').length,0);
  ratchet.tick(50);const ratchetThreshold=ratchetPoint(16);ratchet.pointer[1](ratchetThreshold.x,ratchetThreshold.y);
  assert.ok(Math.abs(ratchetRing.rotationDeg-ratchetInitial)>15.9);
  assert.equal(ratchet.sounds.filter(name=>name==='rr_sfx_ring_ratchet_click').length,1);
  const stopsBeforeRelease=ratchet.soundStops.length;ratchet.pointer[2](ratchetThreshold.x,ratchetThreshold.y);
  assert.equal(ratchet.soundStops.length,stopsBeforeRelease+1);assert.equal(ratchet.soundStops.at(-1),'rr_sfx_ring_ratchet_click');
  checks.push({name:'实际指针拖原首关圆环未满15度不发棘轮，越过阈值只发一次且松手立即停止',passed:true});
  const legacyTheme=session.createSave();legacyTheme.mainLevel=4;delete legacyTheme.themeId;
  const theme=await harness(legacyTheme);unlockProp(theme,201);await theme.debug.enterGame();theme.tick(50);
  assert.equal(theme.model.themeId,0);
  const partState=()=>JSON.stringify(theme.debug.board.parts.map(p=>[p.id,p.x,p.y,p.rotationDeg,p.solved]));
  const beforeTheme=partState();await theme.debug.activate('BtnTheme');
  assert.equal(theme.debug.save.themeId,1);assert.equal(theme.saved.themeId,1);assert.equal(partState(),beforeTheme);
  theme.hide();const themeRestored=await harness(JSON.parse(JSON.stringify(theme.saved)));await themeRestored.debug.enterGame();themeRestored.tick(50);
  assert.equal(themeRestored.model.themeId,1);await themeRestored.debug.activate('BtnTheme');assert.equal(themeRestored.saved.themeId,0);
  checks.push({name:'旧存档默认日间，昼夜切换持久化并在JSON重启后恢复，不移动圆环或改变物理状态',passed:true});
  const result={appPath,checks};
  fs.writeFileSync(path.join(__dirname,'controller-review-results.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
  if(checks.some(check=>!check.passed)) process.exitCode=1;
}
module.exports = { harness, ringPoint };
if (require.main === module) main().catch(error=>{console.error(error);process.exitCode=1;});
