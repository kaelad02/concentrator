export var addEffect;

export const initSettings = function () {
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

  addEffect = game.settings.get("concentrator", "addEffect");
};
