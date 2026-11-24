import { test, expect } from 'vitest';
import { parseConfig, resolveRisk } from '../../packages/core/src/index.js';
test('risk selectors choose explicit path and module profiles',()=>{
 const cfg=parseConfig({schemaVersion:2,profile:'basic',riskOverrides:[{selector:{kind:'path',value:'src/auth/**'},profile:'critical'},{selector:{kind:'module',value:'payments'},profile:'standard'}]});
 expect(resolveRisk(cfg,{path:'src/other.ts'})).toBe('basic');expect(resolveRisk(cfg,{path:'src/auth/access.ts'})).toBe('critical');expect(resolveRisk(cfg,{path:'src/pay.ts',module:'payments'})).toBe('standard');
});
test('a protected floor cannot be silently lowered by an override',()=>{
 const cfg=parseConfig({schemaVersion:2,riskOverrides:[{selector:{kind:'path',value:'src/**'},profile:'basic'}]});
 expect(resolveRisk(cfg,{path:'src/auth.ts'},'critical')).toBe('critical');expect(resolveRisk(cfg,{path:'src/a.ts'},'standard')).toBe('standard');
 expect(()=>parseConfig({schemaVersion:2,riskOverrides:[{selector:{kind:'path',value:'../outside'},profile:'critical'}]})).toThrow();
});
