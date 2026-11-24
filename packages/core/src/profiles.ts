import { matchesGlob } from 'node:path';
import type { Config, Policy, Risk, RulePolicy } from './schemas.js';

// Versioned presets select obligations, not universal claims of product quality.
const standard:Record<string,RulePolicy>={
  testResult:{severity:'error'},
  changedLineCoverage:{severity:'warn',min:80},
  mutationScore:{severity:'warn',min:70,minMutants:10},
  pipelineIntegrity:{severity:'warn'},
};
const version2:Record<Risk,Record<string,RulePolicy>>={
  basic:{...standard,mutationScore:{severity:'off',min:70,minMutants:10}},
  standard,
  critical:{
    testResult:{severity:'error'},
    changedLineCoverage:{severity:'error',min:80},
    mutationScore:{severity:'error',min:70,minMutants:10},
    pipelineIntegrity:{severity:'error'},
    policyProtection:{severity:'error'},
    changeImpact:{severity:'error'},
  },
};
export function getProfilePolicy(profile:Risk,profileVersion:'2'='2'):Policy{
  if(profileVersion!=='2'||!Object.hasOwn(version2,profile))throw new RangeError('Unsupported profile/version');
  return {schemaVersion:1,profileVersion,rules:structuredClone(version2[profile])};
}

/** Explicit selectors may raise risk; protected floors are never lowered. */
export function resolveRisk(config:Pick<Config,'profile'|'riskOverrides'>,target:{path:string;module?:string},protectedFloor?:Risk):Risk{
 let selected=config.profile;
 for(const row of config.riskOverrides){const s=row.selector;if(s.kind==='path'?matchesGlob(target.path,s.value):target.module===s.value)selected=row.profile;}
 const level:Record<Risk,number>={basic:0,standard:1,critical:2};
 return [selected,protectedFloor].filter((v):v is Risk=>v!==undefined).sort((a,b)=>level[b]-level[a])[0]!;
}
