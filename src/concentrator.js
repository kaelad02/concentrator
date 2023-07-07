import { initSettings, addEffect } from "./settings.js";
import { debug, isModuleActive, log } from "./util.js";

const EFFECT_NAME = "Concentrating";

/**
 * Initialize the module.
 */
Hooks.once("init", () => {
  log("initializing Concentrator");
  initSettings();

  // add hooks for the whispered message
  const chatListeners = (app, html, data) =>
    html.on("click", ".concentrator .card-buttons button", onChatCardButton);
  Hooks.on("renderChatLog", chatListeners);
  Hooks.on("renderChatPopout", chatListeners);
});

/**
 * Register with Developer Mode for a debug flag.
 */
Hooks.once("devModeReady", ({ registerPackageDebugFlag }) =>
  registerPackageDebugFlag("concentrator")
);

/**
 * Hook when an item is used that detects when a spell w/ concentration is cast.
 */
Hooks.on("dnd5e.useItem", (item, config, options, templates) => {
  debug("dnd5e.useItem hook called", item);

  // check if the item requires concentration
  if (item.system.components?.concentration) {
    debug("found a concentration spell");
    if (addEffect === "always") addConcentration(item, item.actor);
    else if (addEffect === "whisper") whisperMessage(item, item.actor);
  }
});

async function whisperMessage(item, actor) {
  const html = await renderTemplate("modules/concentrator/templates/ask-to-add.hbs", {
    item,
    actor,
  });

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

  return ChatMessage.create(messageData);
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
  let statusEffect = game.dfreds.effectInterface.findEffectByName(EFFECT_NAME);

  // clone the effect and set origin and duration
  const duration = getItemDuration(item);
  statusEffect = statusEffect.clone({ origin: item.uuid, duration });

  // enable effect
  debug("creating active effect", statusEffect);
  return actor.createEmbeddedDocuments("ActiveEffect", [statusEffect]).then((documents) => {
    return documents.length > 0;
  });
}

/**
 * Get the duration for an active effect based on the item.
 * @param {Item5e} item The item (spell) that triggered concentration
 * @returns {object} the duration for an active effect
 */
function getItemDuration(item) {
  const duration = item.system.duration;

  if (!duration?.value) return {};
  const { value, units } = duration;

  switch (units) {
    case "turn":
      return { turns: value };
    case "round":
      return { rounds: value };
    case "minute":
      return { seconds: value * 60 };
    case "hour":
      return { seconds: value * 60 * 60 };
    case "day":
      return { seconds: value * 60 * 60 * 24 };
    default:
      return {};
  }
}

/**
 * In the preUpdateActor hook, save the original HP values.
 */
Hooks.on("preUpdateActor", (actor, updateData, options, userId) => {
  debug("preUpdateActor hook called");
  debug("updateData", updateData, "options", options);

  // check if hp is modified
  if (updateData.system?.attributes?.hp?.temp || updateData.system?.attributes?.hp?.value) {
    // save current hp value to calculate actual change later
    options.originalHpTemp = actor.system.attributes.hp.temp;
    options.originalHpValue = actor.system.attributes.hp.value;
  }
});

/**
 * In the updateActor hook, trigger a concentration check.
 */
Hooks.on("updateActor", async (actor, updateData, options, userId) => {
  debug("updateActor hook called");

  // only perform check on the user who made the change
  if (userId !== game.userId) return;

  // check for flag and concentrating
  const effect = concentratingOn(actor);
  if (options.originalHpValue && effect) {
    // compute damage taken
    const damage =
      options.originalHpTemp -
      actor.system.attributes.hp.temp +
      options.originalHpValue -
      actor.system.attributes.hp.value;
    debug(`damage taken: ${damage}`);
    // make check
    if (damage > 0) {
      const sourceName = await getSourceName(effect);
      await concentrationCheck(damage, actor, sourceName);
    }
  }
});

function concentratingOn(actor) {
  return actor.effects?.find(
    (effect) =>
      effect.flags.isConvenient &&
      effect.label === EFFECT_NAME &&
      !effect.isSuppressed &&
      !effect.disabled
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
  const itemData = {
    system: {
      actionType: "save",
      chatFlavor: sourceName,
      save: {
        ability: "con",
        dc: saveDC,
        scaling: "flat",
      },
    },
    img: "modules/concentrator/img/concentrating.svg",
    name: "Concentration Check",
    type: "feat",
  };

  const ownedItem = await CONFIG.Item.documentClass.create(itemData, {
    parent: actor,
    temporary: true,
  });
  ownedItem.getSaveDC();

  // display item card
  const chatData = await ownedItem.displayCard({ createMessage: false });
  chatData.flags["dnd5e.itemData"] = itemData;
  return ChatMessage.create(chatData);
}
