"""Shape Literata with HarfBuzz and export editable SVG contours."""
import argparse
import io
import json
from pathlib import Path

import uharfbuzz as hb
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.transformPen import TransformPen

BRAND = Path(__file__).resolve().parent.parent / "public" / "brand"
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--weight", type=int, choices=range(200, 901), default=650)
parser.add_argument("--optical-size", type=int, choices=range(7, 73), default=18)
parser.add_argument("--output-dir", type=Path, default=BRAND)
args = parser.parse_args()
args.output_dir.mkdir(parents=True, exist_ok=True)
font = instantiateVariableFont(TTFont(BRAND / "fonts/literata-variable.ttf"), {"wght": args.weight, "opsz": args.optical_size}, inplace=False)
stream = io.BytesIO()
font.save(stream)
face = hb.Face(stream.getvalue())
shaper = hb.Font(face)
shaper.scale = (face.upem, face.upem)
buffer = hb.Buffer()
buffer.add_str("Reporta")
buffer.guess_segment_properties()
hb.shape(shaper, buffer, {"kern": True, "liga": False})
glyph_set = font.getGlyphSet()
order = font.getGlyphOrder()
paths = []
bounds = []
positions = []
cursor = 0
for char, glyph, position in zip("Reporta", buffer.glyph_infos, buffer.glyph_positions):
    name = order[glyph.codepoint]
    offset = cursor + position.x_offset
    pen = SVGPathPen(glyph_set)
    glyph_set[name].draw(TransformPen(pen, (1, 0, 0, 1, offset, position.y_offset)))
    bound_pen = BoundsPen(glyph_set)
    glyph_set[name].draw(TransformPen(bound_pen, (1, 0, 0, 1, offset, position.y_offset)))
    paths.append(f'<path id="letter-{len(paths)}-{char}" d="{pen.getCommands()}"/>')
    bounds.append(bound_pen.bounds)
    positions.append({"letter": char, "advance": position.x_advance, "nominalAdvance": font["hmtx"][name][0], "kerning": position.x_advance - font["hmtx"][name][0]})
    cursor += position.x_advance

x_min = min(b[0] for b in bounds)
x_max = max(b[2] for b in bounds)
y_min = min(b[1] for b in bounds)
y_max = max(b[3] for b in bounds)
scale = min(1235 / (x_max - x_min), 364 / (y_max - y_min))
x = 123 - x_min * scale
baseline = 34 + y_max * scale
transform = f'translate({x:.6f} {baseline:.6f}) scale({scale:.8f} {-scale:.8f})'

# Smooth curves replace the noisy traced head; eye positions stay fixed.
head = '<path d="M1408 188 C1426 169 1452 168 1469 173 C1487 178 1498 190 1498 207 C1498 229 1481 243 1459 243 C1445 243 1435 237 1421 242 C1396 246 1391 207 1408 188 Z" fill="#FF462A"/>'
body = '<path d="M30 256 C90 245 112 158 184 154 C270 148 330 255 436 264 C516 270 551 211 609 212 C682 212 711 293 802 287 C883 280 937 207 1005 179 C1074 151 1100 178 1141 222 C1182 267 1214 238 1267 245 C1300 271 1336 281 1375 246 C1403 221 1404 207 1435 207" fill="none" stroke="#FF462A" stroke-width="37" stroke-linecap="butt"/>'
eyes = '<g fill="#FFFFFF"><circle cx="1435" cy="205" r="15"/><circle cx="1473" cy="203" r="15"/></g><g fill="#00B8EC"><circle cx="1435" cy="205" r="7"/><circle cx="1473" cy="203" r="7"/></g>'
snake_content = f'{body}{head}{eyes}'
snake = f'<g id="snake">{snake_content}</g>'
weave = ''
for first, last in [(2, 3), (5, 5)]:
    left = x + (bounds[first - 1][2] + bounds[first][0]) / 2 * scale
    right = x + (bounds[last][2] + bounds[last + 1][0]) / 2 * scale
    weave += f'<rect x="{left:.4f}" y="0" width="{right - left:.4f}" height="434"/>'
defs = f'<defs><clipPath id="weave">{weave}</clipPath></defs>'
open_svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1529" height="434" viewBox="0 0 1529 434" role="img" aria-labelledby="title"><title id="title">Reporta</title>'
letters = f'<g id="wordmark-literata" fill="#080808" transform="{transform}">{"".join(paths)}</g>'
logo = f'{open_svg}{defs}{snake}{letters}<g clip-path="url(#weave)">{snake_content}</g></svg>\n'
(args.output_dir / "logo-reporta.svg").write_text(logo)
(args.output_dir / "logo-reporta-dark.svg").write_text(logo.replace('fill="#080808"', 'fill="#F5F5F2"'))
(args.output_dir / "snake-reporta.svg").write_text(f'{open_svg}{defs}{snake}</svg>\n')
report = {"font": "Literata", "weight": args.weight, "opticalSize": args.optical_size, "text": "Reporta", "shaper": "HarfBuzz", "unitsPerEm": face.upem, "pairPositioning": positions, "tracking": 0, "outlines": True, "note": "User-requested Literata trial. Native font kerning retained; no synthetic bold or nonuniform scaling. Snake body, head and cyan eyes are unchanged vector geometry."}
(args.output_dir / "wordmark-spec.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
print(json.dumps(report, ensure_ascii=False))
