import {embeddedEvidenceFiles} from '../../packages/cli/src/evidence-files.js';
import {expect,it} from 'vitest';
import {parseConfig} from '../../packages/core/src/index.js';
import {formalEvidenceInventory} from '../../packages/cli/src/formal-artifacts.js';

function configuration(){
  return parseConfig({schemaVersion:2,formal:{models:[{
    id:'orders',model:'order.qnt',module:'order',invariants:['safe'],witnesses:['reached'],
    quint:{entry:'node_modules/@informalsystems/quint/dist/src/cli.js',version:'0.33.1'},
    checks:['parse','typecheck','run'],maxSteps:4,seed:'1',report:'.behavproof/model.json',
    traceDirectory:'.behavproof/orders-traces',minTraces:2,
  }]}});
}
const packed=(files:Record<string,string>)=>Buffer.from(JSON.stringify({
  schemaVersion:1,files:Object.entries(files).map(([ref,content])=>({ref,content:Buffer.from(content).toString('base64')})),
}));

it('opens authenticated formal bytes only for expected model and trace references',()=>{
  const inventory=formalEvidenceInventory(configuration());
  const evidence=embeddedEvidenceFiles(packed({
    '.behavproof/model.json':'{"modelId":"orders"}',
    '.behavproof/model.json.adequacy.json':'{"witnesses":[]}',
    '.behavproof/orders-traces/trace_0.itf.json':'{"states":[]}',
  }),inventory);
  expect(evidence.get('.behavproof/model.json')?.toString()).toBe('{"modelId":"orders"}');
  expect(evidence.size).toBe(3);
  for(const invalid of ['../evil','.behavproof/test.json','.behavproof/orders-traces/trace_2.itf.json']){
    expect(()=>embeddedEvidenceFiles(packed({[invalid]:'{}'}),inventory)).toThrow(/unexpected|scoped relative/i);
  }
});

it('reserves test outputs and detects duplicate formal evidence locations',()=>{
  const config=configuration();
  config.formal!.models[0]!.report='.behavproof/input/vitest.json';
  expect(()=>formalEvidenceInventory(config)).toThrow(/formal evidence path/i);
  const other=configuration();
  other.formal!.models.push({...other.formal!.models[0]!,id:'other'});
  expect(()=>formalEvidenceInventory(other)).toThrow(/duplicate/i);
});

it('does not accept an ambiguous, noncanonical, or empty payload',()=>{
  const inventory=formalEvidenceInventory(configuration());
  for(const bytes of [
    '{"schemaVersion":1,"files":[{"ref":".behavproof/model.json","content":"%%%"}]}',
    '{"schemaVersion":1,"files":[{"ref":".behavproof/model.json","content":""}]}',
  ]){
    expect(()=>embeddedEvidenceFiles(Buffer.from(bytes),inventory)).toThrow(/encoding/i);
  }
});

it('retains model and witness evidence observed before any replay runs',async()=>{
  const {captureQualityFormals}=await import('../../packages/cli/src/quality-formal-worker.js');
  const {mkdir,mkdtemp,rm,writeFile}=await import('node:fs/promises');
  const {tmpdir}=await import('node:os');
  const {join}=await import('node:path');
  const root=await mkdtemp(join(tmpdir(),'hosted-formal-capture-'));
  const config=configuration();
  Object.assign(config.formal!.models[0]!,{
    driver:'driver.js',implementation:'implementation.js',conformanceReport:'.behavproof/replay.json',
  });
  const write=(ref:string,body:string)=>writeFile(join(root,ref),body);
  try{
    await mkdir(join(root,'.behavproof'));
    const actions:string[]=[];
    const bytes=await captureQualityFormals(root,config,'unused.json','/formal/quint',
      async (_root,action,_values,toolRoot)=>{
        actions.push(action);
        expect(toolRoot).toBe('/formal/quint');
        if(action==='check')await write('.behavproof/model.json','{"proof":"original"}');
        if(action==='adequacy')await write('.behavproof/model.json.adequacy.json','{"witness":"original"}');
        if(action==='replay'){
          await write('.behavproof/model.json','{"proof":"changed by replay"}');
          await write('.behavproof/replay.json','{"replayed":true}');
        }
        return {exitCode:0,report:{}};
      });
    expect(actions).toEqual(['check','adequacy','replay']);
    const evidence=embeddedEvidenceFiles(bytes,formalEvidenceInventory(config));
    expect(evidence.get('.behavproof/model.json')?.toString()).toBe('{"proof":"original"}');
    expect(evidence.get('.behavproof/replay.json')?.toString()).toBe('{"replayed":true}');
  }finally{await rm(root,{recursive:true,force:true});}
});
