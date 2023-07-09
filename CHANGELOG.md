# 2.0

- Use a custom chat card to add a Remove Concentration Effect button
- Add advantage and bonus to concentration checks in the Special Traits section of the character sheet
- little bits of code cleanup
- verified with v11

# 1.1

- Fix for not triggering concentration checks since a CE flag was moved
- remove whisper option, wasn't being used

# 1.0

- update manifest file for v10
- make DataModel changes (e.g. `data.data` => `system`) for v10
- use the Developer Mode module for debug logging
- remove dependency on libWrapper and use new dnd5e hooks instead

# 0.9

- Fix a bug that would trigger a concentration check when Concentrating was inactive
- Change how the Concentration Check item is made

# 0.8

- Update to latest Convenient Effects interface to fix missing source

# 0.7

- Fix for concentrating with no source
- Add missing await when whispering message to apply concentration
- Set compatible verion to v9

# 0.6

- Fix for setting hint, remove the mention of resource consumption
- Add some missing awaits on adding concentration effect and check item card
- Add the source of concentration (i.e. spell's name) as flavor text for the check item card

# 0.5

- Fix for whisper mode with an unlinked token
- Remove consumed resource option, too unreliable
- Check if we're in combat when applying concentration when calculating duration

# 0.4

- Fix for missing template file

# 0.3

- Fix for duplicate concentration checks
- Add new consumed/whisper options for when to add the Concentrating effect

# 0.2

- Make DAE dependency optional

# 0.1

- Initial release
