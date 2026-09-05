#!/usr/bin/env python3
"""Render the resolved Figma tree into absolutely-positioned HTML."""
import json, re, html
import figma_dump

data = json.load(open("tree.json"))
desktop = data["tree"]
gvars, elements, _ = figma_dump.load()
ext_map = json.load(open("ext_map.json"))
# Figma vector (IMAGE-SVG) nodes exported to SVG, keyed by node id.
SVG_MAP = {
    "108:3649": "footer_nav.svg",   # footer black panel + geometric mark
    "108:3921": "brain_box.svg",    # Play_Brain_Box / Quantum_Chess icon
}
# Figma boxes replaced with autoplaying <video> elements, keyed by node id.
VIDEO_MAP = {
    "108:3944": "APPLE_IPAD_MAKE_SOME_MUSIC.mp4",
    "108:3958": "APPLE_THINK_DIFFERENT.mp4",
    "108:3972": "APPLE_IPOD_TOUCH.mp4",
    "108:3986": "APPLE_IF_YOU_DONT_HAVE_AN_IPHONE.mp4",
    "108:4014": "APPLE_SIRI.mp4",
}
def img_path(ref):
    # Sources are the originals in assets_src/; the site ships WebP built from
    # them by optimize_assets.py. ext_map still maps ref -> source extension.
    return f"assets/images/img_{ref[:12]}.webp"

minx, miny, maxx, maxy = data["bbox"]
# The Figma DESKTOP frame is 1280px wide (content is centered within it:
# hero image sits at x=113 with width≈1054 → 113*2+1054≈1280). Elements
# positioned outside 0..1280 are intentional "bleed" that the frame clips.
FRAME_W = 1280
OFFX = 0            # frame origin is 0,0 — use real Figma coordinates
OFFY = 0
W = FRAME_W
H = maxy           # full scroll height of the frame

img_manifest = {}  # ref -> {node, crop, w, h}


def image_tag(ref, node, w, h, crop):
    """Record the image at its largest on-screen size and return an <img>.

    The same imageRef can be placed at several sizes; optimize_assets.py sizes
    each output from the largest, so no instance is ever upscaled.
    """
    e = img_manifest.setdefault(
        ref, {"node": node["id"], "crop": crop, "w": 0, "h": 0}
    )
    e["w"] = max(e["w"], round(w or 0))
    e["h"] = max(e["h"], round(h or 0))
    e["crop"] = e["crop"] or crop
    # Two tiers. The thumb is display:none until the mobile canvas zooms out
    # past viewport.js's LOD threshold, and lazy loading skips hidden images,
    # so neither tier costs anything until it is actually shown. Both go
    # through src= so Parcel rewrites them to hashed filenames on build.
    full = img_path(ref)
    thumb = full.replace("/img_", "/thumb_")
    return (f'<img class="fill lod-full" loading="lazy" decoding="async" '
            f'src="{full}" alt="">'
            f'<img class="fill lod-thumb" loading="lazy" decoding="async" '
            f'src="{thumb}" alt="">')

def as_list(v):
    return v if isinstance(v, list) else [v]

def resolve_fills(node):
    a = node["attrs"]
    fills = a.get("fills")
    if fills is None and "template" in a:
        fills = elements.get(a["template"], {}).get("fills")
    if isinstance(fills, str):
        fills = gvars.get(fills)
    return fills

def fill_info(fills):
    """Return ('solid', color) or ('image', ref) or None."""
    if not fills:
        return None
    lst = fills if isinstance(fills, list) else [fills]
    if not lst:
        return None
    first = lst[0]
    if isinstance(first, str) and first.startswith("#"):
        return ("solid", first)
    if isinstance(first, dict) and first.get("type") == "IMAGE":
        return ("image", first.get("imageRef"),
                first.get("imageDownloadArguments", {}).get("needsCropping", False))
    return None

def resolve_strokes(node):
    a = node["attrs"]
    st = a.get("strokes")
    if st is None and "template" in a:
        st = elements.get(a["template"], {}).get("strokes")
    if isinstance(st, str):
        st = gvars.get(st)
    if isinstance(st, list) and st and isinstance(st[0], str):
        return st[0]
    return None

