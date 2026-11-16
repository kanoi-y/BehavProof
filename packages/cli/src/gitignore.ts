import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { safeRead } from '@behavproof/core';
import { exists, git } from './project.js';

export type GitignorePlan={action:'create'|'update'|'preserve';content:string};
/** Inspect before writing either init file. Existing bytes and line endings survive. */
export async function planGitignore(root:string):Promise<GitignorePlan>{
 if(!await exists(root,'.gitignore'))return {action:'create',content:'.behavproof/\n'};
 const stat=await lstat(join(root,'.gitignore'));
 if(!stat.isFile()||stat.nlink>1)throw Error('Unsafe .gitignore: expected a single regular file');
 const content=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await safeRead(root,'.gitignore'));
 const rules=content.replace(/^\uFEFF/,'').split(/\r?\n/).map(line=>line.replace(/[ \t]+$/,''));
 const explicit=rules.filter(line=>/^!?\/?\.behavproof\/?$/.test(line));
 let covered=!!explicit.length&&!explicit.at(-1)!.startsWith('!');
 if(covered){
  // An arbitrary ignored leaf is insufficient: later rules can expose JSON
  // while ignoring the probe. Require Git's responsible rule to exclude the
  // .behavproof directory itself; its descendants then cannot be re-included.
  try{const match=await git(root,['check-ignore','--no-index','--verbose','--','.behavproof/behavproof-init-probe']);
   // The query path is fixed ASCII; match only the canonical rule and that
   // exact path at the end, without parsing or trusting the source filename.
   covered=/:\d+:\/?\.behavproof\/?\t\.behavproof\/behavproof-init-probe\r?\n?$/.test(match);
  }
  catch(error){const code=(error as {code?:string|number}).code;
   if(code===1)covered=false;
   else if(code===128||code==='ENOENT'){
    // Without Git, any later negation makes coverage uncertain. Append one
    // explicit final rule rather than promising that generated data is ignored.
    covered=!rules.slice(rules.lastIndexOf(explicit.at(-1)!)+1).some(line=>line.startsWith('!'));
   }else throw error;
  }
 }
 if(covered)return {action:'preserve',content};
 const newline=content.match(/\r?\n/)?.[0]??'\n';
 return {action:'update',content:content+(content&&!content.endsWith('\n')?newline:'')+'.behavproof/'+newline};
}
