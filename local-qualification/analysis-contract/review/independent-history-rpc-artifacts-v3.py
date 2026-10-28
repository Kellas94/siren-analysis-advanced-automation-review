"""Retrospective independent reader only: no provider/SQL/process/author imports."""
from pathlib import Path
import copy,csv,hashlib,io,json,traceback
from decimal import Decimal

ROOT=Path(__file__).resolve().parents[1]
RPC=ROOT/'evidence/rpc-v2'
OUT=ROOT/'review/independent-history-rpc-artifacts-v3'
OUT.mkdir(exist_ok=False)
def read(p):return json.loads(Path(p).read_text(encoding='utf8'))
def canonical(o):return json.dumps(o,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False)
def sha(o):return hashlib.sha256(o if isinstance(o,bytes) else o.encode('utf8') if isinstance(o,str) else canonical(o).encode('utf8')).hexdigest()
def same(a,b,message='Different actual values/types'):
    assert (a==b if isinstance(a,bytes) and isinstance(b,bytes) else canonical(a)==canonical(b)),message
def check(ok,message):assert ok,message
def csvrows(p,null):
    rows=list(csv.reader(io.StringIO(Path(p).read_text(encoding='utf8')),delimiter=';',strict=True))
    return [dict(zip(rows[0],[None if v==null else v for v in r])) for r in rows[1:]]
def identity(d):
    return sha({'nodes':[{'id':n['id'],'type':n['type'],'data':{k:v for k,v in n.get('data',{}).items() if k not in ['status','preview','rowCount','isOutdated','label']}} for n in d['nodes']], 'edges':[{'source':e['source'],'target':e['target'],'targetHandle':e.get('targetHandle')} for e in d['edges']]})
records=[];refusals=[]
def record(name,detail):records.append({'name':name,'pass':True,'detail':detail})
def refuse(name,fn):
    try:fn()
    except (AssertionError,KeyError,ValueError,IndexError,TypeError) as e:refusals.append({'name':name,'refused':True,'message':str(e)[:240]});return
    raise AssertionError('Corruption was admitted: '+name)

