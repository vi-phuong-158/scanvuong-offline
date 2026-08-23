import subprocess, sys, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
js_script = os.path.join(ROOT, 'scripts', 'capture_ui_states.cjs')
res = subprocess.run(['node', js_script], cwd=ROOT)
sys.exit(res.returncode)