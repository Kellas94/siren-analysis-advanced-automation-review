"""Sync this private candidate's maintained build and desktop files only."""
from pathlib import Path
import hashlib, json, shutil
root = Path(__file__).resolve().parents[1]
analysis = root / 'candidate' / 'analysis'
app = analysis / 'desktop_package' / 'resources' / 'app'
output = root / 'evidence' / 'build-sync-v1.json'
if output.exists():
    raise RuntimeError('Retain prior sync evidence; use a new explicit record version')
entries = [(analysis / 'dist' / n, app / 'dist' / n) for n in
           ('bundle.js', 'bundle.js.map', 'bundle.css', 'bundle.css.map', 'index.html')]
entries += [(analysis / 'desktop' / n, app / n) for n in
            ('main.cjs', 'preload.cjs', 'close_coordinator.cjs')]
records = []
for source, target in entries:
    if not source.is_file() or not target.parent.is_dir():
        raise RuntimeError(f'Missing exact source or destination parent: {source}, {target}')
    shutil.copyfile(source, target)
    source_bytes, target_bytes = source.read_bytes(), target.read_bytes()
    if source_bytes != target_bytes:
        raise RuntimeError(f'Copy mismatch: {target}')
    records.append({'source': str(source.relative_to(root)),
                    'target': str(target.relative_to(root)), 'bytes': len(source_bytes),
                    'sha256': hashlib.sha256(source_bytes).hexdigest()})
output.write_text(json.dumps(records, indent=2) + '\n', encoding='utf-8')
print(json.dumps(records, indent=2))
