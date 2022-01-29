# Concentrator for dnd5e

This module helps manage concentration when casting certain spells. It will automatically apply the Concentrating status effect when you cast a spell with concentration. It will then prompt you to make a Concentration Check when you take damage.

## Other Modules

Notes about other modules.

### Required Modules

[DFreds Convenient Effects](https://foundryvtt.com/packages/dfreds-convenient-effects) - A module that provides status effects for dnd5e. It's used to create the Concentrating active effect.

[libWrapper](https://foundryvtt.com/packages/lib-wrapper) - A library that makes it easy to wrap core Foundry VTT code. It's used to detect when a spell with concentration is cast.

### Suggested Modules

[Dynamic Active Effects](https://foundryvtt.com/packages/dae) A module that improves the Active Effects system used by dnd5e. If this module is active then it's used to convert the spell's duration to the active effect's duration.
