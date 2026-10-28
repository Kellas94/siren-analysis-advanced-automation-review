from pathlib import Path
import json,hashlib,sys
r=Path(__file__).resolve().parents[1];v=sys.argv[1]
if not v.isalnum():raise RuntimeError('Fresh named version required')
out=r/'evidence'/('identity-'+v);out.mkdir()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
files=[]
for name in ['provider','reference-consumer','legacy-consumer','workbench']:
 for p in (r/name).rglob('*'):
  if p.is_symlink():raise RuntimeError('Reparse entry')
  if p.is_file():files.append(p)
names=['package.json','fixture.mjs','source-fixture.mjs','count-fixture.mjs','text-fixture.mjs','count-publication-fixture.mjs','scripts/bootstrap.mjs','scripts/workbench-server.mjs']
if (r/'scripts/browser-history-server.mjs').exists():names.append('scripts/browser-history-server.mjs')
files += [r/n for n in names];rows=[{'path':p.relative_to(r).as_posix(),'bytes':p.stat().st_size,'sha256':sha(p)} for p in sorted(files)]
old=json.loads((r/'evidence/intake.json').read_text(encoding='utf-8'))['files'];prior={x['path']:x for x in old};now={x['path']:x for x in rows}
for x in old:
 p=r.parent/'analysis-count-contract-v1'/x['path']
 if sha(p)!=x['sha256'] or p.stat().st_size!=x['bytes']:raise RuntimeError('Old donor drift')
roster=hashlib.sha256(''.join(f"{x['path']}\t{x['bytes']}\t{x['sha256']}\n" for x in rows).encode()).hexdigest()
s={'scope':'Isolated durable metadata/provider/native dependencies/reference consumer/browser startup; no Electron/main/installed','fileCount':len(rows),'bytes':sum(x['bytes'] for x in rows),'rosterSha256':roster,'added':sorted(set(now)-set(prior)),'removed':sorted(set(prior)-set(now)),'changed':sorted(p for p in set(prior)&set(now) if prior[p]['sha256']!=now[p]['sha256']),'old464DonorUnchanged':True};(out/'application-manifest.json').write_text(json.dumps({**s,'files':rows},indent=2)+'\n',encoding='utf-8');(out/'summary.json').write_text(json.dumps(s,indent=2)+'\n',encoding='utf-8');print(json.dumps(s))
