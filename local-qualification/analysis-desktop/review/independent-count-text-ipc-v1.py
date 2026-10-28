"""Independent current service-IPC artifact reader. No native/SQL execution."""
from pathlib import Path
import json,hashlib,copy,traceback
ROOT=Path(__file__).resolve().parents[1];C=ROOT/'evidence/ipc-v2';O=ROOT/'review/independent-count-text-ipc-v1';O.mkdir()
def digest(b):return hashlib.sha256(b).hexdigest()
def load(p):return json.loads(Path(p).read_text(encoding='utf-8'))
def exact(a,b):
 if isinstance(a,set) or isinstance(b,set):assert type(a) is type(b) and a==b
 else:assert json.dumps(a,sort_keys=True,ensure_ascii=False)==json.dumps(b,sort_keys=True,ensure_ascii=False),(str(a)[:100],str(b)[:100])
def save(n,v):(O/n).write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
p=ROOT.parent/'analysis-count-functions-v1/review/independent-count-ipc-v2.py';b=p.read_bytes();assert digest(b)=='61cf90525e13fdccc00913f87f5a9df93c288979519fce5985c3aed418585ed6';s=b.decode();constants=s[s.index('NAMES='):s.index('SPECS=[]')];exec(constants);base_verify=s[s.index('def verify(job,spec):'):s.index('REPORT={};controls=[]')];exec(base_verify);save('pinned-constant-and-count-oracle.json',dict(source=str(p),sha256=digest(b),constants=constants,verify=base_verify))
SPECS=[]
for column in ['num','big','u64','u128','s128','floating','quoted"amount','numeric_text','text','flag']:SPECS.append(dict(name='COUNT non-NULL scalar '+column,model=count(column),value=sum(r[column] is not None for r in TYPED)))
criteria=s[s.index('CRITERIA='):s.index('SPECS += [dict(name=\'count empty input')];exec(criteria)
SPECS += [dict(name='count empty input returns BIGINT zero in one row',model=count(),value=0,empty=True),dict(name='countif empty input returns BIGINT zero in one row',model=ci('id','gte','0'),value=0,empty=True)]
for name,model,error in [('extra COUNT criteria',{**count(),'criteria':{}},'COUNT_MODEL_SHAPE'),('COUNTIF two rules',dict(version='analysis.conditional-count/1',operation='countif',criteria=dict(version='analysis.criteria/1',op='and',rules=[dict(column='id',operator='isNotNull'),dict(column='num',operator='isNotNull')])),'COUNTIF_RULE_COUNT')]:SPECS.append(dict(name='Refuse '+name+' before SQL/results',model=model,error=error))
SPECS += [dict(name='Actual upstream schema drift refuses before Count output',model=count(),drift=True,error='FUNCTION_INPUT_SCHEMA_CHANGED'),dict(name='Current-schema retry succeeds on retained worker',model=count(),value=64)]
assert len(SPECS)==26
LABELS=['00120',' ALPHA ','éclair','e\u0301cole','你好','😀Z','',None]
RIGHT=[['00120','ACCOUNT-00120'],['120','WRONG NUMERIC KEY'],['ALPHA','WRONG TRIMMED KEY'],['éclair','Patisserie'],['ÉCLAIR','WRONG CASE'],['école','WRONG NORMALIZED KEY'],['你好','问候'],['😀Z','Emoji'],['',''],[None,'NULL MUST NOT MATCH']]
LEFTN=NAMES+['label'];LEFTT=TYPES+['VARCHAR'];DN=LEFTN+['first','last','middle','tag'];DT=LEFTT+['VARCHAR']*4;LN=DN+['lookup_text'];LT=DT+['VARCHAR'];RS=[dict(name='lookup_key',type='VARCHAR'),dict(name='lookup_value',type='VARCHAR')];LS=[dict(name=n,type=t) for n,t in zip(LEFTN,LEFTT)];DS=[dict(name=n,type=t) for n,t in zip(DN,DT)];KS=[dict(name=n,type=t) for n,t in zip(LN,LT)]
LEFT_RAW=[r+[LABELS[i%8]] for i,r in enumerate(RAW)];LEFT=[{**r,'label':LABELS[i%8]} for i,r in enumerate(TYPED)]
DERIVED=[{**r,'first':None if r['label'] is None else r['label'][:1],'last':None if r['label'] is None else r['label'][-1:],'middle':None if r['label'] is None else r['label'][1:2],'tag':'=review'} for r in LEFT]
MATCHES={key:value for key,value in RIGHT if key is not None};LOOKUP=[{**r,'lookup_text':None if r['label'] is None else MATCHES.get(r['label'])} for r in DERIVED]
COUNTS={'text_count':sum(r['label'] is not None for r in LOOKUP),'lookup_count':sum(r['lookup_text'] is not None for r in LOOKUP),'text_countif':sum(r['label']=='00120' for r in LOOKUP),'empty_countif':sum(r['label']=='' for r in LOOKUP),'null_countif':sum(r['label'] is None for r in LOOKUP),'numeric_count':sum(r['num'] is not None for r in LOOKUP),'bool_count':sum(r['flag'] is not None for r in LOOKUP)}
MODELS=dict(text_count=count('label'),lookup_count=count('lookup_text'),text_countif=ci('label','eq','00120'),empty_countif=ci('label','isEmpty'),null_countif=ci('label','isNull'),numeric_count=count('num'),bool_count=count('flag'))
DERIVEMODEL=dict(version='analysis.derived-columns/1',columns=[dict(alias='first',operation='left',source='label',count='1'),dict(alias='last',operation='right',source='label',count='1'),dict(alias='middle',operation='mid',source='label',start='2',count='1'),dict(alias='tag',operation='literal',type='VARCHAR',value='=review')])
LOOKUPMODEL=dict(version='analysis.lookup/1',leftKey='label',rightKey='lookup_key',valueColumn='lookup_value',alias='lookup_text',duplicates='error',unmatched='null',textMatch='binary')
def csv_bytes(names,rows):return ('\n'.join(';'.join(cell(v) for v in row) for row in [names]+rows)+'\n').encode()
TEXT_NAME='Full text LEFT RIGHT MID Filter Lookup and scalar Count preserve exact text identities'
def output(j,node,kind,total,names,types,rows):
 o=j['nodeOutputs'][node];assert o['nodeId']==node and o['nodeType']==kind and o['viewName']=='view_'+node and o['rowCount']==total and o['isOutdated'] is False;exact(o['schema'],fullschema(names,types));exact(o['preview'],rows)
