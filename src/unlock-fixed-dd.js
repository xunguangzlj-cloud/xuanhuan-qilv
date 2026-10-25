'use strict';
const { noiseMediumSingle, originalUnlockScrollSpeedCandidate, advanceScroll, fromBits } = require('./unity-noise-medium');
const f = Math.fround, add = (a,b) => f(f(a)+f(b)), sub = (a,b) => f(f(a)-f(b)), mul = (a,b) => f(f(a)*f(b)), div = (a,b) => f(f(a)/f(b));

// 同版InitialModule::Update 209e37d..439：seed加固定通道，再取Rand4第一项低23位。
function gravityRandom(seed) {
  let a = (seed + 0xe2b7c3c3) >>> 0, b = (Math.imul(a,0x6c078965)+1)>>>0;
  let c = (Math.imul(b,0x6c078965)+1)>>>0, d = (Math.imul(c,0x6c078965)+1)>>>0;
  const t = (a ^ (a << 11))>>>0, word = (d ^ (d>>>19) ^ t ^ (t>>>8))>>>0;
  return mul(word & 0x7fffff, fromBits(0x34000001));
}

// 该非加权Hermite系数构造仍单列候选；不以原生逐帧值替换系数。
function curve(keys, time) {
  if (time <= keys[0].time) return keys[0].value;
  if (time >= keys.at(-1).time) return keys.at(-1).value;
  let i = 1; while (keys[i].time <= time) i++;
  const p = keys[i-1], q = keys[i], span=sub(q.time,p.time), slope=div(sub(q.value,p.value),span);
  const a=div(sub(add(p.outSlope,q.inSlope),mul(2,slope)),mul(span,span));
  const b=div(sub(sub(mul(3,slope),mul(2,p.outSlope)),q.inSlope),span), t=sub(time,p.time);
  return add(mul(add(mul(add(mul(a,t),b),t),p.outSlope),t),p.value);
}

function createTrajectory(fixture, noiseEnabled) {
  if (fixture.caseId !== 'boom01-dd' || fixture.systemSeed !== 3692087213 || fixture.dt !== f(1/240)) throw Error('仅允许已采固定seed/步长boom01-dd');
  const config = fixture.config, particles = fixture.firstObserved[noiseEnabled ? 'on' : 'off'].map(p => {
    const inverseLife=div(1,p.startLifetime);
    return { ...p, position:p.position.slice(), velocity:p.velocity.slice(), inverseLife,
      // 原生内部按百分数递增。由首步/公开startLifetime推回，逆转换精度仍需实测审核。
      agePercent:mul(mul(fixture.dt,100),inverseLife) };
  });
  let scroll = fixture.firstClock[noiseEnabled ? 'on' : 'off'].noiseScroll;
  let systemTime = fixture.firstClock[noiseEnabled ? 'on' : 'off'].systemTime;
  // 209e295..35d在gravity*dt之后乘模拟逆矩阵；原祖先为无旋转均匀10倍，不能直接把世界重力当局部重力。
  const dt=fixture.dt, gravityDt=mul(mul(config.gravityY,dt),config.inverseSimulationScale);
  const dampenFactor=sub(1,f(Math.pow(sub(1,config.limitDampen),mul(Math.abs(dt),30))));
  function step() {
    systemTime=add(systemTime,dt);
    if (noiseEnabled) scroll=advanceScroll(scroll,originalUnlockScrollSpeedCandidate(div(systemTime,config.duration)),dt);
    return particles.filter(p => p.agePercent < 100).map(p => {
      const normalizedAge=mul(f(.01),p.agePercent), extra=[0,mul(curve(config.velocityY.keys,normalizedAge),config.velocityY.scalar),0];
      const modifier=add(mul(sub(config.gravityMax,config.gravityMin),gravityRandom(p.randomSeed)),config.gravityMin);
      p.velocity[1]=add(p.velocity[1],mul(gravityDt,modifier));
      const field=noiseEnabled ? noiseMediumSingle({position:p.position,systemSeed:fixture.systemSeed,frequency:config.noiseFrequency,scroll,strength:config.noiseStrength,damping:true,rcppsEstimateBits:fixture.x64FrequencyEstimateBits}).animatedVelocityContribution : [0,0,0];
      const animated=extra.map((v,i)=>add(v,field[i])), before=p.velocity.map((v,i)=>add(v,animated[i]));
      // 同版MagnitudeUpdateTpl<0> 206f69b..778：先(y²+z²)+x²；归一化、限幅后减animated回写velocity。
      const lengthSq=add(add(mul(before[1],before[1]),mul(before[2],before[2])),mul(before[0],before[0]));
      const length=f(Math.sqrt(lengthSq)), inverse=div(1,length);
      const limited=length>config.limitMagnitude ? add(mul(sub(config.limitMagnitude,length),dampenFactor),length) : length;
      p.velocity=before.map((v,i)=>sub(mul(limited,lengthSq>1e-30?mul(v,inverse):0),animated[i]));
      const total=p.velocity.map((v,i)=>add(v,animated[i]));
      p.position=p.position.map((v,i)=>add(v,mul(total[i],dt)));
      p.agePercent=add(p.agePercent,mul(mul(dt,100),p.inverseLife));
      return {randomSeed:p.randomSeed,position:p.position.slice(),velocity:p.velocity.slice(),animatedVelocity:animated,totalVelocity:total,agePercent:p.agePercent,noiseScroll:scroll};
    }).filter(p=>p.agePercent<100);
  }
  return { step, get scroll(){return scroll;}, get systemTime(){return systemTime;} };
}


