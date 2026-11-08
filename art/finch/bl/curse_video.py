"""Preview of Valet's curse, composited as Sequencer will play it: the wisp loop fades and scales in at Valet's hand,
moves to the target on a gentle corkscrew (moveTowards plus a looping sideways offset), turned to face the target;
then the impact clip plays centred on the target's token. Effects are drawn above tokens."""
import math
import os
import subprocess
import sys
sys.path.insert(0, os.path.dirname(__file__))
from compose import bloom  # noqa: E402
from PIL import Image  # noqa: E402

BG = Image.open("bl/assets/bg.png").convert("RGBA")
TOK = Image.open("bl/assets/curse-tokens.png")
MV, ME = (350, 450), (750, 390)
HAND = (MV[0] + 40, MV[1] - 22)
TARGET = (ME[0], ME[1] - 22)  # the impact's wisp sits a little above the token's centre
FPS = 30
START, GATHER, FLIGHT, IMPACT = 9, 18, 75, 78
total = START + GATHER + FLIGHT + IMPACT + 12
heading = math.atan2(TARGET[1] - HAND[1], TARGET[0] - HAND[0])
wisp_frames = [bloom(f"bl/curse-wisp/{i:04d}.png").resize((160, 100), Image.LANCZOS) for i in range(1, 91)]
impact_frames = [bloom(f"bl/curse-impact/{i:04d}.png").resize((240, 360), Image.LANCZOS) for i in range(1, IMPACT + 1)]


def place(base, im, cx, cy):
    base.alpha_composite(im, (int(cx - im.width / 2), int(cy - im.height / 2)))


ff = subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", str(FPS), "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "17", "-movflags", "+faststart", "bl/finch-curse-blender.mp4"], stdin=subprocess.PIPE)
for i in range(total):
    out = BG.copy()
    out.alpha_composite(TOK)
    k = i - START
    if 0 <= k < GATHER + FLIGHT:
        w = wisp_frames[k % 90]
        if k < GATHER:
            s = 0.3 + 0.7 * k / GATHER
            x, y = HAND
        else:
            s = 1.0
            u = (k - GATHER) / FLIGHT
            e = u * u * (3 - 2 * u)
            side = 26 * math.sin(math.pi * u) * math.sin(u * math.tau * 1.75)
            x = HAND[0] + (TARGET[0] - HAND[0]) * e - math.sin(heading) * side
            y = HAND[1] + (TARGET[1] - HAND[1]) * e + math.cos(heading) * side - 30 * math.sin(math.pi * u)
        im = w.resize((max(1, int(w.width * s)), max(1, int(w.height * s))), Image.LANCZOS)
        if k < GATHER:
            im.putalpha(im.getchannel("A").point(lambda v, a=k / GATHER: int(v * a)))
        im = im.rotate(-math.degrees(heading), expand=True, resample=Image.BICUBIC)
        # the wisp's core is 0.3 squares (30 px) ahead of the clip's centre
        place(out, im, x - math.cos(heading) * 30 * s, y - math.sin(heading) * 30 * s)
    j = k - GATHER - FLIGHT
    if 0 <= j < IMPACT:
        place(out, impact_frames[j], ME[0], ME[1] - 80)
    out.convert("RGB").save(ff.stdin, "PNG")
ff.stdin.close()
ff.wait()
print("curse video", total, "frames")
