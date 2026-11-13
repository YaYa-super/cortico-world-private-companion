/**
 * Coopanion 浏览器端入口：记忆 / QQ / B站 三个独立面板。
 *
 * 真正的实现分别在 life.js、qq.js、bili.js；tools/build-webui.mjs 会把它们
 * 分别包进 IIFE 内联进 client.js（宿主只发 manifest 声明的这一个 JS 文件）。
 */
import life from './life.js';
import qq from './qq.js';
import bili from './bili.js';

export default {
  panels: {
    ...life.panels,
    ...qq.panels,
    ...bili.panels,
  },
};
