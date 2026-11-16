import {
  canonicalJson,
  type AssuranceCheck,
  type AssuranceCondition,
  type AssuranceDefinition,
  type AssuranceEvaluation,
  type AssuranceStatus,
  type Contract,
} from '@behavproof/core';

/** Authority belongs to the caller's authenticated evaluator membership, never to a declaration. */
export type AssuranceMapResult = {
  contractId: string;
  revisionHash: string;
  evaluation: AssuranceEvaluation;
  evidenceRefs: string[];
};
export type AssuranceMapCheck = {
  checkId: string;
  method: AssuranceCheck['method'];
  scope: AssuranceCheck;
  status: AssuranceStatus;
  comparisons: number;
  implementationCalls: number;
  reasons: string[];
  limits: string[];
};
export type AssuranceMapCondition = {
  conditionId: string;
  kind: AssuranceCondition['kind'];
  statement: string;
  checkIds: string[];
  status: AssuranceStatus;
  reasons: string[];
  faults: (AssuranceCondition['requiredFaults'][number] & {status: AssuranceStatus; reasons: string[]})[];
};
export type AssuranceMap = {
  notice: string;
  limits: string[];
  contracts: {
    key: string;
    contractId: string;
    revisionHash: string;
    sourceRef: string;
    feature: AssuranceDefinition['feature'];
    status: AssuranceStatus;
    reasons: string[];
    evidenceRefs: string[];
    checks: AssuranceMapCheck[];
    conditions: AssuranceMapCondition[];
  }[];
};
const methodLimits: Record<AssuranceCheck['method'], string[]> = {
  example: ['Only declared inputs and observed target comparisons are covered.'],
  effects: ['Only declared resource selectors, operation ledgers, snapshots and completed observation windows are covered; delayed or uninstrumented effects remain outside scope.'],
  property: ['Seeded exploration covers observed valid samples, declared classes and discard bounds; it is not a universal or formal proof.'],
  sequence: ['Bounded sequential traces cover the declared model, projection and observed actions; concurrency and universal state coverage are outside scope.'],
  architecture: ['Static dependency inventory only; every dynamic import and unsupported construct remains unknown. Runtime authorization is outside scope.'],
  journey: ['Only ordered observed steps and declaration-bound real layer receipts in the stated environment are covered. Mocks and screenshots alone cannot establish real layers.'],
};
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const status = (value: unknown): value is AssuranceStatus => ['pass','fail','unknown'].includes(value as string);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(v=>typeof v==='string');
const count = (value: unknown) => Number.isSafeInteger(value) && (value as number)>=0;
const aggregate = (values: AssuranceStatus[]): AssuranceStatus => values.includes('fail')?'fail':values.includes('unknown')?'unknown':'pass';
const inventory = (actual: string[], expected: string[]) => actual.length===expected.length && new Set(actual).size===actual.length && actual.every(id=>expected.includes(id));
/** Defensive shape/scope checks supplement, but cannot replace, independent authentication. */
function validResult(row: AssuranceMapResult, definition: AssuranceDefinition): boolean {
  try {
    canonicalJson(row);
    const e=row.evaluation;
    if (!strings(row.evidenceRefs) || !status(e.status) || !strings(e.reasons) || !Array.isArray(e.checks) || !Array.isArray(e.conditions)) return false;
    if (!inventory(e.checks.map(c=>c.checkId),definition.checks.map(c=>c.id)) || !inventory(e.conditions.map(c=>c.conditionId),definition.conditions.map(c=>c.id))) return false;
    for (const check of definition.checks) {
      const result=e.checks.find(c=>c.checkId===check.id)!;
      if (!status(result.status) || !strings(result.reasons) || !count(result.comparisons) || !count(result.implementationCalls) || result.method!==check.method || !same(result.scope,check)) return false;
    }
    for (const condition of definition.conditions) {
      const result=e.conditions.find(c=>c.conditionId===condition.id)!;
      if (!status(result.status) || !strings(result.reasons) || result.kind!==condition.kind || result.statement!==condition.statement || !same(result.checkIds,condition.checks) || !Array.isArray(result.faults)) return false;
      if (!inventory(result.faults.map(f=>f.faultId),condition.requiredFaults.map(f=>f.id))) return false;
      for (const fault of result.faults) {
        if (!status(fault.status) || !strings(fault.reasons) || fault.checkId!==condition.requiredFaults.find(f=>f.id===fault.faultId)!.checkId) return false;
      }
      if (result.status!==aggregate([...e.checks.filter(c=>condition.checks.includes(c.checkId)).map(c=>c.status),...result.faults.map(f=>f.status)])) return false;
    }
    return e.status===aggregate(e.conditions.map(c=>c.status));
  } catch { return false; }
}

