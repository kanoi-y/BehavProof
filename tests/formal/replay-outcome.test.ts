import { expect, it } from 'vitest';
import { evaluateModelConformance, FormalModelConfigSchema, hash } from '../../packages/core/src/index.js';
import { readITF, replayTraces, type Implementation, type ReplayDriver } from '../../packages/adapter-model-test/src/index.js';

const digest = 'a'.repeat(64);
const faultHash = 'b'.repeat(64);
const model = FormalModelConfigSchema.parse({
  id: 'orders', module: 'order', model: 'order.qnt',
  quint: { entry: 'quint.js', version: '0.33.1' }, invariants: ['safe'], checks: ['parse', 'typecheck', 'run'],
  maxSteps: 8, seed: '42', report: 'model.json', requiredActions: ['TryShipUnpaid', 'Ship'],
  minComparisons: 4, requireCanary: false,
  replayScope: {observedFields: ['paid', 'shipped'], rationale: 'The full input sequence determines the order state.'},
});

const rawTrace = (rejection: unknown = 'rejected') => ({
  vars: ['paid', 'shipped', 'replayOutcome', 'mbt::actionTaken', 'mbt::nondetPicks'],
  states: [
    { paid: false, shipped: false, action: 'init', outcome: 'allowed' },
    { paid: false, shipped: false, action: 'TryShipUnpaid', outcome: rejection },
    { paid: true, shipped: false, action: 'Pay', outcome: 'allowed' },
    { paid: true, shipped: true, action: 'Ship', outcome: 'allowed' },
  ].map(({ paid, shipped, action, outcome }, index) => ({
    '#meta': { index }, paid, shipped, replayOutcome: outcome,
    'mbt::actionTaken': action, 'mbt::nondetPicks': {},
  })),
});
const trace = () => readITF(rawTrace(), { id: 'ship' });
const identity = () => ({
  modelHash: digest, configHash: digest, commandHash: digest, driverHash: digest,
  implementationHash: digest, traceHash: hash([trace()]),
});

type State = { paid: boolean; shipped: boolean };
class UnpaidOrder extends Error {}
const implementation = {
  initialize: (): State => ({ paid: false, shipped: false }),
  pay: (state: State) => ({ ...state, paid: true }),
  async ship(state: State) {
    if (!state.paid) throw new UnpaidOrder();
    return { ...state, shipped: true };
  },
};
function createDriver(exports: Implementation): ReplayDriver {
  const api = exports as typeof implementation;
  let state: State;
  return {
    async dispatch(action) {
      if (action === 'init') state = api.initialize();
      else if (action === 'Pay') state = api.pay(state);
      else {
        try {
          state = await api.ship(state);
        } catch (error) {
          if (error instanceof UnpaidOrder) return 'rejected';
          throw error;
        }
      }
      return 'allowed';
    },
    observe: () => state,
  };
}
const replay = (overrides: Partial<Parameters<typeof replayTraces>[0]> = {}) => replayTraces({
  modelId: model.id, identity: identity(), traces: [trace()], implementation, createDriver, ...overrides,
});
const evaluate = (report: unknown) => evaluateModelConformance(report, { model, identity: identity(), authenticated: true });
const erroneouslyAccepted = {
  ...implementation,
  async ship(state: State) {
    return state.paid ? implementation.ship(state) : state;
  },
};

it('extracts explicit outcomes from ITF and binds them to the trace identity', () => {
  expect(trace().steps[1]).toMatchObject({ expected: { paid: false, shipped: false }, expectedOutcome: 'rejected' });
  expect(trace().steps[1]?.expected).not.toHaveProperty('replayOutcome');
  expect(hash(trace())).not.toBe(hash(readITF(rawTrace('allowed'), { id: 'ship' })));
  expect(() => readITF(rawTrace('unexpected'))).toThrow(/outcome/i);
});

it('observes rejection and allowance through the same asynchronous implementation entry', async () => {
  const report = await replay();
  expect(report.traces[0]?.steps[1]).toMatchObject({
    expectedOutcome: 'rejected', actualOutcome: 'rejected', implementationCalls: 1, status: 'pass',
  });
  expect(report.traces[0]?.steps[3]).toMatchObject({
    expectedOutcome: 'allowed', actualOutcome: 'allowed', implementationCalls: 1, status: 'pass',
  });
  expect(evaluate(report).status).toBe('pass');
});

it('fails erroneous allowance even if the protected state stays unchanged', async () => {
  const report = await replay({ implementation: erroneouslyAccepted });
  expect(report.traces[0]?.steps[1]).toMatchObject({ actualOutcome: 'allowed', status: 'fail' });
  expect(evaluate(report).status).toBe('fail');
});

