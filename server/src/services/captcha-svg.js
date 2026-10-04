'use strict';

/**
 * src/services/captcha-svg.js —— 纯 SVG 验证码生成器（零原生依赖）
 * 返回 { svg, answer }，answer 仅服务端持有，不下发前端。
 */
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 个，去易混 0/O/1/I
const COLORS = ['#8b0000', '#6b21a8', '#1e40af', '#374151', '#92400e', '#065f46'];
const WIDTH = 120;
const HEIGHT = 40;
const LEN = 4;

const rand = (min, max) => Math.random() * (max - min) + min;
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

function generate(len = LEN) {
  let answer = '';
  for (let i = 0; i < len; i++) answer += CHARS.charAt(Math.floor(Math.random() * CHARS.length));

  const parts = [];
  // 字符：使用 SVG <path> 绘制矢量轮廓（不可程序化提取），配合干扰线/噪点
  // 字符路径库：每个字符的手绘 SVG path（在 120x40 画布内）
  const CHAR_PATHS = {
    'A': 'M 8,32 L 16,8 L 24,32 M 12,24 L 20,24',
    'B': 'M 8,32 L 8,8 L 18,8 Q 24,8 24,14 Q 24,20 18,20 L 8,20 M 18,20 Q 26,20 26,26 Q 26,32 18,32 L 8,32',
    'C': 'M 24,12 Q 16,4 10,12 Q 4,20 10,28 Q 16,36 24,28',
    'D': 'M 8,32 L 8,8 L 16,8 Q 26,8 26,20 Q 26,32 16,32 L 8,32',
    'E': 'M 22,8 L 8,8 L 8,32 L 22,32 M 8,20 L 20,20',
    'F': 'M 22,8 L 8,8 L 8,32 M 8,20 L 20,20',
    'G': 'M 24,12 Q 16,4 10,12 Q 4,20 10,28 Q 16,36 24,28 L 24,20 L 18,20',
    'H': 'M 8,32 L 8,8 M 24,32 L 24,8 M 8,20 L 24,20',
    'J': 'M 24,8 L 24,26 Q 24,34 16,34 Q 8,34 8,26',
    'K': 'M 8,32 L 8,8 M 22,8 L 8,20 M 12,16 L 24,32',
    'L': 'M 8,8 L 8,32 L 22,32',
    'M': 'M 8,32 L 8,8 L 16,24 L 24,8 L 24,32',
    'N': 'M 8,32 L 8,8 L 24,32 L 24,8',
    'P': 'M 8,32 L 8,8 L 18,8 Q 26,8 26,16 Q 26,24 18,24 L 8,24',
    'Q': 'M 24,12 Q 16,4 10,12 Q 4,20 10,28 Q 16,36 24,28 M 18,26 L 26,34',
    'R': 'M 8,32 L 8,8 L 18,8 Q 26,8 26,16 Q 26,24 18,24 L 8,24 M 18,24 L 26,32',
    'S': 'M 24,10 Q 16,4 10,10 Q 4,16 12,18 Q 28,22 24,28 Q 16,36 8,28',
    'T': 'M 6,8 L 26,8 M 16,8 L 16,32',
    'U': 'M 8,8 L 8,26 Q 8,34 16,34 Q 24,34 24,26 L 24,8',
    'V': 'M 6,8 L 16,32 L 26,8',
    'W': 'M 6,8 L 10,32 L 16,16 L 22,32 L 26,8',
    'X': 'M 8,8 L 24,32 M 24,8 L 8,32',
    'Y': 'M 8,8 L 16,20 L 24,8 M 16,20 L 16,32',
    'Z': 'M 8,8 L 24,8 L 8,32 L 24,32',
    '2': 'M 8,12 Q 8,6 16,6 Q 24,6 24,14 Q 24,20 16,26 L 8,32 L 24,32',
    '3': 'M 8,10 Q 12,6 18,8 Q 24,10 22,16 Q 20,20 14,20 Q 20,20 22,24 Q 24,30 18,32 Q 12,34 8,30',
    '4': 'M 20,32 L 20,8 L 6,24 L 26,24',
    '5': 'M 24,8 L 10,8 L 8,18 Q 14,16 20,18 Q 26,20 24,26 Q 22,32 14,32 Q 8,32 6,28',
    '6': 'M 22,10 Q 18,4 12,8 Q 6,12 8,20 Q 10,28 18,28 Q 24,28 24,22 Q 24,16 16,16 Q 10,16 8,20',
    '7': 'M 8,8 L 24,8 L 14,32',
    '8': 'M 16,8 Q 10,8 10,14 Q 10,18 16,18 Q 22,18 22,14 Q 22,8 16,8 M 16,18 Q 8,18 8,26 Q 8,34 16,34 Q 24,34 24,26 Q 24,18 16,18',
    '9': 'M 10,30 Q 14,36 20,32 Q 26,28 24,20 Q 22,12 14,12 Q 8,12 8,18 Q 8,24 16,24 Q 22,24 24,20'
  };
  
  for (let i = 0; i < len; i++) {
    const ch = answer[i];
    const path = CHAR_PATHS[ch];
    if (!path) continue; // 跳过无路径字符（不应发生，因 CHARS 已过滤）
    const x = 10 + i * 26;
    const y = 28 + rand(-3, 3);
    const rot = rand(-15, 15);
    const scale = rand(0.85, 1.0);
    const color = pick(COLORS);
    // 使用 path 绘制，配合随机变换
    parts.push(
      `<path d="${path}" fill="none" stroke="${color}" stroke-width="${rand(2, 3).toFixed(1)}" ` +
      `stroke-linecap="round" stroke-linejoin="round" ` +
      `transform="translate(${x - 16}, ${y - 20}) rotate(${rot.toFixed(1)}) scale(${scale.toFixed(2)})"/>`
    );
    // 在字符周围添加干扰噪点
    for (let j = 0; j < 3; j++) {
      parts.push(
        `<circle cx="${x + rand(-12, 12)}" cy="${y + rand(-8, 8)}" r="${rand(0.8, 1.5).toFixed(1)}" ` +
        `fill="${pick(COLORS)}" opacity="${rand(0.3, 0.6).toFixed(2)}"/>`
      );
    }
  }
  // 干扰曲线 3 条
  for (let i = 0; i < 3; i++) {
    const x1 = rand(0, WIDTH / 2), y1 = rand(5, HEIGHT - 5);
    const x2 = rand(WIDTH / 2, WIDTH), y2 = rand(5, HEIGHT - 5);
    const cx = rand(WIDTH * 0.3, WIDTH * 0.7), cy = rand(0, HEIGHT);
    parts.push(`<path d="M ${x1.toFixed(1)} ${y1.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}" fill="none" stroke="${pick(COLORS)}" stroke-width="1.2" opacity="0.5"/>`);
  }
  // 噪点 25 个
  for (let i = 0; i < 25; i++) {
    parts.push(`<circle cx="${rand(0, WIDTH).toFixed(1)}" cy="${rand(0, HEIGHT).toFixed(1)}" r="1" fill="${pick(COLORS)}" opacity="0.6"/>`);
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">` +
    `<rect width="${WIDTH}" height="${HEIGHT}" fill="#f8fafc"/>` +
    parts.join('') +
    `</svg>`;

  return { svg, answer };
}

module.exports = { generate, CHARS, WIDTH, HEIGHT };
