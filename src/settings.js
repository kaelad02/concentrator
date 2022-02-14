export var debugEnabled;
export var addEffect;

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

  game.settings.register("concentrator", "addEffect", {
    name: "When to apply Concentrating",
    hint: "Always apply after casting a spell with concentration or whisper a message to manually apply.",
    scope: "client",
    config: true,
    type: String,
    choices: {
      always: "Always",
      whisper: "Whisper Message",
    },
    default: "always",
    onChange: (value) => {
      addEffect = value;
    },
  });
};

export const fetchSettings = function () {
  debugEnabled = game.settings.get("concentrator", "debugLogging");
  addEffect = game.settings.get("concentrator", "addEffect");
};
