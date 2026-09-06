// ============================================================
// VCG — the canvas transform
//
// Everything the phone shows is one transform on #canvas:
//   translate(x, y) scale(k)
// This module owns that transform and the motion around it — rubber
// banding at the edges, momentum after a flick, eased zoom, culling.
//
// It listens for no pointer events. input.js is the single gesture
// recogniser and drives this through panBy / zoomAt / fling. Two
// listeners fighting over the same finger is what made the canvas feel
// unpredictable, so there is only one, and it is not here.
// ============================================================

const MAX_K = 3;           // closest you can get to an artifact
const START_K = 0.9;       // reading scale: one artifact ≈ one phone width
const LOD_K = 0.25;        // below this, swap to thumbnails (.lod in CSS)

const FRICTION = 0.94;     // per frame; higher glides longer
const MIN_VELOCITY = 0.05; // px/ms at which a glide is finished
const MAX_VELOCITY = 4;    // px/ms cap, so a violent flick stays controllable
const RUBBER = 0.4;        // resistance past the edge; lower is stiffer
const SPRING_MS = 380;     // spring back from an overscroll
const ZOOM_MS = 340;       // double tap and fly-to
// A pinch may push past the zoom limits and springs back on release. Without
// this the pinch simply stops dead at the limit while fingers keep moving,
// which is most of what reads as the zoom being inconsistent.
const ZOOM_OVERSHOOT = 1.6;
const ZOOM_SETTLE_MS = 260;

