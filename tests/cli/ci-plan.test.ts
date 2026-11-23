import { test, expect } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const cli = resolve('packages/cli/dist/index.js');
test('a protected CI proposal is deterministic and applies only after every destination is checked', async () => {
  const root = await mkdtemp(join(tmpdir(), 'behavproof-ci-plan-'));
  const run = (...args: string[]) => spawnSync(process.execPath, [cli,'ci',...args], {cwd:root,encoding:'utf8'});
  const options = ['--repository','demo/shop','--branch','release/v1','--workflow-branch','automation','--sdk-sha','d'.repeat(40),'--app-id','12345','--runner','vitest'];
  const producer = '.github/workflows/behavproof-producer.yml';
  const publisher = '.github/workflows/behavproof-publisher.yml';
  try {
    spawnSync('git',['init','-q'],{cwd:root});
    await writeFile(join(root,'package.json'),JSON.stringify({scripts:{test:'vitest run'},devDependencies:{vitest:'5.1.0'}}));
    const preview = run('plan',...options);
    expect(preview.status,preview.stderr).toBe(0);
    expect(run('plan',...options).stdout).toBe(preview.stdout);
    const proposal = JSON.parse(preview.stdout);
    expect(proposal.deployment).toMatchObject({repository:'demo/shop',protectedBranch:'release/v1',workflowBranch:'automation',appId:12345});
    expect(proposal.files.map((file: {path:string}) => file.path)).toContain(producer);
    await writeFile(join(root,'proposal.json'),preview.stdout);
    expect(run('apply','--plan','proposal.json','--dry-run').status).toBe(0);
    await expect(readFile(join(root,producer))).rejects.toThrow();
    await mkdir(join(root,'.github/workflows'),{recursive:true});
    await writeFile(join(root,publisher),'keep this');
    expect(run('apply','--plan','proposal.json').status).toBe(1);
    await expect(readFile(join(root,producer))).rejects.toThrow();
    expect(await readFile(join(root,publisher),'utf8')).toBe('keep this');
    await rm(join(root,publisher));
    const applied = run('apply','--plan','proposal.json');
    expect(applied.status,applied.stderr).toBe(0);
    const rerun = run('apply','--plan','proposal.json');
    expect(rerun.status,rerun.stderr).toBe(0);
    expect(JSON.parse(rerun.stdout).files.every((file:{action:string}) => file.action==='preserve')).toBe(true);
    expect(run('plan',...options.slice(0,-2),'--runner','vitest','--repository','bad/../target').status).toBe(2);
  } finally {
    await rm(root,{recursive:true,force:true});
  }
});
