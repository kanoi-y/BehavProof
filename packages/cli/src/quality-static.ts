import ts from 'typescript-parser';
import { dirname, posix, matchesGlob } from 'node:path';
import { RelativePathSchema, safeRead } from '@behavproof/core';

export type Data = Record<string, unknown>;
export const object = (value: unknown): Data | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Data : undefined;
export const strings = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.every(item => typeof item === 'string') ? value : undefined;
export const sourceFile = (path: string) => /\.[cm]?[jt]sx?$/.test(path);
export const defaultTest = (path: string, runner: 'vitest'|'jest') =>
  /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path) ||
  runner==='jest' && /(?:^|\/)__tests__\/.+\.[cm]?[jt]sx?$/.test(path);
export const matches = (file: string, pattern: string) => {
  const path = pattern.replace(/^\.\//, '').replace(/\/$/, '');
  return path === '.' || file === path || file.startsWith(path + '/') || matchesGlob(file, path);
};
export const sourceText = async (root: string, path: string) => new TextDecoder('utf-8', {fatal: true}).decode(await safeRead(root, path, 1024 * 1024));
export function jsonc(path: string, text: string): unknown {
  const parsed = ts.parseConfigFileTextToJson(path, text);
  if (parsed.error) throw Error(ts.flattenDiagnosticMessageText(parsed.error.messageText, '\n'));
  return parsed.config;
}

function literal(node: ts.Expression, wrappers: Set<string>): unknown {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) return literal(node.expression, wrappers);
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && wrappers.has(node.expression.text) && node.arguments.length === 1) {
    return literal(node.arguments[0]!, wrappers);
  }
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(entry => literal(entry, wrappers));
  if (!ts.isObjectLiteralExpression(node)) throw Error('Configuration contains an expression that requires execution');
  const properties = new Map<string, unknown>();
  for (const entry of node.properties) {
    if (!ts.isPropertyAssignment(entry) || !(ts.isStringLiteralLike(entry.name) || ts.isIdentifier(entry.name)) || properties.has(entry.name.text)) {
      throw Error('Configuration contains an unsupported or duplicate property');
    }
    properties.set(entry.name.text, literal(entry.initializer, wrappers));
  }
  return Object.fromEntries(properties);
}

export async function readStatic(root: string, path: string, wrapperModule?: string): Promise<unknown> {
  const text = await sourceText(root, path);
  if (/\.(?:json|jsonc)$/.test(path)) return jsonc(path, text);
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  if ((source as ts.SourceFile & {parseDiagnostics: readonly ts.Diagnostic[]}).parseDiagnostics.length) throw Error('Malformed configuration');
  const wrappers = new Set<string>();
  let result: ts.Expression | undefined;
  for (const stmt of source.statements) {
    if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier) && stmt.moduleSpecifier.text === wrapperModule) {
      const clause = stmt.importClause;
      const bindings = clause?.namedBindings;
      if (!clause?.name && bindings && ts.isNamedImports(bindings) && bindings.elements.every(element => (element.propertyName ?? element.name).text === 'defineConfig')) {
        for (const element of bindings.elements) wrappers.add(element.name.text);
        continue;
      }
    }
    if (!result && ts.isExportAssignment(stmt) && !stmt.isExportEquals) {
      result = stmt.expression;
      continue;
    }
    if (!result && ts.isExpressionStatement(stmt) && ts.isBinaryExpression(stmt.expression) &&
        stmt.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken && stmt.expression.left.getText(source) === 'module.exports') {
      result = stmt.expression.right;
      continue;
    }
    throw Error('Configuration must be observed in an isolated run to resolve shared or dynamic values');
  }
  if (!result) throw Error('No configuration export');
  return literal(result, wrappers);
}

