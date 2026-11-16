import {createServer}from'node:http';import {mkdir,writeFile,rm}from'node:fs/promises';import{join}from'node:path';import{randomUUID}from'node:crypto';
export async function createContext({check,harness}){
 const directory=join(process.cwd(),'.behavproof','stores');await mkdir(directory,{recursive:true});const storePath=join(directory,randomUUID()+'.json');await writeFile(storePath,JSON.stringify({balance:100,refunds:0}));
 const dependencies={storePath,state:{refunds:0},callId:()=>harness.invocationId()};let server;
 if(check.method==='journey'){
  server=createServer((req,res)=>{harness.withInvocation(String(req.headers['x-assurance-call']),async()=>{
   let body='';for await(const chunk of req){body+=chunk;if(body.length>10000)throw Error('Request too large');}const input=JSON.parse(body),allowed=await harness.layer('authorization',input);await harness.layer('database',null);
   res.setHeader('content-type','application/json');res.end(JSON.stringify({status:allowed?'allowed':'denied'}));
  }).catch(()=>{res.statusCode=500;res.end('{}');});});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});dependencies.url='http://127.0.0.1:'+server.address().port;
 }
 return {dependencies,async close(){if(server)await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));await rm(storePath,{force:true});}};
}
