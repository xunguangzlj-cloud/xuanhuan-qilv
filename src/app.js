const platform = require('./platform');
const config = require('./config');
const { createFriendBoard } = require('./friend-board');
const dataIndex = require('./data-index');
const { createBoard } = require('./core');
const session = require('./session');
const audio = require('./audio');
const { createUI } = require('./ui');
const uiPackages = require('../assets/ui/subpackages-data');
const camera = require('./camera');
const { createRingRenderer } = require('./ring-renderer');
const { createTutorial, drawHand, handImagePath } = require('./tutorial');
const { createCharacterPlayer, createCharacterRenderer } = require('./character-animation');
const { winNextEnabled } = require('./win-presentation');
const { createReleaseEffects } = require('./release-effects');
const { createHomePlayer } = require('./home-animation');
const { createHomeEntryPlayer, createHomeEntryRenderer } = require('./home-entry-animation');
const { createChestSettlement } = require('./chest-settlement');
const { createAmbientEffects } = require('./ambient-effects');
const { sampleChestPose } = require('./reward-presentation');
const { createChestEffects } = require('./chest-effects');
const { createViewportGestures } = require('./viewport-gestures');
const { createPropEffects, createPropEffectsModel } = require('./prop-effects');
const { createPropUnlockEffects } = require('./prop-unlock-effects');
const { createScreenShake } = require('./screen-shake');
const { createBackgroundRenderer } = require('./background-renderer');
const { createRatchetFeedback } = require('./ratchet-feedback');

