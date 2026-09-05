// ============================================================
// VCG — mobile explore canvas
//
// Desktop keeps the authored top-to-bottom scroll. On a phone that same
// 1280x54257 frame squashed to 0.29 makes the type unreadable, so mobile
// gets a pan/zoom viewport over the identical canvas instead: pinch to
// zoom, drag to pan, zoom right out for a map of the whole site.
//
// One transform drives everything — translate(x, y) scale(k) on #canvas.
// x/y are in screen px, k is the scale factor.
// ============================================================

const MAX_K = 3;          // closest you can get to an artifact
const LOD_K = 0.25;       // below this, swap to thumbnails (see .lod in CSS)
const OVERPAN = 0.5;      // how far past the edge you may drag, as a fraction
                          // of the viewport — the rubber-band allowance
const DOUBLE_TAP_MS = 300;
const TAP_SLOP = 10;      // a "tap" that moved more than this was a pan

export function initViewport(canvas, stage) {
  const DESIGN_W = parseFloat(canvas.dataset.w);
  const DESIGN_H = parseFloat(canvas.dataset.h);

  // Top-level boxes, with their design-space rects read once. Culling tests
  // these against the viewport every frame, so keep it a plain array of
  // numbers rather than touching the DOM for geometry.
  const boxes = [...canvas.querySelectorAll(':scope > .n, :scope > video')].map(
    (el) => ({
      el,
      x: parseFloat(el.style.left) || 0,
      y: parseFloat(el.style.top) || 0,
      w: parseFloat(el.style.width) || 0,
      h: parseFloat(el.style.height) || 0,
      ox: 0,   // offset applied by dragging, in design px
      oy: 0,
      shown: true,
    }),
  );
  const boxOf = new Map(boxes.map((b) => [b.el, b]));

  // Dragging a card takes over the gesture; set by main.js once drag.js
  // exists, since the two need each other's state.
  let dragging = () => false;

  // Live content height. Folding cards away shortens the canvas, and the
  // zoomed-out floor has to follow or the map keeps framing dead space.
  let contentH = DESIGN_H;
  let fitK = 1;    // whole 1280 width visible — the composition as designed
  let minK = 0.01; // whole canvas visible — the zoomed-out map of the site
  let k = 1;
  let x = 0;
  let y = 0;
  let lod = null;
  let frame = 0;

  const clampK = (v) => Math.min(MAX_K, Math.max(minK, v));

  /** Keep the canvas from being dragged completely off screen. */
  function clampPan() {
    const vw = stage.clientWidth;
    const vh = stage.clientHeight;
    const cw = DESIGN_W * k;
    const ch = contentH * k;
    const padX = vw * OVERPAN;
    const padY = vh * OVERPAN;
    // If the canvas is narrower than the viewport, centre it rather than
    // letting it drift; otherwise bound it to its own edges plus slack.
    x = cw <= vw
      ? (vw - cw) / 2
      : Math.min(padX, Math.max(vw - cw - padX, x));
    y = ch <= vh
      ? (vh - ch) / 2
      : Math.min(padY, Math.max(vh - ch - padY, y));
  }

  function apply() {
    canvas.style.transform = `translate(${x}px, ${y}px) scale(${k})`;

    const nextLod = k < LOD_K;
    if (nextLod !== lod) {
      lod = nextLod;
      canvas.classList.toggle('lod', lod);
    }

    // Cull: hide top-level boxes outside the viewport. 173 rect tests is
    // cheaper than letting the compositor deal with 3650 off-screen nodes.
    const vw = stage.clientWidth;
    const vh = stage.clientHeight;
    const m = 200; // px of margin so nothing pops in at the edge
    for (const b of boxes) {
      const left = x + (b.x + b.ox) * k;
      const top = y + (b.y + b.oy) * k;
      const visible = left + b.w * k > -m && left < vw + m
        && top + b.h * k > -m && top < vh + m;
      if (visible !== b.shown) {
        b.shown = visible;
        b.el.style.visibility = visible ? '' : 'hidden';
      }
    }
  }

  function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      clampPan();
      apply();
    });
  }

  /** Zoom about a fixed screen point, so content under the fingers stays put. */
  function zoomTo(nextK, cx, cy) {
    const kk = clampK(nextK);
    if (kk === k) return;
    x = cx - (cx - x) * (kk / k);
    y = cy - (cy - y) * (kk / k);
    k = kk;
    schedule();
  }

  function resize() {
    fitK = Math.min(1, stage.clientWidth / DESIGN_W);
    minK = Math.min(fitK, stage.clientHeight / contentH);
    k = clampK(k);
    schedule();
  }

  /** Re-read positions after folders reflow the page. */
  function syncLayout() {
    contentH = 0;
    for (const b of boxes) {
      b.y = parseFloat(b.el.style.top) || 0;
      if (getComputedStyle(b.el).display !== 'none') {
        contentH = Math.max(contentH, b.y + b.h);
      }
    }
    contentH = Math.max(contentH, stage.clientHeight);
    resize();
  }

  /** Land on the hero at full width — the page as composed, nothing cropped. */
  function home() {
    resize();
    k = fitK;
    x = (stage.clientWidth - DESIGN_W * k) / 2;
    y = 0;
    schedule();
  }

  // ---- pointer input -------------------------------------------------
  // One pointer pans, two pinch. Pointer Events cover touch and mouse, so
  // there is no separate touch path.
  const pts = new Map();
  let pinch = null;

  const mid = () => {
    const [a, b] = [...pts.values()];
    return {
      cx: (a.x + b.x) / 2,
      cy: (a.y + b.y) / 2,
      d: Math.hypot(a.x - b.x, a.y - b.y),
    };
  };

  let travel = 0;    // distance this gesture covered, to tell tap from pan
  let lastTap = 0;

  stage.addEventListener('pointerdown', (e) => {
    // Throws if the pointer was already released; the gesture still works
    // without capture, so there is nothing to recover.
    try { stage.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) travel = 0;
    if (pts.size === 2) pinch = { ...mid(), k };
  });

  stage.addEventListener('pointermove', (e) => {
    const p = pts.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;

    travel += Math.hypot(dx, dy);

    if (pts.size === 1) {
      if (dragging()) return;   // a lifted card owns this gesture
      x += dx;
      y += dy;
      schedule();
    } else if (pts.size === 2 && pinch) {
      const m = mid();
      if (pinch.d > 0) {
        // Pan by the midpoint's movement and zoom by the spread, together.
        x += m.cx - pinch.cx;
        y += m.cy - pinch.cy;
        pinch.cx = m.cx;
        pinch.cy = m.cy;
        zoomTo(k * (m.d / pinch.d), m.cx, m.cy);
        pinch.d = m.d;
      }
    }
  });

  const release = (e) => {
    const wasLast = pts.size === 1;
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (!wasLast || travel > TAP_SLOP || dragging()) return;
    // A tap meant for a folder cover is not a zoom gesture.
    if (e.target.closest?.('[data-folder]')) return;

    // Double tap toggles between the full-width view and a readable one,
    // anchored where you tapped. The single most useful gesture on a phone.
    const now = performance.now();
    if (now - lastTap < DOUBLE_TAP_MS) {
      lastTap = 0;
      zoomTo(k > fitK * 1.5 ? fitK : Math.max(1, fitK * 3), e.clientX, e.clientY);
    } else {
      lastTap = now;
    }
  };
  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointercancel', release);

  // Trackpad and mouse wheel: ctrl+wheel is what browsers report for a
  // trackpad pinch, plain wheel pans.
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.ctrlKey) {
      zoomTo(k * Math.exp(-e.deltaY / 200), e.clientX, e.clientY);
    } else {
      x -= e.deltaX;
      y -= e.deltaY;
      schedule();
    }
  }, { passive: false });

  // Keyboard, because the canvas is the only navigation the site has.
  window.addEventListener('keydown', (e) => {
    const step = 80;
    const c = { cx: stage.clientWidth / 2, cy: stage.clientHeight / 2 };
    switch (e.key) {
      case 'ArrowUp': y += step; break;
      case 'ArrowDown': y -= step; break;
      case 'ArrowLeft': x += step; break;
      case 'ArrowRight': x -= step; break;
      case '+': case '=': zoomTo(k * 1.3, c.cx, c.cy); return;
      case '-': zoomTo(k / 1.3, c.cx, c.cy); return;
      case '0': home(); return;
      default: return;
    }
    e.preventDefault();
    schedule();
  });

  window.addEventListener('resize', resize);

  home();

  return {
    zoomTo,
    getScale: () => k,
    setDragPredicate: (fn) => { dragging = fn; },
    // Keep a dragged card's cull rect in step with where it now sits,
    // otherwise it vanishes once its original position leaves the screen.
    notifyMoved: (el, dx, dy) => {
      const b = boxOf.get(el);
      if (!b) return;
      b.ox = dx;
      b.oy = dy;
      schedule();
    },
    refresh: schedule,
    syncLayout,
    reset: home,
  };
}
