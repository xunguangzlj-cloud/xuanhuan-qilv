'use strict';
// 给定非零systemSeed的原boom02完整出生与240Hz轨迹；原auto种子来源、ARM及最终渲染等价未证。
const parameters=require('../assets/unlock-effects/auto-boom02-parameters');
const birthRand=(()=>{
const {fromBits}=require('./unity-noise-medium');
const f=Math.fround,unit=fromBits(0x34000001);

// InitialModule::ResetSeed209b8e0→RandN::SetSeed e69e30：4条lane各加0x16f，非单状态XorShift32。
function initialState(seed){
 const state=Array.from({length:4},()=>[]);
 for(let lane=0;lane<4;lane++){
  let value=(seed+367*lane)>>>0;state[0].push(value);
  for(let word=1;word<4;word++){value=(Math.imul(value,0x6c078965)+1)>>>0;state[word].push(value);}
 }
 return state;
}
function next(state){
 const result=[];
 for(let lane=0;lane<4;lane++){
  const a=state[0][lane],d=state[3][lane],t=(a^(a<<11))>>>0;
  const word=(d^(d>>>19)^t^(t>>>8))>>>0;
  for(let i=0;i<3;i++)state[i][lane]=state[i+1][lane];state[3][lane]=word;result.push(word);
 }
 return result;
}
function randomFloat(words){return words.map(word=>f((word&0x7fffff)*unit));}
function twoConstants(curve,r){return f(f(f(curve.scalar-curve.minScalar)*r)+curve.minScalar);}

return {initialState,next,randomFloat};
})();
const curveCache=(()=>{

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

return {optimizedCurve};
})();
const initialBirth=(()=>{
const {initialState,next,randomFloat}=birthRand;
const f=Math.fround,lerp=(curve,r)=>f(f(f(curve.scalar-curve.minScalar)*r)+curve.minScalar);

// 原Initial SIMD循环每个批次推进整4lane；不足4粒的末批只写有效lane，随机状态仍整组推进。
function initialBatches(seed,initial,count){
 if(count<1||!Number.isInteger(count)||initial.size3D)throw Error('本候选仅覆盖原非3D尺寸的明确批次数');
 const state=initialState(seed),output=[],gradient=initial.startColor.maxGradient;
 if(initial.startColor.minMaxState!==4||gradient.m_Mode!==1)throw Error('仅原RandomColor阶跃梯度');
 const alpha=gradient.key0.a;
 if(!Array.from({length:gradient.m_NumAlphaKeys},(_,i)=>gradient['key'+i].a).every(a=>a===alpha))throw Error('仅原常量alpha');
 for(let base=0;base<count;base+=4){
  const seeds=next(state),life=randomFloat(next(state)),size=randomFloat(next(state)),rz=randomFloat(next(state));
  const rx=initial.rotation3D?randomFloat(next(state)):Array(4).fill(0),ry=initial.rotation3D?randomFloat(next(state)):Array(4).fill(0),color=randomFloat(next(state));
  for(let lane=0;lane<4&&base+lane<count;lane++){
   let key=gradient.m_NumColorKeys-1;for(let i=0;i<gradient.m_NumColorKeys;i++)if(color[lane]<=gradient['ctime'+i]/65535){key=i;break;}
   const c=gradient['key'+key];output.push({birth:base+lane,lane,particleSeed:seeds[lane],rawLifetime:lerp(initial.startLifetime,life[lane]),startSize:lerp(initial.startSize,size[lane]),
    rotation:initial.rotation3D?[lerp(initial.startRotationX,rx[lane]),lerp(initial.startRotationY,ry[lane]),lerp(initial.startRotation,rz[lane])]:[0,0,lerp(initial.startRotation,rz[lane])],
    color32:[...['r','g','b'].map(axis=>Math.round(f(c[axis]*255))),Math.round(f(alpha*255))]});
  }
 }
 return output;
}
return {initialBatches};
})();
const coneBirth=(()=>{
const {initialState,next,randomFloat}=birthRand,{fromBits}=require('./unity-noise-medium');
const f=Math.fround,add=(a,b)=>f(f(a)+f(b)),sub=(a,b)=>f(f(a)-f(b)),mul=(a,b)=>f(f(a)*f(b)),div=(a,b)=>f(f(a)/f(b));
function nearestEven(value){const low=Math.floor(value),remainder=value-low;return remainder<.5?low:remainder>.5?low+1:low%2===0?low:low+1;}
function polynomial(r){
 const r2=mul(r,r),r4=mul(r2,r2),r8=mul(r4,r4),low=add(mul(fromBits(0xc2255ddc),r2),fromBits(0x40c90fda));
 const high=mul(add(mul(fromBits(0xc2992322),r2),fromBits(0x42a33422)),r4);
 return mul(add(add(high,low),mul(r8,fromBits(0x421ea0cd))),r);
}
function originalSinCos(theta){
 const t=mul(theta,fromBits(0x3e22f983)),shift=sub(t,.25);
 return {cos:polynomial(sub(.25,Math.abs(sub(t,nearestEven(t))))),sin:polynomial(sub(.25,Math.abs(sub(shift,nearestEven(shift)))))};
}
function firstRandom(seed,salt){
 const a=(seed+salt)>>>0,b=(Math.imul(a,0x6c078965)+1)>>>0,c=(Math.imul(b,0x6c078965)+1)>>>0,d=(Math.imul(c,0x6c078965)+1)>>>0,t=(a^(a<<11))>>>0;
 return mul((d^(d>>>19)^t^(t>>>8))&0x7fffff,fromBits(0x34000001));
}
function startSpeed(particleSeed,module){const r=firstRandom(particleSeed,0x96aa4de3);return add(mul(sub(module.scalar,module.minScalar),r),module.minScalar);}

// 原StartCone<0>21724fe..217281e。先仅覆盖原boom02随机圆弧、无额外随机方向/位置、单位Shape变换。
function firstConeBatch(systemSeed,shape,count){
 if(shape.type!==4||shape.arc.mode!==0||shape.arc.spread!==0||shape.randomDirectionAmount||shape.sphericalDirectionAmount||shape.randomPositionAmount)throw Error('仅原boom02随机Cone');
 if(Object.values(shape.m_Position).some(v=>v!==0)||Object.values(shape.m_Rotation).some(v=>v!==0)||Object.values(shape.m_Scale).some(v=>v!==1))throw Error('仅原单位Shape变换');
 const state=initialState(systemSeed),output=[],degreesToRadians=fromBits(0x3c8efa35),arc=mul(shape.arc.value,degreesToRadians),cone=originalSinCos(mul(shape.angle,degreesToRadians)),inner=Math.max(f(.001),sub(1,shape.radiusThickness));
 for(let base=0;base<count;base+=4){
  const angle=randomFloat(next(state)),radial=randomFloat(next(state));
  for(let lane=0;lane<4&&base+lane<count;lane++){
   const phase=originalSinCos(mul(angle[lane],arc)),radius=f(Math.sqrt(add(mul(inner,radial[lane]),mul(sub(1,radial[lane]),1))));
   const x=mul(phase.cos,radius),y=mul(phase.sin,radius),position=[mul(x,shape.radius.value),mul(y,shape.radius.value),0];
   const direction=[mul(cone.sin,x),mul(cone.sin,y),cone.cos],lengthSq=add(add(mul(direction[2],direction[2]),mul(direction[1],direction[1])),mul(direction[0],direction[0])),inverse=div(1,f(Math.sqrt(lengthSq)));
   const normalized=direction.map(v=>mul(v,inverse)),secondLengthSq=add(add(mul(normalized[2],normalized[2]),mul(normalized[1],normalized[1])),mul(normalized[0],normalized[0])),secondInverse=div(1,f(Math.sqrt(secondLengthSq)));
   // EmitterStoreData在7b60和7ffc各执行一次方向归一化，第二次仍会改变末位。
   output.push({position,direction:normalized.map(v=>mul(v,secondInverse)),phase:angle[lane],radial:radial[lane]});
  }
 }
 return output;
}
return {firstConeBatch,startSpeed};
})();
const boomTrajectory=(()=>{
const {noiseMediumSingle,originalUnlockScrollSpeedCandidate,advanceScroll,fromBits}=require('./unity-noise-medium'),{optimizedCurve}=curveCache;
const f=Math.fround,add=(a,b)=>f(f(a)+f(b)),sub=(a,b)=>f(f(a)-f(b)),mul=(a,b)=>f(f(a)*f(b)),div=(a,b)=>f(f(a)/f(b));

// 原Force UpdateTpl<3> 20657b4..206590d：particleSeed+0x12460f3b，按x/y/z依次draw同一独立Rand4。
function forceRandom(seed){
 let a=(seed+0x12460f3b)>>>0,b=(Math.imul(a,0x6c078965)+1)>>>0,c=(Math.imul(b,0x6c078965)+1)>>>0,d=(Math.imul(c,0x6c078965)+1)>>>0;
 const result=[];
 for(let axis=0;axis<3;axis++){const t=(a^(a<<11))>>>0;[a,b,c]=[b,c,d];d=(d^(d>>>19)^t^(t>>>8))>>>0;result.push(mul(d&0x7fffff,fromBits(0x34000001)));}
 return result;
}
function createTrajectory(fixture,noiseEnabled){
 if(fixture.caseId!=='boom02-dd'||fixture.seedResolution!=='diagnostic-fixed-override-not-original-auto-seed')throw Error('只允许明确诊断auto种子，不能声称原auto解析');
 const dt=fixture.dt,config=fixture.config,clamp=config.ClampVelocityModule;
 if(clamp.magnitude.minMaxState!==0||config.ForceModule.inWorldSpace||config.ForceModule.randomizePerFrame)throw Error('仅原本组局部TwoConstants静态Force');
 const particles=fixture.firstObserved[noiseEnabled?'on':'off'].map(p=>({...p,position:p.position.slice(),velocity:p.velocity.slice(),agePercent:mul(mul(dt,100),p.inverseLifetime)}));
 let systemTime=fixture.firstClock[noiseEnabled?'on':'off'].systemTime,scroll=fixture.firstClock[noiseEnabled?'on':'off'].noiseScroll,order=particles.slice();
 const dampen=sub(1,f(Math.pow(sub(1,clamp.dampen),mul(Math.abs(dt),30))));
 function step(){
  systemTime=add(systemTime,dt);if(noiseEnabled&&order.length)scroll=advanceScroll(scroll,originalUnlockScrollSpeedCandidate(div(systemTime,fixture.duration)),dt);
  const states=new Map(particles.filter(p=>p.agePercent<100).map(p=>{
   const normalized=mul(.01,p.agePercent),random=forceRandom(p.randomSeed);
   const linear=['x','y','z'].map(axis=>{const curve=config.VelocityModule[axis];if(curve.minMaxState!==1)throw Error('仅原ThreeCurves');return optimizedCurve(curve.maxCurve,curve.scalar,normalized);});
   const field=noiseEnabled?noiseMediumSingle({position:p.position,systemSeed:fixture.systemSeed,frequency:.54,scroll,strength:.71,damping:true,rcppsEstimateBits:0x3fed1000}).animatedVelocityContribution:[0,0,0];
   const animated=linear.map((v,i)=>add(v,field[i]));
   for(let axis=0;axis<3;axis++){const curve=config.ForceModule[['x','y','z'][axis]];if(curve.minMaxState!==3)throw Error('仅原TwoConstants');const force=add(mul(sub(curve.scalar,curve.minScalar),random[axis]),curve.minScalar);p.velocity[axis]=add(p.velocity[axis],mul(force,dt));}
   const before=p.velocity.map((v,i)=>add(v,animated[i])),lengthSq=add(add(mul(before[1],before[1]),mul(before[2],before[2])),mul(before[0],before[0])),length=f(Math.sqrt(lengthSq)),inverse=div(1,length);
   const limited=length>clamp.magnitude.scalar?add(mul(sub(clamp.magnitude.scalar,length),dampen),length):length;
   p.velocity=before.map((v,i)=>sub(mul(limited,lengthSq>1e-30?mul(v,inverse):0),animated[i]));
   const total=p.velocity.map((v,i)=>add(v,animated[i]));p.position=p.position.map((v,i)=>add(v,mul(total[i],dt)));p.agePercent=add(p.agePercent,mul(mul(dt,100),p.inverseLifetime));
   return [p.randomSeed,{randomSeed:p.randomSeed,position:p.position.slice(),velocity:p.velocity.slice(),animatedVelocity:animated,totalVelocity:total}];
  }));
  for(let i=0;i<order.length;){if(order[i].agePercent>=100){order[i]=order.at(-1);order.pop();}else i++;}
  return order.map(p=>states.get(p.randomSeed));
 }
 return {step,get systemTime(){return systemTime;},get scroll(){return scroll;}};
}
return {forceRandom,createTrajectory};
})();
const autoComplete=(()=>{
const {firstConeBatch,startSpeed}=coneBirth,{initialBatches}=initialBirth;
const {forceRandom,createTrajectory}=boomTrajectory,{optimizedCurve}=curveCache,{noiseMediumSingle,toBits,fromBits,dampingFactor}=require('./unity-noise-medium');
const grid={result:{values:parameters.reciprocalEstimates,mismatches:0,comparedInputs:16777216}};
const f=Math.fround,add=(a,b)=>f(f(a)+f(b)),sub=(a,b)=>f(f(a)-f(b)),mul=(a,b)=>f(f(a)*f(b)),div=(a,b)=>f(f(a)/f(b));

// 这是同机SSE有限指数范围的纯CPU测量表，不是从Unity首态倒推的粒子模板。
function inverseLifetime(value){
 const bits=toBits(value),exponent=(bits>>>23)&255;
 if(grid.result.mismatches!==0||grid.result.comparedInputs!==16777216||exponent<126||exponent>127)throw Error('寿命超出已穷举CPU范围');
 const estimate=(grid.result.values[(bits&0x7fffff)>>>12]+((127-exponent)<<23))>>>0;
 return dampingFactor(value,true,estimate).factor;
}
function createCompleteTrajectory(systemSeed,config,dt,noiseEnabled){
 if(config.InitialModule.startLifetime.minScalar<.5||config.InitialModule.startLifetime.scalar>=2||config.InitialModule.maxNumParticles!==5||config.EmissionModule.m_Bursts.length!==1||config.EmissionModule.m_Bursts[0].countCurve.scalar!==10)throw Error('仅原boom02的十粒突发受五粒上限裁剪及寿命区间');
 dt=f(dt);systemSeed>>>=0;
 const initial=initialBatches(systemSeed,config.InitialModule,5),shape=firstConeBatch(systemSeed,config.ShapeModule,5),clamp=config.ClampVelocityModule;
 const dampen=sub(1,f(Math.pow(sub(1,clamp.dampen),mul(dt,30))));
 const born=initial.map((p,index)=>{
  const s=shape[index],velocity=s.direction.map(v=>mul(v,startSpeed(p.particleSeed,config.InitialModule.startSpeed))),random=forceRandom(p.particleSeed);
  const extra=['x','y','z'].map(axis=>{const c=config.VelocityModule[axis];return optimizedCurve(c.maxCurve,c.scalar,0);});
  const field=noiseEnabled?noiseMediumSingle({position:s.position,systemSeed,frequency:.54,scroll:0,strength:.71,damping:true,rcppsEstimateBits:0x3fed1000}).animatedVelocityContribution:[0,0,0];
  const animated=extra.map((v,i)=>add(v,field[i]));
  for(let axis=0;axis<3;axis++){const c=config.ForceModule[['x','y','z'][axis]],force=add(mul(sub(c.scalar,c.minScalar),random[axis]),c.minScalar);velocity[axis]=add(velocity[axis],mul(force,dt));}
  const before=velocity.map((v,i)=>add(v,animated[i])),lengthSq=add(add(mul(before[1],before[1]),mul(before[2],before[2])),mul(before[0],before[0])),length=f(Math.sqrt(lengthSq)),inverse=div(1,length),limited=length>1?add(mul(sub(1,length),dampen),length):length;
  const v=before.map((v,i)=>sub(mul(limited,mul(v,inverse)),animated[i])),total=v.map((v,i)=>add(v,animated[i])),position=s.position.map((v,i)=>add(v,mul(total[i],dt)));
  return {randomSeed:p.particleSeed,position,velocity:v,animatedVelocity:animated,totalVelocity:total,inverseLifetime:inverseLifetime(p.rawLifetime),initial:p};
 });
 const key=noiseEnabled?'on':'off',fixture={caseId:'boom02-dd',systemSeed,seedResolution:'diagnostic-fixed-override-not-original-auto-seed',dt,duration:config.lengthInSec,
  config:{VelocityModule:config.VelocityModule,ForceModule:config.ForceModule,ClampVelocityModule:config.ClampVelocityModule},firstObserved:{[key]:born},firstClock:{[key]:{systemTime:dt,noiseScroll:0}}};
 const trajectory=createTrajectory(fixture,noiseEnabled);let first=true;
 return {step(){if(first){first=false;return born;}return trajectory.step();},initial:born,get systemTime(){return trajectory.systemTime;},get scroll(){return trajectory.scroll;}};
}
return {createCompleteTrajectory};
})();
const AUTO_BOOM02_NAME='eff_UIPropUnlock_boom_02/ui/dd',STEP=1/240;
function supportsAutoBoom02(action,d,resolvedSeed){
 return action.kind==='unlock'&&d.name===AUTO_BOOM02_NAME&&d.autoSeed&&Number.isInteger(resolvedSeed)&&resolvedSeed>0&&resolvedSeed<=0xffffffff;
}
function createAutoBoom02Trajectory(seed,dt=STEP,noiseEnabled=true){return autoComplete.createCompleteTrajectory(seed,parameters.config,dt,noiseEnabled);}
function createAutoBoom02System(d,born,sampleRoot,seed){
 let model=createAutoBoom02Trajectory(seed),currentStep=0,current=[];
 const particles=model.initial.map(p=>({d,born,lifetime:Math.fround(1/p.inverseLifetime),position:p.position.slice(),velocity:p.velocity.slice(),
  size:[p.initial.startSize,p.initial.startSize,p.initial.startSize],rotation:p.initial.rotation.slice(),color:p.initial.color32.map(v=>v/255),
  random:Array(12).fill(0),simulated:0,root:sampleRoot?sampleRoot(born,d):null,history:null,randomSeed:p.randomSeed,
  autoBoom02:true,autoBoom02Visible:false,systemSeed:seed,seedSource:'移植层既有action种子；原平台auto来源未恢复'}));
 function sample(age){
  const step=Math.floor((age-born)/STEP+1e-7);
  if(step<1||step>480){for(const p of particles)p.autoBoom02Visible=false;return;}
  if(step<currentStep){model=createAutoBoom02Trajectory(seed);currentStep=0;current=[];}
  while(currentStep<step){current=model.step();currentStep++;}
  const indexed=new Map(current.map(p=>[p.randomSeed,p]));
  for(const p of particles){const state=indexed.get(p.randomSeed);p.autoBoom02Visible=!!state;if(!state)continue;
   p.position=state.position.slice();p.velocity=state.velocity.slice();p.animatedVelocity=state.animatedVelocity.slice();p.totalVelocity=state.totalVelocity.slice();p.simulated=currentStep*STEP;
  }
 }
 return {particles,sample};
}
module.exports={supportsAutoBoom02,createAutoBoom02System,createAutoBoom02Trajectory};