def stroke_weight(node):
    a = node["attrs"]
    sw = a.get("strokeWeight")
    if sw is None and "template" in a:
        sw = elements.get(a["template"], {}).get("strokeWeight")
    if isinstance(sw, str):
        m = re.match(r"([\d.]+)", sw)
        return float(m.group(1)) if m else 1
    return sw or 1

def resolve_textstyle(node):
    a = node["attrs"]
    ts = a.get("textStyle")
    if ts is None and "template" in a:
        el = elements.get(a["template"], {})
        ts = el.get("textStyle")
    if isinstance(ts, str):
        ts = gvars.get(ts)
    return ts or {}

def resolve_text(node):
    a = node["attrs"]
    t = a.get("text")
    if t is None and "template" in a:
        t = elements.get(a["template"], {}).get("text")
    return t

def unescape(t):
    if not isinstance(t, str):
        return ""
    t = t.replace("\\n", "\n").replace("\\_", "_").replace("\\*", "*")
    t = t.replace("\\(", "(").replace("\\)", ")")
    t = t.replace("\\ ", " ").replace("\\/", "/")
    t = t.replace("\\", "")
    return t

FONT_MAP = {
    "JetBrains Mono": "'JetBrains Mono', monospace",
    "Epilogue": "'Epilogue', sans-serif",
    "Neue Haas Grotesk Display Pro": "'Inter', sans-serif",
}
def font_family(fam):
    return FONT_MAP.get(fam, "'Inter', sans-serif")

def effects_shadow(node):
    a = node["attrs"]
    ef = a.get("effects")
    if ef is None and "template" in a:
        ef = elements.get(a["template"], {}).get("effects")
    if isinstance(ef, str):
        ef = gvars.get(ef)
    if isinstance(ef, dict) and ef.get("boxShadow"):
        return ef["boxShadow"]
    return None

out = []

# The artifact cards are a uniform 414x414 in the Figma frame. Those are the
# boxes the design invites you to rearrange ("Click and drag to rearrange
# artifacts"), so only they get data-artifact — not the nav, rules or hero.
ARTIFACT_SIZE = 414
ARTIFACT_TOL = 2


def is_artifact(w, h):
    return (abs(w - ARTIFACT_SIZE) <= ARTIFACT_TOL
            and abs(h - ARTIFACT_SIZE) <= ARTIFACT_TOL)


