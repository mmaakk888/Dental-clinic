import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {buildSync} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import type {User} from '../types';

const source=fs.readFileSync('src/components/auth/LoginModal.tsx','utf8');
const css=fs.readFileSync('src/components/auth/LoginModal.css','utf8');
const bundle=buildSync({entryPoints:['src/components/auth/LoginModal.tsx'],bundle:true,write:false,platform:'node',format:'cjs',external:['react','lucide-react'],loader:{'.css':'empty'}}).outputFiles[0].text;
const realRequire=createRequire(import.meta.url);
function compile(react:typeof React=React){const module={exports:{} as any};new Function('require','module','exports',bundle)((name:string)=>name==='react'?react:realRequire(name),module,module.exports);return module.exports.LoginModal;}
const Login=compile();
const owner={id:'synthetic-login-owner',name:'مدير اختبار',username:'synthetic-owner',role:'admin',isActive:true} as User;
const props=(overrides:Record<string,unknown>={})=>({users:[],clinicName:'عيادة اختبار',clinicLogo:null,onAuthenticate:async()=>owner,onLogin:async()=>{},...overrides});
function nodes(tree:any,predicate:(node:any)=>boolean):any[]{
  if(!React.isValidElement(tree))return [];
  const children=(tree.props as any).children;
  return [...(predicate(tree)?[tree]:[]),...React.Children.toArray(children).flatMap(child=>nodes(child,predicate))];
}
function harness(overrides:Record<string,unknown>={}){
  const state:any[]=[],refs:any[]=[];let stateCursor=0,refCursor=0;
  const fake={...React,useState:(initial:any)=>{const at=stateCursor++;if(!(at in state))state[at]=typeof initial==='function'?initial():initial;return [state[at],(next:any)=>{state[at]=typeof next==='function'?next(state[at]):next;}];},useRef:(initial:any)=>{const at=refCursor++;return refs[at]??(refs[at]={current:initial});},useEffect:()=>{}};
  const Component=compile(fake as typeof React),inputProps=props(overrides);
  const render=()=>{stateCursor=0;refCursor=0;return Component(inputProps);};
  const find=(predicate:(node:any)=>boolean)=>{const found=nodes(render(),predicate);assert(found.length,'expected control exists');return found[0].props;};
  const field=(id:string)=>find(node=>node.type==='input'&&node.props.id===id);
  const enter=(name='synthetic-owner',password='Synthetic_UI_Only')=>{field('login-username').onChange({target:{value:name}});field('login-password').onChange({target:{value:password}});};
  const submit=()=>find(node=>node.type==='form').onSubmit({preventDefault(){}});
  return {render,find,field,enter,submit,state};
}

