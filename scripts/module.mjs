import { MODULE_ID } from "./constants.mjs";
import { ParchmentMapApp } from "./ParchmentMapApp.mjs";
import { ParchmentMapConfig } from "./ParchmentMapConfig.mjs";

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
	};
});

// Scene-controls launch button (Token controls group, visible to all players).
Hooks.on("getSceneControlButtons", (controls) => {
	const tokens = controls.tokens ?? controls.token;
	if (!tokens?.tools) return;
	tokens.tools.parchmentMap = {
		name: "parchmentMap",
		title: "SCORPPARCH.OpenTool",
		icon: "fas fa-scroll",
		button: true,
		order: Object.keys(tokens.tools).length,
		onChange: () => ParchmentMapApp.open(),
	};
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
}
// `moveToken` fires when a move is committed (destination known immediately);
// `updateToken` covers non-movement changes and other cores.
Hooks.on("moveToken", (tokenDoc) => refreshMapForToken(tokenDoc));
Hooks.on("updateToken", (tokenDoc) => refreshMapForToken(tokenDoc));

// The map may fall back to the viewed scene, so re-render on scene changes.
Hooks.on("canvasReady", () => ParchmentMapApp.refresh());
Hooks.on("updateScene", (scene) => {
	const sceneId = game.settings.get(MODULE_ID, "sceneId") || canvas?.scene?.id;
	if (scene.id === sceneId) ParchmentMapApp.refresh();
});
