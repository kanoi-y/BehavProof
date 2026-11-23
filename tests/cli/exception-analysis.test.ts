import {describe, expect, it} from 'vitest';
import {inspectScopedException} from '../../packages/cli/src/exception-analysis.js';

const exception = {
  target: {module: 'src/legacy.ts', exportName: 'legacy'},
  allowedCallers: ['src/approved.ts'],
};

function sourceFiles(files: Record<string, string>) {
  const encode = new TextEncoder();
  return Object.fromEntries(Object.entries(files).map(([file, source]) => [file, encode.encode(source)]));
}

const legacy = 'export function legacy() { throw new Error("must never execute"); }';

describe('scoped exception symbol analysis', () => {
  it('observes the same symbol through a named alias and multiple re-exports', () => {
    const files = ['src/approved.ts', 'src/forbidden.ts', 'src/public.ts'];
    const sources = sourceFiles({
      'src/legacy.ts': legacy,
      'src/public.ts': 'export {legacy as oldOperation} from "./legacy.js";',
      'src/barrel.ts': 'export * from "./public.js";',
      'src/approved.ts': 'import {legacy as invoke} from "./legacy.js";\n(invoke)();',
      'src/forbidden.ts': 'import {oldOperation as invoke} from "./barrel.js";\ninvoke?.();',
      'src/unselected.ts': 'import {legacy} from "./legacy.js"; legacy();',
    });
    expect(inspectScopedException(exception, ['src/approved.ts', 'src/public.ts'], sources)).toMatchObject({
      status: 'pass',
      calls: [{file: 'src/approved.ts', line: 2, column: 1, allowed: true}],
    });
    expect(inspectScopedException(exception, files, sources)).toMatchObject({
      status: 'fail',
      files,
      calls: [
        {file: 'src/approved.ts', line: 2, column: 1, allowed: true},
        {file: 'src/forbidden.ts', line: 2, column: 1, allowed: false},
      ],
    });
  });

  it('does not confuse shadowed and unrelated same-name symbols with the target', () => {
    const sources = sourceFiles({
      'src/legacy.ts': legacy,
      'src/other.ts': 'export function legacy() {}',
      'src/caller.ts': `import {legacy} from "./legacy.js";
import {legacy as other} from "./other.js";
function unrelated(legacy: () => void) { legacy(); }
type Handler = typeof legacy;
other();
// @behavproof-exception BP-214
// legacy();`,
    });
    expect(inspectScopedException(exception, ['src/caller.ts'], sources)).toMatchObject({status: 'pass', calls: []});
  });

  it('keeps a function value used indirectly unresolved even beside a permitted call', () => {
    const sources = sourceFiles({
      'src/legacy.ts': legacy,
      'src/approved.ts': 'import {legacy} from "./legacy.js";\nlegacy();\nconst callbacks = {legacy};',
    });
    expect(inspectScopedException(exception, ['src/approved.ts'], sources)).toMatchObject({
      status: 'unknown',
      calls: [{file: 'src/approved.ts', line: 2, allowed: true}],
      diagnostics: [expect.stringContaining('src/approved.ts:3:')],
    });
  });

  it('reports a verified forbidden call alongside an indirect namespace reference', () => {
    const sources = sourceFiles({
      'src/legacy.ts': legacy,
      'src/caller.ts': `import * as operations from "./legacy.js";
const escape = operations;
operations.legacy();`,
    });
    expect(inspectScopedException(exception, ['src/caller.ts'], sources)).toMatchObject({
      status: 'fail',
      calls: [{file: 'src/caller.ts', line: 3, allowed: false}],
      diagnostics: [expect.stringContaining('src/caller.ts:2:')],
    });
  });

  it('cannot establish a target exported only as a type through a barrel', () => {
    const sources = sourceFiles({
      'src/legacy.ts': legacy,
      'src/exports.ts': 'export type {legacy} from "./legacy.js";',
      'src/public.ts': 'export {legacy} from "./exports.js";',
      'src/caller.ts': 'import type {legacy} from "./public.js";',
    });
    expect(inspectScopedException({
      ...exception,
      target: {module: 'src/public.ts', exportName: 'legacy'},
    }, ['src/caller.ts'], sources)).toMatchObject({
      status: 'unknown',
      diagnostics: [expect.stringContaining('src/public.ts#legacy')],
    });
  });

  it('reports an imported value used as a superclass as unresolved', () => {
    const sources = sourceFiles({
      'src/legacy.ts': 'export class legacy {}',
      'src/caller.ts': 'import {legacy} from "./legacy.js";\nclass Extended extends legacy {}',
    });
    expect(inspectScopedException(exception, ['src/caller.ts'], sources)).toMatchObject({
      status: 'unknown',
      diagnostics: [expect.stringContaining('src/caller.ts:2:')],
    });
  });

  it('keeps an unresolved value import from a broken local re-export unresolved', () => {
    const sources = sourceFiles({
      'src/legacy.ts': legacy,
      'src/public.ts': 'export {legacy as operation} from "./moved.js";',
      'src/caller.ts': 'import {operation as act} from "./public.js";\nact();',
    });
    expect(inspectScopedException(exception, ['src/caller.ts'], sources)).toMatchObject({
      status: 'unknown',
      calls: [],
      diagnostics: [expect.stringContaining('src/caller.ts:2:')],
    });
  });

  it('resolves TypeScript paths from the protected snapshot', () => {
    const sources = sourceFiles({
      'tsconfig.json': '{"compilerOptions":{"paths":{"@compat/*":["./src/*"]}}}',
      'src/legacy.ts': legacy,
      'src/caller.ts': 'import {legacy as invoke} from "@compat/legacy";\ninvoke();',
    });
    expect(inspectScopedException(exception, ['src/caller.ts'], sources)).toMatchObject({
      status: 'fail',
      calls: [{file: 'src/caller.ts', line: 2, allowed: false}],
    });
  });

  it.each([
    ['moved', {'src/moved.ts': legacy}],
    ['renamed', {'src/legacy.ts': 'export function renamed() {}'}],
  ])('keeps the obligation unknown when the target is %s', (_, files) => {
    const sources = sourceFiles({...files, 'src/caller.ts': 'export {};'} as Record<string, string>);
    expect(inspectScopedException(exception, ['src/caller.ts'], sources)).toMatchObject({
      status: 'unknown',
      diagnostics: [expect.stringContaining('src/legacy.ts#legacy')],
    });
  });

  it('keeps an unavailable protected caller unresolved', () => {
    const sources = sourceFiles({'src/legacy.ts': legacy});
    expect(inspectScopedException(exception, ['src/approved.ts'], sources)).toMatchObject({
      status: 'unknown',
      diagnostics: [expect.stringContaining('src/approved.ts')],
    });
  });
});
