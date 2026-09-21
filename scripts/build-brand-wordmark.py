"""Shape DM Serif Display with optical pair corrections and export SVG contours."""
import argparse
import io
import json
from pathlib import Path

import uharfbuzz as hb
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.transformPen import TransformPen

BRAND = Path(__file__).resolve().parent.parent / "public" / "brand"
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--native-kerning", action="store_true", help="Export an uncorrected comparison at the same scale")
parser.add_argument("--output-dir", type=Path, default=BRAND)
args = parser.parse_args()
args.output_dir.mkdir(parents=True, exist_ok=True)
font = TTFont(BRAND / "fonts/dm-serif-display.ttf")
# Font units, added after native GPOS kerning; these are not global tracking.
pair_adjustments = {"Re": -6, "ep": -12, "po": -22, "or": -10, "rt": 12, "ta": -14}
text = "Reporta"
stream = io.BytesIO()
font.save(stream)
face = hb.Face(stream.getvalue())
shaper = hb.Font(face)
shaper.scale = (face.upem, face.upem)
buffer = hb.Buffer()
buffer.add_str(text)
buffer.guess_segment_properties()
hb.shape(shaper, buffer, {"kern": True, "liga": False})
glyph_set = font.getGlyphSet()
order = font.getGlyphOrder()
paths = []
bounds = []
positions = []
cursor = 0
for index, (char, glyph, position) in enumerate(zip(text, buffer.glyph_infos, buffer.glyph_positions)):
    name = order[glyph.codepoint]
    offset = cursor + position.x_offset
    pen = SVGPathPen(glyph_set)
    glyph_set[name].draw(TransformPen(pen, (1, 0, 0, 1, offset, position.y_offset)))
    bound_pen = BoundsPen(glyph_set)
    glyph_set[name].draw(TransformPen(bound_pen, (1, 0, 0, 1, offset, position.y_offset)))
    paths.append(f'<path id="letter-{len(paths)}-{char}" d="{pen.getCommands()}"/>')
    bounds.append(bound_pen.bounds)
    pair = text[index:index + 2]
    adjustment = 0 if args.native_kerning else pair_adjustments.get(pair, 0)
    positions.append({"letter": char, "pair": pair if len(pair) == 2 else None, "advance": position.x_advance + adjustment, "nominalAdvance": font["hmtx"][name][0], "nativeKerning": position.x_advance - font["hmtx"][name][0], "opticalAdjustment": adjustment})
    cursor += position.x_advance + adjustment

x_min = min(b[0] for b in bounds)
x_max = max(b[2] for b in bounds)
y_min = min(b[1] for b in bounds)
y_max = max(b[3] for b in bounds)
# Keep before/after at identical type size so only pair spacing changes.
native_width = x_max - x_min - sum(p["opticalAdjustment"] for p in positions)
scale = min(1235 / native_width, 364 / (y_max - y_min))
x = 123 - x_min * scale
baseline = 34 + y_max * scale
transform = f'translate({x:.6f} {baseline:.6f}) scale({scale:.8f} {-scale:.8f})'

# Tangent-matched neck expands into an upward-facing head, like the standalone mark.
head = '<path class="snake-head" d="M1372 188.5 C1395 188.5 1399 148 1420 134 C1441 120 1461 117 1478 124 C1503 134 1505 162 1487 179 C1472 193 1450 192 1431 203 C1413 216 1392 225.5 1372 225.5 Z" fill="#FF462A"/>'
body = '<path d="M30 224 C96 212 124 125 206 125 C288 125 339 220 411 220 C485 220 522 172 582 172 C650 172 694 224 759 224 C838 224 909 133 998 124 C1060 118 1100 201 1195 207 C1290 213 1351 207 1373 207" fill="none" stroke="#FF462A" stroke-width="37" stroke-linecap="butt"/>'
eyes = '<g fill="#FFFFFF"><circle cx="1438" cy="153" r="15"/><circle cx="1473" cy="148" r="15"/></g><g fill="#00B8EC"><circle cx="1438" cy="153" r="8.5"/><circle cx="1473" cy="148" r="8.5"/></g>'
snake_content = f'{body}{head}{eyes}'
snake = f'<g id="snake">{snake_content}</g>'
weave = ''
# Enter counters behind the left stem; emerge in front of the right stroke.
for index, fraction in [(0, 0.50), (2, 0.52), (3, 0.52), (5, 0.0)]:
    left = x + (bounds[index][0] + (bounds[index][2] - bounds[index][0]) * fraction) * scale
    right = x + (bounds[index][2] + bounds[index + 1][0]) / 2 * scale
    weave += f'<rect x="{left:.4f}" y="0" width="{right - left:.4f}" height="434"/>'
defs = f'<defs><clipPath id="weave">{weave}</clipPath></defs>'
open_svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1529" height="434" viewBox="0 0 1529 434" role="img" aria-labelledby="title"><title id="title">Reporta</title>'
letters = f'<g id="wordmark-dm-serif-display" fill="#080808" transform="{transform}">{"".join(paths)}</g>'
logo = f'{open_svg}{defs}{snake}{letters}<g clip-path="url(#weave)">{snake_content}</g></svg>\n'
(args.output_dir / "logo-reporta.svg").write_text(logo)
(args.output_dir / "logo-reporta-dark.svg").write_text(logo.replace('fill="#080808"', 'fill="#F5F5F2"'))
(args.output_dir / "snake-reporta.svg").write_text(f'{open_svg}{defs}{snake}</svg>\n')
report = {"font": "DM Serif Display", "weight": 400, "text": text, "shaper": "HarfBuzz", "unitsPerEm": face.upem, "pairPositioning": positions, "tracking": 0, "opticalKerning": not args.native_kerning, "outlines": True, "note": "User-selected DM Serif Display Regular with manual pair adjustments added to native kerning. Comparisons share the same type scale. No synthetic bold or nonuniform scaling. Snake flows through R, p and o counters with right-stroke foreground crossings and a level exit past a. The neck expands smoothly into an upward-facing head inspired by the standalone mark; cyan eyes follow its tilt."}
(args.output_dir / "wordmark-spec.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
print(json.dumps(report, ensure_ascii=False))
