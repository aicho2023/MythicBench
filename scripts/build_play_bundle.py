"""Pack the simulator modules the in-browser game needs into one zip.

/play runs the real simulator in the browser (Pyodide). This writes
web/public/play/mythicsim.zip from sim/mythicsim, byte for byte the same on
every machine (fixed timestamps, sorted), so the game in the browser is the
code in the repository. tests/test_play.py fails if the zip is stale.

    python scripts/build_play_bundle.py
"""

from __future__ import annotations

import io
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PKG = ROOT / "sim" / "mythicsim"
OUT = ROOT / "web" / "public" / "play" / "mythicsim.zip"
MODULES = ["__init__.py", "content.py", "dodge.py", "dungeon.py", "engine.py", "metrics.py", "play.py",
           "llm/__init__.py", "llm/clients.py", "llm/debrief.py", "llm/expert.py", "llm/policy.py", "llm/prompt.py"]


def bundle() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for m in sorted(MODULES):
            info = zipfile.ZipInfo(f"mythicsim/{m}", date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            z.writestr(info, (PKG / m).read_bytes())
    return buf.getvalue()


if __name__ == "__main__":
    data = bundle()
    if "--check" in sys.argv:
        sys.exit(0 if OUT.exists() and OUT.read_bytes() == data else "web/public/play/mythicsim.zip is stale: "
                 "run python scripts/build_play_bundle.py")
    OUT.write_bytes(data)
    print(f"wrote {OUT.relative_to(ROOT)} ({len(data) // 1024} KB)")
