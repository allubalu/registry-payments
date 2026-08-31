"""
Regenerate the browser demo GIF embedded in the README.

    npm run dev:api          # in one terminal
    npm run dev:web          # in another
    python tools/render-ui-gif.py

Drives the real client against the real API in headless Chrome and assembles
the screenshots, so the GIF can never drift from what the app actually does --
the same guarantee render-demo-gifs.py gives the terminal GIFs.

The capture half lives in tools/capture-ui-frames.mjs because the browser has
to be driven from Node; this half assembles the frames because that needs
Pillow. Neither half is worth a dependency to avoid: the CDP driver speaks the
protocol over Node's built-in WebSocket, so there is no Playwright or Puppeteer
in this repo yet. The roadmap wants Playwright introduced alongside the E2E
suite that justifies it, not smuggled in to make a GIF.

Requires Pillow and Google Chrome. A one-off asset generator, not part of the
build or the test suite.
"""

import json
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parent.parent
OUT = REPO / "docs" / "assets"

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
CDP_PORT = 9333
BASE_URL = "http://localhost:5173"

# Frames are captured at deviceScaleFactor 2 and downscaled once, here, so text
# stays crisp instead of being resampled twice.
GIF_WIDTH = 1000

# Totals the CLI and the golden fixtures pin. The GIF is only worth publishing
# if the browser agrees with them, so disagreement aborts rather than ships.
EXPECTED = {
    "gbEngAtThreshold": "£650.00",
    "gbEngOnePennyOver": "£7,400.00",
    "japan": "JP¥1,050,000",
    "losAngeles": "US$5,992.50",
    "alameda": "US$5,015.00",
}


def port_open(port: int) -> bool:
    # create_connection resolves "localhost" across address families. A plain
    # AF_INET probe reports Vite as down: it binds IPv6 only, so 127.0.0.1
    # refuses while ::1 accepts.
    try:
        with socket.create_connection(("localhost", port), timeout=0.6):
            return True
    except OSError:
        return False


def require_servers() -> None:
    missing = [
        f"{name} on :{port}"
        for name, port in (("the API", 4000), ("the Vite dev server", 5173))
        if not port_open(port)
    ]
    if missing:
        sys.exit(
            "Not running: "
            + ", ".join(missing)
            + "\nStart them with `npm run dev:api` and `npm run dev:web`, then retry."
        )


def start_chrome(profile_dir: Path) -> subprocess.Popen:
    process = subprocess.Popen(
        [
            CHROME,
            "--headless=new",
            f"--remote-debugging-port={CDP_PORT}",
            f"--user-data-dir={profile_dir}",
            "--no-first-run",
            "--no-default-browser-check",
            "--hide-scrollbars",
            "--force-color-profile=srgb",
            "--disable-lcd-text",  # subpixel fringes turn to colour noise in 256 colours
            "about:blank",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    for _ in range(60):
        if port_open(CDP_PORT):
            return process
        time.sleep(0.25)
    process.terminate()
    sys.exit(f"Chrome did not open a debugging port on {CDP_PORT}.")


def capture(frame_dir: Path) -> dict:
    subprocess.run(
        ["node", str(REPO / "tools" / "capture-ui-frames.mjs"), str(frame_dir), BASE_URL],
        cwd=REPO,
        check=True,
        env={"CDP_PORT": str(CDP_PORT), "PATH": __import__("os").environ["PATH"]},
    )
    return json.loads((frame_dir / "manifest.json").read_text())


def verify(observed: dict) -> None:
    problems = [
        f"  {key}: expected {want!r} in {observed.get(key)!r}"
        for key, want in EXPECTED.items()
        if want not in (observed.get(key) or "")
    ]
    if problems:
        sys.exit(
            "The browser disagreed with the CLI and the golden fixtures:\n"
            + "\n".join(problems)
            + "\nRefusing to publish a GIF of wrong numbers."
        )
    print(f"  all {len(EXPECTED)} totals match the CLI and the golden fixtures")


def build(frame_dir: Path, manifest: dict, out_path: Path) -> None:
    frames, durations = [], []

    for entry in manifest["frames"]:
        image = Image.open(frame_dir / entry["name"]).convert("RGB")
        height = round(image.height * GIF_WIDTH / image.width)
        frames.append(image.resize((GIF_WIDTH, height), Image.LANCZOS))
        durations.append(entry["holdMs"])

    # Hold the last frame so a looping GIF does not snap away from the result
    # the reader is still reading.
    for _ in range(12):
        frames.append(frames[-1])
        durations.append(150)

    # One shared adaptive palette, quantised from the busiest frame: per-frame
    # palettes make flat panels shimmer between frames.
    palette_source = max(frames, key=lambda f: len(f.getcolors(maxcolors=1 << 24) or [1]))
    palette = palette_source.quantize(colors=255, method=Image.MEDIANCUT)
    quantised = [frame.quantize(palette=palette, dither=Image.FLOYDSTEINBERG) for frame in frames]

    OUT.mkdir(parents=True, exist_ok=True)
    quantised[0].save(
        out_path,
        save_all=True,
        append_images=quantised[1:],
        duration=durations,
        loop=0,
        optimize=True,
    )
    size_kb = out_path.stat().st_size / 1024
    print(f"  {out_path.name:16s} {size_kb:6.0f} KB  {len(quantised)} frames  {GIF_WIDTH}px wide")


if __name__ == "__main__":
    require_servers()

    workdir = Path(tempfile.mkdtemp(prefix="registry-ui-gif-"))
    chrome = None
    try:
        chrome = start_chrome(workdir / "profile")
        manifest = capture(workdir / "frames")
        verify(manifest["observed"])
        build(workdir / "frames", manifest, OUT / "quote-ui.gif")
    finally:
        if chrome is not None:
            chrome.terminate()
            chrome.wait(timeout=15)
        shutil.rmtree(workdir, ignore_errors=True)
