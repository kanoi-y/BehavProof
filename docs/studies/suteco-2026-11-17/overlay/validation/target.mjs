import {spawnSync} from 'node:child_process';
import {mkdtemp, readFile, writeFile, mkdir, copyFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';

// Each receipt invokes a fresh, opt-in Jest scenario against original suteco
// modules. Native adapters remain suteco's existing test environment.
export async function observe(input) {
  const root = process.cwd();
  const settings = JSON.parse(await readFile(join(root, 'validation/toolchain.json'), 'utf8'));
  const selected = settings.scenarios.find(s => s.id === input.id);
  if (!selected) throw Error('Scenario outside the reviewed study inventory');
  const base = join(root, '.behavproof/study-calls');
  await mkdir(base, {recursive: true});
  const call = await mkdtemp(join(base, `${selected.id}-`));
  const rawPath = join(call, 'observation.json');
  const jestPath = join(call, 'jest.json');
  const result = spawnSync(settings.node20, [
    join(root, 'node_modules/jest/bin/jest.js'), '--runInBand',
    '--testMatch', '**/validation/repros/*.spec.ts', '--runTestsByPath', selected.file,
    '--testNamePattern', `(?:^|\\s)${selected.id}:`, '--json', '--outputFile', jestPath,
  ], {
    cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024,
    env: {...process.env, BEHAVPROOF_STUDY_OBSERVATIONS: rawPath},
  });
  await writeFile(join(call, 'execution.log'), result.stdout + result.stderr);
  if (result.error || ![0, 1].includes(result.status)) throw Error(`Scenario process incomplete: ${result.error ?? result.status}`);
  const jest = JSON.parse(await readFile(jestPath, 'utf8'));
  const assertions = jest.testResults.flatMap(t => t.assertionResults).filter(t => ['passed', 'failed'].includes(t.status));
  if (assertions.length !== 1 || !assertions[0].fullName.includes(`${selected.id}:`)) throw Error('Expected exactly one selected scenario execution');
  const encoded = JSON.parse(await readFile(rawPath, 'utf8'));
  const actual = encoded.caseId === selected.id ? encoded.actual : encoded[selected.id];
  if (!actual || typeof actual !== 'object') throw Error('No fresh raw observation for the selected scenario');
  // Preserve actual states and child reports as separately captured diagnostics.
  const captured = process.env.BEHAVPROOF_OUTPUT_DIR;
  if (captured) {
    for (const [name, source] of [['observation.json', rawPath], ['jest.json', jestPath], ['execution.log', join(call, 'execution.log')]]) {
      await copyFile(source, resolve(captured, `${selected.id}.${name}`));
    }
  }
  switch (selected.id) {
    case 'dataset-cross-municipality':
      return {schemaAccepted: actual.schemaAccepted, importRejected: actual.import.rejected, foreignRule: {
        municipalityId: actual.ruleAfter.municipalityId, itemId: actual.ruleAfter.itemId,
        categoryName: actual.ruleAfter.categoryName, instructions: actual.ruleAfter.instructions,
      }};
    case 'dataset-valid':
      return {schemaAccepted: actual.schemaAccepted, importRejected: actual.import.rejected,
        counts: Object.fromEntries(Object.entries(actual.state).map(([key, rows]) => [key, rows.length])),
        storedItemId: actual.storedRule.itemId};
    case 'dataset-dangling-item':
      return {schemaAccepted: actual.schemaAccepted, importRejected: actual.import.rejected,
        unchanged: JSON.stringify(actual.before) === JSON.stringify(actual.after)};
    case 'startup-version-only':
    case 'startup-content-change-control':
      return {database: actual.storedMunicipality.version, store: actual.store.datasetVersion,
        persistence: actual.persistedState.datasetVersion, display: actual.displayedVersion};
    case 'unsafe-official-link':
      return {openedUris: actual.openedUris};
    case 'safe-official-link':
      return {schemaAccepted: actual.schemaAccepted, importAccepted: actual.importAccepted,
        renderedOfficialUrl: actual.renderedOfficialUrl, openedUris: actual.openedUris};
    case 'municipality-event-turn-control':
      return {events: actual.events, selectedMunicipalityId: actual.finalState.selectedMunicipalityId};
    default: throw Error('No reviewed observation projection');
  }
}
