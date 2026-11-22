import {z} from 'zod';
import {RelativePathSchema, safeReadJson, canonicalJson} from '@behavproof/core';
import {fileList} from './project.js';
import {compilerProjects, defaultTest, focusLines, hasStrictTypes, matches, object, readStatic, sourceFile, sourceText, strings, type Data} from './quality-static.js';

export const baselineRules = {
  eslint: ['no-debugger','no-dupe-args','no-dupe-keys','no-unreachable','no-constant-condition'],
  biome: ['suspicious/noDebugger','suspicious/noDuplicateParameters','suspicious/noDuplicateObjectKeys',
    'correctness/noUnreachable','correctness/noConstantCondition'],
};
export const QualityPolicy = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.string().min(1).max(100),
  lint: z.strictObject({tool: z.enum(['eslint','biome']), rules: z.array(z.string().min(1).max(100)).min(1).max(200)}),
  types: z.union([z.literal('strict'), z.strictObject({notApplicable: z.string().trim().min(1).max(500)})]),
  runner: z.enum(['vitest','jest']),
  sources: z.array(RelativePathSchema).min(1).max(100),
});
export type QualityPolicy = z.infer<typeof QualityPolicy>;
export type QualityOptions = {runner?: 'vitest'|'jest'; policy?: QualityPolicy};
type Status = 'pass'|'fail'|'unknown'|'not_applicable';
type Finding = {id: string; status: Status; evidence: string[]; message: string; action: string; required: boolean};
type Find = (id: string, status: Status, evidence: string[], message: string, action: string, required?: boolean) => void;
export type Command = {status: 'pass'|'fail'|'unknown'; args: string[]; message: string};

