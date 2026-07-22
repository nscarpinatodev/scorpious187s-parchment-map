import { MODULE_ID } from "./constants.mjs";
import { layoutMapViewport, prepareMapContext } from "./map-data.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The Parchment Map window. A single shared instance shows the GM-configured
 * scene as an aged map on a parchment scroll, centred on the configured
 * actor's token, with wheel-zoom and drag-pan.
 */
export class ParchmentMapApp extends HandlebarsApplicationMixin(ApplicationV2) {
	/** @type {ParchmentMapApp|null} the single live instance */
	static #instance = null;

	/** Pan/zoom view transform. zoom === null means "use the configured default". */
	#view = { zoom: null, panX: 0, panY: 0 };

	static DEFAULT_OPTIONS = {
		id: MODULE_ID,
		classes: ["parchment-map"],
		window: {
			icon: "fas fa-scroll",
			resizable: true,
		},
		position: {
			width: 700,
			height: "auto",
		},
		actions: {
			zoomMap: ParchmentMapApp.#onZoomMap,
			recenterMap: ParchmentMapApp.#onRecenterMap,
			rotateMap: ParchmentMapApp.#onRotateMap,
			closeMap: ParchmentMapApp.#onCloseMap,
		},
	};

	static PARTS = {
		main: { template: `modules/${MODULE_ID}/templates/parchment-map.hbs` },
	};

	get title() {
		return game.i18n.localize("SCORPPARCH.WindowTitle");
	}

	/* -------------------------------------------- */
	/*  Lifecycle helpers                            */
	/* -------------------------------------------- */

	/** Open (or focus) the parchment map. */
	static open() {
		if (ParchmentMapApp.#instance) {
			const app = ParchmentMapApp.#instance;
			app.render({ force: true });
			// Only refocus if a previous render actually produced an element (a
			// failed first render leaves the instance without one).
			if (app.rendered) app.bringToFront();
			return app;
		}
		const app = new ParchmentMapApp();
		ParchmentMapApp.#instance = app;
		app.render({ force: true });
		return app;
	}

	/** Re-render the open map, if any (e.g. token moved, settings changed). */
	static refresh() {
		if (ParchmentMapApp.#instance?.rendered) ParchmentMapApp.#instance.render();
	}

	_onClose(options) {
		ParchmentMapApp.#instance = null;
		return super._onClose(options);
	}

	/* -------------------------------------------- */
	/*  Context                                      */
	/* -------------------------------------------- */

	async _prepareContext(options) {
		const context = await super._prepareContext(options);
		return Object.assign(context, prepareMapContext({
			landscape: game.settings.get(MODULE_ID, "landscape"),
		}));
	}

	/* -------------------------------------------- */
	/*  Rendering                                    */
	/* -------------------------------------------- */

	_onRender(context, options) {
		super._onRender(context, options);
		this.#layoutMap();
		this.#attachMapControls();
	}

	/** The window itself resizing must re-fit the map to the new viewport. */
	_onPosition(position) {
		super._onPosition?.(position);
		this.#layoutMap();
	}

	#currentZoom(vp) {
		return this.#view.zoom ?? (parseFloat(vp.dataset.zoom) || 8);
	}

	/** Position the map canvas: centre on the token, then apply pan + zoom. */
	#layoutMap() {
		layoutMapViewport(this.element?.querySelector(".pmap-viewport"), this.#view);
	}

	/** Wheel-zoom and drag-pan on the map viewport. */
	#attachMapControls() {
		const vp = this.element?.querySelector(".pmap-viewport");
		if (!vp) return;

		vp.addEventListener("wheel", (event) => {
			event.preventDefault();
			const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
			this.#setZoom(this.#currentZoom(vp) * factor);
		}, { passive: false });

		let dragging = false;
		let lastX = 0;
		let lastY = 0;
		vp.addEventListener("pointerdown", (event) => {
			// The zoom tools live inside the viewport; don't let a button press
			// start a drag (pointer capture would swallow the button's click).
			if (event.target.closest(".pmap-tools")) return;
			dragging = true;
			lastX = event.clientX;
			lastY = event.clientY;
			vp.setPointerCapture(event.pointerId);
			vp.classList.add("dragging");
		});
		vp.addEventListener("pointermove", (event) => {
			if (!dragging) return;
			this.#view.panX += event.clientX - lastX;
			this.#view.panY += event.clientY - lastY;
			lastX = event.clientX;
			lastY = event.clientY;
			this.#layoutMap();
		});
		const end = (event) => {
			dragging = false;
			vp.classList.remove("dragging");
			try { vp.releasePointerCapture(event.pointerId); } catch (_e) { /* ignore */ }
		};
		vp.addEventListener("pointerup", end);
		vp.addEventListener("pointercancel", end);
	}

	#setZoom(zoom) {
		this.#view.zoom = Math.clamp(zoom, 1, 8);
		this.#layoutMap();
	}

	/* -------------------------------------------- */
	/*  Actions                                      */
	/* -------------------------------------------- */

	static #onZoomMap(event, target) {
		const vp = this.element?.querySelector(".pmap-viewport");
		if (!vp) return;
		const dir = Number(target.dataset.dir) || 0;
		this.#setZoom(this.#currentZoom(vp) * (dir > 0 ? 1.25 : 1 / 1.25));
	}

	static #onRecenterMap() {
		this.#view = { zoom: null, panX: 0, panY: 0 };
		this.#layoutMap();
	}

	static #onCloseMap() {
		this.close();
	}

	static async #onRotateMap() {
		await game.settings.set(MODULE_ID, "landscape",
			!game.settings.get(MODULE_ID, "landscape"));
		await this.render();
		// The scroll's aspect ratio just flipped; re-fit the auto height so the
		// window doesn't keep the old orientation's box.
		this.setPosition({ height: "auto" });
	}
}
