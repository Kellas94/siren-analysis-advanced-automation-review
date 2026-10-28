from pathlib import Path
import json,hashlib,copy
r=Path(__file__).resolve().parents[1];work=r.parent
read=lambda p:json.loads(p.read_text(encoding='utf-8-sig'));hashfile=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();canon=lambda x:json.dumps(x,sort_keys=True,separators=(',',':'),ensure_ascii=False)
oldpath=work/'analysis-count-functions-v1/catalog.base.next.json';newpath=r/'catalog.base.next.json';old=read(oldpath);new=read(newpath);a={c['id']:c for c in old['capabilities']}
assert hashfile(oldpath)=='4355a36b6e4829929ae5ebb5a44c1d5303da4b56d763a7055f0d8ac430b7bed1';assert hashfile(newpath)=='30a1b086c370dce3f3cf06c54526b8775694bcb660b477a7f856a29f08d2c42e'
changed=['analysis.count.configure','analysis.countif.configure']
def check(d):
 assert d['catalogVersion']=='1.11.0','catalog version'
 assert d['schemaVersion']==old['schemaVersion'] and d['contractVersion']==old['contractVersion'],'wrapper identity'
 assert d['status']=='PROVISIONAL_ISOLATED_EXPLICIT_INTAKE_REQUIRED','unadopted status'
 assert len(d['capabilities'])==70,'count'
 b={c['id']:c for c in d['capabilities']};assert len(b)==70 and b.keys()==a.keys(),'identity set'
 assert [key for key in a if canon(a[key])!=canon(b[key])]==changed,'exact2 descriptor changes'
 assert all(c['invocation']['endpoint'] is None for c in b.values()),'no remote endpoints'
 for key in changed:
  c=b[key];assert c['availability']['prototype']=='IMPLEMENTED' and c['availability']['contract']=='IN_CONSTRUCTION','local/common status'
  assert c['invocation']==a[key]['invocation'],'same local invocation'
  assert c['kind']=='ui-action','action kind'
 c=b[changed[0]];assert c['version']=='1.1.0','COUNT capability version';assert c['result']==a[c['id']]['result'],'COUNT result'
 p=c['parameters'];assert p['type']=='object' and p['additionalProperties'] is False and set(p['required'])=={'nodeId','countModel'},'outer closed fields'
 m=p['properties']['countModel'];assert m['type']=='object' and m['additionalProperties'] is False and set(m['properties'])==set(m['required'])=={'version','operation','column'},'COUNT closed union'
 assert m['properties']['version']=={'const':'analysis.conditional-count/1'},'model unchanged'
 assert m['properties']['operation']=={'const':'count','default':'count'},'operation'
 assert m['properties']['column']['type']=='string' and m['properties']['column']['minLength']==1 and 'default' not in m['properties']['column'],'required selection'
 assert 'VARCHAR or BOOLEAN' in m['properties']['column']['description'],'type policy'
 assert 'Empty text, zero and false' in c['description'],'nonNULL policy'
 c=b[changed[1]];assert c['version']=='1.0.1','COUNTIF editorial version'
 assert c['parameters']==a[c['id']]['parameters'] and c['result']==a[c['id']]['result'] and c['execution']==a[c['id']]['execution'],'COUNTIF no behavioral schema changes'
 keys={k for k in c if canon(c[k])!=canon(a[c['id']][k])};assert keys=={'version','notes','limits','uiExposure'},'COUNTIF only editorial changes'
 assert c['parameters']['properties']['countModel']['properties']['criteria']['properties']['rules']['maxItems']==1,'single rule'
 return {'entries':70,'unchangedCompleteObjects':68,'changed':changed,'allEndpointsNull':True}
