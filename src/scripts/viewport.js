// ============================================================
// VCG — mobile explore canvas
//
// Desktop keeps the authored top-to-bottom scroll. On a phone that same
// 1280x54257 frame squashed to 0.29 is unreadable, so mobile gets a
// pan/zoom surface over the identical canvas.
//
// What separates a canvas from a zoomed web page is the motion, not the
// gestures. Three things do the work here:
//   - momentum: a flick keeps travelling and decelerates, instead of
//     stopping dead the instant a finger lifts
//   - rubber band: the surface resists past its edges and springs back,
//     so the boundary is felt rather than hit
//   - eased zoom: double tap and fly-to animate rather than jump
// It also opens at reading scale rather than fit-to-width, so the canvas
// is bigger than the screen from the first frame and there is somewhere
// to go in both axes. Fit-to-width is what makes it read as a page.
//
// One transform drives everything — translate(x, y) scale(k) on #canvas.
// x/y are in screen px, k is the scale factor.
// ============================================================

const MAX_K = 3;           // closest you can get to an artifact
const START_K = 0.9;       // reading scale: one artifact ≈ one phone width
const LOD_K = 0.25;        // below this, swap to thumbnails (.lod in CSS)
const DOUBLE_TAP_MS = 300;
const TAP_SLOP = 10;       // a "tap" that moved further than this was a pan

const FRICTION = 0.94;     // per frame; higher glides longer
const MIN_VELOCITY = 0.05; // px/ms at which a glide is called finished
const MAX_VELOCITY = 4;    // px/ms cap, so a violent flick stays controllable
const RUBBER = 0.4;        // resistance past the edge; lower is stiffer
const SPRING_MS = 380;     // spring back from an overscroll
const ZOOM_MS = 340;       // double tap and fly-to

const easeOutCubic = (t) => 1 - (1 - t) ** 3;

