#!/usr/bin/env python3
"""Shared loader for the Figma text dump.

Both parse.py and render.py need the dump's three sections. Previously each
sliced it by hardcoded line numbers, so any re-export from Figma silently
shifted the boundaries and fed the wrong text to yaml.safe_load. Locating the
section markers keeps both scripts correct across re-exports.
"""
import yaml

DUMP = "figma-dump.txt"
MARKERS = ("GLOBAL_VARS:", "ELEMENTS:", "NODES:")


def load(path=DUMP):
    """Return (gvars, elements, node_lines) from the dump."""
    lines = open(path, encoding="utf-8").read().split("\n")
    try:
        i_g, i_e, i_n = (lines.index(m) for m in MARKERS)
    except ValueError as exc:
        raise SystemExit(f"{path}: missing section marker ({exc})") from exc
    if not i_g < i_e < i_n:
        raise SystemExit(
            f"{path}: sections out of order "
            f"(GLOBAL_VARS:{i_g + 1} ELEMENTS:{i_e + 1} NODES:{i_n + 1})"
        )
    gvars = yaml.safe_load("\n".join(lines[i_g + 1:i_e])) or {}
    elements = yaml.safe_load("\n".join(lines[i_e + 1:i_n])) or {}
    return gvars, elements, lines[i_n + 1:]


if __name__ == "__main__":
    g, e, n = load()
    assert g and e and n, "every section should be non-empty"
    assert "fill_658ab2fa" in g, "GLOBAL_VARS did not parse into the gvars dict"
    # ELEMENTS is mostly EL-* templates, plus a nested COMPONENTS block.
    assert sum(k.startswith("EL-") for k in e) > len(e) // 2, "ELEMENTS looks wrong"
    assert n[0].startswith('[FRAME] "DESKTOP"'), "NODES does not start at the root frame"
    print(f"ok — {len(g)} vars, {len(e)} elements, {len(n)} node lines")
