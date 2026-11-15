import {expect,test} from 'vitest';
import {analyzeImpact} from '../../packages/contract-registry/src/index.js';
test('an incomplete source parse cannot establish resolved impact',()=>{
 const result=analyzeImpact({'src/auth.ts':'export function authorize( {'},['src/auth.ts'],{});expect(result.status).toBe('unknown');expect(result.unknown.join(' ')).toContain('src/auth.ts');
});
