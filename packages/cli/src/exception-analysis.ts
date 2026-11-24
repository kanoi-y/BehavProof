import {posix} from 'node:path';
import ts from 'typescript-parser';

type ScopedExceptionTarget = {
  target: {module: string; exportName: string};
  allowedCallers: readonly string[];
};

export type ScopedExceptionAnalysis = {
  status: 'pass' | 'fail' | 'unknown';
  files: string[];
  calls: {file: string; line: number; column: number; allowed: boolean}[];
  diagnostics: string[];
  limitations: readonly string[];
};

const limitations = [
  'Checks direct calls through static TypeScript imports in the listed files.',
  'Resolves imports within the supplied snapshot using its root TypeScript configuration when present.',
  'Calls through wrappers, dynamic imports, CommonJS loaders, and copied implementations are outside the analysis scope.',
];
const projectRoot = '/behavproof-project';
const projectPath = (file: string) => posix.resolve(projectRoot, file);
const isTypeScript = (file: string) => /\.(?:ts|tsx|mts|cts)$/.test(file);

function snapshotHost(sources: Readonly<Record<string, Uint8Array>>) {
  const snapshot = new Map<string, string>();
  const directories = new Set(['/', projectRoot]);
  const decode = new TextDecoder('utf-8', {fatal: true});
  for (const [file, bytes] of Object.entries(sources)) {
    const path = projectPath(file);
    if (!path.startsWith(projectRoot + '/')) continue;
    try {
      snapshot.set(path, decode.decode(bytes));
    } catch {
      continue;
    }
    for (let dir = posix.dirname(path); !directories.has(dir); dir = posix.dirname(dir)) {
      directories.add(dir);
    }
  }
  return {
    getCurrentDirectory: () => projectRoot,
    getCanonicalFileName: (file: string) => file,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    fileExists: (file: string) => snapshot.has(projectPath(file)),
    readFile: (file: string) => snapshot.get(projectPath(file)),
    directoryExists: (dir: string) => directories.has(projectPath(dir)),
    getDirectories: (dir: string) => [...directories].filter(child => child !== dir && posix.dirname(child) === dir),
    getDefaultLibFileName: () => projectPath('lib.d.ts'),
    getSourceFile(file: string, options: ts.ScriptTarget | ts.CreateSourceFileOptions) {
      const source = snapshot.get(projectPath(file));
      return source === undefined ? undefined : ts.createSourceFile(file, source, options, true);
    },
    writeFile() {
      throw Error('Scoped exception analysis does not emit files');
    },
  };
}

