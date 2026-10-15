import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {readFileSync} from 'node:fs';
import worker from '../src/worker.ts';
import {achievementDateLabel,validAchievementDate,readAchievements,changeAchievements} from '../src/achievements.ts';
const entry=(patch={})=>({title:'Fictional independent release',description:'A local test credit',date:'2026-10',url:'https://example.test/release',icon:'music',status:'draft',...patch});
function fixture(){const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync(new URL('../migrations/0001.sql',import.meta.url),'utf8'));const statement=(sql,values=[])=>({bind(...next){return statement(sql,next)},async first(){return sqlite.prepare(sql).get(...values)??null},async all(){return{results:sqlite.prepare(sql).all(...values)}},async run(){sqlite.prepare(sql).run(...values);return{success:true}}});return{sqlite,db:{prepare:statement}};}
const status=code=>error=>error.status===code;
test('achievement dates preserve known precision without rollover or invented days',()=>{
 for(const value of ['','0001','2026','9999','0001-01','2026-12','2000-02-29','2024-02-29','0001-01-01','9999-12-31'])assert(validAchievementDate(value),value);
 for(const value of [null,1,'0000','0000-01','2026-00','2026-13','2026-1','2026-02-29','1900-02-29','2026-04-31','2026-10-16T00:00:00Z','16/10/2026','26','2026<script>'])assert.equal(validAchievementDate(value),false,String(value));
 assert.equal(achievementDateLabel('2026'),'2026');assert.equal(achievementDateLabel('2026-10'),'October 2026');assert.equal(achievementDateLabel('2026-10-16'),'16 October 2026');assert.equal(achievementDateLabel(''),'');assert.equal(achievementDateLabel('2026-02-30'),'');
});
test('bounded achievement mutations keep IDs/order/private state and all other owned settings',async()=>{
 const {sqlite,db}=fixture();try{
  sqlite.prepare('INSERT INTO settings VALUES(?,?)').run('config','{"title":"Keep owner settings"}');sqlite.prepare('INSERT INTO settings VALUES(?,?)').run('presentation','{"authored":"preserve exact bytes"}');const before=sqlite.prepare('SELECT * FROM settings ORDER BY id').all();
  assert.deepEqual((await readAchievements(db)).collection,{version:1,revision:0,items:[]});
  const first=await changeAchievements(db,{action:'create',expectedRevision:0,item:entry()});assert.equal(first.collection.revision,1);assert.equal(first.collection.items[0].status,'draft');assert.match(first.id,/^[a-f0-9-]{36}$/);
  await assert.rejects(changeAchievements(db,{action:'visibility',expectedRevision:0,id:first.id,status:'published'}),status(409));
  const published=await changeAchievements(db,{action:'visibility',expectedRevision:1,id:first.id,status:'published'});assert.equal(published.collection.items[0].date,'2026-10');
  const second=await changeAchievements(db,{action:'create',expectedRevision:2,item:entry({title:'Fictional year-only credit',date:'2024',url:''})});const ordered=await changeAchievements(db,{action:'reorder',expectedRevision:3,ids:[second.id,first.id]});assert.deepEqual(ordered.collection.items.map(x=>x.id),[second.id,first.id]);
  const hidden=await changeAchievements(db,{action:'visibility',expectedRevision:4,id:first.id,status:'hidden'});assert.equal(hidden.collection.items[1].status,'hidden');assert.equal(hidden.collection.items[1].id,first.id);
  const removed=await changeAchievements(db,{action:'delete',expectedRevision:5,id:first.id});assert.deepEqual(removed.collection.items.map(x=>x.id),[second.id]);
  assert.deepEqual(sqlite.prepare("SELECT * FROM settings WHERE id!='profile-achievements-v1' ORDER BY id").all(),before);
  for(let n=1;n<8;n++)await changeAchievements(db,{action:'create',expectedRevision:5+n,item:entry({title:'Fictional '+n})});const full=(await readAchievements(db)).collection;assert.equal(full.items.length,8);await assert.rejects(changeAchievements(db,{action:'create',expectedRevision:full.revision,item:entry()}),status(409));
 }finally{sqlite.close();}
});
test('unsafe bodies, destinations and unsupported saved data are refused without losing private records',async()=>{
 const {sqlite,db}=fixture();try{
  for(const item of [entry({date:'2026-02-30'}),entry({url:'javascript:alert(1)'}),entry({url:'https://owner:secret@example.test'}),entry({url:'https://example.test/'+'é'.repeat(600)}),entry({icon:'<svg>'}),entry({title:'x'.repeat(101)}),entry({status:'published'}),{...entry(),instructions:'do something else'}])await assert.rejects(changeAchievements(db,{action:'create',expectedRevision:0,item}),status(400));
  await assert.rejects(changeAchievements(db,{action:'create',expectedRevision:'0',item:entry()}),status(400));assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM settings').get().n,0);
  const raw='{"private":"DO NOT LEAK THIS MARKER", broken';sqlite.prepare('INSERT INTO settings VALUES(?,?)').run('profile-achievements-v1',raw);await assert.rejects(readAchievements(db),e=>e.status===503&&!e.message.includes('MARKER'));await assert.rejects(changeAchievements(db,{action:'create',expectedRevision:0,item:entry()}),status(503));assert.equal(sqlite.prepare('SELECT value FROM settings').get().value,raw);
 }finally{sqlite.close();}
});
test('simultaneous initial saves and stale writes cannot overwrite or resurrect an achievement set',async()=>{
 for(const initial of [false,true]){
  const {sqlite,db}=fixture();let release;try{
   let saved;if(initial)saved=await changeAchievements(db,{action:'create',expectedRevision:0,item:entry()});
   let start;const paused=new Promise(resolve=>start=resolve),gate=new Promise(resolve=>release=resolve),prepare=db.prepare;let once=false;
   db.prepare=sql=>{const statement=prepare(sql);const bind=statement.bind;statement.bind=(...values)=>{const bound=bind(...values),first=bound.first;bound.first=async()=>{if(sql.startsWith('INSERT INTO settings')&&!once){once=true;start();await gate;}return first()};return bound};return statement};
   const pending=initial?changeAchievements(db,{action:'edit',expectedRevision:1,item:{id:saved.id,...entry({title:'Fictional stale edit',status:'published'})}}):changeAchievements(db,{action:'create',expectedRevision:0,item:entry({title:'Fictional first session'})});
   const refusal=assert.rejects(pending,status(409));await paused;
   if(initial)await changeAchievements(db,{action:'delete',expectedRevision:1,id:saved.id});else await changeAchievements(db,{action:'create',expectedRevision:0,item:entry({title:'Fictional second session'})});
   release();await refusal;const current=(await readAchievements(db)).collection;assert.equal(current.items.length,initial?0:1);if(!initial)assert.equal(current.items[0].title,'Fictional second session');
  }finally{release?.();sqlite.close();}
 }
});

