import { test, expect } from "vitest";
import { hash, ContractSchema, type Contract } from "@behavproof/core";
import {withTargetCalls, type TargetCall} from "./probe.js";
export type ContractDefinition<I = unknown, E = unknown> = {
  id: string;
  kind?: Contract["kind"];
  formal?: Contract["formal"];
  assurance?: Contract["assurance"];
  intent: string;
  risk: "basic" | "standard" | "critical";
  cases: readonly { id: string; input: I; expected: E; negative?: boolean }[];
};
export function defineContract<const T extends ContractDefinition>(
  value: T,
): T {
  if (
    !value.id ||
    !value.intent ||
    !value.cases.length ||
    new Set(value.cases.map((c) => c.id)).size !== value.cases.length
  )
    throw Error("Invalid contract or duplicate case IDs");
  // Reject non-JSON values before nested schema validation; never load referenced code.
  hash(value);
  ContractSchema.parse({
    id: value.id,
    kind: value.kind ?? "examples",
    intentIds: [`${value.id}:intent`],
    revisionHash: revisionHash(value),
    sourceRef: "runtime",
    risk: value.risk,
    cases: value.cases,
    caseIds: value.cases.map(c => c.id),
    ...(value.formal !== undefined ? {formal:value.formal} : {}),
    ...(value.assurance !== undefined ? {assurance:value.assurance} : {}),
  });
  return value;
}
function revisionHash(value: ContractDefinition): string {
  return hash({
    id: value.id,
    intent: value.intent,
    risk: value.risk,
    cases: value.cases,
    ...(value.kind !== undefined ? {kind:value.kind} : {}),
    ...(value.formal !== undefined ? {formal:value.formal} : {}),
    ...(value.assurance !== undefined ? {assurance:value.assurance} : {}),
  });
}
type CaseOf<T extends ContractDefinition> = T["cases"][number];
export const contractTest = {
  each<T extends ContractDefinition>(
    contract: T,
    callback: (entry: CaseOf<T>) => unknown,
  ): void {
    const captured = structuredClone(contract);
    defineContract(captured);
    const capturedRevisionHash = revisionHash(captured);
    const bindingHash = hash({
      scope: "runtime-function-string-v1",
      function: callback.toString(),
    });
    for (const entry of captured.cases) {
      const identity = {
        contractId: contract.id,
        caseId: entry.id,
        revisionHash: capturedRevisionHash,
        bindingHash,
        bindingScope: "runtime-function-string-v1",
        comparisonCount: 0,
        targetCalls: [] as TargetCall[],
        status: "unknown",
      };
      test(
        `${contract.id}: ${entry.id}`,
        { meta: { behavproof: identity } as {} },
        async ({ task }) => {
          const meta = (
            task.meta as typeof task.meta & { behavproof: typeof identity }
          ).behavproof;
          const actual = await withTargetCalls(()=>callback(structuredClone(entry) as CaseOf<T>),calls=>{meta.targetCalls=calls;});
          meta.comparisonCount++;
          try {
            expect(actual).toEqual(entry.expected);
            meta.status = "pass";
          } catch (error) {
            meta.status = "fail";
            throw error;
          }
        },
      );
    }
  },
};
