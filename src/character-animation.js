'use strict';
const { finishGLFrame } = require('./gl-frame-sync');

// 原Spine数据离线求得骨矩阵、网格变形及离散状态，运行时保留原图集与三角形。
function prepareCharacter(model) {
  for (const animation of Object.values(model.animations)) {
    if (animation.bones) continue;
    animation.bones = animation.boneTracks.map(track => {
      const previous = [0, 0, 0, 0, 0, 0], rows = [];
      for (let cursor = 0; cursor < track.length; cursor += 7) {
        const row = [animation.times[track[cursor]]];
        for (let index = 0; index < 6; index++) { previous[index] += track[cursor + index + 1]; row.push(previous[index] / (index < 4 ? 10000 : 100)); }
        rows.push(row);
      }
      return rows;
    });
    delete animation.boneTracks; delete animation.times;
  }
  return model;
}

function sampleTrack(track, time) {
  if (!track.length) return null;
  let low = 0, high = track.length;
  while (low < high) { const mid = (low + high) >> 1; if (track[mid][0] <= time) low = mid + 1; else high = mid; }
  if (low === 0) return track[0];
  if (low === track.length || track[low - 1][0] === time) return track[low - 1];
  const a = track[low - 1], b = track[low], mix = (time - a[0]) / (b[0] - a[0]);
  return [time, ...a.slice(1).map((value, index) => value + (b[index + 1] - value) * mix)];
}

function verticesForPose(attachment, matrices, deforms) {
  const source = attachment.vertices, output = new Float32Array(attachment.worldLength);
  const deform = deforms[attachment.slot] || [];
  if (!attachment.bones) {
    const values = deform.length ? deform : source, matrix = matrices[attachment.bone];
    for (let index = 0; index < output.length; index += 2) {
      const x = values[index], y = values[index + 1];
      output[index] = x * matrix[0] + y * matrix[1] + matrix[4];
      output[index + 1] = x * matrix[2] + y * matrix[3] + matrix[5];
    }
    return output;
  }
  let boneCursor = 0, sourceCursor = 0, deformCursor = 0;
  for (let index = 0; index < output.length; index += 2) {
    let x = 0, y = 0;
    const count = attachment.bones[boneCursor++];
    for (let weightIndex = 0; weightIndex < count; weightIndex++) {
      const matrix = matrices[attachment.bones[boneCursor++]];
      const vx = source[sourceCursor] + (deform[deformCursor] || 0);
      const vy = source[sourceCursor + 1] + (deform[deformCursor + 1] || 0);
      const weight = source[sourceCursor + 2];
      x += (vx * matrix[0] + vy * matrix[1] + matrix[4]) * weight;
      y += (vx * matrix[2] + vy * matrix[3] + matrix[5]) * weight;
      sourceCursor += 3; deformCursor += 2;
    }
    output[index] = x; output[index + 1] = y;
  }
  return output;
}

function sampleCharacter(model, animationName, time) {
  prepareCharacter(model);
  const animation = model.animations[animationName];
  time = Math.max(0, Math.min(time, animation.duration));
  const matrices = animation.bones.map(track => sampleTrack(track, time).slice(1));
  const deforms = animation.deforms.map(track => track.length ? sampleTrack(track, time).slice(1) : []);
  let low = 0, high = animation.states.length;
  while (low < high) { const mid = (low + high) >> 1; if (animation.states[mid][0] <= time) low = mid + 1; else high = mid; }
  const state = animation.states[Math.max(0, low - 1)], draws = [];
  for (const slot of state[2]) {
    const id = state[1][slot];
    if (id < 0) continue;
    const attachment = model.attachments[id], slotColor = sampleTrack(animation.colors[slot], time).slice(1);
    const color = attachment.color.map((value, index) => value * slotColor[index]);
    if (color[3] <= 0) continue;
    draws.push({ id, vertices: verticesForPose(attachment, matrices, deforms), color });
  }
  return { animation: animationName, time, draws };
}

