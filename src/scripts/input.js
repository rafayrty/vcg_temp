// ============================================================
// VCG — the gesture recogniser
//
// The single owner of the pointer stream. Previously the viewport and the
// card dragger each ran their own listeners on different elements and
// coordinated through a boolean, and both called setPointerCapture. A
// finger touching a card would start panning the canvas, and 400ms later
// the card would take over mid-gesture — the handoff is what made
// dragging feel unpredictable. Now one state machine reads every pointer
// and decides what the gesture is before anything moves.
//
//   idle
//    ├── pointer down on empty canvas ─────────────► pan
//    ├── pointer down on a card, mouse ────────────► card
//    └── pointer down on a card, touch ────────────► deciding
//              ├── moved past SLOP first ──────────► pan (full delta applied)
//              ├── held past HOLD_MS ──────────────► card
//              └── released without either ────────► tap
//   any state + second pointer ─────────────────────► pinch
//
// Nothing moves during `deciding`. That is the point: the canvas does not
// creep while the press is still being judged, so a lift never feels like
// a handoff from something already in motion.
// ============================================================

const HOLD_MS = 400;       // press-and-hold before a card lifts, touch only
const MOVE_SLOP = 10;      // move further than this first and it is a pan
const TAP_SLOP = 10;       // moved less than this in total: it was a tap
const DOUBLE_TAP_MS = 300;

