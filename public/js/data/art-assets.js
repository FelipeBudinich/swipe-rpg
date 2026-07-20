export const INTRO_RASTER_ART_IDS = Object.freeze([
  "intro-01-fathers-photograph",
  "intro-01-chiloe-map",
  "intro-02-eldritch-lore",
  "intro-03-crew",
  "intro-04-sanity",
  "intro-05-paths",
  "intro-06-consequences",
  "intro-07-locked-trials",
  "intro-08-departure",
]);

const INTRO_RASTER_ART_ID_SET = new Set(INTRO_RASTER_ART_IDS);

/**
 * Resolve an allowlisted authored art ID to its fixed local asset path.
 *
 * Intro scenes are generated raster artwork; chapter illustrations remain
 * script-free SVGs. Callers still validate and allowlist the ID before using
 * the returned path.
 */
export function artSourceForId(artId) {
  const extension = INTRO_RASTER_ART_ID_SET.has(artId) ? "png" : "svg";
  return `/assets/art/${artId}.${extension}`;
}