function createCharacterPlayer(data, { character = 'victory', random = Math.random, onLoop } = {}) {
  const model = data.characters[character];
  if (!model) throw new Error('缺少原角色数据：' + character);
  prepareCharacter(model);
  const idle = random() < 0.5 ? 'idle1' : 'idle2';
  let elapsed = 0, paused = false, lastLoop = -1;
  return {
    model,
    update(delta) {
      if (paused) return;
      elapsed += Math.max(0, delta);
      const idleTime = elapsed - model.animations.open.duration;
      if (idleTime >= 0) {
        const loop = Math.floor(idleTime / model.animations[idle].duration);
        if (loop !== lastLoop) { lastLoop = loop; if (onLoop) onLoop(idle, loop); }
      }
    },
    pause(value = true) { paused = value; },
    reset() { elapsed = 0; lastLoop = -1; },
    pose() {
      if (elapsed < model.animations.open.duration) return sampleCharacter(model, 'open', elapsed);
      return sampleCharacter(model, idle, (elapsed - model.animations.open.duration) % model.animations[idle].duration);
    },
    get elapsed() { return elapsed; },
    get idle() { return idle; },
  };
}

async function createCharacterRenderer({ canvas, loadImage, data, character = 'victory', width, height, ratio = 1, cropToPose = false }) {
  const model = data.characters[character], requestedCrop = cropToPose;
  const options = { alpha: true, antialias: true, premultipliedAlpha: true, preserveDrawingBuffer: true };
  let gl;
  try { gl = canvas.getContext('webgl', options); } catch (_) {}
  if (!gl) return null;
  let currentWidth = width, currentHeight = height, currentRatio = ratio, retainedBounds = null;
  const compile = (type, source) => {
    const shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { const message = gl.getShaderInfoLog(shader); gl.deleteShader(shader); throw new Error('原角色着色器编译失败：' + message); }
    return shader;
  };
  const vertex = compile(gl.VERTEX_SHADER, 'precision highp float;attribute vec2 position;attribute vec2 uv;uniform vec2 viewport;uniform vec3 anchor;varying vec2 textureUV;void main(){vec2 p=vec2(anchor.x+position.x*anchor.z,anchor.y-position.y*anchor.z);gl_Position=vec4(p*vec2(2.0,-2.0)/viewport+vec2(-1.0,1.0),0.0,1.0);textureUV=uv;}');
  const fragment = compile(gl.FRAGMENT_SHADER, 'precision highp float;uniform sampler2D atlas;uniform vec4 color;varying vec2 textureUV;void main(){gl_FragColor=texture2D(atlas,textureUV)*vec4(color.rgb*color.a,color.a);}');
  const program = gl.createProgram(); gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program); gl.deleteShader(vertex); gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { const message = gl.getProgramInfoLog(program); gl.deleteProgram(program); throw new Error('原角色着色器链接失败：' + message); }
  const location = { position: gl.getAttribLocation(program, 'position'), uv: gl.getAttribLocation(program, 'uv'), viewport: gl.getUniformLocation(program, 'viewport'), anchor: gl.getUniformLocation(program, 'anchor'), color: gl.getUniformLocation(program, 'color'), atlas: gl.getUniformLocation(program, 'atlas') };
  const buffers = [];
  function buffer(values, target = gl.ARRAY_BUFFER, usage = gl.STATIC_DRAW) { const value = gl.createBuffer(); gl.bindBuffer(target, value); gl.bufferData(target, values, usage); buffers.push(value); return value; }
  const entries = model.attachments.map(attachment => ({ positions: buffer(new Float32Array(attachment.worldLength), gl.ARRAY_BUFFER, gl.DYNAMIC_DRAW), uvs: buffer(new Float32Array(attachment.uvs)), indices: buffer(new Uint16Array(attachment.triangles), gl.ELEMENT_ARRAY_BUFFER) }));
  const image = await loadImage(model.image), texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); if (typeof wx === 'undefined') gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  function resize(view) { currentWidth = view.width; currentHeight = view.height; currentRatio = view.ratio || 1; cropToPose = requestedCrop && Number.isInteger(view.width * currentRatio) && Number.isInteger(view.height * currentRatio); retainedBounds = null; canvas.width = cropToPose ? 1 : Math.round(view.width * currentRatio); canvas.height = cropToPose ? 1 : Math.round(view.height * currentRatio); }
  resize({ width, height, ratio });
  return {
    // UI遍历已缩放到1080参考坐标时，coordinateScale传入屏宽/1080。
    draw(ctx, pose, { x, y, scale = 1, alpha = 1, coordinateScale = 1 }) {
      const fullWidth = Math.round(currentWidth * currentRatio), fullHeight = Math.round(currentHeight * currentRatio);
      let bounds = { left: 0, top: 0, right: fullWidth, bottom: fullHeight };
      if (cropToPose) {
        let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
        for (const draw of pose.draws) for (let i = 0; i < draw.vertices.length; i += 2) {
          const px = (x + draw.vertices[i] * scale) * coordinateScale * currentRatio, py = (y - draw.vertices[i + 1] * scale) * coordinateScale * currentRatio;
          left = Math.min(left, px); right = Math.max(right, px); top = Math.min(top, py); bottom = Math.max(bottom, py);
        }
        if (!(right > 0 && bottom > 0 && left < fullWidth && top < fullHeight)) return false;
        // 保留抗锯齿边界，并使视口位移对齐八像素网格；只扩张已有包围框。
        bounds = { left: Math.max(0, Math.floor((left - 4) / 8) * 8), top: fullHeight - Math.min(fullHeight, Math.ceil((fullHeight - top + 4) / 8) * 8), right: Math.min(fullWidth, Math.ceil((right + 4) / 8) * 8), bottom: fullHeight - Math.max(0, Math.floor((fullHeight - bottom - 4) / 8) * 8) };
        if (retainedBounds) bounds = { left: Math.min(bounds.left, retainedBounds.left), top: Math.min(bounds.top, retainedBounds.top), right: Math.max(bounds.right, retainedBounds.right), bottom: Math.max(bounds.bottom, retainedBounds.bottom) };
        // 保持原GPU视口原点，避免微小的插值舍入差异；仅裁掉上方和右方空白。
        bounds.left = 0; bounds.bottom = fullHeight;
        retainedBounds = bounds;
        if (canvas.width !== bounds.right - bounds.left) canvas.width = bounds.right - bounds.left;
        if (canvas.height !== bounds.bottom - bounds.top) canvas.height = bounds.bottom - bounds.top;
      }
      gl.viewport(-bounds.left, bounds.bottom - fullHeight, fullWidth, fullHeight); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.enable(gl.BLEND); gl.useProgram(program);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture); gl.uniform1i(location.atlas, 0); gl.uniform2f(location.viewport, currentWidth, currentHeight); gl.uniform3f(location.anchor, x * coordinateScale, y * coordinateScale, scale * coordinateScale);
      gl.enableVertexAttribArray(location.position); gl.enableVertexAttribArray(location.uv);
      for (const draw of pose.draws) {
        const attachment = model.attachments[draw.id], entry = entries[draw.id];
        if (attachment.blendMode === 1) gl.blendFunc(gl.ONE, gl.ONE);
        else if (attachment.blendMode === 2) gl.blendFunc(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA);
        else if (attachment.blendMode === 3) gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR);
        else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.uniform4f(location.color, draw.color[0], draw.color[1], draw.color[2], draw.color[3] * alpha);
        gl.bindBuffer(gl.ARRAY_BUFFER, entry.positions); gl.bufferSubData(gl.ARRAY_BUFFER, 0, draw.vertices); gl.vertexAttribPointer(location.position, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, entry.uvs); gl.vertexAttribPointer(location.uv, 2, gl.FLOAT, false, 0, 0); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, entry.indices); gl.drawElements(gl.TRIANGLES, attachment.triangles.length, gl.UNSIGNED_SHORT, 0);
      }
      if (cropToPose) {
        const pixelWidth = currentWidth / coordinateScale / fullWidth, pixelHeight = currentHeight / coordinateScale / fullHeight;
        finishGLFrame(gl); ctx.drawImage(canvas, bounds.left * pixelWidth, bounds.top * pixelHeight, (bounds.right - bounds.left) * pixelWidth, (bounds.bottom - bounds.top) * pixelHeight);
      } else { finishGLFrame(gl); ctx.drawImage(canvas, 0, 0, currentWidth / coordinateScale, currentHeight / coordinateScale); }
      return true;
    },
    resize,
    dispose() { for (const value of buffers) gl.deleteBuffer(value); gl.deleteTexture(texture); gl.deleteProgram(program); },
    get error() { return gl.getError(); },
  };
}

module.exports = { prepareCharacter, sampleTrack, verticesForPose, sampleCharacter, createCharacterPlayer, createCharacterRenderer };
