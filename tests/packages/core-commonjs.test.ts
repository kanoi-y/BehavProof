import {expect, it} from 'vitest';
import {spawnSync} from 'node:child_process';
import {ConfigSchema, hash, ContractSchema} from '../../packages/core/src/index.js';

it('loads the same contract validation and revision semantics through a native CommonJS consumer', () => {
  const value={id:'JEST-CJS',kind:'examples',intentIds:['JEST-CJS:intent'],sourceRef:'test.ts',revisionHash:'a'.repeat(64),cases:[{id:'one',input:1,expected:2}]};
  const code=`const {hash,ConfigSchema,ContractSchema}=require('@behavproof/core');const value=${JSON.stringify(value)};process.stdout.write(JSON.stringify({hash:hash(value),config:ConfigSchema.parse({schemaVersion:1}),contract:ContractSchema.parse(value)}));`;
  const result=spawnSync(process.execPath,['--input-type=commonjs','-e',code],{cwd:process.cwd(),encoding:'utf8'});
  expect(result.status,result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({hash:hash(value),config:ConfigSchema.parse({schemaVersion:1}),contract:ContractSchema.parse(value)});
});
