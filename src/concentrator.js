import { registerSettings, fetchSettings } from "./settings.js";
import { debug, isModuleActive, log } from "./util.js";
import concentrationItem from "./fvtt-Item-concentration-check.js";

const EFFECT_NAME = "Concentrating";

Hooks.once("init", () => {
  log("initializing Concentrator");
  registerSettings();
  fetchSettings();

  // Add wrapper to detect casting spells w/ concentration
  libWrapper.register(
    "concentrator",
    "CONFIG.Item.documentClass.prototype.displayCard",
    onDisplayCard,
    "WRAPPER"
  );
});

// Add hooks to trigger concentration check
Hooks.once("ready", () => {
  Hooks.on("preUpdateActor", onPreUpdateActor);
  // GM only so we don't get a check from each user
  if (game.user.isGM) {
    Hooks.on("updateActor", onUpdateActor);
  }
});

/**
 * Wrapper for Item5e's displayCard method that detects when a spell w/ concentration is cast.
 */
async function onDisplayCard(wrapped, options, ...rest) {
  debug("onDisplayCard method called");

  const chatMessage = await wrapped(options, ...rest);
  debug(chatMessage);
  debug(this);

  // check if the item requires concentration
  if (this.data.data.components?.concentration) {
    debug(`concentration is true`);

    const speaker = ChatMessage.getSpeakerActor(chatMessage.data?.speaker);
    debug(speaker);
    addConcentration(this, speaker);
  }

  return chatMessage;
}

/**
 * Add concentration to an actor.
 * @param {Item5e} item The item (spell) that triggered concentration
 * @param {Actor5e} actor The actor to apply concentration to
 * @returns {Promise<boolean>} True if the Concentrating effect was added, false otherwise
 */
async function addConcentration(item, actor) {
  log(`will add concentration to ${actor?.name}`);

  // find the DFreds Convenient Effect version of Concentrating
  let statusEffect = game.dfreds.effects.all.find(
    (effect) => effect.name === EFFECT_NAME
  );
  statusEffect = statusEffect.convertToActiveEffectData(item.uuid);

  // copy over the item duration to the status effect using DAE
  if (isModuleActive("dae")) {
    const itemDuration = item.data.data.duration;
    debug(`itemDuration ${itemDuration}`);
    const convertedDuration = globalThis.DAE.convertDuration(
      itemDuration,
      false
    );
    debug(`convertedDuration ${convertedDuration}`);
    if (convertedDuration?.type === "seconds") {
      statusEffect.duration = {
        seconds: convertedDuration.seconds,
        startTime: game.time.worldTime,
      };
    } else if (convertedDuration?.type === "turns") {
      statusEffect.duration = {
        rounds: convertedDuration.rounds,
        turns: convertedDuration.turns,
        startRound: game.combat?.round,
        startTurn: game.combat?.turn,
      };
    }
  }

  // enable effect
  return actor
    .createEmbeddedDocuments("ActiveEffect", [statusEffect])
    .then((documents) => {
      return documents.length > 0;
    });
}

/**
 * Event handler for preUpdateActor hook.
 * @param {Actor5e} actor
 * @param {*} updateData
 * @param {*} options
 * @param {string} userId
 */
function onPreUpdateActor(actor, updateData, options, userId) {
  debug("onPreUpdateActor called");
  debug(updateData);
  debug(options);

  // check if hp is modified
  if (
    updateData.data?.attributes?.hp?.temp ||
    updateData.data?.attributes?.hp?.value
  ) {
    // save current hp value to calculate actual change later
    options.originalHpTemp = actor.data.data.attributes.hp.temp;
    options.originalHpValue = actor.data.data.attributes.hp.value;
  }
}

/**
 * Event handler for updateActor hook.
 * @param {Actor5e} actor
 * @param {*} updateData
 * @param {*} options
 * @param {string} userId
 */
function onUpdateActor(actor, updateData, options, userId) {
  debug("onUpdateActor called");

  // check for flag and concentrating
  if (options.originalHpValue && isConcentrating(actor)) {
    // compute damage taken
    const damage =
      options.originalHpTemp -
      actor.data.data.attributes.hp.temp +
      options.originalHpValue -
      actor.data.data.attributes.hp.value;
    debug(`damage taken: ${damage}`);
    // make check
    if (damage > 0) {
      concentrationCheck(damage, actor);
    }
  }
}

function isConcentrating(actor) {
  return actor.data.effects?.some(
    (effect) =>
      effect.data.flags.isConvenient && effect.data.label === EFFECT_NAME
  );
}

/**
 * Display an item card in chat for the concentration check.
 * @param {number} damage the damage taken
 * @param {Actor5e} actor who should make the check
 * @returns {Promise<ChatMessage>} the chat message for the concentration item card
 */
async function concentrationCheck(damage, actor) {
  log(`triggering a concentration check for ${actor?.name}`);

  // compute the save DC
  const saveDC = Math.max(10, Math.floor(damage / 2));
  debug(`computed saveDC ${saveDC}`);

  // create a Concentration Check item
  const itemData = duplicate(concentrationItem);
  itemData.data.save.dc = saveDC;

  const ownedItem = new CONFIG.Item.documentClass(itemData, { parent: actor });
  ownedItem.getSaveDC();

  // display item card
  const chatData = await ownedItem.displayCard({ createMessage: false });
  chatData.flags["dnd5e.itemData"] = itemData;
  return ChatMessage.create(chatData);
}