def combined(j):
 assert j['status']=='completed' and j['error'] is None;exact([j['telemetry']['totalSourceRows'],j['telemetry']['rowsAfterFilter']],[90,80]);nodes=j['pipelineDef']['nodes'];expectedids=['source','typed','derived','filtered','right','lookup']+list(COUNTS);exact([n['id'] for n in nodes],expectedids);by={n['id']:n for n in nodes};assert len(j['pipelineDef']['edges'])==12;exact(set(j['nodeOutputs']),set(expectedids));assert len(j['generatedSQL'])==13
 expectededges=[dict(id='source-typed',source='source',target='typed'),dict(id='typed-derived',source='typed',target='derived'),dict(id='derived-filtered',source='derived',target='filtered'),dict(id='right-first',source='right',target='lookup',targetHandle='right'),dict(id='left-second',source='filtered',target='lookup',targetHandle='left')]+[dict(id='lookup-'+n,source='lookup',target=n) for n in COUNTS];exact(j['pipelineDef']['edges'],expectededges)
 for node,file in [('source',"text left O'Brien Ω.csv"),('right','text right Ω.csv')]:assert Path(by[node]['data']['path'])==C/file;assert by[node]['data']['nullStr']=='\\N' and by[node]['data']['allVarchar'] is True
 exact(by['typed']['data']['columns'],[dict(name=n,alias=n,**({} if t=='VARCHAR' else dict(castType=t))) for n,t in zip(LEFTN,LEFTT)])
 exact(by['derived']['data']['derivedSchema'],LS);exact(by['derived']['data']['derivedColumns'],DERIVEMODEL);exact(by['filtered']['data']['criteriaSchema'],DS);exact(by['filtered']['data']['criteria'],dict(version='analysis.criteria/1',op='and',rules=[dict(column='tag',operator='eq',value='=review',nulls='exclude')]))
 exact(by['lookup']['data']['lookupSchemas'],dict(left=DS,right=RS));exact(by['lookup']['data']['lookupModel'],LOOKUPMODEL)
 output(j,'source','input',80,LEFTN,['VARCHAR']*12,[dict(zip(LEFTN,r)) for r in LEFT_RAW[:50]]);output(j,'right','input',10,['lookup_key','lookup_value'],['VARCHAR']*2,[dict(zip(['lookup_key','lookup_value'],r)) for r in RIGHT]);output(j,'typed','select',80,LEFTN,LEFTT,LEFT[:50]);output(j,'derived','derive',80,DN,DT,DERIVED[:50]);output(j,'filtered','filter',80,DN,DT,DERIVED[:50]);output(j,'lookup','lookup',80,LN,LT,LOOKUP[:50])
 steps={s['nodeId']:s for s in j['generatedSQL']};exact(set(steps),set(expectedids));exact(steps['derived']['derivedSchemaCheck'],dict(viewName='view_typed',columns=LS));exact(steps['filtered']['filterSchemaCheck'],dict(viewName='view_derived',columns=[dict(name='tag',type='VARCHAR')]));exact(steps['lookup']['functionSchemaChecks'],[dict(viewName='view_filtered',columns=DS,full=True,scope='Lookup left'),dict(viewName='view_right',columns=RS,full=False,scope='Lookup right')]);assert 'encode(' in steps['lookup']['sql'] and 'LOOKUP_DUPLICATE_KEY' in steps['lookup']['sql'];assert 'left("label",' in steps['derived']['sql'] and 'right("label",' in steps['derived']['sql'] and 'substring("label",' in steps['derived']['sql']
 for node,value in COUNTS.items():
  exact(by[node]['data']['countModel'],MODELS[node]);exact(by[node]['data']['countSchema'],KS);output(j,node,'conditional_count',1,['conditional_count'],['BIGINT'],[dict(conditional_count=str(value))]);m=MODELS[node];field=m['column'] if m['operation']=='count' else m['criteria']['rules'][0]['column'];exact(steps[node]['functionSchemaChecks'],[dict(viewName='view_lookup',columns=[next(c for c in KS if c['name']==field)],full=False,scope='Count')]);sql=steps[node]['sql'];assert sql.startswith('CREATE OR REPLACE VIEW view_'+node+' AS WITH "input_data" AS (SELECT * FROM view_lookup) SELECT COUNT(')
  if m['operation']=='count':assert sql=='CREATE OR REPLACE VIEW view_'+node+' AS WITH "input_data" AS (SELECT * FROM view_lookup) SELECT COUNT("'+field+'") AS "conditional_count" FROM "input_data";'
  else:assert 'COUNT(*)' in sql and ' WHERE ' in sql
