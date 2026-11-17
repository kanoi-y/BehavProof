import {it,expect} from 'vitest';
import {select} from '../../packages/cli/src/project.js';

it('retains explicitly inventoried paths containing glob syntax',()=>{
 const files=['app/items/[id].tsx','app/items/i.tsx','src/read.ts'];
 expect(select(files,['app/items/[id].tsx','src/read.ts'])).toContain('app/items/[id].tsx');
 expect(select(files,['src/*.ts'])).toEqual(['src/read.ts']);
});
