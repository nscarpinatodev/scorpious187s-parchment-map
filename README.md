# Scorpious187's Parchment Map

A [Foundry VTT](https://foundryvtt.com) module that opens a map view styled as a rolled-up parchment scroll. A GM-configured scene is displayed with a heavy aged-ink parchment treatment, centred on a chosen actor's token, marked with a red X. No text, no chrome — just the map on the scroll.

![Preview](docs/preview.png)

## Features

- **Parchment scroll window** — a real parchment texture with torn edges and rolled ends; the window chrome is fully transparent, resizable, and draggable.
- **Aged map treatment** — the scene's background image is rendered as faded brown ink on the paper: sepia + hue-unifying colour blend, parchment multiply tint, SVG-noise grain and mottling, and soft-fade masks that melt the map's edges into the sheet.
- **X marks the spot** — a red ink marker tracks the configured actor's token and re-centres live as it moves.
- **Pan & zoom** — opens fully zoomed in on the marker; drag to pan, mouse-wheel or corner buttons to zoom, one click to re-centre.
- **Sensible fallbacks** — with nothing configured, the map shows the currently viewed scene centred on each user's own character.
- **System-agnostic** — works with any game system.

## Usage

1. Enable the module in your world.
2. **Settings → Configure Settings → Scorpious187's Parchment Map → Configure Parchment Map**: pick the scene to draw on the parchment, the actor whose token the map centres on, and the default zoom.
3. Open the map from the scroll button in the **Token controls** toolbar (available to players too), or via macro:

```js
game.modules.get("scorpious187s-parchment-map").api.open();
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
