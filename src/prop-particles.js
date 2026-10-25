'use strict';
const { evaluateCurve, evaluateGradient, evaluateKeys } = require('./release-effects');
const { rotateEuler, seededRandom } = require('./ambient-effects');
const { supportsFixedDd, createFixedDdSystem } = require('./unlock-fixed-dd');
const { supportsFixedTrail, createFixedTrailSystem } = require('./unlock-fixed-trail');
const { supportsAutoBoom02, createAutoBoom02System } = require('./unlock-auto-boom02');
const { supportsAutoLoop, createAutoLoopSystem } = require('./unlock-auto-loop');
const STEP = 1 / 240, DEG = Math.PI / 180;
const clamp = value => Math.max(0, Math.min(1, value));
const mix = (a, b, t) => a + (b - a) * t;

function quaternion(point, q) {
  const [x,y,z,w] = q, [a,b,c] = point, tx = 2 * (y*c-z*b), ty = 2 * (z*a-x*c), tz = 2 * (x*b-y*a);
  return [a+w*tx+y*tz-z*ty,b+w*ty+z*tx-x*tz,c+w*tz+x*ty-y*tx];
}

function transformPoint(point, chain, vector = false) {
  for (let index = chain.length - 1; index >= 0; index--) {
    const t = chain[index]; point = quaternion(point.map((v,i)=>v*t.scale[i]),t.rotation);
    if (!vector) point = point.map((v,i)=>v+t.position[i]);
    if (t.uiScale) point = point.map((v,i)=>v*t.uiScale[i]);
  }
  return point;
}

function samplePropShape(shape, random) {
  if (!shape.enabled) return { position:[0,0,0], direction:[0,0,1] };
  const angle = random()*shape.arc*DEG, inner = 1-shape.thickness, radius = shape.radius*Math.sqrt(inner*inner+random()*(1-inner*inner));
  let position = [Math.cos(angle)*radius,Math.sin(angle)*radius,0];
  const slope = Math.sin(shape.angle*DEG)*(shape.radius?radius/shape.radius:0), z = Math.cos(shape.angle*DEG), length = Math.hypot(slope,z);
  let direction = [Math.cos(angle)*slope/length,Math.sin(angle)*slope/length,z/length];
  if (shape.type === 8) { const distance=random()*shape.length; position=position.map((v,i)=>v+direction[i]*distance); }
  position=rotateEuler(position.map((v,i)=>v*shape.scale[i]),shape.rotation).map((v,i)=>v+shape.position[i]);
  direction=rotateEuler(direction,shape.rotation);
  return { position, direction };
}

function sampleColor(color, time, random) {
  if (color.mode===0) return color.max.slice();
  if (color.mode===2) return color.min.map((v,i)=>mix(v,color.max[i],random));
  if (color.mode===3) { const a=evaluateGradient(color.minGradient,time),b=evaluateGradient(color.gradient,time);return a.map((v,i)=>mix(v,b[i],random)); }
  return evaluateGradient(color.gradient,color.mode===4?random:time);
}