export function focusLines(path: string, text: string, runner: string) {
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const tests = new Set(['test','it','describe','suite']);
  const namespaces = new Set<string>();
  for (const stmt of file.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier) ||
        ![runner, '@jest/globals'].includes(stmt.moduleSpecifier.text)) continue;
    const bindings = stmt.importClause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) if (tests.has((element.propertyName ?? element.name).text)) tests.add(element.name.text);
    }
  }
  const hits = new Set<number>();
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
        /^(?:fit|fdescribe|xit|xdescribe|xtest)$/.test(node.expression.text)) {
      hits.add(file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1);
    }
    if (ts.isPropertyAccessExpression(node) && ['only','skip','todo','skipIf','runIf'].includes(node.name.text)) {
      const base = node.expression;
      if ((ts.isIdentifier(base) && tests.has(base.text)) ||
          (ts.isPropertyAccessExpression(base) && ts.isIdentifier(base.expression) && namespaces.has(base.expression.text) && tests.has(base.name.text))) {
        hits.add(file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return [...hits];
}

const strictFlags = ['alwaysStrict','noImplicitAny','noImplicitThis','strictBindCallApply','strictBuiltinIteratorReturn',
  'strictFunctionTypes','strictNullChecks','strictPropertyInitialization','useUnknownInCatchVariables'];
export const hasStrictTypes = (options: Data, javascript: boolean) =>
  options.strict === true && options.noCheck !== true && options.emitDeclarationOnly !== true &&
  strictFlags.every(flag => options[flag] !== false) && (!javascript || options.allowJs === true && options.checkJs === true);

type CompilerProject = { path: string; selected: string[]; options: Data };
export async function compilerProjects(root: string, entry: string, files: string[], build: boolean) {
  const documents = new Map<string, Data>();
  const inputs = new Set<string>();
  const projects = new Map<string, CompilerProject>();
  const relativePath = (from: string, to: string) => {
    if (posix.isAbsolute(to) || to.includes('\\')) throw Error('TypeScript config references must stay inside the project');
    return RelativePathSchema.parse(posix.join(dirname(from).replaceAll('\\', '/'), to));
  };
  const locate = (path: string) => [path, path + '.json', path + '/tsconfig.json'].find(item => files.includes(item)) ?? path;
  type Pattern = {values: string[]; origin: string};
  type Settings = {options: Data; files?: Pattern; include?: Pattern; exclude?: Pattern};
  async function read(path: string) {
    if (!files.includes(path)) throw Error(`Missing project configuration: ${path}`);
    if (!documents.has(path)) {
      const value = object(await readStatic(root, path));
      if (!value) throw Error('Invalid TypeScript configuration object');
      documents.set(path, value);
      inputs.add(path);
    }
    return documents.get(path)!;
  }
  async function settings(path: string, stack: string[]): Promise<Settings> {
    if (stack.includes(path) || stack.length > 32) throw Error('Cyclic or overly deep TypeScript extends');
    const raw = await read(path);
    const parents = typeof raw.extends === 'string' ? [raw.extends] : raw.extends === undefined ? [] : strings(raw.extends);
    if (!parents) throw Error('Invalid TypeScript extends');
    const result: Settings = {options: {}};
    for (const parent of parents) {
      if (!parent.startsWith('./') && !parent.startsWith('../')) throw Error('TypeScript package configuration requires effective observation');
      const base = await settings(locate(relativePath(path, parent)), [...stack, path]);
      Object.assign(result, base, {options: {...result.options, ...base.options}});
    }
    Object.assign(result.options, object(raw.compilerOptions) ?? {});
    for (const key of ['files','include','exclude'] as const) {
      if (raw[key] === undefined) continue;
      const values = strings(raw[key]);
      if (!values) throw Error(`Invalid TypeScript ${key} list`);
      result[key] = {values, origin: path};
    }
    return result;
  }
  const match = (path: string, patterns: Pattern) =>
    patterns.values.some(pattern => matches(path, relativePath(patterns.origin, pattern)));
  async function visit(path: string, stack: string[]) {
    if (stack.includes(path) || stack.length > 32) throw Error('Cyclic or overly deep TypeScript project references');
    if (projects.has(path)) return;
    const raw = await read(path);
    const settingsValue = await settings(path, []);
    const {options} = settingsValue;
    const include = settingsValue.include ?? {values: settingsValue.files ? [] : ['**/*'], origin: path};
    const exclude = settingsValue.exclude ?? {values: ['node_modules', 'bower_components', 'jspm_packages'], origin: path};
    const supported = (file: string) => /\.[cm]?tsx?$/.test(file) || options.allowJs === true && /\.[cm]?jsx?$/.test(file);
    const explicit = settingsValue.files?.values.map(item => relativePath(settingsValue.files!.origin, item)) ?? [];
    if (explicit.some(item => !files.includes(item))) throw Error('A TypeScript files entry is missing from the project');
    const selected = [...new Set([...explicit, ...files.filter(file => supported(file) && match(file, include) && !match(file, exclude))])].sort();
    projects.set(path, {path, selected, options});
    if (raw.references !== undefined && !Array.isArray(raw.references)) throw Error('Invalid TypeScript references');
    if (build && Array.isArray(raw.references)) for (const value of raw.references) {
      const ref = object(value)?.path;
      if (typeof ref !== 'string') throw Error('Invalid TypeScript project reference');
      await visit(locate(relativePath(path, ref)), [...stack, path]);
    }
  }
  await visit(entry, []);
  return {projects: [...projects.values()], inputs: [...inputs].sort()};
}