async function boot() {
  const view = platform.viewport();
  const canvas = platform.createCanvas();
  canvas.width = Math.round(view.width * view.ratio);
  canvas.height = Math.round(view.height * view.ratio);
  if (canvas.style) { canvas.style.width = view.width + 'px'; canvas.style.height = view.height + 'px'; }
  const ctx = canvas.getContext('2d');
  platform.showStartup(config.text.Button_Loading);
  // 使用主题色板1001。
  const matchedPalette = config.RingColorConfig.find(row => row.SchemeId === 1001 && row.StyleId === 0);
  let save = platform.readSave() || session.createSave();
  let screen = 'home';
  let modal = null;
  let modalParent = null, propGuide = null, propIntro = null;
  let selectedPropId = null;
  let board = null;
  let currentSource = null;
  let guide = null;
  let ringRenderer = null;
  let characterRenderer = null, characterPlayer = null, characterData = null;
  let homeLogo = null, homePlayer = null, homePlayPending = false;
  let homeEntryRenderer = null, homeEntryPlayer = null;
  let rewardRenderer = null, rewardData = null;
  let chestSettlement = null, settlementAge = 0;
  let winTitleKey = 'LevelComplete_Title', winCheerKey = 'LevelComplete_CheerUp_0';
  let winAge = 0;
  let solveSoundPending = false;
  let dragging = false;
  let pressedControl = null;
  let lastFrame = 0;
  let interactivePending = false;
  let winDelay = null;
  let dataLoading = false;
  let saveAge = 0;
  let dailyCheckAge = 0;
  let ratchetPart = null, fingerPoint = null;
  let helpPage = 0, helpAge = 0;
  const friends = createFriendBoard();
  let selectedAvatar = null;
  let modalPointerY = null;
  let modalMoved = false;
  let releaseEffects = null;
  let ambientEffects = null;
  let chestEffects = null;
  let propEffects = createPropEffectsModel();
  let propUnlockEffects = null;
  let viewportGestures = null, zoomModified = false;
  let gameRect = null, appAge = 0;
  const ratchet = createRatchetFeedback({ clock: () => lastFrame / 1000, stop: () => audio.stopSound?.('rr_sfx_ring_ratchet_click'), play: () => { if (!save.settings.sound) return false; sound('rr_sfx_ring_ratchet_click'); return true; } });
  const screenShake = createScreenShake({ enabled: () => config.defaults.GameBord.GameBordScreenShake === 1 });
  let backgroundRenderer = null;
  let cancelInput = () => { pointerCancel(); if (viewportGestures) viewportGestures.cancel(); };
  const chunkCache = new Map();
  let ringPhysicsFactory = null;
  const [geometry] = await Promise.all([platform.readData('geometry'), ...uiPackages.map(item => platform.ensurePackage(item.name))]);
  let ui = createUI({ canvas, ctx, width: view.width, height: view.height, loadImage: platform.loadImage, headerInset: view.headerInset });
  if (platform.createRenderCanvas) {
    // 背景仅烘焙一次；先释放其临时GL上下文，再建立持续使用的渲染器。
    try {
      backgroundRenderer = await createBackgroundRenderer({ canvas: platform.createRenderCanvas(), createCanvas: platform.createRenderCanvas, loadImage: platform.loadImageAsync, width: view.width, height: view.height, ratio: view.ratio });
    } catch (error) { console.warn('原背景材质加载失败，使用纸纹回退', error); }
    const characterCanvas = platform.createRenderCanvas();
    // 关内消除与胜利环境不会在同一帧绘制，可共用一张粒子画布。
    const phaseParticleCanvas = platform.createRenderCanvas();
    // 不同渲染器独立准备；仍在首个可交互场景前等待全部完成。
    await Promise.all([
      (async () => {
    try {
      ringRenderer = await createRingRenderer({ canvas: platform.createRenderCanvas(), loadImage: platform.loadImageAsync, width: view.width, height: view.height, ratio: view.ratio });
    } catch (error) { console.warn('原材质暂不可用，使用轮廓绘制', error); }
      })(),
      (async () => {
    try {
      characterData = await platform.readData('characters');
      characterRenderer = await createCharacterRenderer({ canvas: characterCanvas, loadImage: platform.loadImageAsync, data: characterData, width: view.width, height: view.height, ratio: view.ratio });
    } catch (error) { console.warn('原胜利角色加载失败', error); }
      })(),
      (async () => {
    try {
      const homeData = await platform.readData('home-characters');
      homePlayer = createHomePlayer(homeData);
      homeLogo = await platform.loadImageAsync('ui-art-1/brand-logo.png');
      homeEntryPlayer = createHomeEntryPlayer(homeData);
      homeEntryRenderer = await createHomeEntryRenderer({ createCanvas: platform.createRenderCanvas, loadImage: platform.loadImageAsync, data: homeData, width: view.width, height: view.height, ratio: view.ratio });
    } catch (error) { console.warn('原主页动画加载失败', error); }
      })(),
      (async () => {
    try {
      rewardData = await platform.readData('rewards');
      rewardRenderer = await createCharacterRenderer({ canvas: characterCanvas, loadImage: platform.loadImageAsync, data: rewardData, character: 'chest', width: view.width, height: view.height, ratio: view.ratio });
    } catch (error) { console.warn('原礼盒动画加载失败', error); }
      })(),
      (async () => {
    try {
      releaseEffects = await createReleaseEffects({ canvas: phaseParticleCanvas, createCanvas: platform.createRenderCanvas, loadImage: platform.loadImageAsync, width: view.width, height: view.height, ratio: view.ratio });
    } catch (error) { console.warn('原消除特效加载失败', error); }
      })(),
      (async () => {
    try {
      ambientEffects = await createAmbientEffects({ canvas: phaseParticleCanvas, createCanvas: platform.createRenderCanvas, loadImage: platform.loadImageAsync, width: view.width, height: view.height, ratio: view.ratio });
    } catch (error) { console.warn('原胜利环境特效加载失败', error); }
      })(),
      (async () => {
    try {
      chestEffects = await createChestEffects({ canvas: platform.createRenderCanvas(), createCanvas: platform.createRenderCanvas, loadImage: platform.loadImageAsync, width: view.width, height: view.height, ratio: view.ratio });
    } catch (error) { console.warn('原宝箱特效加载失败', error); }
      })(),
      (async () => {
    try {
      propEffects = await createPropEffects({ model: propEffects, characterCanvas, canvas: platform.createRenderCanvas(), createCanvas: platform.createRenderCanvas, loadImage: platform.loadImageAsync, width: view.width, height: view.height, ratio: view.ratio });
    } catch (error) { console.warn('原道具特效加载失败，保留原命中时序', error); }
      })(),
      (async () => {
    try {
      propUnlockEffects = await createPropUnlockEffects({ canvas: platform.createRenderCanvas(), createCanvas: platform.createRenderCanvas, loadImage: platform.loadImageAsync, width: view.width, height: view.height, ratio: view.ratio });
    } catch (error) { console.warn('原解锁粒子加载失败', error); }
      })(),
    ]);
  }
  console.info('RR_RENDER_HEALTH82', { ringReady: !!ringRenderer, ringContextLost: !!(ringRenderer && ringRenderer.gl && ringRenderer.gl.isContextLost && ringRenderer.gl.isContextLost()), background: backgroundRenderer && backgroundRenderer.mode, backgroundError: backgroundRenderer && backgroundRenderer.error });
  let boardCamera = { x: 0, y: 0, scale: 1, cx: view.width / 2, cy: view.height / 2 };

  function persist() {
    if (board && screen === 'game') {
      save.snapshot = board.getSnapshot(); save.snapshotKey = board.sourceKey;
      save.propAction = propEffects.actions.length ? { sourceKey: board.sourceKey, effects: propEffects.snapshot() } : null;
    }
    platform.writeSave(save);
  }

  function sound(name, loop = false) { audio.play(name, save.settings, loop).catch(error => console.warn('音频加载失败', error)); }
  function localDate() {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function fitBoard() {
    if (!currentSource) return;
    const uiScale = view.width / 1080;
    const safeTop = Math.max(0, view.safeArea?.top || 0);
    const safeBottom = Math.max(0, view.height - (view.safeArea?.bottom ?? view.height));
    // 原SafeArea父容器缩进后，RingRect仍保持80/676及向上82的布局。
    gameRect = { x: 40 * uiScale, y: safeTop + 256 * uiScale, width: view.width - 80 * uiScale, height: view.height - safeTop - safeBottom - 676 * uiScale };
    const framing = camera.calculateFraming(camera.worldRectFromAabb(currentSource.declaredBounds), view.width, view.height, gameRect);
    boardCamera = { x: framing.cameraX, y: framing.cameraY, scale: framing.pixelsPerWorld, cx: view.width / 2, cy: view.height / 2 };
    const options = { camera: boardCamera, width: view.width, height: view.height, bounds: camera.worldRectFromAabb(currentSource.declaredBounds), cameraZoomAndPan: config.defaults.RingRotationFeelFunction.CameraZoomAndPan };
    if (viewportGestures) viewportGestures.reset(options);
    else viewportGestures = createViewportGestures({ ...options,
      onChange: value => { boardCamera = value; }, onControlChanged: value => { zoomModified = value; },
      onSuppressGameplay: () => { pointerCancel(); }, isOverGui: (x, y) => !!ui.hit(x, y)
    });
  }

  function toWorld(x, y) {
    return [(x - boardCamera.cx) / boardCamera.scale + boardCamera.x, (boardCamera.cy - y) / boardCamera.scale + boardCamera.y];
  }

  function onEvent(event) {
    if (event.type === 'collect') {
      if (guide) guide.collect(event.kind);
      const part = board.parts.find(value => value.id === event.partId);
      if (part && releaseEffects) releaseEffects.emit(part);
      solveSoundPending = true;
    } else if (event.type === 'blocked') sound('rr_sfx_blocked');
    else if (event.type === 'rotation' && event.partId === ratchetPart && fingerPoint) {
      ratchet.notify(event.deltaDeg, fingerPoint);
    }
    // 原GameplayManager两个序列化实例的completeLevelDelay均为1秒，独立于粒子池回收。
    else if (event.type === 'win') { if (guide) guide.finish(); winDelay = 1; }
  }

  async function enterGame() {
    if (dataLoading) return;
    dataLoading = true;
    cancelInput();
    modal = null;
    modalParent = null; propGuide = null; propIntro = null;
    session.clearPendingFreeProps(save);
    const definition = session.levelDefinition(save);
    const chunkName = dataIndex.levelChunks[definition.port_source_key];
    try {
      if (!chunkCache.has(chunkName)) {
        const chunk = await platform.readData(chunkName);
        chunkCache.set(chunkName, chunk);
        if (chunkCache.size > 2) chunkCache.delete(chunkCache.keys().next().value);
      }
      const level = chunkCache.get(chunkName)[definition.port_source_key];
      const nativeLevel = await platform.readNativeLevel(chunkName, level.sourceKey, geometry);
      if (!ringPhysicsFactory) ringPhysicsFactory = await require('./load-ring-physics-v1').loadRingPhysicsFactory();
      currentSource = level;
      guide = null;
      if (ringRenderer) ringRenderer.resetLevel();
      board = createBoard(level, { geometries: geometry, nativeLevel, ringPhysicsFactory, solveOnDragExit: config.defaults.GameBord.GameBordDrag, onEvent, snapshot: save.snapshotKey === level.sourceKey ? save.snapshot : null, rankActive: false });
      for (const part of board.parts) if (matchedPalette['Color' + part.palette]) part.color = '#' + matchedPalette['Color' + part.palette];
      board.propMode = null;
      selectedPropId = null;
      propEffects.reset();
      screenShake.reset();
      if (save.snapshotKey === level.sourceKey && save.propAction?.sourceKey === level.sourceKey) propEffects.restore(save.propAction.effects);
      if (releaseEffects) releaseEffects.resetLevel();
      if (ambientEffects) ambientEffects.reset();
      if (chestEffects) chestEffects.reset();
      chestSettlement = null; settlementAge = 0; homePlayPending = false;
      solveSoundPending = false;
      ratchetPart = null; ratchet.end();
      winDelay = board.won ? 0.1 : null;
      screen = 'game';
      characterPlayer = null;
      guide = createTutorial(board, session.currentLevel(save) === 1 && save.mode === 'main');
      fitBoard();
      const intro = session.beginPropIntro(save);
      if (intro) { modal = 'propUnlock'; selectedPropId = intro.propId; propIntro = { ...intro, age: 0, closing: false, closeAge: 0 }; sound('rr_sfx_new_item'); }
      else { const replay = session.replayPropGuide(save); if (replay) useProp(replay.Id, true); }
      sound('rr_bgm_level', true);
      sound('rr_sfx_round_start');
      persist();
    } finally { dataLoading = false; }
  }

  function shadedPaths(paths, color, alpha = 1, translateX = 0) {
    if (!paths.length) return;
    const rgb = /^#[\da-f]{6}$/i.test(color) ? color : '#a7b5b5';
    const value = parseInt(rgb.slice(1), 16);
    const shade = factor => `rgb(${Math.min(255, Math.round((value >> 16) * factor))},${Math.min(255, Math.round(((value >> 8) & 255) * factor))},${Math.min(255, Math.round((value & 255) * factor))})`;
    const ys = paths.flat().map(point => point[1]);
    const gradient = ctx.createLinearGradient(0, Math.min(...ys), 0, Math.max(...ys));
    gradient.addColorStop(0, shade(0.76));
    gradient.addColorStop(0.55, rgb);
    gradient.addColorStop(1, shade(1.17));
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(translateX, 0);
    ctx.beginPath();
    for (const path of paths) {
      if (!path.length) continue;
      ctx.moveTo(path[0][0], path[0][1]);
      for (let index = 1; index < path.length; index++) ctx.lineTo(path[index][0], path[index][1]);
      ctx.closePath();
    }
    ctx.fillStyle = gradient;
    ctx.shadowColor = 'rgba(119,73,31,.2)';
    ctx.shadowBlur = 4 / boardCamera.scale;
    ctx.shadowOffsetY = -2 / boardCamera.scale;
    ctx.fill('evenodd');
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.strokeStyle = shade(0.78);
    ctx.lineWidth = 0.026;
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.restore();
  }

  function drawBoard(previewOnly = false) {
    if (!board) return;
    ctx.save();
    ctx.setTransform(view.ratio, 0, 0, view.ratio, 0, 0);
    const shake = screenShake.offset(), renderCamera = { ...boardCamera, x: boardCamera.x + shake.x, y: boardCamera.y + shake.y };
    ctx.translate(renderCamera.cx, renderCamera.cy);
    ctx.scale(renderCamera.scale, -renderCamera.scale);
    ctx.translate(-renderCamera.x, -renderCamera.y);
    // 上下文失效时启用已有轮廓回退，不能把未画出的物件标记成已绘制。
    const activeRenderer = ringRenderer && !(ringRenderer.gl && ringRenderer.gl.isContextLost && ringRenderer.gl.isContextLost()) ? ringRenderer : null;
    const pose = !previewOnly && !modal && guide && guide.pose();
    const guidePart = pose && board.parts.find(value => value.id === pose.ring.partId);
    const handPoint = pose && {
      x: (pose.hand.worldX - boardCamera.x) * boardCamera.scale + boardCamera.cx,
      y: (boardCamera.y - pose.hand.worldY) * boardCamera.scale + boardCamera.cy
    };
    const overlay = pose ? { guide: guidePart && { part: guidePart, camera: boardCamera, pose: pose.ring }, hand: { pose: pose.hand, point: handPoint, scale: view.width / 1080 } } : null;
    const rendered = activeRenderer ? activeRenderer.drawParts(ctx, board.parts, renderCamera, overlay) : new Set();
    for (const part of board.parts) {
      if (part.solved) continue;
      if (!rendered.has(part.id)) {
        shadedPaths(part.body, part.color);
        shadedPaths(part.pegs.flatMap(peg => peg.paths), part.color);
      }
      if (part.locks > 0) {
        ctx.save();
        ctx.translate(part.x, part.y);
        ctx.scale(1, -1);
        ctx.fillStyle = '#f1c357';
        ctx.font = 'bold .5px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(String(part.locks), 0, 0);
        ctx.restore();
      }
    }
    ctx.restore();
    if (!previewOnly && releaseEffects) releaseEffects.draw(ctx, renderCamera);
    if (pose && !activeRenderer) {
      ctx.save();
      ctx.setTransform(view.ratio, 0, 0, view.ratio, 0, 0);
      drawHand(ctx, platform.loadImage(handImagePath), pose.hand, handPoint, view.width / 1080);
      ctx.restore();
    }
  }

  function model() {
    const definition = session.levelDefinition(save);
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const secondsLeft = Math.max(0, Math.floor((midnight - now) / 1000));
    const dailyCountdown = save.daily.dates.includes(localDate()) ? ui.localized('FirstWin_Home_Btn_Win') : [Math.floor(secondsLeft / 3600), Math.floor(secondsLeft / 60) % 60, secondsLeft % 60].map(value => String(value).padStart(2, '0')).join(':');
    const settlement = chestSettlement && chestSettlement.view();
    return {
      level: screen === 'win' && save.lastWin ? save.lastWin.level : session.currentLevel(save),
      nextLevel: session.currentLevel(save), nextDifficulty: definition.difficulty,
      enteredEndless: screen === 'win' && save.lastWin?.mode === 'main' && save.mode === 'endless',
      score: screen === 'win' ? save.lastWin?.score || 0 : board?.score || 0,
      coins: save.coins, props: save.props, difficulty: screen === 'win' ? save.lastWin?.difficulty : definition.difficulty,
      mode: save.mode, themeId: save.themeId || 0, settings: save.settings, modal, modalParent, selectedPropId, propGuide, propIntro, pendingFreeProps: save.pendingFreeProps, baseScreen: screen,
      profile: save.profile, selectedAvatar, daily: save.daily, chest: { ...save.chest, ...session.chestThreshold(save), remaining: Math.max(0, session.chestThreshold(save).count - save.chest.progress) },
      dataLoading, unlockedProps: save.unlockedProps, drawBoard: () => drawBoard(false), hasUnfinished: !!save.snapshot, zoomModified,
      drawPropEffects: propEffects.draw ? target => propEffects.draw(target, { coordinateScale: view.width / 1080, time: appAge }) : null,
      drawPropUnlockEffects: propUnlockEffects ? (target, layer, anchor) => propUnlockEffects.draw(target, layer, propIntro, anchor, { coordinateScale: view.width / 1080, time: appAge }) : null,
      drawBoardPreview: () => drawBoard(true),
      drawBackground: backgroundRenderer ? target => backgroundRenderer.draw(target) : null,
      backgroundColor: '#f9eedb', tutorialFirstLevel: save.mode === 'main' && save.mainLevel === 1,
      tutorialInstruction: '', tutorialInstructionKey: guide ? guide.textKey : '',
      winTitleKey, evaluationKey: winCheerKey, winAge, winNextEnabled: settlement ? settlement.nextEnabled : winNextEnabled(winAge, session.isChestClaimable(save)),
      settlement,
      homeNodePresentation: homePlayer ? id => homePlayer.nodePose(id) : null,
      version: '0.8.4',
      drawHome: homeLogo && homePlayer ? (target, area) => {
        // 中文品牌沿用主页入场与退场，整幅标题只做轻微呼吸动画。
        const size = area.w * (1.08 + Math.sin(homePlayer.elapsed * 1.5) * .012);
        target.save(); target.globalAlpha *= homePlayer.anchor(area).alpha;
        target.drawImage(homeLogo, area.x + (area.w - size) / 2, area.y + (area.h - size) / 2, size, size);
        target.restore();
      } : null,
      drawHomeEntry: homeEntryRenderer?.available && homeEntryPlayer ? (target, key, area) => homeEntryRenderer.draw(target, key, homeEntryPlayer.pose(key), area, view.width / 1080) : null,
      drawChest: rewardRenderer && rewardData && settlement ? (target, anchor) => rewardRenderer.draw(target, sampleChestPose(rewardData, settlement.rewardAge), { ...anchor, coordinateScale: view.width / 1080 }) : null,
      drawAmbient: ambientEffects ? (target, area) => ambientEffects.draw(target, { x: area.x + area.w / 2, y: area.y + area.h / 2, scale: area.sx, coordinateScale: view.width / 1080 }) : null,
      drawChestTrail: chestEffects ? (target, point) => chestEffects.drawTrail(target, { ...point, coordinateScale: view.width / 1080 }) : null,
      drawChestBoom: chestEffects ? (target, area) => chestEffects.drawBoom(target, { x: area.x + area.w / 2, y: area.y + area.h / 2, scale: area.sx, coordinateScale: view.width / 1080 }) : null,
      drawCharacter: characterRenderer && characterPlayer ? (target, area) => characterRenderer.draw(target, characterPlayer.pose(), { x: area.x + area.w / 2, y: area.y + area.h / 2, scale: area.sx, coordinateScale: view.width / 1080 }) : null,
      friendRanking: true, friendScore: save.totalScore || 0, friendsHint: friends.hint, drawFriends: (target, box) => friends.draw(target, box),
      helpAge, helpPage, howToPlayPage: helpPage + 1, language: save.settings.language || 'ZH_CN',
      showAvatar: save.mainLevel >= 11, rankUnlocked: true,
      dailyCountdown,
      showDaily: save.mainLevel - 1 >= config.DailyFirstWinConfig['1001'].OpenLevel,
      progress: board ? board.parts.filter(part => part.kind === 'ring' || part.kind === 'pull').filter(part => part.solved).length / Math.max(1, board.parts.filter(part => part.kind === 'ring' || part.kind === 'pull').length) : 0
    };
  }

  function useProp(id, fromUnlock = false) {
    if (!board || screen !== 'game' || propEffects.busy) return;
    const prop = config.PropConfig[String(id)];
    if (!save.unlockedProps.includes(id)) {
      platform.toast(config.text.Booster_UnlockPrompt.replace('{0}', prop.UnlockLv).replace(/<[^>]*>/g, ''));
      return;
    }
    if (!session.canUseProp(save, id)) { platform.toast(config.text.Ads_NoNetwork_Desc_1); return; }
    const state = session.beginPropGuide(save, id, { fromUnlock });
    if (!state) return;
    selectedPropId = id; modal = 'propGuide'; modalParent = null;
    propGuide = { ...state, fromUnlock, stage: state.first ? 'tip' : 'ready', age: 0, readyAge: 0, closeAge: 0 };
    if (!state.first && id === 201) board.hammer();
    persist();
  }

  function closePropGuide() {
    if (!propGuide || propGuide.stage === 'closing') return;
    session.markPropGuideInteracted(save, propGuide.propId);
    propGuide.previousStage = propGuide.stage; propGuide.stage = 'closing'; propGuide.closeAge = 0;
    if (board) board.propMode = null;
    persist();
  }

  function confirmPropGuide() {
    if (!propGuide || propGuide.stage !== 'tip') return;
    propGuide.stage = 'ready'; propGuide.readyAge = 0; propGuide.tipCloseAge = 0;
    session.markPropGuideInteracted(save, propGuide.propId);
    if (propGuide.propId === 201) board.hammer();
    persist();
  }

  function fireRocket() {
    if (propEffects.busy || !session.canUseProp(save, 202)) return;
      const part = board.getRocketTarget();
      const iconPoint = ui.propAnchor && ui.propAnchor(202);
      if (!part || !iconPoint || !gameRect) return;
      board.pointerUp(); dragging = false; board.propMode = null;
      const s = view.width / 1080;
      propEffects.startRocket({ targetId: part.id, iconPoint, targetPoint: propPoint(board.getRocketPoint(part.id)), ringRect: { x: gameRect.x / s, y: gameRect.y / s, w: gameRect.width / s, h: gameRect.height / s }, centerX: 540 });
      persist();
  }

  function propPoint(part) {
    const s = view.width / 1080;
    return { x: ((part.x - boardCamera.x) * boardCamera.scale + boardCamera.cx) / s, y: ((boardCamera.y - part.y) * boardCamera.scale + boardCamera.cy) / s };
  }

  async function activate(control) {
    if (!control || dataLoading || homePlayPending || screen === 'game' && board?.won) return;
    if (screen === 'win' && !(chestSettlement ? chestSettlement.view().nextEnabled : winNextEnabled(winAge, session.isChestClaimable(save))) && /next|continue|normal|hard/i.test(control)) return;
    sound('rr_sfx_click');
    const key = String(control).toLowerCase();
    if (key === 'btntheme' && screen === 'game' && !modal && config.defaults.DayOrNightModeChoose.StyleId === 0) { save.themeId = save.themeId === 1 ? 0 : 1; persist(); return; }
    if (modal === 'propGuide') {
      if (!propGuide || propGuide.stage === 'closing') return;
      if (key === 'guidepropconfirm') confirmPropGuide();
      else if (key === 'btnuse' && propGuide.stage === 'ready' && propGuide.propId === 202) { session.markPropGuideInteracted(save, 202); closePropGuide(); fireRocket(); }
      else if (/mask|close|cancel|back/.test(key)) closePropGuide();
      return;
    }
    if (modal === 'claimReward') {
      if (/ad|multiple|double|triple|video|x2/.test(key)) { platform.toast(config.text.Ads_NoNetwork_Desc_1); return; }
      if (/normal|claim|receive|btnok|btn_ok/.test(key) && chestSettlement && chestSettlement.claim(1)) sound('rr_sfx_reward_open');
      return;
    }
    if (modal === 'friends') {
      if (/close|back|bgmask/.test(key)) { friends.close(); modal = null; }
      else if (key === 'friendsprev') friends.turn(-1);
      else if (key === 'friendsnext') friends.turn(1);
      else if (key === 'friendsrefresh') { friends.sync(save.totalScore || 0); friends.refresh(); }
      return;
    }
    if (key === 'ranklistlocked' || /rank|leaderboard/.test(key)) {
      modal = 'friends'; friends.sync(save.totalScore || 0); friends.open(); return;
    }
    if (modal === 'avatar') {
      if (key.startsWith('avatar:')) { selectedAvatar = Number(key.slice(7)); return; }
      if (/random/.test(key)) { const heads = Object.keys(config.HeadConfig).map(Number); selectedAvatar = heads[Math.floor(Math.random() * heads.length)]; return; }
      if (/edit/.test(key)) { const name = await platform.editName(save.profile.name); if (name !== null) { save.profile.name = name; persist(); } return; }
      if (key === 'btnbg') { save.profile.avatar = selectedAvatar || save.profile.avatar || 1; modal = null; persist(); return; }
    }
    if (modal === 'settings' && /edit/.test(key)) { const name = await platform.editName(save.profile.name); if (name !== null) { save.profile.name = name; persist(); } return; }
    if (modal === 'settings' && /random/.test(key)) { const heads = Object.keys(config.HeadConfig).map(Number); save.profile.avatar = heads[Math.floor(Math.random() * heads.length)]; persist(); return; }
    if (modal === 'about' && /terms|privacy/.test(key)) { platform.toast('无法加载，请稍后重试'); return; }
    if (key.startsWith('language:')) { save.settings.language = String(control).slice(9); modal = null; persist(); return; }
    if (/language/.test(key)) { modalParent = null; modal = 'language'; return; }
    if (/howtoplay/.test(key)) { modalParent = modal === 'settings' ? 'settings' : null; helpPage = 0; helpAge = 0; modal = 'howtoplay'; return; }
    if (/about/.test(key)) { modalParent = modal === 'settings' ? 'settings' : null; modal = 'about'; return; }
    if (modal === 'howtoplay' && /^dot[123]$/.test(key)) { helpPage = Number(key.slice(3)) - 1; helpAge = 0; return; }
    if (modal === 'howtoplay' && /complete|finish/.test(key)) { modal = modalParent; modalParent = null; return; }
    if (modal === 'howtoplay' && /next|right|ok/.test(key)) { helpPage = Math.min(2, helpPage + 1); helpAge = 0; return; }
    if (modal === 'howtoplay' && /left|prev/.test(key)) { helpPage = Math.max(0, helpPage - 1); helpAge = 0; return; }
    if (modal === 'daily' && key === 'btnok') { await enterGame(); return; }
    if (modal === 'daily' && /claim|reward|btnbg|receive/.test(key)) { if ((!key.startsWith('dailyreward:') || Number(key.split(':')[1]) === save.daily.pendingDay) && session.claimDaily(save)) { sound('rr_sfx_reward_open'); persist(); } return; }
    if (key === 'prop:201' || key === 'prop:202') { useProp(Number(key.slice(5))); return; }
    if (/zoomrestore/.test(key)) { if (viewportGestures) viewportGestures.restore(); return; }
    if (/setting/.test(key)) { modal = 'settings'; return; }
    if (/music/.test(key)) { save.settings.music = !save.settings.music; if (!save.settings.music) audio.stopMusic(); else sound(screen === 'home' ? 'rr_bgm_maintheme' : 'rr_bgm_level', true); persist(); return; }
    if (/sound/.test(key)) { save.settings.sound = !save.settings.sound; audio.setSoundMuted?.(!save.settings.sound); persist(); return; }
    if (/vibrat/.test(key)) { save.settings.vibration = !save.settings.vibration; persist(); return; }
    if (/close|cancel|back|bgmask/.test(key)) { modal = modalParent; modalParent = null; selectedPropId = null; if (board) board.propMode = null; persist(); return; }
    if (/home|exit/.test(key)) { selectedPropId = null; if (board) board.propMode = null; session.refreshDaily(save, localDate()); persist(); screen = 'home'; modal = null; if (homePlayer) homePlayer.reset(); if (homeEntryPlayer) homeEntryPlayer.reset(); sound('rr_bgm_maintheme', true); return; }
    if (/avatar|profile/.test(key)) { selectedAvatar = save.profile.avatar || 1; modal = 'avatar'; return; }
    if (/daily|firstwin/.test(key)) { session.refreshDaily(save, localDate()); modal = 'daily'; return; }
    if (/hammer/.test(key)) { useProp(201); return; }
    if (/skyrocket|rocket/.test(key)) { useProp(202); return; }
    if (/chest|treasure|btn_gift/.test(key)) {
      sound('rr_sfx_progress_chest_pop');
      if (chestSettlement) for (const event of chestSettlement.requestOpen()) if (event.type === 'open-reward') { modal = 'claimReward'; sound('rr_sfx_reward_open'); }
      return;
    }
    if (modal === 'propUnlock' && /ok|continue|claim|confirm|mask/.test(key)) { if (propIntro && !propIntro.closing) { propIntro.flyStart = ui.unlockAnchor?.(); propIntro.flyTarget = ui.propAnchor?.(propIntro.propId); propIntro.closing = true; propIntro.closeAge = 0; } return; }
    if (/ad|free|video/.test(key)) { platform.toast(config.text.Ads_NoNetwork_Desc_1); return; }
    if (/restart|replay/.test(key)) { save.snapshot = null; save.snapshotKey = null; save.propAction = null; await enterGame(); return; }
    if (/normal|hard|continue|next|play|^btnok$|^btn_ok$/.test(key)) {
      if (screen === 'home' && homePlayer) { homePlayer.close(); homePlayPending = true; }
      else await enterGame();
      return;
    }
  }

  function pointerDown(x, y) {
    audio.resumeMusic(save.settings);
    modalPointerY = modal === 'language' ? y : null;
    modalMoved = false;
    pressedControl = ui.hit(x, y);
    const hammerGuide = modal === 'propGuide' && propGuide?.stage === 'ready' && propGuide.propId === 201;
    if (pressedControl || modal && !hammerGuide || screen !== 'game' || dataLoading || board.won || propEffects.busy) return;
    if (board.propMode === 'hammer') {
      const part = board.pickPart(...toWorld(x, y));
      if (part) { session.markPropGuideInteracted(save, 201); board.propMode = null; propEffects.startHammer({ targetId: part.id, point: { x: x / (view.width / 1080), y: y / (view.width / 1080) } }); persist(); }
      else closePropGuide();
      return;
    }
    const captured = board.pointerDown(...toWorld(x, y));
    dragging = !!captured;
    if (dragging) {
      ratchetPart = captured.kind === 'ring' ? captured.id : null;
      fingerPoint = { x: x * view.ratio, y: y * view.ratio }; ratchet.begin();
    }
    if (dragging && guide) guide.gesture();
  }
  function pointerMove(x, y) {
    if (modal === 'language' && modalPointerY !== null) {
      const delta = y - modalPointerY;
      if (Math.abs(delta) > 3 || modalMoved) { ui.scroll(delta); modalMoved = true; pressedControl = null; }
      modalPointerY = y;
    }
    fingerPoint = { x: x * view.ratio, y: y * view.ratio };
    if (dragging && board && !modal) board.pointerMove(...toWorld(x, y));
  }
  function pointerUp(x, y) {
    ratchetPart = null; ratchet.end();
    if (dragging && board) { board.pointerUp(); dragging = false; if (guide) guide.release(); persist(); }
    const released = ui.hit(x, y);
    if (pressedControl && released === pressedControl) activate(released).catch(error => { console.error('操作失败', error); platform.toast('加载失败，请重试'); });
    pressedControl = null;
    modalPointerY = null;
  }
  function pointerCancel() {
    ratchetPart = null; ratchet.end();
    if (dragging && board) { board.pointerUp(); dragging = false; if (guide) guide.release(); persist(); }
    pressedControl = null;
    modalPointerY = null;
  }
  if (platform.onTouchSet) {
    let primary = null, multiTouch = false;
    cancelInput = () => { primary = null; multiTouch = false; pointerCancel(); if (viewportGestures) viewportGestures.cancel(); };
    platform.onTouchSet(canvas, event => {
      const wasMulti = multiTouch;
      const gesture = screen === 'game' && !modal && viewportGestures ? viewportGestures.handle(event, { propActive: propEffects.busy || board.propMode === 'hammer' }) : null;
      if (event.type === 'cancel') { primary = null; multiTouch = false; pointerCancel(); return; }
      if (event.touches.length >= 2 || gesture?.suppressed) { if (!multiTouch) pointerCancel(); multiTouch = true; primary = null; return; }
      if (wasMulti) { if (!event.touches.length) multiTouch = false; return; }
      const point = event.changedTouches.find(value => value.id === primary) || event.changedTouches[0];
      if (event.type === 'start' && primary == null && point) { primary = point.id; pointerDown(point.x, point.y); }
      else if (point && point.id === primary && event.type === 'move') pointerMove(point.x, point.y);
      else if (point && point.id === primary && event.type === 'end') { primary = null; pointerUp(point.x, point.y); }
    });
  } else platform.onPointer(canvas, pointerDown, pointerMove, pointerUp, pointerCancel);
  platform.onHide(() => { cancelInput(); persist(); });
  function resizeView() {
    const next = platform.viewport();
    if (next.width === view.width && next.height === view.height && next.ratio === view.ratio && next.safeArea?.top === view.safeArea?.top && next.safeArea?.bottom === view.safeArea?.bottom && next.headerInset === view.headerInset) return;
    if (dragging && board) { board.pointerUp(); dragging = false; if (guide) guide.release(); }
    pressedControl = null; modalPointerY = null;
    Object.assign(view, next);
    canvas.width = Math.round(view.width * view.ratio); canvas.height = Math.round(view.height * view.ratio);
    if (canvas.style) { canvas.style.width = view.width + 'px'; canvas.style.height = view.height + 'px'; }
    if (ringRenderer) ringRenderer.resize(view);
    if (characterRenderer) characterRenderer.resize(view);
    if (homeEntryRenderer) homeEntryRenderer.resize(view);
    if (rewardRenderer) rewardRenderer.resize(view);
    if (releaseEffects) releaseEffects.resize(view);
    if (ambientEffects) ambientEffects.resize(view);
    if (chestEffects) chestEffects.resize(view);
    if (propEffects.resize) propEffects.resize(view.width, view.height, view.ratio);
    if (propUnlockEffects) propUnlockEffects.resize(view);
    if (backgroundRenderer) backgroundRenderer.resize(view);
    ui = createUI({ canvas, ctx, width: view.width, height: view.height, loadImage: platform.loadImage, headerInset: view.headerInset });
    fitBoard();
    return true;
  }
  if (platform.onResize) platform.onResize(resizeView);
  // 异步资源准备期间可能已发生尺寸变化；监听接通后再同步一次，首帧使用最终视口。
  const initialView = { width: view.width, height: view.height, ratio: view.ratio };
  if (resizeView()) console.info('RR_BOOT_VIEWPORT_RESYNC', { from: initialView, to: { width: view.width, height: view.height, ratio: view.ratio }, canvas: { width: canvas.width, height: canvas.height } });

  function draw(timestamp) {
    const dt = lastFrame ? Math.min((timestamp - lastFrame) / 1000, 0.05) : 0;
    lastFrame = timestamp;
    appAge += dt;
    if (modal === 'howtoplay') helpAge += dt;
    if (propIntro) {
      propIntro.age += dt;
      if (propIntro.closing) {
        propIntro.closeAge += dt;
        const flyEnd = .5 + .8600000143051147 + (Math.max(1, Math.min(6, propIntro.grantCount)) - 1) * .07999999821186066;
        if (propIntro.closeAge >= Math.max(1.3333333730697632, flyEnd + .5)) {
          const id = propIntro.propId, openGuide = session.finishPropIntro(save, id);
          modal = null; propIntro = null; selectedPropId = null;
          if (openGuide) useProp(id, true);
          persist();
        }
      }
    }
    if (propGuide) {
      propGuide.age += dt;
      if (propGuide.stage === 'ready') propGuide.readyAge += dt;
      if (propGuide.tipCloseAge != null) propGuide.tipCloseAge += dt;
      if (propGuide.stage === 'closing') {
        propGuide.closeAge += dt;
        if (propGuide.closeAge >= .3333333432674408) { modal = null; propGuide = null; selectedPropId = null; }
      }
    }
    if (screen === 'win') { winAge += dt; if (characterPlayer) characterPlayer.update(dt); }
    if (screen === 'home' && homePlayer) {
      homePlayer.update(dt);
      if (homePlayPending && homePlayer.closed) { homePlayPending = false; enterGame().catch(error => { console.error('关卡加载失败', error); }); }
    }
    if (homeEntryPlayer) homeEntryPlayer.update(dt, { active: screen === 'home', firstwin: save.mainLevel - 1 >= config.DailyFirstWinConfig['1001'].OpenLevel, rank: modal !== 'rank' });
    if (chestSettlement) {
      settlementAge += dt;
      for (const event of chestSettlement.update(settlementAge)) {
        if (event.type === 'open-reward') { modal = 'claimReward'; sound('rr_sfx_reward_open'); }
        else if (event.type === 'progress-start') { sound('rr_sfx_progress_up'); if (chestEffects) chestEffects.startProgress(); }
        else if (event.type === 'progress-complete') { if (event.final) sound('rr_sfx_progress_chest_unlock'); if (chestEffects) chestEffects.finishProgress({ full: event.final }); }
        else if (event.type === 'closed') modal = null;
      }
    }
    if (board && screen === 'game' && (!modal || modal === 'propGuide' && propGuide?.stage !== 'tip') && !dataLoading) {
      board.update(dt);
      if (viewportGestures) viewportGestures.update(dt);
      screenShake.update(dt);
      for (const event of propEffects.update(dt)) {
        if (event.type === 'sound') sound({ ItemHammerHit: 'rr_sfx_item_hammer_hit', ItemRocketFire: 'rr_sfx_item_rocket_fire', ItemRocketShoot: 'rr_sfx_item_rocket_shoot', ItemRocketHit: 'rr_sfx_item_rocket_hit_1' }[event.name]);
        else if (event.type === 'shake') screenShake.trigger(event.kind);
        else if (event.type === 'hit') {
          const id = event.kind === 'hammer' ? 201 : 202;
          const result = event.kind === 'hammer' ? board.hammer(event.targetId) : board.rocket(event.targetId);
          if (result.executed) session.consumeProp(save, id);
          if (id === 201 && propGuide?.propId === 201 && propGuide.stage !== 'closing') closePropGuide();
          // 核心状态、库存和已命中标记在同一次保存中提交，重启不重复执行。
          persist();
        }
      }
      if (!modal && guide) guide.update(dt);
    }
    if (solveSoundPending) {
      // 原消除服务以Time.frameCount去重，Style0同时播放破碎、释放并振动一次。
      solveSoundPending = false;
      sound('rr_sfx_ceramicring_break'); sound('rr_sfx_ceramicring_release');
      platform.vibrate(save.settings.vibration);
    }
    if (releaseEffects) releaseEffects.update(dt);
    if (ambientEffects) ambientEffects.update(dt);
    if (chestEffects) chestEffects.update(dt);
    if (winDelay !== null) {
      winDelay -= dt;
      if (winDelay <= 0) {
        session.finishLevel(save, { score: board.score, time: board.time }, localDate());
        friends.sync(save.totalScore || 0);
        save.propAction = null;
        screen = 'win'; modal = null; winDelay = null;
        winAge = 0;
        settlementAge = 0;
        chestSettlement = createChestSettlement(save, { onPersist: persist });
        if (ambientEffects) ambientEffects.emit();
        if (chestEffects) chestEffects.reset();
        const titleIndex = Math.floor(Math.random() * 6);
        winTitleKey = titleIndex ? 'LevelComplete_Title_' + titleIndex : 'LevelComplete_Title';
        winCheerKey = 'LevelComplete_CheerUp_' + Math.floor(Math.random() * 10);
        if (characterData) characterPlayer = createCharacterPlayer(characterData, { onLoop: idle => sound(idle === 'idle1' ? 'rr_vo_complete_squirrel_idle2' : 'rr_vo_complete_squirrel_idle') });
        sound('rr_sfx_level_complete'); sound('rr_vo_complete_squirrel'); persist();
      }
    }
    saveAge += dt;
    dailyCheckAge += dt;
    if (dailyCheckAge >= 60) { if (session.refreshDaily(save, localDate())) persist(); dailyCheckAge = 0; }
    if (saveAge > 2 && board && screen === 'game') { persist(); saveAge = 0; }
    ctx.setTransform(view.ratio, 0, 0, view.ratio, 0, 0);
    ui.draw(screen, model());
    if (interactivePending) { interactivePending = false; if (platform.reportInteractive) platform.reportInteractive(); }
    platform.frame(draw);
  }
  platform.frame(draw);
  // 调试对象只供本地复验原关卡和状态，不出现在玩家界面。
  const debug = { enterGame, activate, get board() { return board; }, get save() { return save; }, get screen() { return screen; }, get modal() { return modal; }, get renderer() { return ringRenderer; }, get tutorial() { return guide; }, get character() { return characterPlayer; }, get characterRenderer() { return characterRenderer; }, get home() { return homePlayer; }, get settlement() { return chestSettlement; }, get ambient() { return ambientEffects; }, get effects() { return releaseEffects; }, get props() { return propEffects; }, get gestures() { return viewportGestures; }, toWorld, get camera() { return boardCamera; }, persist, config };
  if (typeof window !== 'undefined') window.xuanhuanQilvDebug = debug;
  session.refreshDaily(save, localDate());
  const pending = session.pendingChestRewards(save)[0] || session.reserveChestReward(save, { isAutoClaim: true });
  if (pending) { chestSettlement = createChestSettlement(save, { onPersist: persist, transaction: pending }); modal = 'claimReward'; persist(); sound('rr_bgm_maintheme', true); }
  else if (save.mode === 'main' && save.mainLevel <= 1) await enterGame();
  else sound('rr_bgm_maintheme', true);
  interactivePending = true;
  return debug;
}

module.exports = { boot };
