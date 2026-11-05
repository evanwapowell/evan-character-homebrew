"""Export rendered frames as a transparent VP9 WebM for Sequencer: glow baked in (the compositing bloom), straight alpha.
  python export.py FRAME_DIR OUT.webm [FIRST LAST]"""
import os
import subprocess
import sys
import tempfile
sys.path.insert(0, os.path.dirname(__file__))
from compose import bloom  # noqa: E402

src, out = sys.argv[1], sys.argv[2]
names = sorted(f for f in os.listdir(src) if f.endswith(".png"))
if len(sys.argv) > 4:
    a, b = int(sys.argv[3]), int(sys.argv[4])
    names = [n for n in names if a <= int(n[:4]) <= b]
with tempfile.TemporaryDirectory() as tmp:
    for i, n in enumerate(names):
        bloom(os.path.join(src, n)).save(os.path.join(tmp, f"{i:04d}.png"))
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", "30", "-i", os.path.join(tmp, "%04d.png"), "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", os.environ.get("CRF", "42"), "-row-mt", "1", "-auto-alt-ref", "0", out], check=True)
print(out, len(names), "frames")
