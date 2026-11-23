import {z} from 'zod';
import {hash} from './serialization.js';
import type {Approval} from './schemas.js';

export const SpecificationRegistrySchema = z.array(z.strictObject({
  id: z.string().min(1),
  revisionHash: z.string().regex(/^[a-f0-9]{64}$/),
})).max(100).refine(rows => new Set(rows.map(row => row.id)).size === rows.length,
  'Duplicate registered specification IDs');
export type SpecificationRegistry = z.infer<typeof SpecificationRegistrySchema>;

type Revision = string | null;
export type SpecificationReviewDomain = 'scopedException' | 'requiredSpecification';
type Transition = {id: string; previous: Revision; revision: Revision; head: string; repository: string;
  domain?: SpecificationReviewDomain};

export function specificationTransitionTarget(transition: Transition): Approval['target'] {
  const {id, previous, revision, head, repository,domain} = transition;
  const kind = previous === null ? 'add' : revision === null ? 'delete' : 'update';
  return {id, kind: domain==='scopedException'?'exception':'specification', contentHash: hash({
    schemaVersion: 1, id, previous, revision, kind, head, repository,...(domain?{domain}:{}),
  })};
}

export function reconcileSpecification(options: Omit<Transition, 'revision'> & {
  revision: Revision | undefined;
  reviewedRevision?: Revision;
  approval?: Approval['target'];
}) {
  const {previous, revision, reviewedRevision, approval} = options;
  if (revision === undefined) return {status: 'unknown' as const, effectiveRevision: previous};
  if (revision === previous && previous !== null) return {status: 'pass' as const, effectiveRevision: previous};
  if (reviewedRevision === revision && approval &&
      hash(approval) === hash(specificationTransitionTarget({...options, revision}))) {
    return {status: 'pass' as const, effectiveRevision: revision};
  }
  return {status: previous === null ? 'unknown' as const : 'fail' as const, effectiveRevision: previous};
}
