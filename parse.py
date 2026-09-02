#!/usr/bin/env python3
"""Parse the Figma text dump into an absolutely-positioned node tree."""
import re, json, sys, yaml

DUMP = "figma-dump.txt"
lines = open(DUMP, encoding="utf-8").read().split("\n")

# section boundaries (1-based in file): GLOBAL_VARS:3, ELEMENTS:641, NODES:2274
def section(a, b):
    return "\n".join(lines[a:b])

gvars = yaml.safe_load(section(3, 640))       # after 'GLOBAL_VARS:'
elements = yaml.safe_load(section(641, 2273))  # after 'ELEMENTS:'

node_lines = lines[2273:]  # from 'NODES:' line onward (index 2273 == line 2274)

# ---------- attribute parser for a node line ----------
attr_re = re.compile(r'(\w+)=')

def parse_attrs(s):
    """Parse key=value attrs where value is JSON object/array, quoted string, or token."""
    out = {}
    i = 0
    n = len(s)
    while i < n:
        m = re.search(r'(\w+)=', s[i:])
        if not m:
            break
        key = m.group(1)
        j = i + m.end()
        if j >= n:
            break
        c = s[j]
        if c in '{[':
            # balanced JSON
            depth = 0
            k = j
            instr = False
            esc = False
            while k < n:
                ch = s[k]
                if esc:
                    esc = False
                elif ch == '\\':
                    esc = True
                elif ch == '"':
                    instr = not instr
                elif not instr:
                    if ch in '{[':
                        depth += 1
                    elif ch in '}]':
                        depth -= 1
                        if depth == 0:
                            k += 1
                            break
                k += 1
            val = s[j:k]
            try:
                out[key] = json.loads(val)
            except Exception:
                out[key] = val
            i = k
        elif c == '"':
            # quoted string (may contain escaped quotes)
            k = j + 1
            esc = False
            while k < n:
                ch = s[k]
                if esc:
                    esc = False
                elif ch == '\\':
                    esc = True
                elif ch == '"':
                    k += 1
                    break
                k += 1
            out[key] = s[j+1:k-1]
            i = k
        else:
            m2 = re.search(r'\s', s[j:])
            end = j + m2.start() if m2 else n
            out[key] = s[j:end]
            i = end
    return out

line_re = re.compile(r'^(\s*)\[([A-Z\-]+)\]\s*(?:"((?:[^"\\]|\\.)*)"\s*)?#(\d+:\d+)\s*(.*)$')

roots = []
stack = []  # (indent, node)

for ln in node_lines:
    if not ln.strip():
        continue
    m = line_re.match(ln)
    if not m:
        continue
    indent = len(m.group(1))
    typ = m.group(2)
    name = m.group(3) or ""
    nid = m.group(4)
    rest = m.group(5)
    attrs = parse_attrs(rest)
    node = {"type": typ, "name": name, "id": nid, "attrs": attrs, "children": []}
    while stack and stack[-1][0] >= indent:
        stack.pop()
    if stack:
        stack[-1][1]["children"].append(node)
    else:
        roots.append(node)
    stack.append((indent, node))

# ---------- resolve template geometry/props ----------
def resolve_layout(layout):
    """layout may be inline dict or a var name string."""
    if isinstance(layout, str):
        layout = gvars.get(layout, {})
    return layout or {}

def node_geom(node):
    """Return (x, y, w, h) local to parent, resolving templates & layout vars."""
    a = node["attrs"]
    layout = None
    if "template" in a:
        el = elements.get(a["template"], {})
        layout = el.get("layout")
    if "layout" in a:
        layout = a["layout"]
    layout = resolve_layout(layout)
    loc = layout.get("locationRelativeToParent", {}) or {}
    dims = layout.get("dimensions", {}) or {}
    return (loc.get("x", 0) or 0, loc.get("y", 0) or 0,
            dims.get("width", 0) or 0, dims.get("height", 0) or 0)

def compute_abs(node, ox, oy):
    x, y, w, h = node_geom(node)
    ax, ay = ox + x, oy + y
    node["abs"] = (ax, ay, w, h)
    for c in node["children"]:
        compute_abs(c, ax, ay)

# DESKTOP root
desktop = roots[0]
desktop["abs"] = (0, 0, 0, 0)
for c in desktop["children"]:
    compute_abs(c, 0, 0)

# ---------- bounding box ----------
minx = miny = 1e9
maxx = maxy = -1e9
def walk(n):
    global minx, miny, maxx, maxy
    ax, ay, w, h = n["abs"]
    if w and h:
        minx = min(minx, ax); miny = min(miny, ay)
        maxx = max(maxx, ax + w); maxy = max(maxy, ay + h)
    for c in n["children"]:
        walk(c)
for c in desktop["children"]:
    walk(c)

print("children:", len(desktop["children"]))
print("bbox:", round(minx), round(miny), round(maxx), round(maxy))
print("size:", round(maxx - minx), "x", round(maxy - miny))

# save resolved tree
json.dump({"tree": desktop, "bbox": [minx, miny, maxx, maxy]},
          open("tree.json", "w"))
print("saved tree.json")
