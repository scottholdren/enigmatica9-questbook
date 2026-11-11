# Enigmatica 9 Quest Book

A browsable web version of the FTB Quests quest book from **Enigmatica 9 (Expert)** for Minecraft 1.19.2.

**View it:** https://scottholdren.github.io/enigmatica9-questbook/

- Switch between Normal and Expert mode chapters
- Pan and zoom each chapter's quest tree, click a quest for its description, tasks, rewards, and prerequisites
- Search across all quests and task items
- Deep links: `#<chapter_file>/<quest_id>`

## Regenerating

`quests.json` (quest data plus embedded item icons) is generated from a local modpack instance:

```sh
pip install pillow
python3 tools/build.py <instance>/minecraft quests.json <libraries>/com/mojang/minecraft/1.19.2/minecraft-1.19.2-client.jar
```

Icons are rendered from the textures in the instance's mod jars. Items whose models are drawn in code (some Thermal, AE2 parts, OBJ models) show a two-letter placeholder.

Quest content belongs to the Enigmatica team; item textures belong to their respective mod authors.
