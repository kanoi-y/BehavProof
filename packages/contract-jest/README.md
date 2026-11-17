# @behavproof/jest

Native contract comparisons for Jest 29.7.0 and 30.5.2 on Node 24.

```js
const {defineContract, contractTest} = require('@behavproof/jest');
const {add} = require('./add.cjs');

const addition = defineContract({
  id: 'addition',
  intent: 'Add one',
  risk: 'standard',
  cases: [{id: 'one', input: 1, expected: 2}],
});
contractTest.each(addition, ({input}) => add(input));
```

The callback receives a cloned case. Each selected callback result is compared once with the captured expected value using Jest's `toEqual`. The contract revision includes optional `kind`, `formal`, and `assurance` fields. Callback bindings use `runtime-function-string-v1`.

Configure the native Circus adapter and reporter:

```js
// jest.config.cjs
module.exports = {
  testRunner: require.resolve('@behavproof/jest/runner'),
  reporters: ['default', require.resolve('@behavproof/jest/reporter')],
};
```

Set `BEHAVPROOF_REPORT` to an output file whose parent directory already exists. The adapter preserves Jest's selected environment, including presets, environment options, and per-file `@jest-environment` overrides. It resolves Jest from the consumer project, then loads the matching Circus from that Jest package's own dependency tree. Custom test frameworks and Jasmine require a different adapter and cannot produce complete evidence here.

The reporter writes schema version 1 with runner kind/version, a complete all-test inventory with one suite per native test file, immutable zero/unknown registrations, and final comparison rows. Native assertion state and callback comparison state are separate: a hook failure cannot turn a successful comparison into a mismatch. Missing receipts, empty/error suites, environment failure, interruption, duplicate full test names, or retries produce incomplete evidence; duplicate/retried comparison rows remain unknown.

Target instrumentation can call `observeTargetCall` from `@behavproof/jest/probe`. Observations are local to each callback's asynchronous context. Returning a canned expected value does not record target calls. Module resets or isolated module registries can split probe instances and therefore yield no observations. These receipts describe producer observations; arbitrary test code is not isolated from the producer.

Native ESM tests may import the same package exports. Run Jest with `NODE_OPTIONS=--experimental-vm-modules` and the project's normal ESM configuration. Configured TypeScript transforms are preserved. Both paths are covered against both supported Jest versions.
