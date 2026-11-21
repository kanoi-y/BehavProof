import {execFile} from 'node:child_process';
import {lstat, mkdtemp, realpath, rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname, isAbsolute, join, relative, resolve, sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {promisify} from 'node:util';
import {z} from 'zod';
import {RelativePathSchema, safeReadJson} from '@behavproof/core';
import {normalizeJest, normalizeVitest} from '@behavproof/adapter-reports';
import {config, fileList} from './project.js';
import {configArg, qualityCommands, qualitySources, type Command, type QualityPolicy} from './quality.js';
import {defaultTest, focusLines, hasStrictTypes, object, sourceText, strings, type Data} from './quality-static.js';
import {runTests} from './test-command.js';

const finding = z.strictObject({status: z.enum(['pass','fail','unknown']), message: z.string().min(1).max(4000)});
export const QualityObservation = z.strictObject({
  schemaVersion: z.literal(1),
  lint: finding,
  types: finding,
  tests: finding,
  configuration: finding,
});
export type QualityObservation = z.infer<typeof QualityObservation>;
type Finding = z.infer<typeof finding>;
type Check = {execution: Finding; settings: Finding};

const exec = promisify(execFile);
const environment = () => ({...process.env, CI: 'true'});
const reportLimit = 10 * 1024 * 1024;
const result = (status: Finding['status'], message: string): Finding => ({status,message: message.trim().slice(0,4000) || status});
const info = (error: unknown) => error instanceof Error ? error.message : String(error);
const pass = (message: string) => result('pass',message);
const fail = (message: string) => result('fail',message);
const unknown = (message: string) => result('unknown',message);
const prevented = (settings: Finding): Check => ({settings,execution:settings});
const describe = (values: string[]) => values.slice(0,10).join(', ') + (values.length > 10 ? ` (+${values.length - 10} more)` : '');

function pathIn(root: string, path: string) {
  const ref = relative(root,resolve(root,path));
  if (ref === '..' || ref.startsWith('..' + sep) || isAbsolute(ref)) throw Error('Path escapes the project: ' + path);
  return ref.split(sep).join('/');
}

async function localPath(root: string, path: string) {
  const expected = resolve(root,path);
  pathIn(root,await realpath(expected));
  return expected;
}

async function installed(root: string, name: string, bin: string) {
  const require = createRequire(join(root,'package.json'));
  try {
    const modules = await realpath(join(root,'node_modules'));
    const pkg = require.resolve(name + '/package.json');
    pathIn(modules,await realpath(pkg));
    const entry = join(dirname(pkg),bin);
    pathIn(modules,await realpath(entry));
    return {entry,require,pkg};
  } catch {
    throw Error(`Install the locked project dependency ${name} before observing quality.`);
  }
}

async function run(root: string, entry: string, args: string[]) {
  try {
    const capture = await exec(process.execPath,[entry,...args],{cwd:root,env:environment(),timeout:120000,maxBuffer:reportLimit,encoding:'utf8'});
    return {...capture,code:0};
  } catch (error) {
    const failure = error as {code?:number|string; stdout?:string; stderr?:string};
    if (typeof failure.code === 'number') return {code:failure.code,stdout:failure.stdout ?? '',stderr:failure.stderr ?? ''};
    throw error;
  }
}

async function jsonOutput(root: string, entry: string, args: string[]) {
  const capture = await run(root,entry,args);
  if (capture.code) throw Error(capture.stdout || capture.stderr || `Exit code ${capture.code}`);
  return JSON.parse(capture.stdout) as unknown;
}

function arrayOfObjects(value: unknown) {
  if (!Array.isArray(value)) throw Error('Tool output did not contain an inventory');
  return value.map(item => {
    const entry = object(item);
    if (!entry) throw Error('Tool output contained an invalid inventory entry');
    return entry;
  });
}

function readFileNames(root: string, values: unknown[]) {
  return values.map(path => {
    if (typeof path !== 'string' || !path.trim()) throw Error('Tool output contained an invalid file path');
    return pathIn(root,path);
  });
}

async function checkCommand(command: Command, observe: (args: string[]) => Promise<Check>): Promise<Check> {
  if (command.status !== 'pass') return prevented(result(command.status,command.message));
  try {
    return await observe(command.args.slice(1));
  } catch (error) {
    return prevented(unknown(info(error)));
  }
}

type Eslint = {calculateConfigForFile(path: string): Promise<unknown>};
type EslintConstructor = new (options: {cwd: string; overrideConfigFile?: string}) => Eslint;

async function observeEslint(root: string, sources: string[], rules: string[], args: string[]): Promise<Check> {
  const {entry,require} = await installed(root,'eslint','bin/eslint.js');
  const selected = configArg(args,['--config','-c']);
  const overrideConfigFile = selected ? await localPath(root,selected) : undefined;
  const engine = require('eslint') as {ESLint?: EslintConstructor; loadESLint?: () => Promise<EslintConstructor>};
  const Constructor = engine.loadESLint ? await engine.loadESLint() : engine.ESLint;
  if (!Constructor) return prevented(unknown('The installed ESLint does not expose an effective configuration API'));
  const eslint = new Constructor({cwd:root,...(overrideConfigFile ? {overrideConfigFile} : {})});
  const capture = await run(root,entry,[...args,'--format=json','--no-inline-config']);
  if (capture.code > 1) return prevented(unknown(capture.stderr || 'ESLint could not resolve the selected configuration'));
  const linted = arrayOfObjects(JSON.parse(capture.stdout));
  const files = new Set(readFileNames(root,linted.filter(file =>
    !arrayOfObjects(file.messages).some(message => message.ruleId === null && typeof message.message === 'string' &&
      /^(?:File ignored|No matching configuration)/.test(message.message))).map(file => file.filePath)));
  const missing = sources.filter(file => !files.has(file));
  const weak: string[] = [], unsupported: string[] = [];
  for (const file of sources) {
    if (!files.has(file)) continue;
    const effective = object(await eslint.calculateConfigForFile(join(root,file)));
    if (!effective || effective.processor || effective.language && effective.language !== '@/js') {
      unsupported.push(file);
      continue;
    }
    for (const rule of rules) {
      const value = object(effective.rules)?.[rule];
      const severity = Array.isArray(value) ? value[0] : value;
      if (severity !== 'error' && severity !== 2) weak.push(`${file} (${rule})`);
    }
  }
  const suppressed = linted.some(file => Array.isArray(file.suppressedMessages) && file.suppressedMessages.some(item => rules.includes(String(object(item)?.ruleId))));
  const settings = missing.length ? fail('Outside the executed ESLint scope: ' + describe(missing))
    : weak.length ? fail('Required ESLint rules below error severity: ' + describe(weak))
    : suppressed ? fail('ESLint suppressed diagnostics from required rules')
    : unsupported.length ? unknown('Cannot observe ESLint rule enforcement through the selected processor or language: ' + describe(unsupported))
    : pass(`ESLint observed error severity and coverage for ${sources.length} selected files`);
  const failures = linted.filter(row => Number(row.errorCount) || Number(row.warningCount)).map(row => String(row.filePath)).map(file => pathIn(root,file));
  return {settings,execution:capture.code ? fail('ESLint reported check failures: ' + describe(failures)) : pass('ESLint completed successfully')};
}

const biomeProbes = new Map([
  ['suspicious/noDebugger','debugger;'],
  ['suspicious/noDuplicateParameters','function run(a, a) { return a; }'],
  ['suspicious/noDuplicateObjectKeys','const probe = { key: 1, key: 2 };'],
  ['correctness/noUnreachable','function run() { return; void 0; }'],
  ['correctness/noConstantCondition','if (true) { void 0; }'],
]);

async function observeBiome(root: string, sources: string[], rules: string[], args: string[]): Promise<Check> {
  const {entry} = await installed(root,'@biomejs/biome','bin/biome');
  const selected = configArg(args,['--config-path']);
  if (selected) await localPath(root,selected);
  const capture = await run(root,entry,[...args,'--reporter=json']);
  const native = object(JSON.parse(capture.stdout));
  const summary = object(native?.summary);
  if (!summary) return prevented(unknown('The installed Biome did not return a recognized JSON summary'));
  const reported = arrayOfObjects(native?.diagnostics);
  if (!Number(summary.changed) && !Number(summary.unchanged)) {
    return prevented(fail('Biome processed no files in the selected lint command'));
  }
  const configArgs = selected ? ['--config-path',selected] : [];
  const weak: string[] = [];
  const unavailable = rules.filter(rule => !biomeProbes.has(rule));
  for (const source of sources) {
    const tracked = await run(root,entry,['lint',...configArgs,'--reporter=json',source]);
    const checked = object(object(JSON.parse(tracked.stdout))?.summary);
    if (!checked || Number(checked.changed) + Number(checked.unchanged) !== 1) {
      return prevented(fail('Outside the effective Biome lint scope: ' + source));
    }
    for (const rule of rules.filter(id => biomeProbes.has(id))) {
      const args = ['lint',...configArgs,'--reporter=json','--max-diagnostics=none','--stdin-file-path',source];
      const {stdout} = await new Promise<{stdout:string}>((resolve,reject) => {
        const child = execFile(process.execPath,[entry,...args],{cwd:root,env:environment(),timeout:30000,maxBuffer:reportLimit,encoding:'utf8'},
          (error,stdout) => error && typeof error.code !== 'number' ? reject(error) : resolve({stdout}));
        child.stdin?.on('error',reject);
        child.stdin?.end(biomeProbes.get(rule) + '\n');
      });
      const diagnostics = arrayOfObjects(object(JSON.parse(stdout))?.diagnostics);
      if (!diagnostics.some(row => row.category === 'lint/' + rule && row.severity === 'error')) weak.push(`${source} (${rule})`);
    }
  }
  const settings = weak.length ? fail('Required Biome rules below error severity: ' + describe(weak))
    : unavailable.length ? unknown('Biome has no effective severity observation for: ' + describe(unavailable))
    : pass(`Biome observed error severity and coverage for ${sources.length} selected files`);
  const failures = reported.map(row => String(row.category)).filter(Boolean);
  return {settings,execution:capture.code ? fail('Biome reported check failures: ' + describe(failures)) : pass('Biome completed successfully')};
}

function commandLintTargets(args: string[], tool: QualityPolicy['lint']['tool']) {
  const positionals: string[] = [];
  for (let i = tool === 'biome' ? 1 : 0; i < args.length; i++) {
    const arg = args[i]!;
    if (['--config-path','--max-diagnostics','--config','-c','--max-warnings','--ext'].includes(arg)) i++;
    else if (!arg.startsWith('-')) positionals.push(arg.replace(/^\.\//,'').replace(/\/$/,'') || '.');
  }
  return positionals;
}

async function typeProjects(root: string, entry: string, args: string[], build: boolean, sources: string[]) {
  const checked = new Map<string,Data>();
  const seen = new Set<string>();
  const stack = new Set<string>();
  const weak = new Set<string>();
  const covered = new Set<string>();
  async function inspect(project: string, extra: string[]) {
    const resolved = await localPath(root,project);
    const input = (await lstat(resolved)).isDirectory() ? await localPath(root,join(resolved,'tsconfig.json')) : resolved;
    const ref = pathIn(root,input);
    if (stack.has(ref) || stack.size >= 32) throw Error('Cyclic or overly deep TypeScript project references');
    if (seen.has(ref)) return;
    if (seen.size >= 100) throw Error('Too many TypeScript project references to observe');
    seen.add(ref);
    stack.add(ref);
    const shown = object(await jsonOutput(root,entry,['--project',input,...extra,'--showConfig']));
    const compiler = object(shown?.compilerOptions);
    if (!shown || !compiler) throw Error('TypeScript did not return effective compiler options for ' + ref);
    checked.set(ref,compiler);
    if (build && shown.references !== undefined) {
      for (const row of arrayOfObjects(shown.references)) {
        if (typeof row.path !== 'string') throw Error('TypeScript returned an invalid project reference');
        await inspect(resolve(dirname(input),row.path),[]);
      }
    }
    if ((strings(shown.files) ?? []).length || !build || !shown.references) {
      const files = await run(root,entry,['--project',input,...extra,'--listFilesOnly','--pretty','false']);
      if (files.code) throw Error(files.stdout || files.stderr || 'TypeScript did not list its input files');
      const inventory = new Set(files.stdout.split(/\r?\n/).filter(Boolean).map(file => resolve(root,file)));
      const selected = sources.filter(file => inventory.has(join(root,file)));
      for (const file of selected) covered.add(file);
      if (selected.length && !hasStrictTypes(compiler,selected.some(file => /\.[cm]?jsx?$/.test(file)))) weak.add(ref);
    }
    stack.delete(ref);
  }
  if (build) {
    for (const project of args.length > 1 ? args.slice(1) : ['tsconfig.json']) await inspect(project,[]);
  } else {
    const extra: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]!;
      if (['--project','-p'].includes(arg)) i++;
      else if (!arg.startsWith('--project=')) extra.push(arg);
    }
    await inspect(configArg(args,['--project','-p']) ?? 'tsconfig.json',extra);
  }
  return {options:[...checked.values()],weak:[...weak],missing:sources.filter(file => !covered.has(file))};
}

async function observeTypes(root: string, sources: string[], args: string[]): Promise<Check> {
  const {entry} = await installed(root,'typescript','bin/tsc');
  const build = ['--build','-b'].includes(args[0] ?? '');
  const compiler = await typeProjects(root,entry,args,build,sources);
  const disabled: string[] = [];
  for (const source of sources) {
    if (/^\s*(?:(?:\/\/|\/\*+|\*)\s*)@ts-nocheck\b/m.test(await sourceText(root,source))) disabled.push(source);
  }
  const settings = compiler.missing.length ? fail('Outside the TypeScript compiler inputs: ' + describe(compiler.missing))
    : compiler.weak.length ? fail('Required strict TypeScript compiler settings are disabled: ' + describe(compiler.weak))
    : disabled.length ? fail('TypeScript checking is disabled by @ts-nocheck: ' + describe(disabled))
    : pass(`Strict TypeScript checking covers ${sources.length} selected files`);
  const scratch = await mkdtemp(join(tmpdir(),'behavproof-typecheck-'));
  try {
    const refresh = build ? ['--force'] : compiler.options.some(options => options.incremental === true || options.composite === true)
      ? ['--tsBuildInfoFile',join(scratch,'typecheck.tsbuildinfo')] : [];
    const capture = await run(root,entry,[...args,...refresh,'--pretty','false']);
    return {settings,execution:capture.code ? fail(capture.stdout || capture.stderr || 'TypeScript exited with code ' + capture.code)
      : settings.status === 'pass' ? pass('TypeScript completed successfully') : settings};
  } finally {
    await rm(scratch,{recursive:true,force:true});
  }
}

type VitestContext = {config:Data; projects: unknown[]; globTestSpecifications():Promise<unknown>; close():Promise<void>};

const testSelectors = (config: Data) => ['passWithNoTests','watch','watchAll','onlyChanged','onlyFailures','changed','related',
  'testNamePattern','testPathPatterns','testPathPattern','shard','tagsFilter','bail','filter','findRelatedTests',
  'dangerouslyIgnoreUnhandledErrors'].filter(key =>
    Array.isArray(config[key]) ? config[key].length > 0 : Boolean(config[key]));

async function testInventory(root: string, runner: QualityPolicy['runner'], configPath?: string) {
  if (runner === 'vitest') {
    const {require} = await installed(root,'vitest','vitest.mjs');
    const exported = await import(pathToFileURL(require.resolve('vitest/node')).href) as {
      createVitest(options: Data): Promise<VitestContext>;
    };
    const vitest = await exported.createVitest({root,run:true,...(configPath ? {config:configPath} : {})});
    try {
      if (vitest.projects.length !== 1 || vitest.config.runner || object(vitest.config.browser)?.enabled) {
        throw Error('Observe one supported Vitest project without a custom runner or browser mode');
      }
      return {files:readFileNames(root,arrayOfObjects(await vitest.globTestSpecifications()).map(row => row.moduleId)),
        unsafe:testSelectors(vitest.config)};
    } finally {
      await vitest.close();
    }
  }
  const {entry,pkg} = await installed(root,'jest','bin/jest.js');
  const args = configPath ? ['--config',configPath] : [];
  const shown = object(await jsonOutput(root,entry,['--showConfig',...args]));
  const global = object(shown?.globalConfig);
  const projects = arrayOfObjects(shown?.configs);
  const expectedRunner = createRequire(pkg).resolve('jest-runner');
  const selected = projects[0];
  if (!global || projects.length !== 1 || !selected || selected.runner !== expectedRunner || selected.testResultsProcessor) {
    throw Error('Observe one supported Jest project using the default runner without a custom results processor');
  }
  const unsafe = testSelectors(global);
  if (global.testFailureExitCode === 0) unsafe.push('testFailureExitCode');
  const inventory = strings(await jsonOutput(root,entry,['--ci','--runInBand','--watchman=false','--json','--listTests',...args]));
  if (!inventory) throw Error('Jest did not return a valid test inventory');
  return {unsafe,files:readFileNames(root,inventory)};
}

async function observeTests(root: string, policy: QualityPolicy, files: string[], args: string[], configRef?: string): Promise<Check> {
  const nativeRef = `.behavproof/input/${policy.runner}.json`;
  const cfg = await config(root,configRef);
  if (cfg.reports[policy.runner] !== undefined && cfg.reports[policy.runner] !== nativeRef) {
    return prevented(fail('The isolated test run requires the fixed native report path ' + nativeRef));
  }
  const selected = configArg(args,['--config','-c']);
  const runnerConfig = selected?.replace(/^\.\//,'');
  const runnerPath = runnerConfig ? await localPath(root,runnerConfig) : undefined;
  const inventory = await testInventory(root,policy.runner,runnerPath);
  const unique = new Set(inventory.files);
  if (inventory.unsafe.length) return prevented(fail('Unsafe effective test settings: ' + describe(inventory.unsafe)));
  if (unique.size !== inventory.files.length) return prevented(unknown('The selected runner reported duplicate test files'));
  if (!unique.size) return prevented(fail('The selected runner discovered no tests'));
  const omitted = files.filter(path => defaultTest(path) && !unique.has(path));
  if (omitted.length) return prevented(fail('Conventional test files were excluded: ' + describe(omitted)));
  const projectFiles = new Set(files);
  const external = inventory.files.filter(path => !projectFiles.has(path));
  if (external.length) return prevented(fail('Selected test files are outside the project inventory: ' + describe(external)));
  for (const file of inventory.files) {
    const focus = focusLines(file,await sourceText(root,file),policy.runner);
    if (focus.length) return prevented(fail('Focused, skipped, pending or conditional tests: ' + describe(focus.map(line => `${file}:${line}`))));
  }
  const settings = pass(`Observed ${inventory.files.length} files in the selected ${policy.runner} configuration`);
  try {
    const code = await runTests(root,configRef,policy.runner,{...(runnerConfig ? {runnerConfig} : {}),coverage:args.includes('--coverage'),qualityRun:true});
    if (code) return {settings,execution:fail(`${policy.runner} exited with code ${code}`)};
    const native = await safeReadJson(root,nativeRef,reportLimit);
    const contracts = object(await safeReadJson(root,'.behavproof/input/contracts.json',reportLimit));
    const receipt = object(contracts?.inventory);
    const reportFiles = strings(receipt?.files);
    if (contracts?.schemaVersion !== 1 || !receipt || !reportFiles || !Number.isSafeInteger(receipt.suiteCount) || !Number.isSafeInteger(receipt.testCount)) {
      return {settings,execution:unknown('The runner did not produce a valid BehavProof test inventory')};
    }
    const checked = readFileNames(root,reportFiles);
    const same = checked.length === unique.size && new Set(checked).size === unique.size && checked.every(file => unique.has(file));
    if (!same) return {settings,execution:fail('The executed test inventory differs from the discovered test files')};
    const proof = {files:reportFiles,suiteCount:Number(receipt.suiteCount),testCount:Number(receipt.testCount)};
    const normalized = policy.runner === 'vitest' ? normalizeVitest(native,proof) :
      normalizeJest(native,{...proof,complete:receipt.complete === true});
    const execution = normalized.status === 'fail' || normalized.payload.skipped || !normalized.payload.total
      ? fail('The native test report shows failures, pending cases, or zero executed tests')
      : normalized.status === 'pass' ? pass(`${policy.runner} passed ${normalized.payload.passed} tests`)
      : unknown('The native test report does not establish a complete test run');
    return {settings,execution};
  } catch (error) {
    return {settings,execution:unknown(info(error))};
  }
}

/** Candidate tool configuration executes here. Call from the unprivileged worker. */
export async function observeQuality(root: string, policy: QualityPolicy, configRef?: string): Promise<QualityObservation> {
  root = await realpath(root);
  if (configRef) RelativePathSchema.parse(configRef);
  const pkg = object(await safeReadJson(root,'package.json'));
  if (!pkg) throw Error('Invalid package.json');
  const files = (await fileList(root)).filter(path => !path.startsWith('.behavproof/'));
  const sources = qualitySources(files,policy);
  const commands = qualityCommands(pkg,policy);
  const missing = prevented(fail('No production sources match the adopted quality policy'));
  const lint = !sources.length ? missing : await checkCommand(commands.lint,async args => {
    if (policy.lint.tool === 'eslint') return observeEslint(root,sources,policy.lint.rules,args);
    const targets = commandLintTargets(args,'biome');
    const omitted = targets.length ? sources.filter(file => !targets.some(target => target === '.' || file === target || file.startsWith(target + '/'))) : [];
    return omitted.length ? prevented(fail('Outside the Biome command targets: ' + describe(omitted))) : observeBiome(root,sources,policy.lint.rules,args);
  });
  const types = !sources.length ? missing : policy.types === 'strict'
    ? await checkCommand(commands.types,args => observeTypes(root,sources,args))
    : sources.some(file => /\.[cm]?tsx?$/.test(file)) ? prevented(fail('A TypeScript waiver cannot cover TypeScript source files'))
    : prevented(pass('Reviewed JavaScript-only TypeScript exemption: ' + policy.types.notApplicable));
  const tests = await checkCommand(commands.tests,args => observeTests(root,policy,files,args,configRef));
  const settings = [['Lint',lint.settings],['TypeScript',types.settings],['Tests',tests.settings]] as const;
  const failed = settings.filter(([,row]) => row.status === 'fail');
  const unobserved = settings.filter(([,row]) => row.status === 'unknown');
  const messages = (rows: readonly (readonly [string,Finding])[]) => rows.map(([label,row]) => label + ' ' + row.message).join('\n');
  const configuration = failed.length ? fail(messages(failed)) : unobserved.length ? unknown(messages(unobserved)) : pass(messages(settings));
  return {schemaVersion:1,lint:lint.execution,types:types.execution,tests:tests.execution,configuration};
}
