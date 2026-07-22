import { MODULE_ID } from "./constants.mjs";
import { ParchmentMapApp } from "./ParchmentMapApp.mjs";
import { ParchmentMapConfig } from "./ParchmentMapConfig.mjs";
import { ParchmentMapOverlay } from "./ParchmentMapOverlay.mjs";

export { MODULE_ID };

Hooks.once("init", () => {
	console.log(`${MODULE_ID} | Initialising Scorpious187's Parchment Map`);

	// --- Map settings (GM, edited via the config menu) --------------------
	game.settings.register(MODULE_ID, "sceneId", {
		scope: "world", config: false, type: String, default: "",
	});
	game.settings.register(MODULE_ID, "actorId", {
		scope: "world", config: false, type: String, default: "",
	});
	game.settings.register(MODULE_ID, "zoom", {
		scope: "world", config: false, type: Number, default: 8,
	});
	// Per-user orientation of the map window (the overlay's orientation is
	// GM-placed and lives in the scene flag instead).
	game.settings.register(MODULE_ID, "landscape", {
		scope: "client", config: false, type: Boolean, default: false,
	});
	// Frame theme (parchment scroll, sci-fi tablet, ...), world-wide.
	game.settings.register(MODULE_ID, "theme", {
		scope: "world", config: false, type: String, default: "parchment",
	});
	game.settings.registerMenu(MODULE_ID, "parchmentMapConfig", {
		name: "SCORPPARCH.Config.MenuName",
		label: "SCORPPARCH.Config.MenuLabel",
		hint: "SCORPPARCH.Config.MenuHint",
		icon: "fas fa-scroll",
		type: ParchmentMapConfig,
		restricted: true,
	});

	// Expose a small API for macros / other modules.
	game.modules.get(MODULE_ID).api = {
		open: () => ParchmentMapApp.open(),
		toggleOverlay: () => ParchmentMapOverlay.toggle(),
		rotateOverlay: () => ParchmentMapOverlay.rotate(),
	};
});

// Scene-controls launch button (Token controls group, visible to all players).
Hooks.on("getSceneControlButtons", (controls) => {
	const tokens = controls.tokens ?? controls.token;
	if (tokens?.tools) {
		tokens.tools.parchmentMap = {
			name: "parchmentMap",
			title: "SCORPPARCH.OpenTool",
			icon: "fas fa-scroll",
			button: true,
			order: Object.keys(tokens.tools).length,
			onChange: () => ParchmentMapApp.open(),
		};
	}

	// GM-only: place/remove the static overlay on the viewed scene. It lives
	// with the Tiles tools because it behaves like a tile.
	const tiles = controls.tiles ?? controls.tile;
	if (game.user.isGM && tiles?.tools) {
		tiles.tools.parchmentMapOverlay = {
			name: "parchmentMapOverlay",
			title: "SCORPPARCH.OverlayTool",
			icon: "fas fa-scroll",
			button: true,
			order: Object.keys(tiles.tools).length,
			onChange: () => ParchmentMapOverlay.toggle(),
		};
	}
});

// Re-centre the open map when the configured actor's token moves. We don't
// gate on `x`/`y` in the change set — v13/v14 commits token movement in ways
// that don't always surface those keys here — instead we refresh whenever a
// relevant token updates and read its live position in _prepareContext.
function refreshMapForToken(tokenDoc) {
	const sceneId = game.settings.get(MODULE_ID, "sceneId");
	const actorId = game.settings.get(MODULE_ID, "actorId");
	const shownSceneId = sceneId || canvas?.scene?.id;
	if (tokenDoc.parent?.id !== shownSceneId) return;
	if (actorId && tokenDoc.actorId !== actorId) return;
	ParchmentMapApp.refresh();
	ParchmentMapOverlay.render();
}
// `moveToken` fires when a move is committed (destination known immediately);
// `updateToken` covers non-movement changes and other cores.
Hooks.on("moveToken", (tokenDoc) => refreshMapForToken(tokenDoc));
Hooks.on("updateToken", (tokenDoc) => refreshMapForToken(tokenDoc));

// "Show on in-game map" checkbox in the Tile configuration sheet. The input
// is named into our flag scope, so Foundry's form handling saves it with the
// rest of the tile — no custom submit logic needed.
Hooks.on("renderTileConfig", (app, html) => {
	const element = html instanceof HTMLElement ? html : html?.[0];
	const doc = app.document ?? app.object;
	if (!element || !doc) return;
	const flagName = `flags.${MODULE_ID}.showOnMap`;
	if (element.querySelector(`[name="${flagName}"]`)) return;
	const checked = doc.getFlag(MODULE_ID, "showOnMap") ? "checked" : "";
	const group = document.createElement("div");
	group.className = "form-group";
	group.innerHTML = `
		<label>${game.i18n.localize("SCORPPARCH.TileShowOnMap")}</label>
		<div class="form-fields">
			<input type="checkbox" name="${flagName}" ${checked} />
		</div>
		<p class="hint">${game.i18n.localize("SCORPPARCH.TileShowOnMapHint")}</p>`;
	const anchor = element.querySelector("footer, .form-footer");
	if (anchor) anchor.before(group);
	else element.querySelector("form")?.appendChild(group);
	app.setPosition?.({ height: "auto" });
});

// Tagged tiles draw on the map, so tile changes on the shown scene refresh it.
function refreshMapForTile(tileDoc) {
	const shownSceneId = game.settings.get(MODULE_ID, "sceneId") || canvas?.scene?.id;
	if (tileDoc.parent?.id !== shownSceneId) return;
	ParchmentMapApp.refresh();
	ParchmentMapOverlay.render();
}
Hooks.on("createTile", (tileDoc) => refreshMapForTile(tileDoc));
Hooks.on("updateTile", (tileDoc) => refreshMapForTile(tileDoc));
Hooks.on("deleteTile", (tileDoc) => refreshMapForTile(tileDoc));

// World settings (theme, scene, actor, zoom) sync to every client; refresh
// the open displays when any of ours changes.
Hooks.on("updateSetting", (setting) => {
	if (!setting.key?.startsWith(`${MODULE_ID}.`)) return;
	ParchmentMapApp.refresh();
	ParchmentMapOverlay.render();
});

// The map may fall back to the viewed scene, so re-render on scene changes.
// The overlay also (re)builds here: its placement flag lives on the viewed
// scene, so canvasReady/updateScene cover both placing and moving it.
Hooks.on("canvasReady", () => {
	ParchmentMapApp.refresh();
	ParchmentMapOverlay.render();
});
Hooks.on("updateScene", (scene) => {
	const sceneId = game.settings.get(MODULE_ID, "sceneId") || canvas?.scene?.id;
	if (scene.id === sceneId) ParchmentMapApp.refresh();
	if (scene.id === sceneId || scene.id === canvas?.scene?.id) ParchmentMapOverlay.render();
});
