#!/usr/bin/env python3
"""Build the shipped WebP images from the originals in assets_src/.

Figma exports images at capture resolution — a 4096px photo behind a 171px
box. Every image is resized to the largest size it is actually displayed at
(recorded in img_manifest.json by render.py) and re-encoded as WebP.

Run order:  parse.py -> render.py -> optimize_assets.py
render.py must run first; it writes the manifest this reads.
"""
import json
import os
import sys
from PIL import Image

SRC_DIR = "assets_src/images"
OUT_DIR = "src/assets/images"

# Pixels rendered per CSS pixel. 2 covers retina at 1:1. Raise to 3 if the
# mobile explore canvas looks soft when zoomed past native size — that is the
# tuning knob, and re-running is cheap.
DPR = 2
QUALITY = 82

# Second tier for the mobile explore canvas. Zoomed out far enough to see the
# whole site, every image is on screen at once — loading the full set costs
# ~11 MB, so below viewport.js's LOD threshold the thumbs are shown instead.
# Sized so the thumb is still downscaling at the LOD threshold rather than
# stretching: an artifact card is 414px, and viewport.js swaps tiers at
# k=0.25, so it renders ~104px wide there. 80px would visibly soften.
THUMB_BOX_W = 128
THUMB_QUALITY = 68


def cover_size(src_w, src_h, box_w, box_h, rendered_w):
    """Output size so the image covers its box when rendered `rendered_w` wide.

    Mirrors CSS `object-fit: cover`: scale by whichever axis needs the most
    magnification so both end up >= the box. Never upscales past the source.
    """
    if not box_w or not box_h:
        return src_w, src_h
    f = rendered_w / box_w
    scale = min(1.0, max(box_w * f / src_w, box_h * f / src_h))
    return max(1, round(src_w * scale)), max(1, round(src_h * scale))


def main():
    manifest = json.load(open("img_manifest.json"))
    ext_map = json.load(open("ext_map.json"))
    os.makedirs(OUT_DIR, exist_ok=True)

    before = after = 0
    written = []
    missing = []

    for ref, info in sorted(manifest.items()):
        key = ref[:12]
        src = os.path.join(SRC_DIR, f"img_{key}.{ext_map.get(key, 'png')}")
        if not os.path.exists(src):
            missing.append(src)
            continue

        with Image.open(src) as im:
            im.load()
            # WebP cannot store P/LA modes; normalise while keeping alpha.
            mode = "RGBA" if im.mode in ("RGBA", "LA", "PA") or (
                im.mode == "P" and "transparency" in im.info
            ) else "RGB"
            if im.mode != mode:
                im = im.convert(mode)

            out_w, out_h = cover_size(
                im.width, im.height, info["w"], info["h"], info["w"] * DPR
            )
            full = im.resize((out_w, out_h), Image.LANCZOS) if (out_w, out_h) != im.size else im
            dst = os.path.join(OUT_DIR, f"img_{key}.webp")
            full.save(dst, "WEBP", quality=QUALITY, method=6)

            t_w, t_h = cover_size(
                im.width, im.height, info["w"], info["h"], THUMB_BOX_W
            )
            thumb_dst = os.path.join(OUT_DIR, f"thumb_{key}.webp")
            im.resize((t_w, t_h), Image.LANCZOS).save(
                thumb_dst, "WEBP", quality=THUMB_QUALITY, method=6
            )

        before += os.path.getsize(src)
        after += os.path.getsize(dst) + os.path.getsize(thumb_dst)
        written.append(dst)
        print(f"  {key}  {info['w']:>5}x{info['h']:<5} -> {out_w:>5}x{out_h:<5}"
              f"  {os.path.getsize(src) / 1024:>8.0f}K -> "
              f"{os.path.getsize(dst) / 1024:>6.0f}K")

    if missing:
        print(f"\nERROR: {len(missing)} source images not found:", file=sys.stderr)
        for m in missing[:10]:
            print(f"  {m}", file=sys.stderr)
        return 1

    unused = sorted(
        f for f in os.listdir(SRC_DIR)
        if not f.startswith(".") and f[4:16] not in {r[:12] for r in manifest}
    )
    thumbs = sum(
        os.path.getsize(os.path.join(OUT_DIR, f))
        for f in os.listdir(OUT_DIR) if f.startswith("thumb_")
    )
    print(f"\n{len(written)} images written (+ {len(written)} thumbs, "
          f"{thumbs / 1048576:.2f} MB total)")
    print(f"  before: {before / 1048576:7.1f} MB")
    print(f"  after:  {after / 1048576:7.1f} MB  "
          f"({100 * (1 - after / before):.1f}% smaller)")
    if unused:
        print(f"  {len(unused)} unreferenced originals left alone: "
              f"{', '.join(unused[:4])}"
              f"{' ...' if len(unused) > 4 else ''}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