const fixture=require('../assets/unlock-effects/fixed-dd-first-state');
const FIXED_NAME='eff_UIPropUnlock_boom_01/ui_1/dd', STEP=1/240;

function supportsFixedDd(action,d){
  return action.kind==='unlock'&&d.name===FIXED_NAME&&!d.autoSeed&&(d.seed>>>0)===fixture.systemSeed;
}

function createFixedDdSystem(d,born,sampleRoot){
  const particles=fixture.firstObserved.on.map(row=>({d,born,lifetime:row.startLifetime,randomSeed:row.randomSeed,
    position:row.position.slice(),velocity:row.velocity.slice(),size:row.startSize3D.slice(),rotation:row.rotationRadians.slice(),
    color:row.startColor32.map(v=>v/255),
    // 这组渲染寿命曲线均非随机；保留通用renderer参数槽，不以它代替出生Rand4。
    random:Array(12).fill(0),simulated:STEP,root:sampleRoot?sampleRoot(born,d):null,history:null,
    fixedDd:true,fixedDdVisible:false,animatedVelocity:row.animatedVelocity.slice(),totalVelocity:row.totalVelocity.slice()}));
  let model=createTrajectory(fixture,true),currentStep=1,currentStates=fixture.firstObserved.on;
  function assign(states){
    const indexed=new Map(states.map(p=>[p.randomSeed,p]));
    for(const p of particles){const row=indexed.get(p.randomSeed);p.fixedDdVisible=!!row;if(!row)continue;
      p.position=row.position.slice();p.velocity=row.velocity.slice();p.animatedVelocity=row.animatedVelocity.slice();p.totalVelocity=row.totalVelocity.slice();p.simulated=currentStep*STEP;}
  }
  function sample(age){
    // 0至首观察步没有原生中间态证据；仅在已验证的240Hz时刻显示，不伪造出生前轨迹或分数步插值。
    const step=Math.floor((age-born)/STEP+1e-7);
    if(step<1||step>480){for(const p of particles)p.fixedDdVisible=false;return;}
    if(step<currentStep){model=createTrajectory(fixture,true);currentStep=1;currentStates=fixture.firstObserved.on;}
    while(currentStep<step){currentStates=model.step();currentStep++;}
    assign(currentStates);
  }
  return {particles,sample};
}
module.exports={supportsFixedDd,createFixedDdSystem};
