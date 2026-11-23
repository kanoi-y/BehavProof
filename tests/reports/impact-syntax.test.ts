import {expect,it,test} from 'vitest';
import {analyzeImpact} from '../../packages/spec-registry/src/index.js';
test('an incomplete source parse cannot establish resolved impact',()=>{
 const result=analyzeImpact({'src/auth.ts':'export function authorize( {'},['src/auth.ts']);expect(result.status).toBe('unknown');expect(result.unknown.join(' ')).toContain('src/auth.ts');
});

it('follows imports and reports unknown dynamic dependencies',()=>{
 const result=analyzeImpact({'test.ts':"import {f} from './src'; f(); import(name)",'src.ts':'export function f(){}'},['src.ts']);
 expect(result.affectedFiles).toContain('test.ts');expect(result.status).toBe('unknown');
});

it('reports static calls and marks computed calls unknown',()=>{
 const result=analyzeImpact({'a.ts':'function f(){ return 1 }; f(); obj[key]()'},['a.ts']);
 expect(result.calls).toContainEqual({file:'a.ts',callee:'f'});expect(result.status).toBe('unknown');
});

it('tracks literal require and dynamic import paths conservatively',()=>{
 const result=analyzeImpact({'test.ts':"const src = require('./src'); import('./src')",'src.ts':'export const n=1'},['src.ts']);
 expect(result.affectedFiles).toEqual(['src.ts','test.ts']);expect(result.status).toBe('pass');
});

it('marks unresolved indirect calls unknown',()=>{
 expect(analyzeImpact({'a.ts':'const run=globalThis.handler; run();'},['a.ts']).status).toBe('unknown');
});
