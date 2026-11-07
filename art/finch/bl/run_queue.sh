#!/bin/bash
# Render primal, then divine. Each skips frames already rendered, so this can simply be re-run after an interruption.
cd "$(dirname "$0")/.."
run() {  # name
    local start=$(date +%s)
    ./blender-venv/bin/python bl/$1.py --mode intro --out bl/$1-intro --samples ${2:-20} --res 600 > bl/$1-intro.log 2>&1 &&
    ./blender-venv/bin/python bl/$1.py --mode loop --out bl/$1-loop --samples ${2:-20} --res 600 > bl/$1-loop.log 2>&1 &&
    python3 -I bl/$1_video.py
    echo "exit $? after $(( $(date +%s) - start ))s" > bl/$1.done
}
[ -f bl/primal.done ] || run primal 20
[ -f bl/divine.done ] || run divine 28
