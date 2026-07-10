/**
 * Shared constants. Kept in a dependency-free leaf module so importing it can
 * never create an import cycle (module.mjs ⇄ ParchmentMapApp.mjs), which would
 * put these values in the temporal dead zone during load.
 */
export const MODULE_ID = "scorpious187s-parchment-map";
