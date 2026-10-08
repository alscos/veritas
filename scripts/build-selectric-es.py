#!/usr/bin/env python3
"""Extend the supplied OFL Selectric fonts; requires fontTools (not at runtime).

Inputs remain untouched in resources/fonts/source. The added precomposed and
combining glyphs handle NFC/NFD without altering the stored document text.
"""
from pathlib import Path
import argparse

from fontTools.feaLib.builder import addOpenTypeFeaturesFromString
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
VARIANTS = {
    "Medium8": ("InkGroove Type 8", "InkGrooveType8-ES"),
    "Medium9": ("InkGroove Type 9", "InkGrooveType9-ES"),
    "Medium9Clean": ("InkGroove Type Clean", "InkGrooveTypeClean-ES"),
}


def build(source, target, variant):
    family, filename = VARIANTS[variant]
    font = TTFont(source, recalcTimestamp=False)
    glyf, metrics = font["glyf"], font["hmtx"]
    cmap = dict(font.getBestCmap())
    clean = variant.endswith("Clean")
    source_glyphs = font.getGlyphSet()

    def bounds(name):
        pen = BoundsPen(font.getGlyphSet())
        font.getGlyphSet()[name].draw(pen)
        return pen.bounds

    def add(name, glyph, advance=0, codepoint=None):
        if name not in font.getGlyphOrder():
            font.setGlyphOrder(font.getGlyphOrder() + [name])
        glyf[name] = glyph
        glyph.recalcBounds(glyf)
        metrics[name] = advance, getattr(glyph, "xMin", 0)
        if codepoint is not None:
            cmap[codepoint] = name
        return name

    def components(items):
        pen = TTGlyphPen(font.getGlyphSet())
        for name, matrix in items:
            pen.addComponent(name, matrix)
        return pen.glyph()

    # The acute and tilde are new outlines, matched to the source's strokes.
    # No glyphs are borrowed from another font.
    pen = TTGlyphPen(None)
    points = [(-84, 0), (-28, 0), (100, 126), (23, 126)] if clean else [(-89, 0), (-31, -3), (109, 126), (34, 136)]
    pen.moveTo(points[0])
    for point in points[1:]:
        pen.lineTo(point)
    pen.closePath()
    acute = add("acutecomb.es", pen.glyph(), codepoint=0x0301)
    pen = TTGlyphPen(None)
    pen.moveTo((-160, 26))
    pen.qCurveTo((-120, 123), (-54, 103))
    pen.qCurveTo((-26, 94), (24, 63))
    pen.qCurveTo((96, 21), (150, 105))
    pen.lineTo((175, 54))
    pen.qCurveTo((114, -27), (51, 0))
    pen.qCurveTo((19, 8), (-29, 42))
    pen.qCurveTo((-97, 85), (-132, 7))
    pen.closePath()
    tilde = add("tildecomb.es", pen.glyph(), codepoint=0x0303)

    # Several original diaeresis glyphs are empty. Build the pair from the
    # font's own dot, preserving its clean/printed character in each variant.
    dot = bounds("uni0307")
    dot_center = (dot[0] + dot[2]) / 2
    dia = add("uni0308", components([
        ("uni0307", (0.78, 0, 0, 0.78, shift - dot_center * 0.78, -dot[1] * 0.78))
        for shift in (-105, 105)
    ]), codepoint=0x0308)
    add("uni0308.case", components([(dia, (1, 0, 0, 1, 0, 0))]))

    base_anchors = {}
    for char in "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzıȷ":
        name = cmap[ord(char)]
        base = "dotlessi" if char == "i" else "uni0237" if char == "j" else name
        box = bounds(base)
        center = round((box[0] + box[2]) / 2)
        gap = 62 if char.isupper() else 72
        base_anchors[name] = center, round(box[3] + gap)

    def accented(char, mark, name, codepoint):
        base = "dotlessi" if char == "i" else cmap[ord(char)]
        x, y = base_anchors[cmap[ord(char)]]
        add(name, components([(base, (1, 0, 0, 1, 0, 0)), (mark, (1, 0, 0, 1, x, y))]), metrics[base][0], codepoint)

    for base, char, name in zip("aeiouAEIOU", "áéíóúÁÉÍÓÚ", ["aacute", "eacute", "iacute", "oacute", "uacute", "Aacute", "Eacute", "Iacute", "Oacute", "Uacute"]):
        accented(base, acute, name, ord(char))
    for base, char, name in [("n", "ñ", "ntilde"), ("N", "Ñ", "Ntilde")]:
        accented(base, tilde, name, ord(char))
    for base, char, name in [("a", "ä", "adieresis"), ("o", "ö", "odieresis"), ("u", "ü", "udieresis"), ("A", "Ä", "Adieresis"), ("O", "Ö", "Odieresis"), ("U", "Ü", "Udieresis")]:
        accented(base, dia, name, ord(char))

    x_height = round(bounds(cmap[ord("n")])[3])
    for source_name, name, point in [("question", "questiondown", 0x00BF), ("exclam", "exclamdown", 0x00A1)]:
        advance = metrics[source_name][0]
        shift_y = x_height + bounds(source_name)[1]
        add(name, components([(source_name, (-1, 0, 0, -1, advance, shift_y))]), advance, point)
    add("acute", components([(acute, (1, 0, 0, 1, 200, x_height + 72))]), 400, 0x00B4)
    add("asciitilde", components([(tilde, (1, 0, 0, 1, 200, round(x_height * 0.6)))]), 400, 0x007E)

    for table in font["cmap"].tables:
        if table.isUnicode():
            table.cmap.update(cmap)

    # Rebuild the small existing feature set with complete mark coverage.
    # Base anchors use each letter's outline, rather than a single capital-
    # height anchor which would leave lowercase accents floating above it.
    for tag in ("GDEF", "GPOS", "GSUB", "DSIG"):
        if tag in font:
            del font[tag]
    features = ["languagesystem DFLT dflt;", "languagesystem latn dflt;",
        f"markClass {acute} <anchor 0 0> @TOP;",
        f"markClass {tilde} <anchor 0 0> @TOP;",
        f"markClass {dia} <anchor 0 0> @TOP;",
        "markClass uni0308.case <anchor 0 0> @TOP;",
        f"markClass uni0307 <anchor {round(dot_center)} {round(dot[1])}> @DOT;",
        f"@ACCENTS = [{acute} {tilde} {dia} uni0308.case uni0307];",
        "feature ccmp { sub i' @ACCENTS by dotlessi; sub j' @ACCENTS by uni0237; } ccmp;",
        "feature case { sub uni0308 by uni0308.case; } case;",
        "feature aalt { sub uni0308 from [uni0308.case]; } aalt;",
        "feature frac { sub one slash two by onehalf; sub one slash four by onequarter; sub three slash four by threequarters; } frac;",
        "feature mark {"]
    for name, (x, y) in base_anchors.items():
        features.append(f"pos base {name} <anchor {x} {y}> mark @TOP <anchor {x} {y}> mark @DOT;")
    features.extend(["} mark;", "feature mkmk {"])
    for name in (acute, tilde, dia, "uni0308.case"):
        features.append(f"pos mark {name} <anchor 0 {round(bounds(name)[3] + 55)}> mark @TOP;")
    features.append("} mkmk;")
    addOpenTypeFeaturesFromString(font, "\n".join(features))

    # Keep all original author/vendor records; rename the derivative family
    # so it cannot conflict with an installed, unmodified Selectric font.
    notice = ("Derived from Selectric Century. Original design credits: IBM, Jens Kutilek. "
        "Spanish glyph extension by InkGroove contributors (2026). SIL Open Font License 1.1.")
    licence = (ROOT / "resources/fonts/OFL.txt").read_text(encoding="utf-8")
    new_names = {1: family, 2: "Regular", 3: f"1.001;IGRV;{filename}",
        4: family, 5: "Version 1.001; Spanish extension", 6: filename.replace("-ES", "ES"),
        10: notice, 13: licence, 14: "https://openfontlicense.org", 16: family, 17: "Regular"}
    for identifier, value in new_names.items():
        font["name"].removeNames(nameID=identifier)
        font["name"].setName(value, identifier, 3, 1, 0x409)
    font["OS/2"].recalcUnicodeRanges(font)
    font["OS/2"].recalcCodePageRanges(font)
    font["OS/2"].usFirstCharIndex = min(cmap)
    font["OS/2"].usLastCharIndex = max(cmap)
    highest = max(getattr(glyf[name], "yMax", 0) for name in font.getGlyphOrder())
    lowest = min(getattr(glyf[name], "yMin", 0) for name in font.getGlyphOrder())
    ascender = max(font["hhea"].ascent, highest + 24)
    descender = min(font["hhea"].descent, lowest - 12)
    font["hhea"].ascent = ascender
    font["hhea"].descent = descender
    font["OS/2"].sTypoAscender = ascender
    font["OS/2"].sTypoDescender = descender
    font["OS/2"].sTypoLineGap = 0
    font["OS/2"].usWinAscent = ascender
    font["OS/2"].usWinDescent = -descender
    font["head"].fontRevision = 1.001
    font["head"].modified = 3874262400  # 2026-10-08, deterministic build.
    target.mkdir(parents=True, exist_ok=True)
    font.save(target / f"{filename}.ttf")
    if clean:
        font.flavor = "woff"
        font.save(target / f"{filename}.woff")
    print(f"{family}: {len(cmap)} codepoints; ascent {ascender}, descent {descender}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, default=ROOT / "resources/fonts/source")
    parser.add_argument("--out-dir", type=Path, default=ROOT / "resources/fonts")
    args = parser.parse_args()
    for variant in VARIANTS:
        build(args.source_dir / f"SelectricCentury-{variant}.ttf", args.out_dir, variant)
