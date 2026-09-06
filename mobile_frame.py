#!/usr/bin/env python3
"""Positions from the Figma "iPhone 16 - 7" frame.

Transcribed from the frame's CSS export. Coordinates are in that frame's own
units, where an artifact card is 364.77px; the desktop frame draws the same
card at 414.26px, so everything is multiplied by SCALE to land in the
coordinate space the rendered DOM already uses.

The frame is 2734 x 65606, and the phone window inside it ("iPhone 16 - 8",
393px wide at x=1170.5, the green overlay in the reference) covers 14% of the
width — that is the relationship the layout is built around: most of the
board sits outside the screen, either side.

Cards are listed per brand in top-to-bottom order and paired against the
desktop cards of the same brand in the same order, so no node ids are needed.
"""

# Artifact card: 414.26 (desktop) / 364.77 (phone frame).
SCALE = 414.26 / 364.77

FRAME_W = 2734.0
FRAME_H = 65606.0

# Phone window inside the frame — the green bar in the reference image.
VIEWPORT_X = 1170.5
VIEWPORT_W = 393.0

# brand -> [(x, y), ...] top to bottom. First entry of each is the cover card.
CARDS = {
    "APPLE": [
        (1184.44, 4818.66), (1080.46, 5405.49), (1431.99, 5874.11),
        (994.89, 6114.18), (943.03, 6967.95), (1402.45, 7070.22),
        (1041.96, 7514.04), (988.33, 8401.60), (1376.85, 8606.52),
        (1528.03, 9177.29), (1050.69, 9499.79), (1442.87, 10347.24),
        (991.72, 10492.06), (1339.70, 11448.48),
    ],
    "HEADSPACE": [
        (1192.70, 13101.96), (997.14, 13797.55), (1384.88, 14027.56),
        (1097.73, 14428.26), (1383.20, 14864.30), (1018.53, 14957.79),
        (1199.50, 15373.25), (948.16, 15769.46), (1371.64, 15957.92),
        (1060.40, 16230.01), (1344.82, 16629.04), (980.05, 16962.09),
    ],
    "NASA": [
        (1192.88, 17751.81), (1010.21, 18423.78), (1407.52, 18615.98),
        (1090.13, 18905.26), (1483.28, 19087.65), (936.59, 19331.73),
        (1348.18, 19506.05), (1010.21, 19925.09), (1436.29, 20080.94),
        (1085.79, 20454.35), (1460.47, 20657.53), (1011.65, 20880.96),
        (1383.20, 21098.12), (1235.32, 21524.72),
    ],
    "PLENTY": [
        (1192.62, 22353.80), (1193.67, 23048.58), (966.16, 23474.94),
        (1374.17, 23642.78), (1131.63, 24076.62), (1422.65, 24482.78),
        (1024.72, 24719.38), (1450.38, 25024.24), (956.12, 25230.87),
        (1374.61, 25483.85), (1348.23, 25943.48), (971.86, 26186.91),
        (1208.24, 26623.43),
    ],
    "PEARL": [
        (1207.09, 27489.77), (985.31, 28293.39), (1371.23, 28625.66),
        (1119.30, 29034.23), (1412.79, 29427.85), (995.96, 29608.66),
        (1366.92, 29962.86), (960.02, 30221.95), (1443.24, 30473.19),
        (1223.97, 30910.65), (907.58, 31219.66), (1424.08, 31402.05),
        (1194.32, 31893.46),
    ],
    "ONE": [
        (1193.20, 32838.31), (1010.14, 33466.84), (1396.29, 33755.55),
        (1169.55, 34173.23), (1426.90, 34590.93), (1003.98, 34704.48),
        (1364.24, 35097.59), (960.91, 35495.59), (1375.53, 35715.78),
        (1213.72, 36165.68), (1214.51, 36583.45), (974.87, 37023.33),
        (1398.61, 37228.65), (1190.78, 37613.58), (1434.43, 38024.83),
        (1024.58, 38355.58), (1350.83, 38747.61), (934.15, 39101.05),
    ],
    "AUGUR": [
        (1194.34, 39771.92), (1028.78, 40388.73), (1405.49, 40753.51),
        (1169.72, 41146.35), (1006.46, 41529.79), (1430.79, 41569.53),
        (1236.21, 41972.38), (989.44, 42391.95), (1391.89, 42516.15),
        (1123.33, 42915.60), (1439.32, 43328.84), (989.14, 43541.06),
        (1232.61, 43968.88),
    ],
    "ANALOGUE_ARTISTS": [
        (1207.30, 44767.59), (1278.88, 45427.16), (942.45, 45851.57),
        (1396.61, 45943.16), (1080.48, 46331.52), (1406.03, 46722.94),
        (1146.38, 47122.21),
    ],
    # The .xyz file/folder cards interleaved through the Apple run.
    "XYZ": [
        (1599.50, 4825.70), (1100.90, 5913.45), (965.30, 6713.26),
        (1267.53, 6571.03), (1103.94, 12572.42),
    ],
}

