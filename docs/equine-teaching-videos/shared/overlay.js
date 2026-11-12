// Disclosures that overlay the page (the header provenance, the local-file
// indicator and .menu lists) behave like other overlays: Escape closes them and
// returns focus to their summary, a click outside closes them, and choosing a
// menu item closes the menu. Native <details> handles opening and the keyboard toggle.
const OVERLAYS = 'details.provenance, details.local-file, details.menu';

// Open overlays in opening order, so Escape can return focus to the latest one
// even after a click inside its panel has moved focus to the page body.
const opened = [];

document.addEventListener('toggle', (event) => {
  const details = event.target;
  if (!(details instanceof HTMLDetailsElement) || !details.matches(OVERLAYS)) return;
  const at = opened.indexOf(details);
  if (at >= 0) opened.splice(at, 1);
  if (details.open) opened.push(details);
  if (details.open && details.matches('details.local-file, details.menu')) keepInView(details.querySelector(':scope > :not(summary)'));
}, true);

// The local-file sentence, and on a narrow screen a menu list, opens from its
// summary's start edge, wherever the summary sits in a wrapped toolbar. When
// that would cross the viewport's end edge, the panel is
// shifted back by the overflow, as far as the start edge allows (base.css caps
// its width to the viewport).
function keepInView(panel) {
  if (!panel) return;
  panel.style.insetInlineStart = '';
  const rect = panel.getBoundingClientRect();
  const width = document.documentElement.clientWidth;
  const overflow = rect.right - (width - EDGE_GAP);
  if (overflow > 0) panel.style.insetInlineStart = `${-Math.min(overflow, rect.left - EDGE_GAP)}px`;
}

function close(details, focusSummary) {
  details.open = false;
  if (focusSummary) details.querySelector(':scope > summary')?.focus();
}

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  const details = event.target.closest?.(OVERLAYS);
  if (details?.open) {
    // Page-level Escape handlers (for example cancelling a mode) must not also fire.
    event.stopPropagation();
    close(details, true);
    return;
  }
  // Focus left the overlay without closing it, typically to the body after a
  // click on panel text. Only then does Escape close every open overlay.
  const onBody = event.target === document.body || event.target === document.documentElement;
  const open = opened.filter((d) => d.open && d.isConnected);
  if (onBody && open.length) {
    event.stopPropagation();
    for (const d of open) close(d, false);
    open.at(-1).querySelector(':scope > summary')?.focus();
  }
}, true);

document.addEventListener('click', (event) => {
  for (const details of document.querySelectorAll(`:is(${OVERLAYS})[open]`)) {
    if (!details.contains(event.target)) close(details, false);
  }
  // Runs after the item's own handler: the listener sits on the document in the bubble phase.
  const item = event.target.closest?.('details.menu .menu-list button');
  if (item) close(item.closest('details.menu'), true);
});

// Icon-button tooltips are centred under their button. Where that would cross
// the viewport edge, data-tip aligns the tooltip with the button's start or
// end, and data-tip-block="above" moves it above the button when it would
// leave the bottom of the viewport (see base.css). The size is estimated from
// the label text, since a pseudo-element cannot be measured before it shows.
const measure = document.createElement('canvas').getContext('2d');
const EDGE_GAP = 8;

function placeTooltip(button) {
  const label = button.getAttribute('aria-label');
  if (!label) return;
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
  // Upper bound of --step--1, so the estimate errs towards moving the tooltip.
  const size = 0.9375 * rem;
  measure.font = `600 ${size}px ${getComputedStyle(document.body).fontFamily}`;
  const width = document.documentElement.clientWidth;
  // The tooltip wraps at min(18rem, 100vw - 1rem) (base.css).
  const cap = Math.min(18 * rem, width - rem);
  const natural = measure.measureText(label).width + rem;
  const half = Math.min(natural, cap) / 2;
  const lines = Math.ceil(natural / cap);
  const height = lines * size * 1.35 + 0.3 * rem + 0.35 * rem;
  const rect = button.getBoundingClientRect();
  const centre = rect.left + rect.width / 2;
  const viewportHeight = document.documentElement.clientHeight;
  if (centre - half < EDGE_GAP) button.dataset.tip = 'start';
  else if (centre + half > width - EDGE_GAP) button.dataset.tip = 'end';
  else delete button.dataset.tip;
  if (rect.bottom + height > viewportHeight - EDGE_GAP && rect.top - height >= EDGE_GAP) button.dataset.tipBlock = 'above';
  else delete button.dataset.tipBlock;
}

for (const type of ['pointerover', 'focusin']) {
  document.addEventListener(type, (event) => {
    const button = event.target.closest?.('.icon-button[aria-label]');
    if (button) placeTooltip(button);
  });
}
