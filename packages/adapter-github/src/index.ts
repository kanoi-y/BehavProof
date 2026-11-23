import { parseDocument } from 'yaml';

export * from './authority.js';
export * from './pipeline.js';
export { GitHubTransport, object as githubObject } from './transport.js';
export type { Fetcher, GitHubOptions, Observation } from './transport.js';
export { verifyArtifactArchive, readArtifactArchive } from './archive.js';
export {prepareCheckPublication, prepareFailedCheck, GitHubCheckPublisher, registryGateReceipt} from './publisher.js';
export type {PublicationPacket, PublicationExpectation, PreparedCheck, PublicationIdentity} from './publisher.js';

/** Read workflow YAML as data, with duplicate keys, custom tags, and aliases disabled. */
export function parseGitHubWorkflow(source: string): unknown {
  if (Buffer.byteLength(source) > 1024 * 1024) throw Error('Workflow exceeds size limit');
  const document = parseDocument(source, { uniqueKeys: true, version: '1.2' });
  if (document.errors.length || document.warnings.length) throw Error('Invalid or duplicate workflow YAML');
  return document.toJS({ maxAliasCount: 0 });
}
