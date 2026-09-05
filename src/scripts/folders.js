// ============================================================
// VCG — brand folders
//
// Each artifact captions itself with its brand, so render.py can group them
// without a hand-maintained map: every card carries data-brand, and the
// topmost card of each brand carries data-folder and acts as the cover.
//
// Tapping a cover shows or hides the rest of that brand. Plain display
// toggling — the cards keep their Figma coordinates, nothing reflows.
// ============================================================

// Folders start closed, so the canvas opens as a set of brand covers and
// fills in as you open them. Flip to false to have everything visible.
const START_CLOSED = true;

export function initFolders(canvas, { onToggle } = {}) {
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

  function setOpen(brand, isOpen) {
    const cards = members.get(brand);
    if (!cards) return;
    for (const el of cards) el.classList.toggle('folded', !isOpen);
    if (isOpen) open.add(brand); else open.delete(brand);
    const cover = covers.get(brand);
    if (cover) {
      cover.classList.toggle('open', isOpen);
      cover.setAttribute('aria-expanded', String(isOpen));
    }
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
    setOpen(brand, !START_CLOSED);
  }

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
