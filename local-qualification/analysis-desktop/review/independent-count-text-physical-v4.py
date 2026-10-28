"""Independent frozen application/native/saved/Docs artifact reader. No native execution."""
from pathlib import Path,PureWindowsPath
import json,hashlib,copy,datetime,re,traceback,os,stat
ROOT=Path(__file__).resolve().parents[1];A=ROOT/'candidate/analysis';C=ROOT/'evidence/native-v1';O=ROOT/'review/independent-count-text-physical-v4';O.mkdir()
def digest(b):return hashlib.sha256(b).hexdigest()
def load(p):return json.loads(Path(p).read_text(encoding='utf-8-sig'))
def exact(a,b):
 if isinstance(a,set) or isinstance(b,set):assert type(a) is type(b) and a==b
 else:assert json.dumps(a,sort_keys=True,ensure_ascii=False)==json.dumps(b,sort_keys=True,ensure_ascii=False),(str(a)[:100],str(b)[:100])
def save(n,v):(O/n).write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
def pinned(p,pin,start,end,ns,name):
 b=p.read_bytes();assert digest(b)==pin;t=b.decode();part=t[t.index(start):t.rindex(end)]
 if name=='finite-text-oracle.py':
  old="exact(j['pipelineDef']['edges'],expectededges)";new="exact(j['pipelineDef']['edges'],[{k:v for k,v in e.items() if k!='id'} for e in expectededges])";assert old in part;part=part.replace(old,new)

  for old,new in [
   ('def combined(j):','def combined(j,prefix=False):'),
   ("+list(COUNTS);exact([n['id']","+([] if prefix else list(COUNTS));exact([n['id']"),
   ("assert len(j['pipelineDef']['edges'])==12","assert len(j['pipelineDef']['edges'])==(5 if prefix else 12)"),
   ("assert len(j['generatedSQL'])==13","assert len(j['generatedSQL'])==(6 if prefix else 13)"),
   ("for n in COUNTS];exact(j['pipelineDef']['edges']","for n in ([] if prefix else COUNTS)];exact(j['pipelineDef']['edges']"),
   ('for node,value in COUNTS.items():','for node,value in ({} if prefix else COUNTS).items():'),
   ("   assert sql==","   conditions['text_countif']=conditions['text_countif'].replace('00120',MODELS['text_countif']['criteria']['rules'][0]['value'])\n   assert sql==")]:
   assert old in part,old;part=part.replace(old,new)
 (O/name).write_text(part,encoding='utf-8');exec(part,ns)
P=dict(globals());pinned(ROOT.parent/'analysis-native-save-close-v1/review/independent-physical-final-v1.py','2a1026428c29d51aac782673acc989601cd392af2bf827cb47542389405a3ee0','def load','def normal_closure',P,'physical-helpers.py');scan=P['rowscan'];roster=P['roster'];pdef=P['pdef'];logical=P['logical']
Q=dict(globals());pinned(ROOT/'review/independent-count-text-ipc-v2.py','72cb91a184c1bbc89d0871e7114d6592732b7be5216211417954336c6e086e58','p=ROOT.parent','REPORT={};controls=[]',Q,'finite-text-oracle.py')
for k in ['NAMES','TYPES','RAW','TYPED','CSV','SCHEMA','count','ci','fullschema','LABELS','RIGHT','LEFTN','LEFTT','DN','DT','LN','LT','RS','LS','DS','KS','LEFT_RAW','LEFT','DERIVED','LOOKUP','COUNTS','MODELS','csv_bytes']:globals()[k]=Q[k]
U=dict(globals());pinned(ROOT.parent/'analysis-count-functions-v1/review/independent-count-physical-v3.py','b8beba0686e054c47c342c78dd0a09c36b6bca474992f51feccf21337066be0d','def protocol','def upstream',U,'native-protocol.py');protocol=U['protocol']
CASES=['Input-only run captures all actual text Boolean and numeric Count choices','Interactive text COUNT includes empty text and excludes NULL across all80 rows','Interactive text COUNTIF preserves leading-zero criterion00120 and counts10','LEFT RIGHT MID and binary text Lookup preserve Unicode spaces NULL and real column coordinates','COUNT of Lookup text counts matched empty text without coercion','Actual Docs snapshots preserve full text semantics and scalar Count with separate populations','Actual Save Quit cold native Open preserve the full text formula graph','Untouched previous numeric workflow opens and executes compatible models without migration']
BASECOUNTS=copy.deepcopy(COUNTS);BASEMODELS=copy.deepcopy(MODELS)
def text_job(j,stage):
 Q['COUNTS']=copy.deepcopy(BASECOUNTS);Q['MODELS']=copy.deepcopy(BASEMODELS)
 if stage=='prefix':Q['combined'](j,prefix=True);return
 if stage=='first':Q['COUNTS']['text_countif']=0;Q['MODELS']['text_countif']=ci('label','eq','no-match')
 if stage=='lookup':Q['COUNTS']['text_count']=50;Q['MODELS']['text_count']=count('lookup_text')
 Q['combined'](j);Q['COUNTS']=copy.deepcopy(BASECOUNTS);Q['MODELS']=copy.deepcopy(BASEMODELS)
