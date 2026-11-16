import {
  canonicalJson,
  hash,
  ApprovalSchema,
  type Contract,
  type Intent,
  type RegistrySnapshot,
  type Approval,
} from "@behavproof/core";
export type Change = {
  type: string;
  contractId?: string;
  intentId?: string;
  caseId?: string;
  conditionId?: string;
  checkId?: string;
  faultId?: string;
  before?: unknown;
  after?: unknown;
  transitionHash: string;
};
/** Structural changes expose complete scopes; arbitrary predicate implication is undecidable here. */
function assuranceChanges(before: Contract | undefined, after: Contract | undefined, th: string): Change[] {
  const changes: Change[] = [];
  const add = (kind: string, old: unknown, next: unknown, identity: Partial<Pick<Change, "conditionId" | "checkId" | "faultId">> = {}) => {
    if (canonicalJson(old ?? null) === canonicalJson(next ?? null)) return;
    changes.push({
      type: `ASSURANCE_${kind}_${old === undefined ? "ADDED" : next === undefined ? "REMOVED" : "CHANGED"}`,
      contractId: (before ?? after)!.id,
      ...identity,
      before: old ?? null,
      after: next ?? null,
      transitionHash: th,
    });
  };
  const a=before?.assurance, b=after?.assurance;
  add("FEATURE", a?.feature, b?.feature);
  const compare = <T extends {id:string}>(kind:string, old:readonly T[], next:readonly T[], identity:(item:T)=>Partial<Pick<Change,"conditionId"|"checkId"|"faultId">>) => {
    for (const id of [...new Set([...old,...next].map(x=>x.id))].sort()) {
      const prev=old.find(x=>x.id===id), current=next.find(x=>x.id===id);
      add(kind,prev,current,identity((prev ?? current)!));
    }
  };
  compare("CONDITION",a?.conditions ?? [],b?.conditions ?? [],c=>({conditionId:c.id}));
  compare("CHECK",a?.checks ?? [],b?.checks ?? [],c=>({checkId:c.id}));
  const faults=(d:Contract['assurance'])=>d?.conditions.flatMap(c=>c.requiredFaults.map(f=>({...f,conditionId:c.id}))) ?? [];
  compare("FAULT",faults(a),faults(b),f=>({faultId:f.id,checkId:f.checkId,conditionId:f.conditionId}));
  return changes;
}
export function transitionHash(
  before: Contract,
  after: Contract | undefined,
): string {
  return hash({
    contractId: before.id,
    before: before.revisionHash,
    after: after?.revisionHash ?? null,
  });
}
export function intentTransitionHash(
  before: Intent,
  after: Intent | undefined,
  beforeContracts: readonly string[],
  afterContracts: readonly string[],
): string {
  return hash({
    kind: "intent",
    id: before.id,
    before: before.contentHash,
    after: after?.contentHash ?? null,
    beforeContracts: [...beforeContracts].sort(),
    afterContracts: [...afterContracts].sort(),
  });
}
/** verifyApproval is supplied by an independent trust boundary; data in the repository is not authority. */
export function reconcile(
  base: Pick<RegistrySnapshot, "contracts" | "intents">,
  head: Pick<RegistrySnapshot, "contracts" | "intents">,
  approvals: readonly Approval[] = [],
  verifyApproval: (approval: Approval) => boolean = () => false,
) {
  const obligations: Contract[] = [];
  const changes: Change[] = [];
  for (const old of base.contracts) {
    const current = head.contracts.find((c) => c.id === old.id);
    const th = transitionHash(old, current);
    const changed = !current || current.revisionHash !== old.revisionHash;
    const approved =
      changed &&
      approvals.some(
        (a) =>
          ApprovalSchema.safeParse(a).success &&
          a.status === "pass" &&
          a.target.kind === "contract" &&
          a.target.id === old.id &&
          a.target.contentHash === th &&
          verifyApproval(a) === true,
      );
    if (changed) {
      changes.push(...assuranceChanges(old, current, th));
      if (old.kind !== "examples" || (current && current.kind !== "examples"))
        changes.push({
          type: "UNSUPPORTED_SEMANTIC_DIFF",
          contractId: old.id,
          before: old.kind,
          after: current?.kind ?? null,
          transitionHash: th,
        });
      if (!current)
        changes.push({
          type: "CONTRACT_REMOVED",
          contractId: old.id,
          transitionHash: th,
        });
      else {
        for (const c of old.cases ?? []) {
          const next = current.cases?.find((n) => n.id === c.id);
          if (!next)
            changes.push({
              type: "CONTRACT_CASE_REMOVED",
              contractId: old.id,
              caseId: c.id,
              transitionHash: th,
            });
          else if (canonicalJson(c.expected) !== canonicalJson(next.expected))
            changes.push({
              type: "CONTRACT_EXPECTED_CHANGED",
              contractId: old.id,
              caseId: c.id,
              before: c.expected,
              after: next.expected,
              transitionHash: th,
            });
        }
        for (const c of current.cases ?? [])
          if (!old.cases?.some((o) => o.id === c.id))
            changes.push({
              type: "CONTRACT_CASE_ADDED",
              contractId: old.id,
              caseId: c.id,
              transitionHash: th,
            });
        if (old.risk !== current.risk)
          changes.push({
            type: "CONTRACT_RISK_CHANGED",
            contractId: old.id,
            before: old.risk,
            after: current.risk,
            transitionHash: th,
          });
        if (!changes.some((c) => c.contractId === old.id))
          changes.push({
            type: "CONTRACT_CHANGED",
            contractId: old.id,
            transitionHash: th,
          });
      }
    }
    if (!approved) obligations.push(old);
    else if (current) obligations.push(current);
  }
  for (const c of head.contracts)
    if (!base.contracts.some((b) => b.id === c.id)) {
      obligations.push(c);
      changes.push(...assuranceChanges(undefined,c,hash({contractId:c.id,before:null,after:c.revisionHash})));
    }
  const intentObligations: Intent[] = [];
  const retainedContracts = new Set<string>();
  const refs = (contracts: readonly Contract[], id: string) =>
    contracts
      .filter((c) => c.intentIds.includes(id))
      .map((c) => c.id)
      .sort();
  for (const old of base.intents) {
    const current = head.intents.find((i) => i.id === old.id);
    const beforeRefs = refs(base.contracts, old.id),
      afterRefs = refs(head.contracts, old.id);
    const changed =
      !current ||
      current.contentHash !== old.contentHash ||
      canonicalJson(beforeRefs) !== canonicalJson(afterRefs);
    const th = intentTransitionHash(old, current, beforeRefs, afterRefs);
    const approved =
      changed &&
      approvals.some(
        (a) =>
          ApprovalSchema.safeParse(a).success &&
          a.status === "pass" &&
          a.target.kind === "intent" &&
          a.target.id === old.id &&
          a.target.contentHash === th &&
          verifyApproval(a) === true,
      );
    if (changed)
      changes.push({
        type: approved ? "INTENT_CHANGED" : "INTENT_CHANGED_UNAPPROVED",
        intentId: old.id,
        before: { statement: old.statement, contracts: beforeRefs },
        after: current
          ? { statement: current.statement, contracts: afterRefs }
          : null,
        transitionHash: th,
      });
    if (!approved) {
      intentObligations.push(old);
      for (const id of beforeRefs)
        if (!afterRefs.includes(id)) retainedContracts.add(id);
    } else if (current) intentObligations.push(current);
  }
  for (const current of head.intents)
    if (!base.intents.some((i) => i.id === current.id))
      intentObligations.push(current);
  // An intent approval is independently required to remove its executable edges.
  for (const id of retainedContracts) {
    const old = base.contracts.find((c) => c.id === id)!;
    const index = obligations.findIndex((c) => c.id === id);
    if (index === -1) obligations.push(old);
    else obligations[index] = old;
  }
  return { obligations, intentObligations, changes };
}
export type LifecycleAction = "approve" | "supersede" | "revoke";
export function lifecycleTransitionHash(
  kind: "intent" | "contract",
  id: string,
  from: string,
  action: "supersede" | "revoke",
  to: string | null,
): string {
  return hash({ kind, id, from, action, to });
}
export type LifecycleTransition =
  | {
      action: "approve";
      approval: Approval;
    }
  | {
      action: "revoke";
      approval: Approval;
    }
  | {
      action: "supersede";
      toHash: string;
      approval: Approval;
    };