NAMES=[
'Parent A commits exact catalog0 through7 and saves configured older reference before normal closure',
'New native parent with no publication registry restores exact old catalog pin and executes unchanged saved form',
'Recovered metadata retains wide integer decimal NULL text and separate90/92 source populations',
'Historical workflow reference uses newly captured authorized data rather than pretending historical input retention',
'History rehydrates with missing current file; execution refuses and restored source retries without rewriting form',
'Recovered workflow retains actual own worker cancellation and fresh retry',
'Exact owner publication retries after restart do not create replacement versions or duplicate commits',
'Wrong trusted grant and absent history refuse before ready without implicit initialization',
'Coherently rehashed old-unit rewrite and missing middle commit refuse while original history and form remain intact']
LABELS=['parent-a','parent-b','parent-c-missing','parent-c-restored','parent-d-exact-retry','wrong-grant','missing-history','corrupt-prefix','missing-middle']
JOB_SPEC=[('a-empty-v1','parent-a','analysis.shared-count.text','1.0.0','count','10',90,{'criterion':''}),('b-old-pin-empty','parent-b','analysis.shared-count.text','1.0.0','count','10',90,{'criterion':''}),('b-wide-lookup','parent-b','analysis.shared-count.lookup','1.0.0','lookup',None,90,{}),('b-sum','parent-b','analysis.workflow.user-sum','1.0.0','sum','63050394783186951',92,{'minimumId':60}),('b-decimal','parent-b','analysis.workflow.user-decimal','1.0.0','sum','1053.0000000027',92,{'minimumId':0}),('b-current-input-changed','parent-b','analysis.shared-count.text','1.0.0','count','9',90,{'criterion':''}),('c-source-restored','parent-c-restored','analysis.shared-count.text','1.0.0','count','10',90,{'criterion':''}),('c-false','parent-c-restored','analysis.shared-count.boolean','1.0.0','count','53',90,{'criterion':False}),('c-cancel-retry','parent-c-restored','analysis.shared-count.text','1.0.0','count','10',90,{'criterion':''}),('d-exact-publication-retry','parent-d-exact-retry','analysis.shared-count.text','1.0.0','count','10',90,{'criterion':''})]
def connection_gate(result):
    same([r['name'] for r in result['records']],NAMES,'Exact nine named RPC record roster')
    check(result['finished'] is True and all(r['pass'] is True for r in result['records']),'Root completion missing')
    same([c['label'] for c in result['connections']],LABELS,'Exact nine connection roster')
    pids=[]
    for i,c in enumerate(result['connections']):
        check(c['closed'] is True and c['providerAdmitted'] is True,'Connection unclosed or missing source-pin admission')
        check(type(c['exit']['pid']) is int and c['exit']['pid']>0,'Invalid parent PID');pids.append(c['exit']['pid'])
        same(c['exit']['signal'],None)
        if i<5:
            check(c['ready'] is True and c['exit']['code']==0,'Ready parent did not close normally')
            receipt=read(RPC/(c['label']+'-close.json'));transport=read(RPC/(c['label']+'-transport.json'))
            same(receipt,{'closed':True,'host':c['exit'],'receipts':c['receipts']},'Close receipt/RESULT contradiction')
            same({k:transport[k] for k in ['exit','closed','ready','providerAdmitted']},{k:c[k] for k in ['exit','closed','ready','providerAdmitted']})
            check(c['receipts'] and all(r['closed'] is True and r['code'] is None and r['signal'] in ['SIGKILL','SIGTERM'] for r in c['receipts']),'Managed worker termination missing')
        else:
            check(c['ready'] is False and c['exit']['code']==1 and c['receipts']==[],'Startup refusal relabeled normal or worker-ready')
            refusal=read(RPC/(c['label']+'-startup.json'))
            same(refusal['exit'],c['exit']);check(refusal['receipt']['startupRefused'] is True and refusal['receipt']['closed'] is True,'Startup close missing')
            same(refusal['receipt']['host'],c['exit']);same(refusal['receipt']['receipts'],[])
            same(refusal['error']['code'],'ANALYSIS_HOST_UNAVAILABLE')
            expected=['HISTORY_AUTHORITY','HISTORY_MISSING','HISTORY_INVALID_STATE','HISTORY_CHAIN'][i-5]
            check(expected in refusal['error']['message'],'Wrong refused startup cause: '+expected)
    check(len(set(pids))==9,'Repeated parent identity')