# The five Apple films, in the frame's own order.
VIDEOS = [
    (1262.84, 6530.88), (1254.26, 7957.82), (897.00, 9029.11),
    (1276.50, 9933.78), (1090.34, 11932.48),
]

# Text blocks, keyed by a distinctive uppercase fragment of their content.
TEXTS = {
    "ARTIFACT_000_APPLE": (1209.73, 4651.95),
    "STEVE JOBS ERA": (1227.95, 4696.51),
    "ARTIFACT_HEADSPACE": (972.09, 12987.11),
    "WORLDS FIRST MEDITATION": (999.00, 13031.66),
    "ARTIFACT_NASA": (972.01, 17636.86),
    "MARS SAMPLE RETURN": (998.92, 17681.41),
    "ARTIFACT_PLENTY": (972.01, 22234.93),
    "AUTONOMOUS AI VERTICAL": (998.92, 22279.48),
    "ARTIFACT_THE_PEARL": (972.09, 27374.97),
    "REVOLUTIONARY ORGANIC": (999.00, 27444.40),
    "PROPRIETARY TO VCG": (999.00, 28916.73),
    "ARTIFACT_ONE": (972.09, 32723.54),
    "PERIODIC TABLE OF BIOTICS": (999.00, 32768.10),
    "ARTIFACT_AUGUR": (972.09, 39657.31),
    "NATIONAL INTELLIGENCE SENSOR": (999.00, 39701.86),
    "ARTIFACT_ANALOUGE": (972.09, 44652.97),
    "CUSTOM CINEMATIC REAL TIME": (999.00, 44697.52),
    "VCG_LA": (971.86, 47993.36),
    "LINKEDIN": (988.69, 48096.83),
    "BG@VCG.XYZ": (988.69, 48124.98),
    "SG@VCG.XYZ": (988.69, 48149.63),
    "BUILDING_BELIEF": (1562.20, 4910.76),
    "TWO_BOOKS": (1100.90, 6010.22),
    "METHODOLOGY": (1267.53, 6571.03),
    "WHOLE_EARTH_ONLINE": (965.30, 6810.03),
    "PLAY_BRAIN_BOX": (1036.12, 12669.19),
    "BRYDON DORN LEARNED": (1396.84, 3109.77),
}

# The founder portraits, top to bottom.
FOUNDER_IMAGES = [
    (1665.16, 2286.48), (821.58, 2568.27), (1219.57, 2993.56),
    (905.69, 3155.68),
]

# Section rules — all full-width at the same x, listed top to bottom.
RULE_X = 907.24
RULE_YS = [
    4598.00, 5340.54, 12884.37, 13626.86, 17546.76, 18289.30,
    22140.60, 22883.58, 27281.78, 28024.32, 32627.99, 33370.54,
    39562.62, 40305.61, 44552.79, 45295.32, 47918.96,
]

NAV = (1189.84, 47918.96)


def scaled(pt):
    """Frame units -> the coordinate space the DOM is already in."""
    return pt[0] * SCALE, pt[1] * SCALE


CANVAS_W = FRAME_W * SCALE
CANVAS_H = FRAME_H * SCALE
# How much design width one phone screen covers — viewport.js opens at exactly
# this so the first frame matches the green window in the reference.
VIEWPORT_DESIGN_W = VIEWPORT_W * SCALE


if __name__ == "__main__":
    total = sum(len(v) for v in CARDS.values())
    assert total == 109, f"expected 109 branded cards, got {total}"
    assert abs(SCALE - 1.13567) < 1e-4
    print(f"canvas {CANVAS_W:.0f} x {CANVAS_H:.0f} design px")
    print(f"one phone screen = {VIEWPORT_DESIGN_W:.0f} design px "
          f"({100 * VIEWPORT_W / FRAME_W:.0f}% of the width)")
    for b, v in sorted(CARDS.items()):
        print(f"  {b:18} {len(v):3} cards")
    print(f"  {'videos':18} {len(VIDEOS):3}")
    print(f"  {'texts':18} {len(TEXTS):3}")
    print(f"  {'rules':18} {len(RULE_YS):3}")
