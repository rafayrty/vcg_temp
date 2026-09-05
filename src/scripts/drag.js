// ============================================================
// VCG — drag to rearrange artifacts
//
// "Click and drag to rearrange artifacts" is printed in the design; this
// makes it true. Only [data-artifact] boxes (the 414x414 cards) move.
//
// Offsets are written to the CSS `translate` property, not `transform`.
// `translate` composes with an existing `transform` automatically, so a
// dragged box that is also rotated, or mid scroll-reveal, keeps both — no
// transform strings to parse and recombine.
//
// Touch needs a long-press to pick a card up: the artifacts cover most of
// the canvas, so if a finger down on one started a drag you could never
// pan. Mouse has no such conflict and picks up immediately.
// ============================================================

const HOLD_MS = 350;    // long-press before a card lifts, touch only
const SLOP = 8;         // move further than this first and it's a pan
const CLICK_SLOP = 4;   // move less than this total and it was a tap

export function initDrag(canvas, { getScale, holdToDrag = false, onMove } = {}) {
  let active = null;   // the card currently being dragged
  let pending = null;  // touch gesture that may still become a drag
  let hold = 0;        // long-press timer
  let z = 1000;

  const isActive = () => active !== null;

  function offsetOf(el) {
    // Read back what we last wrote; "none" or "" on a card never dragged.
    const [dx, dy] = (el.style.translate || '').split(' ');
    return { dx: parseFloat(dx) || 0, dy: parseFloat(dy) || 0 };
  }

  function lift(g) {
    g.lifted = true;
    active = g;
    g.el.style.zIndex = ++z;
    g.el.classList.add('dragging');
  }

  function drop() {
    clearTimeout(hold);
    hold = 0;
    if (active) {
      active.el.classList.remove('dragging');
      active = null;
    }
  }

  canvas.addEventListener('pointerdown', (e) => {
    // A second pointer means a pinch is starting. Give up the gesture —
    // otherwise a pending long-press could fire mid-pinch and the card
    // would fight the zoom for the same finger movement.
    if (active || pending) {
      drop();
      pending = null;
      return;
    }

    const el = e.target.closest('[data-artifact]');
    if (!el) return;

    const start = offsetOf(el);
    const g = {
      el,
      id: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      dx0: start.dx,
      dy0: start.dy,
      moved: 0,
      lifted: false,
    };

    if (holdToDrag) {
      // Provisional: becomes a drag only if the finger stays put long
      // enough. Until then the gesture still belongs to the pan handler.
      hold = setTimeout(() => {
        hold = 0;
        // Re-anchor to where the finger is now, so the card does not jump.
        g.x0 = g.lastX ?? g.x0;
        g.y0 = g.lastY ?? g.y0;
        lift(g);
      }, HOLD_MS);
      pending = g;
    } else {
      // Throws if the pointer is already gone; the window-level listeners
      // handle the gesture either way.
      try { el.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
      lift(g);
      e.stopPropagation();
    }
  });

  function move(e) {
    const g = active || pending;
    if (!g || e.pointerId !== g.id) return;

    g.lastX = e.clientX;
    g.lastY = e.clientY;
    g.moved = Math.max(
      g.moved,
      Math.hypot(e.clientX - g.x0, e.clientY - g.y0),
    );

    if (!g.lifted) {
      // Still deciding. A real move before the hold fires means the user
      // is panning, so give the gesture up.
      if (g.moved > SLOP) {
        clearTimeout(hold);
        hold = 0;
        pending = null;
      }
      return;
    }

    // Screen px -> design px: at 0.5 zoom the cursor travels twice as far
    // as the card should.
    const k = getScale() || 1;
    const dx = g.dx0 + (e.clientX - g.x0) / k;
    const dy = g.dy0 + (e.clientY - g.y0) / k;
    g.el.style.translate = `${dx}px ${dy}px`;
    if (onMove) onMove(g.el, dx, dy);
    e.preventDefault();
  }

  function end(e) {
    const g = active || pending;
    if (!g || e.pointerId !== g.id) return;
    clearTimeout(hold);
    hold = 0;
    pending = null;
    if (g.lifted) {
      // Swallow the click that follows a real drag so it cannot also be
      // read as a tap on the card.
      if (g.moved > CLICK_SLOP) {
        canvas.addEventListener('click', (c) => c.stopPropagation(), {
          capture: true,
          once: true,
        });
      }
      drop();
    }
  }

  // Native HTML5 drag-and-drop would otherwise start on images and text and
  // trail a ghost across the page while our own drag runs.
  canvas.addEventListener('dragstart', (e) => e.preventDefault());

  // Listen on the window so a fast drag that outruns the pointer still ends
  // cleanly when the button comes up outside the canvas.
  window.addEventListener('pointermove', move, { passive: false });
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);

  return { isActive };
}
