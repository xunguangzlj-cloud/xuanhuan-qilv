'use strict';

// 几何取自原Unity场景；状态规则依据Hot.cs的真实类，不使用简化关卡模型。
const DEG = Math.PI / 180;
const COLORS = ['#ffffff', '#32afdd', '#ec8f2e', '#984be0', '#dd433e', '#6ac53e', '#4e77dd', '#23a468'];
const EPS = 1e-9;
const deltaAngle = (from, to) => { const n = ((to - from) % 360 + 360) % 360; return n > 180 ? n - 360 : n; };
const multiply = (a, b) => [a[0]*b[0]+a[1]*b[3], a[0]*b[1]+a[1]*b[4], a[0]*b[2]+a[1]*b[5]+a[2], a[3]*b[0]+a[4]*b[3], a[3]*b[1]+a[4]*b[4], a[3]*b[2]+a[4]*b[5]+a[5]];
const transform = (m, p) => [m[0]*p[0]+m[1]*p[1]+m[2], m[3]*p[0]+m[4]*p[1]+m[5]];
const cross = (a, b, c) => (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);

function inverse(m) {
  const d = m[0]*m[4]-m[1]*m[3];
  return [m[4]/d, -m[1]/d, (m[1]*m[5]-m[4]*m[2])/d, -m[3]/d, m[0]/d, (m[3]*m[2]-m[0]*m[5])/d];
}

function pointSegmentDistance(p, a, b) {
  const x = b[0]-a[0], y = b[1]-a[1], d = x*x+y*y;
  const t = d ? Math.max(0, Math.min(1, ((p[0]-a[0])*x+(p[1]-a[1])*y)/d)) : 0;
  return Math.hypot(p[0]-a[0]-x*t, p[1]-a[1]-y*t);
}

function pointInPolygon(p, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length-1; i < polygon.length; j = i++) {
    const a = polygon[j], b = polygon[i];
    if (pointSegmentDistance(p, a, b) <= EPS) return true;
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0]) inside = !inside;
  }
  return inside;
}

function boundaryDistance(p, polygon) {
  let result = Infinity;
  for (let i = 0; i < polygon.length; i++) result = Math.min(result, pointSegmentDistance(p, polygon[i], polygon[(i+1)%polygon.length]));
  return result;
}

function segmentIntersection(a, b, c, d) {
  const x = b[0]-a[0], y = b[1]-a[1], u = d[0]-c[0], v = d[1]-c[1];
  const denominator = x*v-y*u;
  if (Math.abs(denominator) < EPS) return null;
  const t = ((c[0]-a[0])*v-(c[1]-a[1])*u)/denominator;
  const s = ((c[0]-a[0])*y-(c[1]-a[1])*x)/denominator;
  return t >= -EPS && t <= 1+EPS && s >= -EPS && s <= 1+EPS ? [a[0]+t*x, a[1]+t*y] : null;
}

function pointInContours(point, contours) {
  let inside = false;
  for (const path of contours) if (pointInPolygon(point, path)) inside = !inside;
  return inside;
}

function convexPenetration(first, second, contact) {
  const convex = polygon => {
    let sign = 0;
    for (let i=0; i<polygon.length; i++) {
      const value = cross(polygon[i], polygon[(i+1)%polygon.length], polygon[(i+2)%polygon.length]);
      if (Math.abs(value)<=EPS) continue;
      if (sign && sign*Math.sign(value)<0) return false;
      sign = Math.sign(value);
    }
    return sign !== 0;
  };
  if (!convex(first) || !convex(second)) return null;
  let penetration = Infinity;
  // 凸碰撞体采用最短分离轴深度；恰好相切返回0，包含或重合也保留真实深度。
  for (const polygon of [first,second]) for (let i=0; i<polygon.length; i++) {
    const a=polygon[i], b=polygon[(i+1)%polygon.length], length=Math.hypot(b[0]-a[0],b[1]-a[1]);
    if (length<=EPS) continue;
    const nx=-(b[1]-a[1])/length, ny=(b[0]-a[0])/length;
    const project = points => {
      let min=Infinity, max=-Infinity;
      for (const point of points) { const value=point[0]*nx+point[1]*ny; min=Math.min(min,value); max=Math.max(max,value); }
      return [min,max];
    };
    const left=project(first), right=project(second);
    if (left[1]<right[0]-EPS || right[1]<left[0]-EPS) return null;
    const positive=left[1]-right[0], negative=right[1]-left[0], amount=Math.max(0,Math.min(positive,negative));
    if (amount<penetration) {
      penetration=amount;
      if (contact) contact.normal=positive<=negative ? [nx,ny] : [-nx,-ny];
    }
  }
  return penetration>EPS ? -penetration : 0;
}

function contoursDistance(first, second) {
  if (first.length===1 && second.length===1) {
    const penetration=convexPenetration(first[0],second[0]);
    if (penetration !== null) return penetration;
  }
  let minimum = Infinity, depth = 0, overlap = false;
  const nearest = (point, contours) => Math.min(...contours.map(path => boundaryDistance(point, path)));
  for (const path of first) for (const p of path) {
    const d = nearest(p, second); minimum = Math.min(minimum, d);
    if (pointInContours(p, second)) { overlap = true; depth = Math.max(depth, d); }
  }
  for (const path of second) for (const p of path) {
    const d = nearest(p, first); minimum = Math.min(minimum, d);
    if (pointInContours(p, first)) { overlap = true; depth = Math.max(depth, d); }
  }
  for (const a of first) for (let i = 0; i < a.length; i++) {
    const start = a[i], end = a[(i+1)%a.length], hits = [];
    for (const b of second) for (let j = 0; j < b.length; j++) {
      const hit = segmentIntersection(start, end, b[j], b[(j+1)%b.length]);
      if (hit) { overlap = true; hits.push(hit); }
    }
    if (hits.length > 1) {
      hits.sort((left, right) => (left[0]-start[0])*(end[0]-start[0])+(left[1]-start[1])*(end[1]-start[1])-(right[0]-start[0])*(end[0]-start[0])-(right[1]-start[1])*(end[1]-start[1]));
      for (let j = 0; j < hits.length-1; j++) {
        const middle = [(hits[j][0]+hits[j+1][0])/2, (hits[j][1]+hits[j+1][1])/2];
        if (pointInContours(middle, second)) depth = Math.max(depth, nearest(middle, second));
      }
    }
  }
  return overlap ? -Math.max(depth, EPS) : minimum;
}

function signedDistance(a, b) { return contoursDistance([a], [b]); }

