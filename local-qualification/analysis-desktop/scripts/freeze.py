from pathlib import Path
import hashlib,json,sys
r=Path(__file__).resolve().parents[1];a=r/'candidate/analysis';d=r.parent/'analysis-count-functions-v1';v=sys.argv[1]
if not v.isalnum():raise RuntimeError('Version')
out=r/'evidence'/('identity-'+v);out.mkdir()
def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
 return h.hexdigest()
rows=[]
for p in sorted(a.rglob('*')):
 if p.is_symlink():raise RuntimeError('Reparse entry')
 if p.is_file():rows.append({'path':p.relative_to(a).as_posix(),'bytes':p.stat().st_size,'sha256':sha(p)})
old=json.loads((d/'evidence/identity-finalv1/application-manifest.json').read_text(encoding='utf-8'))
for x in old['files']:
 if sha(d/'candidate/analysis'/x['path'])!=x['sha256']:raise RuntimeError('Donor drift')
prior={x['path']:x for x in old['files']};now={x['path']:x for x in rows};changed=sorted(k for k in set(prior)&set(now) if prior[k]['sha256']!=now[k]['sha256']);added=sorted(set(now)-set(prior));removed=sorted(set(prior)-set(now))
allowed={'engine/conditional-count.js','desktop_package/resources/app/engine/conditional-count.js','src/flow/CountEditor.jsx','dist/bundle.js','dist/bundle.js.map','desktop_package/resources/app/dist/bundle.js','desktop_package/resources/app/dist/bundle.js.map'}
if removed or any(p not in allowed for p in changed+added):raise RuntimeError('Unexpected delta '+str([changed,added,removed]))
roster=lambda xs:hashlib.sha256(''.join(f"{x['path']}\t{x['bytes']}\t{x['sha256']}\n" for x in xs).encode()).hexdigest()
maps=[]
for n in ['bundle.js.map','bundle.css.map']:
 m=json.loads((a/'dist'/n).read_text(encoding='utf-8'))
 if len(m['sources'])!=len(m['sourcesContent']):raise RuntimeError('Incomplete map')
 for f,t in zip(m['sources'],m['sourcesContent']):
  if (a/'dist'/f).resolve().read_text(encoding='utf-8')!=t.replace('\r\n','\n'):raise RuntimeError('Map body mismatch '+f)
 maps.append({'file':n,'sourcesMatched':len(m['sources'])})
pairs=[('dist/'+n,'desktop_package/resources/app/dist/'+n) for n in ['bundle.js','bundle.js.map','bundle.css','bundle.css.map','index.html']]+[('desktop/'+n,'desktop_package/resources/app/'+n) for n in ['main.cjs','preload.cjs','close_coordinator.cjs']]+[('engine/'+n,'desktop_package/resources/app/engine/'+n) for n in ['pipeline_compiler.js','worker_process.js','filter-criteria.js','filter-binding.js','derived-columns.js','derived-binding.js','conditional-functions.js','conditional-binding.js','conditional-count.js','graph-identity.js']]
for s,t in pairs:
 if sha(a/s)!=sha(a/t):raise RuntimeError('Pair mismatch '+t)
pkg=[{**x,'path':x['path'][len('desktop_package/'):]} for x in rows if x['path'].startswith('desktop_package/')]
summary={'scope':'Own isolated desktop source/generated/native package; no installed/main/migration','fileCount':len(rows),'bytes':sum(x['bytes'] for x in rows),'rosterSha256':roster(rows),'added':added,'changed':changed,'removed':removed,'maps':maps,'pairs':len(pairs),'donorUnchanged':True,'packageFiles':len(pkg),'packageBytes':sum(x['bytes'] for x in pkg),'packageRosterSha256':roster(pkg)}
(out/'application-manifest.json').write_text(json.dumps({**summary,'files':rows},indent=2)+'\n',encoding='utf-8');(out/'package-manifest.json').write_text(json.dumps({'files':pkg,'rosterSha256':roster(pkg)},indent=2)+'\n',encoding='utf-8');(out/'summary.json').write_text(json.dumps(summary,indent=2)+'\n',encoding='utf-8');print(json.dumps(summary))