function compilerOptions(host: ReturnType<typeof snapshotHost>, diagnostics: string[]) {
  const defaults: ts.CompilerOptions = {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  };
  let options = defaults;
  const config = projectPath('tsconfig.json');
  if (host.fileExists(config)) {
    const parsed = ts.getParsedCommandLineOfConfigFile(config, {}, {
      ...host,
      useCaseSensitiveFileNames: true,
      readDirectory: () => [],
      onUnRecoverableConfigFileDiagnostic: diagnostic => {
        diagnostics.push(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
      },
    });
    for (const diagnostic of parsed?.errors ?? []) {
      // The protected scope supplies roots independently of tsconfig include/exclude.
      if (diagnostic.code !== 18002 && diagnostic.code !== 18003) {
        diagnostics.push(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
      }
    }
    options = {...parsed?.options};
  }
  return {...options, noLib: true, types: [], noEmit: true, noResolve: false};
}

function outerExpression(node: ts.Node): ts.Node {
  let current = node;
  const isWrapper = (parent: ts.Node) => ts.isParenthesizedExpression(parent) ||
    ts.isNonNullExpression(parent) || ts.isAsExpression(parent) ||
    ts.isTypeAssertionExpression(parent) || ts.isSatisfiesExpression(parent);
  while (current.parent && isWrapper(current.parent) &&
    (current.parent as ts.ParenthesizedExpression).expression === current) {
    current = current.parent;
  }
  return current;
}

/** Observe protected snapshots without loading or running repository code. */
export function inspectScopedException(
  expectation: ScopedExceptionTarget,
  files: readonly string[],
  sources: Readonly<Record<string, Uint8Array>>,
): ScopedExceptionAnalysis {
  const result: ScopedExceptionAnalysis = {
    status: 'unknown',
    files: [...new Set(files)].sort(),
    calls: [],
    diagnostics: [],
    limitations,
  };
  const {module, exportName} = expectation.target;
  const targetRef = `${module}#${exportName}`;
  const host = snapshotHost(sources);
  const options = compilerOptions(host, result.diagnostics);
  if (Object.hasOwn(sources, 'tsconfig.json') && !host.fileExists(projectPath('tsconfig.json'))) {
    result.diagnostics.push('Cannot read protected TypeScript configuration tsconfig.json');
  }
  if (result.diagnostics.length) return result;

  const program = ts.createProgram([...new Set([module, ...result.files])].filter(isTypeScript).map(projectPath), options, host);
  const checker = program.getTypeChecker();
  const canonical = (symbol: ts.Symbol | undefined) => {
    const visited = new Set<ts.Symbol>();
    while (symbol && symbol.flags & ts.SymbolFlags.Alias) {
      if (visited.has(symbol) || symbol.declarations?.some(ts.isTypeOnlyImportOrExportDeclaration)) return;
      visited.add(symbol);
      symbol = checker.getImmediateAliasedSymbol(symbol);
    }
    return symbol?.declarations?.length ? symbol : undefined;
  };
  const exported = (symbol: ts.Symbol | undefined, name: string) =>
    symbol && checker.getExportsOfModule(symbol).find(item => item.getName() === name);
  const targetFile = program.getSourceFile(projectPath(module));
  const targetExport = targetFile && exported(checker.getSymbolAtLocation(targetFile), exportName);
  const target = canonical(targetExport);
  if (!targetFile || !target || !(target.flags & ts.SymbolFlags.Value) || program.getSyntacticDiagnostics(targetFile).length) {
    result.diagnostics.push(`Cannot resolve protected TypeScript export ${targetRef}`);
    return result;
  }

  const allowed = new Set(expectation.allowedCallers);
  for (const file of result.files) {
    const source = program.getSourceFile(projectPath(file));
    if (!source || !isTypeScript(file)) {
      result.diagnostics.push(`Cannot read protected TypeScript caller ${file}`);
      continue;
    }
    if (program.getSyntacticDiagnostics(source).length) {
      result.diagnostics.push(`Cannot parse protected TypeScript caller ${file}`);
      continue;
    }

    const imports = new Map<ts.Symbol, 'target' | 'unresolved' | {module: ts.Symbol}>();
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const clause = statement.importClause;
      if (!clause || clause.isTypeOnly) continue;
      const specifier = statement.moduleSpecifier.text;
      const importedModule = checker.getSymbolAtLocation(statement.moduleSpecifier);
      const local = specifier.startsWith('.') || specifier.startsWith('#') || !!options.baseUrl ||
        Object.keys(options.paths ?? {}).some(pattern => {
          const star = pattern.indexOf('*');
          return star === -1 ? pattern === specifier :
            specifier.startsWith(pattern.slice(0, star)) && specifier.endsWith(pattern.slice(star + 1));
        }) || !!importedModule?.declarations?.some(node => node.getSourceFile().fileName.startsWith(projectRoot + '/'));
      const addImport = (binding: ts.Identifier, name: string) => {
        const symbol = checker.getSymbolAtLocation(binding);
        if (!symbol) return;
        const resolved = canonical(symbol);
        if (resolved === target) imports.set(symbol, 'target');
        else if (!resolved && (local || name === exportName)) imports.set(symbol, 'unresolved');
        else if (resolved && resolved.flags & ts.SymbolFlags.Module &&
          checker.getExportsOfModule(resolved).some(member => canonical(member) === target)) {
          imports.set(symbol, {module: resolved});
        }
      };
      if (clause.name) addImport(clause.name, 'default');
      if (!clause.namedBindings) continue;
      if (ts.isNamespaceImport(clause.namedBindings)) addImport(clause.namedBindings.name, '*');
      else for (const binding of clause.namedBindings.elements) {
        if (!binding.isTypeOnly) addImport(binding.name, (binding.propertyName ?? binding.name).text);
      }
    }

    const locate = (node: ts.Node) => {
      const {line, character} = source.getLineAndCharacterOfPosition(node.getStart(source));
      return {file, line: line + 1, column: character + 1};
    };
    const unresolved = (node: ts.Node) => {
      const {line, column} = locate(node);
      result.diagnostics.push(`${file}:${line}:${column} Cannot trace a possible call to ${targetRef}`);
    };
    const visit = (node: ts.Node) => {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) ||
        (ts.isTypeNode(node) && ts.isPartOfTypeNode(node))) return;
      if (ts.isIdentifier(node)) {
        const symbol = ts.isShorthandPropertyAssignment(node.parent) && node.parent.name === node
          ? checker.getShorthandAssignmentValueSymbol(node.parent)
          : checker.getSymbolAtLocation(node);
        const imported = symbol && imports.get(symbol);
        if (imported === 'unresolved') unresolved(node);
        else if (imported) {
          let reference = outerExpression(node);
          if (typeof imported === 'object') {
            const access = reference.parent;
            const member = ts.isPropertyAccessExpression(access) && access.expression === reference
              ? access.name.text
              : ts.isElementAccessExpression(access) && access.expression === reference &&
                  ts.isStringLiteralLike(access.argumentExpression) ? access.argumentExpression.text : undefined;
            if (member === undefined) {
              unresolved(node);
              return;
            }
            const selected = canonical(exported(imported.module, member));
            if (!selected) unresolved(node);
            if (selected !== target) return;
            reference = outerExpression(access);
          }
          const parent = reference.parent;
          if (ts.isCallExpression(parent) && parent.expression === reference) {
            result.calls.push({...locate(parent), allowed: allowed.has(file)});
          } else if (!ts.isExportAssignment(parent)) {
            unresolved(node);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  result.status = result.calls.some(call => !call.allowed) ? 'fail' : result.diagnostics.length ? 'unknown' : 'pass';
  return result;
}
