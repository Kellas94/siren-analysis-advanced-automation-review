"""Independent retrospective reader. No author import, child/process/SQL execution."""
from pathlib import Path
import copy,hashlib,json,traceback,os

ROOT=Path(__file__).resolve().parents[1]
P=ROOT/'evidence/process-v1'
OUT=ROOT/'review/independent-history-process-artifacts-v1'
OUT.mkdir(exist_ok=False)
def read(p):return json.loads(Path(p).read_text(encoding='utf8'))
def canon(v):return json.dumps(v,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False)
def sha(v):return hashlib.sha256(v if isinstance(v,bytes) else v.encode('utf8') if isinstance(v,str) else canon(v).encode('utf8')).hexdigest()
def eq(a,b,m='Different actual identity/value/type'):
    a=str(a) if isinstance(a,Path) else a; b=str(b) if isinstance(b,Path) else b
    assert (a==b if isinstance(a,bytes) and isinstance(b,bytes) else canon(a)==canon(b)),m
def ok(v,m):assert v,m
def entry(i):return {'id':i,'wide':'9007199254740993','precision':'9999999999999999999999999999.1234567890','identifier':'00120','empty':'','nullable':None,'flag':False}
def state(ids):return {'revision':len(ids),'entries':[entry(i) for i in ids]}
def regular(p):
    st=p.lstat();ok(p.is_file() and not p.is_symlink() and not getattr(st,'st_file_attributes',0)&0x400,'Reparse/nonordinary file '+str(p));return st
def inventory(folder):return {p.name:{'bytes':regular(p).st_size,'sha256':sha(p.read_bytes())} for p in sorted(folder.iterdir())}
def conserved(before,after):
    for k,v in before.items():eq(v,after[k],'Acknowledged/staged bytes not conserved '+k)
def record(name,detail):records.append({'name':name,'pass':True,'detail':detail})
def refuse(name,fn):
    try:fn()
    except (AssertionError,KeyError,ValueError,TypeError,IndexError) as e:controls.append({'name':name,'refused':True,'message':str(e)[:200]});return
    raise AssertionError('Corruption admitted: '+name)
records=[];controls=[]
GROUPS=['BEFORE_LINK_STOP_CONSERVES_ACK','COMMITTED_STOP_COLD_RECOVERY','TWO_WRITER_CONFLICT_REFRESH_RETRY']
WRITERS=['before-link-writer','before-link-cold','committed-writer','committed-cold','race-a','race-b','race-refresh','race-loser-retry','race-final-cold']
STOPS={'before-link-writer':'before-link','committed-writer':'committed'}
GROUP_DIRS={'before-link-writer':GROUPS[0].lower(),'before-link-cold':GROUPS[0].lower(),'committed-writer':GROUPS[1].lower(),'committed-cold':GROUPS[1].lower(),**{w:GROUPS[2].lower() for w in WRITERS[4:]}}
AUTH={'storeId':'owned-history-process-proof','scope':str(P),'kind':'metadata-only'}
def validate_chain(chain,ids):
    previous=None
    eq(len(chain),len(ids),'Wrong physical chain length')
    for i,c in enumerate(chain):
        eq(sorted(c),sorted(['protocol','sequence','parentSha256','authority','authoritySha256','state','digest']))
        eq(c['protocol'],'siren.publication-history/1');eq(c['sequence'],i+1);eq(c['parentSha256'],None if previous is None else previous['digest'])
        eq(c['authority'],AUTH);eq(c['authoritySha256'],sha(AUTH));eq(c['digest'],sha({k:v for k,v in c.items() if k!='digest'}))
        eq(c['state'],state(ids[:i+1]),'Actual typed payload/state does not equal intended acknowledged append')
        previous=c
    return {'head':{'sequence':len(chain),'digest':chain[-1]['digest']},'state':chain[-1]['state']}