export function buildAssuranceMap(
  contracts: readonly Contract[],
  results: readonly AssuranceMapResult[] = [],
  verifyResult: (row: AssuranceMapResult) => boolean = () => false,
): AssuranceMap {
  const adopted=contracts.filter((c): c is Contract & {assurance:AssuranceDefinition}=>c.assurance!==undefined);
  return {
    notice: 'Assurance declarations and independently verified evaluations. Missing or unverified evidence is unknown.',
    limits: ['Undeclared requirements and unlisted dependencies are outside assurance scope.', 'Result authentication, current source identity and observation integrity must be established by the caller. A declaration or raw report is not proof.'],
    contracts: [...adopted].sort((a,b)=>canonicalJson([a.id,a.revisionHash]).localeCompare(canonicalJson([b.id,b.revisionHash]))).map(c=>{
      const key=canonicalJson([c.id,c.revisionHash]);
      const rows=results.filter(r=>r?.contractId===c.id && r?.revisionHash===c.revisionHash);
      const row=rows[0];
      const unambiguous=adopted.filter(other=>other.id===c.id && other.revisionHash===c.revisionHash).length===1;
      const verified=unambiguous && rows.length===1 && row!==undefined && validResult(row,c.assurance) && verifyResult(row)===true;
      const evaluation=verified?row!.evaluation:undefined;
      const unknown=[!unambiguous || rows.length>1?'Duplicate or ambiguous assurance result/declaration':rows.length===0?'Missing evaluated assurance evidence':'Assurance evaluation is unverified or does not match the declaration'];
      return {
        key,contractId:c.id,revisionHash:c.revisionHash,sourceRef:c.sourceRef,feature:structuredClone(c.assurance.feature),
        status:evaluation?.status ?? 'unknown',reasons:[...(evaluation?.reasons ?? unknown)],evidenceRefs:verified?[...row!.evidenceRefs]:[],
        checks:c.assurance.checks.map(check=>{
          const result=evaluation?.checks.find(r=>r.checkId===check.id);
          return {checkId:check.id,method:check.method,scope:structuredClone(check),status:result?.status ?? 'unknown',comparisons:result?.comparisons ?? 0,implementationCalls:result?.implementationCalls ?? 0,reasons:[...(result?.reasons ?? unknown)],limits:[...methodLimits[check.method]]};
        }),
        conditions:c.assurance.conditions.map(condition=>{
          const result=evaluation?.conditions.find(r=>r.conditionId===condition.id);
          return {conditionId:condition.id,kind:condition.kind,statement:condition.statement,checkIds:[...condition.checks],status:result?.status ?? 'unknown',reasons:[...(result?.reasons ?? unknown)],faults:condition.requiredFaults.map(fault=>{
            const f=result?.faults.find(r=>r.faultId===fault.id);
            return {...structuredClone(fault),status:f?.status ?? 'unknown',reasons:[...(f?.reasons ?? unknown)]};
          })};
        }),
      };
    }),
  };
}

const escapeHtml = (s:string) => s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const escapeMd = (s:string) => escapeHtml(s).replace(/([\\`*_{}\[\]()#+.!|~\-])/g,'\\$1').replaceAll('\r','&#13;').replaceAll('\n','&#10;');
export function renderAssuranceMap(map: AssuranceMap): {markdown:string;html:string;json:string} {
  const lines: {kind:'h2'|'h3'|'p';text:string}[]=[{kind:'h2',text:'Feature assurance map'},{kind:'p',text:map.notice},{kind:'p',text:`Assurance limits: ${map.limits.join(' ')}`}];
  for (const c of map.contracts) {
    lines.push({kind:'h3',text:`${c.feature.id} / ${c.contractId} / revision ${c.revisionHash}: ${c.status}`},{kind:'p',text:`Source: ${c.sourceRef}; key: ${c.key}; entrypoints: ${canonicalJson(c.feature.entrypoints)}`},{kind:'p',text:`Reasons: ${canonicalJson(c.reasons)}; Evidence: ${canonicalJson(c.evidenceRefs)}`});
    for (const condition of c.conditions) {
      lines.push({kind:'p',text:`Condition ${condition.conditionId} (${condition.kind}): ${condition.status}; ${condition.statement}; checks: ${canonicalJson(condition.checkIds)}; reasons: ${canonicalJson(condition.reasons)}`});
      for (const f of condition.faults) lines.push({kind:'p',text:`Required fault ${f.id} (${f.kind}), check ${f.checkId}: ${f.status}; implementation: ${f.implementation}; detects: ${canonicalJson(f.detects)}; reasons: ${canonicalJson(f.reasons)}`});
    }
    for (const check of c.checks) lines.push({kind:'p',text:`Check ${check.checkId} (${check.method}): ${check.status}; comparisons: ${check.comparisons}; implementation calls: ${check.implementationCalls}; scope: ${canonicalJson(check.scope)}; reasons: ${canonicalJson(check.reasons)}; limits: ${check.limits.join(' ')}`});
  }
  return {
    markdown:lines.map(l=>`${l.kind==='h2'?'## ':l.kind==='h3'?'### ':''}${escapeMd(l.text)}`).join('\n\n')+'\n',
    html:lines.map(l=>`<${l.kind}>${escapeHtml(l.text)}</${l.kind}>`).join('')+'\n',
    json:canonicalJson(map)+'\n',
  };
}
