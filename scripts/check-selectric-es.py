#!/usr/bin/env python3
"""Check Spanish coverage, canonical shaping, original outlines and bounds.

Requires fontTools and Pillow with RAQM. Run after build-selectric-es.py.
"""
from pathlib import Path
import unicodedata

from fontTools.ttLib import TTFont
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.pens.boundsPen import BoundsPen
from PIL import ImageFont, features

ROOT = Path(__file__).resolve().parents[1]
VARIANTS = {"Medium8": "InkGrooveType8-ES", "Medium9": "InkGrooveType9-ES", "Medium9Clean": "InkGrooveTypeClean-ES"}
TEXT = "El pingüino llegó a Cádiz. ¿Qué escribió el niño? ¡Mañana habrá poesía! ÁÉÍÓÚÜÑ áéíóúüñ"
assert features.check("raqm"), "Install a Pillow build with RAQM to check Unicode shaping."
for variant, file in VARIANTS.items():
    original = TTFont(ROOT / f"resources/fonts/source/SelectricCentury-{variant}.ttf")
    path = ROOT / f"resources/fonts/{file}.ttf"
    extended = TTFont(path)
    cmap, glyphs = extended.getBestCmap(), extended.getGlyphSet()
    for char in "áéíóúñüÁÉÍÓÚÑÜ¿¡\u0301\u0303\u0308":
        assert ord(char) in cmap, (file, "Missing glyph", char)
        pen = BoundsPen(glyphs)
        glyphs[cmap[ord(char)]].draw(pen)
        assert pen.bounds, (file, "Empty glyph", char)
    for point in range(0x21, 0x7E):
        char = chr(point)
        name = original.getBestCmap().get(point)
        if not name:
            continue
        before, after = DecomposingRecordingPen(original.getGlyphSet()), DecomposingRecordingPen(glyphs)
        original.getGlyphSet()[name].draw(before)
        glyphs[cmap[point]].draw(after)
        assert before.value == after.value, (file, "Original outline changed", char)
        assert original["hmtx"][name] == extended["hmtx"][cmap[point]], (file, "Original width changed", char)
    for size in (16, 40, 72):
        face = ImageFont.truetype(str(path), size, layout_engine=ImageFont.Layout.RAQM)
        for text in (TEXT, *"áéíóúüñÁÉÍÓÚÜÑ"):
            decomposed = unicodedata.normalize("NFD", text)
            assert face.getmask(text).size == face.getmask(decomposed).size, (file, size, text, "NFD size")
            assert bytes(face.getmask(text)) == bytes(face.getmask(decomposed)), (file, size, text, "NFD rendering")
    for char in "ÁÉÍÓÚÜÑ¿¡":
        pen = BoundsPen(glyphs)
        glyphs[cmap[ord(char)]].draw(pen)
        assert pen.bounds[3] < extended["hhea"].ascent
        assert pen.bounds[1] > extended["hhea"].descent
    assert "DSIG" not in extended, "A modified font must not retain the original signature."
    assert "Open Font License" in extended["name"].getDebugName(13)
    print(f"{file}: Spanish glyphs, NFC/NFD at 16/40/72px, original outlines and vertical bounds OK")
