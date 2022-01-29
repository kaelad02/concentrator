import { debugEnabled } from "./settings.js";

export const debug = (...args) => {
  if (debugEnabled) console.log("concentrator | ", ...args);
};

export const log = (...args) => console.log("concentrator | ", ...args);

export const isModuleActive = (name) => game.modules.get(name)?.active;