function script(scripts: Data, name: string, visited: string[] = []): Command {
  const fail = (message: string): Command => ({status:'fail', args:[], message});
  if (visited.includes(name) || visited.length >= 32) return fail('Cyclic npm script reference');
  const raw = scripts[name];
  if (typeof raw !== 'string' || !raw.trim()) return fail(`Missing npm script: ${name}`);
  if (/\|\|\s*(?:true|:|exit\s+0|echo\b)|;\s*(?:true|:|exit\s+0)\s*$|^(?:echo|true|exit\s+0)\b/.test(raw.trim())) return fail('Command can succeed without enforcing the check');
  if (/[\n\r;&|<>$`\\]/.test(raw)) return {status:'unknown', args:[], message:'Compound shell command or expansion requires review'};
  const tokens = raw.trim().match(/"[^"]*"|'[^']*'|[^\s"']+/g)?.map(word => word.replace(/^(['"])(.*)\1$/, '$2')) ?? [];
  if (/["']/.test(raw) && !/^(?:\s*(?:"[^"]*"|'[^']*'|[^\s"']+)\s+)*(?:"[^"]*"|'[^']*'|[^\s"']+)\s*$/.test(raw)) {
    return {status:'unknown',args:[],message:'Unsupported shell quoting'};
  }
  if (tokens.length === 3 && tokens[0] === 'npm' && ['run','run-script'].includes(tokens[1]!)) return script(scripts, tokens[2]!, [...visited,name]);
  if (tokens.join(' ') === 'npm test') return script(scripts,'test',[...visited,name]);
  return {status:'pass', args:tokens, message:'Recognized direct tool invocation'};
}

export const configArg = (args: string[], keys: string[]) => {
  for (const [i,arg] of args.entries()) {
    if (keys.includes(arg)) return args[i + 1];
    if (keys.some(key => arg.startsWith(key + '='))) return arg.slice(arg.indexOf('=') + 1);
  }
  return undefined;
};

export const qualitySources = (files: string[], policy: QualityPolicy) =>
  files.filter(file => sourceFile(file) && !defaultTest(file,policy.runner) && !/(?:^|\/)(?:dist|coverage|build|__mocks__)\//.test(file) &&
    !/(?:^|\/)(?:[\w.-]+\.config|\.eslintrc)\.[cm]?[jt]s$/.test(file) && !/\.d\.[cm]?ts$/.test(file) &&
    policy.sources.some(pattern => matches(file,pattern)));

export function qualityCommands(pkg: Data, policy: QualityPolicy) {
  const dependencies = {...object(pkg.dependencies),...object(pkg.devDependencies),...object(pkg.optionalDependencies)};
  const scripts = object(pkg.scripts) ?? {};
  const lint = script(scripts,'lint'), types = script(scripts,'typecheck'), tests = script(scripts,'test');
  const lintName = policy.lint.tool === 'biome' ? '@biomejs/biome' : 'eslint';
  const path = (value: string | undefined) => !!value && !value.startsWith('-') &&
    (value === '.' || RelativePathSchema.safeParse(value.replace(/^\.\//,'')).success);
  const lintFlags = policy.lint.tool === 'eslint'
    ? new Map([['-c',path],['--config',path],['--ext',(value?: string) => !!value && /^\.[a-z]+(?:,\.[a-z]+)*$/i.test(value)],['--max-warnings',(value?: string) => !!value && /^(?:-1|\d+)$/.test(value)]])
    : new Map([['--config-path',path],['--max-diagnostics',(value?: string) => !!value && /^(?:none|\d+)$/.test(value)]]);
  const lintSwitches = policy.lint.tool === 'eslint' ? ['--no-inline-config'] : ['--error-on-warnings'];
  const lintStart = policy.lint.tool === 'eslint' ? 1 : 2;
  let safeLint = lint.args[0] === policy.lint.tool && (lintStart === 1 || ['lint','check'].includes(lint.args[1] ?? ''));
  const seenLintFlags = new Set<string>();
  for (let i = lintStart; safeLint && i < lint.args.length; i++) {
    const arg = lint.args[i]!;
    const key = arg.split('=', 1)[0]!;
    const accepts = lintFlags.get(key);
    if (accepts) {
      const canonical = key === '-c' ? '--config' : key;
      safeLint = !seenLintFlags.has(canonical) && accepts(arg.includes('=') ? arg.slice(key.length + 1) : lint.args[++i]);
      seenLintFlags.add(canonical);
    } else safeLint = lintSwitches.includes(arg) || path(arg);
  }
  const typeArgs = types.args.slice(1);
  const build = ['--build','-b'].includes(typeArgs[0] ?? '');
  const boolType = /^--(?:noEmit|incremental|pretty|noUnusedLocals|noUnusedParameters)(?:=(?:true|false))?$/;
  let safeTypes = types.args[0] === 'tsc';
  const seenTypeFlags = new Set<string>();
  for (let i = Number(build); safeTypes && i < typeArgs.length; i++) {
    const arg = typeArgs[i]!;
    if (!build && ['--project','-p'].includes(arg)) {
      safeTypes = !seenTypeFlags.has('--project') && path(typeArgs[++i]);
      seenTypeFlags.add('--project');
    } else if (!build && arg.startsWith('--project=')) {
      safeTypes = !seenTypeFlags.has('--project') && path(arg.slice('--project='.length));
      seenTypeFlags.add('--project');
    } else if (!build && boolType.test(arg)) {
      const name = arg.split('=',1)[0]!;
      safeTypes = !seenTypeFlags.has(name);
      seenTypeFlags.add(name);
      if (!arg.includes('=') && /^(?:true|false)$/.test(typeArgs[i+1] ?? '')) i++;
    } else safeTypes = build ? path(arg) : false;
  }
  const testArgs = tests.args.slice(policy.runner === 'vitest' ? 2 : 1);
  let safeTests = tests.args[0] === policy.runner && (policy.runner !== 'vitest' || tests.args[1] === 'run');
  let testConfig = false;
  for (let i = 0; safeTests && i < testArgs.length; i++) {
    const arg = testArgs[i]!;
    if (['--config','-c'].includes(arg) || arg.startsWith('--config=')) {
      safeTests = !testConfig && path(arg.includes('=') ? arg.slice('--config='.length) : testArgs[++i]);
      testConfig = true;
    } else safeTests = policy.runner === 'jest' && ['--ci','--runInBand','--coverage','--watchman=false'].includes(arg);
  }
  const validate = (command: Command, ok: boolean, name: string): Command => {
    if (command.status !== 'pass' || ok && typeof dependencies[name] === 'string') return command;
    return {...command, status:'fail', message:'Missing tool or unsupported command arguments'};
  };
  return {
    lint: validate(lint,safeLint,lintName),
    types: validate(types,safeTypes,'typescript'),
    tests: validate(tests,safeTests,policy.runner),
  };
}
function lintTargets(args: string[], tool: 'eslint'|'biome') {
  const targets: string[] = [];
  for (let i=tool === 'eslint' ? 1 : 2; i<args.length; i++) {
    const arg = args[i]!;
    if (['-c','--config','--config-path','--max-warnings','--max-diagnostics','--ext'].includes(arg)) {i++; continue;}
    if (!arg.startsWith('-')) targets.push(arg);
  }
  return targets;
}
const errorLevel = (value: unknown): boolean =>
  value === 'error' || value === 2 || Array.isArray(value) && errorLevel(value[0]) || object(value)?.level === 'error';
function included(path: string, patterns: string[]) {
  let selected = patterns[0]?.startsWith('!') ?? false;
  for (const pattern of patterns) {
    const negated = pattern.startsWith('!');
    if (matches(path, negated ? pattern.slice(1) : pattern)) selected = !negated;
  }
  return selected;
}
function effectiveEslint(raw: unknown, path: string, flat: boolean) {
  const rows = flat ? raw : [raw];
  if (!Array.isArray(rows)) throw Error('Flat ESLint config must be an array');
  const rules: Data = Object.create(null);
  let selected = !flat || /\.(?:js|mjs|cjs)$/.test(path);
  for (const value of rows) {
    const row = object(value);
    if (!row || ['extends','plugins','processor','basePath','overrides'].some(key => row[key] !== undefined)) throw Error('ESLint shared rules, plugins, or overrides require effective observation');
    const ignores = strings(flat ? row.ignores : row.ignorePatterns) ?? [];
    if (ignores.some(pattern => pattern.startsWith('!'))) throw Error('ESLint negated ignores require effective observation');
    if (ignores.some(pattern => matches(path, pattern))) {
      if (!flat || Object.keys(row).every(key => ['name','ignores'].includes(key))) return undefined;
      continue;
    }
    const patterns = strings(row.files);
    if (row.files !== undefined && !patterns) throw Error('ESLint file pattern requires effective observation');
    if (patterns && !patterns.some(pattern => matches(path, pattern))) continue;
    if (patterns) selected = true;
    Object.assign(rules, object(row.rules));
  }
  return selected ? rules : undefined;
}
function effectiveBiome(raw: unknown, path: string, files: string[]) {
  const obj = object(raw);
  if (!obj || obj.extends !== undefined || obj.overrides !== undefined || obj.plugins !== undefined) throw Error('Biome shared rules, plugins, or overrides require effective observation');
  if (files.some(file => file !== 'biome.json' && file !== 'biome.jsonc' && /\/biome\.jsonc?$/.test(file))) throw Error('Nested Biome configuration requires effective observation');
  const linter = object(obj.linter), scope = object(obj.files);
  if (object(obj.vcs)?.useIgnoreFile === true) throw Error('Biome VCS ignore rules require effective observation');
  for (const block of [scope,linter]) {
    if (block?.include !== undefined || block?.ignore !== undefined) throw Error('Biome legacy file patterns require effective observation');
    if (block?.includes !== undefined && !strings(block.includes)) throw Error('Invalid Biome includes');
    const patterns = strings(block?.includes);
    if (patterns && !included(path, patterns)) return undefined;
  }
  const groups = object(linter?.rules) ?? {};
  return Object.fromEntries(Object.entries(groups).flatMap(([group,values]) =>
    Object.entries(object(values) ?? {}).map(([rule,value]) => [group + '/' + rule, linter?.enabled === false ? 'off' : value])));
}

async function lint(root: string, files: string[], sources: string[], args: string[], policy: QualityPolicy, find: Find) {
  const {tool,rules} = policy.lint;
  const explicit = configArg(args, ['--config','-c','--config-path'])?.replace(/^\.\//,'');
  const known = tool === 'eslint'
    ? ['eslint.config.js','eslint.config.mjs','eslint.config.cjs','eslint.config.ts','eslint.config.mts','eslint.config.cts','.eslintrc.json','.eslintrc.js','.eslintrc.cjs','.eslintrc.yml','.eslintrc.yaml']
    : ['biome.json','biome.jsonc'];
  const path = explicit ?? known.find(file => files.includes(file));
  const action = `Enable ${rules.join(', ')} at error severity for every selected source. Observe shared configuration in an isolated run.`;
  if (!path || !files.includes(path)) {
    find('lint.rules','fail',path ? [path] : [],'Selected lint configuration is missing',action);
    return;
  }
  try {
    const raw = await readStatic(root, path, 'eslint/config');
    if (tool === 'eslint' && (files.includes('.eslintignore') || files.some(file => /\/\.eslintrc(?:\.|$)/.test(file)))) throw Error('ESLint ignore files or nested configuration require effective observation');
    const missing: string[] = [], weak: string[] = [];
    const targets = lintTargets(args,tool);
    for (const file of sources) {
      const effective = tool === 'eslint' ? effectiveEslint(raw,file,Array.isArray(raw)) : effectiveBiome(raw,file,files);
      if (!effective || targets.length && !targets.some(target => matches(file,target))) missing.push(file);
      else for (const rule of rules) if (!errorLevel(effective[rule])) weak.push(`${file} (${rule})`);
    }
    find('lint.scope',sources.length && !missing.length ? 'pass' : 'fail',[path,...missing],
      missing.length ? 'Source files are excluded or outside the lint command scope' : `${sources.length} selected source files`,
      'Include all selected source files in lint targets and remove overly broad ignores.');
    find('lint.rules',sources.length && !weak.length && !missing.length ? 'pass' : 'fail',[path,...weak],
      weak.length ? 'Required lint rules are missing, disabled or below error severity' : 'Checked required rule severity for in-scope sources',action);
  } catch (error) {
    find('lint.rules','unknown',[path],(error as Error).message,action);
  }
}

async function types(root: string, files: string[], sources: string[], args: string[], policy: QualityPolicy, find: Find) {
  if (policy.types !== 'strict') {
    find('types.scope',sources.some(file => /\.[cm]?tsx?$/.test(file)) ? 'fail' : 'not_applicable',[],
      policy.types.notApplicable,'Adopt strict TypeScript checking when TypeScript source is present.');
    return;
  }
  const build = args.includes('--build') || args.includes('-b');
  const path = (configArg(args,['--project','-p']) ?? (build ? args.slice(1).find(arg => !arg.startsWith('-')) : undefined) ?? 'tsconfig.json').replace(/^\.\//,'');
  const entry = files.includes(path) ? path : files.includes(path + '/tsconfig.json') ? path + '/tsconfig.json' : path;
  const action = 'Use a strict tsconfig that includes the production sources and run the complete typecheck.';
  if (!files.includes(entry)) {
    find('types.scope','fail',[entry],'Selected TypeScript project is missing',action);
    return;
  }
  try {
    const {projects,inputs} = await compilerProjects(root,entry,files,build);
    const selected = new Set(projects.flatMap(project => project.selected));
    const missing = sources.filter(file => !selected.has(file));
    const weak = projects.filter(project => project.selected.length && !hasStrictTypes(project.options,
      project.selected.some(file => sources.includes(file) && /\.[cm]?jsx?$/.test(file))));
    find('types.scope',sources.length && !missing.length ? 'pass' : 'fail',[...inputs,...missing],
      missing.length ? 'Production source files are outside the configured compiler inputs' : `${selected.size} configured compiler inputs`,action);
    find('types.strict',selected.size && !weak.length ? 'pass' : 'fail',weak.map(project => project.path),
      weak.length ? 'Strict compiler settings are missing or overridden' : 'Checked strict compiler settings',action);
  } catch (error) {
    find('types.scope','unknown',[entry],(error as Error).message,action);
  }
}

async function tests(root: string, files: string[], pkg: Data, args: string[], policy: QualityPolicy, find: Find) {
  const runner = policy.runner;
  const suffixes = ['ts','mts','cts','js','mjs','cjs','json'];
  const names = (runner === 'vitest' ? ['vitest.config','vite.config'] : ['jest.config']).flatMap(base => suffixes.map(ext => base + '.' + ext));
  const path = configArg(args,['--config','-c'])?.replace(/^\.\//,'') ?? names.find(file => files.includes(file));
  const action = 'Select the intended test files and resolve dynamic settings in an isolated test run.';
  try {
    const config = path ? object(await readStatic(root,path,runner === 'vitest' ? 'vitest/config' : undefined))
      : runner === 'jest' && pkg.jest !== undefined ? object(pkg.jest) : {};
    if (!config) throw Error('Invalid test configuration');
    const settings = runner === 'vitest' ? object(config.test) ?? {} : config;
    if (['projects','preset','root','rootDir','workspace','dir','includeSource','testRegex','filters','filter','testRunner','runner'].some(key => config[key] !== undefined || settings[key] !== undefined)) {
      throw Error('Custom test selection requires effective runner observation');
    }
    const tests = files.filter(file=>defaultTest(file,runner));
    const rawInclude = runner === 'vitest' ? settings.include : settings.testMatch;
    const patterns = strings(rawInclude);
    const excludes = strings(settings.exclude);
    const jestIgnore = strings(settings.testPathIgnorePatterns);
    const normalize = (pattern: string) => pattern.replace(/^<rootDir>\//,'');
    if (rawInclude !== undefined && !patterns || settings.exclude !== undefined && !excludes || settings.testPathIgnorePatterns !== undefined && !jestIgnore) throw Error('Invalid test scope patterns');
    const selected = files.filter(file => sourceFile(file) &&
      (patterns ? included(file,patterns.map(normalize)) : defaultTest(file,runner)) &&
      !(excludes ?? []).some(pattern => matches(file,normalize(pattern))) &&
      !(jestIgnore ?? []).some(pattern => new RegExp(pattern.replace('<rootDir>','^')).test('/' + file)));
    const excluded = tests.filter(file => !selected.includes(file));
    const evidence = path ? [path] : ['package.json'];
    find('test.scope',selected.length && !excluded.length ? 'pass' : 'fail',[...evidence,...(excluded.length ? excluded : selected)],
      !selected.length ? 'No test files match the selected configuration' : excluded.length ? 'Conventional test files are excluded' : `${selected.length} test files selected`,action);
    const unsafe = ['passWithNoTests','watch','watchAll','changed','related','onlyChanged','allowOnly','bail'].filter(key => settings[key] === true);
    if (typeof settings.testNamePattern === 'string' && settings.testNamePattern) unsafe.push('testNamePattern');
    find('test.settings',unsafe.length ? 'fail' : 'pass',evidence,
      unsafe.length ? 'Unsafe test options: ' + unsafe.join(', ') : 'Checked options for full, non-watch test runs',
      'Remove test filters, focus allowances, watch flags and empty-test success.');
    const focus: string[] = [];
    for (const file of selected) for (const line of focusLines(file,await sourceText(root,file),runner)) focus.push(`${file}:${line}`);
    find('test.focus',focus.length ? 'fail' : 'pass',focus,focus.length ? 'Focused, skipped, pending or conditional test declarations found' : 'No such declarations found in selected source', 'Remove or review the affected test declarations.');
    const coverage = runner === 'vitest' ? object(settings.coverage) : settings;
    const coverageOn = coverage?.[runner === 'vitest' ? 'enabled' : 'collectCoverage'] === true;
    const coverageReporters = coverage?.[runner === 'vitest' ? 'reporter' : 'coverageReporters'];
    const lcov = (typeof coverageReporters === 'string' ? [coverageReporters] : strings(coverageReporters) ?? []).includes('lcov');
    const thresholds = object(coverage?.[runner === 'vitest' ? 'thresholds' : 'coverageThreshold']);
    find('test.coverage',coverageOn && lcov ? 'pass' : 'unknown',evidence,
      `Coverage ${coverageOn ? 'enabled' : 'not enabled in static config'}; LCOV ${lcov ? 'configured' : 'not explicit'}; thresholds ${thresholds ? canonicalJson(thresholds) : 'not explicit'}`,
      'Enable coverage and LCOV if required by your profile, then collect current coverage evidence.',false);
    find('test.reporters','pass',evidence,`Configured runners' reporters: ${settings.reporters ? canonicalJson(settings.reporters) : 'defaults'}; behavproof test supplies its JSON reporters`,
      'Collect native test and contract reports with behavproof test.',false);
  } catch (error) {
    find('test.scope','unknown',path ? [path] : ['package.json'],(error as Error).message,action);
  }
}