export function lifecycle(
  entity: Intent | Contract,
  transitions: readonly LifecycleTransition[],
  verify: (approval: Approval) => boolean = () => false,
) {
  const kind = "revisionHash" in entity ? "contract" : "intent";
  const contentHash =
    "revisionHash" in entity ? entity.revisionHash : entity.contentHash;
  let state: "proposed" | "approved" | "superseded" | "revoked" = "proposed";
  const history: {
    action: LifecycleAction;
    approvalId: string;
  }[] = [];
  for (const t of transitions) {
    const a = ApprovalSchema.safeParse(t.approval);
    if (
      !a.success ||
      a.data.status !== "pass" ||
      a.data.target.kind !== kind ||
      a.data.target.id !== entity.id ||
      !verify(a.data)
    )
      continue;
    const target =
      t.action === "approve"
        ? contentHash
        : lifecycleTransitionHash(
            kind,
            entity.id,
            contentHash,
            t.action,
            t.action === "supersede" ? t.toHash : null,
          );
    if (a.data.target.contentHash !== target) continue;
    if (t.action === "approve" && state === "proposed") state = "approved";
    else if (
      t.action === "supersede" &&
      state === "approved" &&
      /^[a-f0-9]{64}$/.test(t.toHash)
    )
      state = "superseded";
    else if (t.action === "revoke" && state === "approved") state = "revoked";
    else continue;
    history.push({ action: t.action, approvalId: a.data.id });
  }
  return { state, contentHash, history };
}
