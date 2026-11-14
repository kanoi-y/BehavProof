import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { GitHubAuthority } from '../packages/adapter-github/dist/index.js';
// Read credentials in memory only. No token is written to evidence or diagnostics.
const token=execFileSync('gh',['auth','token'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
const repository='kanoi-y/pdd-ts',provider=new GitHubAuthority({repository,token});
const existing=await provider.protection('main',[{context:'PDD protected gate',appId:5653976}]);
const behavproof=await provider.protection('main',[{context:'BehavProof protected gate',appId:5653976}]);
const evidence={schemaVersion:1,observedAt:new Date().toISOString(),repository,existingPddProtection:existing,behavproofProtection:behavproof,claim:'Read-only live API observation. Existing PDD protection is not BehavProof acceptance. No repository settings changed.'};
await writeFile(new URL('../docs/evidence/github-live-adapter.json',import.meta.url),JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify({existing:existing.status,behavproof:behavproof.status}));
