// Called by a fixed host-created Collector wrapper. Only the sandbox launcher,
// not candidate code, runs in this Node.js process.
import {runQualitySandbox} from './quality-ci-sandbox.mjs';

const request=JSON.parse(process.env.BEHAVPROOF_QUALITY_REQUEST??'');
const outputDir=process.env.BEHAVPROOF_OUTPUT_DIR;
if (!outputDir) throw Error('Collector output directory unavailable');
process.exitCode=await runQualitySandbox({...request,outputDir});
