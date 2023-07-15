import { initSettings } from "./settings.js";
import { debug, log } from "./util.js";

const EFFECT_NAME = "Concentrating";

/**
 * Initialize the module.
 */
Hooks.once("init", () => {
  log("initializing Concentrator");
  initSettings();

  // add advantage/bonus to Special Traits
  CONFIG.DND5E.characterFlags["concentrationAdvantage"] = {
    name: "Advantage on Concentration",
    hint: "Provided by feats, like War Caster, or magical items.",
    section: "DND5E.Concentration",
    type: Boolean,
  };
  CONFIG.DND5E.characterFlags["concentrationBonus"] = {
    name: "Concentration Bonus",
    hint: "A bonus to saving throws to maintain concentration. Supports dynamic values such as @prof, dice, as well as flat numbers.",
    section: "DND5E.Concentration",
    type: String,
  };
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

Hooks.on("renderAbilityUseDialog", async (dialog, html) => {
  debug("renderAbilityUseDialog hook called", dialog.item);

  const item = dialog.item;

  if (item.system.components?.concentration) {
    // if the actor is already concentrating, show a warning
    const effect = concentratingOn(item.actor);
    if (effect) {
      const name = await getSourceName(effect);
      // create warning message
      const p = document.createElement("p");
      p.innerText = `If you cast this spell, it will end concentration on ${name}`;
      p.classList.add("notification");
      p.classList.add("warning");
      // add warning after notes and reset height to avoid scrollbar
      html[0].querySelector(".notes").after(p);
      dialog.setPosition({ height: "auto" });
    }
  }
});

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

  // remove concentration if it already exists
  const effect = concentratingOn(actor);
  if (effect) await effect.delete();

  // find the DFreds Convenient Effect version of Concentrating
  let statusEffect = game.dfreds.effectInterface.findEffectByName(EFFECT_NAME);

  // clone the effect and set origin and duration
  const duration = getItemDuration(item);
  statusEffect = statusEffect.clone({ origin: item.uuid, duration });

  // enable effect
  debug("creating active effect", statusEffect);
  actor.createEmbeddedDocuments("ActiveEffect", [statusEffect]);
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
    if (damage > 0) await concentrationCheck(damage, actor, effect);
  }
});

function concentratingOn(actor) {
  return actor.effects?.find((e) => e.label === EFFECT_NAME && !e.isSuppressed && !e.disabled);
}

// TODO: remove when minimum Foundry is v11
async function getSourceName(effect) {
  if (game.release.generation >= 11) return effect.sourceName;

  // workaround https://github.com/foundryvtt/foundryvtt/issues/6702
  await effect._getSourceName();
  return effect.sourceName;
}

/**
 * Display an item card in chat for the concentration check.
 * @param {number} damage the damage taken
 * @param {Actor5e} actor who should make the check
 * @param {ActiveEffect} effect the concentration effect
 * @returns {Promise<ChatMessage>} the chat message for the concentration item card
 */
async function concentrationCheck(damage, actor, effect) {
  log(`triggering a concentration check for ${actor?.name}`);

  // compute the save DC
  const saveDC = Math.max(10, Math.floor(damage / 2));
  debug(`computed saveDC ${saveDC}`);

  // format the description
  const actorName = actor.token?.name ?? actor.name;
  const description = await TextEditor.enrichHTML(
    `${actorName} took <strong>${damage} damage</strong> and must make a <strong>DC ${saveDC} Constitution saving throw</strong> to maintain concentration on @UUID[${effect.origin}].`,
    {
      secrets: false,
      documents: true,
      links: false,
      rolls: false,
      async: true,
    }
  );

  // Render the chat card template
  const token = actor.token;
  const ability = "con";
  const templateData = {
    actorId: actor.id,
    tokenId: token?.uuid || null,
    description,
    ability,
    abilityLabel: CONFIG.DND5E.abilities[ability]?.label ?? CONFIG.DND5E.abilities[ability] ?? "",
    saveDC,
    effectId: effect.id,
  };
  const html = await renderTemplate("modules/concentrator/templates/chat-card.hbs", templateData);

  // Create the ChatMessage
  const chatData = {
    user: game.user.id,
    type: CONST.CHAT_MESSAGE_TYPES.OTHER,
    content: html,
    speaker: ChatMessage.getSpeaker({ alias: "Concentrator" }),
  };
  return ChatMessage.create(chatData);
}

/**
 * The click handler for the concentration card buttons.
 * @param {Event} event the event
 */
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
    case "concentration":
      const speaker = ChatMessage.getSpeaker({ scene: canvas.scene, token: actor.token });
      // check for Advantage and set AR's label
      const advantage = actor.getFlag("dnd5e", "concentrationAdvantage");
      const dialogOptions = {};
      if (advantage)
        setProperty(dialogOptions, "adv-reminder.advantageLabels", ["Advantage on Concentration"]);
      // check for Bonus
      let bonus = actor.getFlag("dnd5e", "concentrationBonus");
      if (bonus) bonus = [bonus];

      await actor.rollAbilitySave(button.dataset.ability, {
        event,
        speaker,
        advantage,
        dialogOptions,
        parts: bonus,
      });
      break;
    case "removeEffect":
      const effect = actor.effects.get(button.dataset.effectId);
      if (effect) await effect.delete();
      break;
  }

  // Re-enable the button
  button.disabled = false;
}