LEGACYID='node_762cfb10_0f99_4a9b_8db2_e2ded2e21af9';OLD=ROOT.parent/'analysis-count-functions-v1/evidence/native-v2';OLDPIN='65f271b897bb81bfcb5bc045a59fa41ce9710fca946e9a5f89f0056ef5bc7dd6'
def legacy_definition(d):
 exact([n['id'] for n in d['nodes']],['source','typed','counted',LEGACYID]);assert len(d['edges'])==3
 for n in d['nodes']:
  if n['type']=='conditional_count':exact(n['data']['countSchema'],SCHEMA);exact(n['data']['countModel'],count() if n['id']=='counted' else ci('id','gte','60'))
 assert {e['source'] for e in d['edges'] if e['target'] in ['counted',LEGACYID]}=={'typed'}
def legacy_job(j):
 assert j['status']=='completed' and j['error'] is None and j['telemetry']['totalSourceRows']==80;legacy_definition(j['pipelineDef']);exact(set(j['nodeOutputs']),{'source','typed','counted',LEGACYID});assert Path(j['pipelineDef']['nodes'][0]['data']['path'])==OLD/'counts.csv'
 for node,kind,types,rows,total in [('source','input',['VARCHAR']*11,[dict(zip(NAMES,r)) for r in RAW[:50]],80),('typed','select',TYPES,TYPED[:50],80)]:Q['output'](j,node,kind,total,NAMES,types,rows)
 for node,value,field in [('counted',64,'num'),(LEGACYID,20,'id')]:
  Q['output'](j,node,'conditional_count',1,['conditional_count'],['BIGINT'],[dict(conditional_count=str(value))]);step=next(s for s in j['generatedSQL'] if s['nodeId']==node);exact(step['functionSchemaChecks'],[dict(viewName='view_typed',columns=[next(c for c in SCHEMA if c['name']==field)],full=False,scope='Count')])
def scalar_table(t,value):
 for k,v in [('letters',['A']),('names',['conditional_count']),('types',['BIGINT']),('numbers',['1']),('cells',[str(value)])]:exact(t[k],v)
 assert 'Showing 1 of 1 result rows' in t['text']
def display(v):return 'NULL' if v is None else 'Empty text ("")' if v=='' else str(v).lower() if isinstance(v,bool) else str(v)
def table(t):
 exact(t['letters'],list('ABCDEFGHIJKLMNOPQ'));exact(t['names'],LN);exact(t['types'],LT);exact(t['rows'],[dict(number=str(i+1),cells=[display(row[n]) for n in LN]) for i,row in enumerate(LOOKUP[:50])]);assert 'Showing 50 of 80 result rows' in t['text']