export function initInput(stage, canvas, {
  viewport,
  dragger,
  allowPan = true,
  holdToDrag = true,
} = {}) {
  const pts = new Map();
  let mode = 'idle';
  let hold = 0;
  let pinch = null;
  let travel = 0;
  let lastTap = 0;
  let cardEl = null;
  let captured = null;
  // Velocity is smoothed; one jittery sample should not decide the glide.
  let vx = 0; let vy = 0; let vt = 0;

  const first = () => pts.values().next().value;

  function mid() {
    const [a, b] = [...pts.values()];
    return {
      cx: (a.x + b.x) / 2,
      cy: (a.y + b.y) / 2,
      d: Math.hypot(a.x - b.x, a.y - b.y),
    };
  }

  function capture(id) {
    if (captured !== null) return;
    // Throws if the pointer is already gone; the gesture still works without.
    try { stage.setPointerCapture(id); captured = id; } catch { /* ignore */ }
  }

  function releaseCapture() {
    if (captured === null) return;
    try { stage.releasePointerCapture(captured); } catch { /* ignore */ }
    captured = null;
  }

  const clearHold = () => { clearTimeout(hold); hold = 0; };

  /** Swallow the click that follows a drag or a fly-to. */
  function eatClick() {
    stage.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
    }, { capture: true, once: true });
  }

  function toPan() {
    mode = 'pan';
    vx = 0; vy = 0;
    vt = performance.now();
  }

  stage.addEventListener('pointerdown', (e) => {
    viewport.stopAnimations();
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY });

    if (pts.size === 2) {
      clearHold();
      if (mode === 'card') dragger?.drop();
      if (!allowPan) { mode = 'idle'; return; }
      mode = 'pinch';
      pinch = { ...mid(), k: viewport.getScale() };
      capture(e.pointerId);
      return;
    }
    if (pts.size > 2) return;

    travel = 0;
    cardEl = dragger ? e.target.closest?.('[data-artifact]') : null;

    if (cardEl && !holdToDrag) {
      mode = 'card';
      dragger.lift(cardEl, e.clientX, e.clientY);
      capture(e.pointerId);
    } else if (cardEl && holdToDrag) {
      // Judge the press before moving anything.
      mode = 'deciding';
      capture(e.pointerId);
      hold = setTimeout(() => {
        hold = 0;
        const p = first();
        mode = 'card';
        dragger.lift(cardEl, p ? p.x : e.clientX, p ? p.y : e.clientY);
      }, HOLD_MS);
    } else if (allowPan) {
      toPan();
      capture(e.pointerId);
    } else {
      mode = 'idle';   // desktop, off a card: leave native scrolling alone
    }
  });

  stage.addEventListener('pointermove', (e) => {
    const p = pts.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    travel += Math.hypot(dx, dy);

    if (mode === 'pinch' && pts.size >= 2 && pinch) {
      const m = mid();
      if (pinch.d > 0) {
        viewport.panBy(m.cx - pinch.cx, m.cy - pinch.cy);
        viewport.zoomAt(viewport.getScale() * (m.d / pinch.d), m.cx, m.cy);
        pinch.cx = m.cx; pinch.cy = m.cy; pinch.d = m.d;
      }
      return;
    }

    if (mode === 'deciding') {
      if (Math.hypot(e.clientX - p.x0, e.clientY - p.y0) <= MOVE_SLOP) return;
      // It is a pan after all. Apply everything since touch-down so the
      // canvas picks up exactly where the finger is — no lost travel, no jump.
      clearHold();
      if (!allowPan) { mode = 'idle'; return; }
      toPan();
      viewport.panBy(e.clientX - p.x0, e.clientY - p.y0);
      return;
    }

    if (mode === 'pan') {
      const now = performance.now();
      const dt = Math.max(1, now - vt);
      vt = now;
      vx = vx * 0.7 + (dx / dt) * 0.3;
      vy = vy * 0.7 + (dy / dt) * 0.3;
      viewport.panBy(dx, dy);
      return;
    }

    if (mode === 'card') {
      dragger.moveTo(e.clientX, e.clientY, viewport.getScale());
      e.preventDefault();
    }
  });

  function handleTap(e) {
    // From the map, a tap flies into whatever was tapped.
    if (allowPan && viewport.isMap()) {
      const card = e.target.closest?.('#canvas > *');
      if (card) { eatClick(); viewport.flyTo(card); return; }
    }
    // A tap on a folder cover belongs to folders.js, not to zoom.
    if (e.target.closest?.('[data-folder]')) return;
    if (!allowPan) return;

    const now = performance.now();
    if (now - lastTap < DOUBLE_TAP_MS) {
      lastTap = 0;
      viewport.toggleZoom(e.clientX, e.clientY);
    } else {
      lastTap = now;
    }
  }

  function end(e) {
    if (!pts.has(e.pointerId)) return;
    const wasLast = pts.size === 1;
    pts.delete(e.pointerId);

    if (!wasLast) {
      // Coming out of a pinch with a finger still down: carry on panning
      // from where that finger is, rather than jumping.
      if (mode === 'pinch' && pts.size === 1 && allowPan) {
        pinch = null;
        toPan();
      }
      return;
    }

    clearHold();
    releaseCapture();
    const finishedMode = mode;
    mode = 'idle';
    pinch = null;

    if (finishedMode === 'card') {
      dragger.drop();
      if (travel > TAP_SLOP) eatClick();
      return;
    }
    if (finishedMode === 'pinch') { viewport.settle(); return; }
    if (travel > TAP_SLOP) {
      if (finishedMode === 'pan') viewport.fling(vx, vy);
      return;
    }
    handleTap(e);
  }

  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);

  // Native drag-and-drop would otherwise start on images and text and trail
  // a ghost across the page while our own gesture runs.
  stage.addEventListener('dragstart', (e) => e.preventDefault());

  if (allowPan) {
    // ctrl+wheel is what browsers report for a trackpad pinch.
    stage.addEventListener('wheel', (e) => {
      e.preventDefault();
      viewport.stopAnimations();
      if (e.ctrlKey) {
        viewport.zoomAt(viewport.getScale() * Math.exp(-e.deltaY / 200), e.clientX, e.clientY);
      } else {
        viewport.panBy(-e.deltaX, -e.deltaY);
      }
    }, { passive: false });

    // The canvas is the only navigation the site has, so it must be reachable
    // without a pointer.
    window.addEventListener('keydown', (e) => {
      const step = 80;
      const cx = stage.clientWidth / 2;
      const cy = stage.clientHeight / 2;
      switch (e.key) {
        case 'ArrowUp': viewport.panBy(0, step); break;
        case 'ArrowDown': viewport.panBy(0, -step); break;
        case 'ArrowLeft': viewport.panBy(step, 0); break;
        case 'ArrowRight': viewport.panBy(-step, 0); break;
        case '+': case '=': viewport.zoomAt(viewport.getScale() * 1.3, cx, cy); return;
        case '-': viewport.zoomAt(viewport.getScale() / 1.3, cx, cy); return;
        case '0': viewport.home(); return;
        default: return;
      }
      e.preventDefault();
      viewport.settle();
    });
  }
}
