"""Independent saved-evidence reader; no producer imports, writes outside review, or launches."""
from pathlib import Path
import json, hashlib, csv, io, copy

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'evidence/browser-v1'
CLI = ROOT / 'output/playwright/history-browser-v1'
def canon(v): return json.dumps(v, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
def sha(v): return hashlib.sha256(v if isinstance(v, bytes) else v.encode()).hexdigest()
def digest(v): return sha(canon(v))
def read(p): return json.loads(p.read_text(encoding='utf-8'))
def equal(a,b): assert canon(a) == canon(b), 'exact JSON mismatch'
def minus(v,*keys): return {k:x for k,x in v.items() if k not in keys}
def definition_id(v):
    return digest({'nodes':[{'id':n['id'],'type':n['type'],'data':minus(n.get('data',{}),'status','preview','rowCount','isOutdated','label')} for n in v['nodes']], 'edges':[{'source':e['source'],'target':e['target'],'targetHandle':e.get('targetHandle')} for e in v['edges']]})

# Physical declared scope, all four recursive module trees and explicit entry files.
inventory = read(ROOT/'evidence/identity-beforebrowser1/application-manifest.json')
rows = inventory['files']
assert len(rows) == 467 and len({r['path'] for r in rows}) == 467
actual = set()
for name in ['provider','reference-consumer','legacy-consumer','workbench']:
    for p in (ROOT/name).rglob('*'):
        assert not p.is_symlink()
        if p.is_file(): actual.add(p.relative_to(ROOT).as_posix())
actual.update(['package.json','fixture.mjs','source-fixture.mjs','count-fixture.mjs','text-fixture.mjs','count-publication-fixture.mjs','scripts/bootstrap.mjs','scripts/workbench-server.mjs','scripts/browser-history-server.mjs'])
assert actual == {r['path'] for r in rows}
for r in rows:
    b=(ROOT/r['path']).read_bytes(); assert len(b)==r['bytes'] and sha(b)==r['sha256'],r['path']
roster=sha(''.join(f"{r['path']}\t{r['bytes']}\t{r['sha256']}\n" for r in rows))
assert roster == inventory['rosterSha256'] == '93ac0baf3f24b0d1acaeb9947fee3b12f1fb385f82b640e72202fd59093a4a1b'
assert sum(r['bytes'] for r in rows)==64303151
equal(inventory,read(ROOT/'evidence/identity-afterbrowser1/application-manifest.json'))
for name in ['server','proof-utils']:
    source=ROOT/('scripts/browser-history-server.mjs' if name=='server' else 'scripts/proof-utils.mjs')
    assert source.read_bytes()==(OUT/f'executed-{name}.mjs').read_bytes()
assert (ROOT/'count-publication-fixture.mjs').read_bytes()==(OUT/'executed-count-publication-fixture.mjs').read_bytes()

configA,configB=[read(OUT/f'config-parent-{x}.json') for x in ['a','b']]
assert 'publicationRegistry' in configA and 'publicationRegistry' not in configB
equal(minus(configA,'history','publicationRegistry'),minus(configB,'history'))
equal(minus(configA['history'],'create'),minus(configB['history'],'create'))
assert configA['history']['create'] is True and configB['history']['create'] is False
pins=configA['sourcePins']; assert len(pins)==len({p['path'] for p in pins})
for p in pins: assert sha(Path(p['path']).read_bytes())==p['sha256'],p['path']

commits=[read(p) for p in sorted((OUT/'data/history/commits').glob('*.json'))]
assert len(commits)==6
parent=None
for i,c in enumerate(commits):
    file=OUT/f'data/history/commits/{i+1:06d}.json'
    assert file.read_bytes()==(canon(c)+'\n').encode()
    assert c['protocol']=='siren.publication-history/1' and c['sequence']==i+1
    assert c['parentSha256']==parent and c['digest']==digest(minus(c,'digest'))
    assert c['authoritySha256']==digest(c['authority'])
    equal(c['authority'],commits[0]['authority']); parent=c['digest']
    s=c['state']; assert s['revision']==i and len(s['definitions'])==i and len(s['catalogs'])==i+1
    assert c['authority']['grantRoot']==configB['workDir']
    assert c['authority']['grantId']==configB['history']['grantId']
    assert c['authority']['storeId']==configB['history']['storeId']
    assert c['authority']['baseCatalogSha256']==digest(s['base'])
    if i:
        prev=commits[i-1]['state']; equal(s['base'],prev['base'])
        equal(s['definitions'][:-1],prev['definitions']); equal(s['catalogs'][:-1],prev['catalogs'])
    for j,cat in enumerate(s['catalogs']):
        assert cat['catalogVersion']==f'2.0.{j}' and cat['catalogSha256']==digest(minus(cat,'catalogSha256'))
        assert len(cat['capabilities'])==70+j
        for e in cat['capabilities']: assert e['descriptorSha256']==digest(minus(e,'descriptorSha256'))
    for d in s['definitions']:
        assert d['fingerprint']==digest(d['submitted'])
        equal(d['submitted'],d['publication']) # all browser inputs already canonical absolute
        assert definition_id(d['publication']['definition'])==d['descriptor']['workflowRef']['definitionSha256']

state=commits[-1]['state']; old=state['catalogs'][1]; latest=state['catalogs'][-1]
equal(read(OUT/'catalog-parent-a.json'),old)
equal(read(OUT/'catalog-parent-b.json'),latest);equal(read(OUT/'catalog-restored.json'),latest)
for j in range(1,6): equal(state['catalogs'][j]['capabilities'][:-1],state['catalogs'][j-1]['capabilities'])
publication=state['definitions'][0]['publication']; descriptor=state['definitions'][0]['descriptor']

events=read(OUT/'events.json')
expected_events=['catalog','run-request','run-complete','saved-form','proof-publication','catalog','owner-setup-restart','catalog','opened-form','run-request','run-complete']
assert [e['type'] for e in events]==expected_events
saved=events[3]; formfile=OUT/saved['file']; form=read(formfile)
assert formfile.stat().st_size==2503 and sha(formfile.read_bytes())==saved['sha256']==events[8]['sha256']
binding={'catalogId':old['catalogId'],'catalogVersion':old['catalogVersion'],'catalogSha256':old['catalogSha256'],'contractVersion':old['contractVersion'],'capabilityId':descriptor['id'],'capabilityVersion':descriptor['version'],'descriptorSha256':descriptor['descriptorSha256'],'workflowRef':descriptor['workflowRef'],'workflowId':descriptor['workflowRef']['workflowId'],'workflowVersion':descriptor['workflowRef']['workflowVersion']}
equal(form['functions'][0]['reference'],binding)
assert form['controls'][0]['defaultValue']=='' and form['controls'][0]['required'] is False
assert form['functions'][0]['parameters'][0]['default']=='00120'
assert publication['parameterSchema']['properties']['criterion']['minLength']==0
assert publication['parameterSchema']['required']==[]

# Expected COUNTIF is reconstructed from the actual complete source population, not author oracle.
source_input=next(n for n in publication['definition']['nodes'] if n['id']=='source')
right_input=next(n for n in publication['definition']['nodes'] if n['id']=='right')
labels=['00120',' ALPHA ','\u00e9clair','e\u0301cole','\u4f60\u597d','\U0001f600Z','',r'\N']
leftrows=list(csv.reader(io.StringIO(Path(source_input['data']['path']).read_text(encoding='utf8')),delimiter=';'))
rightrows=list(csv.reader(io.StringIO(Path(right_input['data']['path']).read_text(encoding='utf8')),delimiter=';'))
assert len(leftrows)==81 and len(rightrows)==11 and len(leftrows[0])==12
assert leftrows[0][-1]=='label' and [r[-1] for r in leftrows[1:]]==labels*10
assert sum(r[-1]=='' for r in leftrows[1:])==10 and sum(r[-1]==r'\N' for r in leftrows[1:])==10
assert len({r[0] for r in rightrows[1:]})==10 and sum(r[0]=='' for r in rightrows[1:])==1
for n in [source_input,right_input]:
    equal({k:n['data'][k] for k in ['format','header','delimiter','allVarchar','nullStr']},{'format':'csv','header':True,'delimiter':';','allVarchar':True,'nullStr':r'\N'})

receipts=[]; rawjobs=[]
for request_event in [events[1],events[9]]:
    request=request_event['request']; rid=request['jobId']; equal(request['form'],form)
    equal(request['values'],{'parameter_0':''}); assert request['buttonId']=='run'
    r=read(OUT/f'receipt-{rid}.json'); raw=read(next(OUT.glob(request_event['parent']+'-raw-*.json')))
    receipts.append(r);rawjobs.append(raw)

def validate_execution(r,raw):
    assert r['status']=='COMPLETED' and raw['status']=='completed' and raw['settled'] is True and raw['error'] is None
    assert r['jobId']==raw['requestId'] and r['analysisJobId']==raw['jobId']
    assert r['formId']==form['formId'] and r['buttonId']=='run'
    assert r['valuesRevision']==canon({'parameter_0':''})
    equal(json.loads(r['executionRevision'])['functions'][0]['reference'],binding)
    equal(r['execution'],raw)
    t=r['outputs']['output']; result=raw['result'];equal(minus(t,'kind','rowCount','returnedRows'),result)
    assert t['kind']=='table' and t['rowCount']==t['returnedRows']==1
    assert result['integritySha256']==digest(minus(result,'integritySha256'))
    equal(result['rows'],[{'conditional_count':'10'}])
    equal(result['schema'],[{'name':'conditional_count','dbType':'BIGINT','nullable':True,'unit':'rows','wireSchema':{'type':'string','x-wire':'int64'}}])
    equal(result['coverage'],{'status':'COMPLETE','sourceRows':90,'resultRows':1,'transferredRows':1,'reason':None})
    equal(raw['workflowRef'],binding['workflowRef']);p=result['provenance'];equal(p['workflowRef'],binding['workflowRef'])
    assert p['jobId']==raw['jobId'] and p['requestId']==raw['requestId']
    assert result['resultId']==raw['jobId']+':count' and result['resultVersion']=='job:'+raw['jobId']
    assert p['sourceCurrentAvailability']=='UNKNOWN' and p['fullResultRetention']=='NOT_GUARANTEED'
    assert p['parameterSha256']==digest({'criterion':''})
    assert [s['nodeId'] for s in p['sources']]==['source','right']
    pipeline=copy.deepcopy(publication['definition'])
    for src,n in zip(p['sources'],[source_input,right_input]):
        original=Path(n['data']['path']).read_bytes(); captured=Path(src['snapshotPath']).read_bytes()
        assert captured==original and sha(captured)==src['sha256'] and len(captured)==src['bytes']
        assert src['sourceId']==sha(n['data']['path']) and src['observation']=='VERIFIED_EXECUTION_COPY' and src['originalCurrentAvailability']=='UNKNOWN'
        next(x for x in pipeline['nodes'] if x['id']==src['nodeId'])['data']['path']=src['snapshotPath']
    count=next(n for n in pipeline['nodes'] if n['id']=='count')
    assert count['data']['countModel']['criteria']['rules'][0]['value']=='00120'
    count['data']['countModel']['criteria']['rules'][0]['value']=''
    assert p['executedDefinitionSha256']==definition_id(pipeline)

for r,raw in zip(receipts,rawjobs): validate_execution(r,raw)
assert len({r['analysisJobId'] for r in receipts})==2 and len({r['jobId'] for r in receipts})==2

restart=read(OUT/'restart.json');closures=read(OUT/'closures.json');shutdown=read(OUT/'shutdown.json')
def validate_restart(restart,closures,config):
    assert restart['beforePid']==64740 and restart['afterPid']==46640 and restart['beforePid']!=restart['afterPid']
    assert restart['noRegistry'] is True and restart['catalogVersion']=='2.0.5' and 'publicationRegistry' not in config
    assert [x['label'] for x in closures]==['parent-a','parent-b']
    for x,pid in zip(closures,[restart['beforePid'],restart['afterPid']]):
        assert x['closed'] is True and x['receipt']['closed'] is True
        equal(x['exit'],{'pid':pid,'code':0,'signal':None});equal(x['receipt']['host'],x['exit'])
        assert len(x['receipt']['receipts'])==1
        w=x['receipt']['receipts'][0];assert w['closed'] is True and w['code'] is None and w['signal']=='SIGKILL' and type(w['pid']) is int and w['pid']>0
    assert len({x['receipt']['receipts'][0]['pid'] for x in closures})==2
validate_restart(restart,closures,configB)
assert shutdown['closed'] is True and shutdown['allPinnedSourcesUnchanged'] is True and shutdown['savedFormsUnchanged'] is True
equal(shutdown['closures'],closures)

commands=[read(p) for p in sorted(CLI.glob('command-*.json'))]
assert len(commands)==22
assert [i+1 for i,x in enumerate(commands) if x['exit']!=0]==[2,4]
verbs=[x['command'][3] for x in commands]
assert verbs==['open','snapshot','snapshot','select','select','snapshot','fill','click','snapshot','click','click','click','snapshot','fill','click','click','snapshot','click','snapshot','screenshot','console','close']
assert commands[6]['command'][-1]=='' and commands[13]['command'][-1]=='CHANGED_UNSAVED'
assert 'not open' in (CLI/'command-002.txt').read_text() and 'did not find some options' in (CLI/'command-004.txt').read_text()
assert 'Total messages: 0 (Errors: 0, Warnings: 0)' in (CLI/'command-021.txt').read_text()
for n in ['configured','published','reopened','run-a','run-b']:
    txt=(CLI/f'{n}.yml').read_text(encoding='utf8')
    assert '\\"catalogVersion\\":\\"2.0.1\\"' in txt
    if n in ['published','reopened','run-b']: assert '2.0.5 · 75 capabilities' in txt
    if n in ['run-a','run-b']: assert 'cell "10"' in txt and 'source 90 rows · result 1 rows · transferred 1' in txt

# Finite independent oracle controls. Rehash all three result surfaces coherently;
# a checksum/equality-only oracle would accept them. No producer artifact is changed.
controls=[]
def refuse(name,call):
    try: call()
    except AssertionError: controls.append({'name':name,'refused':True});return
    raise AssertionError('adverse admitted: '+name)
def mutant_result(change):
    r=copy.deepcopy(receipts[1]);raw=copy.deepcopy(rawjobs[1]);change(raw['result'])
    raw['result']['integritySha256']=digest(minus(raw['result'],'integritySha256'))
    r['execution']=copy.deepcopy(raw);r['outputs']['output']={'kind':'table',**copy.deepcopy(raw['result']),'rowCount':1,'returnedRows':1}
    validate_execution(r,raw)
for name,change in [
    ('coherent-count11',lambda t:t['rows'][0].update(conditional_count='11')),
    ('coherent-Number10',lambda t:t['rows'][0].update(conditional_count=10)),
    ('coherent-sourceRows80',lambda t:t['coverage'].update(sourceRows=80)),
    ('coherent-unit-values',lambda t:t['schema'][0].update(unit='values')),
    ('coherent-extra-scale',lambda t:t['schema'][0]['wireSchema'].update(scale=0)),
    ('coherent-wrong-criterion',lambda t:t['provenance'].update(parameterSha256=digest({'criterion':'00120'}))),
    ('coherent-current-source-known',lambda t:t['provenance'].update(sourceCurrentAvailability='UNCHANGED'))]:
    refuse(name,lambda change=change:mutant_result(change))
for name,change in [('silent-latest-pin',lambda r:r['functions'][0]['reference'].update(catalogVersion='2.0.5',catalogSha256=latest['catalogSha256'])),('old-pin-body-tamper',lambda r:r['functions'][0]['reference'].update(descriptorSha256='0'*64))]:
    def check(change=change):
        f=copy.deepcopy(form);change(f);equal(f['functions'][0]['reference'],binding)
    refuse(name,check)
for name,change in [('same-parent',lambda a,b,c:a.update(afterPid=a['beforePid'])),('false-child-closure',lambda a,b,c:b[1]['receipt']['receipts'][0].update(closed=False)),('truthy-host-exit',lambda a,b,c:b[1]['exit'].update(code=False)),('registry-replayed',lambda a,b,c:c.update(publicationRegistry='unexpected'))]:
    refuse(name,lambda change=change: (lambda a,b,c:(change(a,b,c),validate_restart(a,b,c)))(copy.deepcopy(restart),copy.deepcopy(closures),copy.deepcopy(configB)))

result={'reviewAuthor':'test_claim_review','mode':'independent read-only source, physical saved-file and in-memory adverse review; no browser/RPC/native execution','finished':True,'roster':roster,'files':len(rows),'bytes':sum(r['bytes'] for r in rows),'sourcePins':len(pins),'committedRecords':len(commits),'observedPendingFiles':len(list((OUT/'data/history/staging').glob('*.json'))),'rawExecutions':len(rawjobs),'expectedEmptyCount':10,'savedFormBytes':formfile.stat().st_size,'savedFormSha256':sha(formfile.read_bytes()),'providerPids':[restart['beforePid'],restart['afterPid']],'workerClosureSignals':['SIGKILL','SIGKILL'],'failedHistoricalCLICommands':[2,4],'corruptionControls':controls,'physicalPins':{str(p.relative_to(ROOT)):sha(p.read_bytes()) for p in [ROOT/'provider/src/provider.mjs',ROOT/'provider/src/history-state.mjs',ROOT/'provider/src/publication-store.mjs',ROOT/'scripts/bootstrap.mjs',ROOT/'scripts/browser-history-server.mjs',OUT/'events.json',OUT/'closures.json',formfile,CLI/'old-pin-after-restart.png']}}
with (ROOT/'review/browser-readback-v1.json').open('x',encoding='utf8') as f:json.dump(result,f,ensure_ascii=False,indent=2);f.write('\n')
print(json.dumps({k:v for k,v in result.items() if k not in ['physicalPins','corruptionControls']}))
