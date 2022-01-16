import { debugEnabled } from "./settings.js";

export const debug = (...args) => {
  if (debugEnabled) console.log("concentrator | ", ...args);
};

export const log = (...args) => console.log("concentrator | ", ...args);