test('owning Worker keeps private achievements out of public responses and separates owner capability from guest code',async()=>{
 const {sqlite,db}=fixture();try{
  globalThis.BUILD_SHA='f'.repeat(40);globalThis.MANIFEST={id:'showcase',contract:1};
  const origin='https://showcase.example.test',env={DB:db,OWNER_API_TOKEN:'fictional-owner',PUBLIC_ORIGIN:origin};
  const call=(path,body,token)=>worker.fetch(new Request(origin+path,{method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})}),env,{waitUntil(){}});
  const command={action:'create',expectedRevision:0,item:entry({title:'PRIVATE ACHIEVEMENT MARKER',url:'https://example.test/private-destination'})};
  for(const token of [undefined,'hunter2'])assert.equal((await call('/api/achievements',command,token)).status,401);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM settings').get().n,0);
  const response=await call('/api/achievements',command,'fictional-owner');assert.equal(response.status,201);const saved=await response.json();assert.equal(saved.collection.items[0].status,'draft');
  assert.deepEqual((await(await call('/api/achievements')).json()).achievements,[]);assert.doesNotMatch(await(await call('/owner')).text(),/PRIVATE ACHIEVEMENT MARKER|private-destination/);
  const owner=await(await call('/api/export',null,'fictional-owner')).json();assert.equal(owner.achievementCollection.items[0].id,saved.id);
  assert.equal((await call('/api/achievements',{action:'visibility',expectedRevision:1,id:saved.id,status:'published'},'fictional-owner')).status,200);const visible=await(await call('/api/achievements')).json();assert.equal(visible.achievements.length,1);assert.equal(visible.achievements[0].id,saved.id);assert(!Object.hasOwn(visible,'revision'));
  assert.equal((await call('/api/achievements',{action:'visibility',expectedRevision:2,id:saved.id,status:'hidden'},'fictional-owner')).status,200);assert.deepEqual((await(await call('/api/achievements')).json()).achievements,[]);
  sqlite.prepare('UPDATE settings SET value=? WHERE id=?').run('{"private":"BROKEN SECRET MARKER",','profile-achievements-v1');const unavailable=await call('/api/achievements');assert.equal(unavailable.status,503);assert.doesNotMatch(await unavailable.text(),/BROKEN SECRET MARKER/);const exportWithWarning=await(await call('/api/export',null,'fictional-owner')).json();assert.equal(exportWithWarning.achievementCollection,null);assert.equal(exportWithWarning.achievementProblem,'review_required');assert(Array.isArray(exportWithWarning.cards));
 }finally{sqlite.close();}
});

