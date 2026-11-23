import{it,expect}from'vitest';
import{traceDirectory}from'../../packages/cli/src/formal.js';
import{FormalModelConfigSchema,RelativePathSchema}from'../../packages/core/src/index.js';
it('uses a scoped default trace directory for a root-level report',()=>{
 const m=FormalModelConfigSchema.parse({id:'ROOT',module:'order',model:'model.qnt',quint:{entry:'quint.mjs',version:'0.33.1'},invariants:['ok'],checks:['parse','typecheck','run'],maxSteps:1,seed:'42',report:'model.json'});
 expect(()=>RelativePathSchema.parse(traceDirectory(m))).not.toThrow();expect(traceDirectory(m)).not.toMatch(/^\.\//);
});
it('snapshots model-only and canary-disabled sources without undefined JSON properties',async()=>{
 const{mkdtemp,writeFile,rm}=await import('node:fs/promises');const{tmpdir}=await import('node:os');const{join}=await import('node:path');const{formalInputIdentity}=await import('../../packages/cli/src/formal.js');const{hash}=await import('../../packages/core/src/index.js');
 const root=await mkdtemp(join(tmpdir(),'formal-defaults-'));try{
  for(const ref of ['model.qnt','quint.mjs','driver.mjs','impl.mjs'])await writeFile(join(root,ref),ref==='model.qnt'?'module model {}':'export {}');
  for(const extra of [{},{driver:'driver.mjs',implementation:'impl.mjs'}]){
   const m=FormalModelConfigSchema.parse({id:'ROOT',module:'order',model:'model.qnt',quint:{entry:'quint.mjs',version:'0.33.1'},invariants:['ok'],checks:['parse','typecheck','run'],maxSteps:1,seed:'42',report:'model.json',requireCanary:false,...extra});
   const identity=await formalInputIdentity(root,m);expect(()=>hash(identity)).not.toThrow();
  }
 }finally{await rm(root,{recursive:true,force:true});}
});
