'use strict';
// 仅原固定种子Trail的Windows有限首态后轨迹与环队列；渲染宽度/颜色与ARM等价仍未证明。
const trailLinear=(()=>{
const {fromBits}=require('./unity-noise-medium');
const unit=fromBits(0x34000001);
function axisRandom(seed){
 let a=(seed+0xe0fbd834)>>>0,b=(Math.imul(a,0x6c078965)+1)>>>0,c=(Math.imul(b,0x6c078965)+1)>>>0,d=(Math.imul(c,0x6c078965)+1)>>>0;
 const output=[];for(let i=0;i<3;i++){const t=(a^(a<<11))>>>0;[a,b,c]=[b,c,d];d=(d^(d>>>19)^t^(t>>>8))>>>0;output.push(f((d&0x7fffff)*unit));}return output;
}

const f=Math.fround,add=(a,b)=>f(f(a)+f(b)),sub=(a,b)=>f(f(a)-f(b)),mul=(a,b)=>f(f(a)*f(b)),div=(a,b)=>f(f(a)/f(b));

// 同版CalculateCacheData e56486..e56513逐项F32构系数，随后BuildOptimizedCurve e563f0..e56405整体乘scalar。
function coefficients(p,q,scalar){
 const dt=Math.max(f(.0001),sub(q.time,p.time)),inverse=div(1,dt),inverse2=mul(inverse,inverse);
 const difference=sub(q.value,p.value),left=mul(p.outSlope,dt),right=mul(q.inSlope,dt);
 const a=mul(mul(sub(sub(add(right,left),difference),difference),inverse2),inverse);
 const b=mul(sub(sub(sub(add(add(difference,difference),difference),left),left),right),inverse2);
 return [a,b,p.outSlope,p.value].map(v=>mul(v,scalar));
}

function optimizedCurve(source,scalar,time){
 const keys=source.m_Curve;
 if(keys.length<2||keys.length>3||keys[0].time!==0||keys.at(-1).time!==1||keys.some(k=>k.weightedMode!==0))throw Error('仅覆盖原Trail的两段以内无权重曲线');
 const interval=keys.length===3&&Math.min(time,f(.99999))>=keys[1].time?1:0;
 const [a,b,c,d]=coefficients(keys[interval],keys[interval+1],scalar),t=sub(time,keys[interval].time);
 return add(mul(add(mul(add(mul(a,t),b),t),c),t),d);
}

function linearVelocity(module,seed,agePercent){
 const random=axisRandom(seed),time=mul(.01,agePercent);
 return ['x','y','z'].map((axis,index)=>{
  const c=module[axis];if(c.minMaxState!==2)throw Error('仅覆盖原Trail的TwoCurves');
  const low=optimizedCurve(c.minCurve,c.scalar,time),high=optimizedCurve(c.maxCurve,c.scalar,time);
  return add(mul(sub(high,low),random[index]),low);
 });
}
return {linearVelocity};
})();
const trailOrbit=(()=>{
const {fromBits,dampingFactor}=require('./unity-noise-medium');
const f=Math.fround,add=(a,b)=>f(f(a)+f(b)),sub=(a,b)=>f(f(a)-f(b)),mul=(a,b)=>f(f(a)*f(b)),div=(a,b)=>f(f(a)/f(b));

// 21f2e04..3073的专用sin/cos多项式，不能替换成Math.sin；只先覆盖原1/240与常量轨道角速率1。
function polynomial(r){
 const r2=mul(r,r),r4=mul(r2,r2),r8=mul(r4,r4);
 const low=add(mul(fromBits(0xc2255ddc),r2),fromBits(0x40c90fda));
 const high=mul(add(mul(fromBits(0xc2992322),r2),fromBits(0x42a33422)),r4);
 return mul(add(add(high,low),mul(r8,fromBits(0x421ea0cd))),r);
}
function originalSinCosSmall(theta){
 const t=mul(theta,fromBits(0x3e22f983));if(Math.abs(t)>=.25)throw Error('未批准大角度CVTPS2DQ范围');
 return {cos:polynomial(sub(.25,Math.abs(t))),sin:polynomial(sub(.25,Math.abs(sub(t,.25))))};
}
function originalOrbitAndRadial(position,dt,estimateBits){
 if(dt!==f(1/240))throw Error('仅原240Hz诊断');
 const {cos:cx,sin:sx}=originalSinCosSmall(dt),cy=cx,sy=sx,cz=cx,sz=sx;
 // 21f30a2..321e，原ZXY矩阵及逐项相加顺序；本候选先假设原Local→Local矩阵为单位阵、offset为0。
 const m00=add(mul(mul(sy,sx),sz),mul(cy,cz)),m01=sub(mul(mul(sx,cz),sy),mul(sz,cy)),m02=mul(sy,cx);
 const m10=mul(sz,cx),m11=mul(cx,cz),m12=f(-sx);
 const m20=add(mul(f(-cz),sy),mul(mul(sx,cy),sz)),m21=add(mul(mul(cy,cz),sx),mul(sy,sz)),m22=mul(cx,cy);
 const [x,y,z]=position;
 const rotated=[add(add(mul(m01,y),mul(m02,z)),mul(m00,x)),add(add(mul(m11,y),mul(m12,z)),mul(m10,x)),add(add(mul(m21,y),mul(m22,z)),mul(m20,x))];
 const l2=add(add(mul(rotated[1],rotated[1]),mul(rotated[2],rotated[2])),mul(rotated[0],rotated[0])),inverse=div(1,f(Math.sqrt(l2)));
 const radialDistance=mul(dt,2),reciprocal=dampingFactor(dt,true,estimateBits).factor;
 return rotated.map((v,i)=>mul(sub(add(v,mul(radialDistance,l2>1e-30?mul(v,inverse):0)),position[i]),reciprocal));
}
return {originalOrbitAndRadial};
})();
const trailTrajectory=(()=>{
const {noiseMediumSingle,originalUnlockScrollSpeedCandidate,advanceScroll,fromBits}=require('./unity-noise-medium');
const {linearVelocity}=trailLinear,{originalOrbitAndRadial}=trailOrbit;
function gravityRandom(seed) {
  let a = (seed + 0xe2b7c3c3) >>> 0, b = (Math.imul(a,0x6c078965)+1)>>>0;
  let c = (Math.imul(b,0x6c078965)+1)>>>0, d = (Math.imul(c,0x6c078965)+1)>>>0;
  const t = (a ^ (a << 11))>>>0, word = (d ^ (d>>>19) ^ t ^ (t>>>8))>>>0;
  return mul(word & 0x7fffff, fromBits(0x34000001));
}


const f=Math.fround,add=(a,b)=>f(f(a)+f(b)),sub=(a,b)=>f(f(a)-f(b)),mul=(a,b)=>f(f(a)*f(b)),div=(a,b)=>f(f(a)/f(b));
function limitRandom(seed){
 let a=(seed+0x13371337)>>>0,b=(Math.imul(a,0x6c078965)+1)>>>0,c=(Math.imul(b,0x6c078965)+1)>>>0,d=(Math.imul(c,0x6c078965)+1)>>>0;
 const t=(a^(a<<11))>>>0,word=(d^(d>>>19)^t^(t>>>8))>>>0;
 return mul(word&0x7fffff,fromBits(0x34000001));
}
function createTrajectory(fixture,noiseEnabled){
 if(fixture.caseId!=='boom01-trail'||fixture.systemSeed!==2277688484||fixture.dt!==f(1/240))throw Error('仅覆盖原固定Trail种子与240Hz');
 const config=fixture.config,dt=fixture.dt,clamp=config.ClampVelocityModule,gravity=config.InitialModule.gravityModifier;
 const particles=fixture.firstObserved[noiseEnabled?'on':'off'].map(row=>({...row,position:row.position.slice(),velocity:row.velocity.slice(),agePercent:mul(mul(dt,100),row.inverseLifetime)}));
 let liveOrder=particles.slice();
 let systemTime=fixture.firstClock[noiseEnabled?'on':'off'].systemTime,scroll=fixture.firstClock[noiseEnabled?'on':'off'].noiseScroll;
 const gravityDt=mul(mul(fixture.gravityY,dt),fixture.inverseSimulationScale),dampen=sub(1,f(Math.pow(sub(1,clamp.dampen),mul(Math.abs(dt),30))));
 function step(){
  systemTime=add(systemTime,dt);
  if(noiseEnabled&&liveOrder.length)scroll=advanceScroll(scroll,originalUnlockScrollSpeedCandidate(div(systemTime,fixture.duration)),dt);
  const states=new Map(particles.filter(p=>p.agePercent<100).map(p=>{
   const linear=linearVelocity(config.VelocityModule,p.randomSeed,p.agePercent),orbit=originalOrbitAndRadial(p.position,dt,0x43700000);
   const field=noiseEnabled?noiseMediumSingle({position:p.position,systemSeed:fixture.systemSeed,frequency:.5,scroll,strength:2,damping:true,rcppsEstimateBits:0x3ffff000}).animatedVelocityContribution:[0,0,0];
   const animated=linear.map((v,i)=>add(add(v,orbit[i]),field[i]));
   const modifier=add(mul(sub(gravity.scalar,gravity.minScalar),gravityRandom(p.randomSeed)),gravity.minScalar);
   p.velocity[1]=add(p.velocity[1],mul(gravityDt,modifier));
   const before=p.velocity.map((v,i)=>add(v,animated[i])),lengthSq=add(add(mul(before[1],before[1]),mul(before[2],before[2])),mul(before[0],before[0]));
   const length=f(Math.sqrt(lengthSq)),inverse=div(1,length),maximum=add(mul(sub(clamp.magnitude.scalar,clamp.magnitude.minScalar),limitRandom(p.randomSeed)),clamp.magnitude.minScalar);
   const limited=length>maximum?add(mul(sub(maximum,length),dampen),length):length;
   p.velocity=before.map((v,i)=>sub(mul(limited,lengthSq>1e-30?mul(v,inverse):0),animated[i]));
   const total=p.velocity.map((v,i)=>add(v,animated[i]));
   p.position=p.position.map((v,i)=>add(v,mul(total[i],dt)));
   p.agePercent=add(p.agePercent,mul(mul(dt,100),p.inverseLifetime));
   return [p.randomSeed,{randomSeed:p.randomSeed,position:p.position.slice(),velocity:p.velocity.slice(),animatedVelocity:animated,totalVelocity:total,agePercent:p.agePercent,inverseLifetime:p.inverseLifetime}];
  }));
  // 原密集粒子数组死亡时由末粒补空；TrailModule::Update按当前数组下标更新环槽。
  for(let i=0;i<liveOrder.length;){if(liveOrder[i].agePercent>=100){liveOrder[i]=liveOrder.at(-1);liveOrder.pop();}else i++;}
  return liveOrder.map(p=>states.get(p.randomSeed));
 }
 return {step,get systemTime(){return systemTime;},get scroll(){return scroll;}};
}
return {createTrajectory};
})();
const trailRings=(()=>{
const {createTrajectory}=trailTrajectory;
const f=Math.fround,add=(a,b)=>f(f(a)+f(b)),sub=(a,b)=>f(f(a)-f(b)),mul=(a,b)=>f(f(a)*f(b)),div=(a,b)=>f(f(a)/f(b));

// 同版TrailModule::Update 209f110..209f6ad：独立double时钟、保留过期边界前一点、全局容量翻倍及F32累计路长。
function createTrailModel(fixture,noiseEnabled){
 const key=noiseEnabled?'on':'off',model=createTrajectory(fixture,noiseEnabled),initial=fixture.firstTrail[key];
 const rings=fixture.firstObserved[key].map((p,i)=>({points:[initial.positions.slice(i*4,i*4+4)],front:0,back:0,textureOffset:initial.textureOffsets[i]}));
 let capacity=4,stepIndex=1,previousOrder=fixture.firstObserved[key].map(p=>p.randomSeed);
 function grow(){capacity*=2;for(const ring of rings){ring.back=0;ring.front=ring.points.length-1;}}
 function step(){
  const particles=model.step();stepIndex++;const now=stepIndex*fixture.dt;
  // 死亡数组补空时，原ParticleSystemParticles连同对应Trail环整行复制；未使用的源槽仍保留其旧内容。
  for(let i=0;i<particles.length;i++)if(particles[i].randomSeed!==previousOrder[i]){
   const from=previousOrder.indexOf(particles[i].randomSeed),source=rings[from];
   rings[i]={points:source.points.map(p=>p.slice()),front:source.front,back:source.back,textureOffset:source.textureOffset};
  }
  previousOrder=particles.map(p=>p.randomSeed);
  for(let i=0;i<particles.length;i++){
   const p=particles[i],ring=rings[i],lifetime=div(fixture.trailLifetimeFraction,p.inverseLifetime);
   while(ring.points.length>1&&now-ring.points[1][3]>lifetime){ring.points.shift();ring.back=(ring.back+1)%capacity;}
   if(ring.points.length===1&&now-ring.points[0][3]>lifetime){ring.points.shift();ring.back=(ring.back+1)%capacity;ring.textureOffset=0;}
   if(ring.points.length===capacity)grow();
   if(ring.points.length){const previous=ring.points.at(-1),d=p.position.map((v,axis)=>sub(previous[axis],v)),squared=d.map(v=>mul(v,v));ring.textureOffset=add(f(Math.sqrt(add(add(squared[0],squared[1]),squared[2]))),ring.textureOffset);}
   ring.front=(ring.front+1)%capacity;ring.points.push([...p.position,f(now)]);
  }
  return {particles,rings,capacity,systemTime:model.systemTime,noiseScroll:model.scroll};
 }
 return {step,get rings(){return rings;},get capacity(){return capacity;},get stepIndex(){return stepIndex;},get systemTime(){return model.systemTime;},get scroll(){return model.scroll;}};
}
return {createTrailModel};
})();