def state_gate(commits):
    previous=None;authority=None
    for i,c in enumerate(commits):
        same(sorted(c),sorted(['authority','authoritySha256','digest','parentSha256','protocol','sequence','state']))
        same(c['protocol'],'siren.publication-history/1');same(c['sequence'],i+1)
        same(c['parentSha256'],None if previous is None else previous['digest'],'Commit chain differs')
        same(c['digest'],sha({k:v for k,v in c.items() if k!='digest'}),'Outer digest mismatch')
        same(c['authoritySha256'],sha(c['authority']),'Authority hash mismatch')
        if authority is None:authority=c['authority']
        same(c['authority'],authority)
        s=c['state'];same(s['format'],'siren.analysis-state/1');same(s['revision'],i)
        check(len(s['definitions'])==i and len(s['catalogs'])==i+1,'Revision/metadata count contradiction')
        same(sha(s['base']),authority['baseCatalogSha256']);same(s['base'],read(ROOT/'provider/catalog.base.json'))
        if previous:
            same(s['definitions'][:-1],previous['state']['definitions'],'Acknowledged definitions rewritten')
            same(s['catalogs'][:-1],previous['state']['catalogs'],'Acknowledged catalogs rewritten')
        known=[]
        for j,row in enumerate(s['definitions']):
            same(row['fingerprint'],sha(row['submitted']),'Submitted fingerprint mismatch')
            same(row['submitted'],row['publication'],'Submitted/source path mapping changed')
            p=row['publication'];desc=row['descriptor'];wr={'workflowId':p['id'],'workflowVersion':p['version'],'definitionSha256':identity(p['definition'])}
            same(desc['workflowRef'],wr);same(desc['id'],p['id']);same(desc['version'],p['version']);same(desc['parameters'],p['parameterSchema'])
            same(desc['title'],p['title']);same(desc['description'],p['description'])
            same(desc['descriptorSha256'],sha({k:v for k,v in desc.items() if k!='descriptorSha256'}))
            same(desc['publicationSha256'],sha({'workflowRef':wr,'parameterSchema':p['parameterSchema'],'bindings':p['bindings'],'outputNodeId':p['outputNodeId'],'units':p['units']}))
            known.append(desc)
        for j,cat in enumerate(s['catalogs']):
            same(cat['catalogSha256'],sha({k:v for k,v in cat.items() if k!='catalogSha256'}))
            same(cat['catalogVersion'],'2.0.'+str(j));same(cat['contractVersion'],'siren.analysis-execution/2.0.0')
            base=[]
            for d in s['base']['capabilities']:
                d=copy.deepcopy(d);d['descriptorSha256']=sha(d);base.append(d)
            same(cat['capabilities'],base+known[:j],'Catalog differs from exact historical descriptors')
        previous=c
    return commits[-1]['state']

def wire(db):
    if db.startswith('DECIMAL('):return {'type':'string','x-wire':'decimal','precision':38,'scale':10}
    return {'VARCHAR':{'type':'string'},'INTEGER':{'type':'integer'},'DOUBLE':{'type':'number'},'BOOLEAN':{'type':'boolean'},'BIGINT':{'type':'string','x-wire':'int64'},'UBIGINT':{'type':'string','x-wire':'uint64'},'UHUGEINT':{'type':'string','x-wire':'uint128'},'HUGEINT':{'type':'string','x-wire':'int128'}}[db]
def expected_lookup(source_rows,right_rows):
    mapping={r['lookup_key']:r['lookup_value'] for r in right_rows if r['lookup_key'] is not None}
    result=[]
    for r in source_rows[:50]:
        o=dict(r);o['id']=int(o['id']);o['floating']=None if o['floating'] is None else float(o['floating']);o['flag']=o['flag']=='true'
        label=o['label'];o.update(first=None if label is None else label[:1],last=None if label is None else label[-1:],middle=None if label is None else label[1:2],tag='=review',lookup_text=mapping.get(label) if label is not None else None);result.append(o)
    return result

