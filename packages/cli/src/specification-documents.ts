import {canonicalJson,type Evaluation,type FormalModelConfig} from '@behavproof/core';
import {renderAssuranceMap,type AssuranceMap} from '@behavproof/spec-registry';

const escapeHtml=(value:string)=>value.replace(/[&<>"']/g,char=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
})[char]!);
const escapeMarkdown=(value:string)=>escapeHtml(value.replace(/\s+/g,' ')).replace(/([\\`*_[\]|])/g,'\\$1');

export function renderSpecificationDocuments(models:readonly FormalModelConfig[],evaluations:readonly Evaluation[],assurance?:AssuranceMap){
  const sort=(a:{id:string},b:{id:string})=>a.id.localeCompare(b.id);
  const specifications=[...models].sort(sort).map(model=>({
    id:model.id,source:model.model,module:model.module,invariants:model.invariants,
    witnesses:model.witnesses??[],actions:model.requiredActions,checks:model.checks,
    bounds:{maxSteps:model.maxSteps,maxSamples:model.maxSamples,seed:model.seed},
    ...(model.driver?{driver:model.driver}:{}),...(model.implementation?{implementation:model.implementation}:{}),
  }));
  const rows=evaluations.filter(row=>row.scope.some(part=>['model','requiredSpecification','exception','definition','assurance'].includes(part))).sort(
    (a,b)=>canonicalJson(a.scope).localeCompare(canonicalJson(b.scope))||a.ruleId.localeCompare(b.ruleId));
  const columns=['Scope','Check','Status','Evidence'];
  const cells=rows.map(row=>[row.scope.join(' / '),row.ruleId,row.status,row.evidenceIds.join(', ')]);
  const text=(model:typeof specifications[number])=>[
    `${model.id} (${model.source} / ${model.module})`,
    `Invariants: ${model.invariants.join(', ')||'—'}`,
    `Witnesses: ${model.witnesses.join(', ')||'—'}`,
    `Actions: ${model.actions.join(', ')||'—'}`,
    `Bounds: ${model.bounds.maxSteps} steps, ${model.bounds.maxSamples} samples, seed ${model.bounds.seed}`,
    ...(model.driver?[`Driver: ${model.driver}`]:[]),...(model.implementation?[`Implementation: ${model.implementation}`]:[]),
  ];
  const table=[columns,columns.map(()=> '---'),...cells].map(row=>`| ${row.map(escapeMarkdown).join(' | ')} |`).join('\n');
  const markdown=['# Behavior specifications',...specifications.map(model=>{
    const [heading,...details]=text(model);
    return `## ${escapeMarkdown(heading!)}\n\n${details.map(line=>`- ${escapeMarkdown(line)}`).join('\n')}`;
  }),`## Evidence\n\n${table}`].join('\n\n')+'\n';
  const tableHtml=`<table><thead><tr>${columns.map(value=>`<th scope="col">${value}</th>`).join('')}</tr></thead><tbody>${cells.map(row=>`<tr>${row.map(value=>`<td>${escapeHtml(value)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const html=`<!doctype html>\n<html lang="en"><meta charset="utf-8"><title>Behavior specifications</title><body><h1>Behavior specifications</h1>${specifications.map(model=>{
    const [heading,...details]=text(model);
    return `<section><h2>${escapeHtml(heading!)}</h2><ul>${details.map(line=>`<li>${escapeHtml(line)}</li>`).join('')}</ul></section>`;
  }).join('')}<h2>Evidence</h2>${tableHtml}</body></html>\n`;
  const rendered=assurance?renderAssuranceMap(assurance):undefined;
  return {markdown:markdown+(rendered?'\n'+rendered.markdown:''),
    html:rendered?html.replace('</body>',()=>rendered.html+'</body>'):html,
    json:canonicalJson({schemaVersion:2,specifications,evaluations:rows,...(assurance?{assurance}:{})})+'\n'};
}
