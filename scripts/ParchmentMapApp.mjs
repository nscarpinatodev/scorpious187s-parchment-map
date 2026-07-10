import { MODULE_ID } from "./constants.mjs";

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

	/** The scene the map shows: the configured one, else the currently viewed one. */
	#resolveScene() {
		const configured = game.scenes.get(game.settings.get(MODULE_ID, "sceneId"));
		return configured ?? canvas?.scene ?? null;
	}

	/** The actor the map centres on: the configured one, else the user's character. */
	#resolveActor() {
		const configured = game.actors.get(game.settings.get(MODULE_ID, "actorId"));
		return configured ?? game.user.character ?? null;
	}

	#resolveSrc(path) {
		if (!path) return null;
		return /^https?:|^data:/i.test(path) ? path : foundry.utils.getRoute(path);
	}

	/** Fraction (0..1) of a token document's centre within the scene rect. */
	#tokenCenter(scene, token) {
		if (!token) return { fx: 0.5, fy: 0.5, hasToken: false };
		const dim = scene.dimensions;
		const grid = scene.grid?.size ?? dim?.size ?? 100;
		// v14 animates token.x/.y; movement.destination is the settled position.
		const pos = token.movement?.destination ?? token;
		const cx = (pos.x ?? token.x) + ((pos.width ?? token.width ?? 1) * grid) / 2;
		const cy = (pos.y ?? token.y) + ((pos.height ?? token.height ?? 1) * grid) / 2;
		return {
			fx: Math.clamp((cx - dim.sceneX) / dim.sceneWidth, 0, 1),
			fy: Math.clamp((cy - dim.sceneY) / dim.sceneHeight, 0, 1),
			hasToken: true,
		};
	}

	async _prepareContext(options) {
		const context = await super._prepareContext(options);
		context.moduleId = MODULE_ID;
		// Resolve to a root-absolute URL so the inline-style url() isn't broken
		// by Foundry's route prefix (a relative url() 404s otherwise).
		context.frameSrc = foundry.utils.getRoute(`modules/${MODULE_ID}/frames/parchment.png`);

		const scene = this.#resolveScene();
		const bg = scene?.background?.src ?? scene?.img ?? null;
		if (!scene || !bg) {
			context.available = false;
			return context;
		}

		const actor = this.#resolveActor();
		const token = actor ? scene.tokens.find((t) => t.actorId === actor.id) : null;
		const { fx, fy, hasToken } = this.#tokenCenter(scene, token);

		context.available = true;
		context.bgSrc = this.#resolveSrc(bg);
		context.fx = fx;
		context.fy = fy;
		context.hasToken = hasToken;
		context.actorName = actor?.name ?? "";
		context.defaultZoom = game.settings.get(MODULE_ID, "zoom") || 8;
		return context;
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
		const vp = this.element?.querySelector(".pmap-viewport");
		const cv = vp?.querySelector(".pmap-canvas");
		const img = cv?.querySelector(".pmap-scene");
		if (!vp || !cv || !img) return;

		const apply = () => {
			const vw = vp.clientWidth;
			const vh = vp.clientHeight;
			if (!vw || !vh || !img.naturalWidth) return;
			const zoom = this.#currentZoom(vp);
			const fx = parseFloat(vp.dataset.fx) || 0.5;
			const fy = parseFloat(vp.dataset.fy) || 0.5;
			const dispW = vw * zoom;
			const dispH = dispW * (img.naturalHeight / img.naturalWidth);
			cv.style.width = `${dispW}px`;
			cv.style.height = `${dispH}px`;
			cv.style.left = `${vw / 2 - fx * dispW + this.#view.panX}px`;
			cv.style.top = `${vh / 2 - fy * dispH + this.#view.panY}px`;

			// Keep the X-marks-the-spot marker on the token as the view pans/zooms.
			const marker = vp.querySelector(".pmap-marker");
			if (marker) {
				marker.style.left = `${vw / 2 + this.#view.panX}px`;
				marker.style.top = `${vh / 2 + this.#view.panY}px`;
			}
		};

		if (img.complete && img.naturalWidth) apply();
		else img.addEventListener("load", apply, { once: true });
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
}