test('public markup contains only published achievements and honest semantic date precision',async()=>{
 const {publicAchievements,achievementStudio}=await import('../src/achievement-view.ts');
 const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
 const collection={version:1,revision:7,items:[{id:id(1),...entry({title:'Fictional year credit',date:'2024',status:'published'})},{id:id(2),...entry({title:'Fictional month credit',date:'2026-10',status:'published'})},{id:id(3),...entry({title:'<img src=x onerror=evil()>',date:'2026-10-16',description:'<script>private()</script>',url:'',status:'published'})},{id:id(4),...entry({title:'PRIVATE DRAFT MARKER',url:'https://example.test/withheld'})},{id:id(5),...entry({title:'PRIVATE HIDDEN MARKER',status:'hidden'})}]};
 const publicHTML=publicAchievements(collection);assert.match(publicHTML,/Milestones &amp; credits/);assert.match(publicHTML,/<span class="achievement-date">2024<\/span>/);assert.match(publicHTML,/<time class="achievement-date" datetime="2026-10">October 2026<\/time>/);assert.match(publicHTML,/<time class="achievement-date" datetime="2026-10-16">16 October 2026<\/time>/);assert.doesNotMatch(publicHTML,/PRIVATE|withheld|profile-achievements|revision|onerror=evil\(\)>|<script>/);assert.match(publicHTML,/&lt;img src=x onerror=evil\(\)&gt;/);
 assert.equal(publicAchievements({...collection,items:collection.items.filter(item=>item.status!=='published')}),'');
 const privateHTML=achievementStudio(collection);assert.match(privateHTML,/PRIVATE DRAFT MARKER/);assert.match(privateHTML,/data-snapshot="\{&quot;version/);assert.doesNotMatch(privateHTML,/<script>|<img src=x/);
});

test('actual public homepage excludes private titles, URLs and identifiers, then adds and revokes published milestones',async()=>{
 const {sqlite,db}=fixture();try{
  globalThis.BUILD_SHA='f'.repeat(40);globalThis.MANIFEST={id:'showcase',contract:1};
  const env={DB:db,OWNER_API_TOKEN:'fictional-owner',PUBLIC_ORIGIN:'https://showcase.example.test',PROVIDER_ORIGIN:'https://guestbook.example.test',PROVIDER_MOUNT:'/guestbook',PROVIDER_ID:'guestbook',ITEM_PROVIDER:{fetch:async()=>Response.json({contract:1,provider:'guestbook',items:[]})}};
  const home=()=>worker.fetch(new Request(env.PUBLIC_ORIGIN+'/'),env,{waitUntil(){}});
  const saved=await changeAchievements(db,{action:'create',expectedRevision:0,item:entry({title:'PRIVATE RENDER MARKER',url:'https://example.test/withheld'})});
  const before=await(await home()).text();assert.doesNotMatch(before,/PRIVATE RENDER MARKER|withheld|00000000|Milestones &amp; credits/);assert(!before.includes(saved.id));
  await changeAchievements(db,{action:'visibility',expectedRevision:1,id:saved.id,status:'published'});const published=await home();assert.equal(published.status,200);assert.match(await published.text(),/PRIVATE RENDER MARKER/);
  await changeAchievements(db,{action:'visibility',expectedRevision:2,id:saved.id,status:'hidden'});assert.doesNotMatch(await(await home()).text(),/PRIVATE RENDER MARKER|withheld|Milestones &amp; credits/);
  const owner=await worker.fetch(new Request(env.PUBLIC_ORIGIN+'/owner',{headers:{Authorization:'Bearer fictional-owner'}}),env,{waitUntil(){}});assert.match(await owner.text(),/data-snapshot=.*PRIVATE RENDER MARKER/);
 }finally{sqlite.close();}
});