BI_LIMIT='Exceeds IEEE-754 Number.MAX_SAFE_INTEGER; preserved as exact string to prevent arithmetic corruption in spreadsheet engine'
DEC={'0.0000000000':0,'1.2500000000':1.25,'-2.5000000000':-2.5,'3.0000000000':3}
def data_cell(value,typ):
 if value is None:return dict(v=None,t=1,custom=dict(isNull=True,dbType=typ))
 if value=='':return dict(v='',t=1,custom=dict(isEmptyString=True,dbType=typ))
 if isinstance(value,str) and value.startswith('='):return dict(v=value,t=1,custom=dict(literalPrefix='=',dbType=typ))
 if typ=='VARCHAR':return dict(v=value,t=1,custom=dict(dbType=typ))
 if typ=='BOOLEAN':return dict(v='TRUE' if value else 'FALSE',t=1,custom=dict(dbType=typ))
 if typ=='DECIMAL(38,10)':assert value in DEC;return dict(v=DEC[value],t=2,custom=dict(isDecimal=True,raw=value,dbType=typ))
 if typ=='BIGINT':
  if value in ['0','70']:return dict(v=int(value),t=2,custom=dict(isBigInt=True,raw=value,dbType=typ))
  assert value=='9007199254740993';return dict(v=value,t=1,custom=dict(isBigInt=True,raw=value,dbType=typ,precisionPreservedAsString=True,formulaLimitation=BI_LIMIT))
 if typ in ['INTEGER','DOUBLE']:return dict(v=value,t=2,custom=dict(dbType=typ))
 assert typ in ['UBIGINT','UHUGEINT','HUGEINT'];return dict(v=value,t=1,custom=dict(dbType=typ))
def docs(env,job,node):
 is_lookup=node=='lookup';result=80 if is_lookup else 1;transferred=50 if is_lookup else 1;status='SAMPLED' if is_lookup else 'COMPLETE';m=env['metadata'];assert env['schemaVersion']=='1.0.0' and m['schemaValid'] is True;exact([m['jobId'],m['sourcePipelineNode'],m['totalSourceRows'],m['totalSourceRowsProcessed'],m['rowsAfterFilter'],m['totalResultRows'],m['transferredRows'],m['transferStatus'],m['fullFileExportAvailable'],m['fullExportPath']],[job['jobId'],node,90,90,80,result,transferred,status,False,None]);assert len(env['workbooks'])==1;key,w=next(iter(env['workbooks'].items()));assert key==w['id']=='wb-'+job['jobId']+'-'+node;l=w['lineage'];exact([l['jobId'],l['sourceNodeId'],l['totalSourceRows'],l['totalSourceRowsProcessed'],l['rowsAfterFilter'],l['totalResultRows'],l['transferredRows'],l['transferStatus'],l['fullFileExportAvailable'],l['fullExportPath']],[job['jobId'],node,90,90,80,result,transferred,status,False,None]);n=17 if is_lookup else 1;exact(l['schemaValidation'],dict(valid=True,errors=[],columnCount=n,mappedColumns=n));assert m['queryExecutionDurationMs']==l['executionDurationMs']==job['telemetry']['durationMs'];assert w['sheetOrder']==['sheet-01'] and len(w['sheets'])==1;s=w['sheets']['sheet-01'];assert s['id']=='sheet-01' and s['name']=='Analysis_'+node and s['rowCount']==(57 if is_lookup else 20) and s['columnCount']==(17 if is_lookup else 10)
 names=LN if is_lookup else ['conditional_count'];types=LT if is_lookup else ['BIGINT'];expected={'0':{str(i):dict(v=name,t=1,s=dict(b=1,bg=dict(rgb='#F1F5F9'),cl=dict(rgb='#0F172A'))) for i,name in enumerate(names)}}
 if is_lookup:expected['1']={'0':dict(v='ℹ️ [SAMPLED]: Eșantion previzualizare de 50 rânduri din 80 rânduri totale ale rezultatului. ',t=1,s=dict(b=1,cl=dict(rgb='#D97706'),bg=dict(rgb='#FFFBEB')))}
 rows=LOOKUP[:50] if is_lookup else [dict(conditional_count='70')];offset=2 if is_lookup else 1
 for r,row in enumerate(rows):expected[str(r+offset)]={str(c):data_cell(row[name],typ) for c,(name,typ) in enumerate(zip(names,types))}
 exact(s['cellData'],expected);assert all('f' not in c for row in s['cellData'].values() for c in row.values());blocks=env['document']['blocks'];assert len(blocks)==2 and blocks[1]['type']=='table' and blocks[1]['workbookId']==key and blocks[1]['sheetId']=='sheet-01';paras=blocks[0]['content']['content'];text=''.join(x.get('text','') for x in paras[0]['content']);assert text=='Analysis workflow job "'+job['jobId']+'" produced '+str(result)+' result rows in native DuckDB. Source rows recorded for this job: 90. Output transferred to SIREN Docs v1.0.0 format.';assert len(paras)==(3 if is_lookup else 2);assert job['jobId'] in paras[1]['content'][0]['text'] and '"'+node+'"' in paras[1]['content'][0]['text'];exact(env['referenceMetadata'],dict(referencesByWorkbook={}))