def emit(node, pax, pay, top=False):
    """pax,pay = parent's absolute origin. Children are nested in the DOM,
    so each node is positioned RELATIVE to its parent (its real
    locationRelativeToParent), which keeps overflow:hidden clipping correct."""
    typ = node["type"]
    ax, ay, w, h = node["abs"]
    left = ax - pax
    top = ay - pay
    style = [f"left:{left:.2f}px", f"top:{top:.2f}px"]
    if w:
        style.append(f"width:{w:.2f}px")
    if h:
        style.append(f"height:{h:.2f}px")

    # Video boxes: render an autoplaying, looping, muted <video>.
    vid = VIDEO_MAP.get(node["id"])
    if vid:
        vstyle = list(style) + ["object-fit:cover"]
        # preload="none" means no bytes until main.js play()s it on scroll-in.
        out.append(
            f'<video class="n" style="{";".join(vstyle)}" '
            f'muted loop playsinline preload="none">'
            f'<source src="assets/videos/{vid}" type="video/mp4"></video>'
        )
        return

    fills = resolve_fills(node)
    fi = fill_info(fills)
    inner = ""
    cls = "n"

    shadow = effects_shadow(node)
    if shadow:
        style.append(f"box-shadow:{shadow}")

    if typ in ("FRAME", "GROUP"):
        if typ == "FRAME":
            style.append("overflow:hidden")
        if fi and fi[0] == "solid":
            style.append(f"background:{fi[1]}")
        elif fi and fi[0] == "image":
            inner = image_tag(fi[1], node, w, h, fi[2])
            if typ == "GROUP":
                style.append("overflow:hidden")
    elif typ == "RECTANGLE":
        br = node["attrs"].get("borderRadius")
        if br:
            style.append(f"border-radius:{br}")
        if fi and fi[0] == "image":
            inner = image_tag(fi[1], node, w, h, fi[2])
            style.append("overflow:hidden")
        elif fi and fi[0] == "solid":
            style.append(f"background:{fi[1]}")
        else:
            style.append("background:transparent")
    elif typ == "ELLIPSE":
        style.append("border-radius:50%")
        if fi and fi[0] == "solid":
            style.append(f"background:{fi[1]}")
        elif fi and fi[0] == "image":
            inner = image_tag(fi[1], node, w, h, fi[2])
            style.append("overflow:hidden")
    elif typ == "LINE":
        col = resolve_strokes(node) or "#000000"
        sw = stroke_weight(node)
        if (h or 0) <= 0.5:  # horizontal
            style = [f"left:{left:.2f}px", f"top:{top:.2f}px",
                     f"width:{max(w, 1):.2f}px", f"height:{sw:.2f}px",
                     f"background:{col}"]
        else:  # vertical
            style = [f"left:{left:.2f}px", f"top:{top:.2f}px",
                     f"width:{sw:.2f}px", f"height:{max(h,1):.2f}px",
                     f"background:{col}"]
    elif typ == "TEXT":
        ts = resolve_textstyle(node)
        txt = unescape(resolve_text(node))
        fi_t = fill_info(resolve_fills(node))
        color = fi_t[1] if fi_t and fi_t[0] == "solid" else "#000000"
        fam = font_family(ts.get("fontFamily", ""))
        fs = ts.get("fontSize", 14)
        fw = ts.get("fontWeight", 400)
        ls = ts.get("letterSpacing", "")
        style.append(f"font-family:{fam}")
        style.append(f"font-size:{fs:.2f}px")
        style.append(f"font-weight:{fw}")
        style.append(f"color:{color}")
        style.append("line-height:1.15")
        style.append("white-space:pre-wrap")
        # Text boxes often have tall transparent hitboxes that overlap
        # neighbours; let clicks pass through while keeping links active.
        style.append("pointer-events:none")
        if isinstance(ls, str) and ls.endswith("em"):
            style.append(f"letter-spacing:{ls}")
        elif isinstance(ls, (int, float)):
            style.append(f"letter-spacing:{ls}px")
        if ts.get("textCase") == "UPPER":
            style.append("text-transform:uppercase")
        ta = ts.get("textAlignHorizontal", "LEFT")
        if ta == "CENTER":
            style.append("text-align:center")
        elif ta == "RIGHT":
            style.append("text-align:right")
        inner = html.escape(txt)
        # Linkify email addresses as mailto: links (e.g. footer contacts).
        inner = re.sub(
            r'([A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})',
            lambda m: f'<a href="mailto:{m.group(1).lower()}" '
                      f'style="color:inherit;text-decoration:none;pointer-events:auto">{m.group(1)}</a>',
            inner,
        )
    elif typ == "IMAGE-SVG":
        # Vector nodes exported from Figma as SVG (e.g. the footer mark).
        svg = SVG_MAP.get(node["id"])
        if svg:
            style.append(f"background-image:url(assets/images/{svg})")
            style.append("background-size:contain")
            style.append("background-position:center")
            style.append("background-repeat:no-repeat")
        else:
            return
    else:
        style.append("background:transparent")

    attr = ' data-artifact' if top and is_artifact(w or 0, h or 0) else ''
    out.append(f'<div class="{cls}"{attr} style="{";".join(style)}">{inner}')
    for c in node["children"]:
        emit(c, ax, ay)
    out.append("</div>")

for c in desktop["children"]:
    emit(c, -OFFX, -OFFY, top=True)

body = "\n".join(out)

doc = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>VCG_ — The Venture Creative Group</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Epilogue:wght@400;500;700&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="styles/main.scss" />
</head>
<body>
<div class="stage" id="stage">
<div class="canvas" id="canvas" data-w="{W:.0f}" data-h="{H:.0f}" style="position:absolute;left:0;top:0;width:{W:.0f}px;height:{H:.0f}px;background:#fff;transform-origin:top left;overflow:hidden;">
{body}
</div>
</div>
<script type="module" src="scripts/main.js"></script>
</body>
</html>
"""

open("src/index.html", "w", encoding="utf-8").write(doc)
json.dump(img_manifest, open("img_manifest.json", "w"), indent=1)
print("nodes emitted:", len(out) // 2)
print("unique images:", len(img_manifest))
print("canvas:", round(W), "x", round(H))