REPORT={};controls=[]
def refused(name,obj,fn):
 save('corrupt-'+name+'.json',obj)
 try:fn(obj)
 except (AssertionError,KeyError,TypeError,ValueError):controls.append(dict(name=name,refused=True));return
 raise AssertionError('ADMITTED CORRUPTION '+name)
try:
 for file,names,rows in [('counts.csv',NAMES,RAW),("text left O'Brien Ω.csv",LEFTN,LEFT_RAW),('text right Ω.csv',['lookup_key','lookup_value'],RIGHT)]:assert (C/file).read_bytes()==csv_bytes(names,rows)
 for captured,source in [('executed-probe.mjs','scripts/ipc-count-text-v2.mjs'),('executed-fixture.mjs','count-fixture.mjs'),('executed-text-fixture.mjs','text-fixture.mjs')]:assert (C/captured).read_bytes()==(ROOT/source).read_bytes()
 r=load(C/'RESULT.json');assert r['finished'] is True and r['fatal'] is None and r['jobs']==27;exact([x['name'] for x in r['records']],[x['name'] for x in SPECS]+[TEXT_NAME]);assert all(x['pass'] is True for x in r['records']);assert len(list(C.glob('job-*.json')))==27;jobs=[load(C/f'job-{i}.json') for i in range(1,28)];assert len({j['jobId'] for j in jobs})==27
 for index,(job,spec) in enumerate(zip(jobs,SPECS)):
  verify(job,spec);assert r['records'][index]['jobId']==job['jobId']
  if spec.get('error'):assert 'totalSourceRows' not in job['telemetry']
  else:assert r['records'][index]['expected']==str(spec['value']);exact(set(job['nodeOutputs']),{'source','typed','counted'}|({'empty'} if spec.get('empty') else set()))
 combined(jobs[-1]);record=r['records'][-1];assert record['jobId']==jobs[-1]['jobId'];exact(record['counts'],{k:str(v) for k,v in COUNTS.items()});exact([record['sourceRows'],record['resultRows'],record['previewRows']],[90,80,50]);exact(r['workers'],[dict(pid=12444,code=None,signal='SIGKILL')]);assert sum(x['id']>=60 for x in jobs[10]['nodeOutputs']['typed']['preview'])==0
 # Meaningful plausible substitutions: checks use expected values/models/types, not author hashes.
 for idx,name,value in [(7,'numeric-looking-text-COUNT-coerced-to-zero','0'),(8,'empty-text-incorrectly-excluded','40'),(9,'false-values-incorrectly-excluded','27'),(10,'COUNTIF-only-first50','0'),(19,'no-match-NULL-instead-zero',None),(25,'retry-wrong-numeric-value','63')]:
  x=copy.deepcopy(jobs[idx]);x['nodeOutputs']['counted']['preview']=[dict(conditional_count=value)];refused(name,x,lambda d,i=idx:verify(d,SPECS[i]))
 x=copy.deepcopy(jobs[7]);x['nodeOutputs']['counted']['preview'][0]['conditional_count']=80;refused('BIGINT-number-wire',x,lambda d:verify(d,SPECS[7]))
 x=copy.deepcopy(jobs[21]);x['nodeOutputs']['counted']['rowCount']=0;refused('aggregate-zero-value-confused-with-zero-rows',x,lambda d:verify(d,SPECS[21]))
 x=copy.deepcopy(jobs[22]);x['nodeOutputs']['counted']={};refused('preSQL-failure-publishes-output',x,lambda d:verify(d,SPECS[22]))
 x=copy.deepcopy(jobs[24]);x['error']='Generic placeholder';refused('schema-failure-not-actual-guard',x,lambda d:verify(d,SPECS[24]))
 for name,node,field,value in [('leadingzero-to-number','lookup','numeric_text',120),('space-trimmed-before-Lookup','lookup','label','ALPHA'),('combining-normalized','lookup','label','école'),('Unicode-middle-grapheme-instead-codepoint','lookup','middle','e'),('NULL-empty-conflation','lookup','label',''),('matched-empty-became-NULL','lookup','lookup_text',None),('literal-became-nontext','lookup','tag',0)]:
  x=copy.deepcopy(jobs[-1]);row=3 if name.startswith('combining') or name.startswith('Unicode-middle') else 1 if name.startswith('space') else 7 if name.startswith('NULL') else 6 if name.startswith('matched') else 0;x['nodeOutputs'][node]['preview'][row][field]=value;refused(name,x,combined)
 for node,value,name in [('text_count','60','combined-COUNT-drops-empty'),('lookup_count','40','combined-COUNT-drops-matched-empty'),('bool_count','27','combined-COUNT-counts-only-TRUE')]:
  x=copy.deepcopy(jobs[-1]);x['nodeOutputs'][node]['preview'][0]['conditional_count']=value;refused(name,x,combined)
 x=copy.deepcopy(jobs[-1]);x['telemetry']['totalSourceRows']=80;refused('source90-confused-with-Lookup80',x,combined)
 x=copy.deepcopy(jobs[-1]);x['nodeOutputs']['lookup']['preview'][49]=copy.deepcopy(x['nodeOutputs']['lookup']['preview'][0]);refused('duplicate-preview-id',x,combined)
 REPORT=dict(finished=True,mode='Independent saved Node-service actual worker IPC artifacts; no reviewer SQL/native/process operation',cohort='ipc-v2',records=27,jobs=27,completed=24,preSQLFailed=2,schemaFailed=1,workers=r['workers'],finiteCounts=[dict(index=i+1,name=s['name'],jobId=j['jobId'],status=j['status'],expected=s.get('value')) for i,(j,s) in enumerate(zip(jobs,SPECS))],combined=dict(jobId=jobs[-1]['jobId'],nodes=13,edges=12,sourceRows=90,leftRows=80,rightRows=10,resultRows=80,previewRows=50,columns=17,counts=COUNTS,fullExpectedInputsCompared=True,allCapturedPreviewsAndTypesCompared=True,codepointScope=True),fullFiles=[dict(name=f,bytes=(C/f).stat().st_size,sha256=digest((C/f).read_bytes())) for f in ['counts.csv',"text left O'Brien Ω.csv",'text right Ω.csv']],corruptions=controls,earlierV1='Separate same-product cohort excluded from current acceptance; inherited numeric labels corrected in v2 probe only')
 save('RESULT.json',REPORT);save('input-artifacts.json',[dict(path=p.relative_to(ROOT).as_posix(),bytes=p.stat().st_size,sha256=digest(p.read_bytes())) for p in C.iterdir() if p.is_file()]);print(json.dumps(dict(finished=True,jobs=27,completed=24,failed=3,corruptions=len(controls),counts=COUNTS)))
except BaseException as e:save('FAILURE.json',dict(error=str(e),traceback=traceback.format_exc(),partial=REPORT));raise
