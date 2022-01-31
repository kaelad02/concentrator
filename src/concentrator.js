import { registerSettings, fetchSettings, addEffect } from "./settings.js";
import { debug, isModuleActive, log } from "./util.js";
import concentrationItem from "./fvtt-Item-concentration-check.js";

const EFFECT_NAME = "Concentrating";

Hooks.once("init", () => {
  log("initializing Concentrator");
  registerSettings();
  fetchSettings();

  // Add wrappers to detect casting spells w/ concentration
  libWrapper.register(
    "concentrator",
    "CONFIG.Item.documentClass.prototype.roll",
    onRoll,
    "WRAPPER"
  );
  libWrapper.register(
    "concentrator",
    "CONFIG.Item.documentClass.prototype.displayCard",
    onDisplayCard,
    "WRAPPER"
  );

  // add hooks for the whispered message
  const chatListeners = (app, html, data) =>
    html.on("click", ".concentrator .card-buttons button", onChatCardButton);
  Hooks.on("renderChatLog", chatListeners);
  Hooks.on("renderChatPopout", chatListeners);
});

// Add hooks to trigger concentration check
Hooks.once("ready", () => {
  Hooks.on("preUpdateActor", onPreUpdateActor);
  // GM only so we don't get a check from each user
  if (game.user.isGM) {
    Hooks.on("updateActor", onUpdateActor);
  }
});

async function onRoll(wrapped, options, ...rest) {
  debug("onRoll method called");

  // do not process if not configured for consume
  if (addEffect !== "consumed") return wrapped(options, ...rest);

  // do not processs if the item doesn't require concentration
  if (!this.data.data.components?.concentration)
    return wrapped(options, ...rest);

  // capture usages before casting the spell
  const before = getUsages(this);

  const result = await wrapped(options, ...rest);
  if (result) {
    // if usages changed then add concentration
    const after = getUsages(this);
    if (after.spellSlots < before.spellSlots || after.uses < before.uses)
      addConcentration(this, this.actor);
  }

  return result;
}

function getUsages(item) {
  const id = item.data.data;
  const ad = item.actor.data.data;

  // check spell slots
  let spellSlots = null;
  const requireSpellSlot =
    item.type === "spell" &&
    id.level > 0 &&
    CONFIG.DND5E.spellUpcastModes.includes(id.preparation.mode);
  if (requireSpellSlot) {
    spellSlots = Object.values(ad.spells)
      .map((s) => s.value)
      .reduce((accum, value) => accum + value, 0);
  }

  // check limited uses
  const uses = !!id.uses?.per ? id.uses.value : null;

  // TODO check resource consumption

  return { spellSlots, uses };
}

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
    if (addEffect === "always") addConcentration(this, speaker);
    else if (addEffect === "whisper") whisperMessage(this, speaker);
  }

  return chatMessage;
}

async function whisperMessage(item, actor) {
  const html = await renderTemplate(
    "modules/concentrator/templates/ask-to-add.hbs",
    { item, actor }
  );

  const messageData = {
    whisper: [game.userId],
    user: game.userId,
    flags: {
      core: {
        canPopout: true,
      },
      concentrator: {
        itemId: item.id,
        actorId: actor.id,
      },
    },
    type: CONST.CHAT_MESSAGE_TYPES.OTHER,
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: "Cast a concentration spell",
    content: html,
  };

  ChatMessage.create(messageData);
}

function onChatCardButton(event) {
  debug("onChatCardButton method called");

  // get chat message
  const button = event.currentTarget;
  const chatCard = $(button).closest("[data-message-id]");
  const chatId = chatCard.data("messageId");
  const chatMessage = game.messages.get(chatId);

  // get actor and item
  const actorId = chatMessage.getFlag("concentrator", "actorId");
  const actor = game.actors.get(actorId);
  const itemId = chatMessage.getFlag("concentrator", "itemId");
  const item = actor.items.get(itemId);

  addConcentration(item, actor);
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