REPORT={};controls=[]
def refuse(name,obj,fn):
 save('corrupt-'+name+'.json',obj)
 try:fn(obj)
 except (AssertionError,KeyError,TypeError,ValueError):controls.append(dict(name=name,refused=True));return
 raise AssertionError('ADMITTED CORRUPTION '+name)
try:
 before=load(ROOT/'evidence/identity-beforev1/application-manifest.json');final=load(ROOT/'evidence/identity-finalv1/application-manifest.json');now=scan(A);exact(now,before['files']);exact(now,final['files']);assert len(now)==2469 and sum(x['bytes'] for x in now)==970016066 and roster(now)=='15830f7226a05be010e3e9d6396105045cdc44ebb614297c50f12f6d6930fb9b';pkg=[dict(path=x['path'][len('desktop_package/'):],bytes=x['bytes'],sha256=x['sha256']) for x in now if x['path'].startswith('desktop_package/')];exact(pkg,load(ROOT/'evidence/identity-finalv1/package-manifest.json')['files']);exact(pkg,load(ROOT/'evidence/identity-beforev1/package-manifest.json')['files']);assert len(pkg)==710 and sum(x['bytes'] for x in pkg)==884194076 and roster(pkg)=='f2223ad354f9951b6ac6c695aeef59d89a726a16906a0bd650a159ef8d4ac1cf'
 donor=scan(ROOT.parent/'analysis-count-functions-v1/candidate/analysis');exact(donor,load(ROOT/'evidence/intake.json')['files']);assert roster(donor)=='90042e4c7aba1648d331d195c1483dfe74687f7f393b629b40553e868fb3cbc1';a={x['path']:x for x in donor};b={x['path']:x for x in now};exact(set(a),set(b));changed=sorted(k for k in a if a[k]!=b[k]);exact(changed,before['changed']);assert len(changed)==7
 pairs=[]
 for left,right in [(f'dist/{n}',f'desktop_package/resources/app/dist/{n}') for n in ['bundle.js','bundle.js.map','bundle.css','bundle.css.map','index.html']]+[(f'desktop/{n}',f'desktop_package/resources/app/{n}') for n in ['main.cjs','preload.cjs','close_coordinator.cjs']]+[(f'engine/{n}',f'desktop_package/resources/app/engine/{n}') for n in ['pipeline_compiler.js','worker_process.js','filter-criteria.js','filter-binding.js','derived-columns.js','derived-binding.js','conditional-functions.js','conditional-binding.js','graph-identity.js','conditional-count.js']]:assert (A/left).read_bytes()==(A/right).read_bytes();pairs.append(dict(source=left,target=right,sha256=digest((A/left).read_bytes())))
 assert (A/'contracts/docs_univer_contract.js').read_bytes()==(A/'desktop_package/resources/app/contracts/docs_univer_contract.js').read_bytes()
 for name,expected in [('bundle.js.map',164),('bundle.css.map',2)]:
  p=A/'dist'/name;m=load(p);assert len(m['sources'])==len(m['sourcesContent'])==expected
  for rel,body in zip(m['sources'],m['sourcesContent']):target=(p.parent/rel).resolve();assert target.is_relative_to(A.resolve()) and target.read_text(encoding='utf-8')==body.replace('\r\n','\n')
 for row in load(ROOT/'evidence/source-ready-v1.json'):assert digest((A/row['path']).read_bytes())==row['sha256']
 for p,pin in [(ROOT/'native_harness.mjs','b74fa74dace00865ce25b1ace8fbad192a7468523b122911dbbf830ce1fa5dcd'),(A/'scripts/cdp_helper.mjs','afab5fa9631f1fe9bd21163a7444d40d3fa3ec4c85877ea60a414ccd317c3029'),(ROOT.parent/'docs-measured-qa-review-v1/candidate/scripts/native_admission.mjs','942a34b9e2ebee8fcfa35d538b6c26aa26c9d3e6c3bba239457e5056fdf78031')]:assert digest(p.read_bytes())==pin
 save('current-full-inventory.json',now);save('donor-full-inventory.json',donor);save('source-package-pairs.json',pairs);REPORT['identity']=dict(files=2469,bytes=970016066,roster=roster(now),packageFiles=710,packageBytes=884194076,packageRoster=roster(pkg),changed=changed,added=[],removed=[],maps=[164,2],pairs=18,docsContractPairAlsoEqual=True,donorUnchanged=True)
 r=load(C/'RESULT.json');h=load(C/'native-harness.json');protocol(r,h,C,[14180,53144],['text-native','text-cold'],CASES);he=load(C/'HOST_EXIT.json');assert he['finished'] is True and he['forcedCleanup'] is False;exact(he['processes'],r['processes']);assert r['uiJobs']==7 and not list(C.glob('error-*.json'))
 for captured,source in [('executed-host.mjs','scripts/native-text-host.mjs'),('executed-harness.mjs','native_harness.mjs'),('executed-fixture.mjs','text-fixture.mjs'),('executed-count-fixture.mjs','count-fixture.mjs')]:assert (C/captured).read_bytes()==(ROOT/source).read_bytes()
 for file,names,rows in [("text left O'Brien Ω.csv",LEFTN,LEFT_RAW),('text right Ω.csv',['lookup_key','lookup_value'],RIGHT)]:assert (C/file).read_bytes()==csv_bytes(names,rows)
 assert len(list(C.glob('job-*.json')))==7;jobs={i:load(C/f'job-{i}.json') for i in range(1,8)};assert len({j['jobId'] for j in jobs.values()})==7
 for i,stage in [(1,'prefix'),(2,'first'),(3,'normal'),(4,'lookup'),(5,'normal'),(6,'normal')]:text_job(jobs[i],stage)
 legacy_job(jobs[7]);assert (OLD/'counts.csv').read_bytes()==CSV
 for case,i in [(0,1),(1,2),(2,3),(3,3),(4,4),(5,5),(6,6),(7,7)]:assert r['cases'][case]['details']['jobId']==jobs[i]['jobId']
 assert r['cases'][4]['details']['restoredJobId']==jobs[5]['jobId']==load(C/'full-final-job.json')['jobId'];opts=load(C/'column-options.json');exact(opts,[dict(value='',text='Choose a column')]+[dict(value='column:'+str(i),text=n+' · '+t) for i,(n,t) in enumerate(zip(LN,LT))]);table(load(C/'lookup-text-table.json'))
 for name,value in [('text-count-70',70),('text-countif-10',10),('lookup-value-count-50',50)]:scalar_table(load(C/(name+'.json')),value)
 sr=load(C/'save-receipt.json');file=Path(sr['file']);saved=load(file);assert file==C/'saved-text-counts.json' and len(saved['nodes'])==13 and len(saved['edges'])==12;core=load(C/'core-final.json');reopened=load(C/'reopened.json');exact(pdef(saved),pdef(sr['graph']));exact(pdef(saved),pdef(core['graph']));exact(pdef(saved),pdef(reopened['graph']));exact(logical(saved),logical(jobs[5]['pipelineDef']));exact(logical(saved),logical(jobs[6]['pipelineDef']));assert sr['state']['dirty']=='false' and 'Saved' in sr['state']['definition'] and str(file) in sr['state']['definition'];assert digest(file.read_bytes())==sr['sha256']==reopened['sha256'] and reopened['jobId']==jobs[6]['jobId'] and Path(reopened['file'])==file
 oldfile=OLD/'saved-counts.json';raw=oldfile.read_bytes();assert len(raw)==5340 and digest(raw)==OLDPIN;oldsave=load(oldfile);legacy_definition(oldsave);legacy=load(C/'legacy-reopened.json');assert Path(legacy['file'])==oldfile and legacy['sha256']==OLDPIN and legacy['jobId']==jobs[7]['jobId'];exact(pdef(oldsave),pdef(legacy['graph']));exact(logical(oldsave),logical(jobs[7]['pipelineDef']))
 envelopes={};docfiles=[]
 for receipt,node in [('count-docs.json','text_count'),('lookup-docs.json','lookup')]:
  rec=load(C/receipt);p=Path(rec['file']);assert p.is_relative_to(C/'profile/docs-exports') and p.suffix=='.json' and digest(p.read_bytes())==rec['sha256'];env=load(p);exact(rec['metadata'],env['metadata']);docs(env,jobs[5],node);envelopes[node]=env;docfiles.append(dict(path=str(p),bytes=p.stat().st_size,sha256=digest(p.read_bytes()),jobId=jobs[5]['jobId'],node=node))
 # Finite data/provenance controls include internally consistent wrong Docs cells.
 for node,value,name in [('text_count','60','textCOUNT-excludes-empty'),('lookup_count','40','LookupCOUNT-excludes-matched-empty'),('bool_count','27','BooleanCOUNT-onlyTRUE')]:
  x=copy.deepcopy(jobs[5]);x['nodeOutputs'][node]['preview'][0]['conditional_count']=value;refuse(name,x,lambda d:text_job(d,'normal'))
 x=copy.deepcopy(jobs[6]);x['nodeOutputs']['lookup']['preview'][49]=copy.deepcopy(x['nodeOutputs']['lookup']['preview'][0]);refuse('cold-duplicate-preview-id',x,lambda d:text_job(d,'normal'))
 x=copy.deepcopy(envelopes['text_count']);s=next(iter(next(iter(x['workbooks'].values()))['sheets'].values()));s['cellData']['1']['0']['v']=60;s['cellData']['1']['0']['custom']['raw']='60';refuse('DocsCount-coherent-wrong60',x,lambda d:docs(d,jobs[5],'text_count'))
 for name,row,col,cell in [('DocsLookup-leadingzero-removed',2,1,dict(v='120',t=1,custom=dict(dbType='VARCHAR'))),('DocsLookup-NULL-to-empty',9,11,dict(v='',t=1,custom=dict(isEmptyString=True,dbType='VARCHAR'))),('DocsLookup-matchedempty-to-NULL',8,16,dict(v=None,t=1,custom=dict(isNull=True,dbType='VARCHAR'))),('DocsLookup-combining-normalized',5,11,dict(v='école',t=1,custom=dict(dbType='VARCHAR'))),('DocsLookup-Decimal-coherent-wrong',3,2,dict(v=1.5,t=2,custom=dict(isDecimal=True,raw='1.5000000000',dbType='DECIMAL(38,10)'))),('DocsLookup-BIGINT-coherent-wrong',3,3,dict(v='9007199254740995',t=1,custom=dict(isBigInt=True,raw='9007199254740995',dbType='BIGINT',precisionPreservedAsString=True,formulaLimitation=BI_LIMIT)))]:
  x=copy.deepcopy(envelopes['lookup']);next(iter(next(iter(x['workbooks'].values()))['sheets'].values()))['cellData'][str(row)][str(col)]=cell;refuse(name,x,lambda d:docs(d,jobs[5],'lookup'))
 x=copy.deepcopy(envelopes['lookup']);x=json.loads(json.dumps(x).replace(jobs[5]['jobId'],jobs[6]['jobId']));refuse('Docs-coherent-cold-job-relabel',x,lambda d:docs(d,jobs[5],'lookup'))
 x=copy.deepcopy(envelopes['lookup']);x['metadata']['totalSourceRows']=x['metadata']['totalSourceRowsProcessed']=80;l=next(iter(x['workbooks'].values()))['lineage'];l['totalSourceRows']=l['totalSourceRowsProcessed']=80;x=json.loads(json.dumps(x).replace('Source rows recorded for this job: 90.','Source rows recorded for this job: 80.').replace('90 r','80 r'));refuse('Docs-coherent-source90-to-result80',x,lambda d:docs(d,jobs[5],'lookup'))
 x=copy.deepcopy(envelopes['lookup']);x['metadata']['totalResultRows']=50;x['metadata']['transferStatus']='COMPLETE';w=next(iter(x['workbooks'].values()));w['lineage']['totalResultRows']=50;w['lineage']['transferStatus']='COMPLETE';s=next(iter(w['sheets'].values()));s['cellData']={'0':s['cellData']['0'],**{str(i-1):s['cellData'][str(i)] for i in range(2,52)}};s['rowCount']=56;refuse('Docs-sampled50-falsely-complete50',x,lambda d:docs(d,jobs[5],'lookup'))
 x=copy.deepcopy(oldsave);next(n for n in x['nodes'] if n['id']==LEGACYID)['data']['countModel']=ci('id','gte','59');refuse('old-save-model-changed-even-new-checksum',dict(file=x,sha256=digest(json.dumps(x).encode())),lambda d:legacy_definition(d['file']))
 x=copy.deepcopy(r);x['processes'][1]['pid']=14180;refuse('cold-reuses-first-parent',x,lambda d:protocol(d,h,C,[14180,53144],['text-native','text-cold'],CASES))
 x=copy.deepcopy(r);x['cases']=x['cases'][:-1];refuse('finished-missing-legacy-case',x,lambda d:protocol(d,h,C,[14180,53144],['text-native','text-cold'],CASES))
 x=load(C/'lookup-text-table.json');x['letters'][-1]='P';refuse('absolute-Q-letter-relabeled',x,table)
 pr=load(ROOT/'evidence/process-check-final-v1.json');assert pr['visibleOwned']==[] and pr['observed']==609 and pr['unavailableBothFields']==172;REPORT.update(finished=True,native=dict(cases=8,uiJobs=7,inputPrefixJobs=1,newTextFullJobs=5,legacyNumericJobs=1,parents=[14180,53144],allCapturedSchemaValuesVerified=True),saved=dict(path=str(file),bytes=file.stat().st_size,sha256=digest(file.read_bytes()),nodes=13,edges=12),legacy=dict(path=str(oldfile),bytes=len(raw),sha256=OLDPIN,nodes=4,edges=3,counts=[64,20],unchanged=True),docs=docfiles,corruptions=controls,processObservation=pr)
 save('RESULT.json',REPORT);save('artifact-files.json',[dict(path=p.relative_to(ROOT).as_posix(),bytes=p.stat().st_size,sha256=digest(p.read_bytes())) for p in C.iterdir() if p.is_file()]+docfiles);print(json.dumps(dict(finished=True,cases=8,jobs=7,docs=2,corruptions=len(controls),roster=roster(now))))
except BaseException as e:save('FAILURE.json',dict(error=str(e),traceback=traceback.format_exc(),partial=REPORT));raise
