// ============================================================
// VCG — brand folders
//
// Each artifact captions itself with its brand, so render.py can group them
// without a hand-maintained map: every card carries data-brand, and the
// topmost card of each brand carries data-folder and acts as the cover.
//
// Tapping a cover shows or hides the rest of that brand, and the page
// closes up behind it. Hiding alone is not enough: the cards are absolutely
// positioned across 54257px, so simply removing them leaves the hole they
// were sitting in — 84% of the page went blank when folders shipped without
// this. So after each toggle every card is shifted up past whatever is now
// empty, and the canvas reports its new height.
//
// Only space that *became* empty is reclaimed. The bands occupied with
// everything open are measured once at startup, and only regions inside
// those bands can be removed — so the deliberate whitespace between
// sections in the Figma layout is never touched.
// ============================================================

// Folders start open, so the site loads as the composition Figma lays out —
// closing is something the visitor chooses. Starting closed reads as a
// mostly-empty page, because the covers alone cannot carry 54000px.
const START_CLOSED = false;
// Breathing room left behind at each fold. Applied per emptied band and
// there are dozens of them, so keep it small — at 240 the leftovers added
// back over 10000px and the collapsed page still looked hollow.
const KEEP_GAP = 90;

/** Merge [start,end] pairs into sorted, non-overlapping bands. */
function merge(spans) {
  const s = spans.filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0]);
  const out = [];
  for (const [a, b] of s) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** Bands in `a` not covered by `b`; both must already be merged. */
function subtract(a, b) {
  const out = [];
  for (let [s, e] of a) {
    for (const [bs, be] of b) {
      if (be <= s || bs >= e) continue;
      if (bs > s) out.push([s, Math.min(bs, e)]);
      s = Math.max(s, be);
      if (s >= e) break;
    }
    if (s < e) out.push([s, e]);
  }
  return out;
}

/** Total length of `bands` lying above y. */
function above(bands, y) {
  let total = 0;
  for (const [s, e] of bands) {
    if (s >= y) break;
    total += Math.min(e, y) - s;
  }
  return total;
}

export function initFolders(canvas, { onToggle, reflow = false } = {}) {
  const members = new Map();   // brand -> cards that hide/show
  const covers = new Map();    // brand -> the cover card

  for (const el of canvas.querySelectorAll('[data-brand]')) {
    const brand = el.dataset.brand;
    if (el.hasAttribute('data-folder')) {
      covers.set(brand, el);
    } else {
      if (!members.has(brand)) members.set(brand, []);
      members.get(brand).push(el);
    }
  }

  const open = new Set();

  // Every top-level node, with the y it sits at in the Figma layout. All
  // shifting is computed from these, never from the current position, so
  // repeated toggles cannot drift.
  const all = [...canvas.querySelectorAll(':scope > .n, :scope > video')].map((el) => {
    const top = parseFloat(el.style.top) || 0;
    const h = parseFloat(el.style.height) || 0;
    el.dataset.baseTop = String(top);
    return { el, top, bottom: top + h };
  });
  const baseline = merge(all.map((b) => [b.top, b.bottom]));

  function applyReflow() {
    const live = merge(
      all.filter((b) => !b.el.classList.contains('folded'))
        .map((b) => [b.top, b.bottom]),
    );
    // Emptied bands, each shrunk by KEEP_GAP so folds do not butt together.
    const emptied = subtract(baseline, live)
      .map(([s, e]) => [s, Math.max(s, e - KEEP_GAP)])
      .filter(([s, e]) => e > s);

    let height = 0;
    for (const b of all) {
      const shift = above(emptied, b.top);
      b.el.style.top = `${b.top - shift}px`;
      if (!b.el.classList.contains('folded')) {
        height = Math.max(height, b.bottom - shift);
      }
    }
    canvas.style.height = `${Math.ceil(height)}px`;
  }

  function setOpen(brand, isOpen, quiet = false) {
    const cards = members.get(brand);
    if (!cards) return;
    for (const el of cards) el.classList.toggle('folded', !isOpen);
    if (isOpen) open.add(brand); else open.delete(brand);
    const cover = covers.get(brand);
    if (cover) {
      cover.classList.toggle('open', isOpen);
      cover.setAttribute('aria-expanded', String(isOpen));
    }
    if (quiet) return;
    if (reflow) applyReflow();
    if (onToggle) onToggle();
  }

  for (const brand of covers.keys()) {
    const cover = covers.get(brand);
    cover.setAttribute('role', 'button');
    cover.setAttribute('tabindex', '0');
    cover.setAttribute(
      'aria-label',
      `${brand.replace(/_/g, ' ')} — ${members.get(brand)?.length || 0} artifacts`,
    );
    setOpen(brand, !START_CLOSED, true);   // quiet: reflow once, below
  }
  if (reflow) applyReflow();
  if (onToggle) onToggle();

  canvas.addEventListener('click', (e) => {
    const cover = e.target.closest('[data-folder]');
    if (!cover) return;
    const brand = cover.dataset.brand;
    setOpen(brand, !open.has(brand));
  });

  canvas.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const cover = e.target.closest('[data-folder]');
    if (!cover) return;
    e.preventDefault();
    setOpen(cover.dataset.brand, !open.has(cover.dataset.brand));
  });

  return {
    openAll: () => covers.forEach((_, b) => setOpen(b, true)),
    closeAll: () => covers.forEach((_, b) => setOpen(b, false)),
  };
}
