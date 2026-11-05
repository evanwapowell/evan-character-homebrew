"""The preview video: 0.6 s of empty map, the 2 s intro, the whole 16 s loop, then 2 s more so the seam is on screen.
Both the intro and the loop are Sequencer effects in Foundry, so neither is faded by pf2e's texture alpha."""
import os
import subprocess
import sys
sys.path.insert(0, os.path.dirname(__file__))
from compose import frame  # noqa: E402

FPS, START, INTRO, LOOP = 30, 18, 60, 480
total = START + INTRO + LOOP + 60
ff = subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", str(FPS), "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "17", "-preset", "slow", "-movflags", "+faststart", "bl/finch-occult-blender-v2.mp4"], stdin=subprocess.PIPE)
for i in range(total):
    src = None
    if START <= i < START + INTRO:
        src = f"bl/intro/{i - START + 1:04d}.png"
    elif i >= START + INTRO:
        src = f"bl/loop/{(i - START - INTRO) % LOOP + 1:04d}.png"
    frame(src, None, loop_alpha=0.85).save(ff.stdin, "PNG")
ff.stdin.close()
ff.wait()
print("video written", total, "frames")
