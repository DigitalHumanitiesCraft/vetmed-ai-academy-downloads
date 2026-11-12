// Markup for a symbol from the shared sprite. The sprite URL is resolved from
// this module, so callers in any case directory get a working reference.
const SPRITE = new URL('icons.svg', import.meta.url).href;

const escapeAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/**
 * @param {string} name symbol id in icons.svg
 * @param {string} [label] accessible name when the symbol carries meaning on its own;
 *   omit when visible text next to it already names the thing
 * @returns {string} SVG markup
 */
export function icon(name, label) {
  const a11y = label ? `role="img" aria-label="${escapeAttr(label)}"` : 'aria-hidden="true"';
  return `<svg class="icon" ${a11y} focusable="false"><use href="${SPRITE}#${escapeAttr(name)}"></use></svg>`;
}
