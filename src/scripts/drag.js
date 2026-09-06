// ============================================================
// VCG — moving a card
//
// No event listeners live here. input.js owns the pointer stream and
// decides when a gesture is a card drag; this just moves the card.
// Two listeners racing for the same finger is what made dragging feel
// unpredictable, so there is exactly one recogniser and it is not here.
//
// Offsets go to the CSS `translate` property rather than `transform`,
// so a card that is also rotated keeps its rotation — nothing has to
// parse and recombine transform strings.
// ============================================================

export function createDragger({ onMove } = {}) {
  let card = null;
  let origin = null;   // pointer position and card offset when it lifted
  let z = 1000;

  function offsetOf(el) {
    const [dx, dy] = (el.style.translate || '').split(' ');
    return { dx: parseFloat(dx) || 0, dy: parseFloat(dy) || 0 };
  }

  return {
    isActive: () => card !== null,
    current: () => card,

    lift(el, clientX, clientY) {
      card = el;
      origin = { x: clientX, y: clientY, ...offsetOf(el) };
      el.style.zIndex = ++z;
      el.classList.add('dragging');
    },

    /** scale converts cursor travel into design px — at 0.5 the cursor
        covers twice the ground the card should. */
    moveTo(clientX, clientY, scale) {
      if (!card) return;
      const k = scale || 1;
      const dx = origin.dx + (clientX - origin.x) / k;
      const dy = origin.dy + (clientY - origin.y) / k;
      card.style.translate = `${dx}px ${dy}px`;
      if (onMove) onMove(card, dx, dy);
    },

    drop() {
      if (!card) return;
      card.classList.remove('dragging');
      card = null;
      origin = null;
    },
  };
}
