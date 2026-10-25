'use strict';
// 原loop预热、持续出生与局部Noise轨迹；只承诺已核给定非零seed的Windows有限范围。
const parameters=require('../assets/unlock-effects/auto-loop-parameters');
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
const coneMath=(()=>{
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

return {originalSinCos,firstRandom,startSpeed};
})();
const gravityMath=(()=>{
const {fromBits}=require('./unity-noise-medium');const f=Math.fround,mul=(a,b)=>f(f(a)*f(b));
// 同版InitialModule::Update 209e37d..439：seed加固定通道，再取Rand4第一项低23位。
function gravityRandom(seed) {
  let a = (seed + 0xe2b7c3c3) >>> 0, b = (Math.imul(a,0x6c078965)+1)>>>0;
  let c = (Math.imul(b,0x6c078965)+1)>>>0, d = (Math.imul(c,0x6c078965)+1)>>>0;
  const t = (a ^ (a << 11))>>>0, word = (d ^ (d>>>19) ^ t ^ (t>>>8))>>>0;
  return mul(word & 0x7fffff, fromBits(0x34000001));
}

return {gravityRandom};
})();
const lifetimeMath=(()=>{
const {toBits,dampingFactor}=require('./unity-noise-medium');const grid={result:{values:require('../assets/unlock-effects/auto-boom02-parameters').reciprocalEstimates,mismatches:0,comparedInputs:16777216}};
// 这是同机SSE有限指数范围的纯CPU测量表，不是从Unity首态倒推的粒子模板。
function inverseLifetime(value){
 const bits=toBits(value),exponent=(bits>>>23)&255;
 if(grid.result.mismatches!==0||grid.result.comparedInputs!==16777216||exponent<126||exponent>127)throw Error('寿命超出已穷举CPU范围');
 const estimate=(grid.result.values[(bits&0x7fffff)>>>12]+((127-exponent)<<23))>>>0;
 return dampingFactor(value,true,estimate).factor;
}
return {inverseLifetime};
})();
const loopLifetime=(()=>{
const {inverseLifetime}=lifetimeMath,{toBits,dampingFactor}=require('./unity-noise-medium'),endpoint={inputBits:0x40000000,estimateBits:parameters.lifetimeEndpointEstimate,unityAssemblyLoaded:false,androidArmEquivalent:false};
function loopInverseLifetime(value){
 if(value!==2)return inverseLifetime(value);
 // 原loop随机寿命闭区间包含2；仅此端点使用同机SSE纯CPU实测估计位，未借用Unity首态。
 if(endpoint.inputBits!==toBits(value)||endpoint.unityAssemblyLoaded||endpoint.androidArmEquivalent)throw Error('寿命闭区间端点来源不符');
 return dampingFactor(value,true,endpoint.estimateBits).factor;
}
return {loopInverseLifetime};
})();
const initialBirth=(()=>{
const {initialState,next,randomFloat}=birthRand,{loopInverseLifetime}=loopLifetime;
const f=Math.fround,lerp=(curve,r)=>f(f(f(curve.scalar-curve.minScalar)*r)+curve.minScalar);
function createInitialStream(seed,initial){
 if(initial.rotation3D||initial.size3D||initial.startColor.minMaxState!==4)throw Error('仅原loop单粒非3D出生与阶跃随机色');
 const state=initialState(seed),gradient=initial.startColor.maxGradient,alpha=gradient.key0.a;let birth=0;
 if(gradient.m_Mode!==1||!Array.from({length:gradient.m_NumAlphaKeys},(_,i)=>gradient['key'+i].a).every(v=>v===alpha))throw Error('仅原阶跃色与恒定alpha');
 return function nextInitial(){
  const particleSeed=next(state)[0],life=randomFloat(next(state))[0],size=randomFloat(next(state))[0],rotation=randomFloat(next(state))[0],color=randomFloat(next(state))[0];
  let key=gradient.m_NumColorKeys-1;for(let i=0;i<gradient.m_NumColorKeys;i++)if(color<=gradient['ctime'+i]/65535){key=i;break;}
  const c=gradient['key'+key],rawLifetime=lerp(initial.startLifetime,life);
  return {birth:birth++,particleSeed,rawLifetime,inverseLifetime:loopInverseLifetime(rawLifetime),size:lerp(initial.startSize,size),rotation:[0,0,lerp(initial.startRotation,rotation)],color32:[...['r','g','b'].map(axis=>Math.round(f(c[axis]*255))),Math.round(f(alpha*255))]};
 };
}
function initialStream(seed,initial,count){const nextInitial=createInitialStream(seed,initial);return Array.from({length:count},()=>nextInitial());}
return {createInitialStream};
})();
const shapeBirth=(()=>{
const {initialState,next,randomFloat}=birthRand,{originalSinCos}=coneMath,{fromBits}=require('./unity-noise-medium');
const f=Math.fround,add=(a,b)=>f(f(a)+f(b)),sub=(a,b)=>f(f(a)-f(b)),mul=(a,b)=>f(f(a)*f(b)),div=(a,b)=>f(f(a)/f(b));
function createLoopShape(seed,shape){
 if(shape.type!==4||shape.arc.mode!==1||shape.arc.spread!==0||shape.sphericalDirectionAmount||shape.randomDirectionAmount||shape.randomPositionAmount)throw Error('仅原loop Cone连续圆弧');
 const state=initialState(seed),cone=originalSinCos(mul(shape.angle,fromBits(0x3c8efa35))),inner=Math.max(f(.001),sub(1,shape.radiusThickness));
 return function atPhase(phase){
  // 原StartCone<1>先以double的2*原F32圆周率乘Shape累积phase，再转F32角。
  const arc=mul(shape.arc.value,fromBits(0x3c8efa35)),theta=f(((phase+phase)*Math.fround(Math.PI))%arc),angle=originalSinCos(theta),radial=randomFloat(next(state))[0],radius=f(Math.sqrt(add(mul(inner,radial),mul(sub(1,radial),1))));
  const x=mul(angle.cos,radius),y=mul(angle.sin,radius),position=[mul(x,shape.radius.value),mul(y,shape.radius.value),0];
  let direction=[mul(cone.sin,x),mul(cone.sin,y),cone.cos];
  for(let pass=0;pass<2;pass++){
   const lengthSq=add(add(mul(direction[2],direction[2]),mul(direction[1],direction[1])),mul(direction[0],direction[0])),inverse=div(1,f(Math.sqrt(lengthSq)));
   direction=direction.map(v=>mul(v,inverse));
  }
  return {phase,theta,radial,position,direction};
 };
}
return {createLoopShape};
})();
const localStep=(()=>{
const {optimizedCurve}=curveCache,{firstRandom}=coneMath,{noiseMediumSingle}=require('./unity-noise-medium'),{gravityRandom}=gravityMath;
const f=Math.fround,add=(a,b)=>f(f(a)+f(b)),sub=(a,b)=>f(f(a)-f(b)),mul=(a,b)=>f(f(a)*f(b)),div=(a,b)=>f(f(a)/f(b));
function moveLoopParticle(p,config,dt,systemSeed,scroll,noiseEnabled){
 const time=mul(.01,p.agePercent),extra=['x','y','z'].map(axis=>{const c=config.VelocityModule[axis];return optimizedCurve(c.maxCurve,c.scalar,time);});
 const field=noiseEnabled?noiseMediumSingle({position:p.position,systemSeed,frequency:.5,scroll,strength:.35,damping:true,rcppsEstimateBits:0x3ffff000}).animatedVelocityContribution:[0,0,0];
 const gravity=config.InitialModule.gravityModifier,modifier=add(mul(sub(gravity.scalar,gravity.minScalar),gravityRandom(p.randomSeed)),gravity.minScalar),gravityDt=mul(mul(-9.8100004196167,dt),.1);
 p.velocity[1]=add(p.velocity[1],mul(gravityDt,modifier));
 const animated=extra.map((v,i)=>add(v,field[i])),before=p.velocity.map((v,i)=>add(v,animated[i]));
 const lengthSq=add(add(mul(before[1],before[1]),mul(before[2],before[2])),mul(before[0],before[0])),length=f(Math.sqrt(lengthSq)),inverse=div(1,length),c=config.ClampVelocityModule.magnitude;
 const limit=add(mul(sub(c.scalar,c.minScalar),firstRandom(p.randomSeed,0x13371337)),c.minScalar),dampen=sub(1,f(Math.pow(sub(1,config.ClampVelocityModule.dampen),mul(dt,30))));
 const limited=length>limit?add(mul(sub(limit,length),dampen),length):length;
 p.velocity=before.map((v,i)=>sub(mul(limited,mul(v,inverse)),animated[i]));
 const total=p.velocity.map((v,i)=>add(v,animated[i]));p.position=p.position.map((v,i)=>add(v,mul(total[i],dt)));p.agePercent=add(p.agePercent,mul(mul(dt,100),p.inverseLifetime));
 p.animatedVelocity=animated;p.totalVelocity=total;return p;
}
return {moveLoopParticle};
})();
const loopComplete=(()=>{
const {createInitialStream}=initialBirth,{createLoopShape}=shapeBirth,{startSpeed}=coneMath,{moveLoopParticle}=localStep,{advanceScroll}=require('./unity-noise-medium'),{optimizedCurve}=curveCache;
const f=Math.fround,add=(a,b)=>f(f(a)+f(b)),sub=(a,b)=>f(f(a)-f(b)),mul=(a,b)=>f(f(a)*f(b)),div=(a,b)=>f(f(a)/f(b));
function createLoopModel(seed,config,maximumParticleDeltaTime,noiseEnabled){
 const nextInitial=createInitialStream(seed,config.InitialModule),shape=createLoopShape(seed,config.ShapeModule),rate=config.EmissionModule.rateOverTime.scalar,duration=config.lengthInSec,prewarmLength=config.InitialModule.startLifetime.scalar;
 const substeps=Math.ceil(prewarmLength/f(maximumParticleDeltaTime)),prewarmDt=f(prewarmLength/substeps);
 let clock=f(duration-prewarmLength),phase=0,accumulator=0,scroll=0,order=[];
 function simulate(dt,prewarm=false){
  const previous=clock,current=add(clock,dt),emissionEnd=Math.min(current,duration);clock=current>=duration?sub(current,duration):current;
  const previousPhase=phase;phase+=dt;
  if(noiseEnabled&&order.length)scroll=advanceScroll(scroll,optimizedCurve(config.NoiseModule.scrollSpeed.maxCurve,config.NoiseModule.scrollSpeed.scalar,div(clock,duration)),dt);
  for(const p of order)moveLoopParticle(p,config,dt,seed,scroll,noiseEnabled);
  // KillParticlesWithExtraConditions<0,0>按每4lane的3/2/1/0顺序末粒补空；有死亡时在同组重新检查。
  for(let base=0;base<order.length;){
   const dead=[];for(let lane=0;lane<4&&base+lane<order.length;lane++)if(order[base+lane].agePercent>100)dead.push(base+lane);
   if(!dead.length){base+=4;continue;}
   for(let index=dead.length-1;index>=0;index--){order[dead[index]]=order.at(-1);order.pop();}
  }
  const emitted=current>=duration?add(mul(rate,sub(duration,previous)),mul(rate,clock)):mul(rate,sub(emissionEnd,previous)),whole=add(accumulator,emitted),count=Math.floor(whole);accumulator=sub(whole,count);
  const spacing=emitted>=f(.0001)?div(1,emitted):1;
  for(let index=0;index<count;index++){
   const fraction=Math.min(1,Math.max(0,mul(add(index,accumulator),spacing))),birthPhase=(1-fraction)*phase+fraction*previousPhase,born=shape(birthPhase),initial=nextInitial(),speed=startSpeed(initial.particleSeed,config.InitialModule.startSpeed);
   const p={randomSeed:initial.particleSeed,initial,position:born.position,velocity:born.direction.map(v=>mul(v,speed)),inverseLifetime:initial.inverseLifetime,agePercent:0};
   moveLoopParticle(p,config,mul(dt,Math.max(f(1e-6),fraction)),seed,scroll,noiseEnabled);order.push(p);
  }
  return order;
 }
 for(let i=0;i<substeps;i++)simulate(prewarmDt,true);
 return {step(dt){return simulate(f(dt));},get states(){return order;},get systemTime(){return clock;},get scroll(){return scroll;},get phase(){return phase;},get accumulator(){return accumulator;},prewarmDt,substeps};
}
return {createLoopModel};
})();
const AUTO_LOOP_NAME='eff_UIPropUnlock_loop/ui_1/dd',STEP=1/240;
function supportsAutoLoop(action,d,resolvedSeed){return action.kind==='unlock'&&d.name===AUTO_LOOP_NAME&&d.autoSeed&&Number.isInteger(resolvedSeed)&&resolvedSeed>0&&resolvedSeed<=0xffffffff;}
function createAutoLoopTrajectory(seed,noiseEnabled=true){return loopComplete.createLoopModel(seed,parameters.config,parameters.maximumParticleDeltaTime,noiseEnabled);}
function createAutoLoopSystem(d,born,sampleRoot,seed){
 let model=createAutoLoopTrajectory(seed),currentStep=0,current=model.states;
 // 固定上限槽位只承载当前活粒，出生流持续推进；不缓存已死亡粒子或原生轨迹。
 const particles=Array.from({length:d.max},()=>({d,born,lifetime:1,position:[0,0,0],velocity:[0,0,0],size:[0,0,0],rotation:[0,0,0],color:[1,1,1,0],
  random:Array(12).fill(0),simulated:0,root:sampleRoot?sampleRoot(born,d):null,history:null,autoLoop:true,autoLoopVisible:false,systemSeed:seed,seedSource:'移植层既有action种子；原平台auto来源未恢复'}));
 function sample(age){
  const step=Math.floor((age-born)/STEP+1e-7);
  if(step<0){for(const p of particles)p.autoLoopVisible=false;return;}
  if(step<currentStep){model=createAutoLoopTrajectory(seed);currentStep=0;current=model.states;}
  while(currentStep<step){current=model.step(STEP);currentStep++;}
  if(current.length>particles.length)throw Error('原loop粒子上限被超过');
  for(let index=0;index<particles.length;index++){
   const p=particles[index],state=current[index];p.autoLoopVisible=!!state;if(!state)continue;
   const initial=state.initial;p.randomSeed=state.randomSeed;p.lifetime=Math.fround(1/state.inverseLifetime);p.position=state.position.slice();p.velocity=state.velocity.slice();
   p.animatedVelocity=state.animatedVelocity.slice();p.totalVelocity=state.totalVelocity.slice();p.size=[initial.size,initial.size,initial.size];p.rotation=initial.rotation.slice();p.color=initial.color32.map(v=>v/255);
   p.autoLoopAge=Math.fround(Math.fround(.01)*state.agePercent);p.simulated=p.autoLoopAge*p.lifetime;
  }
 }
 return {particles,sample};
}
module.exports={supportsAutoLoop,createAutoLoopSystem,createAutoLoopTrajectory};
