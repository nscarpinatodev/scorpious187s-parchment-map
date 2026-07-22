import { MODULE_ID } from "./constants.mjs";

/**
 * v15 canvas render engine (Option B), WORK IN PROGRESS.
 *
 * Renders the in-game map as a real Foundry `TileDocument` so it appears in the
 * v14 Placeables list, sorts, z-orders under tokens, and works cross-browser —
 * unlike the HUD/CSS overlay ([[ParchmentMapOverlay]]), which can never be a
 * canvas placeable. The tile is a genuine document; its mesh texture is a live
 * `PIXI.RenderTexture` we paint on the GPU and repaint on change.
 *
 * This first increment paints only the desaturated scene background to prove
 * the pipeline (real sortable tile + live texture). Frame plates, the holo/ink
 * treatment, token centring, the marker, tagged tiles, and orientation come as
 * later increments.
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
		const dim = canvas.scene.dimensions;
		const width = Math.round(dim.sceneWidth * 0.5);
		const height = Math.round((width * 2600) / 4176); // sci-fi frame ratio placeholder
		const { x, y } = canvas.stage.pivot;
		// An initial texture.src makes Foundry build the sprite mesh we hijack.
		const src = foundry.utils.getRoute(`modules/${MODULE_ID}/frames/scifi-tablet-back.png`);
		await canvas.scene.createEmbeddedDocuments("Tile", [{
			x: Math.round(x - width / 2),
			y: Math.round(y - height / 2),
			width,
			height,
			texture: { src },
			flags: { [MODULE_ID]: { [this.#FLAG]: true } },
		}]);
		console.log(`${MODULE_ID} | placed canvas map tile`);
	}

	/** GM: remove the managed map tile. */
	static async remove() {
		const tile = this.findTile();
		if (tile) await canvas.scene.deleteEmbeddedDocuments("Tile", [tile.id]);
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
	 * Paint a flagged tile's mesh from a live RenderTexture. Safe to call on any
	 * tile object; it no-ops unless the tile carries our flag and has a mesh.
	 */
	static async paint(tileObj) {
		const doc = tileObj?.document;
		if (!doc?.getFlag?.(MODULE_ID, this.#FLAG) || !tileObj.mesh) return;
		const bg = doc.parent?.background?.src ?? doc.parent?.img ?? null;
		if (!bg) return;

		const bgTex = await this.#loadTexture(bg);
		if (!bgTex?.valid) return;
		// The object may have been torn down while the texture loaded.
		if (!tileObj.mesh || tileObj.destroyed) return;

		const w = Math.max(1, Math.round(doc.width));
		const h = Math.max(1, Math.round(doc.height));

		let rt = this.#textures.get(doc.id);
		if (!rt) {
			rt = PIXI.RenderTexture.create({ width: w, height: h });
			// If PIXI's texture GC unloads it (the tile would otherwise vanish
			// after a while), drop our reference and repaint fresh.
			rt.baseTexture.once("dispose", () => {
				this.#textures.delete(doc.id);
				this.refresh();
			});
			this.#textures.set(doc.id, rt);
		} else if (rt.width !== w || rt.height !== h) {
			// Resize in place — never destroy a texture the mesh still displays,
			// or Tile._refreshSize reads the dead texture's width and throws.
			rt.resize(w, h);
		}

		// Build the frame's content off-screen and bake it into the tile texture.
		const container = new PIXI.Container();
		const sprite = new PIXI.Sprite(bgTex);
		// cover-fit the scene background into the tile for now
		const scale = Math.max(w / bgTex.width, h / bgTex.height);
		sprite.scale.set(scale);
		sprite.position.set((w - bgTex.width * scale) / 2, (h - bgTex.height * scale) / 2);
		const desat = new PIXI.filters.ColorMatrixFilter();
		desat.desaturate();
		sprite.filters = [desat];
		container.addChild(sprite);

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
			rt.destroy(true);
			this.#textures.delete(tileId);
		}
	}
}
