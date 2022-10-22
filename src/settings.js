export var addEffect;

export const registerSettings = function () {
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
  addEffect = game.settings.get("concentrator", "addEffect");
};