const easeOutCubic = (t) => 1 - (1 - t) ** 3;
const clampTo = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function createViewport(canvas, stage) {
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
  let anim = 0;    // rAF handle for momentum / spring / zoom

  const clampK = (v) => Math.min(MAX_K, Math.max(minK, v));

  /** Where the canvas may sit at the current scale, before rubber banding. */
  function bounds() {
    const vw = stage.clientWidth;
    const vh = stage.clientHeight;
    const cw = DESIGN_W * k;
    const ch = contentH * k;
    // Narrower or shorter than the viewport: centre rather than let it drift.
    return {
      minX: cw <= vw ? (vw - cw) / 2 : vw - cw,
      maxX: cw <= vw ? (vw - cw) / 2 : 0,
      minY: ch <= vh ? (vh - ch) / 2 : vh - ch,
      maxY: ch <= vh ? (vh - ch) / 2 : 0,
    };
  }

  /** Past an edge, movement is damped rather than blocked — the rubber band. */
  function band(v, lo, hi) {
    if (v < lo) return lo - (lo - v) * RUBBER;
    if (v > hi) return hi + (v - hi) * RUBBER;
    return v;
  }

  function overshoot() {
    const b = bounds();
    return { dx: clampTo(x, b.minX, b.maxX) - x, dy: clampTo(y, b.minY, b.maxY) - y };
  }

  function apply() {
    canvas.style.transform = `translate(${x}px, ${y}px) scale(${k})`;

    const nextLod = k < LOD_K;
    if (nextLod !== lod) {
      lod = nextLod;
      canvas.classList.toggle('lod', lod);
    }
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
    frame = requestAnimationFrame(() => { frame = 0; apply(); });
  }

  function stopAnimations() {
    cancelAnimationFrame(anim);
    anim = 0;
  }

  /** Ease to an explicit transform — double tap, fly-to, spring back. */
  function animateTo(tk, tx, ty, ms = ZOOM_MS) {
    stopAnimations();
    if (reduceMotion || ms <= 0) {
      k = tk; x = tx; y = ty;
      schedule();
      return;
    }
    const k0 = k; const x0 = x; const y0 = y;
    const t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / ms);
      const e = easeOutCubic(p);
      k = k0 + (tk - k0) * e;
      x = x0 + (tx - x0) * e;
      y = y0 + (ty - y0) * e;
      apply();
      anim = p < 1 ? requestAnimationFrame(step) : 0;
    };
    anim = requestAnimationFrame(step);
  }

  /** End-of-gesture cleanup: bring both the zoom and the pan back in range.
      Every terminal path routes through here, so a gesture cannot be left
      overscrolled or past a zoom limit however it happened to finish. */
  function settle(cx = stage.clientWidth / 2, cy = stage.clientHeight / 2) {
    const kk = clampK(k);
    let tx = x;
    let ty = y;
    if (kk !== k) {
      tx = cx - (cx - x) * (kk / k);
      ty = cy - (cy - y) * (kk / k);
    }
    // Measure the pan overshoot as it will be *after* the zoom snaps back,
    // so one animation lands both corrections.
    const k0 = k; const x0 = x; const y0 = y;
    k = kk; x = tx; y = ty;
    const o = overshoot();
    k = k0; x = x0; y = y0;

    if (kk === k0 && !o.dx && !o.dy) return;
    animateTo(kk, tx + o.dx, ty + o.dy, kk === k0 ? SPRING_MS : ZOOM_SETTLE_MS);
  }

  // These three are declared as plain functions rather than methods: they get
  // handed around as bare callbacks (folders' onToggle, the resize listener),
  // and a detached method would lose `this`.
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

  /** Open on the masthead at reading scale, against the left margin. */
  function home() {
    stopAnimations();
    resize();
    k = clampK(START_K);
    x = -100 * k;   // design x≈100 is the layout's left margin
    y = 0;
    schedule();
  }

  return {
    // ---- state ----
    getScale: () => k,
    getFitScale: () => fitK,
    isMap: () => k < fitK * 0.98,
    stopAnimations,
    refresh: schedule,

    // ---- gesture primitives, called by input.js ----
    panBy(dx, dy) {
      const b = bounds();
      x = band(x + dx, b.minX, b.maxX);
      y = band(y + dy, b.minY, b.maxY);
      schedule();
    },

    /** Translate with no edge resistance. A pinch drives pan and zoom in the
        same frame, and banding the pan mid-pinch drags the anchor point off
        the fingers — the zoom then slides instead of pivoting. */
    panRaw(dx, dy) {
      x += dx;
      y += dy;
      schedule();
    },

    /** Zoom about a fixed screen point, so content under the fingers stays.
        `soft` lets a live pinch run past the limits; settleZoom brings it back. */
    zoomAt(nextK, cx, cy, soft = false) {
      const lo = soft ? minK / ZOOM_OVERSHOOT : minK;
      const hi = soft ? MAX_K * ZOOM_OVERSHOOT : MAX_K;
      const kk = Math.min(hi, Math.max(lo, nextK));
      if (kk === k) return;
      x = cx - (cx - x) * (kk / k);
      y = cy - (cy - y) * (kk / k);
      k = kk;
      schedule();
    },

    settle,

    /** Carry the flick's velocity on with friction, then settle. */
    fling(vx, vy) {
      stopAnimations();
      const speed = Math.hypot(vx, vy);
      if (reduceMotion || speed < MIN_VELOCITY) { settle(); return; }
      let ivx = clampTo(vx, -MAX_VELOCITY, MAX_VELOCITY);
      let ivy = clampTo(vy, -MAX_VELOCITY, MAX_VELOCITY);
      let last = performance.now();
      const step = (now) => {
        const dt = Math.min(32, now - last);
        last = now;
        const b = bounds();
        x = band(x + ivx * dt, b.minX, b.maxX);
        y = band(y + ivy * dt, b.minY, b.maxY);
        const decay = FRICTION ** (dt / 16.67);
        ivx *= decay;
        ivy *= decay;
        apply();
        // Outside the bounds the band pulls harder than momentum pushes, so
        // hand over to the spring rather than fighting it.
        const o = overshoot();
        if (Math.hypot(ivx, ivy) < MIN_VELOCITY || o.dx || o.dy) {
          anim = 0;
          settle();
          return;
        }
        anim = requestAnimationFrame(step);
      };
      anim = requestAnimationFrame(step);
    },

    /** Double tap: toggle between fit-width and reading scale, where tapped. */
    toggleZoom(cx, cy) {
      const target = clampK(k > fitK * 1.5 ? fitK : Math.max(1, fitK * 3));
      animateTo(target, cx - (cx - x) * (target / k), cy - (cy - y) * (target / k));
    },

    /** Fly from the map into a card, centred and readable. */
    flyTo(el) {
      const b = boxOf.get(el);
      if (!b) return;
      const tk = clampK(Math.max(fitK, Math.min(1.1, stage.clientWidth / (b.w + 80))));
      const cx = (b.x + b.ox) + b.w / 2;
      const cy = (b.y + b.oy) + b.h / 2;
      animateTo(tk, stage.clientWidth / 2 - cx * tk, stage.clientHeight / 2 - cy * tk);
    },

    // ---- layout ----
    resize,
    syncLayout,
    home,

    /** Keep a dragged card's cull rect in step with where it now sits. */
    notifyMoved(el, dx, dy) {
      const b = boxOf.get(el);
      if (!b) return;
      b.ox = dx;
      b.oy = dy;
      schedule();
    },
  };
}