function createPropParticles(action, config, sampleRoot) {
  const particles=[],fixedDdSystems=[],fixedTrailSystems=[],autoBoom02Systems=[],autoLoopSystems=[];
  const definitions=config.systems.filter(d=>action.kind==='unlock'?d.group===action.group:action.kind==='hammer'?d.group==='hammer':['spark','unlock','smoke','pen','boom'].includes(d.group));
  for (let systemIndex=0;systemIndex<definitions.length;systemIndex++) {
    const d=definitions[systemIndex], random=(action.randomFactory||seededRandom)((action.seed+systemIndex*104729)>>>0);
    const resolvedSystemSeed=(action.seed+systemIndex*104729)>>>0;
    if(supportsAutoLoop(action,d,resolvedSystemSeed)){const cache=action.autoLoopState;let system=cache&&cache.seed===resolvedSystemSeed?cache.system:null;if(!system){system=createAutoLoopSystem(d,0,sampleRoot,resolvedSystemSeed);if(cache){cache.seed=resolvedSystemSeed;cache.system=system;}}autoLoopSystems.push(system);particles.push(...system.particles);continue;}
    if(supportsAutoBoom02(action,d,resolvedSystemSeed)){const system=createAutoBoom02System(d,0,sampleRoot,resolvedSystemSeed);autoBoom02Systems.push(system);particles.push(...system.particles);continue;}
    if(supportsFixedTrail(action,d)){const system=createFixedTrailSystem(d,0,sampleRoot);fixedTrailSystems.push(system);particles.push(...system.particles);continue;}
    if(supportsFixedDd(action,d)){const system=createFixedDdSystem(d,0,sampleRoot);fixedDdSystems.push(system);particles.push(...system.particles);continue;}
    const activation=action.kind==='unlock'?0:d.group==='hammer'?.6000000238418579:d.group==='spark'?.10000000149011612:d.group==='unlock'?.05000000074505806:d.group==='boom'?action.hitAt:0;
    const delay=evaluateCurve(d.delay,0,random()),stop=action.kind==='unlock'||d.group==='boom'||d.group==='hammer'?action.endAt:action.hitAt;
    const births=[];
    if (!d.emission) continue;
    for (const burst of d.bursts) for (let cycle=0;cycle<burst.cycles;cycle++) { if(random()>burst.probability)continue;const count=Math.floor(evaluateCurve(burst.count,0,random()));for(let i=0;i<count;i++)births.push(activation+delay+burst.time+cycle*burst.interval); }
    const rate=evaluateCurve(d.rate,0,random()),duration=d.loop?stop-activation:d.duration;
    const firstBirth=action.birthStart&&rate>0?Math.max(1,Math.ceil((action.birthStart-activation-delay)*rate)):1;
    if(rate>0)for(let i=firstBirth;i<=Math.floor(Math.min(stop-activation-delay,duration)*rate+1e-7);i++)births.push(activation+delay+i/rate);
    // 按实际飞行路程发烟；源Unity Canvas世界尺度未动态采样，尺度用原粒子节点换算。
    const distanceRate=evaluateCurve(d.distance,0,random());
    if(distanceRate>0&&sampleRoot){let previous=sampleRoot(activation+delay,d),sum=0,next=1;const unit=Math.max(1,Math.abs(d.chain.at(-1).scale[0]));for(let t=activation+delay+STEP;t<=Math.min(stop,activation+delay+duration)+1e-8;t+=STEP){const current=sampleRoot(t,d);sum+=Math.hypot(current.x-previous.x,current.y-previous.y)/unit*distanceRate;while(next<=sum){births.push(t);next++;}previous=current;}}
    // 仅解锁恒定rate窗口使用；每次出生固定抽取21次加Cone的2次/ConeVolume的3次。
    if(firstBirth>1)random.skip((firstBirth-1)*(21+(d.shape.enabled?(d.shape.type===8?3:2):0)));
    births.sort((a,b)=>a-b);const live=[];
    for(const born of births){if(born>stop+1e-8)continue;while(live.length&&live[0]<=born)live.shift();if(live.length>=d.max)continue;
      const shape=samplePropShape(d.shape,random),speed=evaluateCurve(d.speed,0,random()),lifetime=evaluateCurve(d.lifetime,0,random());if(lifetime<=0)continue;
      const p={d,born,lifetime,position:shape.position,velocity:shape.direction.map(v=>v*speed),size:d.size.map(c=>evaluateCurve(c,0,random())),rotation:d.rotation.map(c=>evaluateCurve(c,0,random())),color:sampleColor(d.color,0,random()),random:Array.from({length:12},()=>random()),simulated:0,root:sampleRoot?sampleRoot(born,d):null,history:d.trail?[[0,...shape.position]]:null};
      particles.push(p);live.push(born+lifetime);live.sort((a,b)=>a-b);
    }
  }
  function advance(p,dt){const d=p.d,t=clamp((p.simulated+dt/2)/p.lifetime);const acceleration=d.force?d.force.axes.map((c,i)=>evaluateCurve(c,t,p.random[i])):[0,0,0];acceleration[1]+=-9.8100004196167*evaluateCurve(d.gravity,t,p.random[3]);
    const extra=d.velocity?d.velocity.axes.map((c,i)=>evaluateCurve(c,t,p.random[i+4])):[0,0,0],modifier=d.velocity?evaluateCurve(d.velocity.speed,t,p.random[7]):1;
    const velocity=p.velocity.map((v,i)=>(v+extra[i])*modifier),speed=Math.hypot(...velocity),limit=d.limit?evaluateCurve(d.limit.curve,t,p.random[8]):Infinity,damping=speed>limit?(limit+(speed-limit)*(1-d.limit.dampen)**(dt*60))/speed:1;
    // 原四个解锁Noise系统按各自已核轨迹分派；其他发射器沿既有采样。
    for(let i=0;i<3;i++){p.position[i]+=velocity[i]*damping*dt+acceleration[i]*dt*dt/2;p.velocity[i]=p.velocity[i]*damping+acceleration[i]*dt;}p.simulated+=dt;
    if(p.history)p.history.push([p.simulated,...p.position]);
  }
  function sample(age,currentAction){const sprites=[];
    for(const system of fixedDdSystems)system.sample(age);
    for(const system of fixedTrailSystems)system.sample(age);
    for(const system of autoBoom02Systems)system.sample(age);
    for(const system of autoLoopSystems)system.sample(age);
    for(const p of particles){const lived=age-p.born;if(p.fixedDd?!p.fixedDdVisible:p.fixedTrail?!p.fixedTrailVisible:p.autoBoom02?!p.autoBoom02Visible:p.autoLoop?!p.autoLoopVisible:lived<0||lived>=p.lifetime)continue;if(!p.fixedDd&&!p.fixedTrail&&!p.autoBoom02&&!p.autoLoop)while(p.simulated+STEP<=lived+1e-10)advance(p,STEP);const copy={...p,position:p.position.slice(),velocity:p.velocity.slice(),history:null};if(!p.fixedDd&&!p.fixedTrail&&!p.autoBoom02&&!p.autoLoop&&lived>p.simulated)advance(copy,lived-p.simulated);
      const d=p.d,t=clamp(p.autoLoop?p.autoLoopAge:(p.fixedTrail||p.autoBoom02?p.simulated:lived)/p.lifetime),root=d.space===1?p.root:sampleRoot?sampleRoot(age,d):{x:action.point.x,y:action.point.y,scale:1,rotation:0},color=d.colorLife?sampleColor(d.colorLife,t,p.random[9]).map((v,i)=>v*p.color[i]):p.color.slice();
      if(d.group==='spark')color[3]*=root.sparkAlpha===undefined?1:root.sparkAlpha;if(d.group==='pen')color[3]*=root.penAlpha===undefined?1:root.penAlpha;
      const transform=d.chain.map(node=>({ ...node,position:node.position.slice(),scale:node.scale.slice() }));
      if(action.kind==='rocket'&&d.group!=='boom'){
        const animationRoot=transform.find(node=>node.name==='anim');if(animationRoot)animationRoot.position[1]=root.rootY||0;
        if(d.group==='spark'){
          const rocket=transform.find(node=>node.name==='rocket');if(rocket){rocket.position[1]=root.rocketY;rocket.scale=root.appearScale;}
          const follower=transform.find(node=>node.name==='guadian');if(follower&&root.tx){follower.position=[root.tx[4],root.tx[5],0];follower.scale=[Math.hypot(root.tx[0],root.tx[2]),Math.hypot(root.tx[1],root.tx[3]),1];}
        }
      }
      const position=transformPoint(copy.position,transform),scale=transform.reduce((sc,node)=>sc.map((v,i)=>v*Math.abs(node.scale[i])*(node.uiScale?node.uiScale[i]:1)),[1,1,1]),size=p.size[0]*(d.sizeLife?evaluateCurve(d.sizeLife[0],t,p.random[10]):1);
      let sx=size*scale[0],sy=(d.size3D?p.size[1]:p.size[0])*(d.sizeLife?evaluateCurve(d.sizeLife[d.sizeAxes?1:0],t,p.random[10]):1)*scale[1];
      const velocity=transformPoint(copy.velocity,transform,true);let rotation=-p.rotation[2]-(d.angular?evaluateCurve(d.angular[2],t,p.random[11])*lived:0);
      if(d.render.mode===1){const speed=Math.hypot(velocity[0],velocity[1]);rotation=Math.atan2(-velocity[1],velocity[0])+Math.PI/2;sy=Math.abs(sy*d.render.lengthScale+speed*d.render.velocityScale);}
      let uv=[0,0,1,1];if(d.uv){const count=d.uv.tiles[0]*d.uv.tiles[1],frame=evaluateCurve(d.uv.start,0,p.random[0])+evaluateCurve(d.uv.frame,t,p.random[1])*d.uv.cycles,index=Math.floor(((frame%1)+1)%1*count);uv=[(index%d.uv.tiles[0])/d.uv.tiles[0],Math.floor(index/d.uv.tiles[0])/d.uv.tiles[1],1/d.uv.tiles[0],1/d.uv.tiles[1]];}
      const qx=Math.cos(rotation),qy=Math.sin(rotation),c=Math.cos(root.rotation||0),s=Math.sin(root.rotation||0),rootScale=root.scale||1,anchorX=root.x+(c*position[0]+s*position[1])*rootScale,anchorY=root.y+(s*position[0]-c*position[1])*rootScale;
      if(d.render.trailOnly&&d.trail){
        // 新解锁Trail的原寿命为粒子寿命比例；旧锤子/火箭配置不改其既有采样。
        const lifetime=evaluateCurve(d.trail.lifetime,t,p.random[0])*(d.trail.lifetimeIsParticleFraction?p.lifetime:1),history=p.fixedTrail?p.history:p.history.filter(row=>row[0]>=lived-lifetime).concat([[lived,...copy.position]]);
        const trailColor=d.trail.colorLife?sampleColor(d.trail.colorLife,t,p.random[9]).map((v,i)=>v*(d.trail.inheritParticleColor?color[i]:1)):color;
        const screen=history.map(row=>{const p=transformPoint(row.slice(1),transform);return [root.x+(c*p[0]+s*p[1])*rootScale,root.y+(s*p[0]-c*p[1])*rootScale];});
        for(let index=1;index<screen.length;index++){const a=screen[index-1],b=screen[index],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);if(length<=1e-8)continue;const width=(d.trail.sizeAffectsWidth?sx:scale[0])*evaluateCurve(d.trail.width,index/(screen.length-1),p.random[1])*rootScale/2,nx=-dy/length*width,ny=dx/length*width,u0=(index-1)/(screen.length-1),u1=index/(screen.length-1);sprites.push({vertices:[a[0]+nx,a[1]+ny,u0,0,b[0]+nx,b[1]+ny,u1,0,a[0]-nx,a[1]-ny,u0,1,b[0]-nx,b[1]-ny,u1,1],color:trailColor,custom:[0,0,0,0],material:d.material,sort:d.render.sort});}
        continue;
      }
      const vertices=[];for(const [x,y,u,v]of [[-.5,-.5,0,0],[.5,-.5,1,0],[-.5,.5,0,1],[.5,.5,1,1]]){const px=x*sx,py=y*sy;let rx=qx*px-qy*py,ry=qy*px+qx*py;if(d.rotation3D){const rotated=rotateEuler([px,-py,0],p.rotation.map((v,i)=>(v+(d.angular&&d.angularAxes?evaluateCurve(d.angular[i],t,p.random[11])*lived:0))/DEG));rx=rotated[0];ry=-rotated[1];}vertices.push(anchorX+(c*rx-s*ry)*rootScale,anchorY+(s*rx+c*ry)*rootScale,uv[0]+u*uv[2],uv[1]+v*uv[3]);}
      const custom=d.custom&&d.custom.mode===1?d.custom.axes.map((curve,i)=>evaluateCurve(curve,t,p.random[i])):[0,0,0,0];
      sprites.push({vertices,color,custom,material:d.material,sort:d.render.sort});
    }
    return sprites.sort((a,b)=>a.sort-b.sort);
  }
  return {sample,particles};
}

module.exports={createPropParticles,samplePropShape,transformPoint,quaternion};
