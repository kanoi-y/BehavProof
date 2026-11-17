import {beforeEach,afterEach,it,expect} from 'vitest';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import{join}from'node:path';import{execFileSync}from'node:child_process';
import{detectProject}from'../../packages/adapter-reports/src/git.js';
let root:string;beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),'jest-project-'));execFileSync('git',['init','-q'],{cwd:root});});afterEach(async()=>rm(root,{recursive:true,force:true}));
async function project(deps:Record<string,string>,test='jest'){await writeFile(join(root,'package.json'),JSON.stringify({name:'project',engines:{node:'24.x'},devDependencies:deps,scripts:{test}}));}
it('recognizes a single-package declared Jest project without executing scripts',async()=>{await project({jest:'29.7.0'});expect(await detectProject(root)).toMatchObject({support:'single-package'});});
it('requires an explicit selection when both test frameworks are declared',async()=>{await project({jest:'29.7.0',vitest:'5.1.0'});expect((await detectProject(root)).support).toBe('unsupported');expect((await detectProject(root,{runner:'jest',version:'29.7.0'})).support).toBe('single-package');});
it('preserves unsupported scripts until a host selects the installed native runner',async()=>{await project({jest:'29.7.0'},'echo skip && jest');expect((await detectProject(root)).support).toBe('unsupported');expect((await detectProject(root,{runner:'jest',version:'29.7.0'})).support).toBe('single-package');expect((await detectProject(root,{runner:'vitest',version:'5.1.0'})).support).toBe('unsupported');});
