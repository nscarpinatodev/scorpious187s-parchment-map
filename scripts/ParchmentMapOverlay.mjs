import { MODULE_ID } from "./constants.mjs";
import { frameHeight, layoutMapViewport, prepareMapContext } from "./map-data.mjs";

/**
 * The Parchment Map as a static scene overlay: the same aged-map treatment
 * rendered into Foundry's HUD layer, which shares the canvas transform, so the
 * parchment sits at a fixed world position and pans/zooms with the scene like
 * a tile. Placement lives in a flag on the viewed scene, so every client shows
 * it in the same spot. Players cannot interact with it at all (clicks pass
 * through to the canvas); the GM gets small move/resize/remove handles.
 */
export class ParchmentMapOverlay {
	/** @type {HTMLElement|null} the rendered overlay element, if any */
	static #element = null;

	/** True while the GM is dragging a handle; blocks re-renders mid-drag. */
	static #dragging = false;

	/** Minimum overlay width in world pixels. */
	static #MIN_WIDTH = 120;

	/** Placement flag ({x, y, width, landscape}, world coords) on the viewed scene. */
	static get placement() {
		return canvas?.scene?.getFlag(MODULE_ID, "overlay") ?? null;
	}

	/** The HUD container element, which shares the canvas world transform. */
	static get #hud() {
		const el = canvas?.hud?.element;
		return el instanceof HTMLElement ? el : document.getElementById("hud");
	}

	/* -------------------------------------------- */
	/*  Lifecycle                                    */
	/* -------------------------------------------- */

	/** GM: place the overlay in the centre of the current view, or remove it. */
	static async toggle() {
		const scene = canvas?.scene;
		if (!scene || !game.user.isGM) return;
		if (scene.getFlag(MODULE_ID, "overlay")) {
			await scene.unsetFlag(MODULE_ID, "overlay");
			return;
		}
		// Size the parchment to roughly a quarter of the GM's screen, converted
		// to world units so it lands the same for everyone.
		const scale = canvas.stage.scale.x || 1;
		const width = Math.max(this.#MIN_WIDTH, Math.round((window.innerWidth * 0.25) / scale));
		const { x, y } = canvas.stage.pivot;
		await scene.setFlag(MODULE_ID, "overlay", {
			x: Math.round(x - width / 2),
			y: Math.round(y - frameHeight(width, false) / 2),
			width,
			landscape: false,
		});
	}

	/** GM: flip the placed overlay between portrait and landscape. */
	static async rotate() {
		const placement = this.placement;
		if (!placement || !game.user.isGM) return;
		await canvas.scene?.setFlag(MODULE_ID, "overlay", {
			...placement,
			landscape: !placement.landscape,
		});
	}

	/** (Re)build the overlay for the viewed scene, or remove it if unplaced. */
	static async render() {
		if (this.#dragging) return;
		this.#element?.remove();
		this.#element = null;

		const placement = this.placement;
		const hud = this.#hud;
		if (!placement || !hud) return;

		const context = prepareMapContext({ landscape: placement.landscape });
		const html = await foundry.applications.handlebars.renderTemplate(
			`modules/${MODULE_ID}/templates/parchment-map.hbs`, context,
		);

		// `parchment-map` supplies the ink/paper palette CSS variables.
		const el = document.createElement("div");
		el.className = "parchment-map pmap-overlay";
		el.innerHTML = html;
		this.#applyPlacement(el, placement);
		if (game.user.isGM) this.#attachGMControls(el);

		hud.appendChild(el);
		this.#element = el;
		layoutMapViewport(el.querySelector(".pmap-viewport"));
	}

	/** Position/size the element in world coordinates (the HUD scales them). */
	static #applyPlacement(el, { x, y, width, landscape }) {
		el.style.left = `${x}px`;
		el.style.top = `${y}px`;
		el.style.width = `${width}px`;
		el.style.height = `${frameHeight(width, landscape)}px`;
	}

	/* -------------------------------------------- */
	/*  GM handles                                   */
	/* -------------------------------------------- */

	static #attachGMControls(el) {
		const controls = document.createElement("div");
		controls.className = "pmap-overlay-controls";

		const move = document.createElement("button");
		move.type = "button";
		move.className = "pmap-tool pmap-overlay-move";
		move.dataset.tooltip = game.i18n.localize("SCORPPARCH.Overlay.Move");
		move.innerHTML = '<i class="fas fa-arrows-up-down-left-right"></i>';

		const rotate = document.createElement("button");
		rotate.type = "button";
		rotate.className = "pmap-tool pmap-overlay-rotate";
		rotate.dataset.tooltip = game.i18n.localize("SCORPPARCH.Overlay.Rotate");
		rotate.innerHTML = '<i class="fas fa-rotate-right"></i>';
		rotate.addEventListener("click", () => this.rotate());

		const remove = document.createElement("button");
		remove.type = "button";
		remove.className = "pmap-tool pmap-overlay-remove";
		remove.dataset.tooltip = game.i18n.localize("SCORPPARCH.Overlay.Remove");
		remove.innerHTML = '<i class="fas fa-xmark"></i>';
		remove.addEventListener("click", () => this.toggle());

		controls.append(move, rotate, remove);
		el.appendChild(controls);

		const resize = document.createElement("button");
		resize.type = "button";
		resize.className = "pmap-tool pmap-overlay-resize";
		resize.dataset.tooltip = game.i18n.localize("SCORPPARCH.Overlay.Resize");
		resize.innerHTML = '<i class="fas fa-up-right-and-down-left-from-center"></i>';
		el.appendChild(resize);

		this.#dragBehavior(move, el, "move");
		this.#dragBehavior(resize, el, "resize");
	}

	/** Drag a handle to move/resize; commit the new placement to the flag. */
	static #dragBehavior(handle, el, mode) {
		handle.addEventListener("pointerdown", (event) => {
			if (event.button !== 0) return;
			event.preventDefault();
			event.stopPropagation();
			this.#dragging = true;
			// Screen-px deltas must shrink to world units by the canvas zoom.
			const scale = canvas.stage.scale.x || 1;
			const startX = event.clientX;
			const startY = event.clientY;
			const start = {
				x: parseFloat(el.style.left) || 0,
				y: parseFloat(el.style.top) || 0,
				width: parseFloat(el.style.width) || this.#MIN_WIDTH,
				landscape: !!this.placement?.landscape,
			};

			const onMove = (ev) => {
				const dx = (ev.clientX - startX) / scale;
				const dy = (ev.clientY - startY) / scale;
				const next = mode === "move"
					? { ...start, x: start.x + dx, y: start.y + dy }
					: { ...start, width: Math.max(this.#MIN_WIDTH, start.width + dx) };
				this.#applyPlacement(el, next);
			};
			const onUp = async () => {
				window.removeEventListener("pointermove", onMove);
				window.removeEventListener("pointerup", onUp);
				this.#dragging = false;
				// The flag update re-renders the overlay on every client.
				await canvas.scene?.setFlag(MODULE_ID, "overlay", {
					x: Math.round(parseFloat(el.style.left) || 0),
					y: Math.round(parseFloat(el.style.top) || 0),
					width: Math.round(parseFloat(el.style.width) || this.#MIN_WIDTH),
					landscape: start.landscape,
				});
			};
			window.addEventListener("pointermove", onMove);
			window.addEventListener("pointerup", onUp);
		});
	}
}
