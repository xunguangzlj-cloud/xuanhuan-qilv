'use strict';
const { finishGLFrame } = require('./gl-frame-sync');

// 保留原编译fragment中的采样、溶解、重映射、扭曲和描边公式，只替换平台接口及离屏传输。
function preparePropFragment(combined, additive = false, repeatSamplers = []) {
  const marker = combined.indexOf('#ifdef FRAGMENT');
  if (marker < 0) throw new Error('原道具着色器缺少FRAGMENT段');
  let source = combined.slice(marker + '#ifdef FRAGMENT'.length).replace(/\s*#endif\s*$/, '');
  if (/\bin\s+(?:(?:lowp|mediump|highp)\s+)?\w+\s+vs_TEXCOORD5\s*;/.test(source)) throw new Error('道具粒子需使用无UNITY_UI_CLIP_RECT的原变体，裁剪由主Canvas继承');
  // 原DistortionDisslove用UV0/Custom1命名；只映射到现有相同语义的顶点输入。
  if (/\bvs_TEXCOORD0\b/.test(source)) source = source.replace(/\bvs_TEXCOORD0\b/g, 'vs_TEXCOORD3').replace(/\bvs_TEXCOORD1\b/g, 'vs_TEXCOORD4').replace(/(in\s+(?:(?:lowp|mediump|highp)\s+)?)vec2(\s+vs_TEXCOORD3\s*;)/g, '$1vec4$2');
  source = source.replace(/^#version[^\n]*\n/gm, '')
    .replace(/#define HLSLCC_ENABLE_UNIFORM_BUFFERS 1/g, '#define HLSLCC_ENABLE_UNIFORM_BUFFERS 0')
    .replace(/#define UNITY_SUPPORTS_UNIFORM_LOCATION 1/g, '#define UNITY_SUPPORTS_UNIFORM_LOCATION 0')
    .replace(/layout\s*\([^)]*\)\s*out\s+(?:(?:lowp|mediump|highp)\s+)?vec4\s+SV_Target0\s*;/g, '')
    .replace(/^in\s+((?:(?:lowp|mediump|highp)\s+)?\w+\s+\w+\s*;)/gm, 'varying $1')
    .replace(/\btexture\s*\(/g, 'texture2D(')
    .replace(/\bSV_Target0\b/g, 'gl_FragColor')
    .replace(/void\s+main\s*\(\s*\)/, 'void originalFragment()');
  for (const sampler of repeatSamplers) {
    const name = 'sampleRepeat' + sampler.key;
    source = source.replace(new RegExp('\\btexture2D\\(\\s*' + sampler.key + '\\s*,', 'g'), name + '(');
    // WebGL1的NPOT纹理只能Clamp；按原像素中心取四点，恢复跨边缘的Linear+Repeat，不缩放原图。
    const helper = 'vec4 ' + name + '(highp vec2 uv){highp vec2 size=vec2(' + sampler.width + '.0,' + sampler.height + '.0);highp vec2 p=fract(uv)*size-0.5;highp vec2 lo=floor(p);highp vec2 weight=fract(p);highp vec2 a=(mod(lo,size)+0.5)/size;highp vec2 b=(mod(lo+1.0,size)+0.5)/size;return mix(mix(texture2D(' + sampler.key + ',vec2(a.x,a.y)),texture2D(' + sampler.key + ',vec2(b.x,a.y)),weight.x),mix(texture2D(' + sampler.key + ',vec2(a.x,b.y)),texture2D(' + sampler.key + ',vec2(b.x,b.y)),weight.x),weight.y);}\n';
    source = source.replace('void originalFragment()', helper + 'void originalFragment()');
  }
  // 原state为SrcAlpha、目标_Dst，Alpha为One/OneMinusSrcAlpha。
  // 加法批次把已乘Alpha的RGB以不透明传输，经主Canvas lighter相加；目标游戏画布已有不透明背景。
  return source + '\nvoid main(){originalFragment();float coverage=clamp(gl_FragColor.a,0.0,1.0);gl_FragColor=vec4(gl_FragColor.rgb*coverage,' + (additive ? '1.0' : 'coverage') + ');}\n';
}

function propVertices(sprites, coordinateScale = 1) {
  const result = [];
  for (const sprite of sprites) {
    const color = (sprite.color || [1,1,1,1]).map(value => Math.round(Math.max(0,Math.min(1,value))*255)/255), custom = sprite.custom || [0,0,0,0];
    for (const index of [0,1,2,2,1,3]) result.push(sprite.vertices[index*4]*coordinateScale,sprite.vertices[index*4+1]*coordinateScale,sprite.vertices[index*4+2],sprite.vertices[index*4+3],...color,...custom);
  }
  return new Float32Array(result);
}

function materialBlend(material) {
  const src = material.blend ? material.blend.src : 5, dst = material.blend ? material.blend.dst : material.floats._Dst;
  if (src !== 5 || dst !== 1 && dst !== 10) throw new Error('尚未恢复的道具材质混合：' + src + '/' + dst);
  return {src,dst,additive:dst===1};
}

async function createPropParticleRenderer({canvas,createCanvas,loadImage,width,height,ratio=1,config}) {
  const materials = config.materials, blends = materials.map(materialBlend), limitations = [];
  const paths = [...new Set(materials.flatMap(material => material.textures.filter(texture => texture.path).map(texture => texture.path)))];
  const images = Object.fromEntries(await Promise.all(paths.map(async path => [path,await loadImage(path)])));
  const powerOfTwo = image => image && [image.width,image.height].every(value=>(value&(value-1))===0);
  const repeatSampler = record => {
    const image = record && images[record.path];
    return image && !powerOfTwo(image) && record.wrap && record.wrap.every(value=>value===0) && record.filterMode===1;
  };
  let gl = null;
  try { gl = canvas.getContext('webgl',{alpha:true,premultipliedAlpha:true,antialias:false,preserveDrawingBuffer:true}); } catch (_) {}
  const programs = new Map(), textures = new Map(), bindings = [], enabled = new Set(), tinted = new Map();
  let buffer = null;
  const component = (value,index,keys,otherwise) => value == null ? otherwise : Array.isArray(value) ? value[index] : value[keys[index]];
  const vector = (value,keys) => keys.map((_,i) => component(value,i,keys,0));
  const vertex = 'attribute vec2 aPosition;attribute vec2 aUV;attribute vec4 aColor;attribute vec4 aCustom;uniform vec2 uViewport;varying mediump vec4 vs_COLOR0;varying mediump vec4 vs_TEXCOORD3;varying mediump vec4 vs_TEXCOORD4;void main(){gl_Position=vec4(aPosition/uViewport*vec2(2.0,-2.0)+vec2(-1.0,1.0),0.0,1.0);vs_COLOR0=aColor;vs_TEXCOORD3=vec4(aUV,0.0,0.0);vs_TEXCOORD4=aCustom;}';

  function dispose() {
    tinted.clear();
    if (gl) { for(const location of enabled)gl.disableVertexAttribArray(location);enabled.clear();if(buffer)gl.deleteBuffer(buffer);for(const item of programs.values())gl.deleteProgram(item.program);for(const texture of textures.values())gl.deleteTexture(texture); }
    buffer=null;programs.clear();textures.clear();bindings.length=0;
  }
  if (gl) {
    function shader(type,source) {const item=gl.createShader(type);gl.shaderSource(item,source);gl.compileShader(item);if(!gl.getShaderParameter(item,gl.COMPILE_STATUS)){const error=gl.getShaderInfoLog(item);gl.deleteShader(item);throw new Error('原道具Shader编译失败：'+error);}return item;}
    function texture(record) {
      const wrap=record&&record.wrap||[1,1],filter=record&&record.filterMode===0?0:1,path=record&&record.path||'',key=path+':'+wrap.join(',')+':'+filter;
      if(textures.has(key))return textures.get(key);
      const item=gl.createTexture();textures.set(key,item);gl.bindTexture(gl.TEXTURE_2D,item);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
      const image=images[path];
      if(image)gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);else gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array(record&&record.defaultColor||[255,255,255,255]));
      const manualRepeat=repeatSampler(record);
      const wrapValue=(value)=>value===1?gl.CLAMP_TO_EDGE:value===2?gl.MIRRORED_REPEAT:gl.REPEAT;
      if(image&&!powerOfTwo(image)&&wrap.some(value=>value!==1)&&!manualRepeat)limitations.push('WebGL1非2次幂贴图无法重复采样，已Clamp回退：'+path);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,!image||powerOfTwo(image)?wrapValue(wrap[0]):gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,!image||powerOfTwo(image)?wrapValue(wrap[1]):gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,filter===0||manualRepeat?gl.NEAREST:gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,filter===0||manualRepeat?gl.NEAREST:gl.LINEAR);return item;
    }
    try {
      buffer=gl.createBuffer();
      for(let index=0;index<materials.length;index++){
        const material=materials[index],repeatSamplers=material.textures.filter(repeatSampler).map(record=>({key:record.key,width:images[record.path].width,height:images[record.path].height})),fragment=preparePropFragment(material.shader,blends[index].additive,repeatSamplers),key=fragment;
        if(!programs.has(key)){
          let vertexSource=vertex;
          for(const name of ['vs_COLOR0','vs_TEXCOORD3','vs_TEXCOORD4']){
            const precision=fragment.match(new RegExp('varying\\s+(lowp|mediump|highp)\\s+vec4\\s+'+name+'\\s*;'))?.[1]||'mediump';
            vertexSource=vertexSource.replace('varying mediump vec4 '+name,'varying '+precision+' vec4 '+name);
          }
          const first=shader(gl.VERTEX_SHADER,vertexSource);let second;
          try {second=shader(gl.FRAGMENT_SHADER,fragment);}catch(error){gl.deleteShader(first);throw error;}
          const program=gl.createProgram();gl.attachShader(program,first);gl.attachShader(program,second);gl.linkProgram(program);gl.deleteShader(first);gl.deleteShader(second);
          if(!gl.getProgramParameter(program,gl.LINK_STATUS)){const error=gl.getProgramInfoLog(program);gl.deleteProgram(program);throw new Error('原道具Shader链接失败：'+error);}
          const uniforms=[];
          for(let i=0;i<gl.getProgramParameter(program,gl.ACTIVE_UNIFORMS);i++){const info=gl.getActiveUniform(program,i);uniforms.push({name:info.name.replace(/\[0\]$/,''),type:info.type,location:gl.getUniformLocation(program,info.name)});}
          programs.set(key,{program,uniforms,attributes:[['aPosition',2,0],['aUV',2,8],['aColor',4,16],['aCustom',4,32]].map(([name,size,offset])=>({location:gl.getAttribLocation(program,name),size,offset}))});
        }
        const item=programs.get(key),samplers=item.uniforms.filter(u=>u.type===gl.SAMPLER_2D).map(u=>({uniform:u,texture:texture(material.textures.find(record=>record.key===u.name))}));
        bindings.push({...item,material,samplers});
      }
    } catch(error) {dispose();throw error;}
  } else limitations.push('无WebGL时只绘制原主贴图与乘色近似；未恢复Canvas上的原重映射、溶解、扭曲和描边公式。');
  function resize(view){width=view.width;height=view.height;ratio=view.ratio;canvas.width = gl ? 1 : Math.round(width * ratio); canvas.height = gl ? 1 : Math.round(height * ratio);}
  resize({width,height,ratio});

  function bindUniforms(binding,time) {
    const material=binding.material;
    for(const uniform of binding.uniforms){
      if(uniform.type===gl.SAMPLER_2D)continue;
      const name=uniform.name;let value;
      if(name==='uViewport')value=[width,height];
      else if(name==='_Time')value=[time/20,time,time*2,time*3];
      else if(name==='_TimeParameters')value=[time,Math.sin(time),Math.cos(time),0];
      else if(name.endsWith('_ST')){const record=material.textures.find(texture=>texture.key+'_ST'===name);value=record?[component(record.scale,0,['x','y'],1),component(record.scale,1,['x','y'],1),component(record.offset,0,['x','y'],0),component(record.offset,1,['x','y'],0)]:[1,1,0,0];}
      else if(Object.prototype.hasOwnProperty.call(material.colors,name))value=vector(material.colors[name],['r','g','b','a']);
      else value=material.floats[name]??0;
      if(uniform.type===gl.FLOAT)gl.uniform1f(uniform.location,value);
      else if(uniform.type===gl.FLOAT_VEC2)gl.uniform2fv(uniform.location,value);
      else if(uniform.type===gl.FLOAT_VEC3)gl.uniform3fv(uniform.location,value);
      else if(uniform.type===gl.FLOAT_VEC4)gl.uniform4fv(uniform.location,value);
      else if(uniform.type===gl.INT||uniform.type===gl.BOOL)gl.uniform1i(uniform.location,value);
    }
    binding.samplers.forEach((sampler,index)=>{gl.activeTexture(gl.TEXTURE0+index);gl.bindTexture(gl.TEXTURE_2D,sampler.texture);gl.uniform1i(sampler.uniform.location,index);});
  }
  function drawFallback(ctx,sprites) {
    if(!createCanvas)return;
    for(const sprite of sprites){
      const material=materials[sprite.material],record=material.textures.find(t=>t.key==='_MainTex'||t.key==='_maintex'),image=record&&images[record.path];if(!image)continue;
      const tint=vector(material.colors._Main_Tex_Color||material.colors._Maincolor||[1,1,1,1],['r','g','b','a']),color=sprite.color||[1,1,1,1],rgb=color.slice(0,3).map((value,i)=>Math.round(Math.max(0,Math.min(1,value*tint[i]))*255)),key=record.path+':'+rgb.join(',');
      if(!tinted.has(key)){const target=createCanvas();target.width=image.width;target.height=image.height;const context=target.getContext('2d');context.drawImage(image,0,0);context.globalCompositeOperation='multiply';context.fillStyle='rgb('+rgb.join(',')+')';context.fillRect(0,0,target.width,target.height);context.globalCompositeOperation='destination-in';context.drawImage(image,0,0);tinted.set(key,target);}
      const atlas=tinted.get(key),v=sprite.vertices;
      for(const indices of [[0,1,2],[2,1,3]]){
        const p=indices.map(i=>v.slice(i*4,i*4+4)),u=p.map(x=>x[2]*atlas.width),w=p.map(x=>x[3]*atlas.height),det=(u[1]-u[0])*(w[2]-w[0])-(u[2]-u[0])*(w[1]-w[0]);if(Math.abs(det)<1e-8)continue;
        const a=((p[1][0]-p[0][0])*(w[2]-w[0])-(p[2][0]-p[0][0])*(w[1]-w[0]))/det,b=((p[1][1]-p[0][1])*(w[2]-w[0])-(p[2][1]-p[0][1])*(w[1]-w[0]))/det,c=((u[1]-u[0])*(p[2][0]-p[0][0])-(u[2]-u[0])*(p[1][0]-p[0][0]))/det,d=((u[1]-u[0])*(p[2][1]-p[0][1])-(u[2]-u[0])*(p[1][1]-p[0][1]))/det;
        ctx.save();ctx.globalAlpha*=Math.max(0,Math.min(1,color[3]*tint[3]));ctx.globalCompositeOperation=blends[sprite.material].additive?'lighter':'source-over';ctx.beginPath();ctx.moveTo(p[0][0],p[0][1]);ctx.lineTo(p[1][0],p[1][1]);ctx.lineTo(p[2][0],p[2][1]);ctx.closePath();ctx.clip();ctx.transform(a,b,c,d,p[0][0]-a*u[0]-c*w[0],p[0][1]-b*u[0]-d*w[0]);ctx.drawImage(atlas,0,0);ctx.restore();
      }
    }
  }
  function draw(ctx,sprites,{coordinateScale=1,time=0}={}) {
    if(!sprites.length)return false;
    if(!gl){drawFallback(ctx,sprites);return true;}
      // 只在首次实际绘制时分配全尺寸附件，保持原视口和材质。
      if (canvas.width !== Math.round(width * ratio)) canvas.width = Math.round(width * ratio);
      if (canvas.height !== Math.round(height * ratio)) canvas.height = Math.round(height * ratio);
    // 不跨过异材质精灵重新排序，保留原发射器与Renderer的前后覆盖顺序。
    for(let first=0;first<sprites.length;){
      const index=sprites[first].material,binding=bindings[index];let last=first+1;while(last<sprites.length&&sprites[last].material===index)last++;
      gl.viewport(0,0,canvas.width,canvas.height);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);gl.useProgram(binding.program);gl.disable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,blends[index].additive?gl.ONE:gl.ONE_MINUS_SRC_ALPHA);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
      const attributes=new Set(binding.attributes.filter(a=>a.location>=0).map(a=>a.location));for(const location of enabled)if(!attributes.has(location)){gl.disableVertexAttribArray(location);enabled.delete(location);}
      for(const attribute of binding.attributes)if(attribute.location>=0){gl.enableVertexAttribArray(attribute.location);enabled.add(attribute.location);gl.vertexAttribPointer(attribute.location,attribute.size,gl.FLOAT,false,48,attribute.offset);}
      bindUniforms(binding,time);const vertices=propVertices(sprites.slice(first,last),coordinateScale);gl.bufferData(gl.ARRAY_BUFFER,vertices,gl.DYNAMIC_DRAW);gl.drawArrays(gl.TRIANGLES,0,vertices.length/12);
      ctx.save();ctx.globalCompositeOperation=blends[index].additive?'lighter':'source-over';finishGLFrame(gl); ctx.drawImage(canvas,0,0,width/coordinateScale,height/coordinateScale);ctx.restore();first=last;
    }
    return true;
  }
  return {draw,resize,dispose,gl,backend:gl?'webgl':'canvas-approximation',limitations};
}

module.exports={createPropParticleRenderer,preparePropFragment,propVertices,materialBlend};
