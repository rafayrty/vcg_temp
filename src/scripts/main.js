// ============================================================
// VCG — entry point
//
// Two experiences over one canvas:
//   desktop (>900px) — the authored top-to-bottom scroll, unchanged:
//                      the 1280px frame scaled to fit the viewport width.
//   mobile  (<=900px) — a pan/zoom explore canvas (see viewport.js). The
//                      same frame at 0.29 scale is unreadable on a phone,
//                      so it becomes something you move around instead.
// ============================================================

import { createViewport } from './viewport.js';
import { createDragger } from './drag.js';
import { initInput } from './input.js';
import { initFolders } from './folders.js';

const canvas = document.getElementById('canvas');
const stage = document.getElementById('stage');

// Desktop scale comes from fit(); on mobile the viewport owns it.
let scale = 1;

// ponytail: decided once at load. Dragging a desktop window across the
// breakpoint keeps the mode it started in; a reload switches. Not worth
// tearing down and rebuilding either mode to handle a rare resize.
const isMobile = window.matchMedia('(max-width: 900px)').matches;

if (isMobile) {
  document.body.classList.add('explore');
  const viewport = createViewport(canvas, stage);
  const dragger = createDragger({ onMove: viewport.notifyMoved });
  // One recogniser owns every pointer and routes to pan, pinch or card.
  initInput(stage, canvas, { viewport, dragger, allowPan: true, holdToDrag: true });
  // Folders are a mobile affordance only. Folding moves every card, so the
  // viewport has to re-read the layout before culling against it.
  initFolders(canvas, { reflow: true, onToggle: viewport.syncLayout });
  viewport.home();
  window.addEventListener('resize', viewport.resize);
} else {
  // Desktop keeps the authored page exactly as composed — no folding, no
  // canvas. It is one long designed scroll and sectioning it would gut it.
  initScrollMode();
  const dragger = createDragger();
  initInput(stage, canvas, {
    viewport: desktopViewportShim(),
    dragger,
    allowPan: false,        // native page scrolling stays in charge
    holdToDrag: false,      // a mouse has no ambiguity to resolve
  });
}

/** The bits of the viewport API that card dragging needs on desktop. */
function desktopViewportShim() {
  return {
    getScale: () => scale,
    stopAnimations() {},
    isMap: () => false,
    panBy() {},
    panRaw() {},
    zoomAt() {},
    settle() {},
    fling() {},
    toggleZoom() {},
    flyTo() {},
    notifyMoved() {},
  };
}

// ============================================================
// Desktop: scale the fixed-width canvas to the viewport and track the
// stage height so vertical scrolling stays accurate.
// ============================================================
function initScrollMode() {
  const DESIGN_W = parseFloat(canvas.dataset.w);
  const DESIGN_H = parseFloat(canvas.dataset.h);

  function fit() {
    const available = stage.clientWidth;
    scale = Math.min(1, available / DESIGN_W);
    canvas.style.transform = `scale(${scale})`;
    canvas.style.left = `${Math.max(0, (available - DESIGN_W * scale) / 2)}px`;
    stage.style.height = `${DESIGN_H * scale}px`;
  }

  fit();
  window.addEventListener('resize', fit);
  window.addEventListener('load', fit);

  // Fade-in-up as boxes scroll into view. Only the canvas's direct children
  // are observed, so nested content reveals as a group.
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  // The footer sits at the very bottom of the frame and should not fade in.
  const FOOTER_Y = DESIGN_H - 1300;
  const boxes = [...canvas.querySelectorAll(':scope > .n')].filter(
    (b) => parseFloat(b.style.top || '0') < FOOTER_Y,
  );

  // Compose the reveal offset with any existing inline transform so
  // rotated/translated boxes animate correctly.
  boxes.forEach((b) => {
    const base = b.style.transform ? `${b.style.transform} ` : '';
    b.dataset.baseTransform = base;
    b.style.transform = `${base}translateY(40px)`;
    b.classList.add('reveal');
  });

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const b = entry.target;
        b.style.transform = b.dataset.baseTransform;
        b.classList.add('in');
        io.unobserve(b);
      });
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.05 },
  );

  boxes.forEach((b) => io.observe(b));
}

// ============================================================
// Videos ship with preload="none" so they cost nothing until needed.
// play() is what triggers the download, so nothing is fetched until a
// video is nearly on screen; pausing off-screen keeps decoding cheap.
// ============================================================
const videos = document.querySelectorAll('video');

if (videos.length) {
  const vio = new IntersectionObserver(
    (entries) => {
      entries.forEach(({ target, isIntersecting }) => {
        if (isIntersecting) {
          // Rejects if the browser blocks autoplay; nothing to recover.
          target.play().catch(() => {});
        } else {
          target.pause();
        }
      });
    },
    { rootMargin: '200px 0px' },
  );
  videos.forEach((v) => vio.observe(v));
}
