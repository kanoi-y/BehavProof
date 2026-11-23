import ts from 'typescript-parser';
import {posix} from 'node:path';
import {isBuiltin} from 'node:module';
import {hash,hashBytes,type AssuranceArchitectureCheck,type AssuranceArchitectureObservation} from '@behavproof/core';

/** Static import observations, not an execution or arbitrary dependency-closure proof. */
export function inspectArchitecture(check:AssuranceArchitectureCheck,sources:Readonly<Record<string,Uint8Array>>,substitution?:{source:Uint8Array}):AssuranceArchitectureObservation{
 const unsupported:AssuranceArchitectureObservation['unsupported']=[],files:AssuranceArchitectureObservation['files']=[];
 const aliasConfig=Object.entries(sources).some(([name,bytes])=>/tsconfig[^/]*\.json$/.test(name)&&/"(?:paths|extends|baseUrl)"\s*:/.test(new TextDecoder().decode(bytes)));
 for(const path of check.files){
  const bytes=path===check.targetRef&&substitution?substitution.source:sources[path];
  if(!bytes){unsupported.push({file:path,reason:'Selected source missing'});continue;}
  const source=new TextDecoder('utf-8',{fatal:true}).decode(bytes),ast=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true);
  if((ast as ts.SourceFile&{parseDiagnostics?:unknown[]}).parseDiagnostics?.length)unsupported.push({file:path,reason:'Incomplete source parse'});
  const imports:AssuranceArchitectureObservation['files'][number]['imports']=[];
  const add=(specifier:string,dynamic=false,literal=true)=>{
   let resolved:string|undefined,supported=literal&&!dynamic;
   if(specifier.startsWith('.')){
    const base=posix.normalize(posix.join(posix.dirname(path),specifier));
    resolved=[base,`${base}.ts`,`${base}.js`,`${base}.mjs`,`${base}/index.ts`,`${base}/index.js`,base.replace(/\.[cm]?js$/,'.ts')].find(p=>Object.hasOwn(sources,p));
    if(!resolved||base.startsWith('../'))supported=false;
   }else if(isBuiltin(specifier)&&isBuiltin(specifier.replace(/^node:/,'')))resolved=specifier.startsWith('node:')?specifier.slice(5):`node:${specifier}`;
   else if(specifier.startsWith('#')||specifier.startsWith('~/')||specifier.startsWith('@/')||aliasConfig&&!specifier.startsWith('node:'))supported=false;
   imports.push({specifier,...(resolved?{resolved}:{}),dynamic,supported});
   if(!supported)unsupported.push({file:path,reason:`Unresolved, aliased or dynamic dependency: ${specifier}`});
  };
  const unparen=(expression:ts.Expression):ts.Expression=>ts.isParenthesizedExpression(expression)?unparen(expression.expression):expression;
  const moduleLoad=(expression:ts.Expression)=>{
   const value=unparen(expression),argument=ts.isCallExpression(value)?value.arguments[0]:undefined;
   return ts.isCallExpression(value)&&ts.isIdentifier(value.expression)&&value.expression.text==='require'&&value.arguments.length===1&&!!argument&&ts.isStringLiteral(argument)&&['module','node:module'].includes(argument.text);
  };
  const requireFactories=new Set<string>(),moduleNamespaces=new Set<string>();
  // Recognize explicit Node loader bindings, without resolving arbitrary data flow.
  const bindings=(node:ts.Node)=>{
   if(ts.isImportDeclaration(node)&&ts.isStringLiteral(node.moduleSpecifier)&&['module','node:module'].includes(node.moduleSpecifier.text)){
    if(node.importClause?.name)moduleNamespaces.add(node.importClause.name.text);
    const named=node.importClause?.namedBindings;
    if(named&&ts.isNamespaceImport(named))moduleNamespaces.add(named.name.text);
    if(named&&ts.isNamedImports(named))for(const binding of named.elements)if((binding.propertyName??binding.name).text==='createRequire')requireFactories.add(binding.name.text);
   }
   if(ts.isVariableDeclaration(node)&&node.initializer&&moduleLoad(node.initializer)){
    if(ts.isIdentifier(node.name))moduleNamespaces.add(node.name.text);
    if(ts.isObjectBindingPattern(node.name))for(const binding of node.name.elements)if(!binding.dotDotDotToken&&ts.isIdentifier(binding.name)&&(binding.propertyName??binding.name).getText(ast)==='createRequire')requireFactories.add(binding.name.text);
   }
   ts.forEachChild(node,bindings);
  };bindings(ast);
  const factory=(expression:ts.Expression)=>{
   const value=unparen(expression);
   if(ts.isIdentifier(value))return requireFactories.has(value.text);
   if(!ts.isPropertyAccessExpression(value)&&!ts.isElementAccessExpression(value))return false;
   const owner=unparen(value.expression),member=ts.isPropertyAccessExpression(value)?value.name.text:value.argumentExpression&&ts.isStringLiteral(value.argumentExpression)?value.argumentExpression.text:undefined;
   return member==='createRequire'&&(ts.isIdentifier(owner)&&moduleNamespaces.has(owner.text)||moduleLoad(owner));
  };
  const loader=(expression:ts.Expression)=>{const value=unparen(expression);return ts.isIdentifier(value)&&value.text==='require'||factory(value);};
  const visit=(node:ts.Node)=>{
   if(ts.isVariableDeclaration(node)&&node.initializer&&loader(node.initializer)||ts.isBinaryExpression(node)&&node.operatorToken.kind===ts.SyntaxKind.EqualsToken&&loader(node.right))unsupported.push({file:path,reason:'Indirect module loader alias'});
   if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier){
    if(ts.isStringLiteral(node.moduleSpecifier))add(node.moduleSpecifier.text);else add('<computed>',false,false);
   }
   if(ts.isImportEqualsDeclaration(node)&&ts.isExternalModuleReference(node.moduleReference)){
    const expr=node.moduleReference.expression;if(expr&&ts.isStringLiteral(expr))add(expr.text);else add('<require>',false,false);
   }
   if(ts.isCallExpression(node)){
    if(node.expression.kind===ts.SyntaxKind.ImportKeyword){const arg=node.arguments[0];add(arg&&ts.isStringLiteral(arg)?arg.text:'<dynamic>',true,!!arg&&ts.isStringLiteral(arg));}
    else if(factory(node.expression))unsupported.push({file:path,reason:'Indirect module loader creation'});
    else if(ts.isIdentifier(node.expression)&&node.expression.text==='require'){
     const arg=node.arguments[0];add(arg&&ts.isStringLiteral(arg)?arg.text:'<require>',false,node.arguments.length===1&&!!arg&&ts.isStringLiteral(arg));
    }else if(ts.isIdentifier(node.expression)&&['eval','Function'].includes(node.expression.text)||ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='require'||ts.isElementAccessExpression(node.expression)&&node.expression.argumentExpression&&ts.isStringLiteral(node.expression.argumentExpression)&&node.expression.argumentExpression.text==='require')unsupported.push({file:path,reason:'Indirect code/module loader'});
   }
   if(ts.isNewExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==='Function')unsupported.push({file:path,reason:'Dynamic function constructor'});
   ts.forEachChild(node,visit);
  };visit(ast);files.push({path,sha256:hashBytes(bytes),imports});
 }
 const violations:AssuranceArchitectureObservation['violations']=[];
 for(const file of files)for(const imp of file.imports)for(const rule of check.rules)if(rule.from.includes(file.path)&&rule.forbidden.some(prefix=>[imp.specifier,imp.resolved].some(s=>s===prefix||s?.startsWith(`${prefix}/`))))violations.push({ruleId:rule.id,file:file.path,specifier:imp.specifier});
 return {checkId:check.id,checkHash:hash(check),method:'architecture',complete:files.length===check.files.length,comparisonCount:files.length*check.rules.length,files,rules:check.rules.map(r=>r.id),violations,unsupported};
}