function circleContoursDistance(circle, contours, contact) {
  let nearest = null, minimum = Infinity;
  for (const path of contours) for (let i=0; i<path.length; i++) {
    const a=path[i], b=path[(i+1)%path.length], dx=b[0]-a[0], dy=b[1]-a[1], length=dx*dx+dy*dy;
    const t=length ? Math.max(0,Math.min(1,((circle.center[0]-a[0])*dx+(circle.center[1]-a[1])*dy)/length)) : 0;
    const point=[a[0]+dx*t,a[1]+dy*t], d=Math.hypot(point[0]-circle.center[0],point[1]-circle.center[1]);
    if (d<minimum) { minimum=d; nearest=point; }
  }
  const inside=pointInContours(circle.center,contours), distance=(inside ? -minimum : minimum)-circle.radius;
  if (contact && nearest && minimum>EPS) {
    const sign=inside || distance>=0 ? -1 : 1;
    contact.normal=[sign*(nearest[0]-circle.center[0])/minimum,sign*(nearest[1]-circle.center[1])/minimum];
  }
  return distance;
}

function shapeDistance(first, second, contact) {
  if (first.circle && second.circle) {
    const dx=second.circle.center[0]-first.circle.center[0], dy=second.circle.center[1]-first.circle.center[1], length=Math.hypot(dx,dy);
    const distance=length-first.circle.radius-second.circle.radius;
    if (contact && length>EPS) { const sign=distance<0 ? 1 : -1; contact.normal=[sign*dx/length,sign*dy/length]; }
    return distance;
  }
  if (first.circle) return circleContoursDistance(first.circle,second.paths,contact);
  if (second.circle) {
    const distance=circleContoursDistance(second.circle,first.paths,contact);
    if (contact?.normal) contact.normal=contact.normal.map(value=>-value);
    return distance;
  }
  return contoursDistance(first.paths,second.paths);
}

function contoursCast(first, second, direction, maxDistance) {
  const initial=contoursDistance(first,second);
  if (initial < -EPS) return 0;
  const events=[0];
  // 相交状态只在顶点与边接触时改变；保留最大距离之后的事件，以判断端点右侧是否进入实体。
  const rays=(vertices,edges,sign)=>{
    const vx=direction[0]*sign, vy=direction[1]*sign;
    for (const path of vertices) for (const point of path) for (const edge of edges) for (let i=0; i<edge.length; i++) {
      const a=edge[i], b=edge[(i+1)%edge.length], ex=b[0]-a[0], ey=b[1]-a[1], denominator=vx*ey-vy*ex;
      if (Math.abs(denominator)<EPS) continue;
      const ax=a[0]-point[0], ay=a[1]-point[1], t=(ax*ey-ay*ex)/denominator, u=(ax*vy-ay*vx)/denominator;
      if (t < -EPS || u < -EPS || u>1+EPS) continue;
      events.push(Math.max(0,t));
    }
  };
  rays(first,second,1); rays(second,first,-1);
  events.sort((a,b)=>a-b);
  for (let i=0; i<events.length-1; i++) {
    const start=events[i], end=events[i+1];
    if (start>maxDistance+EPS) break;
    if (start===end) continue;
    // 只检查相邻事件的开区间，避免固定探步越过极薄障碍，也不把沿边界滑动当成穿透。
    const middle=start+(end-start)/2, shifted=first.map(path=>path.map(p=>[p[0]+direction[0]*middle,p[1]+direction[1]*middle]));
    if (contoursDistance(shifted,second)<-EPS) return Math.min(start,maxDistance);
  }
  return null;
}

function bounds(paths) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const path of paths) for (const point of path) {
    minX = Math.min(minX, point[0]); minY = Math.min(minY, point[1]);
    maxX = Math.max(maxX, point[0]); maxY = Math.max(maxY, point[1]);
  }
  return {minX, minY, maxX, maxY};
}

