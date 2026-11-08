"""Primal preview: as bl/video.py, with the primal frames and its green aura border."""
import os
import subprocess
import sys
sys.path.insert(0, os.path.dirname(__file__))
from compose import frame  # noqa: E402

FPS, START, INTRO, LOOP = 30, 18, 60, 480
total = START + INTRO + LOOP + 60
ff = subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", str(FPS), "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "17", "-preset", "slow", "-movflags", "+faststart", "bl/finch-primal-blender.mp4"], stdin=subprocess.PIPE)
for i in range(total):
    src = None
    if START <= i < START + INTRO:
        src = f"bl/primal-intro/{i - START + 1:04d}.png"
    elif i >= START + INTRO:
        src = f"bl/primal-loop/{(i - START - INTRO) % LOOP + 1:04d}.png"
    frame(src, None, colour=(79, 158, 58)).save(ff.stdin, "PNG")
ff.stdin.close()
ff.wait()
print("video written", total, "frames")