def phase_gate(marker,writer,phase,config,exit,pins):
    eq(sorted(marker),sorted(['writerId','pid','node','configSha256','sourcePins','phase','expectedHead']))
    eq(marker['writerId'],writer);eq(marker['pid'],exit['pid']);eq(marker['node'],'v24.16.0');eq(marker['configSha256'],sha((P/'configs'/(writer+'.json')).read_bytes()));eq(marker['sourcePins'],pins);eq(marker['phase'],phase);eq(marker['expectedHead'],config['expectedHead'])
def close_gate(x,writer):
    eq(x['writerId'],writer);ok(type(x['pid']) is int and x['pid']>0,'Invalid PID');eq(x['closeObserved'],True);eq(x['spawnError'],None)
    if writer in STOPS:
        eq(x['code'],None);eq(x['signal'],'SIGTERM');eq(x['controlledStop']['purpose'],STOPS[writer]);eq(x['controlledStop']['method'],'captured ChildProcess.kill(SIGTERM)');eq(x['controlledStop']['returned'],True)
    else:eq(x['code'],0);eq(x['signal'],None);eq(x['controlledStop'],None)
def read_receipt_gate(receipt,exit,writer,config,pins):
    eq(receipt['writerId'],writer);eq(receipt['pid'],exit['pid']);eq(receipt['node'],'v24.16.0');eq(receipt['configSha256'],sha((P/'configs'/(writer+'.json')).read_bytes()));eq(receipt['sourcePins'],pins)
    if config['mode']=='read':eq(receipt['outcome'],'READ');eq(receipt['phases'],[])
    elif receipt['outcome']=='ACK':eq(receipt['phases'],['stage-flushed','before-link','committed'])
    else:eq(receipt['outcome'],'CONFLICT');eq(receipt['error']['code'],'HISTORY_CONFLICT');eq(receipt['phases'],['stage-flushed','before-link'])