test('login keeps clinic identity and accessible RTL form without seeding any account',()=>{
  const html=renderToStaticMarkup(React.createElement(Login,props({clinicName:'عيادة <اختبار>'})));
  assert.match(html,/dir="rtl"/);assert.match(html,/عيادة &lt;اختبار&gt;/);assert.match(html,/aria-labelledby="login-title"/);
  for(const value of ['name="username"','autoComplete="username"','name="password"','autoComplete="current-password"','type="submit"'])assert.ok(html.includes(value),value);
  assert.doesNotMatch(html,/Synthetic_UI_Only|synthetic-owner|mailto:|خادم العيادة|animate-shake/);
});
test('empty username or password never invokes authentication',async()=>{
  let calls=0;const h=harness({onAuthenticate:async()=>{calls++;return owner;}});
  await h.submit();assert.match(h.state[4],/اسم المستخدم/);h.field('login-username').onChange({target:{value:'synthetic-owner'}});
  await h.submit();assert.match(h.state[4],/كلمة السر/);assert.equal(calls,0);
});
test('double submit stays single-flight and passes trimmed username and selected remember option',async()=>{
  let calls=0,complete!:(user:User)=>void;const logins:any[]=[];
  const h=harness({onAuthenticate:(name:string,password:string)=>{calls++;assert.equal(name,'synthetic-owner');assert.equal(password,'Synthetic_UI_Only');return new Promise<User>(resolve=>{complete=resolve;});},onLogin:async(user:User,remember:boolean)=>{logins.push({user,remember});}});
  h.enter('  synthetic-owner  ');h.find(node=>node.props.name==='remember').onChange({target:{checked:false}});
  const pending=h.submit();await h.submit();assert.equal(calls,1);assert.equal(h.field('login-username').disabled,true);assert.equal(h.field('login-password').disabled,true);
  assert.equal(h.find(node=>node.type==='form')['aria-busy'],true);complete(owner);await pending;
  assert.deepEqual(logins,[{user:owner,remember:false}]);assert.equal(h.field('login-password').value,'');assert.equal(h.find(node=>node.type==='form')['aria-busy'],false);
});
test('server errors are announced without shaking or discarding retry fields',async()=>{
  const h=harness({onAuthenticate:async()=>{throw Error('بيانات الحساب غير صحيحة');}});h.enter();await h.submit();
  assert.equal(h.find(node=>node.props.role==='alert').id,'login-error');assert.equal(h.field('login-password')['aria-describedby'],'login-error');
  assert.equal(h.field('login-password').value,'Synthetic_UI_Only');assert.equal(h.state[5],false);
});
test('denied account access never calls onLogin after authentication',async()=>{
  let logins=0;const h=harness({onAuthenticate:async()=>({...owner,isActive:false}),onLogin:async()=>{logins++;}});
  h.enter();await h.submit();assert.equal(logins,0);assert.ok(h.state[4]);assert.equal(h.state[5],false);
});
test('password visibility and caps-lock warning do not alter credentials',()=>{
  const h=harness();h.enter();h.find(node=>node.props['aria-controls']==='login-password').onClick();
  assert.equal(h.field('login-password').type,'text');assert.equal(h.field('login-password').value,'Synthetic_UI_Only');
  h.field('login-password').onKeyDown({getModifierState:(key:string)=>key==='CapsLock'});
  assert.equal(h.field('login-password')['aria-describedby'],'login-caps-lock');h.field('login-password').onBlur();assert.equal(h.state[6],false);
});
test('recovery isolates the form and uses the established keyboard/backdrop dialog lifecycle',()=>{
  const h=harness();h.find(node=>node.props.className==='clinic-login-help').onClick();
  assert.equal(h.find(node=>node.type==='main').inert,true);assert.equal(h.find(node=>node.props.role==='dialog')['aria-modal'],'true');
  assert.match(source,/useAppointmentDialog\(isForgotOpen/);assert.doesNotMatch(source,/document\.addEventListener\('keydown'/);
  h.find(node=>node.type==='button'&&node.props.onClick&&node.props.className==='clinic-login-submit').onClick();assert.equal(h.find(node=>node.type==='main').inert,false);
});
test('login styling is scoped, keyboard aware, reduced-motion friendly and avoids expensive background filters',()=>{
  for(const text of ['--clinic-visible-height','safe-area-inset-top','overflow-y: auto','flex-wrap: wrap','font-size: 16px','height: 44px','focus-visible','prefers-reduced-motion','max-height: 580px'])assert.ok(css.includes(text),text);
  assert.doesNotMatch(css,/backdrop-filter|filter:\s*blur|will-change|animation:\s*shake/);assert.doesNotMatch(source,/autoFocus|localStorage|sessionStorage|fetch\(/);
  assert.match(source,/autoCapitalize="none"/);assert.match(source,/spellCheck=\{false\}/);
});
test('small text and primary action meet minimum normal-text contrast in the sign-in palette',()=>{
  const luminance=(hex:string)=>{const channels=hex.match(/[a-f0-9]{2}/gi)!.map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722;};
  for(const [text,bg] of [['adb9cf','0e192d'],['8796b0','0a1427'],['111d31','f4bb41'],['a1b0c9','0e192d'],['f6c453','14213a']]){
    const values=[luminance(text),luminance(bg)].sort((a,b)=>b-a);assert.ok((values[0]+.05)/(values[1]+.05)>=4.5,`${text} on ${bg}`);
  }
});
