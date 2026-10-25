'use strict';
const { finishGLFrame } = require('./gl-frame-sync');
const material = require('../assets/background/material-data');
const clamp = value => Math.min(1, Math.max(0, value));
const wrap = (value, size) => (value % size + size) % size;

// 原单位Quad按1080×2160覆盖屏幕，再乘1.05；中心始终跟随相机。
function coverQuad(width, height) {
  const h = Math.max(height, width / material.designAspect) * material.overscan;
  return { width: h * material.designAspect, height: h };
}

// 输入是屏幕左上原点坐标，返回原Shader实际采样的底部原点UV。
function backgroundUV(x, y, width, height) {
  const quad = coverQuad(width, height), center = material.detailOffsetY + .5;
  const u = .5 + (x - width / 2) / quad.width, v = .5 - (y - height / 2) / quad.height;
  return [((u - .5) * material.detailTiling) * (width / height) / (material.textureWidth / material.textureHeight) + .5, (v - center) * material.detailTiling + center];
}

function adjustedBase() {
  const color = material.baseColor.slice(0, 3).map(value => (value + material.brightness - .5) * material.contrast + .5);
  const gray = color[0] * .298999995 + color[1] * .587000012 + color[2] * .114;
  return color.map(value => gray + (value - gray) * material.saturation);
}

// 原SoftLight是多项式，且强度为2×纹理Alpha×DetailStrength。
function shadeBackground(sample, base = adjustedBase(), output = []) {
  const weight = clamp(2 * sample[3] * material.detailStrength);
  for (let c = 0; c < 3; c++) {
    const soft = base[c] * base[c] * (1 - 2 * sample[c]) + 2 * sample[c] * base[c];
    output[c] = clamp(base[c] + (soft - base[c]) * weight);
  }
  output[3] = material.baseColor[3];
  return output;
}

// PNG是顶部原点；与GL上传UNPACK_FLIP_Y_WEBGL=true一致，保留跨边界双线性采样。
function sampleRepeatBilinear(pixels, width, height, u, v, output = []) {
  const x = (u - Math.floor(u)) * width - .5, y = (1 - (v - Math.floor(v))) * height - .5;
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const a = (wrap(iy, height) * width + wrap(ix, width)) * 4;
  const b = (wrap(iy, height) * width + wrap(ix + 1, width)) * 4;
  const c = (wrap(iy + 1, height) * width + wrap(ix, width)) * 4;
  const d = (wrap(iy + 1, height) * width + wrap(ix + 1, width)) * 4;
  for (let channel = 0; channel < 4; channel++) output[channel] = ((pixels[a + channel] * (1 - fx) + pixels[b + channel] * fx) * (1 - fy) + (pixels[c + channel] * (1 - fx) + pixels[d + channel] * fx) * fy) / 255;
  return output;
}

function backgroundShaders(webgl2) {
  const version = webgl2 ? '#version 300 es\n' : '';
  const input = webgl2 ? 'in' : 'attribute', varyingOut = webgl2 ? 'out' : 'varying', varyingIn = webgl2 ? 'in' : 'varying';
  return {
    vertex: version + 'precision highp float;' + input + ' vec2 position;uniform vec2 quadFraction;' + varyingOut + ' highp vec2 quadUV;void main(){gl_Position=vec4(position,0.0,1.0);quadUV=vec2(.5)+position*.5*quadFraction;}',
    fragment: version + 'precision highp float;uniform mediump sampler2D detailTexture;uniform vec2 viewport;uniform vec2 textureSize;uniform mediump vec4 baseColor;uniform mediump float brightness;uniform mediump float contrast;uniform mediump float saturation;uniform mediump float detailTiling;uniform mediump float detailStrength;uniform mediump float detailOffsetY;' + varyingIn + ' highp vec2 quadUV;' + (webgl2 ? 'out mediump vec4 target;' : '') + 'void main(){mediump float center=detailOffsetY+.5;vec2 p=(quadUV-vec2(.5,center))*detailTiling;vec2 uv=vec2(p.x*max(viewport.x/max(viewport.y,1e-8),1e-8)/(textureSize.x/textureSize.y)+.5,p.y+center);mediump vec4 t=' + (webgl2 ? 'texture' : 'texture2D') + '(detailTexture,uv);mediump vec3 base=baseColor.rgb+brightness;vec3 value=(base-.5)*contrast+.5;mediump float gray=dot(value,vec3(.298999995,.587000012,.114));mediump vec3 difference=value-gray;base=difference*saturation+gray;mediump vec3 square=base*base;vec3 soft=(1.0-2.0*t.rgb)*square+2.0*t.rgb*base;float weight=clamp(dot(t.aa,vec2(detailStrength)),0.0,1.0);mediump vec3 delta=soft-base;mediump vec3 blended=base+delta*weight;' + (webgl2 ? 'target' : 'gl_FragColor') + '=vec4(clamp(blended,0.0,1.0),baseColor.a);}'
  };
}

