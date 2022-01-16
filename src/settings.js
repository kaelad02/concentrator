export var debugEnabled;

export const registerSettings = function () {
  game.settings.register("concentrator", "debugLogging", {
    name: "Debug logging",
    scope: "world",
    config: false,
    type: Boolean,
    default: false,
    onChange: (value) => {
      debugEnabled = value;
    },
  });
};

export const fetchSettings = function () {
  debugEnabled = game.settings.get("concentrator", "debugLogging");
};