records=[{'name':'Actual Root catalog policy preservation','pass':True,'details':check(new)}]
def change_entry(d,id):return next(c for c in d['capabilities'] if c['id']==id)
mutations=[
 ('old catalog version',lambda d:d.update(catalogVersion='1.10.0')),
 ('invented adopted status',lambda d:d.update(status='ACCEPTED_LIVE')),
 ('unversioned text capability',lambda d:change_entry(d,changed[0]).update(version='1.0.0')),
 ('invented common execution',lambda d:change_entry(d,changed[0])['availability'].update(contract='IMPLEMENTED')),
 ('remote endpoint',lambda d:change_entry(d,changed[0])['invocation'].update(endpoint='execute')),
 ('ignored latent criteria slot',lambda d:change_entry(d,changed[0])['parameters']['properties']['countModel']['properties'].update(criteria={'type':'object'})),
 ('missing required column',lambda d:change_entry(d,changed[0])['parameters']['properties']['countModel']['required'].remove('column')),
 ('fake successful empty default',lambda d:change_entry(d,changed[0])['parameters']['properties']['countModel']['properties']['column'].update(default='')),
 ('Countif rules widened2',lambda d:change_entry(d,changed[1])['parameters']['properties']['countModel']['properties']['criteria']['properties']['rules'].update(maxItems=2)),
 ('Countif result changed',lambda d:change_entry(d,changed[1])['result'].update(kind='table')),
 ('prior unrelated object changed',lambda d:d['capabilities'][0].update(version='999.0.0')),
 ('duplicate capability',lambda d:d['capabilities'].__setitem__(0,copy.deepcopy(d['capabilities'][1])))
]
for name,mutate in mutations:
 d=copy.deepcopy(new);mutate(d);refused=False
 try:check(d)
 except AssertionError:refused=True
 assert refused,name;records.append({'name':'Refused '+name,'pass':True})
pinned={
 'provider':('analysis-function-contract-v2/provider/src/provider.mjs','aff0d6da1c2f2f2b0f8a432179ca5bce370e55e7e3839e912f738d7797af1ce0'),
 'wire':('analysis-function-contract-v2/provider/src/contract.mjs','b52ff1742a87f91450d16d39ec35158f60b7edb9066df95e83a0418a5d6916fe'),
 'consumer':('analysis-function-contract-v2/reference-consumer/mini_ui/analysis_catalog_consumer.mjs','5bf9da4db35d94df6afce8803e67c49348e024a8b26c5aaaeba370b07e9eca57'),
 'oldCurrentSavedForm':('vb-r2-compatibility-review-v1/evidence/rpc-native-v1/current/configured.sirenui.json','1e0ea053f5ec15f536dc02763ff15908bbd223ba83d3aacb2949afe92c22d0d8'),
 'oldSnapshotSavedForm':('vb-r2-compatibility-review-v1/evidence/rpc-native-v1/snapshot/configured.sirenui.json','34d0aa858ccbfae885d8908da13da5f1412ff9600440ab2269e2801f48707123'),
 'originalProposal':('analysis-count-text-v2/review/proposed-catalog.json','3736a3955c9fb4c69e0f2a7afc58d950ecd5f4e7f3d2d968f67350ade790d5e7'),
 'textCountHelper':('analysis-count-text-v2/candidate/analysis/engine/conditional-count.js','5a3523677a2f4aa8b8b3f738d5b29ef74e9bf894a139788bf5861f2abd45dc31'),
 'textCountEditor':('analysis-count-text-v2/candidate/analysis/src/flow/CountEditor.jsx','e9df8dacfe17d037333123bffef37098be006f776df3eaa4762b3afb18cf799c')}
for name,(rel,sha)in pinned.items():assert hashfile(work/rel)==sha,name
out=r/'review/catalog-text-controls-v1.json';assert not out.exists();data={'reviewer':'Codex test_claim_review, separate from actual catalog delta author Root','mode':'Read-only saved JSON/source policy reader; negative in-memory copies only. Not product validation runtime, provider/native execution or schema engine qualification','finished':True,'actualCatalogSha256':hashfile(newpath),'originalCatalogSha256':hashfile(oldpath),'generatorSha256':hashfile(r/'scripts/catalog-text.mjs'),'constructionRecordSha256':hashfile(r/'evidence/catalog-text-construction.json'),'records':records,'selectedPins':{k:{'path':v[0],'sha256':v[1]}for k,v in pinned.items()}};out.write_text(json.dumps(data,indent=2),encoding='utf-8');print(json.dumps({'records':len(records),'negativeRefusals':len(mutations),'catalog':data['actualCatalogSha256'],'readerResultSha256':hashfile(out),'generator':data['generatorSha256']},indent=2))