async function createBackgroundRenderer({ canvas, createCanvas, loadImage, width, height, ratio = 1 }) {
  const image = await loadImage(material.texture), cache = createCanvas(), context = cache.getContext('2d');
  let currentWidth, currentHeight, currentRatio, mode, error = null, cacheBuilds = 0, disposed = false, sourcePixels;
  const stats = { glDraws: 0, releasedContexts: 0 };

  function renderGL(target, pixelWidth, pixelHeight) {
    let gl, webgl2 = false, program, buffer, texture;
    const shaders = [];
    try {
      const options = { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true, premultipliedAlpha: false };
      try { gl = target.getContext('webgl2', options); webgl2 = !!gl; } catch (_) {}
      if (!gl) { try { gl = target.getContext('webgl', options); } catch (_) {} }
      if (!gl) return false;
      const source = backgroundShaders(webgl2);
      const compile = (type, text) => { const shader = gl.createShader(type); shaders.push(shader); gl.shaderSource(shader, text); gl.compileShader(shader); if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader)); return shader; };
      program = gl.createProgram(); gl.attachShader(program, compile(gl.VERTEX_SHADER, source.vertex)); gl.attachShader(program, compile(gl.FRAGMENT_SHADER, source.fragment)); gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
      gl.useProgram(program); gl.viewport(0, 0, pixelWidth, pixelHeight); gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.disable(gl.DITHER);
      buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
      const position = gl.getAttribLocation(program, 'position'); gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      const location = name => gl.getUniformLocation(program, name), quad = coverQuad(pixelWidth, pixelHeight);
      gl.uniform2f(location('quadFraction'), pixelWidth / quad.width, pixelHeight / quad.height); gl.uniform2f(location('viewport'), pixelWidth, pixelHeight); gl.uniform2f(location('textureSize'), image.width, image.height); gl.uniform4fv(location('baseColor'), material.baseColor);
      for (const name of ['brightness','contrast','saturation','detailTiling','detailStrength','detailOffsetY']) gl.uniform1f(location(name), material[name]);
      texture = gl.createTexture(); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture); gl.uniform1i(location('detailTexture'), 0);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); if (typeof wx === 'undefined') gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); stats.glDraws++;
      const code = gl.getError(); if (code !== gl.NO_ERROR) throw new Error('原背景GL错误：' + code);
      finishGLFrame(gl); context.drawImage(target, 0, 0); mode = webgl2 ? 'webgl2-cache' : 'webgl1-cache';
      return true;
    } catch (failure) { error = String(failure.message || failure); return false; }
    finally {
      if (gl) {
        if (texture) gl.deleteTexture(texture); if (buffer) gl.deleteBuffer(buffer); if (program) gl.deleteProgram(program); for (const shader of shaders) gl.deleteShader(shader);
        const lose = gl.getExtension('WEBGL_lose_context'); if (lose) { lose.loseContext(); stats.releasedContexts++; }
      }
      target.width = target.height = 0;
    }
  }

  function renderCPU(pixelWidth, pixelHeight) {
    // 原纹理全不透明；Canvas读回不会丢失透明像素的RGB。本回退按同一原公式逐像素计算。
    try {
      if (!sourcePixels) {
        const source = createCanvas(); source.width = image.width; source.height = image.height;
        const read = source.getContext('2d'); read.drawImage(image, 0, 0); sourcePixels = read.getImageData(0, 0, image.width, image.height).data; source.width = source.height = 0;
      }
      const result = context.createImageData(pixelWidth, pixelHeight), base = adjustedBase(), sample = [], color = [];
      const first = backgroundUV(.5, .5, pixelWidth, pixelHeight), nextX = backgroundUV(1.5, .5, pixelWidth, pixelHeight), nextY = backgroundUV(.5, 1.5, pixelWidth, pixelHeight);
      const stepU = nextX[0] - first[0], stepV = nextY[1] - first[1];
      for (let y = 0; y < pixelHeight; y++) for (let x = 0; x < pixelWidth; x++) {
        sampleRepeatBilinear(sourcePixels, image.width, image.height, first[0] + x * stepU, first[1] + y * stepV, sample); shadeBackground(sample, base, color);
        const offset = (y * pixelWidth + x) * 4; for (let c = 0; c < 4; c++) result.data[offset + c] = Math.round(color[c] * 255);
      }
      context.putImageData(result, 0, 0); mode = 'cpu-formula-cache';
    } catch (failure) {
      error = String(failure.message || failure); mode = 'base-color-fallback';
      context.fillStyle = 'rgb(' + adjustedBase().map(value => Math.round(clamp(value) * 255)).join(',') + ')'; context.fillRect(0, 0, pixelWidth, pixelHeight);
    }
  }

  function resize(view) {
    if (disposed) return false;
    const nextRatio = view.ratio || 1;
    if (currentWidth === view.width && currentHeight === view.height && currentRatio === nextRatio) return false;
    currentWidth = view.width; currentHeight = view.height; currentRatio = nextRatio;
    const w = Math.max(1, Math.round(currentWidth * currentRatio)), h = Math.max(1, Math.round(currentHeight * currentRatio)); cache.width = w; cache.height = h;
    const target = canvas || createCanvas(); canvas = null; target.width = w; target.height = h;
    if (!renderGL(target, w, h)) renderCPU(w, h);
    cacheBuilds++; return true;
  }
  resize({ width, height, ratio });
  return {
    draw(ctx) { if (disposed) return false; ctx.drawImage(cache, 0, 0, currentWidth, currentHeight); return true; },
    resize,
    dispose() { disposed = true; sourcePixels = null; cache.width = cache.height = 0; },
    get mode() { return mode; }, get cacheBuilds() { return cacheBuilds; }, get error() { return error; },
    get stats() { return { ...stats }; }, get cacheCanvas() { return cache; }
  };
}

module.exports = { createBackgroundRenderer, coverQuad, backgroundUV, shadeBackground, sampleRepeatBilinear, backgroundShaders };