try:
    result=read(P/'RESULT.json');eq(result['evidenceClass'],'HELPER_AUTHOR_ROOT_OPERATED_METADATA_PROCESSES');eq(result['node'],'v24.16.0')
    eq([g['name'] for g in result['groups']],GROUPS);ok(all(g['status']=='PASS' for g in result['groups']),'Not exact3passed groups');eq(result['allPassed'],True);eq(result['allClosed'],True);eq(result['unexpectedCleanup'],[]);eq(result['pinError'],None)
    for k in ['noEngine','noSQL','noNativeApp','noProviderImport']:eq(result[k],True)
    sources=read(P/'SOURCE_PINS.json');eq(sources['sources'],result['sources']);eq(sources['preparedByPid'],result['operatorPid']);eq(sources['node'],result['node'])
    eq([s['name'] for s in sources['sources']],['history-process.mjs','fs-writer.mjs','publication-store.mjs'])
    pins={}
    for s in sources['sources']:
        original=Path(s['original']);captured=Path(s['copy']);eq(captured,P/'executables'/s['name'])
        for p in [original,captured]:eq(regular(p).st_size,s['bytes']);eq(sha(p.read_bytes()),s['sha256'])
        eq(original.read_bytes(),captured.read_bytes());pins[s['name']]=s['sha256']
    eq(pins['publication-store.mjs'],'53dc5bb2d94a677ace57f50ada422c6f5b53a0fbb791dbc4ee6935ffd6b12618')
    record('Captured exact metadata-only source/runtime custody',{'driver':pins['history-process.mjs'],'worker':pins['fs-writer.mjs'],'store':pins['publication-store.mjs'],'runtime':'v24.16.0','operatorPid':result['operatorPid']})
    eq(sorted(p.stem for p in (P/'configs').glob('*.json')),sorted(WRITERS));eq(len(result['processes']),9)
    exits={x['writerId']:x for x in result['processes']};eq(sorted(exits),sorted(WRITERS));ok(len({x['pid'] for x in exits.values()})==9,'Distinct processes not proved')
    configs={};receipts={};markers={}
    for w in WRITERS:
        cfg=read(P/'configs'/(w+'.json'));configs[w]=cfg;eq(sorted(cfg),sorted(['protocol','root','writerId','mode','directory','authority','expectedHead','state','gatePhase','markerFile','releaseFile','receiptFile','sourcePins']))
        eq(cfg['protocol'],'history-process-worker/1');eq(cfg['writerId'],w);eq(cfg['root'],str(P));eq(cfg['authority'],AUTH);eq(cfg['sourcePins'],pins);eq(Path(cfg['directory']),P/GROUP_DIRS[w]/'history');eq(Path(cfg['receiptFile']),P/'receipts'/(w+'.json'))
        for key in ['directory','markerFile','releaseFile','receiptFile']:ok(Path(cfg[key]).is_relative_to(P),'Foreign evidence path '+key)
        x=exits[w];eq(read(P/'receipts'/(w+'-exit.json')),x);close_gate(x,w)
        if w in STOPS:
            eq(cfg['mode'],'commit');eq(cfg['gatePhase'],STOPS[w]);ok(not Path(cfg['receiptFile']).exists(),'Stopped writer fabricated ACK receipt');ok(not Path(cfg['releaseFile']).exists(),'Stopped writer gate released')
            stop=read(P/'receipts'/(w+'-stop.json'));eq(stop,x['controlledStop']);marker=read(cfg['markerFile']);phase_gate(marker,w,STOPS[w],cfg,x,pins);markers[w]=marker
        else:
            receipt=read(cfg['receiptFile']);read_receipt_gate(receipt,x,w,cfg,pins);receipts[w]=receipt
        log=[json.loads(line) for line in (P/'logs'/(w+'.stdout.log')).read_text(encoding='utf8').splitlines() if line]
        for item in log:eq(item['writerId'],w);eq(item['pid'],x['pid'])
        if w in STOPS:eq(log,[{'event':'phase','writerId':w,'pid':x['pid'],'phase':s} for s in (['stage-flushed','before-link'] if w=='before-link-writer' else ['stage-flushed','before-link','committed'])])
        else:eq(log[-1],{'event':'receipt','writerId':w,'pid':x['pid'],'outcome':receipts[w]['outcome']});eq([i['phase'] for i in log if i['event']=='phase'],receipts[w]['phases'])
        err=P/'logs'/(w+'.stderr.log');ok(not err.exists() or err.read_bytes()==b'','Unexpected metadata worker stderr')
    record('Nine distinct actual child closure/config/marker/log receipts',{'normal0':7,'intentionalSIGTERM':2,'noACKForStoppedWriters':True,'pids':{w:exits[w]['pid'] for w in WRITERS}})
    groups={g['name']:g for g in result['groups']};chains={};stage_records={};views={}
    # Independent expected final append order, obtained from fixed config intent plus actual winning receipt.
    race_winner=next(w for w in ['race-a','race-b'] if receipts[w]['outcome']=='ACK');race_loser=next(w for w in ['race-a','race-b'] if receipts[w]['outcome']=='CONFLICT')
    ok(race_winner!=race_loser,'Race needs one ACK and one conflict');expected={GROUPS[0]:['base-ack'],GROUPS[1]:['base-ack','linked-before-ack'],GROUPS[2]:['base-ack',race_winner,race_loser]}
    for group in GROUPS:
        base=P/group.lower();g=groups[group];eq(g,read(base/'group-result.json'));d=g['details']
        commit_dir=base/'history/commits';stage_dir=base/'history/staging';cp=sorted(commit_dir.iterdir());eq([p.name for p in cp],[f'{i:06}.json' for i in range(1,len(expected[group])+1)])
        chain=[]
        for p in cp:
            regular(p);c=read(p);eq(p.read_bytes(),(canon(c)+'\n').encode('utf8'),'Committed bytes not canonical JSON');chain.append(c)
        view=validate_chain(chain,expected[group]);chains[group]=chain;commits=inventory(commit_dir);stages=inventory(stage_dir);pending=[];stage_records[group]=[]
        committed_hashes={v['sha256'] for v in commits.values()}
        for p in sorted(stage_dir.iterdir()):
            c=read(p);eq(p.read_bytes(),(canon(c)+'\n').encode());eq(c['digest'],sha({k:v for k,v in c.items() if k!='digest'}));eq(c['authority'],AUTH);eq(c['authoritySha256'],sha(AUTH));stage_records[group].append(c)
            if sha(p.read_bytes()) not in committed_hashes:pending.append(p.name)
        view['pendingStages']=len(pending);views[group]=view;eq(commits,d['commitsAfter']);eq(stages,d['stagesAfter'])
        eq(len(pending),0 if group==GROUPS[1] else 1,'Pending stage mistaken for total stage count')
        if group==GROUPS[0]:
            eq(d['phase'],markers['before-link-writer']);eq(d['stopped'],{'marker':markers['before-link-writer'],'exit':exits['before-link-writer']});eq(d['fresh'],{'receipt':receipts['before-link-cold'],'exit':exits['before-link-cold']})
            eq(receipts['before-link-cold']['read'],view);eq(d['previousAck'],{**view,'pendingStages':0});eq(d['commitsBefore'],commits);eq(d['stagesBeforeStop'],stages);eq(configs['before-link-writer']['state'],state(['base-ack','pending-not-promoted']))
            candidates=[c for c in stage_records[group] if c['sequence']==2];eq(len(candidates),1);eq(candidates[0]['state'],configs['before-link-writer']['state']);eq(candidates[0]['parentSha256'],view['head']['digest'])
        elif group==GROUPS[1]:
            eq(d['phase'],markers['committed-writer']);eq(d['stopped'],{'marker':markers['committed-writer'],'exit':exits['committed-writer']});eq(d['fresh'],{'receipt':receipts['committed-cold'],'exit':exits['committed-cold']})
            eq(receipts['committed-cold']['read'],view);eq(d['previousAck'],{'head':{'sequence':1,'digest':chain[0]['digest']},'state':state(['base-ack']),'pendingStages':0});eq(d['commitsBeforeStop'],commits);eq(d['stagesBeforeStop'],stages);eq(configs['committed-writer']['state'],state(expected[group]));eq(chain[-1]['state'],configs['committed-writer']['state'])
        else:
            for w in ['race-a','race-b']:
                eq(configs[w]['mode'],'commit');eq(configs[w]['gatePhase'],'before-link');eq(configs[w]['state'],state(['base-ack',w]));marker=read(configs[w]['markerFile']);phase_gate(marker,w,'before-link',configs[w],exits[w],pins);eq(d['reached'][['race-a','race-b'].index(w)],marker)
            eq(configs['race-a']['expectedHead'],configs['race-b']['expectedHead']);eq(d['expectedHead'],configs['race-a']['expectedHead']);eq(d['expectedHead'],{'sequence':1,'digest':chain[0]['digest']});eq(Path(configs['race-a']['releaseFile']).read_bytes(),b'release\n');eq(configs['race-a']['releaseFile'],configs['race-b']['releaseFile'])
            eq(d['raced'],[{'receipt':receipts[w],'exit':exits[w]} for w in ['race-a','race-b']]);eq(receipts[race_winner]['before'],{'head':d['expectedHead'],'state':state(['base-ack']),'pendingStages':0})
            winview={'head':{'sequence':2,'digest':chain[1]['digest']},'state':state(['base-ack',race_winner]),'pendingStages':1};eq(receipts[race_winner]['committed'],winview);eq(receipts['race-refresh']['read'],winview);eq(receipts['race-loser-retry']['before'],winview);eq(receipts['race-loser-retry']['committed'],view);eq(receipts['race-final-cold']['read'],view)
            for key,w in [('fresh','race-refresh'),('retry','race-loser-retry'),('final','race-final-cold')]:eq(d[key],{'receipt':receipts[w],'exit':exits[w]})
            eq(configs['race-loser-retry']['state'],state(expected[group]));eq(configs['race-loser-retry']['expectedHead'],winview['head']);eq(configs['race-loser-retry']['gatePhase'],None)
            conserved(d['acknowledgedBeforeRetry'],commits);eq(sorted(d['acknowledgedBeforeRetry']),['000001.json','000002.json']);conserved(d['stagedBeforeRace'],stages);eq(len(d['stagedBeforeRace']),3);eq(len(stages),4)
            loser_stages=[s for s in stage_records[group] if s['state']==configs[race_loser]['state']];eq(len(loser_stages),1);ok(loser_stages[0]['digest']!=chain[1]['digest'],'Losing staged payload was promoted')
        record(group,{'physicalCommitCount':len(chain),'physicalStageCount':len(stages),'pendingStages':len(pending),'finalIDs':expected[group],'head':view['head']})
    # Final current packet includes every actual member in declared application/native/consumer/startup scope.
    before=read(ROOT/'evidence/identity-beforebrowser1/application-manifest.json');after=read(ROOT/'evidence/identity-afterbrowser1/application-manifest.json');eq(before,after,'Before/after browser packet differs')
    files=[]
    for prefix in ['provider','reference-consumer','legacy-consumer','workbench']:
        for p in (ROOT/prefix).rglob('*'):
            st=p.lstat();ok(not p.is_symlink() and not getattr(st,'st_file_attributes',0)&0x400,'Reparse scope entry '+str(p))
            if p.is_file():files.append(p)
    files += [ROOT/n for n in ['package.json','fixture.mjs','source-fixture.mjs','count-fixture.mjs','text-fixture.mjs','count-publication-fixture.mjs','scripts/bootstrap.mjs','scripts/workbench-server.mjs','scripts/browser-history-server.mjs']]
    rows=[{'path':p.relative_to(ROOT).as_posix(),'bytes':regular(p).st_size,'sha256':sha(p.read_bytes())} for p in sorted(files)]
    eq(rows,after['files'],'Current membership or bytes differ');eq(len(rows),467);eq(sum(r['bytes'] for r in rows),64303151);eq(sha(''.join(f"{r['path']}\t{r['bytes']}\t{r['sha256']}\n" for r in rows)),'93ac0baf3f24b0d1acaeb9947fee3b12f1fb385f82b640e72202fd59093a4a1b');eq(after['rosterSha256'],'93ac0baf3f24b0d1acaeb9947fee3b12f1fb385f82b640e72202fd59093a4a1b')
    native=read(ROOT/'evidence/identity-beforerpcv1/application-manifest.json')['files'];oldmap={r['path']:r for r in native};nowmap={r['path']:r for r in rows};eq(sorted(set(nowmap)-set(oldmap)),['scripts/browser-history-server.mjs']);eq(sorted(set(oldmap)-set(nowmap)),[])
    for name,row in oldmap.items():eq(nowmap[name],row,'Old466 member changed since RPC '+name)
    donor=read(ROOT/'evidence/intake.json')['files'];eq(len(donor),464)
    for row in donor:
        p=ROOT.parent/'analysis-count-contract-v1'/row['path'];eq(regular(p).st_size,row['bytes']);eq(sha(p.read_bytes()),row['sha256'],'Donor drift '+row['path'])
    record('Final exact467membership/bookends and untouched464donor',{'bytes':64303151,'rosterSha256':after['rosterSha256'],'same466RPCMembers':True,'onlyLaterAddition':'scripts/browser-history-server.mjs','metadataQAScriptsNotApplicationMembers':True})
    # In-memory coherent negative controls; no original artifact is modified.
    def rechain(cs):
        for i,c in enumerate(cs):c['parentSha256']=None if i==0 else cs[i-1]['digest'];c['digest']=sha({k:v for k,v in c.items() if k!='digest'})
        return cs
    c=copy.deepcopy(chains[GROUPS[2]]);c[-1]['state']['entries'][1]['precision']='9999999999999999999999999999.1234567891';rechain(c);refuse('valid chain digest but rounded exact decimal metadata',lambda:validate_chain(c,expected[GROUPS[2]]))
    c=copy.deepcopy(chains[GROUPS[2]]);c[-1]['state']['entries'][2]['flag']='false';rechain(c);refuse('valid chain digest but Boolean becomes text',lambda:validate_chain(c,expected[GROUPS[2]]))
    c=copy.deepcopy(chains[GROUPS[2]]);c[-1]['state']['entries'][2]['empty']=None;rechain(c);refuse('valid chain digest but empty becomes NULL',lambda:validate_chain(c,expected[GROUPS[2]]))
    c=copy.deepcopy(chains[GROUPS[2]]);c[-1]['state']=state(['base-ack',race_winner]);rechain(c);refuse('valid chain digest but loser ACK append missing',lambda:validate_chain(c,expected[GROUPS[2]]))
    c=copy.deepcopy(chains[GROUPS[2]]);c[-1]['state']=state(['base-ack',race_loser,race_winner]);rechain(c);refuse('coherent swapped winner/loser order',lambda:validate_chain(c,expected[GROUPS[2]]))
    c=copy.deepcopy(chains[GROUPS[0]]);c.append(copy.deepcopy(stage_records[GROUPS[0]][0]));refuse('uncommitted stage falsely promoted to cold chain',lambda:validate_chain(c,expected[GROUPS[0]]))
    x=copy.deepcopy(exits['committed-writer']);x.update(code=0,signal=None);refuse('controlled committed stop relabeled normal ACK exit',lambda:close_gate(x,'committed-writer'))
    marker=copy.deepcopy(markers['before-link-writer']);marker['phase']='committed';refuse('beforelink marker relabeled aftercommit',lambda:phase_gate(marker,'before-link-writer','before-link',configs['before-link-writer'],exits['before-link-writer'],pins))
    marker=copy.deepcopy(markers['committed-writer']);marker['pid']=exits['before-link-writer']['pid'];refuse('different child PID substituted for commit phase',lambda:phase_gate(marker,'committed-writer','committed',configs['committed-writer'],exits['committed-writer'],pins))
    refused=copy.deepcopy(receipts[race_loser]);refused['outcome']='ACK';refuse('losing conflict relabeled ACK without actual committed closure',lambda:read_receipt_gate(refused,exits[race_loser],race_loser,configs[race_loser],pins))
    staged=copy.deepcopy(groups[GROUPS[2]]['details']['stagedBeforeRace']);key=next(iter(staged));staged[key]['sha256']='0'*64;refuse('stage silently replaced after race',lambda:conserved(staged,groups[GROUPS[2]]['details']['stagesAfter']))
    record('Independent failclosed process/artifact controls',{'refusals':len(controls),'mode':'inmemory copies/semantic checks; original evidence retained'})
    (OUT/'RESULT.json').write_text(json.dumps({'finished':True,'mode':'independent retrospective metadata process artifacts/physicalpacket; no process/native/SQL execution','records':records,'controls':controls,'currentSources':read(ROOT/'evidence/source-ready-v3.json')},ensure_ascii=True,indent=2)+'\n',encoding='utf8')
    print(json.dumps({'finished':True,'groups':len(records),'refusals':len(controls),'result':str(OUT/'RESULT.json')}))
except BaseException:
    (OUT/'FAILURE.json').write_text(json.dumps({'finished':False,'error':traceback.format_exc(),'records':records,'controls':controls},ensure_ascii=True,indent=2)+'\n',encoding='utf8');raise