export async function diagnoseQuality(root: string, options: QualityOptions = {}) {
  const pkg = object(await safeReadJson(root,'package.json'));
  if (!pkg) throw Error('Invalid package.json');
  const files = (await fileList(root)).filter(path => !path.startsWith('.behavproof/') && !path.startsWith('.git/'));
  const dependencies = {...object(pkg.dependencies),...object(pkg.devDependencies),...object(pkg.optionalDependencies)};
  const lintScript = script(object(pkg.scripts) ?? {},'lint');
  const tools = ['vitest','jest'].filter(kind => typeof dependencies[kind] === 'string');
  const selected = options.policy?.runner ?? options.runner ?? (tools.length === 1 ? tools[0] : undefined);
  const tool = lintScript.args[0] === 'biome' || typeof dependencies['@biomejs/biome'] === 'string' && typeof dependencies.eslint !== 'string' ? 'biome' : 'eslint';
  const policy = options.policy ?? QualityPolicy.parse({schemaVersion:1,id:'quality-baseline-v1',
    lint:{tool,rules:baselineRules[tool]}, types:'strict', runner:selected ?? 'vitest',
    sources: files.some(file => file.startsWith('src/') && sourceFile(file) && !defaultTest(file,selected==='jest'?'jest':'vitest')) ? ['src/**/*'] : ['**/*']});
  const findings: Finding[] = [];
  const find: Find = (id,status,evidence,message,action,required = true) =>
    findings.push({id,status,evidence:[...new Set(evidence)].sort(),message,action,required});
  const sources = qualitySources(files,policy);
  const {lint: lintCommand, types: typeCommand, tests: testCommand} = qualityCommands(pkg,policy);
  for (const row of [
    {id:'lint.command',cmd:lintCommand,action:'Declare the linter and configure lint to check the full source scope.'},
    {id:'types.command',cmd:typeCommand,action:'Declare TypeScript and use tsc --noEmit -p tsconfig.json or tsc --build.'},
    {id:'test.command',cmd:selected ? testCommand : {status:'fail' as const,message:'Select a declared test runner'},action:'Declare one supported runner and configure a full non-watch test command without filters or empty-test success.'},
  ]) {
    const status = row.id === 'types.command' && policy.types !== 'strict' ? 'not_applicable' : row.cmd.status;
    find(row.id,status,['package.json'],row.cmd.message,row.action);
  }
  await lint(root,files,sources,lintCommand.args,policy,find);
  await types(root,files,sources,typeCommand.args,policy,find);
  await tests(root,files,pkg,testCommand.args,policy,find);
  return {
    schemaVersion:1 as const, policy, sources, findings,
    status:findings.some(item => item.required && item.status === 'fail') ? 'fail' as const
      : findings.some(item => item.required && item.status === 'unknown') ? 'incomplete' as const : 'pass' as const,
    notice:'Static configuration observations only. Collect authenticated runs for execution evidence.',
  };
}

export function formatQuality(report: Awaited<ReturnType<typeof diagnoseQuality>>, format: string) {
  if (format === 'console' || format === 'markdown') {
    const title = `Quality configuration: ${report.status} (${report.policy.id})`;
    const escape = (value: string) => value.replace(/[\r\n]/g,' ').replaceAll('|','\\|');
    const lines = report.findings.map(item => format === 'console'
      ? `${item.status} ${item.id}${item.required ? '' : ' (advisory)'}: ${escape(item.message)}\n  ${item.evidence.map(escape).join(', ')}\n  ${item.action}`
      : `| ${item.id} | ${item.status} | ${item.required ? 'required' : 'advisory'} | ${escape(item.evidence.join(', '))} | ${escape(item.message)} | ${escape(item.action)} |`);
    return (format === 'markdown'
      ? ['# '+title,'','| Check | Status | Requirement | Evidence | Observation | Action |','| --- | --- | --- | --- | --- | --- |']
      : [title]).concat(lines,'',report.notice,'').join('\n');
  }
  if (format !== 'json') throw Error('Unsupported doctor format');
  return canonicalJson(report) + '\n';
}
