import {expect,test} from 'vitest';
import {status} from '../src/status.js';

test('enabled probes are ready',()=>expect(status(true)).toBe('ready'));
test('disabled probes are denied',()=>expect(status(false)).toBe('denied'));
