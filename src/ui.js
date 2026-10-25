const { sampleHelpNode } = require('./help-animation');
const { drawFriendUI } = require('./friend-ui');
const data = require('../assets/ui/ui-data-packed');
const themeData = require('../assets/ui/theme-data');
const { coverQuad } = require('./background-renderer');
const { sampleWinNode } = require('./win-presentation');
const config = require('./config');
const { sampleRewardNode, sampleBoxMotion, samplePropMotion, sampleRewardItemNode } = require('./reward-presentation');
const { layoutRichText } = require('./rich-text');
const { samplePropPresentation } = require('./prop-presentation');
const { sampleUnlockFly } = require('./prop-unlock-fly');

// 布局采用原prefab，角色和界面演出在原层级的挂载节点绘制。
function createUI({ canvas, ctx, width, height, loadImage, headerInset = 0 }) {
  const scale = width / data.referenceResolution[0];
  const viewport = { x: 0, y: 0, w: 1080, h: height / scale, sx: 1, sy: 1 };
  const fontFamilies = {};
  const spriteTransforms = new Map();
  let transformBase = null;
  const transformKey = values => values.map(value => Object.is(value, -0) ? '-0' : String(value)).join(',');
  let hits = [];
  let locale = 'ZH_CN';
  let hitClip = null;
  let scrollPage = null, languageScroll = 0, languageScrollMax = 0;
  let giftAnchor = null;
  let rewardFlyTarget = null;
  const propAnchors = {};
  const propBoxes = {};
  let unlockAnchor = null;
  for (const [name, path] of Object.entries(data.fonts)) {
    if (typeof wx !== 'undefined' && wx.loadFont) fontFamilies[name] = wx.loadFont(path) || name;
    else if (typeof FontFace !== 'undefined' && typeof document !== 'undefined') {
      const face = new FontFace(name, `url(${path})`);
      face.load().then(font => document.fonts.add(font)).catch(() => {});
    }
  }
  const color = c => `rgba(${Math.round((c.r || 0) * 255)},${Math.round((c.g || 0) * 255)},${Math.round((c.b || 0) * 255)},${c.a == null ? 1 : c.a})`;
  const localized = (key, args = []) => String((data.textsByLocale && data.textsByLocale[locale] || data.texts)[key] || data.texts[key] || key).replace(/\{(\d+)\}/g, (_, i) => args[i] == null ? '' : args[i]);
  const imageByName = name => data.spritesByName[name];

  function visible(node, template, model) {
    const name = node.name;
    const endless = model.mode === 'endless';
    const difficulty = template === 'levelend_uilevelwin' ? model.nextDifficulty || model.difficulty || 'normal' : model.difficulty || 'normal';
    if (template === 'game_uigame' && model.tutorialFirstLevel && ['TopContent', 'TopContent_1', 'PropContent'].includes(name)) return false;
    if (template === 'game_uigame' && name === 'zoomRestoreBtn') return !!model.zoomModified;
    if (template === 'propguide_uipropguide' && model.propGuide) {
      const state = model.propGuide, stage = state.stage === 'closing' ? state.previousStage : state.stage;
      if (name === 'TopContent') return stage === 'ready';
      if (name === 'ItemTip') return stage === 'tip' || state.tipCloseAge != null && state.tipCloseAge < .1666666716337204;
      if (name === 'BtnUse') return state.propId === 202 && stage === 'ready';
    }
    if (model.active && Object.prototype.hasOwnProperty.call(model.active, name)) return model.active[name];
    if (template === 'home_uihome' || template === 'dailyfirstwin_uidailyfirstwin') {
      const choices = { btnNormal: !endless && difficulty === 'normal' && !model.hasUnfinished, btnHard: !endless && difficulty === 'hard' && !model.hasUnfinished, btnVeryHard: !endless && difficulty === 'veryhard' && !model.hasUnfinished, btnContinue: !endless && !!model.hasUnfinished, roundNormal: endless && difficulty === 'normal' && !model.hasUnfinished, roundHard: endless && difficulty === 'hard' && !model.hasUnfinished, roundVeryHard: endless && difficulty === 'veryhard' && !model.hasUnfinished, roundContinue: endless && !!model.hasUnfinished, btnAvatar: !!model.showAvatar };
      if (name in choices) return choices[name];
    }
    if (template === 'levelend_uilevelwin') {
      const choices = { Btn_Next: !endless, Btn_Round_Next: endless, Trans_Next: !endless && difficulty === 'normal', common_btn_main_hard: !endless && difficulty === 'hard', common_btn_main_veryhard: !endless && difficulty === 'veryhard', round_normal: endless && difficulty === 'normal', round_hard: endless && difficulty === 'hard', round_veryHard: endless && difficulty === 'veryhard', Trans_IQ: !!model.showIQ, BestScore: !!model.isBestScore, round_tips_text: !!model.enteredEndless, Img_BottomBg: false };
      if (name in choices) return choices[name];
    }
    if (template === 'claimreward_uiclaimreward') {
      if (/^RankType[1-4]$/.test(name) || ['txtDesc', 'btnContinue', 'eff_rank_box_01_gp1'].includes(name)) return false;
      if (name === 'btnClaim' || name === 'btnClaimX2') return true;
    }
    if (template.startsWith('setting_')) {
      if (['BtnGM', 'InputField', 'InputField (Legacy)', 'Name', 'ButtonEdit', 'userqhqmm'].includes(name)) return false;
      for (const field of ['music', 'sound', 'vibration']) {
        const prefix = `common_btn_settings_${field}`;
        if (name.startsWith(prefix) && !node.control) return name.includes('_disabled') ? model.settings && model.settings[field] === false : !model.settings || model.settings[field] !== false;
      }
    }
    if (template === 'game_subprefab_propitem') {
      const free = (model.pendingFreeProps?.[model.selectedPropId] || 0) > 0;
      if (name === 'badge_lock') return !!model.propLocked;
      if (name === 'badge_num') return !model.propLocked && !free && (model.propCount || 0) > 0;
      if (name === 'badge_free') return !model.propLocked && free;
      if (name === 'badge_ad') return !model.propLocked && !free && (model.propCount || 0) === 0;
    }
    if (template === 'lang_uilanguage' && name === 'UILanguageItem') return false;
    if (template === 'lang_uilanguageitem' && node.aliases.includes('normal')) return !model.languageSelected;
    if (template === 'lang_uilanguageitem' && node.aliases.includes('select')) return !!model.languageSelected;
    if (template === 'howtoplay_uihowtoplayview') {
      const page = model.howToPlayPage || 1;
      if (name === 'select') return data.templates[template].nodes.find(item => item.id === node.parent)?.name === `dot${page}`;
      if (/^Content[123]$/.test(name)) return name === `Content${page}`;
      if (name === 'btnNextFist') return page === 1;
      if (name === 'btnNextMid') return page === 2;
      if (name === 'btnFinish') return page === 3;
      if (name === 'Previous') return page > 1;
    }
    if (template === 'user_uiuser') {
      if (node.aliases.includes('itemIcon')) return !!model.avatarItem;
      if (node.aliases.includes('avatar_selected')) return model.avatarItemId === (model.selectedAvatar || model.profile && model.profile.avatar || 1);
    }
    if (template === 'home_buttonitem_buttonitem_ranklist') {
      if (name === 'Icon') return !model.drawHomeEntry;
      if (name === 'txtRank') return model.rank != null;
    }
    if (template === 'home_buttonitem_buttonitem_dailyfirstwin' && name === 'Icon') return !model.drawHomeEntry;
    if (template === 'dailyfirstwin_uidailyfirstwin' && node.dayIndex) {
      const days = model.daily?.day ?? model.daily?.currentDay ?? 0;
      const milestones = [3, 5, 7];
      if (name === 'imgComplete') return node.dayIndex <= days;
      if (name === 'imgBoxOpen') return milestones.includes(node.dayIndex) && !!model.daily && (model.daily.claimedDays || []).includes(node.dayIndex);
      if (name === 'imaBoxClose') return milestones.includes(node.dayIndex) && (!model.daily || !(model.daily.claimedDays || []).includes(node.dayIndex));
      if (name === 'Today') return node.dayIndex === days;
    }
    return node.active;
  }

  function rect(node, parent) {
    const t = node.transform;
    const lo = t.m_AnchorMin || { x: .5, y: .5 }, hi = t.m_AnchorMax || lo;
    const pivot = t.m_Pivot || { x: .5, y: .5 }, position = t.m_AnchoredPosition || t.m_LocalPosition || { x: 0, y: 0 };
    const delta = t.m_SizeDelta || { x: 0, y: 0 }, local = t.m_LocalScale || { x: 1, y: 1 };
    const sx = parent.sx * local.x, sy = parent.sy * local.y;
    const w = (parent.w * (hi.x - lo.x) + delta.x * parent.sx) * local.x;
    const h = (parent.h * (hi.y - lo.y) + delta.y * parent.sy) * local.y;
    return { x: parent.x + parent.w * (lo.x + (hi.x - lo.x) * pivot.x) + position.x * parent.sx - w * pivot.x, y: parent.y + parent.h * (1 - lo.y - (hi.y - lo.y) * pivot.y) - position.y * parent.sy - h * (1 - pivot.y), w, h, sx, sy };
  }

  // 缓存原生矩阵值；签名保留逐条变换的参数与次序，不在JS里重算原生矩阵。
  function spriteMatrix(identity, state) {
    if (!ctx.getTransform) return null;
    if (!identity || transformBase === null) return ctx.getTransform();
    const previous = spriteTransforms.get(identity);
    if (previous && previous.state === state) return previous.matrix;
    const source = ctx.getTransform();
    const matrix = source && { a: source.a, b: source.b, c: source.c, d: source.d, e: source.e, f: source.f };
    spriteTransforms.set(identity, { state, matrix });
    return matrix;
  }

  function drawSprite(identity, area, graphic, matrixCacheId, transformState) {
    const sprite = data.sprites[identity] || themeData.sprites[identity];
    if (!sprite || area.w <= 0 || area.h <= 0) return;
    const image = loadImage(sprite.path);
    if (!image) return;
    let { x, y, w, h } = area;
    if (graphic.preserveAspect) {
      const ratio = Math.min(w / sprite.width, h / sprite.height);
      x += (w - sprite.width * ratio) / 2; y += (h - sprite.height * ratio) / 2;
      w = sprite.width * ratio; h = sprite.height * ratio;
    }
    const borders = sprite.border;
    if (graphic.imageType === 1 && borders.some(v => v > 0)) {
      const ppu = sprite.pixelsPerUnit / 100 * (graphic.pixelsPerUnitMultiplier || 1);
      let left = borders[0] / ppu * area.sx, right = borders[2] / ppu * area.sx;
      let top = borders[1] / ppu * area.sy, bottom = borders[3] / ppu * area.sy;
      if (left + right > w) { const factor = w / (left + right); left *= factor; right *= factor; }
      if (top + bottom > h) { const factor = h / (top + bottom); top *= factor; bottom *= factor; }
      const xs = [0, borders[0], sprite.width - borders[2], sprite.width], ys = [0, borders[1], sprite.height - borders[3], sprite.height];
      const dx = [x, x + left, x + w - right, x + w], dy = [y, y + top, y + h - bottom, y + h];
      const matrix = spriteMatrix(matrixCacheId, transformState);
      if (matrix && matrix.a > 0 && matrix.d > 0 && matrix.b === 0 && matrix.c === 0) {
        for (let i = 0; i < 4; i++) { dx[i] = (Math.round(dx[i] * matrix.a + matrix.e) - matrix.e) / matrix.a; dy[i] = (Math.round(dy[i] * matrix.d + matrix.f) - matrix.f) / matrix.d; }
      }
      for (let iy = 0; iy < 3; iy++) for (let ix = 0; ix < 3; ix++) {
        const sw = xs[ix + 1] - xs[ix], sh = ys[iy + 1] - ys[iy], dw = dx[ix + 1] - dx[ix], dh = dy[iy + 1] - dy[iy];
        if (dw > 0 && dh > 0) {
          ctx.save(); ctx.translate(dx[ix] + (sw < 0 ? dw : 0), dy[iy] + (sh < 0 ? dh : 0)); ctx.scale(sw < 0 ? -1 : 1, sh < 0 ? -1 : 1);
          // Unity允许相同UV形成常量采样；Canvas零源宽不会画，改采一像素条带。
          const sx = sw ? Math.min(xs[ix], xs[ix + 1]) : Math.max(0, Math.min(sprite.width - 1, xs[ix] - .5));
          const sy = sh ? Math.min(ys[iy], ys[iy + 1]) : Math.max(0, Math.min(sprite.height - 1, ys[iy] - .5));
          ctx.drawImage(image, sx, sy, Math.abs(sw) || 1, Math.abs(sh) || 1, 0, 0, dw, dh); ctx.restore();
        }
      }
    } else ctx.drawImage(image, x, y, w, h);
  }

  function textValue(node, graphic, template, model) {
    const n = node.name, level = model.level || 1;
    if (model.texts && Object.prototype.hasOwnProperty.call(model.texts, n)) return model.texts[n];
    if (template === 'weakguide_weakguideview' && n === 'txtGuide') return model.tutorialInstruction || localized(model.tutorialInstructionKey);
    if (template === 'claimreward_uiclaimreward' && n === 'txtCongratulations') return localized('LeaderBoard_Reward_1');
    if (template === 'claimreward_propitemtemplate' && /^(txtPropCount|TxtPropCount)$/.test(n)) return `×${model.rewardCount || 0}`;
    if (template === 'dailyfirstwin_uidailyfirstwin' && ['textDay', 'textToday'].includes(n)) return localized(`FirstWin_Weekday_${node.dayIndex || 1}`);
    if (template === 'user_uiuser' && (n === 'Text' || node.aliases.includes('userName'))) return model.profile && model.profile.name || '';
    if (template === 'home_buttonitem_buttonitem_ranklist' && n === 'Desc' && model.friendRanking) return '好友排行';
    if (node.textKey) return localized(node.textKey);
    if (template === 'privacy_uiprivacy' && n === 'txtDesc') return localized('Common_Privacy', [localized('Common_Terms_Terms'), localized('Common_Terms_Policy')]);
    if (template === 'howtoplay_uihowtoplayview' && n === 'Desc') return localized(`Tutorial_Setting_TipText${model.howToPlayPage || 1}`);
    if (template === 'aboutus_uiaboutus' && n.startsWith('Version ')) return `Version ${model.version || '1.1.2'}`;
    if (template === 'lang_uilanguageitem' && n === 'Language') return model.languageTitle || graphic.text;
    if (template === 'home_buttonitem_buttonitem_ranklist') {
      if (n === 'txtRank') return model.rank == null ? '' : `#${model.rank}`;
      if (n === 'Desc') return model.rankUnlocked ? model.rankCountdown || '' : localized('Common_Icon_UnlockLv', [model.rankUnlockLevel || 11]);
    }
    if (template === 'home_buttonitem_buttonitem_dailyfirstwin' && n === 'Desc') return model.dailyCountdown || '';
    if (template === 'dailyfirstwin_uidailyfirstwin' && n === 'TxtDetail') return localized('FirstWin_PopUp_CheerUp_0');
    if (/^text(Level|Round).*Level$|^textLevel|^textRound(Level|Normal)$/.test(n)) return localized(model.mode === 'endless' ? 'Common_Round' : 'Button_LevelXX', [level]);
    if (n === 'TxtLevelNum') return String(level);
    if (n === 'TxtLevel') return model.levelLabel || (model.mode === 'endless' ? '局' : '关卡');
    if (/VeryHard|veryHard/.test(n) && !/Level/.test(n)) return localized('Common_SuperHard');
    if (/^(textHard|textVeryHard|textRoundHard|Hard|veryHard|Common_Hard)$/.test(n)) return localized(n.toLowerCase().includes('very') ? 'Common_SuperHard' : 'Common_Hard');
    if (n === 'TxtScore' || n === 'TxtM_ScoreNum') return String(model.score || 0);
    if (n === 'TxtM_ScoreLabel') return localized('LevelComplete_Score');
    if (n === 'TxtM_Evaluation') return localized(model.winTitleKey || 'LevelComplete_Title');
    if (n === 'TxtM_Next' || /^textLevel_(hard|veryHard|round)/.test(n)) return localized(model.mode === 'endless' ? 'Common_Round' : 'Button_LevelXX', [model.nextLevel || level + 1]);
    if (n === 'textContinue' || n === 'textRoundContinue') return localized('Button_Continue');
    if (n === 'Txtcontinue') return localized('Item_Continue');
    if (n === 'txtbadge_num') return String(model.propCount || 0);
    if (n === 'txtbadgeFree_num') return localized('Common_Free');
    if (n === 'TxtPropNum') return template === 'propunlock_uipropunlock' ? String(model.propIntro?.grantCount ?? model.propCount ?? 0) : `×${model.propCount || 0}`;
    const prop = model.selectedPropId === 202 ? 'Item_Skyrocket' : 'Item_Hammer';
    if (n === 'TxtPropName') return localized(prop);
    if (n === 'TxtItemTip') return localized(prop + '_guide');
    if (n === 'TxtUnlockProp') return localized(template === 'propunlock_uipropunlock' ? 'Item_Unlock_Title' : prop + '_desc');
    if (n === 'TxtM_Pass') return localized(model.evaluationKey || 'LevelComplete_CheerUp_0');
    if (n === 'TxtM_LevelLeft') return (model.chest?.remaining ?? 1) <= 0 ? localized('chest_unlocked') : localized('chest_progress', [model.chest?.remaining ?? 1]);
    if (template === 'propguide_uipropguide' && n === 'Desc') return localized('Button_Use');
    return graphic.text;
  }

  function drawText(node, graphic, area, template, model) {
    const sourceText = String(textValue(node, graphic, template, model));
    if (/<(?:color|size|b|i|br)(?:[\s=>/])/i.test(sourceText)) {
      const margin = graphic.margin || {}, available = Math.max(1, area.w - (margin.x || 0) - (margin.z || 0));
      let fontSize = graphic.fontSize;
      const options = () => ({ fontSize, color: graphic.color, bold: !!(graphic.fontStyle & 1), italic: !!(graphic.fontStyle & 2), scaleY: area.sy, available, wrap: graphic.wrap, fontFamily: `"${fontFamilies[graphic.font] || graphic.font || 'sans-serif'}","${fontFamilies['NotoSansSC-Bold-New'] || 'NotoSansSC-Bold-New'}",sans-serif` });
      let layout = layoutRichText(sourceText, options(), ctx);
      while (graphic.autoSize && fontSize > graphic.fontMin && (layout.height > area.h - (margin.y || 0) - (margin.w || 0) || graphic.wrap === false && layout.width > available)) { fontSize -= 1 / area.sy; layout = layoutRichText(sourceText, options(), ctx); }
      const horizontal = graphic.alignment & 255, vertical = graphic.alignment & 65280;
      const top = vertical === 256 ? area.y + (margin.y || 0) : vertical === 1024 ? area.y + area.h - (margin.w || 0) - layout.height : area.y + (area.h - layout.height) / 2;
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      for (const line of layout.lines) {
        const left = horizontal === 1 ? area.x + (margin.x || 0) : horizontal === 4 ? area.x + area.w - (margin.z || 0) - line.width : area.x + (area.w - line.width) / 2;
        for (const fragment of line.fragments) {
          ctx.font = fragment.font;
          const x = left + fragment.x, y = top + line.baseline;
          for (const effect of node.textEffects || []) if (effect.enabled && effect.kind === 0 && effect.width > 0) { ctx.strokeStyle = color(effect.color); ctx.lineWidth = effect.width * 2 * area.sy; ctx.lineJoin = 'round'; ctx.strokeText(fragment.text, x, y); }
          ctx.fillStyle = color(fragment.style.color); ctx.fillText(fragment.text, x, y);
        }
      }
      return;
    }
    const text = String(textValue(node, graphic, template, model)).replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]+>/g, '');
    const family = fontFamilies[graphic.font] || graphic.font || 'sans-serif';
    const chinese = fontFamilies['NotoSansSC-Bold-New'] || 'NotoSansSC-Bold-New';
    const margin = graphic.margin || {};
    const available = Math.max(1, area.w - (margin.x || 0) - (margin.z || 0));
    let size = graphic.fontSize * area.sy;
    const setFont = () => { ctx.font = `${graphic.fontStyle & 1 ? 'bold ' : ''}${size}px "${family}","${chinese}",sans-serif`; };
    setFont();
    const wrappedLines = () => {
      const lines = [];
      for (const paragraph of text.split('\n')) {
        if (graphic.wrap === false) { lines.push(paragraph); continue; }
        let line = '';
        for (const char of paragraph) {
          if (line && ctx.measureText(line + char).width > available) { lines.push(line); line = char; } else line += char;
        }
        lines.push(line);
      }
      return lines;
    };
    let lines = wrappedLines();
    if (graphic.autoSize) {
      const maxHeight = area.h - (margin.y || 0) - (margin.w || 0);
      while (size > graphic.fontMin * area.sy && (lines.length * size * 1.15 > maxHeight || graphic.wrap === false && lines.some(line => ctx.measureText(line).width > available))) {
        size -= 1; setFont(); lines = wrappedLines();
      }
    }
    const horizontal = graphic.alignment & 255, vertical = graphic.alignment & 65280;
    ctx.textAlign = horizontal === 1 ? 'left' : horizontal === 4 ? 'right' : 'center';
    ctx.textBaseline = 'middle';
    const x = ctx.textAlign === 'left' ? area.x + (margin.x || 0) : ctx.textAlign === 'right' ? area.x + area.w - (margin.z || 0) : area.x + area.w / 2;
    const lineHeight = size * 1.15;
    let y = vertical === 256 ? area.y + (margin.y || 0) + size / 2 : vertical === 1024 ? area.y + area.h - lineHeight * lines.length + size / 2 : area.y + (area.h - lineHeight * lines.length) / 2 + lineHeight / 2;
    for (const line of lines) {
      for (const effect of node.textEffects || []) if (effect.enabled && effect.kind === 0 && effect.width > 0) {
        ctx.strokeStyle = color(effect.color); ctx.lineWidth = effect.width * 2 * area.sy; ctx.lineJoin = 'round'; ctx.strokeText(line, x, y);
      }
      ctx.fillStyle = color(graphic.color); ctx.fillText(line, x, y); y += lineHeight;
    }
  }

  function renderTemplate(name, model, mount, rootBox, mountId, inheritedMatrix = [1, 0, 0, 1, 0, 0]) {
    const cacheTransforms = ['game_uigame', 'weakguide_weakguideview', 'home_uihome', 'levelend_uilevelwin'].includes(name);
    const template = data.templates[name];
    if (!template) return;
    const nodes = Object.fromEntries(template.nodes.map(n => [n.id, n]));
    const boxes = {}, active = {};
    function presentation(id) {
      if (name === 'propguide_uipropguide' || name === 'propunlock_uipropunlock') return samplePropPresentation(name, nodes[id], model);
      if (name === 'howtoplay_uihowtoplayview') return sampleHelpNode(nodes[id], nodes, model.howToPlayPage || 1, model.helpAge || 0);
      if (name === 'home_uihome' && model.homeNodePresentation) return model.homeNodePresentation(id);
      if (name === 'levelend_uilevelwin') return sampleWinNode(id, model.winAge || 0);
      if (name === 'claimreward_uiclaimreward' && model.settlement) return sampleRewardNode(id, model.settlement.flyAge >= 0 ? model.settlement.flyAge : model.settlement.rewardAge, model.settlement.flyAge >= 0);
      if (name === 'claimreward_propitemtemplate') {
        const path = []; let node = nodes[id];
        while (node && node.parent !== '0') { path.unshift(node.name); node = nodes[node.parent]; }
        return { visible: true, graphicAlpha: 1, offsetX: 0, offsetY: 0, ...sampleRewardItemNode(path.join('/'), model.rewardItemAge || 0, !!model.rewardItemClosing) };
      }
      return null;
    }
    function compute(id) {
      if (boxes[id]) return boxes[id];
      const node = nodes[id];
      if (!node.parent || node.parent === '0') boxes[id] = rootBox || { ...viewport };
      else boxes[id] = rect(node, compute(node.parent));
      return boxes[id];
    }
    for (const node of template.nodes) compute(node.id);
    if (name === 'howtoplay_uihowtoplayview') {
      const content = template.nodes.find(node => node.aliases.includes('ShowContent'));
      const dx = -(model.howToPlayPage - 1 || 0) * boxes[content.id].w;
      const shift = id => { boxes[id].x += dx; for (const child of nodes[id].children) shift(child); };
      shift(content.id);
    }
    if (mountId) {
      boxes[mountId] = rootBox;
      const update = id => { for (const child of nodes[id].children) { boxes[child] = rect(nodes[child], boxes[id]); update(child); } };
      update(mountId);
    }
    // 原ContentSizeFitter按文本优选高度和布局组padding展开，教程提示不能保留prefab的零高度。
    function fit(id) {
      const node = nodes[id];
      for (const child of node.children) fit(child);
      if (!node.fitter || !node.fitter.enabled || node.fitter.vertical !== 2) return;
      const box = boxes[id], graphic = node.graphics.find(g => g.kind === 'text');
      let preferred = box.h;
      if (graphic) {
        const sourceText = String(textValue(node, graphic, name, model));
        if (/<(?:color|size|b|i|br)(?:[\s=>/])/i.test(sourceText)) {
          preferred = layoutRichText(sourceText, { fontSize: graphic.fontSize, color: graphic.color, bold: !!(graphic.fontStyle & 1), italic: !!(graphic.fontStyle & 2), scaleY: box.sy, available: box.w, wrap: graphic.wrap, fontFamily: `"${fontFamilies[graphic.font] || graphic.font}","NotoSansSC-Bold-New",sans-serif` }, ctx).height;
        } else {
        const text = sourceText.replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]+>/g, '');
        ctx.font = `${graphic.fontSize * box.sy}px "${fontFamilies[graphic.font] || graphic.font}","NotoSansSC-Bold-New",sans-serif`;
        let lines = 0;
        for (const paragraph of text.split('\n')) {
          let line = '';
          for (const char of paragraph) {
            if (line && ctx.measureText(line + char).width > box.w) { lines++; line = char; } else line += char;
          }
          lines++;
        }
        preferred = lines * graphic.fontSize * box.sy * 1.15;
        }
      } else if (node.layout && node.layout.kind === 'VerticalLayoutGroup') {
        const pad = node.layout.m_Padding;
        preferred = (pad.m_Top + pad.m_Bottom) * box.sy + node.children.reduce((sum, child) => sum + boxes[child].h, 0) + Math.max(0, node.children.length - 1) * (node.layout.m_Spacing || 0);
      }
      const pivot = node.transform.m_Pivot || { y: .5 };
      box.y += (box.h - preferred) * (1 - pivot.y); box.h = preferred;
      const update = child => {
        const old = boxes[child], next = rect(nodes[child], boxes[nodes[child].parent]);
        // 文本自身的优选高度需保留，父节点改变尺寸后只重求锚点位置。
        if (nodes[child].fitter && nodes[child].fitter.vertical === 2) {
          const p = nodes[child].transform.m_Pivot || { y: .5 };
          next.y += (next.h - old.h) * (1 - p.y); next.h = old.h;
        }
        boxes[child] = next;
        for (const descendant of nodes[child].children) update(descendant);
      };
      for (const child of node.children) update(child);
    }
    for (const root of template.nodes.filter(n => mountId ? n.id === mountId : n.parent === '0')) fit(root.id);
    // 原RectTargetStretch按目标pivot重设四边，再重新求其后代布局。
    for (const node of template.nodes) if (node.stretch && node.stretch.topTarget !== '0' && nodes[node.stretch.topTarget] && nodes[node.stretch.bottomTarget]) {
      const top = boxes[node.stretch.topTarget], bottom = boxes[node.stretch.bottomTarget];
      const box = boxes[node.id]; box.y = top.y; box.h = bottom.y - top.y;
      const update = id => { for (const child of nodes[id].children) { boxes[child] = rect(nodes[child], boxes[id]); update(child); } };
      update(node.id);
    }
    function isActive(id) {
      if (id in active) return active[id];
      const node = nodes[id];
      const pose = presentation(id);
      active[id] = (pose && pose.active != null ? pose.active : visible(node, name, model)) && (!pose || pose.visible) && (id === mountId || node.parent === '0' || isActive(node.parent));
      return active[id];
    }
    for (const node of template.nodes) if (node.layout && node.layout.kind !== 'GridLayoutGroup' && node.layout.m_Enabled && isActive(node.id)) {
      const children = node.children.filter(id => isActive(id));
      const horizontal = node.layout.kind === 'HorizontalLayoutGroup';
      const b = boxes[node.id], spacing = node.layout.m_Spacing || 0, pad = node.layout.m_Padding;
      const total = children.reduce((sum, id) => sum + (horizontal ? boxes[id].w : boxes[id].h), 0) + Math.max(0, children.length - 1) * spacing;
      const align = node.layout.m_ChildAlignment || 0;
      let cursor = horizontal ? b.x + (pad.m_Left || 0) + (b.w - total - pad.m_Left - pad.m_Right) * (align % 3) / 2 : b.y + (pad.m_Top || 0) + (b.h - total - pad.m_Top - pad.m_Bottom) * Math.floor(align / 3) / 2;
      const translate = (id, dx, dy) => { boxes[id].x += dx; boxes[id].y += dy; for (const child of nodes[id].children) translate(child, dx, dy); };
      for (const id of children) { const box = boxes[id]; translate(id, horizontal ? cursor - box.x : 0, horizontal ? 0 : cursor - box.y); cursor += (horizontal ? box.w : box.h) + spacing; }
    }
    if (name === 'propguide_uipropguide' && model.propGuide) {
      const source = propBoxes[model.propGuide.propId];
      if (source) for (const [nodeName, offset] of [['ItemTip', 312], ['BtnUse', 289]]) {
        const node = template.nodes.find(item => item.name === nodeName), box = node && boxes[node.id];
        if (!box) continue;
        const dx = viewport.w / 2 - box.w / 2 - box.x, dy = source.y + source.h / 2 - offset - box.h / 2 - box.y;
        const shift = id => { boxes[id].x += dx; boxes[id].y += dy; for (const child of nodes[id].children) shift(child); };
        shift(node.id);
      }
    }
    // 微信顶部系统胶囊不属于原prefab，整行移动顶部UI并同步命中区，棋盘和底部道具保持原布局。
    if (headerInset > 0 && !rootBox) {
      const headers = name === 'game_uigame' ? ['TopContent', 'TopContent_1'] : name === 'home_uihome' ? ['TopPanel'] : [];
      const shift = id => { boxes[id].y += headerInset / scale; for (const child of nodes[id].children) shift(child); };
      for (const node of template.nodes) if (headers.includes(node.name)) shift(node.id);
    }
    function walk(id, matrix = inheritedMatrix, transformState = '') {
      const node = nodes[id], area = boxes[id];
      const themed = model.themeId === 1 ? themeData.templates[name]?.[id] : null;
      if (!isActive(id) || area.w < 0 || area.h < 0) return;
      ctx.save();
      const pose = presentation(id);
      if (pose) {
        const pivot = node.transform.m_Pivot || { x: .5, y: .5 };
        const px = area.x + area.w * pivot.x, py = area.y + area.h * (1 - pivot.y);
        const parent = boxes[node.parent] || viewport;
        const ox = pose.offsetX * parent.sx, oy = pose.offsetY * parent.sy;
        ctx.translate(px + ox, py + oy);
        ctx.scale(pose.scaleX, pose.scaleY); ctx.translate(-px, -py);
        if (cacheTransforms) transformState += '|p:' + transformKey([px + ox, py + oy, pose.scaleX, pose.scaleY, -px, -py]);
        const tx = px + ox - px * pose.scaleX, ty = py + oy - py * pose.scaleY;
        matrix = [matrix[0] * pose.scaleX, matrix[1] * pose.scaleX, matrix[2] * pose.scaleY, matrix[3] * pose.scaleY, matrix[0] * tx + matrix[2] * ty + matrix[4], matrix[1] * tx + matrix[3] * ty + matrix[5]];
        ctx.globalAlpha *= Math.max(0, Math.min(1, pose.groupAlpha));
      }
      const nodeAlpha = ctx.globalAlpha, graphicAlpha = pose ? Math.max(0, Math.min(1, pose.graphicAlpha)) : 1;
      const rotation = pose?.rotation || node.transform.m_LocalRotation;
      if (rotation && Math.abs(rotation.z) > .00001) {
        const pivot = node.transform.m_Pivot || { x: .5, y: .5 };
        const px = area.x + area.w * pivot.x, py = area.y + area.h * (1 - pivot.y);
        const angle = -2 * Math.atan2(rotation.z, rotation.w);
        ctx.translate(px, py); ctx.rotate(angle); ctx.translate(-px, -py);
        if (cacheTransforms) transformState += '|r:' + transformKey([px, py, angle, -px, -py]);
      }
      const previousClip = hitClip;
      if (name === 'game_subprefab_propitem' && node.name === 'Icon') {
        const pivot = node.transform.m_Pivot || { x: .5, y: .5 };
        propAnchors[model.selectedPropId] = { x: area.x + area.w * pivot.x, y: area.y + area.h * (1 - pivot.y) };
      }
      if (name === 'propunlock_uipropunlock' && node.name === 'ImgProp') unlockAnchor = { x: area.x + area.w / 2, y: area.y + area.h / 2 };
      if (node.clip) {
        ctx.beginPath(); ctx.rect(area.x, area.y, area.w, area.h); ctx.clip();
        hitClip = intersect(hitClip, area);
      }
      if (name === 'levelend_uilevelwin' && node.name === 'Btn_Gift' && model.drawChestBoom) model.drawChestBoom(ctx, area);
      for (const graphic of node.graphics) {
        if (graphic.kind === 'image' && !node.hideMaskGraphic) {
          const headId = model.avatarItemId || model.selectedAvatar || model.profile && model.profile.avatar || 1;
          const head = data.heads && data.heads.find(row => row.ID === headId);
          const rewardProp = model.rewardPropId && config.PropConfig[String(model.rewardPropId)];
          const dynamicSprite = name === 'claimreward_propitemtemplate' && node.aliases.includes('ImgProp') ? rewardProp && imageByName(rewardProp.IconLarge || rewardProp.Icon) : node.aliases.includes('avatar_icon') || node.aliases.includes('userHead') ? head && imageByName(head.Icon) : name.includes('dailyfirstwin') && node.aliases.includes('imgDay') ? imageByName(`firstwin_txt_${Math.max(0, Math.min(7, model.daily?.day ?? 0))}`) : node.name === 'ImgProp' ? imageByName(model.selectedPropId === 202 ? 'icon_skyrocket_large' : 'icon_hammer_large') : null;
          ctx.globalAlpha = nodeAlpha * graphicAlpha;
          if (dynamicSprite || graphic.sprite) { ctx.globalAlpha *= graphic.color.a == null ? 1 : graphic.color.a; drawSprite(dynamicSprite || themed?.sprites['1'] || graphic.sprite, area, graphic, cacheTransforms ? name + ':' + id : null, transformState); }
          else if (graphic.color.a > 0) { ctx.fillStyle = color(graphic.color); ctx.fillRect(area.x, area.y, area.w, area.h); }
        } else if (graphic.kind === 'text') { ctx.globalAlpha = nodeAlpha * graphicAlpha; drawText(node, themed?.colors['1'] ? { ...graphic, color: themed.colors['1'] } : graphic, area, name, model); }
      }
      ctx.globalAlpha = nodeAlpha;
      if (name === 'game_uigame' && node.name === 'ThemeNode' && config.defaults.DayOrNightModeChoose.StyleId === 0) renderTemplate('game_subprefab_theme', model, 'BtnTheme', area, null, matrix);
      if (name === 'propguide_uipropguide' && node.name === 'Mask' && model.propGuide?.propId === 201 && model.propGuide.stage === 'ready' && model.drawBoardPreview) { ctx.save(); ctx.globalAlpha = 1; model.drawBoardPreview(); ctx.restore(); }
      if (name === 'home_uihome' && node.name === 'logo_home') {
        if (model.drawHome) model.drawHome(ctx, area);
        else drawSprite(imageByName('logo_home'), area, { preserveAspect: true });
      }
      if (name === 'home_uihome' && node.aliases.includes('ContentLeft') && (model.showDaily == null ? model.level - 1 >= config.DailyFirstWinConfig['1001'].OpenLevel : model.showDaily)) renderTemplate('home_buttonitem_buttonitem_dailyfirstwin', model, 'DailyFirstWin', { ...area, w: 192, h: 192 }, null, matrix);
      if (name === 'home_uihome' && node.aliases.includes('ContentRight') && model.showRank !== false && model.modal !== 'rank') renderTemplate('home_buttonitem_buttonitem_ranklist', model, model.rankUnlocked ? 'RankList' : 'RankListLocked', { ...area, w: 192, h: 192 }, null, matrix);
      if (name === 'levelend_uilevelwin' && node.name === 'Trans_Spine' && model.drawCharacter) model.drawCharacter(ctx, area);
      if (name === 'levelend_uilevelwin' && node.name === 'Trans_Effect' && model.drawAmbient) model.drawAmbient(ctx, area);
      if (name === 'levelend_uilevelwin' && node.name === 'group') drawChestProgress(area, model, transformState);
      if (name === 'levelend_uilevelwin' && node.name === 'Btn_Gift') giftAnchor = { x: area.x + area.w / 2, y: area.y + area.h / 2 };
      if (name === 'levelend_uilevelwin' && node.name === 'Trans_Next') rewardFlyTarget = { x: area.x + area.w / 2, y: area.y + area.h / 2 };
      if (name === 'claimreward_uiclaimreward' && node.name === 'box_node' && model.drawChest) {
        const target = boxes[template.nodes.find(item => item.name === 'objBoxEndPos').id];
        const end = { x: target.x + target.w / 2, y: target.y + target.h / 2 };
        model.drawChest(ctx, { ...sampleBoxMotion(giftAnchor || end, end, model.settlement.rewardAge), scale: area.sx });
      }
      if (name === 'claimreward_uiclaimreward' && node.name === 'HLayout') {
        const source = boxes[template.nodes.find(item => item.name === 'objRewardStartPos').id];
        drawRewardItems(area, model, { x: source.x + source.w / 2, y: source.y + source.h / 2 });
      }
      const guideDisabled = name === 'propguide_uipropguide' && model.propGuide && (model.propGuide.stage === 'closing' || node.name === 'Mask' && model.propGuide.propId === 201 && model.propGuide.stage === 'ready');
      if (node.control && !guideDisabled && node.interactable !== false && area.w > 0 && area.h > 0 && !(name === 'levelend_uilevelwin' && /^Btn_(Next|Round_Next)$/.test(node.name) && model.winNextEnabled === false) && !(name === 'claimreward_uiclaimreward' && !model.settlement?.claimEnabled)) {
        const control = name === 'dailyfirstwin_uidailyfirstwin' && node.name.startsWith('DayItem_') ? `DailyReward:${node.dayIndex}` : mount || node.aliases.find(v => /^btn|^button|btn$|^bgMask$/i.test(v)) || node.name;
        const bounds = intersect(hitClip, area);
        if (bounds.w > 0 && bounds.h > 0) {
          const points = [[bounds.x, bounds.y], [bounds.x + bounds.w, bounds.y], [bounds.x, bounds.y + bounds.h], [bounds.x + bounds.w, bounds.y + bounds.h]].map(([x, y]) => [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]]);
          const xs = points.map(point => point[0]), ys = points.map(point => point[1]);
          hits.push({ name: control, x: Math.min(...xs) * scale, y: Math.min(...ys) * scale, w: (Math.max(...xs) - Math.min(...xs)) * scale, h: (Math.max(...ys) - Math.min(...ys)) * scale });
        }
      }
      for (const child of node.children) {
        walk(child, matrix, transformState);
        // 原icon_spine位于Bg之后、Icon和文字之前；Prefab锚点由原数据计算。
        if (model.drawHomeEntry && nodes[child].name === 'Bg') {
          const entry = { home_buttonitem_buttonitem_dailyfirstwin: 'firstwin', home_buttonitem_buttonitem_ranklist: 'rank' }[name];
          if (entry) model.drawHomeEntry(ctx, entry, area);
        }
        if (name === 'propunlock_uipropunlock' && node.name === 'Panel' && model.drawPropUnlockEffects) {
          const layer = { TxtUnlockProp: 'loop', ImgProp: 'boom01', Txtcontinue: 'boom02' }[nodes[child].name];
          if (layer) model.drawPropUnlockEffects(ctx, layer, { x: area.x + area.w / 2, y: area.y + area.h / 2 });
        }
      }
      hitClip = previousClip;
      ctx.restore();
    }
    for (const root of template.nodes.filter(n => mountId ? n.id === mountId : n.parent === '0')) walk(root.id);
    if (name === 'game_uigame' && !model.tutorialFirstLevel) {
      const parent = template.nodes.find(n => n.name === 'Props');
      const box = parent && boxes[parent.id];
      if (box) for (const [i, propId] of [202, 201].entries()) {
        const locked = model.unlockedProps ? !model.unlockedProps.includes(propId) : model.level < (propId === 201 ? 8 : 4);
        const itemBox = { ...box, x: box.x + box.w / 2 - 198 - 80 + i * 358, y: box.y, w: 198, h: 200 };
        propBoxes[propId] = itemBox;
        const itemModel = { ...model, selectedPropId: propId, propCount: model.props && model.props[propId] || 0, propLocked: locked };
        const item = data.templates.game_subprefab_propitem;
        const icon = item.nodes.find(n => n.name === 'Icon');
        const original = icon.graphics[0].sprite;
        icon.graphics[0].sprite = imageByName(propId === 201 ? 'icon_hammer' : 'icon_skyrocket');
        ctx.save();
        if (model.propGuide?.propId === propId) ctx.globalAlpha = 0;
        renderTemplate('game_subprefab_propitem', itemModel, propId === 201 ? 'Hammer' : 'Skyrocket', itemBox);
        ctx.restore();
        icon.graphics[0].sprite = original;
      }
    }
    if (name === 'lang_uilanguage') {
      const viewportNode = template.nodes.find(n => n.name === 'viewport');
      const content = template.nodes.find(n => n.name === 'Content');
      const area = viewportNode && boxes[viewportNode.id];
      if (area) {
        ctx.save(); ctx.beginPath(); ctx.rect(area.x, area.y, area.w, area.h); ctx.clip();
        const previousClip = hitClip; hitClip = intersect(hitClip, area);
        const spacing = content && content.layout && content.layout.m_Spacing || 0;
        languageScrollMax = Math.max(0, data.languages.length * (168 + spacing) - area.h);
        languageScroll = Math.min(languageScroll, languageScrollMax);
        for (const [i, row] of data.languages.entries()) renderTemplate('lang_uilanguageitem', { ...model, languageTitle: row.Key, languageSelected: row.AllLanguageCode.includes(locale) }, `language:${row.AllLanguageCode[0]}`, { ...area, y: area.y + i * (168 + spacing) - languageScroll, h: 168 });
        hitClip = previousClip;
        ctx.restore();
      }
    }
    if (name === 'user_uiuser' && !model.avatarItem) {
      const content = template.nodes.find(n => n.name === 'Content' && n.layout && n.layout.kind === 'GridLayoutGroup');
      const item = template.nodes.find(n => n.aliases.includes('itemIcon'));
      if (content && item) {
        const box = boxes[content.id], cell = content.layout.m_CellSize, spacing = content.layout.m_Spacing;
        const columns = Math.max(1, Math.floor((box.w + spacing.x) / (cell.x + spacing.x)));
        const viewportNode = template.nodes.find(n => n.id === content.parent);
        const previousClip = hitClip;
        if (viewportNode && viewportNode.clip) { ctx.save(); const area = boxes[viewportNode.id]; ctx.beginPath(); ctx.rect(area.x, area.y, area.w, area.h); ctx.clip(); hitClip = intersect(hitClip, area); }
        for (const [i, head] of data.heads.entries()) renderTemplate('user_uiuser', { ...model, avatarItem: true, avatarItemId: head.ID }, `avatar:${head.ID}`, { ...box, x: box.x + (i % columns) * (cell.x + spacing.x), y: box.y + Math.floor(i / columns) * (cell.y + spacing.y), w: cell.x, h: cell.y }, item.id);
        hitClip = previousClip;
        if (viewportNode && viewportNode.clip) ctx.restore();
      }
    }
  }

  function drawChestProgress(area, model, transformState = '') {
    const flow = model.settlement;
    const count = flow ? flow.count : model.chest?.count || 6;
    const lit = flow ? flow.preLit : model.chest?.progress || 0;
    const gridWidth = (area.w - 9 * area.sx - 4 * area.sx * (count - 1)) / count;
    for (let index = 0; index < count; index++) {
      const key = index === 0 ? 'l' : index === count - 1 ? 'r' : 'm';
      const template = data.templates['levelend_item_prestagerewardprogress' + key];
      const box = { ...area, x: area.x + 9 * area.sx + index * (gridWidth + 4 * area.sx), y: area.y + area.h / 2 - 20 * area.sy, w: gridWidth, h: 40 * area.sy };
      const back = template.nodes.find(node => node.name === 'imgBack');
      ctx.save();
      let backTransformState = transformState;
      if (back.transform.m_LocalScale.x < 0) {
        const tx = box.x * 2 + box.w; ctx.translate(tx, 0); ctx.scale(-1, 1);
        backTransformState += '|m:' + transformKey([tx]);
      }
      drawSprite(back.graphics[0].sprite, box, back.graphics[0], 'chest:' + index + ':back', backTransformState); ctx.restore();
      const fraction = index < lit ? 1 : flow && !flow.opened && index === flow.lit - 1 ? flow.currentFraction : 0;
      if (!fraction) continue;
      const front = template.nodes.find(node => node.name === 'imgFront');
      const foreground = { ...box, x: box.x - 5 * area.sx, y: box.y + 2 * area.sy - 5 * area.sy, w: (gridWidth + 10 * area.sx) * fraction, h: 50 * area.sy };
      ctx.save();
      drawSprite(front.graphics[0].sprite, foreground, front.graphics[0], 'chest:' + index + ':front', transformState);
      if (flow && index === flow.lit - 1 && flow.lightAlpha > 0) {
        const light = template.nodes.find(node => node.name === 'imgEffect'); ctx.globalAlpha *= flow.lightAlpha;
        drawSprite(light.graphics[0].sprite, foreground, light.graphics[0], 'chest:' + index + ':light', transformState);
      }
      ctx.restore();
    }
    if (flow && model.drawChestTrail) {
      const index = Math.max(0, flow.lit - 1);
      const fraction = flow.currentFraction;
      model.drawChestTrail(ctx, { x: area.x + 9 * area.sx + index * (gridWidth + 4 * area.sx) - 5 * area.sx + (gridWidth + 10 * area.sx) * fraction - 5 * area.sx, y: area.y + area.h / 2, scale: area.sx });
    }
  }

  function drawRewardItems(area, model, start) {
    const flow = model.settlement;
    if (!flow?.transaction || flow.rewardAge < 1.5) return;
    const items = Object.entries(flow.transaction.items);
    for (const [index, [id, count]] of items.entries()) {
      const end = { x: area.x + area.w / 2 + (items.length === 1 ? 0 : index === 0 ? -169 : 185), y: area.y + area.h / 2 - 68 };
      const returning = flow.flyAge >= 0;
      // 原OpenClaimRewardUI无论道具类型均传Trans_Next的屏幕位置。
      const destination = rewardFlyTarget || { x: viewport.w / 2, y: viewport.h / 2 };
      const elapsed = returning ? flow.flyAge : flow.rewardAge - 1.5;
      const point = samplePropMotion(returning ? end : start, returning ? destination : end, elapsed, index, returning);
      if (!point.visible) continue;
      renderTemplate('claimreward_propitemtemplate', { ...model, rewardPropId: Number(id), rewardCount: count, rewardItemAge: elapsed, rewardItemClosing: returning }, null, { x: point.x - 228.77001953125 / 2, y: point.y - 335.54998779296875 / 2, w: 228.77001953125, h: 335.54998779296875, sx: 1, sy: 1 });
    }
  }

  function intersect(a, b) {
    if (!a) return { ...b };
    const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
    return { x, y, w: Math.max(0, Math.min(a.x + a.w, b.x + b.w) - x), h: Math.max(0, Math.min(a.y + a.h, b.y + b.h) - y) };
  }

  function draw(screen, model = {}) {
    hits = [];
    hitClip = null;
    scrollPage = model.modal || screen;
    model = { ...model, propCount: model.propCount == null ? (model.props && model.props[model.selectedPropId] || 0) : model.propCount };
    locale = String(model.language || 'zh-CN').replace('-', '_').toUpperCase();
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = model.backgroundColor || '#f9eedb'; ctx.fillRect(0, 0, width, height);
    if (screen === 'game') {
      const night = model.themeId === 1 && loadImage(themeData.background.path);
      if (night) { const quad = coverQuad(width, height); ctx.drawImage(night, (width - quad.width) / 2, (height - quad.height) / 2, quad.width, quad.height); }
      else if (model.drawBackground) model.drawBackground(ctx);
      else {
      const sprite = data.sprites[imageByName('game_bg_mask@xxhdpi_0')], detail = sprite && loadImage(sprite.path);
      if (detail) {
        ctx.save();
        // 原BGMat灰度纸纹作为_detail；软光为Canvas近似，尚未恢复GPU shader公式。
        ctx.globalCompositeOperation = 'soft-light';
        if (ctx.globalCompositeOperation === 'soft-light') {
          ctx.globalAlpha = .3;
          const coverH = Math.max(height, width * 2) * 1.05, coverW = coverH / 2;
          for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) ctx.drawImage(detail, (width - coverW) / 2 + x * coverW / 2, (height - coverH) / 2 + y * coverH / 2, coverW / 2, coverH / 2);
        }
        ctx.restore();
      }
      }
      if (model.drawBoard) { ctx.save(); model.drawBoard(ctx); ctx.restore(); }
    }
    // 每帧先核对外部Canvas状态；窗口或调用方的变换变化会使原生值缓存失效。
    const nativeBase = ctx.getTransform && ctx.getTransform();
    const nextBase = nativeBase ? transformKey([nativeBase.a, nativeBase.b, nativeBase.c, nativeBase.d, nativeBase.e, nativeBase.f, scale]) : null;
    if (nextBase !== transformBase) { spriteTransforms.clear(); transformBase = nextBase; }
    ctx.save(); ctx.scale(scale, scale);
    const pages = { home: 'home_uihome', game: 'game_uigame', win: 'levelend_uilevelwin', levelwin: 'levelend_uilevelwin', claimReward: 'claimreward_uiclaimreward', settings: model.baseScreen === 'home' ? 'setting_uisettinghome' : 'setting_uisettingingame', propUnlock: 'propunlock_uipropunlock', propGuide: 'propguide_uipropguide', avatar: 'user_uiuser', daily: 'dailyfirstwin_uidailyfirstwin', rank: 'ranklist_uiranklistpopup', welcome: 'privacy_uiprivacy', howtoplay: 'howtoplay_uihowtoplayview', about: 'aboutus_uiaboutus', language: 'lang_uilanguage' };
    renderTemplate(pages[screen] || screen, model);
    if (screen === 'game' && model.drawPropEffects && model.modal !== 'propGuide') model.drawPropEffects(ctx);
    if (screen === 'game' && model.tutorialFirstLevel && !model.modal && (model.tutorialInstruction || model.tutorialInstructionKey && data.texts[model.tutorialInstructionKey])) renderTemplate('weakguide_weakguideview', model);
    if (model.modal && model.modal !== 'friends') {
      hits = [];
      if (model.modalParent) { renderTemplate(pages[model.modalParent], model); hits = []; }
      const popup = model.modal === 'settings' ? (screen === 'home' ? 'setting_uisettinghome' : 'setting_uisettingingame') : pages[model.modal] || model.modal;
      renderTemplate(popup, model);
      if (model.modal === 'propGuide' && model.propGuide) {
        const state = model.propGuide, box = propBoxes[state.propId], item = data.templates.game_subprefab_propitem;
        if (box) {
          const icon = item.nodes.find(node => node.name === 'Icon'), original = icon.graphics[0].sprite;
          icon.graphics[0].sprite = imageByName(state.propId === 201 ? 'icon_hammer' : 'icon_skyrocket');
          const before = hits.length;
          renderTemplate('game_subprefab_propitem', { ...model, selectedPropId: state.propId, propCount: model.props?.[state.propId] || 0, propLocked: false }, 'GuidePropConfirm', box);
          if (state.stage !== 'tip') hits.length = before;
          icon.graphics[0].sprite = original;
        }
        if (model.drawPropEffects) model.drawPropEffects(ctx);
      }
      if (model.modal === 'propUnlock' && model.propIntro?.closing) {
        const intro = model.propIntro, start = intro.flyStart, target = intro.flyTarget;
        if (start && target) for (const particle of sampleUnlockFly({ age: intro.closeAge, count: intro.grantCount, start, target })) {
          ctx.save(); ctx.translate(particle.x, particle.y); ctx.rotate(particle.rotation * Math.PI / 180); ctx.globalAlpha *= particle.alpha;
          drawSprite(imageByName(config.PropConfig[String(intro.propId)].Icon), { x: -particle.size / 2, y: -particle.size / 2, w: particle.size, h: particle.size }, { preserveAspect: true });
          ctx.restore();
        }
      }
    }
    ctx.restore();
    if (model.modal === 'friends') drawFriendUI(ctx, width, height, headerInset, model, hits);
    if (model.guidePointer && !model.modal) {
      const pointer = model.guidePointer;
      const hand = data.sprites[imageByName('common_guidehand_2')], image = hand && loadImage(hand.path);
      if (image) ctx.drawImage(image, pointer.x, pointer.y, hand.width * scale, hand.height * scale);
    }
  }
  function hit(x, y) {
    return [...hits].reverse().find(item => x >= item.x && x <= item.x + item.w && y >= item.y && y <= item.y + item.h)?.name || null;
  }
  function scroll(deltaY) {
    if (scrollPage !== 'language') return false;
    languageScroll = Math.max(0, Math.min(languageScrollMax, languageScroll - deltaY / scale));
    return true;
  }
  return { draw, hit, scroll, localized, propAnchor: id => propAnchors[id] || null, propItemBox: id => propBoxes[id] || null, unlockAnchor: () => unlockAnchor, spritesByName: data.spritesByName, assets: data.sprites };
}

module.exports = { createUI };
