import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import type {Config} from '@behavproof/core';
import {assuranceEvidenceInventory,hostedAssuranceReport} from './assurance-artifacts.js';
import {collectEvidenceFiles,encodeEvidenceFiles} from './evidence-files.js';
import {exists} from './project.js';

export async function captureQualityAssurance(root:string,config:Config,configRef:string,commit:string){
  const inventory=assuranceEvidenceInventory(config);
  for(const ref of inventory)if(await exists(root,ref))throw Error('Hosted Assurance evidence must be freshly collected');
  const worker=fileURLToPath(new URL('./assurance-worker.js',import.meta.url));
  const observed=await new Promise<boolean>(resolve=>{
    execFile(process.execPath,[worker,root,configRef,hostedAssuranceReport,commit],{
      cwd:root,timeout:config.assurance?.timeoutMs??60000,maxBuffer:1024*1024,
    },error=>resolve(!error||error.code===1));
  });
  return encodeEvidenceFiles(observed?await collectEvidenceFiles(root,inventory):new Map());
}
