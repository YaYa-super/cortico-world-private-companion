// 框架按 package.json 的 `main` 导入本文件，读取具名导出 id/label/defaults/create。
import { COMPANION_WORLD } from './definition.ts';

export const id = COMPANION_WORLD.id;
export const label = COMPANION_WORLD.label;
export const defaults = COMPANION_WORLD.defaults;
export const create = COMPANION_WORLD.create;

export { COMPANION_WORLD } from './definition.ts';
export default COMPANION_WORLD;
export { companionDefaults, COMPANION_DEFAULTS, COMPANION_CONFIG_GROUP, type CompanionConfig } from './config.ts';
