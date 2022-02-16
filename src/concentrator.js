import { registerSettings, fetchSettings, addEffect } from "./settings.js";
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

  // add hooks for the whispered message
  const chatListeners = (app, html, data) =>
    html.on("click", ".concentrator .card-buttons button", onChatCardButton);
  Hooks.on("renderChatLog", chatListeners);
  Hooks.on("renderChatPopout", chatListeners);

  // Add hooks to trigger concentration check
  Hooks.on("preUpdateActor", onPreUpdateActor);
  Hooks.on("updateActor", onUpdateActor);
});

/**
 * Wrapper for Item5e's displayCard method that detects when a spell w/ concentration is cast.
 */
async function onDisplayCard(wrapped, options, ...rest) {
  debug("onDisplayCard method called", this);

  const result = await wrapped(options, ...rest);

  // check if the item requires concentration
  if (this.data.data.components?.concentration) {
    debug("found a concentration spell");
    if (addEffect === "always") await addConcentration(this, this.actor);
    else if (addEffect === "whisper") whisperMessage(this, this.actor);
  }

  return result;
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
        itemUuid: item.uuid,
      },
    },
    type: CONST.CHAT_MESSAGE_TYPES.OTHER,
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: "Cast a concentration spell",
    content: html,
  };

  ChatMessage.create(messageData);
}

async function onChatCardButton(event) {
  debug("onChatCardButton method called");

  // get chat message
  const button = event.currentTarget;
  const chatCard = $(button).closest("[data-message-id]");
  const chatId = chatCard.data("messageId");
  const chatMessage = game.messages.get(chatId);

  // get actor and item
  const itemUuid = chatMessage.getFlag("concentrator", "itemUuid");
  const item = await fromUuid(itemUuid);

  await addConcentration(item, item.actor);
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
    const inCombat = game.combat?.turns.some((combatant) =>
      actor.token
        ? combatant.token?.id === actor.token.id
        : combatant.actor.id === actor.id
    );
    debug("itemDuration", itemDuration, `inCombat ${inCombat}`);
    const convertedDuration = globalThis.DAE.convertDuration(
      itemDuration,
      inCombat
    );
    debug("convertedDuration", convertedDuration);
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
  debug("creating active effect", statusEffect);
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
  debug("updateData", updateData, "options", options);

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
async function onUpdateActor(actor, updateData, options, userId) {
  debug("onUpdateActor called");

  // only perform check on the user who made the change
  if (userId !== game.userId) return;

  // check for flag and concentrating
  const effect = concentratingOn(actor);
  if (options.originalHpValue && effect) {
    // compute damage taken
    const damage =
      options.originalHpTemp -
      actor.data.data.attributes.hp.temp +
      options.originalHpValue -
      actor.data.data.attributes.hp.value;
    debug(`damage taken: ${damage}`);
    // make check
    if (damage > 0) {
      const sourceName = await getSourceName(effect);
      await concentrationCheck(damage, actor, sourceName);
    }
  }
}

function concentratingOn(actor) {
  return actor.data.effects?.find(
    (effect) =>
      effect.data.flags.isConvenient && effect.data.label === EFFECT_NAME
  );
}

async function getSourceName(effect) {
  // workaround https://gitlab.com/foundrynet/foundryvtt/-/issues/6702
  effect.sourceName;
  await new Promise((resolve) => setTimeout(resolve, 100));

  const sourceName = effect.sourceName;
  if (sourceName === "None" || sourceName === "Unknown") return undefined;
  return sourceName;
}

/**
 * Display an item card in chat for the concentration check.
 * @param {number} damage the damage taken
 * @param {Actor5e} actor who should make the check
 * @param {string} sourceName the source of concentration
 * @returns {Promise<ChatMessage>} the chat message for the concentration item card
 */
async function concentrationCheck(damage, actor, sourceName) {
  log(`triggering a concentration check for ${actor?.name}`);

  // compute the save DC
  const saveDC = Math.max(10, Math.floor(damage / 2));
  debug(`computed saveDC ${saveDC}`);

  // create a Concentration Check item
  const itemData = duplicate(concentrationItem);
  itemData.data.save.dc = saveDC;
  itemData.data.chatFlavor = sourceName;

  const ownedItem = new CONFIG.Item.documentClass(itemData, { parent: actor });
  ownedItem.getSaveDC();

  // display item card
  const chatData = await ownedItem.displayCard({ createMessage: false });
  chatData.flags["dnd5e.itemData"] = itemData;
  return ChatMessage.create(chatData);
}
