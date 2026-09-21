"""Outline candidate fonts for comparison without changing the logo master."""
import io
from pathlib import Path

import uharfbuzz as hb
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.transformPen import TransformPen

root = Path(__file__).resolve().parent.parent / "public/brand/type-study"
for name in ["dm-serif-display", "prata", "libre-caslon-display"]:
    font = TTFont(root / "fonts" / f"{name}.ttf")
    stream = io.BytesIO()
    font.save(stream)
    face = hb.Face(stream.getvalue())
    shaper = hb.Font(face)
    shaper.scale = (face.upem, face.upem)
    buffer = hb.Buffer()
    buffer.add_str("Reporta")
    buffer.guess_segment_properties()
    hb.shape(shaper, buffer, {"kern": True})
    glyphs = font.getGlyphSet()
    order = font.getGlyphOrder()
    paths, bounds = [], []
    cursor = 0
    for glyph, position in zip(buffer.glyph_infos, buffer.glyph_positions):
        transform = (1, 0, 0, 1, cursor + position.x_offset, position.y_offset)
        pen, bound = SVGPathPen(glyphs), BoundsPen(glyphs)
        glyphs[order[glyph.codepoint]].draw(TransformPen(pen, transform))
        glyphs[order[glyph.codepoint]].draw(TransformPen(bound, transform))
        paths.append(f'<path d="{pen.getCommands()}"/>')
        bounds.append(bound.bounds)
        cursor += position.x_advance
    left, bottom = min(b[0] for b in bounds), min(b[1] for b in bounds)
    right, top = max(b[2] for b in bounds), max(b[3] for b in bounds)
    scale = min(1235 / (right - left), 364 / (top - bottom))
    x, y = 123 - left * scale, 34 + top * scale
    svg = f'<svg xmlns="http://www.w3.org/2000/svg" width="1529" height="434" viewBox="0 0 1529 434"><title>Reporta / {name} / native kerning, zero tracking</title><g fill="#080808" transform="translate({x} {y}) scale({scale} {-scale})">{"".join(paths)}</g></svg>'
    (root / f"{name}.svg").write_text(svg)
    print(name, round((right - left) / (top - bottom), 3))
