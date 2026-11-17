import type {Config} from '@behavproof/core';
export type NativeRunner='vitest'|'jest';
function configuredKind(config:Config|undefined):NativeRunner|undefined{
 if(!config)return; if(config.testRunner)return config.testRunner;
 const kinds=(['vitest','jest'] as const).filter(kind=>config.reports[kind]);
 return kinds.length===1?kinds[0]:undefined;
}
/** Protected publication refs can differ from source output refs. Retain them;
 * candidate path declarations never select a different authenticated artifact. */
export function testReportSelection(config:Config,protectedConfig?:Config,runner?:{kind:NativeRunner}){
 const protectedKind=runner?.kind??configuredKind(protectedConfig),currentKind=configuredKind(config);
 const ambiguous=!protectedKind&&!config.testRunner&&!!config.reports.vitest&&!!config.reports.jest;
 const kind=protectedKind??currentKind??'vitest';
 const policyChanged=!!protectedConfig&&(protectedConfig.testRunner!==undefined&&protectedConfig.testRunner!==config.testRunner||!!protectedKind&&!!currentKind&&protectedKind!==currentKind||!!runner&&!!configuredKind(protectedConfig)&&runner.kind!==configuredKind(protectedConfig));
 const reportRef=ambiguous?undefined:protectedConfig?.reports[kind]??config.reports[kind];
 return {kind,reportRef,policyChanged,ambiguous};
}