def validate_job(spec,doc,raw,state):
    name,label,wfid,version,output,value,pop,params=spec
    check(doc['status']=='COMPLETED' and doc['jobId']==name and doc['formId']=='durable_history_form' and doc['buttonId']=='run','Service result status/ownership differs')
    jid=doc['analysisJobId'];check(isinstance(jid,str) and jid.startswith('job_'),'Native job absent')
    same(doc['execution'],raw,'Service/native raw status differs')
    check(raw['status']=='completed' and raw['settled'] is True and raw['error'] is None,'Raw native completion absent')
    same(raw['jobId'],jid);same(raw['requestId'],name);same(raw['contractVersion'],'siren.analysis-execution/2.0.0')
    result=raw['result'];table=doc['outputs']['table'];same({k:v for k,v in table.items() if k not in ['kind','rowCount','returnedRows']},result)
    same(result['integritySha256'],sha({k:v for k,v in result.items() if k!='integritySha256'}),'Result seal invalid')
    same(result['resultId'],jid+':'+output);same(result['resultVersion'],'job:'+jid)
    row=next(r for r in state['definitions'] if r['publication']['id']==wfid and r['publication']['version']==version)
    pub=row['publication'];same(raw['workflowRef'],row['descriptor']['workflowRef']);prov=result['provenance']
    same(prov['jobId'],jid);same(prov['requestId'],name);same(prov['workflowRef'],raw['workflowRef']);same(prov['parameterSha256'],sha(params))
    same(prov['sourceCurrentAvailability'],'UNKNOWN');same(prov['fullResultRetention'],'NOT_GUARANTEED')
    pipeline=copy.deepcopy(pub['definition'])
    for b in pub['bindings']:
        n=next(n for n in pipeline['nodes'] if n['id']==b['nodeId'])
        group=n['data']['countModel']['criteria'] if n['type']=='conditional_count' else n['data']['sumModel']['criteria']
        pval=params[b['parameter']];db=next(c['type'] for c in n['data']['countSchema' if n['type']=='conditional_count' else 'sumSchema'] if c['name']==group['rules'][b['ruleIndex']]['column'])
        group['rules'][b['ruleIndex']]['value']=str(pval) if db not in ['VARCHAR','BOOLEAN'] else pval
    source_inputs=[n for n in pipeline['nodes'] if n['type']=='input'];check(len(source_inputs)==len(prov['sources'])==2,'Expected two actual input snapshots')
    inputs={}
    for n,s in zip(source_inputs,prov['sources']):
        same(s['nodeId'],n['id']);same(s['sourceId'],sha(n['data']['path']));same(s['format'],'csv');same(s['observation'],'VERIFIED_EXECUTION_COPY');same(s['originalCurrentAvailability'],'UNKNOWN')
        p=Path(s['snapshotPath']);check(p.is_relative_to(RPC/'data/captured-inputs'),'Foreign source snapshot')
        data=p.read_bytes();same(s['sha256'],sha(data));same(s['bytes'],len(data));n['data']['path']=str(p)
        inputs[n['id']]=csvrows(p,n['data']['nullStr'])
    same(prov['executedDefinitionSha256'],identity(pipeline),'Executed graph/source/parameter identity differs')
    same(sum(map(len,inputs.values())),pop);coverage=result['coverage']
    lookup=output=='lookup';same(coverage,{'status':'SAMPLED' if lookup else 'COMPLETE','sourceRows':pop,'resultRows':80 if lookup else 1,'transferredRows':50 if lookup else 1,'reason':'FIRST_N_PREVIEW_NOT_STATISTICAL_SAMPLE' if lookup else None})
    same(table['rowCount'],coverage['resultRows']);same(table['returnedRows'],coverage['transferredRows']);same(table['kind'],'table')
    for c in result['schema']:same(c['wireSchema'],wire(c['dbType']));check(c['nullable'] is True,'Nullable metadata changed')
    if lookup:
        names=['id','numeric_text','num','big','u64','u128','s128','floating','text','flag','quoted"amount','label','first','last','middle','tag','lookup_text']
        dbs=['INTEGER','VARCHAR','DECIMAL(38,10)','BIGINT','UBIGINT','UHUGEINT','HUGEINT','DOUBLE']+['VARCHAR','BOOLEAN','BIGINT']+['VARCHAR']*6
        same(result['schema'],[{'name':n,'dbType':db,'nullable':True,'unit':None,'wireSchema':wire(db)} for n,db in zip(names,dbs)])
        same(result['rows'],expected_lookup(inputs['source'],inputs['right']),'Full typed50x17 values differ')
        check({type(r['id']) for r in result['rows']}=={int} and len({r['id'] for r in result['rows']})==50,'Preview native integer/unique IDs differ')
    else:
        if wfid.endswith('user-sum'):
            expected=str(sum(int(r['big']) for r in inputs['left_source'] if r['status']=='KEEP' and int(r['id'])>=params['minimumId']));db='HUGEINT';unit='items';col='conditional_sum'
        elif wfid.endswith('user-decimal'):
            expected=str(sum((Decimal(r['amount']) for r in inputs['left_source'] if r['status']=='KEEP' and int(r['id'])>=params['minimumId']),Decimal('0')));db='DECIMAL(38,10)';unit='RON';col='conditional_sum'
        else:
            col='conditional_count';db='BIGINT';unit='rows';criterion=params['criterion']
            expected=str(sum((r['flag']=='true')==criterion for r in inputs['source'])) if wfid.endswith('boolean') else str(sum(r['label']==criterion for r in inputs['source']))
        same(expected,value,'Independent source calculation differs from fixed finite expectation');same(result['rows'],[{col:expected}])
        same(result['schema'],[{'name':col,'dbType':db,'nullable':True,'unit':unit,'wireSchema':wire(db)}])
    return jid

