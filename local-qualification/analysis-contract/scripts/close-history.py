"""Final identity/readback index; does not replace independent reviewers or rerun product."""
from pathlib import Path
import hashlib,json
r=Path(__file__).resolve().parents[1]
def read(p):return json.loads(p.read_text(encoding='utf-8-sig'))
def pin(p):return {'path':p.relative_to(r).as_posix(),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
bookends=[r/'evidence'/('identity-'+n)/'application-manifest.json' for n in ['beforebrowser1','afterbrowser1','final1']]
assert len({p.read_bytes() for p in bookends})==1
m=read(bookends[0]);assert m['fileCount']==467 and m['bytes']==64303151 and m['rosterSha256']=='93ac0baf3f24b0d1acaeb9947fee3b12f1fb385f82b640e72202fd59093a4a1b'
for row in m['files']:
 p=r/row['path'];assert p.is_file() and not p.is_symlink();assert pin(p)==row
rpc=read(r/'evidence/rpc-v2/RESULT.json');assert rpc['finished'] and len(rpc['records'])==9 and all(x['pass'] for x in rpc['records'])
assert len(rpc['connections'])==9 and all(c['closed'] for c in rpc['connections'])
process=read(r/'evidence/process-v1/RESULT.json');assert process['allPassed'] and process['allClosed'] and not process['unexpectedCleanup'] and len(process['groups'])==3
browser=read(r/'evidence/browser-v1/shutdown.json');assert browser['closed'] and len(browser['closures'])==2 and browser['savedFormsUnchanged'] and browser['allPinnedSourcesUnchanged']
review_names=['history-provider-source-review.md','store-and-history-state-review.md','history-rpc-artifact-review.md','history-process-artifact-review.md','history-browser-artifact-review.md']
reviews=[pin(r/'review'/n) for n in review_names]
evidence=['evidence/rpc-v2/RESULT.json','evidence/process-v1/RESULT.json','evidence/browser-v1/shutdown.json','evidence/browser-v1/restart.json','evidence/process-observation-v2.json','evidence/TOOLING_ATTEMPTS.md']
evidence += [str(p.relative_to(r)) for p in (r/'evidence/browser-v1').glob('form-*.sirenui.json')]
evidence += ['evidence/rpc-v2/saved-history-form.sirenui.json']
out=r/'evidence/closure-v1.json'
with out.open('x',encoding='utf-8') as f:json.dump({'scope':'Final current identity and exact evidence/report index; Root read all five reviews before final verdict; no rerun or pooled test count','application':{k:m[k] for k in ['fileCount','bytes','rosterSha256','added','changed','removed','old464DonorUnchanged']},'reviews':reviews,'bookends':[pin(p) for p in bookends],'evidence':[pin(r/p) for p in evidence]},f,indent=2);f.write('\n')
print(json.dumps({'fileCount':m['fileCount'],'rosterSha256':m['rosterSha256'],'reviews':reviews,'savedForms':[pin(p) for p in (r/'evidence/browser-v1').glob('form-*.sirenui.json')]}))