function createBoard(level, options = {}) {
  const geometries = options.geometries || level.geometries;
  if (!geometries) throw new Error('createBoard需要原关卡geometries几何表');
  const random = options.random || Math.random;
  const solveOnDragExit = options.solveOnDragExit ?? true;
  const byId = new Map(), colliderMap = new Map(), relativeMap = new Map();
  const staticBindings = new Map(), activeLockLinks = [], guideBindings = [];
  const board = {sourceKey: level.sourceKey, parts: [], score: 0, invalidSteps: 0, time: 0, won: false, propMode: null, onEvent: options.onEvent || (() => {})};
  let drag = null, dirty = true, resolving = false, stepReleased = [], stepSource = null, stepSerial = 0, pendingStep = null;
  const emit = (type, fields = {}) => board.onEvent(Object.assign({type, time: board.time}, fields));

  for (const source of level.parts) {
    const part = Object.assign({}, source, {
      x: source.matrix[2], y: source.matrix[5], rotationDeg: source.rotationDeg,
      palette: source.data.PaletteColor, color: COLORS[source.data.PaletteColor] || COLORS[0],
      data: Object.assign({}, source.data, {LockedBy: [], Locks: []}), lockCount: source.data.LockCount || 0,
      solved: false, collected: false, collectTime: 0, body: [], pegs: [], bomb: false, acorn: false,
      revision: 0, initialRotation: source.rotationDeg, initialMatrix: source.matrix.slice(),
    });
    byId.set(part.id, part); board.parts.push(part);
  }
  const ringPhysics = options.ringPhysicsFactory ? options.ringPhysicsFactory(level) : null;
  if (ringPhysics) {
    board.ringPhysicsStatus = ringPhysics.stats;
    for (const part of board.parts) { const angle = ringPhysics.angle(part); if (angle !== null) part.rotationDeg = part.initialRotation = angle; }
  }
  for (const source of level.colliders) colliderMap.set(source.id, Object.assign({}, source, {part: byId.get(source.owner), cachedRevision: -1}));
  const nativePull = options.nativeLevel ? require('./native-pull-stage.js').createNativePull(level, options.nativeLevel, ringPhysics) : null;
  board.nativePullStatus = {queries: 0, used: 0, fallback: 0, lastReason: null};
  for (const source of level.relatives) relativeMap.set(source.id, source);
  const relativesOf = part => level.relatives.filter(relative => relative.owner === part.id);
  const collidersOf = part => part.colliderIds.map(id => colliderMap.get(id)).filter(Boolean);
  const aliases = new Map();
  for (const part of board.parts) for (const slot of part.slots || []) if (slot.guideId) aliases.set(slot.guideId, {part, colliderIds: [slot.colliderId]});

  function partMatrix(part) {
    const delta = (part.rotationDeg-part.initialRotation)*DEG, c = Math.cos(delta), s = Math.sin(delta), m = part.initialMatrix;
    return [c*m[0]-s*m[3], c*m[1]-s*m[4], part.x, s*m[0]+c*m[3], s*m[1]+c*m[4], part.y];
  }

  function shape(collider) {
    const revision = collider.part ? collider.part.revision : 0;
    if (collider.cachedRevision === revision) return collider.cachedShape;
    const geometry = geometries[collider.g], matrix = collider.part ? multiply(partMatrix(collider.part), collider.matrix) : collider.matrix;
    let paths = geometry.paths;
    if ((!paths || !paths.length) && geometry.radius) {
      // 64点只保留给现有绘图；等比正交变换的物理距离使用下方解析圆。
      paths = [Array.from({length: 64}, (_, i) => [Math.cos(i*Math.PI/32)*geometry.radius, Math.sin(i*Math.PI/32)*geometry.radius])];
    }
    const result = {paths: (paths || []).map(path => path.map(point => transform(matrix, [point[0]+collider.offset[0], point[1]+collider.offset[1]])))};
    result.bounds = bounds(result.paths);
    if (geometry.type==='CircleCollider2D' && geometry.radius) {
      const sx=Math.hypot(matrix[0],matrix[3]), sy=Math.hypot(matrix[1],matrix[4]);
      // 原400关的160个圆均满足此条件；未知非等比/切变数据继续使用原轮廓近似。
      if (Math.abs(sx-sy)<=1e-6*Math.max(sx,sy) && Math.abs(matrix[0]*matrix[1]+matrix[3]*matrix[4])<=1e-6*sx*sy) {
        result.circle={center:transform(matrix,collider.offset),radius:geometry.radius*sx};
        const {center,radius}=result.circle;
        result.bounds={minX:center[0]-radius,minY:center[1]-radius,maxX:center[0]+radius,maxY:center[1]+radius};
      }
    }
    collider.cachedRevision = revision; collider.cachedShape = result;
    return result;
  }

  function enabled(collider) { return collider && collider.enabled && (!collider.part || !collider.part.solved); }
  function distance(a, b, clearance = 0) {
    const first = shape(a), second = shape(b), x = first.bounds, y = second.bounds;
    const precise = ringPhysics && ringPhysics.hasPair(a, b);
    if (precise) clearance = Math.max(clearance, .02001);
    if (x.maxX+clearance < y.minX || x.minX-clearance > y.maxX || x.maxY+clearance < y.minY || x.minY-clearance > y.maxY) return Infinity;
    if (precise) { const value = ringPhysics.distance(a, b); if (value !== null) return value; }
    return shapeDistance(first,second);
  }

  // 同版PreparePolygonShapes RVA0x243914b：物理polygonRadius位3c23d70a，GetShapes.radius=0不表示无皮肤。
  const sensingSkinCache = new Map();
  function polygonSensingSkin(collider) {
    if (!options.nativeLevel) return null;
    if (sensingSkinCache.has(collider.id)) return sensingSkinCache.get(collider.id);
    const original = options.nativeLevel.get(collider.id,collider.g), type = geometries[collider.g].type;
    const supported = (type === 'PolygonCollider2D' || type === 'BoxCollider2D') && original.primitives.length > 0 && original.primitives.every(piece=>piece.type === 'Polygon' && piece.radius === 0);
    const radius = supported ? Math.fround(0.01) : null;
    sensingSkinCache.set(collider.id,radius); return radius;
  }
  function sensingDistance(first, second) {
    if (ringPhysics && ringPhysics.hasPair(first, second)) return distance(first, second, .02001);
    const a = polygonSensingSkin(first), b = polygonSensingSkin(second);
    // 未验证的圆/混合片/无Native孤立几何保留原路径，不混用不同支持域。
    const skin = a !== null && b !== null ? Math.fround(a+b) : 0;
    return distance(first,second,skin)-skin;
  }

  function overlaps(sensor, includeWalls = false) {
    if (!enabled(sensor)) return [];
    const result = [];
    for (const other of colliderMap.values()) {
      if (!enabled(other) || other === sensor || other.owner === sensor.owner || other.layer !== 7) continue;
      if (!includeWalls && other.roles.includes(4)) continue;
      if (sensingDistance(sensor, other) < 0) result.push(other);
      if (result.length === 16) break;
    }
    return result;
  }

  function sensing(part, includeWalls = true) {
    const ids = [part.sensorId].concat(relativesOf(part).map(relative => relative.sensorId));
    if (includeWalls) for (const relative of relativesOf(part)) ids.push(...relative.blockIds.filter(id => colliderMap.get(id)?.roles.includes(4)));
    return ids.map(id => colliderMap.get(id)).filter(enabled);
  }

  function bindingTouches(part, binding) {
    const sensors = sensing(part);
    for (const id of binding.colliderIds) {
      const other = colliderMap.get(id);
      if (!enabled(other)) continue;
      for (const sensor of sensors) if (sensingDistance(sensor, other) < 0) return true;
    }
    return false;
  }

  function featureColliders(part, feature) {
    if (feature === 'body') return [part.bodyId].filter(Boolean);
    const result = [];
    for (const relative of relativesOf(part)) if (!feature || relative.featureId === feature) result.push(...relative.blockIds);
    return result;
  }

  function addBinding(owner, partner, ids, feature) {
    if (!owner || !partner || !ids.length) return;
    if (!staticBindings.has(owner.id)) staticBindings.set(owner.id, []);
    staticBindings.get(owner.id).push({partner: partner.id, colliderIds: ids, feature, baseline: partner.initialRotation});
  }

  function addPartLink(part, key, partnerId, featureId) {
    if (part && !part.data[key].some(link => link.PhysicPartId === partnerId)) part.data[key].push({PhysicPartId: partnerId, FeatureId: featureId || null});
  }

  for (const link of level.ringLinks) {
    const source = byId.get(link.sourceRingId), target = byId.get(link.targetPartId);
    addPartLink(source, 'Locks', link.targetPartId, link.targetFeatureId);
    addPartLink(target, 'LockedBy', link.sourceRingId, link.pinFeatureId);
    if (!source || !target) continue;
    if (link.relationKind !== 1 && source.kind === 'ring') {
      activeLockLinks.push({source, target, feature: link.pinFeatureId});
      if (target.kind === 'ring') addBinding(target, source, featureColliders(source, link.pinFeatureId), link.pinFeatureId);
    }
    if (source.kind === 'ring' && target.kind === 'pull') addBinding(target, source, featureColliders(source, link.pinFeatureId), link.pinFeatureId);
    else if (source.kind === 'pull' && target.kind === 'ring') addBinding(source, target, featureColliders(target, link.targetFeatureId), link.targetFeatureId);
  }
  for (const link of level.guideLinks) {
    const guide = byId.get(link.guidePartId) || aliases.get(link.guidePartId)?.part;
    const locked = byId.get(link.lockedPartId);
    if (!guide || !locked) continue;
    const ids = aliases.get(link.guidePartId)?.colliderIds || [guide.bodyId].filter(Boolean);
    addBinding(locked, guide, ids, link.guidePartId);
    guideBindings.push({guideId: link.guidePartId, guide, locked, colliderIds: ids});
    addPartLink(guide, 'LockedBy', link.lockedPartId);
    addPartLink(locked, 'Locks', link.guidePartId);
  }
  for (const source of level.bombs) if (byId.has(source.owner)) byId.get(source.owner).bomb = true;

  function partLocked(part) {
    if (part.lockCount > 0) return true;
    if (part.kind !== 'ring') return false;
    for (const link of activeLockLinks) {
      if (link.source !== part || link.target.solved) continue;
      for (const relative of relativesOf(part)) {
        if (link.feature && relative.featureId !== link.feature) continue;
        if (overlaps(colliderMap.get(relative.sensorId), true).some(collider => collider.owner === link.target.id)) return true;
      }
    }
    return false;
  }

  function canSolve(part) {
    if (part.solved || !part.active) return false;
    if (part.kind === 'fixed' || part.kind === 'butterfly') {
      const links = guideBindings.filter(link => link.guide === part);
      return links.length > 0 && links.every(link => link.locked.solved || !bindingTouches(link.locked, link));
    }
    if ((staticBindings.get(part.id) || []).some(binding => bindingTouches(part, binding))) return false;
    if (part.kind === 'ring') {
      for (const link of activeLockLinks) if (link.source === part && !link.target.solved) {
        for (const relative of relativesOf(part)) if ((!link.feature || link.feature === relative.featureId) && overlaps(colliderMap.get(relative.sensorId), true).some(collider => collider.owner === link.target.id)) return false;
      }
    }
    return true;
  }

  function refreshPart(part) {
    const main = colliderMap.get(part.bodyId);
    part.body = main ? shape(main).paths : [];
    part.pegs = [];
    for (const relative of relativesOf(part)) for (const id of relative.blockIds) {
      const collider = colliderMap.get(id);
      if (collider) part.pegs.push({id, featureId: relative.featureId, roles: collider.roles, paths: shape(collider).paths});
    }
    part.locks = part.lockCount;
  }

  function commitStep(state) {
    // 原GameplayStepRecorder：同一部件的NoEffect暂存合并，切换部件或道具才先提交。
    if (pendingStep && (pendingStep.source !== stepSource || stepSource === 'hammer' || stepSource === 'rocket' || stepSource === 'bomb')) {
      board.invalidSteps++; stepSerial++;
      emit('step', {state: 'NoEffect', source: pendingStep.source, released: [], score: 0, operationCount: pendingStep.operationCount});
      pendingStep = null;
    }
    const operationCount = (pendingStep?.operationCount || 0)+1;
    const released = stepReleased.filter(part => part.kind === 'ring' || part.kind === 'pull');
    if (released.length) {
      stepSerial++;
      const penalty = board.invalidSteps >= 3;
      let score = 0;
      for (const part of released) {
        const base = part.kind === 'ring' ? 100 : 50;
        const raw = base*(1+part.data.LockedBy.length+part.data.Locks.length)+(part.data.LockCount > 0 ? base : 0);
        const awarded = penalty ? Math.max(raw-50, 50) : raw;
        score += awarded; emit('score', {partId: part.id, amount: awarded, baseScore: raw, penalty});
      }
      board.score += score; board.invalidSteps = 0;
      emit('step', {state: 'UnlockRelease', source: stepSource, released: released.map(part => part.id), score, operationCount});
      pendingStep = null;
    } else if (state === 'Error') {
      stepSerial++;
      board.invalidSteps++; emit('step', {state, source: stepSource, released: [], score: 0, operationCount});
      pendingStep = null;
    } else if (state === 'NoEffect') {
      pendingStep = {source: stepSource, operationCount};
    }
    stepReleased = []; stepSource = null;
  }

  function remove(part, reason) {
    if (!part || part.solved) return false;
    part.solved = true; part.collected = true; part.collectTime = board.time;
    if (drag?.part === part) { if (ringPhysics) ringPhysics.release(part); drag = null; }
    for (const bomb of bombs) if (bomb.owner === part.id && !bomb.solved) {
      bomb.solved = true; emit('bombRemove', {bombId: bomb.id, hostId: part.id, noExplosion: true});
    }
    if (part.kind !== 'fixed' && part.kind !== 'butterfly') {
      for (const other of board.parts) if (other.lockCount > 0) { other.lockCount = other === part ? 0 : other.lockCount-1; refreshPart(other); }
    }
    stepReleased.push(part); dirty = true;
    emit('collect', {partId: part.id, kind: part.kind, reason, x: part.x, y: part.y, acorn: part.acorn, locks: part.lockCount});
    if (part.acorn) { part.acorn = false; emit('acorn', {partId: part.id, reason}); }
    return true;
  }

  function settle() {
    // 原底板关闭拖动退出即消除；炸弹已引起的消除仍按原OnInteractableSolved继续结算。
    if (resolving || (drag && !solveOnDragExit && !stepReleased.length)) return;
    resolving = true;
    try {
      let changed;
      do {
        changed = false;
        for (let index = board.parts.length-1; index >= 0; index--) if (canSolve(board.parts[index])) changed = remove(board.parts[index], 'release') || changed;
      } while (changed);
      dirty = false;
      if (!drag && stepReleased.some(part => part.kind === 'ring' || part.kind === 'pull')) commitStep('UnlockRelease');
      else if (!drag) stepReleased = [];
      if (!board.won && board.parts.every(part => part.solved || !part.active)) { board.won = true; emit('win', {score: board.score}); }
    } finally { resolving = false; }
  }

  function allowedContact(part, collider) {
    const bindings = staticBindings.get(part.id) || [];
    for (const binding of bindings) {
      const partner = byId.get(binding.partner);
      if (!partner || partner.solved) continue;
      if (binding.colliderIds.includes(collider.id) && (!collider.roles.includes(4) || Math.abs(deltaAngle(partner.rotationDeg, binding.baseline)) <= 5)) return true;
      if (collider.owner === partner.id && collider.roles.includes(4) && Math.abs(deltaAngle(partner.rotationDeg, binding.baseline)) <= 5) return true;
    }
    return false;
  }

  function contactState(part) {
    const contacts = new Map(), hardContacts = new Map();
    const probes = collidersOf(part).filter(collider => enabled(collider) && collider.layer !== 6 && !collider.trigger);
    for (const probe of probes) for (const other of colliderMap.values()) {
      if (!enabled(other) || other.owner === part.id || other.layer === 6 || other.trigger || other.roles.includes(6)) continue;
      const d = distance(probe, other, part.hardBlockIds.includes(probe.id) ? 0.03 : 0);
      if (part.hardBlockIds.includes(probe.id) && other.part?.kind !== 'ring' && d < 0.03) hardContacts.set(other.id, {collider: other, probe, depth: 0.03-d});
      if (d >= 0) continue;
      const previous = contacts.get(other.id);
      if (!previous || previous.depth < -d) contacts.set(other.id, {collider: other, probe, depth: -d});
      if (part.hardBlockIds.includes(probe.id) && other.part?.kind === 'ring') hardContacts.set(other.id, {collider: other, probe, depth: -d});
    }
    return {contacts, hardContacts};
  }

  function rotationBlocked(part, baseline) {
    const now = contactState(part);
    for (const [id, contact] of now.contacts) {
      const otherPart = contact.collider.part;
      if (otherPart?.kind === 'ring') {
        if (!allowedContact(part, contact.collider)) return contact;
        if (contact.collider.roles.includes(1) && contact.depth > (baseline.contacts.get(id)?.depth || 0)+0.02) return contact;
      } else {
        const before = baseline.contacts.get(id);
        if (!before || contact.depth > before.depth+0.02) return contact;
      }
    }
    for (const [id, contact] of now.hardContacts) {
      if (contact.collider.part?.kind === 'ring' || contact.depth > (baseline.hardContacts.get(id)?.depth || 0)+0.02) return contact;
    }
    return null;
  }

  function applyRotation(part, angle) { const actual = ringPhysics ? ringPhysics.setRotation(part, angle) : null; part.rotationDeg = actual === null ? angle : actual; part.revision++; refreshPart(part); }
  function probeRotation(part, angle, baseline) { applyRotation(part, angle); return rotationBlocked(part, baseline); }
  function probePath(part, from, to, baseline) {
    const delta = deltaAngle(from, to), amount = Math.abs(delta);
    const fractions = amount < 3 ? [] : amount < 8 ? [0.5] : [0.33, 0.66];
    for (const fraction of fractions) if (probeRotation(part, from+delta*fraction, baseline)) return true;
    return false;
  }

  function lastValidAngle(part, from, to, baseline) {
    if (!probePath(part, from, to, baseline) && !probeRotation(part, to, baseline)) return to;
    if (probeRotation(part, from, baseline)) return from;
    const delta = deltaAngle(from, to); let lower = 0, upper = 1, valid = from;
    for (let index = 0; index < 12 && Math.abs(delta)*(upper-lower) >= 0.5; index++) {
      const middle = (lower+upper)/2, angle = from+delta*middle;
      if (probeRotation(part, angle, baseline) || probePath(part, from, angle, baseline)) upper = middle;
      else { lower = middle; valid = angle; }
    }
    return valid;
  }

  function threadablePinInGap(part) {
    const render = part.render.find(item => item._radius > 0);
    if (!render || render._gapAngleDeg <= 0.5) return false;
    const m = partMatrix(part), back = inverse(m), scale = Math.max(Math.hypot(m[0], m[3]), Math.hypot(m[1], m[4]));
    const inner = Math.max(0, (render._radius-Math.max(render._width/2, 0.01))*scale-0.05), outer = (render._radius+Math.max(render._width/2, 0.01))*scale+0.05;
    const pins = board.parts.filter(other => other !== part && !other.solved && other.kind !== 'ring').map(other => ({root:[other.x,other.y],colliders:collidersOf(other)}));
    for (const relative of level.relatives) {
      const owner = byId.get(relative.owner);
      if (relative.owner === part.id || owner?.solved) continue;
      // 原6083个RingRelative的selfCollider均与组件根同Transform，blockIds完整等于所有子Collider。
      const root = colliderMap.get(relative.selfId), matrix = root ? (root.part ? multiply(partMatrix(root.part),root.matrix) : root.matrix) : null;
      pins.push({root:matrix ? transform(matrix,[0,0]) : null,colliders:relative.blockIds.map(id=>colliderMap.get(id)).filter(Boolean)});
    }
    const query = require('./ring-pin-gap-query.js').pinIntersectsRingGap;
    for (const pin of pins) {
      const colliders = [];
      for (const collider of pin.colliders) {
        if (!enabled(collider) || collider.layer === 6) continue;
        const current = shape(collider), origin = [part.x,part.y];
        const minRadius = current.circle ? Math.max(0,Math.hypot(current.circle.center[0]-part.x,current.circle.center[1]-part.y)-current.circle.radius) : pointInContours(origin,current.paths) ? 0 : Math.min(...current.paths.map(path=>boundaryDistance(origin,path)));
        colliders.push({bounds:current.bounds,minRadius});
      }
      if (query({root:pin.root,colliders},{center:[part.x,part.y],worldToLocal:back,inner,outer,gapDirectionDeg:render._gapDirectionDeg||0,gapHalfDeg:render._gapAngleDeg/2})) return true;
    }
    return false;
  }

  function feelDelta(part, alpha) {
    const settings = options.feel || {EnableFeel: true, DampingK1: 0.75, CompensationK2: 1.2};
    if (!settings.EnableFeel || Math.abs(alpha) < 1e-6) return alpha;
    if (threadablePinInGap(part)) { const damped = alpha*settings.DampingK1; drag.loss += alpha-damped; return damped; }
    if (Math.abs(drag.loss) > 0.0001 && Math.sign(drag.loss) === Math.sign(alpha)) {
      const added = Math.abs(alpha)*(settings.CompensationK2-1);
      if (added <= Math.abs(drag.loss)) { drag.loss -= Math.sign(drag.loss)*added; return alpha*settings.CompensationK2; }
      const result = alpha+drag.loss; drag.loss = 0; return result;
    }
    return alpha;
  }

  function pullDirection(part) {
    const m = partMatrix(part), type = part.movement.lockDirectionType;
    let v;
    if (type === 0) v = [m[1], m[4]];
    else if (type === 1) v = [-m[0], -m[3]];
    else {
      const settings = part.movement;
      if (settings.lockUp && settings.lockDown && !(settings.lockLeft && settings.lockRight)) v = [settings.lockRight ? -1 : 1, 0];
      else v = [0, settings.lockUp ? -1 : 1];
    }
    const length = Math.hypot(v[0], v[1]); return length ? [v[0]/length, v[1]/length] : [0, 1];
  }

  function applyPosition(part, x, y) { part.x = x; part.y = y; part.revision++; refreshPart(part); }
  function nativePullState(part, direction, maximum) {
    if (!nativePull) return null;
    const body = colliderMap.get(part.bodyId);
    if (!enabled(body)) return null;
    const targets = [];
    for (const other of colliderMap.values()) {
      if (!enabled(other) || other.owner===part.id || other.layer!==7 || other.trigger || other.roles.includes(6)) continue;
      if ((staticBindings.get(part.id)||[]).some(binding=>binding.colliderIds.includes(other.id) && bindingTouches(part,binding))) continue;
      targets.push(other);
    }
    const result = nativePull.query(body, targets, direction, maximum);
    board.nativePullStatus.queries++;
    if (result.status === '已计算') { board.nativePullStatus.used++; return result; }
    board.nativePullStatus.fallback++; board.nativePullStatus.lastReason = result.reason;
    return null;
  }

  function pullOverlapContact(part, direction, nativeState) {
    if (nativeState) return nativeState.overlap;
    const body=colliderMap.get(part.bodyId);
    if (!enabled(body)) return null;
    const first=shape(body).paths.filter(path=>path.length>2);
    for (const other of colliderMap.values()) {
      if (!enabled(other) || other.owner===part.id || other.layer!==7 || other.trigger || other.roles.includes(6)) continue;
      if ((staticBindings.get(part.id)||[]).some(binding=>binding.colliderIds.includes(other.id) && bindingTouches(part,binding))) continue;
      const d=distance(body,other);
      // 凹轮廓恰好接触的-EPS标记不是可证实的初始穿透。
      if (d>=-EPS) continue;
      const second=shape(other).paths.filter(path=>path.length>2), contact={};
      let movingOut;
      if (shape(body).circle || shape(other).circle) {
        shapeDistance(shape(body),shape(other),contact);
        movingOut=!!contact.normal && direction[0]*contact.normal[0]+direction[1]*contact.normal[1]<-EPS;
      } else if (first.length===1 && second.length===1 && convexPenetration(first[0],second[0],contact)!==null) {
        movingOut=direction[0]*contact.normal[0]+direction[1]*contact.normal[1]<-EPS;
      } else {
        // Unity原生凹体Distance法线未恢复；沿真实轮廓作局部差分，不用凸包填平凹口/内洞。
        const step=Math.min(1e-4,-d/4), shifted=amount=>first.map(path=>path.map(p=>[p[0]+direction[0]*amount,p[1]+direction[1]*amount]));
        movingOut=contoursDistance(shifted(step),second)>contoursDistance(shifted(-step),second)+EPS;
      }
      return {depth:-d,movingOut};
    }
    return null;
  }

  function pullCast(part, direction, maxDistance, nativeState) {
    const currentNative = nativeState === undefined ? nativePullState(part, direction, maxDistance) : nativeState;
    if (currentNative) return currentNative.hit;
    const body=colliderMap.get(part.bodyId);
    if (!enabled(body)) return null;
    const first=shape(body), box=first.bounds, dx=direction[0]*maxDistance, dy=direction[1]*maxDistance;
    const swept={minX:box.minX+Math.min(0,dx),maxX:box.maxX+Math.max(0,dx),minY:box.minY+Math.min(0,dy),maxY:box.maxY+Math.max(0,dy)};
    let hit=null;
    for (const other of colliderMap.values()) {
      if (!enabled(other) || other.owner===part.id || other.layer!==7 || other.trigger || other.roles.includes(6)) continue;
      if ((staticBindings.get(part.id)||[]).some(binding=>binding.colliderIds.includes(other.id) && bindingTouches(part,binding))) continue;
      const second=shape(other), target=second.bounds;
      if (swept.maxX<target.minX-EPS || swept.minX>target.maxX+EPS || swept.maxY<target.minY-EPS || swept.minY>target.maxY+EPS) continue;
      const distance=contoursCast(first.paths,second.paths,direction,maxDistance);
      if (distance!==null && (!hit || distance<hit.distance)) hit={collider:other,distance};
    }
    return hit;
  }

  function rollbackPull(part, current) {
    const axis = current.direction;
    const travel = Math.abs((part.x-current.startX)*axis[0]+(part.y-current.startY)*axis[1]);
    if (travel <= EPS) return;
    const startX = part.x, startY = part.y;
    const reverse = axis.map(value => -value*current.persistedBlock);
    const hit = pullCast(part,reverse,0.06), hitDistance=hit?.distance || 0;
    const safeDistance=hit ? Math.max(0,hit.distance-0.01) : Infinity;
    // Hot.cs:3712-3775以0.05回退，0.06反向Cast，本次轴位移封顶。
    // 连续扫掠消除薄障碍漏检；额外安全上限仍保留，待原Unity查询样本核对。
    const amount = Math.min(Math.max(0, 0.05-hitDistance), travel, safeDistance);
    if (amount > EPS) applyPosition(part, startX+reverse[0]*amount, startY+reverse[1]*amount);
  }

  const bombs = level.bombs.map(source => Object.assign({}, source, {solved: false, collider: colliderMap.get(source.data.activeCollider?.m_PathID)}));
  function bombContacts(moving) {
    for (const bomb of bombs) {
      if (bomb.solved || !enabled(bomb.collider)) continue;
      const external = Array.from(colliderMap.values()).filter(collider => enabled(collider) && collider.owner !== bomb.owner && collider.part);
      // 原BombRelative先用移动探针的0.03接触门槛触发，再另行收集全部交叠目标。
      let trigger = external.find(collider => collider.layer !== 6 && !collider.trigger && (!moving || collider.part === moving || bomb.owner === moving.id) && distance(bomb.collider, collider, 0.03) <= 0.03);
      if (!trigger) trigger = external.find(collider => collider.layer === 7 && distance(bomb.collider, collider) < 0);
      if (!trigger) continue;
      const targets = new Set();
      for (const collider of external) if (collider.layer !== 6 && !collider.trigger && distance(bomb.collider, collider) < 0) targets.add(collider.part);
      if (!targets.size) for (const collider of external) if (distance(bomb.collider, collider) < 0) targets.add(collider.part);
      targets.add(trigger.part);
      stepSource = 'bomb';
      bomb.solved = true; emit('bomb', {bombId: bomb.id, hostId: bomb.owner, targets: Array.from(targets, part => part.id)});
      for (const part of targets) remove(part, 'bomb');
      remove(byId.get(bomb.owner), 'bomb');
    }
  }

  board.pickPart = function(x, y) {
    const candidates = board.parts.filter(part => !part.solved && part.active && (part.kind === 'ring' || part.kind === 'pull')).sort((a, b) => (a.z+(partLocked(a) ? 0.2 : 0.1))-(b.z+(partLocked(b) ? 0.2 : 0.1)));
    const part = candidates.find(item => {
      const dragColliders = collidersOf(item).filter(collider => enabled(collider) && collider.layer === 6);
      return (dragColliders.length ? dragColliders : collidersOf(item).filter(collider => enabled(collider))).some(collider => pointInContours([x, y], shape(collider).paths));
    });
    return part || null;
  };
  board.pointerDown = function(x, y) {
    if (drag || board.won) return null;
    const part = board.pickPart(x, y);
    if (!part) return null;
    stepSource = part.id;
    if (board.propMode === 'hammer') { board.propMode = null; remove(part, 'hammer'); settle(); return part; }
    if (partLocked(part)) { emit('blocked', {partId: part.id, reason: part.lockCount > 0 ? 'chain' : 'relative-lock'}); commitStep('Error'); return null; }
    if (ringPhysics) ringPhysics.begin(part);
    drag = {part, x, y, startX: part.x, startY: part.y, startAngle: part.rotationDeg, blockDirection: 0, persistedBlock: 0, loss: 0, baseline: contactState(part), direction: part.kind === 'pull' ? pullDirection(part) : null};
    emit('pointerDown', {partId: part.id, kind: part.kind}); return part;
  };

  board.pointerMove = function(x, y) {
    if (!drag) return false;
    const current = drag, part = current.part;
    if (part.kind === 'ring') {
      if ((x-current.x)**2+(y-current.y)**2 < 0.0009) return false;
      const a = [current.x-part.x, current.y-part.y], b = [x-part.x, y-part.y];
      current.x = x; current.y = y;
      const denominator = Math.sqrt((a[0]**2+a[1]**2)*(b[0]**2+b[1]**2));
      let alpha = denominator >= 1e-15 ? Math.acos(Math.max(-1, Math.min(1, (a[0]*b[0]+a[1]*b[1])/denominator)))/DEG : 0;
      if (a[0]*b[1]-a[1]*b[0] < 0) alpha = -alpha;
      if (alpha*current.blockDirection > 0) return false;
      current.blockDirection = 0;
      const from = part.rotationDeg, to = from+feelDelta(part, alpha), valid = lastValidAngle(part, from, to, current.baseline);
      applyRotation(part, valid);
      if (Math.abs(deltaAngle(valid, to)) >= 0.1) { current.blockDirection = Math.sign(alpha); current.persistedBlock = current.blockDirection; emit('blocked', {partId: part.id, reason: 'rotation', attemptedAngle: to, appliedAngle: valid}); }
      emit('rotation', {partId: part.id, rotationDeg: valid, deltaDeg: deltaAngle(from, valid)});
    } else {
      const direction = current.direction;
      let targetX = current.startX+x-current.x, targetY = current.startY+y-current.y;
      const settings = part.movement;
      if (settings.lockDirectionType === 2) {
        if ((settings.lockLeft && targetX < current.startX) || (settings.lockRight && targetX > current.startX)) targetX = current.startX;
        if ((settings.lockUp && targetY > current.startY) || (settings.lockDown && targetY < current.startY)) targetY = current.startY;
      }
      const amount = (targetX-part.x)*direction[0]+(targetY-part.y)*direction[1];
      if (Math.abs(amount) < Math.min(settings.moveThreshold || 0.1, 0.03) || amount*current.blockDirection > 0) return false;
      current.blockDirection = 0;
      const sign=Math.sign(amount), moveDirection=direction.map(value=>value*sign), nativeState=nativePullState(part,moveDirection,Math.abs(amount)), overlap=pullOverlapContact(part,moveDirection,nativeState);
      if (overlap) {
        // Hot.cs:3660-3686：起始交叠只沿分离方向退出，每帧最多穿透量+0.01。
        if (!overlap.movingOut) {
          current.blockDirection=sign; current.persistedBlock=sign;
          emit('blocked',{partId:part.id,reason:'translation'}); return false;
        }
        const escape=Math.min(Math.abs(amount),overlap.depth+0.01);
        applyPosition(part,part.x+moveDirection[0]*escape,part.y+moveDirection[1]*escape);
        emit('move',{partId:part.id,x:part.x,y:part.y});
        dirty=true; bombContacts(part); settle(); return true;
      }
      const startX = part.x, startY = part.y, hit=pullCast(part,moveDirection,Math.abs(amount),nativeState);
      const travel=hit ? Math.max(0,hit.distance-0.01) : Math.abs(amount);
      if (hit && hit.distance+0.01<Math.abs(amount)) {
        current.blockDirection = Math.sign(amount); current.persistedBlock = current.blockDirection;
        emit('blocked', {partId: part.id, reason: 'translation'});
      }
      applyPosition(part, startX+moveDirection[0]*travel, startY+moveDirection[1]*travel);
      emit('move', {partId: part.id, x: part.x, y: part.y});
    }
    dirty = true; bombContacts(part); settle(); return true;
  };

  board.pointerUp = function() {
    if (!drag) return false;
    const current = drag, part = current.part;
    if (current.blockDirection && part.kind === 'ring') applyRotation(part, Math.abs(deltaAngle(current.startAngle, part.rotationDeg)) <= 0.1 ? current.startAngle : part.rotationDeg-current.blockDirection*0.1);
    if (current.persistedBlock && part.kind === 'pull') rollbackPull(part, current);
    if (ringPhysics) ringPhysics.release(part);
    const previousCommit = stepSerial;
    drag = null; dirty = true; settle();
    if (stepSerial === previousCommit) commitStep('NoEffect');
    emit('pointerUp', {partId: part.id}); return true;
  };

  board.update = function(dt) { board.time += Math.max(0, dt); if (dirty) settle(); return board.parts.some(part => part.solved && board.time-part.collectTime < 0.5); };
  board.hammer = function(partId) {
    if (!partId) { board.propMode = 'hammer'; emit('tool', {tool: 'hammer', mode: 'select'}); return {executed: false, targetId: null, selecting: true}; }
    const part = byId.get(partId);
    if (!part || part.solved || (part.kind !== 'ring' && part.kind !== 'pull')) return {executed: false, targetId: null};
    board.pointerUp(); board.propMode = null; stepSource = 'hammer'; remove(part, 'hammer'); settle(); return {executed: true, targetId: part.id};
  };
  board.getRocketTarget = function() {
    const available = board.parts.filter(part => !part.solved && part.active && (part.kind === 'ring' || part.kind === 'pull') && part.data.RandomBombCanSelect);
    return available.length ? available[Math.min(available.length-1, Math.floor(random()*available.length))] : null;
  };
  board.getRocketPoint = function(partId) {
    const part = byId.get(partId);
    if (!part) return null;
    if (part.kind !== 'pull') return { x: part.x, y: part.y };
    // 原CalculatePullExplosionPoint：拉杆AABB长轴远端与HostGuide的中点。
    const collider = colliderMap.get(part.sensorId) || colliderMap.get(part.bodyId);
    if (!collider) return { x: part.x, y: part.y };
    const box = shape(collider).bounds;
    const center = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
    const binding = guideBindings.find(link => link.locked === part);
    if (!binding) return center;
    const guide = binding.guide;
    const halfX = (box.maxX - box.minX) / 2, halfY = (box.maxY - box.minY) / 2;
    const ends = halfY >= halfX ? [{ x: center.x, y: center.y - halfY }, { x: center.x, y: center.y + halfY }] : [{ x: center.x - halfX, y: center.y }, { x: center.x + halfX, y: center.y }];
    const squareDistance = point => (point.x - guide.x) ** 2 + (point.y - guide.y) ** 2;
    const end = squareDistance(ends[0]) >= squareDistance(ends[1]) ? ends[0] : ends[1];
    return { x: (guide.x + end.x) / 2, y: (guide.y + end.y) / 2 };
  };
  board.rocket = function(partId) {
    const part = partId ? byId.get(partId) : board.getRocketTarget();
    if (!part || part.solved || !part.active || !part.data.RandomBombCanSelect || (part.kind !== 'ring' && part.kind !== 'pull')) return {executed: false, targetId: null};
    board.pointerUp(); board.propMode = null;
    stepSource = 'rocket'; emit('rocket', {partId: part.id}); remove(part, 'rocket'); settle(); return {executed: true, targetId: part.id};
  };
  board.hint = function() {
    const checkpoint = ringPhysics ? ringPhysics.capture() : null, angles = ringPhysics ? board.parts.map(part => [part, part.rotationDeg]) : null;
    try {
    const candidates = [];
    const roundedEven = value => { const floor = Math.floor(value), fraction = value-floor; return fraction === 0.5 ? floor+(floor%2) : Math.round(value); };
    const candidate = (part, fields) => {
      const base = fields.source === 'KnownReleaseMotion' ? 500 : 100;
      const order = part.authoredOrder ?? board.parts.indexOf(part);
      const weight = base+Math.max(0,50-order)+roundedEven(30*(1-Math.min(1,Math.abs(fields.amount)/90)));
      candidates.push(Object.assign({partId:part.id,weight},fields));
    };
    for (const part of board.parts) {
      if (part.solved || !part.active || (part.kind !== 'ring' && part.kind !== 'pull') || partLocked(part)) continue;
      if (canSolve(part)) {
        candidate(part,part.kind==='ring'
          ? {kind:'rotate',source:'KnownReleaseMotion',amount:0,deltaDeg:0}
          : {kind:'pull',source:'KnownReleaseMotion',amount:0,direction:pullDirection(part)});
        continue;
      }
      if (part.kind === 'ring') {
        const baseline = contactState(part), original = part.rotationDeg;
        let best = null;
        for (const sign of [1, -1]) for (let index = 1; index <= 16; index++) {
          const amount = sign*180*index/16, valid = lastValidAngle(part, original, original+amount, baseline);
          applyRotation(part, valid); const free = canSolve(part); applyRotation(part, original);
          if (free && Math.abs(deltaAngle(original+amount, valid)) < 0.5 && (!best || Math.abs(amount) < Math.abs(best.amount))) best = {kind:'rotate',source:'KnownReleaseMotion',amount,deltaDeg:amount};
        }
        candidate(part,best || {kind:'rotate',source:'OperableOnly',amount:15,deltaDeg:15});
      } else {
        candidate(part,{kind:'pull',source:'OperableOnly',amount:1,direction:pullDirection(part)});
      }
    }
    candidates.sort((a,b) => b.weight-a.weight || a.partId.localeCompare(b.partId));
    return candidates[0] || null;
    } finally {
      if (ringPhysics) { ringPhysics.restore(checkpoint); for (const [part, angle] of angles) { part.rotationDeg = angle; part.revision++; refreshPart(part); } }
    }
  };
  board.getSnapshot = function() {
    return {schemaVersion: 1, ...(ringPhysics ? {ringPhysics: ringPhysics.save()} : {}), sourceKey: board.sourceKey, score: board.score, invalidSteps: board.invalidSteps, time: board.time, won: board.won, propMode: board.propMode, pendingReleaseIds: stepReleased.map(part => part.id), stepSource, pendingStep: pendingStep ? Object.assign({}, pendingStep) : null, parts: board.parts.map(part => ({id: part.id, x: part.x, y: part.y, rotationDeg: part.rotationDeg, solved: part.solved, lockCount: part.lockCount, acorn: part.acorn})), solvedBombIds: bombs.filter(bomb => bomb.solved).map(bomb => bomb.id)};
  };

  if (options.snapshot && options.snapshot.sourceKey === level.sourceKey) {
    const saved = options.snapshot; board.score = saved.score; board.invalidSteps = saved.invalidSteps; board.time = saved.time; board.won = saved.won;
    board.propMode = saved.propMode || null;
    for (const state of saved.parts) {
      const part = byId.get(state.id); if (!part) continue;
      Object.assign(part, state); part.revision++; part.collected = part.solved; part.collectTime = board.time-1;
    }
    if (ringPhysics) {
      const restored = ringPhysics.restoreSave(saved.ringPhysics);
      for (const part of board.parts) { const angle = restored ? ringPhysics.angle(part) : ringPhysics.restoreLegacy(part, part.rotationDeg); if (angle !== null) part.rotationDeg = angle; }
    }
    for (const bomb of bombs) bomb.solved = (saved.solvedBombIds || []).includes(bomb.id);
    stepReleased = (saved.pendingReleaseIds || []).map(id => byId.get(id)).filter(Boolean);
    stepSource = saved.stepSource || null;
    pendingStep = saved.pendingStep ? Object.assign({}, saved.pendingStep) : null;
  } else if (options.rankActive) {
    const collectable = board.parts.filter(part => part.data.CanCollect && part.active);
    for (let index = 0; index < Math.min(3, collectable.length); index++) {
      const other = index+Math.min(collectable.length-index-1, Math.floor(random()*(collectable.length-index)));
      [collectable[index], collectable[other]] = [collectable[other], collectable[index]]; collectable[index].acorn = true;
    }
  }
  for (const part of board.parts) refreshPart(part);
  return board;
}

module.exports = {createBoard, geometry: {pointInPolygon, pointInContours, signedDistance, contoursDistance, shapeDistance, contoursCast, deltaAngle}};
