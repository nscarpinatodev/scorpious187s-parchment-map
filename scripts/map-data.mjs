import { MODULE_ID } from "./constants.mjs";

/**
 * Shared map-view logic used by both presentations of the parchment map:
 * the ParchmentMapApp window and the ParchmentMapOverlay scene overlay.
 */

/**
 * Frame themes. `ar` is the frame image's native width/height. `inset` is the
 * .pmap-content inset (top right bottom left) in the native orientation and
 * in the rotated (90°) orientation. `nativeLandscape` says which way the
 * artwork lies before any rotation, so the stored "landscape" toggles mean
 * the same thing on every theme. `front` is an optional overlay plate drawn
 * on top of the map (e.g. bezels that overhang the screen).
 */
export const THEMES = {
	parchment: {
		class: "theme-parchment",
		frame: `modules/${MODULE_ID}/frames/parchment.png`,
		front: null,
		ar: 2779 / 4176,
		nativeLandscape: false,
		inset: ["7% 4.5% 5%", "4.5% 7% 4.5% 5%"],
	},
	scifi: {
		class: "theme-scifi",
		frame: `modules/${MODULE_ID}/frames/scifi-tablet-back.png`,
		front: `modules/${MODULE_ID}/frames/scifi-tablet-front.png`,
		ar: 2600 / 1734,
		nativeLandscape: true,
		inset: ["6.89% 5.23%", "5.23% 6.89%"],
	},
};

/** The configured theme, defaulting to the parchment scroll. */
export function currentTheme() {
	return THEMES[game.settings.get(MODULE_ID, "theme")] ?? THEMES.parchment;
}

/**
 * Frame height for a given width. `landscape` is the user-facing orientation
 * toggle; the artwork is rotated whenever that differs from the theme's
 * native orientation.
 */
export function frameHeight(width, landscape) {
	const theme = currentTheme();
	const rotated = !!landscape !== theme.nativeLandscape;
	const ar = rotated ? 1 / theme.ar : theme.ar;
	return width / ar;
}

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

/**
 * Build the parchment-map.hbs template context shared by window and overlay.
 * `landscape` is the caller's orientation toggle (client setting for the
 * window, scene flag for the overlay).
 */
export function prepareMapContext({ landscape = false } = {}) {
	const theme = currentTheme();
	const rotated = !!landscape !== theme.nativeLandscape;
	const context = { moduleId: MODULE_ID, themeClass: theme.class, rotated };
	// Resolve to root-absolute URLs so the inline-style url() isn't broken
	// by Foundry's route prefix (a relative url() 404s otherwise).
	const style = [
		`--pmap-frame-src:url('${foundry.utils.getRoute(theme.frame)}')`,
		`--pmap-ar:${theme.ar}`,
		`--pmap-inset:${theme.inset[0]}`,
		`--pmap-inset-rot:${theme.inset[1]}`,
	];
	if (theme.front) {
		style.push(`--pmap-front-src:url('${foundry.utils.getRoute(theme.front)}')`);
		context.hasFront = true;
	}
	context.scrollStyle = style.join(";");

	const scene = resolveScene();
	const bg = scene?.background?.src ?? scene?.img ?? null;
	if (!scene || !bg) {
		context.available = false;
		return context;
	}

	const actor = resolveActor();
	const token = actor ? scene.tokens.find((t) => t.actorId === actor.id) : null;
	const { fx, fy, hasToken } = tokenCenter(scene, token);

	// Scene tiles the GM tagged for the map ("Show on in-game map" in the
	// tile's config). Drawn inside the map canvas, so they pan/zoom and take
	// the theme treatment along with the scene image.
	const dim = scene.dimensions;
	context.tiles = scene.tiles.contents
		.filter((t) => !t.hidden && t.texture?.src && t.getFlag(MODULE_ID, "showOnMap"))
		.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || (a.elevation ?? 0) - (b.elevation ?? 0))
		.map((t) => {
			// v14 anchors tiles at texture.anchorX/Y (default 0.5 = centre);
			// v13 tiles have no anchor, i.e. 0 = top-left. x/y is where the
			// anchor sits, so shift back to the top-left corner for CSS.
			const ax = t.texture?.anchorX ?? 0;
			const ay = t.texture?.anchorY ?? 0;
			return {
				src: resolveSrc(t.texture.src),
				left: (100 * (t.x - ax * t.width - dim.sceneX)) / dim.sceneWidth,
				top: (100 * (t.y - ay * t.height - dim.sceneY)) / dim.sceneHeight,
				width: (100 * t.width) / dim.sceneWidth,
				height: (100 * t.height) / dim.sceneHeight,
				rotation: t.rotation ?? 0,
				originX: ax * 100,
				originY: ay * 100,
				alpha: t.alpha ?? 1,
			};
		});

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