const fixture=require('../assets/unlock-effects/fixed-trail-first-state');
const FIXED_TRAIL_NAME='eff_UIPropUnlock_boom_01/ui_1/caidai_tuowei',STEP=1/240;

function supportsFixedTrail(action,d){
 return action.kind==='unlock'&&d.name===FIXED_TRAIL_NAME&&!d.autoSeed&&(d.seed>>>0)===fixture.systemSeed;
}

function createFixedTrailSystem(d,born,sampleRoot){
 const particles=fixture.firstObserved.on.map(row=>({d,born,lifetime:row.startLifetime,randomSeed:row.randomSeed,
  position:row.position.slice(),velocity:row.velocity.slice(),size:row.startSize3D.slice(),rotation:row.rotationRadians.slice(),
  color:row.startColor32.map(v=>v/255),random:Array(12).fill(0),simulated:STEP,
  root:sampleRoot?sampleRoot(born,d):null,history:[],fixedTrail:true,fixedTrailVisible:false,
  animatedVelocity:row.animatedVelocity.slice(),totalVelocity:row.totalVelocity.slice()}));
 let model=trailRings.createTrailModel(fixture,true),currentStep=1,currentStates=fixture.firstObserved.on;
 function assign(states){
  const indexed=new Map(states.map((p,index)=>[p.randomSeed,{p,index}]));
  for(const p of particles){const row=indexed.get(p.randomSeed);p.fixedTrailVisible=!!row;if(!row)continue;
   p.position=row.p.position.slice();p.velocity=row.p.velocity.slice();p.animatedVelocity=row.p.animatedVelocity.slice();p.totalVelocity=row.p.totalVelocity.slice();p.simulated=currentStep*STEP;
   const ring=model.rings[row.index];
   // 只把原生活动环按时间顺序交给现有Trail几何；不再以整段历史二次过滤、追加或插值。
   p.history=ring.points.map(point=>[point[3],...point.slice(0,3)]);
   p.fixedTrailRing={front:ring.front,back:ring.back,count:ring.points.length,capacity:model.capacity,textureOffset:ring.textureOffset};
  }
 }
 function sample(age){
  const step=Math.floor((age-born)/STEP+1e-7);
  if(step<1||step>480){for(const p of particles)p.fixedTrailVisible=false;return;}
  if(step<currentStep){model=trailRings.createTrailModel(fixture,true);currentStep=1;currentStates=fixture.firstObserved.on;}
  while(currentStep<step){const result=model.step();currentStates=result.particles;currentStep++;}
  assign(currentStates);
 }
 return {particles,sample};
}
module.exports={supportsFixedTrail,createFixedTrailSystem};
