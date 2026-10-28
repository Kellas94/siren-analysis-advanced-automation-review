"""Owned launcher for existing pinned CLI; original toolkit runtime.json is stale and untouched."""
from pathlib import Path
import subprocess,sys,json,hashlib
r=Path(__file__).resolve().parents[1]
node=Path(r'C:\Users\Taras\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe')
pkg=Path(r'C:\Users\Taras\.codex\tools\siren-quality\node_modules\@playwright\cli')
out=r/'output/playwright/history-browser-v1';out.mkdir(parents=True,exist_ok=True)
manifest=json.loads((pkg/'package.json').read_text())
index=len(list(out.glob('command-*.json')))+1
cmd=[str(node),str(pkg/manifest['bin']['playwright-cli']),'-s=history-browser-v1',*sys.argv[1:]]
p=subprocess.run(cmd,cwd=r,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
raw=p.stdout.decode('utf-8',errors='replace')
(out/f'command-{index:03d}.txt').write_text(raw,encoding='utf-8')
(out/f'command-{index:03d}.json').write_text(json.dumps({'command':cmd,'exit':p.returncode,'cliVersion':manifest['version'],'nodeSha256':hashlib.sha256(node.read_bytes()).hexdigest()},indent=2),encoding='utf-8')
print(raw)
sys.exit(p.returncode)
