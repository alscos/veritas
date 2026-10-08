#!/usr/bin/env python3
"""Rebuild the InkGroove vector wordmark from the supplied Medium 8 font.

The approved bottle is preserved verbatim. Requires fontTools only when
regenerating SVGs; production uses the already generated assets.
"""
from pathlib import Path
from html import escape
import xml.etree.ElementTree as ET

from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "resources/brand"
GREEN, CORAL, PAPER = "#12352d", "#ff6b42", "#fffefb"
symbol = ET.parse(OUT / "InkGroove-icono-naranja.svg")
bottle = symbol.find(".//*[@id='bote']").get("d")
spill = symbol.find(".//*[@id='mancha']").get("d")
font = TTFont(ROOT / "resources/fonts/source/SelectricCentury-Medium8.ttf")
glyphs, cmap = font.getGlyphSet(), font.getBestCmap()
paths, boundaries, cursor = [], [], 0
for char in "InkGroove":
    name = cmap[ord(char)]
    pen = SVGPathPen(glyphs)
    glyphs[name].draw(TransformPen(pen, (1, 0, 0, 1, cursor, 0)))
    paths.append(pen.getCommands())
    bounds = BoundsPen(glyphs)
    glyphs[name].draw(bounds)
    boundaries.append((cursor + bounds.bounds[0], bounds.bounds[1], cursor + bounds.bounds[2], bounds.bounds[3]))
    cursor += font["hmtx"][name][0]
scale = 160 / max(box[3] for box in boundaries)
word_width = max(box[2] for box in boundaries) * scale
word_path = " ".join(paths)
width, height = round(555 + word_width + 26, 2), 470


def tintero(main, drop):
    return f'<g id="tintero"><path id="bote" fill="{main}" fill-rule="evenodd" d="{bottle}"/><path id="mancha" fill="{drop}" fill-rule="evenodd" d="{spill}"/></g>'


def svg(title, w, h, body):
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" role="img" aria-labelledby="title">
  <title id="title">{escape(title)}</title>
  <desc>Tintero de época y nombre en Selectric Century Medium 8, convertidos en trazados vectoriales. Fondo transparente.</desc>
  {body}
</svg>
'''


for variant, drop in [("naranja", CORAL), ("verde", GREEN), ("claro", CORAL)]:
    main = PAPER if variant == "claro" else GREEN
    word = f'<g id="nombre" fill="{main}" transform="translate(555,336) scale({scale:.9f},{-scale:.9f})"><path d="{word_path}"/></g>'
    body = f'<g transform="translate(16,20)">{tintero(main, drop)}</g>{word}'
    (OUT / f"InkGroove-logo-{variant}.svg").write_text(svg(f"InkGroove — {variant}", width, height, body), encoding="utf-8")
    if variant != "claro":
        (OUT / f"InkGroove-icono-{variant}.svg").write_text(svg(f"InkGroove — tintero {variant}", 500, 430, tintero(main, drop)), encoding="utf-8")

# Alternative approved in the reference: a larger spill and matching wordmark.
# Only the spill is scaled. The bottle and the Medium 8 outlines are unchanged.
for variant, main, ink in [("naranja", GREEN, CORAL), ("verde", GREEN, GREEN), ("claro", PAPER, CORAL)]:
    symbol = f'<g id="tintero"><path id="bote" fill="{main}" fill-rule="evenodd" transform="translate(100,0)" d="{bottle}"/><path id="mancha" fill="{ink}" fill-rule="evenodd" transform="translate(-12,-466) scale(2.35)" d="{spill}"/></g>'
    word = f'<g id="nombre" fill="{ink}" transform="translate(655,336) scale({scale:.9f},{-scale:.9f})"><path d="{word_path}"/></g>'
    body = f'<g transform="translate(16,20)">{symbol}</g>{word}'
    (OUT / f"InkGroove-logo-tinta-{variant}.svg").write_text(svg(f"InkGroove — tinta {variant}", round(width + 100, 2), 500, body), encoding="utf-8")
(OUT / "InkGroove-wordmark.svg").write_text(svg("InkGroove — Medium 8", round(word_width + 12, 2), 176, f'<g fill="{GREEN}" transform="translate(0,164) scale({scale:.9f},{-scale:.9f})"><path d="{word_path}"/></g>'), encoding="utf-8")
(ROOT / "public/favicon.svg").write_text(svg("InkGroove", 64, 64, f'<rect width="64" height="64" rx="14" fill="{PAPER}"/><g transform="translate(3,7) scale(.116)">{tintero(GREEN, CORAL)}</g>'), encoding="utf-8")
for file in OUT.glob("*.svg"):
    root = ET.parse(file).getroot()
    assert not root.findall(".//{http://www.w3.org/2000/svg}image")
    assert not root.findall(".//{http://www.w3.org/2000/svg}text")
print(f"Selectric Medium 8 logos: {width} × {height}")