export function initViewport(canvas, stage) {
  const DESIGN_W = parseFloat(canvas.dataset.w);
  const DESIGN_H = parseFloat(canvas.dataset.h);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Top-level boxes with their design-space rects read once. Culling tests
  // these every frame, so keep it plain numbers rather than hitting the DOM.
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
  let fitK = 1;    // whole 1280 width visible
  let minK = 0.01; // whole canvas visible — the map of the site
  let k = START_K;
  let x = 0;
  let y = 0;
  let lod = null;
  let frame = 0;
  let glide = 0;   // rAF handle for momentum / spring / zoom animation

  const clampK = (v) => Math.min(MAX_K, Math.max(minK, v));

  /** Where the canvas may sit at the current scale, before rubber banding. */
  function bounds() {
    const vw = stage.clientWidth;
    const vh = stage.clientHeight;
    const cw = DESIGN_W * k;
    const ch = contentH * k;
    // Narrower or shorter than the viewport: centre it rather than let it drift.
    return {
      minX: cw <= vw ? (vw - cw) / 2 : vw - cw,
      maxX: cw <= vw ? (vw - cw) / 2 : 0,
      minY: ch <= vh ? (vh - ch) / 2 : vh - ch,
      maxY: ch <= vh ? (vh - ch) / 2 : 0,
    };
  }

  const clampTo = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  /** Past an edge, movement is damped instead of blocked — the rubber band. */
  function rubberBand(v, lo, hi) {
    if (v < lo) return lo - (lo - v) * RUBBER;
    if (v > hi) return hi + (v - hi) * RUBBER;
    return v;
  }

  function overshoot() {
    const b = bounds();
    return {
      dx: clampTo(x, b.minX, b.maxX) - x,
      dy: clampTo(y, b.minY, b.maxY) - y,
    };
  }

  function apply() {
    canvas.style.transform = `translate(${x}px, ${y}px) scale(${k})`;

    const nextLod = k < LOD_K;
    if (nextLod !== lod) {
      lod = nextLod;
      canvas.classList.toggle('lod', lod);
    }
    // Below fit-width the canvas reads as a map, and a tap flies you in.
    stage.classList.toggle('map', k < fitK * 0.98);

    // Cull: hide top-level boxes outside the viewport. 173 rect tests beats
    // making the compositor deal with 3650 off-screen nodes.
    const vw = stage.clientWidth;
    const vh = stage.clientHeight;
    const m = 200;
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
      apply();
    });
  }

  const stopGlide = () => { cancelAnimationFrame(glide); glide = 0; };

  /** Zoom about a fixed screen point, so content under the fingers stays put. */
  function zoomTo(nextK, cx, cy) {
    const kk = clampK(nextK);
    if (kk === k) return;
    x = cx - (cx - x) * (kk / k);
    y = cy - (cy - y) * (kk / k);
    k = kk;
    schedule();
  }

  /** Ease to an explicit transform — double tap, fly-to, spring back. */
  function animateTo(tk, tx, ty, ms = ZOOM_MS) {
    stopGlide();
    if (reduceMotion || ms <= 0) {
      k = tk; x = tx; y = ty;
      schedule();
      return;
    }
    const k0 = k, x0 = x, y0 = y;
    const t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / ms);
      const e = easeOutCubic(p);
      k = k0 + (tk - k0) * e;
      x = x0 + (tx - x0) * e;
      y = y0 + (ty - y0) * e;
      apply();
      if (p < 1) glide = requestAnimationFrame(step);
      else glide = 0;
    };
    glide = requestAnimationFrame(step);
  }

  /** Release: glide on with the flick's velocity, then settle inside bounds. */
  function releaseWithMomentum(vx, vy) {
    stopGlide();
    const settle = () => {
      const o = overshoot();
      if (o.dx || o.dy) animateTo(k, x + o.dx, y + o.dy, SPRING_MS);
    };
    const speed = Math.hypot(vx, vy);
    if (reduceMotion || speed < MIN_VELOCITY) { settle(); return; }

    let last = performance.now();
    const step = (now) => {
      const dt = Math.min(32, now - last);
      last = now;
      const b = bounds();
      x = rubberBand(x + vx * dt, b.minX, b.maxX);
      y = rubberBand(y + vy * dt, b.minY, b.maxY);
      const decay = FRICTION ** (dt / 16.67);
      vx *= decay;
      vy *= decay;
      apply();
      // Outside the bounds the band pulls back harder than momentum pushes,
      // so hand over to the spring rather than fighting it.
      const o = overshoot();
      if (Math.hypot(vx, vy) < MIN_VELOCITY || o.dx || o.dy) {
        glide = 0;
        settle();
        return;
      }
      glide = requestAnimationFrame(step);
    };
    glide = requestAnimationFrame(step);
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

  /** Open on the masthead at reading scale, against the content's left margin. */
  function home() {
    stopGlide();
    resize();
    k = clampK(START_K);
    x = -100 * k;   // design x≈100 is the layout's left margin
    y = 0;
    schedule();
  }

  /** Fly from the map into a card, centred and readable. */
  function flyTo(el) {
    const b = boxOf.get(el) || boxOf.get(el.closest?.('#canvas > *'));
    if (!b) return;
    const tk = clampK(Math.max(fitK, Math.min(1.1, stage.clientWidth / (b.w + 80))));
    const cx = (b.x + b.ox) + b.w / 2;
    const cy = (b.y + b.oy) + b.h / 2;
    animateTo(tk, stage.clientWidth / 2 - cx * tk, stage.clientHeight / 2 - cy * tk);
  }

  // ---- pointer input -------------------------------------------------
  // One pointer pans, two pinch. Pointer Events cover touch and mouse, so
  // there is no separate touch path.
  const pts = new Map();
  let pinch = null;
  let travel = 0;
  let lastTap = 0;
  let vx = 0;
  let vy = 0;
  let vt = 0;

  const mid = () => {
    const [a, b] = [...pts.values()];
    return {
      cx: (a.x + b.x) / 2,
      cy: (a.y + b.y) / 2,
      d: Math.hypot(a.x - b.x, a.y - b.y),
    };
  };

  stage.addEventListener('pointerdown', (e) => {
    stopGlide();
    // Throws if the pointer was already released; the gesture still works
    // without capture, so there is nothing to recover.
    try { stage.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) {
      travel = 0;
      vx = 0;
      vy = 0;
      vt = performance.now();
    }
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
      const now = performance.now();
      const dt = Math.max(1, now - vt);
      vt = now;
      // Smooth the velocity, or one jittery sample decides the whole glide.
      vx = clampTo(vx * 0.7 + (dx / dt) * 0.3, -MAX_VELOCITY, MAX_VELOCITY);
      vy = clampTo(vy * 0.7 + (dy / dt) * 0.3, -MAX_VELOCITY, MAX_VELOCITY);
      const b = bounds();
      x = rubberBand(x + dx, b.minX, b.maxX);
      y = rubberBand(y + dy, b.minY, b.maxY);
      schedule();
    } else if (pts.size === 2 && pinch) {
      const m = mid();
      if (pinch.d > 0) {
        x += m.cx - pinch.cx;
        y += m.cy - pinch.cy;
        pinch.cx = m.cx;
        pinch.cy = m.cy;
        zoomTo(k * (m.d / pinch.d), m.cx, m.cy);
        pinch.d = m.d;
      }
    }
  });

  /** Swallow the click that a fly-to would otherwise also trigger. */
  function eatClick() {
    stage.addEventListener('click', (c) => {
      c.stopPropagation();
      c.preventDefault();
    }, { capture: true, once: true });
  }

  const release = (e) => {
    const wasLast = pts.size === 1;
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (!wasLast) return;

    if (travel > TAP_SLOP) {
      if (!dragging()) releaseWithMomentum(vx, vy);
      return;
    }
    if (dragging()) return;

    // Zoomed out, the canvas is a map: tapping a card flies into it.
    if (k < fitK * 0.98) {
      const card = e.target.closest?.('#canvas > *');
      if (card) {
        eatClick();
        flyTo(card);
        return;
      }
    }
    // A tap meant for a folder cover is not a zoom gesture.
    if (e.target.closest?.('[data-folder]')) return;

    const now = performance.now();
    if (now - lastTap < DOUBLE_TAP_MS) {
      lastTap = 0;
      const target = k > fitK * 1.5 ? fitK : Math.max(1, fitK * 3);
      const kk = clampK(target);
      animateTo(kk, e.clientX - (e.clientX - x) * (kk / k),
        e.clientY - (e.clientY - y) * (kk / k));
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
    stopGlide();
    if (e.ctrlKey) {
      zoomTo(k * Math.exp(-e.deltaY / 200), e.clientX, e.clientY);
    } else {
      const b = bounds();
      x = clampTo(x - e.deltaX, b.minX, b.maxX);
      y = clampTo(y - e.deltaY, b.minY, b.maxY);
      schedule();
    }
  }, { passive: false });

  // Keyboard, because the canvas is the only navigation the site has.
  window.addEventListener('keydown', (e) => {
    const step = 80;
    const cx = stage.clientWidth / 2;
    const cy = stage.clientHeight / 2;
    switch (e.key) {
      case 'ArrowUp': y += step; break;
      case 'ArrowDown': y -= step; break;
      case 'ArrowLeft': x += step; break;
      case 'ArrowRight': x -= step; break;
      case '+': case '=': zoomTo(k * 1.3, cx, cy); return;
      case '-': zoomTo(k / 1.3, cx, cy); return;
      case '0': home(); return;
      default: return;
    }
    e.preventDefault();
    const b = bounds();
    x = clampTo(x, b.minX, b.maxX);
    y = clampTo(y, b.minY, b.maxY);
    schedule();
  });

  window.addEventListener('resize', resize);

  home();

  return {
    zoomTo,
    flyTo,
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
