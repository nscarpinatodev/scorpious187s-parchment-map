import { MODULE_ID } from "./constants.mjs";

/**
 * Shared map-view logic used by both presentations of the parchment map:
 * the ParchmentMapApp window and the ParchmentMapOverlay scene overlay.
 */

/** frames/parchment.png height/width ratio (cropped to the alpha bounds). */
export const FRAME_ASPECT = 4176 / 2779;

/** The scene the map shows: the configured one, else the currently viewed one. */
export function resolveScene() {
	const configured = game.scenes.get(game.settings.get(MODULE_ID, "sceneId"));
	return configured ?? canvas?.scene ?? null;
}

/** The actor the map centres on: the configured one, else the user's character. */
export function resolveActor() {
	const configured = game.actors.get(game.settings.get(MODULE_ID, "actorId"));
	return configured ?? game.user.character ?? null;
}

export function resolveSrc(path) {
	if (!path) return null;
	return /^https?:|^data:/i.test(path) ? path : foundry.utils.getRoute(path);
}

/** Fraction (0..1) of a token document's centre within the scene rect. */
export function tokenCenter(scene, token) {
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

/** Build the parchment-map.hbs template context shared by window and overlay. */
export function prepareMapContext() {
	const context = { moduleId: MODULE_ID };
	// Resolve to a root-absolute URL so the inline-style url() isn't broken
	// by Foundry's route prefix (a relative url() 404s otherwise).
	context.frameSrc = foundry.utils.getRoute(`modules/${MODULE_ID}/frames/parchment.png`);

	const scene = resolveScene();
	const bg = scene?.background?.src ?? scene?.img ?? null;
	if (!scene || !bg) {
		context.available = false;
		return context;
	}

	const actor = resolveActor();
	const token = actor ? scene.tokens.find((t) => t.actorId === actor.id) : null;
	const { fx, fy, hasToken } = tokenCenter(scene, token);

	context.available = true;
	context.bgSrc = resolveSrc(bg);
	context.fx = fx;
	context.fy = fy;
	context.hasToken = hasToken;
	context.actorName = actor?.name ?? "";
	context.defaultZoom = game.settings.get(MODULE_ID, "zoom") || 8;
	return context;
}

/**
 * Position a rendered map canvas inside its viewport: centre on the token,
 * then apply pan + zoom. `view.zoom === null/undefined` means "use the
 * default zoom baked into the viewport's dataset".
 */
export function layoutMapViewport(vp, view = {}) {
	const cv = vp?.querySelector(".pmap-canvas");
	const img = cv?.querySelector(".pmap-scene");
	if (!vp || !cv || !img) return;
	const panX = view.panX ?? 0;
	const panY = view.panY ?? 0;

	const apply = () => {
		const vw = vp.clientWidth;
		const vh = vp.clientHeight;
		if (!vw || !vh || !img.naturalWidth) return;
		const zoom = view.zoom ?? (parseFloat(vp.dataset.zoom) || 8);
		const fx = parseFloat(vp.dataset.fx) || 0.5;
		const fy = parseFloat(vp.dataset.fy) || 0.5;
		const dispW = vw * zoom;
		const dispH = dispW * (img.naturalHeight / img.naturalWidth);
		cv.style.width = `${dispW}px`;
		cv.style.height = `${dispH}px`;
		cv.style.left = `${vw / 2 - fx * dispW + panX}px`;
		cv.style.top = `${vh / 2 - fy * dispH + panY}px`;

		// Keep the X-marks-the-spot marker on the token as the view pans/zooms.
		const marker = vp.querySelector(".pmap-marker");
		if (marker) {
			marker.style.left = `${vw / 2 + panX}px`;
			marker.style.top = `${vh / 2 + panY}px`;
		}
	};

	if (img.complete && img.naturalWidth) apply();
	else img.addEventListener("load", apply, { once: true });
}
