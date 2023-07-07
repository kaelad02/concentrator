function debugEnabled() {
  return game.modules.get("_dev-mode")?.api?.getPackageDebugValue("concentrator");
}

export const debug = (...args) => {
  try {
    if (debugEnabled()) log(...args);
  } catch (e) {}
};

export const log = (...args) => console.log("concentrator | ", ...args);
