# Retrospective independent file readback of the owned FS controls; no Node/product execution.
from pathlib import Path
import json,hashlib
r=Path(__file__).resolve().parent;d=r/'store-fs-host-v1';canon=lambda v:json.dumps(v,ensure_ascii=False,separators=(',',':'),sort_keys=True);sha=lambda b:hashlib.sha256(b).hexdigest();read=lambda p:json.loads(p.read_text(encoding='utf-8'))
expected={'donor':['A','B','C'],'interleaved':['A','winner-B'],'fault-writeSync':['A','B'],'fault-fsyncSync':['A','B'],'fault-linkSync':['A','B'],'phase-stage-flushed':['A'],'phase-before-link':['A'],'phase-committed':['A','B'],'tamper':['A'],'pending':['A'],'ack-newer':['A','own','peer']};counts={};records=[]
for name,items in expected.items():
 directory=d/name;paths=sorted((directory/'commits').glob('*.json'));assert len(paths)==len(items);parent=None;previous=[]
 for index,p in enumerate(paths,1):
  b=p.read_bytes();v=json.loads(b);assert p.name==str(index).zfill(6)+'.json';assert b==(canon(v)+'\n').encode();assert v['protocol']=='siren.publication-history/1'and v['sequence']==index and v['parentSha256']==parent
  assert v['authoritySha256']==sha(canon(v['authority']).encode());assert v['digest']==sha(canon({k:x for k,x in v.items()if k!='digest'}).encode());assert v['state']=={'n':index,'items':items[:index]};assert v['state']['items'][:len(previous)]==previous;previous=v['state']['items'];parent=v['digest']
 counts[name]={'head':len(paths),'digest':parent,'stageFiles':len(list((directory/'staging').iterdir()))}
 records.append({'name':name+' exact full chain/states/authority/body bytes','pass':True})
first=(d/'donor/commits/000001.json').read_bytes()
for name in ['interleaved','fault-writeSync','fault-fsyncSync','fault-linkSync','phase-stage-flushed','phase-before-link','phase-committed','tamper','pending','ack-newer']:assert(d/name/'commits/000001.json').read_bytes()==first
# Coherently invalid prefix still has correct byte/body/parent hashes; the callback, not digest, must refuse it.
v=read(d/'corrupt-prefix/commits/000003.json');assert v['digest']==sha(canon({k:x for k,x in v.items()if k!='digest'}).encode());assert v['parentSha256']==read(d/'corrupt-prefix/commits/000002.json')['digest'];assert v['state']['items'][0]=='rewritten';assert read(d/'corrupt-prefix/commits/000002.json')['state']['items'][0]=='A'
assert len(list((d/'pending/staging').iterdir()))==4;assert (d/'pending/staging/oversize').stat().st_size==16*1024*1024+1;assert(d/'pending/staging/partial').read_bytes()==b'{';assert(d/'pending/staging/not-json').read_bytes()==b'unknown'
summary=read(d/'RESULT.json');assert summary['finished']is True and len(summary['records'])==10 and all(x['pass']is True for x in summary['records']);assert summary['sourceSha256']==sha((r.parent/'provider/src/publication-store.mjs').read_bytes());assert summary['mutants']==[{'name':'read-semantic-prefix guard removed','currentRefuses':True,'mutantAdmits':True,'independentOracleRefuses':True}]
out=r/'store-fs-readback-v1.json';assert not out.exists();out.write_text(json.dumps({'reviewer':'Codex test_claim_review','mode':'Read-only Python physical chain and preserved-stage readback; no publication/native execution','finished':True,'records':records,'summarySha256':sha((d/'RESULT.json').read_bytes()),'sourceSha256':summary['sourceSha256'],'positiveChains':counts,'acknowledgedGenesisBytesSameAcrossCases':True,'coherentPrefixTamperNotDetectedByHashAlone':True,'pendingFilesRetained':True},indent=2),encoding='utf-8');print(json.dumps({'finished':True,'positiveChains':len(records),'readbackSha256':sha(out.read_bytes())}))
