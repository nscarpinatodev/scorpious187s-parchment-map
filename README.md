# Scorpious187's In-Game Maps

A [Foundry VTT](https://foundryvtt.com) module that displays a scene as an in-game map inside a themed frame — a rolled-up parchment scroll with a heavy aged-ink treatment, or a sci-fi holo-tablet. The map is centred on a chosen actor's token, marked in red. No text, no chrome — just the map in its frame, as a window or pinned into a scene like a tile.

> Formerly "Scorpious187's Parchment Map" — the module id is unchanged, so existing installs update normally.

![Preview](docs/preview.png)

## Features

- **Parchment scroll window** — a real parchment texture with torn edges and rolled ends; the window chrome is fully transparent, resizable, and draggable.
- **Aged map treatment** — the scene's background image is rendered as faded brown ink on the paper: sepia + hue-unifying colour blend, parchment multiply tint, SVG-noise grain and mottling, and soft-fade masks that melt the map's edges into the sheet.
- **X marks the spot** — a red ink marker tracks the configured actor's token and re-centres live as it moves.
- **Pan & zoom** — opens fully zoomed in on the marker; drag to pan, mouse-wheel or corner buttons to zoom, one click to re-centre.
- **Static scene overlay** — the GM can also pin the parchment into a scene like a tile: it sits at a fixed spot in the world, pans and zooms with the canvas, and updates live as the marked token moves. Players see it as part of the scene and cannot interact with it (clicks pass straight through to the canvas); the GM gets small handles to move, resize, or remove it.
- **Tagged tiles** — tick "Show on In-Game Map" in any tile's configuration to draw it on the map at its scene position (rotation, opacity and stacking respected), with the active theme's treatment applied. Handy for hand-placed landmarks, labels, or fog shapes that should only exist on the map.
- **Frame themes** — choose in the config how the map is dressed: the aged parchment scroll, or a **sci-fi holo-tablet** (gunmetal corner brackets, teal hologram tint, scanlines) rendered from a CC-licensed 3D model. Themes apply to the window and the scene overlay alike.
- **Sensible fallbacks** — with nothing configured, the map shows the currently viewed scene centred on each user's own character.
- **System-agnostic** — works with any game system.

## Usage

1. Enable the module in your world.
2. **Settings → Configure Settings → Scorpious187's Parchment Map → Configure Parchment Map**: pick the scene to draw on the parchment, the actor whose token the map centres on, and the default zoom.
3. Open the map from the scroll button in the **Token controls** toolbar (available to players too), or via macro:

```js
game.modules.get("scorpious187s-parchment-map").api.open();
```

### Static scene overlay (GM)

To show the map to everyone as part of the scene, click the scroll button in the **Tiles controls** toolbar (GM only). The parchment is placed in the centre of your current view and is immediately visible to all players viewing that scene. Use the handles on the sheet to drag it into position, resize it from the bottom-right grip, or remove it with the ✕; placement is saved on the scene, so it persists and stays where you put it for every client. Clicking the toolbar button again also removes it. Macro equivalent:

```js
game.modules.get("scorpious187s-parchment-map").api.toggleOverlay();
```

## Compatibility

- Foundry VTT v13 minimum, verified on v14.
- System-agnostic.

## Installation

Install via manifest URL:

```
https://github.com/nscarpinatodev/scorpious187s-parchment-map/releases/latest/download/module.json
```

## Credits

Parchment texture: [Old parchment paper with a rough surface](https://www.vecteezy.com/) via Vecteezy.

Sci-fi tablet frame: this work is based on "Low Poly Sci-Fi Tablet" (https://sketchfab.com/3d-models/low-poly-sci-fi-tablet-ee1fde7ec1514fd5a61790809ebd46a6) by Snooze (https://sketchfab.com/Snooze) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/).
