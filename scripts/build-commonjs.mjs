import {mkdir, readdir, readFile, writeFile, copyFile, rm} from 'node:fs/promises';
import {join, relative, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript-parser';

// Lower the already typechecked ESM output; schema logic has one source.
const root=fileURLToPath(new URL('../packages/core/',import.meta.url));
const output=join(root,'cjs/dist');
await rm(output,{recursive:true,force:true});
async function emit(directory){
  for(const entry of await readdir(directory,{withFileTypes:true})){
    const source=join(directory,entry.name);
    if(entry.isDirectory()){await emit(source);continue;}
    if(!entry.name.endsWith('.ts')||entry.name.endsWith('.d.ts'))continue;
    const base=relative(join(root,'src'),source).slice(0,-3);
    const target=join(output,base+'.js');await mkdir(dirname(target),{recursive:true});
    const built=join(root,'dist',base+'.js');
    const compiled=ts.transpileModule(await readFile(built,'utf8'),{
      fileName:base+'.js',reportDiagnostics:true,
      compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true,sourceMap:true},
    });
    const errors=compiled.diagnostics?.filter(d=>d.category===ts.DiagnosticCategory.Error)??[];
    if(errors.length)throw Error(ts.formatDiagnosticsWithColorAndContext(errors,{getCanonicalFileName:p=>p,getCurrentDirectory:()=>root,getNewLine:()=> '\n'}));
    await writeFile(target,compiled.outputText);
    if(compiled.sourceMapText)await writeFile(target+'.map',compiled.sourceMapText);
    for(const suffix of ['.d.ts','.d.ts.map'])await copyFile(join(root,'dist',base+suffix),join(output,base+suffix));
  }
}
await emit(join(root,'src'));
