'use strict';

// 仅恢复当前TMP文本所需的样式段；测宽、换行和字形绘制由UI使用同一份样式处理。
function parseRichText(value, { fontSize = 16, color = { r: 1, g: 1, b: 1, a: 1 }, bold = false, italic = false } = {}) {
  const text = String(value), runs = [];
  const stacks = { color: [{ ...color }], size: [fontSize], b: [bold], i: [italic] };
  const last = stack => stack[stack.length - 1];
  function append(part) {
    if (!part) return;
    const style = { fontSize: last(stacks.size), color: { ...last(stacks.color) }, bold: last(stacks.b), italic: last(stacks.i) };
    const previous = runs[runs.length - 1], prior = previous && previous.style;
    if (prior && prior.fontSize === style.fontSize && prior.bold === style.bold && prior.italic === style.italic && ['r', 'g', 'b', 'a'].every(key => prior.color[key] === style.color[key])) previous.text += part;
    else runs.push({ text: part, style });
  }
  let cursor = 0;
  for (const match of text.matchAll(/<[^>]+>/g)) {
    append(text.slice(cursor, match.index)); cursor = match.index + match[0].length;
    const tag = match[0].slice(1, -1).trim();
    if (/^br\s*\/?$/i.test(tag)) { append('\n'); continue; }
    const close = /^\/\s*(color|size|b|i)\s*$/i.exec(tag);
    if (close) { const stack = stacks[close[1].toLowerCase()]; if (stack.length > 1) stack.pop(); continue; }
    if (/^[bi]$/i.test(tag)) { stacks[tag.toLowerCase()].push(true); continue; }
    const open = /^(color|size)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"']+))\s*$/i.exec(tag);
    if (!open) continue;
    const name = open[1].toLowerCase(), parameter = open[2] ?? open[3] ?? open[4];
    if (name === 'color' && /^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(parameter)) {
      const hex = parameter.slice(1), channels = [0, 2, 4].map(index => parseInt(hex.slice(index, index + 2), 16) / 255);
      stacks.color.push({ r: channels[0], g: channels[1], b: channels[2], a: hex.length === 8 ? parseInt(hex.slice(6), 16) / 255 : 1 });
    } else if (name === 'size') {
      const size = /^(\d+(?:\.\d+)?|\.\d+)(%|px)?$/i.exec(parameter);
      // TMP百分比相对原字号，不以外层size标签的结果累计。
      if (size && Number(size[1]) > 0) stacks.size.push(Number(size[1]) * (size[2] === '%' ? fontSize / 100 : 1));
    }
  }
  append(text.slice(cursor));
  return runs;
}

function layoutRichText(value, { fontSize = 16, color, bold = false, italic = false, scaleY = 1, available = Infinity, wrap = true, fontFamily = 'sans-serif' } = {}, measure) {
  const runs = parseRichText(value, { fontSize, color, bold, italic }), lines = [];
  const baseStyle = { fontSize, color, bold, italic };
  const sameStyle = (a, b) => a.fontSize === b.fontSize && a.bold === b.bold && a.italic === b.italic && ['r', 'g', 'b', 'a'].every(key => a.color[key] === b.color[key]);
  function metrics(text, style) {
    const size = style.fontSize * scaleY, font = `${style.italic ? 'italic ' : ''}${style.bold ? 'bold ' : ''}${size}px ${fontFamily}`;
    let result;
    if (typeof measure === 'function') result = measure(text, style, font);
    else { measure.font = font; measure.textBaseline = 'alphabetic'; result = measure.measureText(text); }
    const width = typeof result === 'number' ? result : result.width;
    const ascent = typeof result === 'object' ? result.fontBoundingBoxAscent ?? result.actualBoundingBoxAscent : undefined;
    const descent = typeof result === 'object' ? result.fontBoundingBoxDescent ?? result.actualBoundingBoxDescent : undefined;
    return { width, font, size, ascent: Number.isFinite(ascent) ? ascent : size * .8, descent: Number.isFinite(descent) ? descent : size * .2 };
  }
  let line = { fragments: [], width: 0 }, height = 0;
  function finishLine() {
    const defaults = line.fragments.length ? null : metrics('M', baseStyle);
    const values = line.fragments.length ? line.fragments : [defaults];
    const maxFontSize = Math.max(...values.map(fragment => fragment.size)), ascent = Math.max(...values.map(fragment => fragment.ascent)), descent = Math.max(...values.map(fragment => fragment.descent));
    const lineHeight = Math.max(maxFontSize * 1.15, ascent + descent);
    // 每行只有一个字母基线，不同字号的片段不使用各自的middle基线。
    lines.push({ ...line, y: height, height: lineHeight, lineHeight, maxFontSize, ascent, descent, baseline: height + (lineHeight - ascent - descent) / 2 + ascent });
    height += lineHeight; line = { fragments: [], width: 0 };
  }
  for (const run of runs) for (const character of run.text) {
    if (character === '\n') { finishLine(); continue; }
    let previous = line.fragments[line.fragments.length - 1];
    let extending = previous && sameStyle(previous.style, run.style);
    let measured = metrics(extending ? previous.text + character : character, run.style);
    if (wrap && line.fragments.length && line.width - (extending ? previous.width : 0) + measured.width > available) {
      finishLine(); previous = null; extending = false; measured = metrics(character, run.style);
    }
    if (extending) {
      line.width += measured.width - previous.width;
      Object.assign(previous, measured, { text: previous.text + character });
    } else {
      line.fragments.push({ text: character, style: run.style, x: line.width, ...measured }); line.width += measured.width;
    }
  }
  finishLine();
  return { lines, width: Math.max(...lines.map(row => row.width)), height };
}

module.exports = { parseRichText, layoutRichText };
