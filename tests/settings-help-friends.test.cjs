const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),uiRoot=process.env.RR_UI_BASELINE||root;
const {createUI}=require(path.join(uiRoot,'src/ui'));
const data=require(path.join(root,'assets/ui/ui-data-packed'));
const {sampleHelpNode,sampleCurve}=require(path.join(root,'src/help-animation'));
const clips=require(path.join(root,'assets/ui/help-animation-data'));
const {harness}=require('./controller-integration.cjs');
const {createFriendBoard}=require(path.join(root,'src/friend-board'));
function capture(screen,model){
  const images=[],state={globalAlpha:1},stack=[];
  const ctx=new Proxy(state,{get:(target,k)=>k==='save'?()=>stack.push({...state}):k==='restore'?()=>Object.assign(state,stack.pop()):k==='drawImage'?(image,...args)=>images.push({path:image.path,args}):k==='measureText'?s=>({width:String(s).length*28}):k==='getTransform'?()=>({a:1,b:0,c:0,d:1,e:0,f:0}):k in target?target[k]:()=>{}});
  const ui=createUI({canvas:{},ctx,width:390,height:844,loadImage:file=>({path:file})});
  ui.draw(screen,{level:12,settings:{},props:{},unlockedProps:[],...model});
  const hits={};for(let y=0;y<844;y+=4)for(let x=0;x<390;x+=4){let key=ui.hit(x,y);if(key&&!hits[key])hits[key]={x,y};}
  return {ui,images,hits};
}
test('设置音乐音效震动的八种状态均保留三按钮命中，只切换开关图片',()=>{
  for(const screen of ['home','game'])for(let mask=0;mask<8;mask++){
    const settings={music:!!(mask&1),sound:!!(mask&2),vibration:!!(mask&4)};
    const view=capture(screen,{modal:'settings',settings});
    for(const field of ['music','sound','vibration']){
      assert(Object.keys(view.hits).some(name=>name.toLowerCase().includes(field.slice(0,5))),`${screen} ${field} ${mask}按钮必须仍可点击`);
      const expected=`common_btn_settings_${field}${settings[field]?'':'_disabled'}.png`;
      assert(view.images.some(image=>image.path.endsWith('/'+expected)),`${screen} ${field} ${mask}关闭图片必须可见`);
      const hidden=`common_btn_settings_${field}${settings[field]?'_disabled':''}.png`;
      assert(!view.images.some(image=>image.path.endsWith('/'+hidden)));
    }
  }
});
test('三页教程均显示在可视区，下一步和完成按钮可点击',()=>{
  for(let page=1;page<=3;page++){
    const view=capture('home',{modal:'howtoplay',howToPlayPage:page,helpAge:.7});
    const demo=view.images.filter(image=>/game_demo_screenshot/.test(image.path));assert(demo.length>1,`第${page}页不能空白`);
    for(const image of demo){const [x,y,w,h]=image.args.length===8?image.args.slice(4):image.args;assert(x>=0&&x+w<=1081,`第${page}页演示不得停在画布外`);}
    assert(Object.keys(view.hits).some(key=>page===3?/complete|finish/i.test(key):/next/i.test(key)));
  }
});
test('原教程关键帧阶跃、透明度、旋转、拖动和循环保持有效',()=>{
  assert.equal(sampleCurve([[0,1,null,null],[1,0,null,null]],.9),1);assert.equal(sampleCurve([[0,1,null,null],[1,0,null,null]],1),0);
  const nodes=Object.fromEntries(data.templates.howtoplay_uihowtoplayview.nodes.map(node=>[node.id,node]));
  for(let page=1;page<=3;page++){
    let changed=0,active=0;
    for(const node of Object.values(nodes)){
      const a=sampleHelpNode(node,nodes,page,.2),b=sampleHelpNode(node,nodes,page,.8);
      if(a&&b&&JSON.stringify(a)!==JSON.stringify(b))changed++;
      if(a?.active)active++;
      if(a)assert.deepEqual(a,sampleHelpNode(node,nodes,page,.2+clips[page-1].duration));
    }
    assert(changed>=2,`第${page}页至少两个节点运动`);assert(active>0);
  }
});
test('主页好友榜入口不再显示解锁关数，原闯关按钮仍保留',()=>{
  const view=capture('home',{friendRanking:true,rankUnlocked:true,showRank:true});
  assert(view.hits.RankList);assert(view.hits.btnOK);
});
test('本次工程没有重新引入倒计时或超时失败',()=>{
  const app=fs.readFileSync(path.join(root,'src/app.js'),'utf8');
  assert(!/timedRun|timeBonus|modal = 'timeout'/.test(app));
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'game.json'))).openDataContext,'open-data');
});
test('控制器开关存档可恢复，三页翻页复位动画，关闭教程返回设置，主页排行直接打开好友榜',async()=>{
  const h=await harness();await h.debug.activate('setting');
  for(const key of ['btn_Music','btn_Sound','btn_Vibration'])await h.debug.activate(key);
  assert.deepEqual(h.debug.save.settings,{music:false,sound:false,vibration:false});
  const restored=await harness(h.saved);assert.deepEqual(restored.debug.save.settings,h.debug.save.settings);
  await h.debug.activate('btnHowToPlay');h.tick(600);assert.equal(h.model.howToPlayPage,1);assert(h.model.helpAge>.5);
  await h.debug.activate('BtnNextFirst');h.tick(50);assert.equal(h.model.howToPlayPage,2);assert(h.model.helpAge<.1);
  await h.debug.activate('BtnNextMid');h.tick(50);assert.equal(h.model.howToPlayPage,3);
  await h.debug.activate('BtnCompletePage');assert.equal(h.debug.modal,'settings');await h.debug.activate('BtnClose');
  await h.debug.activate('RankListLocked');assert.equal(h.debug.modal,'friends');await h.debug.activate('friendsClose');assert.equal(h.debug.modal,null);
});
test('好友授权前不提交分数，拒绝后保留本地，刷新重试成功才读取开放域',async()=>{
  let allow=false;const messages=[],canvas={};
  const board=createFriendBoard({requirePrivacyAuthorize:o=>allow?o.success():o.fail(),getOpenDataContext:()=>({canvas,postMessage:m=>messages.push(m)})});
  board.sync(400);assert.equal(messages.length,0);assert.equal(await board.open(),false);assert.equal(messages.length,0);
  allow=true;await board.refresh();assert.deepEqual(messages.map(m=>m.type),['score','show']);assert.equal(messages[0].score,400);
  assert.equal(canvas.width,652);assert.equal(canvas.height,760);board.close();assert.equal(board.draw({},{}),false);
});
test('开放域累计成绩保持云端最高值，只显示真实好友并排序，空列表不生成虚假记录',()=>{
  let receive;const writes=[],text=[],ctx=new Proxy({},{get:(_,key)=>key==='fillText'?value=>text.push(value):()=>{},set:()=>true});
  const friends=[{openid:'a',nickname:'好友甲',KVDataList:[{key:'rr_classic_total_v1',value:'900'}]},{openid:'b',nickname:'好友乙',KVDataList:[{key:'rr_classic_total_v1',value:'600'}]},{nickname:'无成绩好友',KVDataList:[]}];
  const api={getSharedCanvas:()=>({getContext:()=>ctx}),onMessage:f=>receive=f,getUserCloudStorage:o=>o.success({KVDataList:[{key:'rr_classic_total_v1',value:'700'}]}),setUserCloudStorage:o=>{writes.push(o.KVDataList);o.success({});},getFriendCloudStorage:o=>o.success({data:friends})};
  vm.runInNewContext(fs.readFileSync(path.join(root,'open-data/index.js'),'utf8'),{wx:api,console});
  receive({type:'score',score:400});assert.equal(writes[0][0].value,'700');receive({type:'show'});
  assert(text.indexOf('好友甲')<text.indexOf('好友乙'));assert(!text.includes('无成绩好友'));
  friends.length=0;receive({type:'show'});assert(text.includes('暂无好友成绩，邀请好友一起挑战吧'));
});
