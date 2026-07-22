import { MODULE_ID } from "./constants.mjs";
import { ParchmentMapApp } from "./ParchmentMapApp.mjs";
import { ParchmentMapOverlay } from "./ParchmentMapOverlay.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * GM settings dialog for the Parchment Map: pick the scene shown on the
 * parchment and the actor whose token the map centres on.
 */
export class ParchmentMapConfig extends HandlebarsApplicationMixin(ApplicationV2) {
	static DEFAULT_OPTIONS = {
		id: "scorpious187s-parchment-map-config",
		tag: "form",
		window: { title: "SCORPPARCH.Config.Title", icon: "fas fa-scroll" },
		position: { width: 480, height: "auto" },
		form: {
			handler: ParchmentMapConfig.#onSubmit,
			closeOnSubmit: true,
		},
	};

	static PARTS = {
		form: { template: `modules/${MODULE_ID}/templates/parchment-map-config.hbs` },
	};

	async _prepareContext() {
		const sceneId = game.settings.get(MODULE_ID, "sceneId");
		const actorId = game.settings.get(MODULE_ID, "actorId");
		const theme = game.settings.get(MODULE_ID, "theme");
		return {
			zoom: game.settings.get(MODULE_ID, "zoom"),
			themes: ["parchment", "scifi"].map((id) => ({
				id,
				label: game.i18n.localize(`SCORPPARCH.Config.ThemeChoice.${id}`),
				selected: id === theme,
			})),
			scenes: game.scenes.contents
				.map((s) => ({ id: s.id, name: s.name, selected: s.id === sceneId }))
				.sort((a, b) => a.name.localeCompare(b.name)),
			actors: game.actors.contents
				.map((a) => ({ id: a.id, name: a.name, selected: a.id === actorId }))
				.sort((a, b) => a.name.localeCompare(b.name)),
		};
	}

	static async #onSubmit(event, form, formData) {
		const d = formData.object;
		await game.settings.set(MODULE_ID, "sceneId", d.sceneId ?? "");
		await game.settings.set(MODULE_ID, "actorId", d.actorId ?? "");
		await game.settings.set(MODULE_ID, "zoom", Number(d.zoom) || 8);
		await game.settings.set(MODULE_ID, "theme", d.theme ?? "parchment");
		ParchmentMapApp.refresh();
		ParchmentMapOverlay.render();
	}
}
