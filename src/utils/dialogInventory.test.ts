import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import ts from 'typescript';
const files=(dir:string):string[]=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(item=>item.isDirectory()?files(path.join(dir,item.name)):item.name.endsWith('.tsx')?[path.join(dir,item.name)]:[]);
test('all framed popup panels have modal semantics, a keyboard target and a close lifecycle',()=>{
 let count=0;const missing:string[]=[];
 for(const file of [...files('src/components'),'src/App.tsx']){const text=fs.readFileSync(file,'utf8'),ast=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);const visit=(node:ts.Node)=>{
  if(ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node)){
   const attributes=node.attributes.properties.filter(ts.isJsxAttribute);const attribute=(name:string)=>attributes.find(a=>a.name.getText(ast)===name);
   const value=(name:string)=>{const x=attribute(name)?.initializer;return x&&ts.isStringLiteral(x)?x.text:'';};
   if(/(?:^|\s)clinic-modal-(?:panel|sheet)(?:\s|$)/.test(value('className'))){count++;if(!['dialog','alertdialog'].includes(value('role'))||value('aria-modal')!=='true'||!attribute('tabIndex')||!attribute('ref'))missing.push(file+':'+(ast.getLineAndCharacterOfPosition(node.getStart()).line+1));}
  }ts.forEachChild(node,visit);};visit(ast);
 }
 assert.ok(count>=35,'The audit must cover the real popup inventory, not a sample.');assert.deepEqual(missing,[],'Popup panels need role, aria-modal, focus target and lifecycle ref');
});
