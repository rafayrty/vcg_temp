// ============================================================
// VCG — responsive canvas scaling
// The design is an exact 1:1 reproduction of the Figma "DESKTOP"
// frame (1280px wide) using absolute positioning. To stay
// responsive without a horizontal scrollbar we scale the whole
// frame to the viewport width and center it:
//   - viewport < 1280 : scale down to fit width (boxes shrink)
//   - viewport >= 1280: native size (scale 1), centered with margins
// The stage height tracks the scaled frame so vertical scrolling
// stays accurate.
// ============================================================

const canvas = document.getElementById('canvas');
const stage = document.getElementById('stage');

const DESIGN_W = parseFloat(canvas.dataset.w);
const DESIGN_H = parseFloat(canvas.dataset.h);

function fit() {
  const available = stage.clientWidth;
  const scale = Math.min(1, available / DESIGN_W);
  const scaledW = DESIGN_W * scale;
  canvas.style.transform = `scale(${scale})`;
  canvas.style.left = `${Math.max(0, (available - scaledW) / 2)}px`;
  stage.style.height = `${DESIGN_H * scale}px`;
}

fit();
window.addEventListener('resize', fit);
window.addEventListener('load', fit);

// ============================================================
// Fade-in-up on scroll for the top-level boxes.
// We only reveal the canvas's direct children (the artifact
// boxes) so nested content fades in as a group and performance
// stays smooth. IntersectionObserver works against the real
// viewport, so the scaled/transformed canvas is handled fine.
// ============================================================
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

if (!reduceMotion) {
  // The footer (black panel, dividers, contact text) sits at the very
  // bottom of the frame; it should not fade in on scroll.
  const FOOTER_Y = 53000;
  const boxes = [...canvas.querySelectorAll(':scope > .n')].filter(
    (b) => parseFloat(b.style.top || '0') < FOOTER_Y
  );

  // Compose the reveal offset with any existing inline transform so
  // rotated/translated boxes animate correctly.
  boxes.forEach((b) => {
    const base = b.style.transform ? b.style.transform + ' ' : '';
    b.dataset.baseTransform = base;
    b.style.transform = base + 'translateY(40px)';
    b.classList.add('reveal');
  });

  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        const b = entry.target;
        b.style.transform = b.dataset.baseTransform;
        b.classList.add('in');
        io.unobserve(b);
      }
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });

  boxes.forEach((b) => io.observe(b));
}
