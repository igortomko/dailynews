"""Shape Bodoni Moda with HarfBuzz and export editable SVG contours."""
import io
import json
from pathlib import Path
from xml.etree import ElementTree as ET

import uharfbuzz as hb
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.transformPen import TransformPen

BRAND = Path(__file__).resolve().parent.parent / "public" / "brand"
font = instantiateVariableFont(TTFont(BRAND / "fonts/bodoni-moda-variable.ttf"), {"wght": 700, "opsz": 96}, inplace=False)
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

ET.register_namespace("", "http://www.w3.org/2000/svg")
reference = ET.parse(BRAND / "sources/logo-reporta-traced.svg").getroot()
red = next(element for element in reference if element.get("id") == "logo-reporta-red")
for element in red.iter():
    element.attrib.pop("id", None)
head = ET.tostring(red, encoding="unicode")
body = '<path d="M30 256 C90 245 112 158 184 154 C270 148 330 255 436 264 C516 270 551 211 609 212 C682 212 711 293 802 287 C883 280 937 207 1005 179 C1074 151 1100 178 1141 222 C1182 267 1214 238 1267 245 C1300 271 1336 281 1375 246" fill="none" stroke="#FF462A" stroke-width="37" stroke-linecap="butt"/>'
eyes = '<g fill="#FFFFFF"><circle cx="1435" cy="205" r="15"/><circle cx="1473" cy="203" r="15"/></g><g fill="#00B8EC"><circle cx="1435" cy="205" r="7"/><circle cx="1473" cy="203" r="7"/></g>'
snake_content = f'{body}<g clip-path="url(#head-clip)">{head}</g>{eyes}'
snake = f'<g id="snake">{snake_content}</g>'
weave = ''
for first, last in [(2, 3), (5, 5)]:
    left = x + (bounds[first - 1][2] + bounds[first][0]) / 2 * scale
    right = x + (bounds[last][2] + bounds[last + 1][0]) / 2 * scale
    weave += f'<rect x="{left:.4f}" y="0" width="{right - left:.4f}" height="434"/>'
defs = f'<defs><clipPath id="head-clip"><rect x="1350" y="150" width="165" height="145"/></clipPath><clipPath id="weave">{weave}</clipPath></defs>'
open_svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1529" height="434" viewBox="0 0 1529 434" role="img" aria-labelledby="title"><title id="title">Reporta</title>'
letters = f'<g id="wordmark-bodoni-moda" fill="#080808" transform="{transform}">{"".join(paths)}</g>'
logo = f'{open_svg}{defs}{snake}{letters}<g clip-path="url(#weave)">{snake_content}</g></svg>\n'
(BRAND / "logo-reporta.svg").write_text(logo)
(BRAND / "logo-reporta-dark.svg").write_text(logo.replace('fill="#080808"', 'fill="#F5F5F2"'))
(BRAND / "snake-reporta.svg").write_text(f'{open_svg}{defs}{snake}</svg>\n')
report = {"font": "Bodoni Moda", "weight": 700, "opticalSize": 96, "text": "Reporta", "shaper": "HarfBuzz", "unitsPerEm": face.upem, "pairPositioning": positions, "tracking": 0, "outlines": True, "note": "Native font kerning retained. Wordmark is newly typeset; snake body reconstructed as a continuous Bezier, head traced from approved reference."}
(BRAND / "wordmark-spec.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
print(json.dumps(report, ensure_ascii=False))
