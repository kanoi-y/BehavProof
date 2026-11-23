import {hash} from '@behavproof/core';

export type QuintSelection = {
  module: string;
  init: string;
  step: string;
  invariants: readonly string[];
  witnesses: readonly string[];
  requiredActions: readonly string[];
};

type Definition = {name: string; kind: string; qualifier?: string};
type ModuleInventory = {name: string; definitions: Definition[]};
type Discovery = {modules: ModuleInventory[]; diagnostics: string[]; selected?: QuintSelection};
type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : undefined;
}

function effectComponents(value: JsonObject | undefined) {
  return value?.kind === 'concrete' && Array.isArray(value.components)
    ? value.components.map(component => object(component)?.kind)
    : undefined;
}
export function quintInvariantFingerprint(value:unknown,moduleName:string,property:string):string|undefined{
  const raw=object(value),modules=raw?.modules;
  if(!Array.isArray(modules))return undefined;
  const declarations=object(modules.find(entry=>object(entry)?.name===moduleName))?.declarations;
  if(!Array.isArray(declarations))return undefined;
  const declaration=object(declarations.find(entry=>object(entry)?.name===property));
  if(declaration?.expr===undefined)return undefined;
  const bindings=object(raw?.table);
  const active=new Set<number>(),fingerprints=new Map<number,string>();
  let available=true;
  const detachIds=(node:unknown):unknown=>{
    if(Array.isArray(node))return node.map(detachIds);
    const row=object(node);
    if(!row)return node;
    const expression=Object.fromEntries(Object.entries(row).filter(([key])=>key!=='id')
      .map(([key,item])=>[key,detachIds(item)]));
    if((row.kind!=='name'&&row.kind!=='app')||typeof row.id!=='number')return expression;
    const binding=object(bindings?.[row.id]);
    if(!binding)return expression;
    if(object(binding.importedFrom)?.kind==='instance'){
      available=false;
      return expression;
    }
    if(binding.kind!=='def')return {...expression,binding:{kind:binding.kind??null,name:binding.name??null,
      type:detachIds(binding.typeAnnotation??null),namespaces:binding.namespaces??[]}};
    const id=binding.id;
    if(typeof id!=='number'||active.has(id)||binding.expr===undefined){
      available=false;
      return expression;
    }
    let digest=fingerprints.get(id);
    if(!digest){
      active.add(id);
      digest=hash({qualifier:binding.qualifier??null,expr:detachIds(binding.expr)});
      active.delete(id);
      fingerprints.set(id,digest);
    }
    return {...expression,binding:digest};
  };
  const expression=detachIds(declaration.expr);
  return available?hash(expression):undefined;
}

export function discoverQuintDefinitions(value: unknown, selection?: QuintSelection): Discovery {
  const modules: ModuleInventory[] = [];
  const diagnostics: string[] = [];
  const raw = object(value);
  const types = object(raw?.types);
  const effects = object(raw?.effects);
  if (raw?.stage !== 'typechecking' || !types || !effects || !Array.isArray(raw.modules) ||
      !raw.modules.length || raw.errors !== undefined && (!Array.isArray(raw.errors) || raw.errors.length)) {
    return {modules, diagnostics: ['Quint did not produce a complete typecheck result']};
  }

  const definitions = new Map<string, JsonObject[]>();
  for (const entry of raw.modules) {
    const module = object(entry);
    if (typeof module?.name !== 'string' || !Array.isArray(module.declarations) || definitions.has(module.name)) {
      return {modules, diagnostics: ['Invalid or ambiguous Quint module inventory']};
    }
    const inventory: Definition[] = [];
    const declared: JsonObject[] = [];
    for (const declaration of module.declarations) {
      const row = object(declaration);
      if (!row || typeof row.kind !== 'string') {
        return {modules, diagnostics: ['Invalid Quint declaration inventory']};
      }
      if (typeof row.name !== 'string') continue;
      inventory.push({name: row.name, kind: row.kind,
        ...(typeof row.qualifier === 'string' ? {qualifier: row.qualifier} : {})});
      declared.push(row);
    }
    modules.push({name: module.name, definitions: inventory});
    definitions.set(module.name, declared);
  }

  if (!selection) return {modules, diagnostics};
  const model = definitions.get(selection.module);
  if (!model) return {modules, diagnostics: [`Quint module not found: ${selection.module}`]};
  const roles = [
    ['init', [selection.init]], ['step', [selection.step]], ['action', selection.requiredActions],
    ['invariant', selection.invariants], ['witness', selection.witnesses],
  ] as const;
  for (const [role, names] of roles) {
    for (const name of names) {
      const matches = model.filter(definition => definition.name === name);
      const [definition] = matches;
      if (matches.length !== 1 || typeof definition?.id !== 'number' || !Number.isSafeInteger(definition.id)) {
        diagnostics.push(`${role} ${selection.module}::${name} is missing or ambiguous`);
        continue;
      }
      const type = object(object(types[String(definition.id)])?.type);
      const effect = object(object(effects[String(definition.id)])?.effect);
      const parameterized = role === 'action' && type?.kind === 'oper' && effect?.kind === 'arrow';
      const resultType = parameterized ? object(type.res) : type;
      const components = effectComponents(parameterized ? object(effect.result) : effect);
      const action = role === 'init' || role === 'step' || role === 'action';
      const suitable = action
        ? definition.qualifier === 'action' && components?.includes('update')
        : ['val', 'pureval', 'def', 'puredef'].includes(String(definition.qualifier)) &&
          components?.every(component => component === 'read');
      if (definition.kind !== 'def' || resultType?.kind !== 'bool' || !suitable) {
        diagnostics.push(`${role} ${selection.module}::${name} has an incompatible type or effect`);
      }
    }
  }
  return {modules, diagnostics, ...(diagnostics.length ? {} : {selected: selection})};
}
