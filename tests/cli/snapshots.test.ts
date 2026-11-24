import { test, expect } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authenticate, TrustRootSchema } from '../../packages/cli/src/trust.js';
import { hash, hashBytes } from '../../packages/core/src/index.js';
test('authentication retains the exact validated bytes across later file mutation',async()=>{
 const root=await mkdtemp(join(tmpdir(),'behavproof-snapshot-'));
 try {
  const subject={testedCommitSha:'a'.repeat(40),sourceTreeHash:hash({source:'current'}),dirty:false},producer={tool:'fixture',version:'1',collectorVersion:'1'},commandHash=hash({command:'selected'}),artifact={ref:'report.json',kind:'test',scope:['src.ts']},original=Buffer.from('{"total":0}');
  const expected={executionId:'current',subject,commandHash,configHashes:{},artifacts:[artifact]};
  await writeFile(join(root,'report.json'),original);await writeFile(join(root,'manifest.json'),JSON.stringify({schemaVersion:1,...expected,producer,environment:{nodeVersion:process.version,platform:process.platform},startedAt:'2026-11-13T00:00:00Z',completedAt:'2026-11-13T00:00:01Z',exitCode:0,artifacts:[{...artifact,sha256:hashBytes(original)}]}));
  const trust=TrustRootSchema.parse({schemaVersion:2,policy:{schemaVersion:1,profileVersion:'2',rules:{testResult:{severity:'error'}}},config:{schemaVersion:2},sourceCommit:subject.testedCommitSha,specifications:[],runner:{kind:'vitest',version:'5.1.0',manifestRef:'manifest.json'},inputs:['src.ts'],configPaths:[],manifests:[{ref:'manifest.json',manifestHash:hash(JSON.parse(await readFile(join(root,'manifest.json'),'utf8'))),expected,authority:{kind:'local',producer,executionId:'current',commandHash}}]});
  const result=await authenticate(root,trust,subject);expect(result.verified.has('report.json')).toBe(true);
  await writeFile(join(root,'report.json'),'{"total":99}');expect(result.artifactBytes.get('report.json')).toEqual(original);
  const manifest=JSON.parse(await readFile(join(root,'manifest.json'),'utf8'));Object.assign(trust.manifests[0]!,{manifestHash:hash(manifest)});manifest.artifacts[0].sha256=hashBytes(Buffer.from('{"total":99}'));await writeFile(join(root,'manifest.json'),JSON.stringify(manifest));
  expect((await authenticate(root,trust,subject)).verified.has('report.json')).toBe(false);
 }finally{await rm(root,{recursive:true,force:true});}
});
