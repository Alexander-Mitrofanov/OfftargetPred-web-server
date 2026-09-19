"""Verify a real GRCh38 API search recovers a site read from the pinned reference."""
import argparse
from collections import Counter
import json
import math
from pathlib import Path
import time
from urllib.request import Request, urlopen

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--reference',type=Path,required=True)
parser.add_argument('--api-origin',default='http://127.0.0.1:8010')
parser.add_argument('--output',type=Path)
args=parser.parse_args()
sequence=[]
with args.reference.open() as handle:
    chromosome=next(handle).split()[0][1:]
    for line in handle:
        if line.startswith('>'): break
        sequence.append(line.strip().upper())
        if sum(map(len,sequence))>=200000: break
sequence=''.join(sequence)
for position in range(100000,len(sequence)-23):
    guide=sequence[position:position+23]
    counts=Counter(guide[:20])
    if set(guide)<=set('ACGT') and guide[-2:]=='GG' and max(counts.values())<=8 and not any(base*4 in guide for base in 'ACGT'):
        break
else: raise AssertionError('No suitable public reference query found')
origin=args.api_origin.rstrip('/')
def request(path,method='GET',value=None,token=None):
    headers={'Origin':'https://alexander-mitrofanov.github.io'}
    if token: headers['Authorization']='Bearer '+token
    if value is not None: headers['Content-Type']='application/json'
    req=Request(origin+'/api/v1'+path,data=json.dumps(value).encode() if value is not None else None,headers=headers,method=method)
    with urlopen(req,timeout=60) as response:
        return json.load(response)
start=time.monotonic()
job=request('/jobs','POST',{'mode':'genome','input':guide,'format':'text','models':[1,2,3],'assembly':'GRCh38','max_mismatches':1,'name':'Operator GRCh38 acceptance'})
try:
    while time.monotonic()-start<900:
        status=request('/jobs/'+job['id'],token=job['token'])
        if status['status'] in ('completed','failed','cancelled'): break
        time.sleep(2)
    assert status['status']=='completed',status
    result=request('/jobs/'+job['id']+'/download?format=json',token=job['token'])
    rows=result['rows']
    assert any(row['chromosome']==chromosome and row['start']==position and row['strand']=='+' and row['off_target']==guide for row in rows)
    assert all(row['mismatches']<=1 and row['off_target'][-2:]=='GG' for row in rows)
    assert all(set(row['scores'])=={'k1','k2','k3'} for row in rows)
    assert result['metadata']['device']=='cuda'
    report={'passed':True,'reference':'Ensembl115 GRCh38 primary assembly','verified_locus':{'chromosome':chromosome,'start0':position,'strand':'+'},'candidate_count':len(rows),'models':[1,2,3],'max_mismatches':1,'elapsed_seconds':round(time.monotonic()-start,2),'device':'cuda'}
    if args.output: args.output.write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))
finally:
    request('/jobs/'+job['id'],'DELETE',token=job['token'])