try:
    result=read(RPC/'RESULT.json');connection_gate(result)
    record('Exact named RPC cohort and9distinct parent closure boundaries',{'records':9,'normalParents':5,'startupRefusalsExit1':4,'workerSIGTERM':1,'workerSIGKILL':5})
    commit_paths=sorted((RPC/'data/history/commits').glob('*.json'));check([p.name for p in commit_paths]==[f'{i:06}.json' for i in range(1,9)],'Commit filename gap')
    commits=[read(p) for p in commit_paths];state=state_gate(commits)
    rows=[{'name':p.name,'bytes':p.stat().st_size,'sha256':sha(p.read_bytes())} for p in commit_paths]
    same(rows,read(RPC/'commits-after-a.json'));same(rows,read(RPC/'commits-final.json'))
    same(state['catalogs'][1],read(RPC/'catalog-v1.json'));same(state['catalogs'][-1],read(RPC/'catalog-latest-a.json'));same(state['catalogs'][-1],read(RPC/'catalog-restored-b.json'));same(state['catalogs'][-1],read(RPC/'catalog-with-source-missing.json'))
    same([len(c['capabilities']) for c in state['catalogs']],list(range(70,78)))
    record('Physical eight immutable commits, layered hashes, submitted paths and all exact catalogs',{'revisions':[0,7],'catalogEntryCounts':[70,77],'sourceHash':rows[-1]['sha256']})
    saved=(RPC/'saved-history-form.sirenui.json').read_bytes();form=json.loads(saved);receipt=read(RPC/'saved-form-receipt.json')
    same(sha(saved),'7133f3e664c9666f16ec3708a15a20c934d41e1c551b4938acc5f5ef86195f22');same(len(saved),2452);same(receipt['sha256'],sha(saved));same(result['savedForm'],{'file':str(RPC/'saved-history-form.sirenui.json'),'bytes':len(saved),'sha256':sha(saved)})
    ref=form['functions'][0]['reference'];same(ref['catalogSha256'],state['catalogs'][1]['catalogSha256']);same(ref['catalogVersion'],'2.0.1');same(receipt['reference'],ref);same(form['controls'][0]['defaultValue'],'');same(form['functions'][0]['parameters'][0]['default'],'00120')
    old=next(d for d in state['catalogs'][1]['capabilities'] if d['id']==ref['capabilityId']);same(old['descriptorSha256'],ref['descriptorSha256']);same(old['workflowRef'],ref['workflowRef'])
    check('publicationRegistry' not in read(RPC/'config-parent-b.json'),'Cold B used registry')
    record('Real unchanged2452byte saved form retains configured empty input and older2.0.1pin',{'sha256':sha(saved),'oldCatalogSha256':ref['catalogSha256']})
    jobs=[];documents={};raws={}
    for spec in JOB_SPEC:
        doc=read(RPC/(spec[0]+'.json'));rawpath=RPC/(spec[1]+'-raw-'+doc['analysisJobId']+'.json');raw=read(rawpath);jobs.append(validate_job(spec,doc,raw,state));documents[spec[0]]=doc;raws[spec[0]]=raw
    check(len(jobs)==len(set(jobs))==10,'Expected ten distinct completed native jobs');same(len(list(RPC.glob('*-raw-job_*.json'))),10)
    record('Independent10actual completed job/source/schema/envelope readbacks',{'jobs':jobs,'lookupRetainedCells':850,'sourcePopulations':[90,92],'full80transformedFileClaim':False})
    missing=read(RPC/'c-missing-source.json');check(missing['status']=='FAILED' and missing['code']=='SOURCE_UNAVAILABLE' and missing['analysisJobId'] is None and missing['outputs']=={},'Missing file false success');check('ENOENT' in missing['error'],'Missing cause changed');same(missing['execution']['cancellation']['ownedSessionClose'],read(RPC/'parent-c-missing-close.json'))
    cancelled=read(RPC/'cancelled.json');same({k:v for k,v in cancelled.items() if k!='jobId'},{'requested':True,'confirmed':True,'status':'cancelled','workerExited':True});check(cancelled['jobId'] not in jobs,'Cancelled job mislabeled completed')
    change=read(RPC/'current-input-change.json');same(change['originalSha256'],sha((RPC/"data/text left O'Brien Ω.csv").read_bytes()));same(change['savedReference'],ref);same(change['resultVersion'],documents['b-current-input-changed']['outputs']['table']['resultVersion']);same(change['currentSha256'],documents['b-current-input-changed']['outputs']['table']['provenance']['sources'][0]['sha256']);check(change['currentSha256']!=change['originalSha256'],'No actual data change')
    check((RPC/'data/history/staging/manual-uncommitted.tmp').is_file() and result['pendingStagePreserved'] is True,'Uncommitted stage disappeared')
    record('Missing source refusal, restored retry, current-data change and actual cancellation kept distinct',{'failedBeforeJob':True,'cancelledNativeJob':cancelled['jobId'],'pendingManualStage':True})
    # Entire pre-RPC packet and all455 transport source pins are freshly read, not inferred from source READY alone.
    manifest=read(ROOT/'evidence/identity-beforerpcv1/application-manifest.json');physical=[]
    for r in manifest['files']:
        p=ROOT/r['path'];same(p.stat().st_size,r['bytes'],'Packet byte drift '+r['path']);same(sha(p.read_bytes()),r['sha256'],'Packet hash drift '+r['path']);physical.append(r)
    same(len(physical),466);same(sum(r['bytes'] for r in physical),64294901);same(sha(''.join(f"{r['path']}\t{r['bytes']}\t{r['sha256']}\n" for r in physical)),manifest['rosterSha256'])
    pins=read(RPC/'config-parent-a.json')['sourcePins'];check(len(pins)==455 and len({p['path'] for p in pins})==455,'Pin roster differs')
    for cpath in RPC.glob('config-*.json'):
        cfg=read(cpath);same(cfg['sourcePins'],pins,'Connection source pins differ')
    for p in pins:same(sha(Path(p['path']).read_bytes()),p['sha256'],'Transport source pin drift')
    for src in ['scripts/history-rpc.mjs','scripts/proof-utils.mjs','count-publication-fixture.mjs','text-fixture.mjs','count-fixture.mjs']:
        same((ROOT/src).read_bytes(),(RPC/('executed-'+Path(src).name)).read_bytes(),'Executed producer drift '+src)
    record('Current byte readback of pre-RPC466file packet/455pins/executed producer copies',{'packetSha256':manifest['rosterSha256'],'packetBytes':64294901,'wholeFinalMembershipAcceptance':False,'legacyFixtureCustody':'fixture.mjs/source-fixture.mjs in before packet; not separately contemporaneous copied into cohort'})
    # Coherent semantic controls: rehash inner result and update all service/raw redundant views, not checksum-only.
    def mutated_job(name,mutator):
        spec=next(s for s in JOB_SPEC if s[0]==name);doc=copy.deepcopy(documents[name]);raw=copy.deepcopy(raws[name]);mutator(raw['result']);raw['result']['integritySha256']=sha({k:v for k,v in raw['result'].items() if k!='integritySha256'});doc['execution']=copy.deepcopy(raw);doc['outputs']['table']={**copy.deepcopy(raw['result']),'kind':'table','rowCount':raw['result']['coverage']['resultRows'],'returnedRows':raw['result']['coverage']['transferredRows']};validate_job(spec,doc,raw,state)
    refuse('coherent duplicate lookup ID and cells with valid new result digest',lambda:mutated_job('b-wide-lookup',lambda r:r['rows'].__setitem__(1,copy.deepcopy(r['rows'][0]))))
    refuse('coherent numeric-looking VARCHAR cast to number',lambda:mutated_job('b-wide-lookup',lambda r:r['rows'][0].__setitem__('numeric_text',120)))
    refuse('coherent unsigned128 maximum loss',lambda:mutated_job('b-wide-lookup',lambda r:r['rows'][0].__setitem__('u128','340282366920938463463374607431768211454')))
    refuse('coherent empty text replaced NULL',lambda:mutated_job('b-wide-lookup',lambda r:r['rows'][1].__setitem__('text',None)))
    refuse('coherent decimal total changed with valid seal',lambda:mutated_job('b-decimal',lambda r:r['rows'][0].__setitem__('conditional_sum','1053.0000000028')))
    refuse('coherent extra SUM row and counts',lambda:mutated_job('b-sum',lambda r:(r['rows'].append(copy.deepcopy(r['rows'][0])),r['coverage'].update(resultRows=2,transferredRows=2))))
    refuse('coherent pooled source population90into92',lambda:mutated_job('b-wide-lookup',lambda r:r['coverage'].__setitem__('sourceRows',92)))
    refuse('coherent wrong request provenance',lambda:mutated_job('b-old-pin-empty',lambda r:r['provenance'].__setitem__('requestId','invented')))
    refuse('coherent fabricated captured source hash',lambda:mutated_job('b-old-pin-empty',lambda r:r['provenance']['sources'][0].__setitem__('sha256','a'*64)))
    r=copy.deepcopy(result);r['connections'][1]['exit']['pid']=r['connections'][0]['exit']['pid'];refuse('two parent receipts silently same parent',lambda:connection_gate(r))
    r=copy.deepcopy(result);r['connections'][-1]['exit']['code']=0;refuse('startup exit1 relabeled normal0',lambda:connection_gate(r))
    bad=copy.deepcopy(commits);bad[-1]['state']['definitions'][0]['publication']['definition']['nodes'][0]['data']['path']=str(RPC/'data/text right Ω.csv');bad[-1]['digest']=sha({k:v for k,v in bad[-1].items() if k!='digest'});refuse('rehash metadata source retarget without submitted change',lambda:state_gate(bad))
    bad=copy.deepcopy(commits);bad[-1]['state']['definitions'][0]['publication']['units']['conditional_count']='RON';bad[-1]['digest']=sha({k:v for k,v in bad[-1].items() if k!='digest'});refuse('rehash acknowledged unit rewrite',lambda:state_gate(bad))
    changed=copy.deepcopy(form);changed['controls'][0]['defaultValue']='00120';refuse('changed saved configured empty value with new ownreceipt',lambda:same(sha((json.dumps(changed,ensure_ascii=False,indent=2)+'\n').encode()),sha(saved)))
    record('Independent meaningful corruption admission controls',{'refusals':len(refusals),'mode':'In-memory copies; original artifacts untouched'})
    (OUT/'RESULT.json').write_text(json.dumps({'finished':True,'mode':'independent retrospective source/file/native-RPC artifact reader; no process or SQL execution','records':records,'refusals':refusals,'sourceReady':read(ROOT/'evidence/source-ready-v3.json')},ensure_ascii=True,indent=2)+'\n',encoding='utf8')
    print(json.dumps({'finished':True,'groups':len(records),'refusals':len(refusals),'result':str(OUT/'RESULT.json')}))
except BaseException as e:
    (OUT/'FAILURE.json').write_text(json.dumps({'finished':False,'error':traceback.format_exc(),'records':records,'refusals':refusals},ensure_ascii=True,indent=2)+'\n',encoding='utf8');raise
