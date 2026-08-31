import { MODULE_ID } from "./constants.mjs";
import {
	resolveScene,
	resolveActor,
	tokenCenter,
	currentTheme,
	frameHeight,
	sceneBackground,
} from "./map-data.mjs";

/**
 * v15 canvas render engine (Option B), WORK IN PROGRESS.
 *
 * Renders the in-game map as a real Foundry `TileDocument` so it appears in the
 * v14 Placeables list, sorts, z-orders under tokens, and works cross-browser —
 * unlike the HUD/CSS overlay ([[ParchmentMapOverlay]]), which can never be a
 * canvas placeable. The tile is a genuine document; its mesh texture is a live
 * `PIXI.RenderTexture` we composite on the GPU and repaint on change.
 *
 * Composition mirrors the DOM/CSS map: back frame plate, then the scene image
 * centred on the marked token (zoomed) and clipped to the frame's screen box
 * with a per-theme treatment, then the marker, then the front frame plate over
 * the top. The holo/parchment grain + scanlines are a later increment.
 */
export class ParchmentMapCanvas {
	/** Scene-tile flag marking our managed map tile. */
	static #FLAG = "canvasMap";

	/** tileId -> RenderTexture, so we reuse/free GPU textures. */
	static #textures = new Map();

	/** Foundry's texture loader (namespaced in v13+, global in older cores). */
	static get #loadTexture() {
		return foundry.canvas?.loadTexture ?? globalThis.loadTexture;
	}

	/** The managed map TileDocument on the viewed scene, if any. */
	static findTile() {
		return canvas?.scene?.tiles.find((t) => t.getFlag(MODULE_ID, this.#FLAG)) ?? null;
	}

	/* -------------------------------------------- */
	/*  Lifecycle                                    */
	/* -------------------------------------------- */

	/** GM: create the map tile centred in the current view (or bail if present). */
	static async place() {
		if (!game.user.isGM || !canvas?.scene) return;
		if (this.findTile()) {
			ui.notifications?.info("In-Game Map tile is already on this scene.");
			return;
		}
		const theme = currentTheme();
		const dim = canvas.scene.dimensions;
		const width = Math.round(dim.sceneWidth * 0.5);
		// size to the theme frame's native aspect
		const height = Math.round(frameHeight(width, theme.nativeLandscape));
		const { x, y } = canvas.stage.pivot;
		// An initial texture.src makes Foundry build the sprite mesh we hijack.
		const src = foundry.utils.getRoute(theme.frame);
		await canvas.scene.createEmbeddedDocuments("Tile", [{
			x: Math.round(x - width / 2),
			y: Math.round(y - height / 2),
			width,
			height,
			texture: { src },
			// Seed the orientation flag to the theme's native orientation so the
			// first paint isn't treated as rotated (which stretched the frame).
			flags: { [MODULE_ID]: { [this.#FLAG]: true, landscape: theme.nativeLandscape } },
		}]);
		console.log(`${MODULE_ID} | placed canvas map tile`);
	}

	/** GM: remove the managed map tile. */
	static async remove() {
		const tile = this.findTile();
		if (tile) await canvas.scene.deleteEmbeddedDocuments("Tile", [tile.id]);
	}

	/** GM: flip the map tile between portrait and landscape (frame turns 90°,
	 *  map stays upright). Swaps the tile to the new orientation's aspect. */
	static async rotate() {
		const tile = this.findTile();
		if (!tile || !game.user.isGM) return;
		const landscape = !tile.getFlag(MODULE_ID, "landscape");
		const width = Math.round(tile.width);
		const height = Math.round(frameHeight(width, landscape));
		await tile.update({
			width,
			height,
			[`flags.${MODULE_ID}.landscape`]: landscape,
		});
	}

	/* -------------------------------------------- */
	/*  Rendering                                    */
	/* -------------------------------------------- */

	/** Repaint the managed tile, if one exists and is drawn. */
	static refresh() {
		const doc = this.findTile();
		const obj = doc ? canvas.tiles?.get(doc.id) : null;
		if (obj) this.paint(obj);
	}

	/**
	 * Composite a flagged tile's mesh from a live RenderTexture. Safe to call on
	 * any tile object; it no-ops unless the tile carries our flag and has a mesh.
	 */
	static async paint(tileObj) {
		const doc = tileObj?.document;
		if (!doc?.getFlag?.(MODULE_ID, this.#FLAG) || !tileObj.mesh) return;

		const scene = resolveScene();
		const bg = sceneBackground(scene);
		if (!bg) return;
		const theme = currentTheme();
		// Orientation: the map stays upright while the frame turns 90°.
		const landscape = !!doc.getFlag(MODULE_ID, "landscape");
		const rotated = landscape !== theme.nativeLandscape;

		const load = this.#loadTexture;
		const [bgTex, backTex, frontTex] = await Promise.all([
			load(bg),
			load(foundry.utils.getRoute(theme.frame)),
			theme.front ? load(foundry.utils.getRoute(theme.front)) : Promise.resolve(null),
		]);
		// The object may have been torn down while textures loaded.
		if (!bgTex?.valid || tileObj.destroyed || !tileObj.mesh) return;

		const w = Math.max(1, Math.round(doc.width));
		const h = Math.max(1, Math.round(doc.height));
		const rt = this.#ensureTexture(doc.id, w, h);

		// Token centre + configured zoom (same math as the DOM #layoutMap).
		const actor = resolveActor();
		const token = actor ? scene.tokens.find((t) => t.actorId === actor.id) : null;
		const { fx, fy, hasToken } = tokenCenter(scene, token);
		const zoom = game.settings.get(MODULE_ID, "zoom") || 8;

		// The frame's screen box (map area), inset from the tile edges per theme.
		// The rotated orientation uses its own inset.
		const ins = this.#parseInset(rotated ? theme.inset[1] : theme.inset[0]);
		const cx = (w * ins.left) / 100;
		const cy = (h * ins.top) / 100;
		const cw = (w * (100 - ins.left - ins.right)) / 100;
		const ch = (h * (100 - ins.top - ins.bottom)) / 100;

		const container = new PIXI.Container();

		// 1) back plate
		if (backTex?.valid) container.addChild(this.#plate(backTex, w, h, rotated));

		// 2) the map, centred on the token, clipped to the screen box
		const screen = new PIXI.Container();
		screen.position.set(cx, cy);
		const map = new PIXI.Sprite(bgTex);
		const dispW = cw * zoom;
		const dispH = dispW * (bgTex.height / bgTex.width);
		map.width = dispW;
		map.height = dispH;
		map.position.set(cw / 2 - fx * dispW, ch / 2 - fy * dispH);
		screen.addChild(map);

		if (theme.class === "theme-scifi") {
			// teal holo: luminance→#2fe4c8 ramp + the #123f39 grain multiply,
			// hard-clipped to the screen box (a display has crisp edges)
			map.filters = [this.#inkRamp([0x2f, 0xe4, 0xc8], 1.6, [1, 1, 1], 0.05)];
			const grain = new PIXI.Graphics();
			grain.beginFill(0x123f39).drawRect(0, 0, cw, ch).endFill();
			grain.blendMode = PIXI.BLEND_MODES.MULTIPLY;
			grain.alpha = 0.5;
			screen.addChild(grain);
			// CRT scanlines (multiply), the same 1-in-N dark lines as the CSS
			const scan = new PIXI.TilingSprite(this.#scanlineTexture(), cw, ch);
			scan.blendMode = PIXI.BLEND_MODES.MULTIPLY;
			scan.alpha = 0.5;
			screen.addChild(scan);
			// backlit-screen glow: bright teal centre, dark edges (CSS vignette)
			const vig = new PIXI.Sprite(
				this.#vignetteTexture(Math.max(1, Math.round(cw)), Math.max(1, Math.round(ch))),
			);
			vig.width = cw;
			vig.height = ch;
			screen.addChild(vig);
			const clip = new PIXI.Graphics();
			clip.beginFill(0xffffff).drawRect(0, 0, cw, ch).endFill();
			screen.addChild(clip);
			map.mask = clip;
		} else {
			// parchment: luminance→#b6905a ink with the #dcb97e paper multiply
			// baked in, then the map's edges feather into the surrounding paper
			const paper = this.#multiplyFactor(0xdcb97e, 0.55);
			// sat < 1 mutes the ink so the parchment reads less garish
			map.filters = [this.#inkRamp([0xb6, 0x90, 0x5a], 2.5, paper, 0.18, 0.62)];
			const mask = new PIXI.Sprite(
				this.#featherTexture(Math.max(1, Math.round(cw)), Math.max(1, Math.round(ch)), 0.12),
			);
			mask.width = cw;
			mask.height = ch;
			screen.addChild(mask);
			map.mask = mask;
		}
		container.addChild(screen);

		// 3) marker on the token (centre of the screen box, since we centre there)
		if (hasToken) {
			const marker = this.#marker(theme, Math.min(cw, ch));
			marker.position.set(cx + cw / 2, cy + ch / 2);
			container.addChild(marker);
		}

		// 4) front plate over the map (bezels that overhang the screen)
		if (frontTex?.valid) container.addChild(this.#plate(frontTex, w, h, rotated));

		canvas.app.renderer.render(container, { renderTexture: rt, clear: true });
		container.destroy({ children: true });

		// Only override the mesh's *display* texture — leave tileObj.texture as
		// the loaded placeholder so Foundry's clear/redraw/video/occlusion and
		// the drag-preview clone keep working against a valid texture.
		tileObj.mesh.texture = rt;
	}

	/**
	 * Cheaply re-apply the live texture after a Foundry refresh/redraw reset the
	 * mesh (fires often, so no re-render here — just re-point the texture). Also
	 * covers the drag preview, which shares the document id.
	 */
	static reassert(tileObj) {
		const doc = tileObj?.document;
		if (!doc?.getFlag?.(MODULE_ID, this.#FLAG) || !tileObj.mesh) return;
		const rt = this.#textures.get(doc.id);
		if (rt && !rt.destroyed && tileObj.mesh.texture !== rt) tileObj.mesh.texture = rt;
	}

	/** Free the RenderTexture for a removed tile. */
	static releaseTile(tileId) {
		const rt = this.#textures.get(tileId);
		if (rt) {
			this.#textures.delete(tileId);
			rt.destroy(true);
		}
	}

	/* -------------------------------------------- */
	/*  Helpers                                      */
	/* -------------------------------------------- */

	/** Get or (re)size the tile's live texture without destroying it in use. */
	static #ensureTexture(id, w, h) {
		let rt = this.#textures.get(id);
		if (!rt) {
			rt = PIXI.RenderTexture.create({ width: w, height: h });
			// If PIXI's texture GC unloads it (the tile would otherwise vanish
			// after a while), drop our reference and repaint fresh.
			rt.baseTexture.once("dispose", () => {
				this.#textures.delete(id);
				this.refresh();
			});
			this.#textures.set(id, rt);
		} else if (rt.width !== w || rt.height !== h) {
			rt.resize(w, h);
		}
		return rt;
	}

	/** A frame plate sprite stretched to the full tile. When rotated, the native
	 *  (portrait/landscape) artwork is turned 90° to fill the swapped tile. */
	static #plate(tex, w, h, rotated) {
		const s = new PIXI.Sprite(tex);
		if (rotated) {
			s.anchor.set(0.5);
			s.position.set(w / 2, h / 2);
			// pre-rotation dims are swapped so the 90° turn fills w×h undistorted
			s.width = h;
			s.height = w;
			s.rotation = Math.PI / 2;
		} else {
			s.width = w;
			s.height = h;
		}
		return s;
	}

	/** A colour matrix mapping each pixel's luminance onto an ink colour — the
	 *  PIXI equivalent of the CSS `grayscale(1)` + `mix-blend-mode: color`. An
	 *  optional per-channel `paper` factor folds in the flat grain multiply. */
	static #inkRamp([ir, ig, ib], gain, paper = [1, 1, 1], floor = 0, sat = 1) {
		// optionally mute the ink toward its own luminance (keeps brightness)
		if (sat !== 1) {
			const l = 0.299 * ir + 0.587 * ig + 0.114 * ib;
			ir = l + (ir - l) * sat;
			ig = l + (ig - l) * sat;
			ib = l + (ib - l) * sat;
		}
		const br = (ir / 255) * paper[0], bg = (ig / 255) * paper[1], bb = (ib / 255) * paper[2];
		const tr = br * gain, tg = bg * gain, tb = bb * gain;
		const lr = 0.299, lg = 0.587, lb = 0.114; // luminance weights
		const cm = new PIXI.filters.ColorMatrixFilter();
		// out.channel = luminance * ink.channel * gain + ink.channel * floor
		// (the floor lifts shadows toward the ink colour, lightening overall)
		cm.matrix = [
			lr * tr, lg * tr, lb * tr, 0, br * floor,
			lr * tg, lg * tg, lb * tg, 0, bg * floor,
			lr * tb, lg * tb, lb * tb, 0, bb * floor,
			0, 0, 0, 1, 0,
		];
		return cm;
	}

	/** The per-channel factor a colour at some opacity multiplies by (CSS
	 *  `background: color; mix-blend-mode: multiply; opacity: a`). */
	static #multiplyFactor(hex, a) {
		const r = ((hex >> 16) & 255) / 255;
		const g = ((hex >> 8) & 255) / 255;
		const b = (hex & 255) / 255;
		return [(1 - a) + a * r, (1 - a) + a * g, (1 - a) + a * b];
	}

	/** A cached white texture whose alpha feathers to transparent at all four
	 *  edges (fraction `fade`), used to melt the parchment map into the paper. */
	static #masks = new Map();

	static #featherTexture(w, h, fade) {
		const key = `${w}x${h}x${fade}`;
		const cached = this.#masks.get(key);
		if (cached && !cached.baseTexture?.destroyed) return cached;
		const c = document.createElement("canvas");
		c.width = w;
		c.height = h;
		const ctx = c.getContext("2d");
		ctx.fillStyle = "#fff";
		ctx.fillRect(0, 0, w, h);
		ctx.globalCompositeOperation = "destination-in";
		for (const [x0, y0, x1, y1] of [[0, 0, w, 0], [0, 0, 0, h]]) {
			const g = ctx.createLinearGradient(x0, y0, x1, y1);
			g.addColorStop(0, "rgba(0,0,0,0)");
			g.addColorStop(fade, "rgba(0,0,0,1)");
			g.addColorStop(1 - fade, "rgba(0,0,0,1)");
			g.addColorStop(1, "rgba(0,0,0,0)");
			ctx.fillStyle = g;
			ctx.fillRect(0, 0, w, h);
		}
		const tex = PIXI.Texture.from(c);
		this.#masks.set(key, tex);
		return tex;
	}

	/** A cached radial-gradient texture: faint teal glow at the centre fading to
	 *  dark teal at the edges — the sci-fi screen's backlit vignette. */
	static #vignetteTexture(w, h) {
		const key = `vig-${w}x${h}`;
		const cached = this.#masks.get(key);
		if (cached && !cached.baseTexture?.destroyed) return cached;
		const c = document.createElement("canvas");
		c.width = w;
		c.height = h;
		const ctx = c.getContext("2d");
		const cx = w * 0.5, cy = h * 0.45;
		const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.hypot(w, h) * 0.5);
		g.addColorStop(0, "rgba(155,255,240,0.32)");   // brighter, wider backlight
		g.addColorStop(0.55, "rgba(155,255,240,0)");
		g.addColorStop(0.85, "rgba(4,30,27,0.38)");
		g.addColorStop(1, "rgba(2,18,16,0.72)");
		ctx.fillStyle = g;
		ctx.fillRect(0, 0, w, h);
		const tex = PIXI.Texture.from(c);
		this.#masks.set(key, tex);
		return tex;
	}

	/** A cached tiny repeating texture: one dark row every few pixels, tiled
	 *  and multiplied over the sci-fi screen for CRT scanlines. */
	static #scanlineTexture() {
		const key = "scanlines";
		const cached = this.#masks.get(key);
		if (cached && !cached.baseTexture?.destroyed) return cached;
		const c = document.createElement("canvas");
		c.width = 4;
		c.height = 4; // power-of-two so REPEAT wrapping is safe
		const ctx = c.getContext("2d");
		ctx.fillStyle = "rgba(0,0,0,0.32)";
		ctx.fillRect(0, 0, 4, 1); // one dark line per 4px
		const tex = PIXI.Texture.from(c);
		tex.baseTexture.wrapMode = PIXI.WRAP_MODES.REPEAT;
		this.#masks.set(key, tex);
		return tex;
	}

	/** A red marker: reticle (ring + cross) for sci-fi, an X for parchment. */
	static #marker(theme, span) {
		const g = new PIXI.Graphics();
		const red = 0xff3d33;
		const r = Math.max(6, span * 0.02);
		if (theme.class === "theme-scifi") {
			g.lineStyle(Math.max(2, r * 0.28), red, 1);
			g.drawCircle(0, 0, r);
			g.moveTo(-r * 1.5, 0).lineTo(r * 1.5, 0);
			g.moveTo(0, -r * 1.5).lineTo(0, r * 1.5);
			g.beginFill(red).drawCircle(0, 0, r * 0.22).endFill();
		} else {
			g.lineStyle(Math.max(3, r * 0.45), red, 1);
			g.moveTo(-r, -r).lineTo(r, r);
			g.moveTo(-r, r).lineTo(r, -r);
		}
		return g;
	}

	/** Parse a CSS inset shorthand ("7% 4.5% 5%") to {top,right,bottom,left} %. */
	static #parseInset(str) {
		const v = String(str).trim().split(/\s+/).map((s) => parseFloat(s) || 0);
		const [a, b, c, d] = v;
		if (v.length === 1) return { top: a, right: a, bottom: a, left: a };
		if (v.length === 2) return { top: a, right: b, bottom: a, left: b };
		if (v.length === 3) return { top: a, right: b, bottom: c, left: b };
		return { top: a, right: b, bottom: c, left: d };
	}
}
