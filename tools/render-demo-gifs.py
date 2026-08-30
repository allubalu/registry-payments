"""
Regenerate the terminal demo GIFs embedded in the README.

    python tools/render-demo-gifs.py

Runs the quote CLI for real and renders its captured stdout, so the GIFs
can never drift from what the engine actually prints. Program output is
drawn in a single foreground colour because the CLI emits no ANSI escapes
-- colouring it here would show a reader something their own terminal
will not.

Requires Pillow and the Windows fonts Cascadia Code and Yu Gothic. This
is a one-off asset generator, not part of the build or the test suite.
"""

import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

REPO = Path(__file__).resolve().parent.parent
OUT = REPO / "docs" / "assets"

MONO = "C:/Windows/Fonts/CascadiaCode.ttf"
# Yu Gothic carries both glyphs Cascadia lacks: U+FFE5 FULLWIDTH YEN and
# U+26A0 WARNING SIGN. Segoe UI Symbol has the warning but renders the
# yen as .notdef, which is how the first attempt shipped a tofu box.
FALLBACK_FONT = "C:/Windows/Fonts/YuGothM.ttc"

FONT_SIZE, LINE_H = 15, 21
PAD_X, PAD_TOP, PAD_BOT = 22, 46, 16

BG, CHROME, BORDER = (13, 17, 23), (22, 27, 34), (48, 54, 61)
FG, DIM, PROMPT, FLAG = (201, 209, 217), (110, 118, 129), (63, 185, 80), (88, 166, 255)
DOTS = [(255, 95, 86), (255, 189, 46), (39, 201, 63)]

font = ImageFont.truetype(MONO, FONT_SIZE)
symfont = ImageFont.truetype(FALLBACK_FONT, FONT_SIZE)
CH_W = font.getlength("M")

_cache: dict[str, bool] = {}


def _mask(f, ch):
    m = f.getmask(ch)
    return (m.size, bytes(m))


# A private-use codepoint no font maps, so this is what .notdef looks
# like. Comparing against it is the only reliable missing-glyph test:
# getbbox() reports ink for the tofu box itself.
_TOFU = _mask(font, "\ue000")


def font_for(ch):
    if ch.isspace():
        return font
    if ch not in _cache:
        try:
            _cache[ch] = _mask(font, ch) != _TOFU
        except Exception:
            _cache[ch] = False
    return font if _cache[ch] else symfont


def quote(*args):
    """Run the CLI and return its output lines, trimmed of blank edges."""
    result = subprocess.run(
        ["node", "--experimental-strip-types", "tools/quote.ts", *args],
        cwd=REPO,
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
    )
    text = result.stdout or result.stderr
    lines = [ln.rstrip("\n") for ln in text.splitlines()]
    while lines and not lines[0].strip():
        lines.pop(0)
    while lines and not lines[-1].strip():
        lines.pop()
    if not lines:
        raise SystemExit(f"quote {' '.join(args)} produced no output")
    return lines


def build(scenes, out_path, title):
    all_lines = []
    for s in scenes:
        all_lines.append([("$ ", PROMPT), ("quote ", FLAG), (s["args"], FG)])
        all_lines.extend([[(ln, FG)] for ln in s["output"]])
    rows = len(all_lines) + 1
    width = int(
        PAD_X * 2 + max(sum(font.getlength(t) for t, _ in sp) for sp in all_lines) + CH_W
    )
    height = PAD_TOP + LINE_H * rows + PAD_BOT

    frames, durations = [], []

    def snap(lines, cursor_at, ms):
        img = Image.new("RGB", (width, height), BG)
        d = ImageDraw.Draw(img)
        d.rectangle([0, 0, width, 30], fill=CHROME)
        d.line([(0, 30), (width, 30)], fill=BORDER)
        for i, c in enumerate(DOTS):
            cx = 16 + i * 18
            d.ellipse([cx - 5, 10, cx + 5, 20], fill=c)
        d.text(((width - d.textlength(title, font=font)) / 2, 8), title, font=font, fill=DIM)
        for i, spans in enumerate(lines):
            x, y = PAD_X, PAD_TOP + i * LINE_H
            for text, col in spans:
                for ch in text:
                    d.text((x, y), ch, font=font_for(ch), fill=col)
                    x += font.getlength(ch)
            if cursor_at == i:
                d.rectangle([x + 1, y + 3, x + CH_W, y + LINE_H - 4], fill=FG)
        frames.append(img)
        durations.append(ms)

    history = []
    for scene in scenes:
        args = scene["args"]
        for n in range(0, len(args) + 1, 4):
            snap(history + [[("$ ", PROMPT), ("quote ", FLAG), (args[:n], FG)]], len(history), 50)
        line = [("$ ", PROMPT), ("quote ", FLAG), (args, FG)]
        snap(history + [line], len(history), 450)
        history = history + [line]
        out = [[(ln, FG)] for ln in scene["output"]]
        for n in range(1, len(out) + 1):
            snap(history + out[:n], None, 320 if n == len(out) else 38)
        history = history + out
        for _ in range(2):
            snap(history, None, 850)
    for _ in range(20):
        snap(history, None, 120)

    OUT.mkdir(parents=True, exist_ok=True)
    frames[0].save(
        out_path, save_all=True, append_images=frames[1:],
        duration=durations, loop=0, optimize=True,
    )
    print(f"  {out_path.name:16s} {out_path.stat().st_size / 1024:6.0f} KB  {len(frames)} frames")


CLIFF = [
    "--jurisdiction GB-ENG --consideration 42500000 --attr firstTimeBuyer=true",
    "--jurisdiction GB-ENG --consideration 42500001 --attr firstTimeBuyer=true",
]
CURRENCIES = [
    "--jurisdiction JP --consideration 60000000",
    "--jurisdiction IN-TG --consideration 480000000 --market 500000000",
    "--jurisdiction AE-DU --consideration 240000000 "
    "--attr mortgaged=true --attr loanAmountMinor=180000000",
]


def scenes(arg_lines):
    return [{"args": a, "output": quote(*a.split())} for a in arg_lines]


if __name__ == "__main__":
    build(scenes(CLIFF), OUT / "cliff.gif", "one minor unit apart")
    build(scenes(CURRENCIES), OUT / "currencies.gif",
          "three currencies, one engine, zero branches")
