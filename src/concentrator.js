import { initSettings } from "./settings.js";
import { debug, log } from "./util.js";

const EFFECT_NAME = "Concentrating";

/**
 * Initialize the module.
 */
Hooks.once("init", () => {
  log("initializing Concentrator");
  initSettings();
});

/**
 * Register a click listener for the concentration chat card buttons.
 */
Hooks.on("renderChatLog", (app, html, data) =>
  html.on("click", ".custom-card-buttons button", onButtonClick)
);

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
    addConcentration(item, item.actor);
  }
});

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
      await concentrationCheck(damage, actor, sourceName, effect.id);
    }
  }
});

function concentratingOn(actor) {
  return actor.effects?.find((e) => e.label === EFFECT_NAME && !e.isSuppressed && !e.disabled);
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
 * @param {string} effectId the concentration effect's ID
 * @returns {Promise<ChatMessage>} the chat message for the concentration item card
 */
async function concentrationCheck(damage, actor, sourceName, effectId) {
  log(`triggering a concentration check for ${actor?.name}`);

  // compute the save DC
  const saveDC = Math.max(10, Math.floor(damage / 2));
  debug(`computed saveDC ${saveDC}`);

  // Render the chat card template
  const token = actor.token;
  const ability = "con";
  const templateData = {
    actorId: actor.id,
    tokenId: token?.uuid || null,
    description: `Took ${damage} damage, so you must make a concentration check.`,
    ability,
    abilityLabel: CONFIG.DND5E.abilities[ability]?.label ?? CONFIG.DND5E.abilities[ability] ?? "",
    saveDC,
    effectId,
  };
  const html = await renderTemplate("modules/concentrator/templates/chat-card.hbs", templateData);

  // Create the ChatMessage
  const chatData = {
    user: game.user.id,
    type: CONST.CHAT_MESSAGE_TYPES.OTHER,
    content: html,
    flavor: sourceName,
    speaker: ChatMessage.getSpeaker({ actor, token }),
  };
  return ChatMessage.create(chatData);
}

async function onButtonClick(event) {
  event.preventDefault();
  debug("onButtonClick called");

  // Extract card data
  const button = event.currentTarget;
  button.disabled = true;
  const card = button.closest(".chat-card");

  // Recover the actor for the chat card
  const actor = await dnd5e.documents.Item5e._getChatCardActor(card);
  if (!actor) return;

  // Validate permission to proceed with the roll
  if (!actor.isOwner) return;

  // Handle different actions
  switch (button.dataset.action) {
    case "save":
      const speaker = ChatMessage.getSpeaker({ scene: canvas.scene, token: actor.token });
      // TODO: use Midi flags for adv/dis and bonuses
      await actor.rollAbilitySave(button.dataset.ability, { event, speaker });
      break;
    case "removeEffect":
      const effect = actor.effects.get(button.dataset.effectId);
      if (effect) await effect.delete();
      break;
  }

  // Re-enable the button
  button.disabled = false;
}