it('fails a declared rejection that mutates protected state', async () => {
  const report = await replay({
    implementation: {
      ...implementation,
      async ship(state: State) {
        if (!state.paid) {
          state.shipped = true;
          throw new UnpaidOrder();
        }
        return implementation.ship(state);
      },
    },
  });
  expect(report.traces[0]?.steps[1]).toMatchObject({ actualOutcome: 'rejected', actual: { shipped: true }, status: 'fail' });
  expect(evaluate(report).status).toBe('fail');
});

it('keeps a reported rejection unknown if only the observer calls the implementation', async () => {
  const report = await replay({
    createDriver(exports) {
      const driver = createDriver(exports);
      return {
        ...driver,
        dispatch: (action, parameters) => action === 'TryShipUnpaid' ? 'rejected' : driver.dispatch(action, parameters),
        observe() {
          (exports.initialize as typeof implementation.initialize)();
          return driver.observe!();
        },
      };
    },
  });
  expect(report.traces[0]?.steps[1]).toMatchObject({ implementationCalls: 0, status: 'unknown' });
  expect(evaluate(report).status).toBe('unknown');
});

it('keeps an unexpected implementation exception unknown even after observing a call', async () => {
  const report = await replay({
    implementation: {
      ...implementation,
      async ship(state: State) {
        if (!state.paid) throw new Error('unexpected implementation error');
        return implementation.ship(state);
      },
    },
  });
  expect(report.traces[0]?.steps[1]).toMatchObject({ implementationCalls: 1, comparisonCount: 0, status: 'unknown' });
  expect(evaluate(report).status).toBe('unknown');
});

it('keeps an explicit rejection unknown when protected state cannot be observed', async () => {
  const report = await replay({
    createDriver(exports) {
      const driver = createDriver(exports);
      let action: string;
      return {
        dispatch(name, parameters) {
          action = name;
          return driver.dispatch(name, parameters);
        },
        observe() {
          if (action === 'TryShipUnpaid') throw new Error('state unavailable');
          return driver.observe!();
        },
      };
    },
  });
  expect(report.traces[0]?.steps[1]).toMatchObject({ implementationCalls: 1, comparisonCount: 0, status: 'unknown' });
  expect(evaluate(report).status).toBe('unknown');
});

it('keeps an explicit rejection unknown when the snapshot omits a required observation', async () => {
  const report = await replay({
    createDriver(exports) {
      const driver = createDriver(exports);
      let action: string;
      return {
        dispatch(name, parameters) {
          action = name;
          return driver.dispatch(name, parameters);
        },
        observe() {
          if (action === 'TryShipUnpaid') return { paid: false };
          return driver.observe!();
        },
      };
    },
  });
  expect(report.traces[0]?.steps[1]).toMatchObject({ comparisonCount: 0, status: 'unknown' });
  expect(evaluate(report).status).toBe('unknown');
});

it('keeps a report unknown if its observed outcome has been removed', async () => {
  const report = await replay();
  delete report.traces[0]!.steps[1]!.actualOutcome;
  expect(evaluate(report).status).toBe('unknown');
});

it('credits a canary that detects erroneous allowance with identical protected states', async () => {
  const report = await replay({
    canary: { faultId: 'erroneous-allowance', implementationHash: faultHash, implementation: erroneouslyAccepted },
  });
  expect(report.canary).toMatchObject({
    detectedMismatches: 1,
    failure: { expectedOutcome: 'rejected', actualOutcome: 'allowed', expected: { shipped: false }, actual: { shipped: false } },
  });
  expect(evaluateModelConformance(report, {
    model: { ...model, requireCanary: true }, identity: identity(), authenticated: true, canaryImplementationHash: faultHash,
  }).status).toBe('pass');
});

it('requires a reviewed observation scope before a native model can establish conformance',async()=>{
  const {replayScope:_scope,...native}=model;
  const report=await replay();
  const withScope={...native,replayScope:{observedFields:['paid','shipped'],
    rationale:'All state changes are determined by the complete operation sequence.'}};
  expect(evaluateModelConformance(report,{model:native,identity:identity(),authenticated:true}).status).toBe('unknown');
  expect(evaluateModelConformance(report,{model:withScope,identity:identity(),authenticated:true}).status).toBe('pass');
  expect(evaluateModelConformance(report,{model:{...withScope,replayScope:{
    ...withScope.replayScope, observedFields:['paid'],
  }},identity:identity(),authenticated:true}).status).toBe('unknown');
});

it('does not claim deterministic conformance when one input prefix permits different observed outcomes',async()=>{
  const first=trace(), second={...trace(),id:'other'};
  second.steps[1]!.expectedOutcome='allowed';
  const inputs=[first,second], current={...identity(),traceHash:hash(inputs)};
  const report=await replay({identity:current,traces:inputs});
  const result=evaluateModelConformance(report,{model,identity:current,authenticated:true});
  expect(result.status).toBe('unknown');
  expect(result.reasons).toContain('The same input sequence has different expected observations');
});
