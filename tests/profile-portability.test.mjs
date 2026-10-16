import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {profileSettingsFile,exportProfileSettings,changeProfileSettings,profileFileFormat} from '../src/profile-portability.ts';
import {sessionCookie,client} from '../src/common.ts';
import {runInNewContext} from 'node:vm';
import worker from '../src/worker.ts';
const config={title:'Fictional field notes',intro:'A fictional profile.',theme:'midnight',layout:'compact',handle:'field.notes',website:'https://example.test/',github:'https://github.com/example',bluesky:'',linkedin:''};
const file=(patch={})=>({format:profileFileFormat,version:1,config:{...config,...patch}});
function fixture(saved={...config,ownerExtension:{private:'FICTIONAL PRIVATE EXTENSION'}}){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync(new URL('../migrations/0001.sql',import.meta.url),'utf8'));let beforeWrite;
 if(saved!==null)sqlite.prepare('INSERT INTO settings VALUES(?,?)').run('config',JSON.stringify(saved));
 for(const [key,value]of [['profile-achievements-v1','{"fictional":"private milestone sentinel"}'],['profile-tags-v1','{"fictional":"private tag sentinel"}'],['presentation','{"fictional":"style sentinel"}']])sqlite.prepare('INSERT INTO settings VALUES(?,?)').run(key,value);
 sqlite.prepare('INSERT INTO cards VALUES(?,?,?,?,?,?,?,?)').run('fictional-card','Fictional private link','Preserved','https://example.test/private',null,null,0,'hidden');
 const statement=(sql,values=[])=>({bind(...next){return statement(sql,next)},async first(){if(sql.startsWith('INSERT INTO settings'))await beforeWrite?.();return sqlite.prepare(sql).get(...values)??null},async all(){return {results:sqlite.prepare(sql).all(...values)}},async run(){sqlite.prepare(sql).run(...values);return {success:true}}});
 const db={prepare:statement},raw=()=>sqlite.prepare("SELECT value FROM settings WHERE id='config'").get()?.value??null;
 const unrelated=()=>JSON.stringify({cards:sqlite.prepare('SELECT * FROM cards').all(),settings:sqlite.prepare("SELECT * FROM settings WHERE id!='config' ORDER BY id").all()});
 return {sqlite,db,raw,unrelated,onWrite(callback){beforeWrite=callback;}};
}
const status=expected=>error=>error.status===expected;
test('portable format accepts only declared settings and safe destinations; never executable or credential fields',()=>{
 assert.deepEqual(profileSettingsFile(file()),file());
 const manifest=JSON.parse(readFileSync(new URL('../app.manifest.json',import.meta.url),'utf8'));assert.deepEqual(manifest.profileSettings,{version:1,format:profileFileFormat,maxFileBytes:32768});
 for(const value of ["export default { token: 'no' }",null,[],{...file(),version:2},{...file(),OWNER_API_TOKEN:'no'},{...file(),source:'https://example.test/build'},{...file(),config:{...config,token:'no'}},{...file(),config:{...config,website:'javascript:alert(1)'}},{...file(),config:{...config,website:'https://fictional:secret@example.test/'}},{...file(),config:{...config,github:'https://example.test/spoof'}},{...file(),config:{...config,title:''}},{...file(),config:{...config,layout:'arbitrary-html'}}])assert.throws(()=>profileSettingsFile(value),status(400));
 const missing=file();delete missing.config.handle;assert.throws(()=>profileSettingsFile(missing),status(400));
 assert.equal(profileSettingsFile(file({website:'https://example.test'})).config.website,'https://example.test/');
});
test('export allowlists settings; review writes nothing and applying preserves unrelated records and owner extensions',async()=>{
 const f=fixture();try{
  const initial=f.raw(),untouched=f.unrelated();assert.deepEqual(await exportProfileSettings(f.db,config),file());
  const changed=file({title:'Changed fictional name',website:''}),review=await changeProfileSettings(f.db,{action:'review',file:changed},config);
  assert.equal(review.saved,false);assert.deepEqual(review.changedFields,['title','website']);assert.equal(f.raw(),initial);assert.equal(f.unrelated(),untouched);
  const saved=await changeProfileSettings(f.db,{action:'apply',file:changed,expected:review.before},config);assert.equal(saved.saved,true);assert.equal(JSON.parse(f.raw()).title,'Changed fictional name');assert.deepEqual(JSON.parse(f.raw()).ownerExtension,{private:'FICTIONAL PRIVATE EXTENSION'});assert.equal(f.unrelated(),untouched);
  const exported=await exportProfileSettings(f.db,config);assert.doesNotMatch(JSON.stringify(exported),/PRIVATE|sentinel|fictional-card/);assert.deepEqual(exported,changed);
 }finally{f.sqlite.close();}
});
test('stale reviewed values and invalid commands cannot replace current settings',async()=>{
 const f=fixture();try{
  const review=await changeProfileSettings(f.db,{action:'review',file:file({title:'Import'})},config);
  f.sqlite.prepare("UPDATE settings SET value=? WHERE id='config'").run(JSON.stringify({...config,title:'Saved elsewhere'}));const raw=f.raw();
  await assert.rejects(changeProfileSettings(f.db,{action:'apply',file:file({title:'Import'}),expected:review.before},config),status(409));assert.equal(f.raw(),raw);
  for(const input of [{action:'apply',file:file()},{action:'review',file:file(),token:'no'},{action:'delete',file:file()},{action:'apply',file:file(),expected:{...config,secret:'no'}}])await assert.rejects(changeProfileSettings(f.db,input,config),status(400));assert.equal(f.raw(),raw);
 }finally{f.sqlite.close();}
});
test('atomic SQL comparison catches intervening extension writes and competing first saves',async()=>{
 const f=fixture();try{
  f.onWrite(()=>{f.onWrite(undefined);f.sqlite.prepare("UPDATE settings SET value=? WHERE id='config'").run(JSON.stringify({...config,ownerExtension:'Concurrent extension'}));});
  await assert.rejects(changeProfileSettings(f.db,{action:'apply',file:file({title:'Import'}),expected:config},config),status(409));assert.equal(JSON.parse(f.raw()).ownerExtension,'Concurrent extension');assert.equal(JSON.parse(f.raw()).title,config.title);
 }finally{f.sqlite.close();}
 const empty=fixture(null);try{
  const results=await Promise.allSettled(['First','Second'].map(title=>changeProfileSettings(empty.db,{action:'apply',file:file({title}),expected:config},config)));
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);assert.equal(results.filter(result=>result.status==='rejected'&&result.reason.status===409).length,1);
 }finally{empty.sqlite.close();}
});
test('malformed stored settings remain untouched and diagnostics never echo their contents',async()=>{
 for(const raw of ['{"secret":"PRIVATE MALFORMED"',JSON.stringify({secret:'PRIVATE MALFORMED'}),'[]','null']){
  const f=fixture();try{f.sqlite.prepare("UPDATE settings SET value=? WHERE id='config'").run(raw);
   // Missing public fields can use supported defaults, but malformed JSON/types cannot.
   if(raw===JSON.stringify({secret:'PRIVATE MALFORMED'})){assert.deepEqual(await exportProfileSettings(f.db,config),file());continue;}
   await assert.rejects(exportProfileSettings(f.db,config),error=>error.status===503&&!error.message.includes('PRIVATE MALFORMED'));
   await assert.rejects(changeProfileSettings(f.db,{action:'apply',file:file(),expected:config},config),status(503));assert.equal(f.raw(),raw);
  }finally{f.sqlite.close();}
 }
});
test('an ambiguous database result returns recovery without automatic resubmission',async()=>{
 const f=fixture();try{
  let writes=0;const db={prepare(sql){const prepared=f.db.prepare(sql);if(!sql.startsWith('INSERT INTO settings'))return prepared;return {bind(...values){const bound=prepared.bind(...values);return {async first(){writes++;await bound.first();throw Error('FICTIONAL PROVIDER SECRET');}}}};}};
  await assert.rejects(changeProfileSettings(db,{action:'apply',file:file({title:'Committed before interruption'}),expected:config},config),error=>error.status===503&&/could not be confirmed/.test(error.message)&&!error.message.includes('SECRET'));
  assert.equal(writes,1);assert.equal(JSON.parse(f.raw()).title,'Committed before interruption');
  await assert.rejects(changeProfileSettings(f.db,{action:'apply',file:file({title:'Committed before interruption'}),expected:config},config),status(409));
 }finally{f.sqlite.close();}
});
test('an older ordinary settings save cannot overwrite an import committed after its read',async()=>{
 const f=fixture();let release;try{
  const barrier=new Promise(done=>{release=done;});let notify;const paused=new Promise(done=>{notify=done;});
  f.onWrite(()=>{f.onWrite(undefined);notify();return barrier;});
  globalThis.BUILD_SHA='f'.repeat(40);globalThis.MANIFEST={id:'showcase',contract:1};
  const env={DB:f.db,OWNER_API_TOKEN:'fictional-owner',PUBLIC_ORIGIN:'https://showcase.example.test'};
  const older=worker.fetch(new Request(env.PUBLIC_ORIGIN+'/api/config',{method:'POST',headers:{Authorization:'Bearer fictional-owner','Content-Type':'application/json'},body:JSON.stringify({...config,title:'Older settings form'})}),env,{waitUntil(){}});
  await paused;
  await changeProfileSettings(f.db,{action:'apply',file:file({title:'Newer imported settings'}),expected:config},config);
  release();const refusal=await older;assert.equal(refusal.status,409);assert.equal(JSON.parse(f.raw()).title,'Newer imported settings');assert.deepEqual(JSON.parse(f.raw()).ownerExtension,{private:'FICTIONAL PRIVATE EXTENSION'});
 }finally{release?.();f.sqlite.close();}
});
test('owner API protects download/review/apply, enforces cookie origins and body bounds, and never fetches destinations',async()=>{
 const f=fixture();try{
  globalThis.BUILD_SHA='f'.repeat(40);globalThis.MANIFEST={id:'showcase',contract:1};let providerCalls=0;
  const origin='https://showcase.example.test',env={DB:f.db,OWNER_API_TOKEN:'fictional-owner',PUBLIC_ORIGIN:origin,ITEM_PROVIDER:{fetch(){providerCalls++;throw Error('No destination fetching');}}};
  const call=(method='GET',body,headers={Authorization:'Bearer fictional-owner'})=>worker.fetch(new Request(origin+'/api/profile-settings',{method,headers:{'Content-Type':'application/json',...headers},...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)})}),env,{waitUntil(){}});
  for(const headers of [{},{Authorization:'Bearer hunter2'}]){assert.equal((await call('GET',undefined,headers)).status,401);assert.equal((await call('POST',{action:'review',file:file()},{Origin:origin,...headers})).status,401);}
  const download=await call();assert.equal(download.status,200);assert.match(download.headers.get('Content-Disposition'),/attachment; filename="linkarooie-profile.json"/);assert.equal(download.headers.get('Cache-Control'),'no-store');assert.deepEqual(await download.json(),file());
  const mounted=await worker.fetch(new Request(origin+'/showcase/api/profile-settings',{headers:{Authorization:'Bearer fictional-owner'}}),env,{waitUntil(){}});assert.equal(mounted.status,200);assert.deepEqual(await mounted.json(),file());
  assert.equal((await call('DELETE')).status,405);
  const Cookie=(await sessionCookie(env,'showcase_session','')).split(';')[0];
  assert.equal((await call('POST',{action:'review',file:file()},{Cookie,Origin:'https://other.example.test'})).status,403);
  const review=await call('POST',{action:'review',file:file({title:'Imported fictional name'})},{Cookie,Origin:origin});assert.equal(review.status,200);const compared=await review.json();assert.equal(compared.saved,false);
  const applied=await call('POST',{action:'apply',file:file({title:'Imported fictional name'}),expected:compared.before},{Cookie,Origin:origin});assert.equal(applied.status,200);
  assert.equal((await call('POST','x'.repeat(65537))).status,400);assert.equal((await call('POST','export default {}')).status,400);assert.equal(providerCalls,0);
 }finally{f.sqlite.close();}
});
test('file review controls appear only inside the authenticated studio, with inert comparison and no-script download',async()=>{
 const f=fixture();try{
  f.sqlite.prepare("UPDATE settings SET value='{}' WHERE id='presentation'").run();
  for(const key of ['profile-tags-v1','profile-achievements-v1'])f.sqlite.prepare('UPDATE settings SET value=? WHERE id=?').run('{"version":1,"revision":0,"items":[]}',key);
  globalThis.BUILD_SHA='f'.repeat(40);globalThis.MANIFEST={id:'showcase',contract:1};
  const origin='https://showcase.example.test',env={DB:f.db,OWNER_API_TOKEN:'fictional-owner',PUBLIC_ORIGIN:origin,PROVIDER_ORIGIN:'https://guestbook.example.test',ITEM_PROVIDER:{async fetch(){return Response.json({contract:1,provider:'guestbook',items:[]});}}};
  for(const [path,owner]of [['/owner',false],['/',false],['/showcase/owner',true]]){
   const response=await worker.fetch(new Request(origin+path,{headers:owner?{Authorization:'Bearer fictional-owner'}:{}}),env,{waitUntil(){}});assert.equal(response.status,200);const html=await response.text();
   if(!owner){assert.doesNotMatch(html,/id="profile-portability"|data-settings-comparison|FICTIONAL PRIVATE EXTENSION/);continue;}
   assert.match(html,/href="\/showcase\/api\/profile-settings" download="linkarooie-profile.json"/);assert.match(html,/<section data-settings-comparison hidden/);assert.match(html,/data-apply-settings disabled/);assert.match(html,/aria-describedby="profile-settings-file-help"/);assert.match(html,/Reviewing saves nothing/);assert.doesNotMatch(html,/FICTIONAL PRIVATE EXTENSION/);
  }
 }finally{f.sqlite.close();}
});
test('ordinary settings save releases pending state after cancelled navigation and reports only confirmed saved values',async()=>{
 for(const fails of [false,true]){
  const button={disabled:false},message={textContent:''},dataset={},events=[];let submit,reloads=0,respond;
  const submitted={...config,title:'  Normalized name  '},saved={...config,title:'Normalized name',ownerExtension:'FICTIONAL PRIVATE EXTENSION'};
  const form={dataset,querySelector:selector=>selector==='button'?button:message,addEventListener(name,handler){if(name==='submit')submit=handler;},dispatchEvent(event){events.push(event);}};
  const document={querySelector:selector=>selector==='#config'?form:selector==='main [role=status]'?message:null};
  const source=client('','showcase_session').replace(/^<script>/,'').replace(/<\/script>$/,'');
  runInNewContext(source,{document,FormData:class{constructor(){return Object.entries(submitted);}},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},location:{reload(){assert.equal(dataset.saving,undefined);assert.equal(button.disabled,false);reloads++;/* Model a cancelled navigation, not actual browser acceptance. */}},fetch:()=>new Promise(done=>{respond=done;})});
  const pending=submit({preventDefault(){},currentTarget:form});assert.equal(dataset.saving,'true');assert.equal(button.disabled,true);
  respond({ok:!fails,json:async()=>fails?{error:'Fictional uncertain result'}:{ok:true,config:saved}});await pending;
  assert.equal(dataset.saving,undefined);assert.equal(button.disabled,false);
  assert.equal(reloads,fails?0:1);assert.equal(events.length,fails?0:1);
  if(!fails){assert.equal(events[0].type,'linkarooie:settings-saved');assert.equal(events[0].detail.submitted.title,submitted.title);assert.equal(events[0].detail.saved.title,saved.title);assert.equal(message.textContent,'Configuration saved.');}
  else assert.equal(message.textContent,'Fictional uncertain result');
 }
});
