'use strict';
// 参数来自原ScreenShakeConfig资产；方向与波形为数值近似，未冒充DOTween随机路径。
const presets = {
  bomb: { priority:1, delay:.550000011920929, duration:.4000000059604645, amplitude:.15000000596046448, vibrato:20, randomness:0 },
  hammer: { priority:2, delay:.10000000149011612, duration:.4000000059604645, amplitude:.15000000596046448, vibrato:20, randomness:0 },
  rocket: { priority:3, delay:.15000000596046448, duration:.20000000298023224, amplitude:.12999999523162842, vibrato:20, randomness:25 }
};

function createScreenShake({ enabled = false, random = Math.random } = {}) {
  let active = null;
  const isEnabled = () => typeof enabled === 'function' ? !!enabled() : !!enabled;
  function trigger(kind) {
    const preset = presets[kind];
    if (!isEnabled() || !preset || active && preset.priority <= presets[active.kind].priority) return false;
    active = { kind, age:0, angles:Array.from({length:preset.vibrato+1},()=>((random()*2-1)*preset.randomness)*Math.PI/180) };
    return true;
  }
  function update(dt) {
    if (!active || !Number.isFinite(dt) || dt <= 0) return;
    active.age += dt;
    const preset=presets[active.kind];
    if (active.age + 1e-10 >= preset.delay + preset.duration) active = null;
  }
  function offset() {
    if (!active || !isEnabled()) return {x:0,y:0};
    const preset=presets[active.kind],t=(active.age-preset.delay)/preset.duration;
    if (t<=0 || t>=1) return {x:0,y:0};
    const position=t*preset.vibrato,index=Math.min(preset.vibrato-1,Math.floor(position)),fraction=position-index,angle=active.angles[index]+(active.angles[index+1]-active.angles[index])*fraction;
    // 原Ease=Linear、FadeOut=true；这里只近似内部DOShakePosition的往返路径。
    const amplitude=Math.sin(position*Math.PI*2)*preset.amplitude*(1-t);
    return {x:Math.cos(angle)*amplitude,y:Math.sin(angle)*amplitude};
  }
  return {trigger,update,offset,reset(){active=null;},get active(){return !!active;},snapshot(){return active?JSON.parse(JSON.stringify(active)):null;},restore(snapshot){active=snapshot?JSON.parse(JSON.stringify(snapshot)):null;}};
}

module.exports={createScreenShake,presets};
