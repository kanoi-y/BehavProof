import {expect, it} from 'vitest';
import {reconcileSpecification, specificationTransitionTarget} from '../../packages/core/src/index.js';

const previous = 'b'.repeat(64);
const revision = 'c'.repeat(64);
const head = 'a'.repeat(40);
const repository = 'acme/order';
const input = {id: 'orders', previous, revision, head, repository};
const approval = specificationTransitionTarget(input);

it('requires an exact independently reviewed transition to replace the approved revision', () => {
  expect(reconcileSpecification(input)).toEqual({status: 'fail', effectiveRevision: previous});
  expect(reconcileSpecification({...input, reviewedRevision: revision, approval}))
    .toEqual({status: 'pass', effectiveRevision: revision});
  for (const change of [
    {reviewedRevision: previous},
    {head: 'd'.repeat(40)},
    {repository: 'acme/another'},
    {previous: 'd'.repeat(64)},
  ]) {
    expect(reconcileSpecification({...input, reviewedRevision: revision, approval, ...change}).status).toBe('fail');
  }
});

it('retains the previous obligation when discovery is unavailable or deletion lacks approval', () => {
  expect(reconcileSpecification({...input, revision: undefined}))
    .toEqual({status: 'unknown', effectiveRevision: previous});
  expect(reconcileSpecification({...input, revision: null}))
    .toEqual({status: 'fail', effectiveRevision: previous});
  const deletion = {...input, revision: null};
  expect(reconcileSpecification({...deletion, reviewedRevision: null, approval: specificationTransitionTarget(deletion)}))
    .toEqual({status: 'pass', effectiveRevision: null});
});

it('requires a first approval and accepts existing unchanged registrations', () => {
  expect(reconcileSpecification({...input, previous: null})).toEqual({status: 'unknown', effectiveRevision: null});
  expect(reconcileSpecification({...input, revision: previous})).toEqual({status: 'pass', effectiveRevision: previous});
});
