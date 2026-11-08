# Finch's animations: source art and tools

Source for the "Finch version" animations of Manifest Will and Familiar of Ongoing Misery. Nothing here is part of the
module's release: the approved animations are exported (with `bl/export.py`, which bakes in the glow) as WebM with
alpha into the module's `animations/finch/`, and played by `scripts/lib/finch.js`. Done: divine, occult and primal
Manifest Will, and the curse. Arcane is still to make (it needs the lost scripts from `script-refs/`).

- `source/`: the original images generated in Gemini, renamed by subject.
- `sprites/`: the same images cut out of their black backgrounds, colour-matched and sliced into single sprites (faces,
  trinkets, divine sigils and feathers, blank pages, the four lost-land patches, Valet's control bar, `fey/`, the 23 fey
  glyphs, and `tinted/`, the divine sigils recoloured gold or violet).
- `script-refs/`: skeleton glyph sheets to give Gemini when asking for the arcane library's lost scripts (it redraws
  their shapes in a style; asked for an "alphabet" from words alone, it draws English letters).
- `bl/`: Blender scenes (`occult.py`, `divine.py`, `primal.py`, `curse.py`) and the compositing that turns their frames into previews over a mock
  battle map (`compose.py`, `video.py`, `curse_video.py`).
- `fx/`: browser-canvas helpers: the fey-rune band, the mock map and tokens, the storyboards, and the Python scripts
  that cut sprites out (`cutout.py`, `harmonize.py`, `slice.py`, `patch.py`, `feyslice.py`).

The tools were run from a scratch folder laid out as `sprites/` (with the originals in `sprites/raw/`), `script-refs/`,
`bl/` and `fx/` side by side, from that folder's root; Blender is the `bpy` package (5.2) in a Python virtual environment.
