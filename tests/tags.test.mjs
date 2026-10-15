import test from 'node:test';import assert from 'node:assert/strict';import{DatabaseSync}from'node:sqlite';import{readFileSync}from'node:fs';
import{readTags,changeTags}from'../src/tags.ts';import{changeAchievements,readAchievements}from'../src/achievements.ts';import{tagFields,tagHasContext}from'../public/brand/profile-tag-fields.mjs';import worker from'../src/worker.ts';
import{publicTags}from'../src/tag-view.ts';import{runInNewContext}from'node:vm';
const entry=(patch={})=>({label:'Fictional tool',description:'',citationLabel:'',citationURL:'',relatedLabel:'',relatedURL:'',status:'draft',...patch});
function fixture(){const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync(new URL('../migrations/0001.sql',import.meta.url),'utf8'));const statement=(sql,values=[])=>({bind(...next){return statement(sql,next)},async first(){return sqlite.prepare(sql).get(...values)??null},async all(){return{results:sqlite.prepare(sql).all(...values)}},async run(){sqlite.prepare(sql).run(...values);return{success:true}}});return{sqlite,db:{prepare:statement}};}
const status=code=>error=>error.status===code;
test('tag data accepts plain labels and bounded optional context, refusing credentials and executable shapes',()=>{
 assert.equal(tagHasContext(tagFields(entry())),false);
 const rich=tagFields(entry({description:'Explanation\nwith context',citationURL:'https://example.test/reference',relatedLabel:'Related work',relatedURL:'https://example.test/work'}));assert(tagHasContext(rich));assert.equal(rich.citationURL,'https://example.test/reference');
 for(const patch of [{label:''},{label:'x'.repeat(41)},{description:'x'.repeat(241)},{label:'a\nb'},{citationURL:'javascript:alert(1)'},{relatedURL:'http://example.test'},{citationURL:'https://fictional:secret@example.test'},{citationLabel:'Missing URL'},{relatedLabel:'Missing URL'},{status:'approved'},{html:'<script>'},{citationURL:'https://example.test/\nprivate'}])assert.throws(()=>tagFields(entry(patch)),JSON.stringify(patch));
 assert.equal(tagFields(entry({description:'<script>plain text</script>'})).description,'<script>plain text</script>');
});
test('tags use an independent bounded revisioned row and preserve existing profile, cards and milestones',async()=>{
 const{sqlite,db}=fixture();try{
  sqlite.prepare('INSERT INTO settings VALUES(?,?)').run('config','{"title":"Original"}');
  const milestone=await changeAchievements(db,{action:'create',expectedRevision:0,item:{title:'Keep milestone',description:'',date:'2026',url:'',icon:'code',status:'draft'}}),prior=JSON.stringify((await readAchievements(db)).collection);
  let saved=await changeTags(db,{action:'create',expectedRevision:0,item:entry()});const id=saved.id;assert.equal(saved.collection.items[0].status,'draft');
  saved=await changeTags(db,{action:'edit',expectedRevision:1,item:{id,...entry({description:'Useful context'})}});assert.equal(saved.id,id);
  await assert.rejects(changeTags(db,{action:'visibility',expectedRevision:1,id,status:'published'}),status(409));
  saved=await changeTags(db,{action:'visibility',expectedRevision:2,id,status:'published'});assert.equal(saved.collection.items[0].status,'published');
  for(let n=1;n<12;n++)saved=await changeTags(db,{action:'create',expectedRevision:saved.collection.revision,item:entry({label:'Fictional '+n})});
  await assert.rejects(changeTags(db,{action:'create',expectedRevision:saved.collection.revision,item:entry()}),status(409));
  const ids=saved.collection.items.map(item=>item.id).reverse();saved=await changeTags(db,{action:'reorder',expectedRevision:saved.collection.revision,ids});assert.deepEqual(saved.collection.items.map(item=>item.id),ids);
  saved=await changeTags(db,{action:'delete',expectedRevision:saved.collection.revision,id});assert(!saved.collection.items.some(item=>item.id===id));
  assert.equal(JSON.stringify((await readAchievements(db)).collection),prior);assert.equal((await readAchievements(db)).collection.items[0].id,milestone.id);assert.equal(sqlite.prepare("SELECT value FROM settings WHERE id='config'").get().value,'{"title":"Original"}');
 }finally{sqlite.close();}
});
test('missing-row and existing-row races never overwrite a competing tag session or resurrect its deletion',async()=>{
 for(const initial of [false,true]){const{sqlite,db}=fixture();let release;try{
  const saved=initial?await changeTags(db,{action:'create',expectedRevision:0,item:entry()}):null;let start;const gate=new Promise(resolve=>release=resolve),paused=new Promise(resolve=>start=resolve);let once=false;const prepare=db.prepare;
  db.prepare=sql=>{const statement=prepare(sql),bind=statement.bind;statement.bind=(...values)=>{const bound=bind(...values),first=bound.first;bound.first=async()=>{if(sql.startsWith('INSERT INTO settings')&&!once){once=true;start();await gate;}return first()};return bound};return statement;};
  const pending=initial?changeTags(db,{action:'edit',expectedRevision:1,item:{id:saved.id,...entry({label:'Stale resurrection',status:'published'})}}):changeTags(db,{action:'create',expectedRevision:0,item:entry({label:'First session'})});const refusal=assert.rejects(pending,status(409));await paused;
  if(initial)await changeTags(db,{action:'delete',expectedRevision:1,id:saved.id});else await changeTags(db,{action:'create',expectedRevision:0,item:entry({label:'Second session'})});release();await refusal;const collection=(await readTags(db)).collection;assert.equal(collection.items.length,initial?0:1);if(!initial)assert.equal(collection.items[0].label,'Second session');
 }finally{release?.();sqlite.close();}}
});
test('malformed stored tags remain unchanged and private; owner export can recover other app content',async()=>{
 const{sqlite,db}=fixture();try{
  const raw='{"version":2,"private":"DO NOT EXPOSE"}';sqlite.prepare('INSERT INTO settings VALUES(?,?)').run('profile-tags-v1',raw);await assert.rejects(readTags(db),status(503));await assert.rejects(changeTags(db,{action:'create',expectedRevision:0,item:entry()}),status(503));assert.equal(sqlite.prepare("SELECT value FROM settings WHERE id='profile-tags-v1'").get().value,raw);
  globalThis.BUILD_SHA='f'.repeat(40);globalThis.MANIFEST={id:'showcase',contract:1};const env={DB:db,OWNER_API_TOKEN:'fictional-owner',PUBLIC_ORIGIN:'https://showcase.example.test'};
  const response=await worker.fetch(new Request(env.PUBLIC_ORIGIN+'/api/tags'),env,{waitUntil(){}});assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/DO NOT EXPOSE/);
  const exported=await worker.fetch(new Request(env.PUBLIC_ORIGIN+'/api/export',{headers:{Authorization:'Bearer fictional-owner'}}),env,{waitUntil(){}});const value=await exported.json();assert.equal(value.tagProblem,'review_required');assert.equal(value.tagCollection,null);assert.deepEqual(value.cards,[]);assert.deepEqual(value.achievementCollection.items,[]);
 }finally{sqlite.close();}
});
test('tag API denies hunter2 owner writes and exposes only published data without private revisions',async()=>{
 const{sqlite,db}=fixture();try{
  globalThis.BUILD_SHA='f'.repeat(40);globalThis.MANIFEST={id:'showcase',contract:1};const origin='https://showcase.example.test',env={DB:db,OWNER_API_TOKEN:'fictional-owner',PUBLIC_ORIGIN:origin};const call=(path,body,token)=>worker.fetch(new Request(origin+path,{method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})}),env,{waitUntil(){}});
  const command={action:'create',expectedRevision:0,item:entry({label:'PRIVATE TAG MARKER',citationURL:'https://example.test/private'})};for(const token of [undefined,'hunter2'])assert.equal((await call('/api/tags',command,token)).status,401);
  const savedResponse=await call('/api/tags',command,'fictional-owner');assert.equal(savedResponse.status,201);const saved=await savedResponse.json();let publicResponse=await call('/api/tags');assert.deepEqual(await publicResponse.json(),{contract:1,tags:[]});
  await call('/api/tags',{action:'visibility',expectedRevision:1,id:saved.id,status:'published'},'fictional-owner');const published=await(await call('/api/tags')).json();assert.equal(published.tags[0].id,saved.id);assert(!Object.hasOwn(published,'revision'));
  await call('/api/tags',{action:'visibility',expectedRevision:2,id:saved.id,status:'hidden'},'fictional-owner');assert.deepEqual(await(await call('/api/tags')).json(),{contract:1,tags:[]});assert.equal((await call('/api/export')).status,401);
 }finally{sqlite.close();}
});
test('plain tags have no empty disclosure and rich context is escaped, optional and accessible without script',()=>{
 const plain={id:crypto.randomUUID(),...entry({label:'Plain & simple',status:'published'})},rich={id:crypto.randomUUID(),...entry({label:'<Fictional tool>',description:'<script>plain text</script>\nA useful explanation',citationURL:'https://example.test/source?x=1&y=2',relatedLabel:'Related <work>',relatedURL:'https://example.test/work',status:'published'})},hidden={id:crypto.randomUUID(),...entry({label:'PRIVATE TAG MARKER',status:'hidden'})};
 assert.equal(publicTags({version:1,revision:0,items:[]},''),'');assert.equal(publicTags({version:1,revision:1,items:[hidden]},''),'');
 const html=publicTags({version:1,revision:3,items:[plain,rich,hidden]},'/showcase');assert.match(html,/aria-labelledby="profile-tags-title"/);assert.match(html,/<span class="profile-tag-plain">Plain &amp; simple<\/span>/);assert.equal((html.match(/<details data-profile-tag>/g)||[]).length,1);assert.match(html,/<summary>&lt;Fictional tool&gt;/);assert.match(html,/&lt;script&gt;plain text&lt;\/script&gt;/);assert.match(html,/Related &lt;work&gt;/);assert.match(html,/example.test<\/a>/);assert.match(html,/src="\/showcase\/brand\/profile-tags.js"/);assert.doesNotMatch(html,/PRIVATE TAG MARKER|<script>plain text|role="dialog"|onclick=|onmouseover=/);
});
test('actual Worker public HTML never serializes private tag context and revokes published context',async()=>{
 const{sqlite,db}=fixture();try{
  globalThis.BUILD_SHA='f'.repeat(40);globalThis.MANIFEST={id:'showcase',contract:1};const env={DB:db,OWNER_API_TOKEN:'fictional-owner',PUBLIC_ORIGIN:'https://showcase.example.test',PROVIDER_ORIGIN:'https://photos.example.test'};
  const saved=await changeTags(db,{action:'create',expectedRevision:0,item:entry({label:'PRIVATE TAG MARKER',description:'PRIVATE CONTEXT MARKER',citationURL:'https://example.test/private-reference'})});
  const home=async()=>{const r=await worker.fetch(new Request(env.PUBLIC_ORIGIN+'/'),env,{waitUntil(){}});assert.equal(r.status,200);return r.text();};let html=await home();assert.doesNotMatch(html,/PRIVATE TAG MARKER|PRIVATE CONTEXT MARKER|private-reference|data-profile-tag/);
  await changeTags(db,{action:'visibility',expectedRevision:1,id:saved.id,status:'published'});html=await home();assert.match(html,/PRIVATE TAG MARKER/);assert.match(html,/PRIVATE CONTEXT MARKER/);assert.match(html,/data-profile-tag/);
  await changeTags(db,{action:'visibility',expectedRevision:2,id:saved.id,status:'hidden'});html=await home();assert.doesNotMatch(html,/PRIVATE TAG MARKER|PRIVATE CONTEXT MARKER|private-reference|data-profile-tag/);
 }finally{sqlite.close();}
});
test('Escape closes only the active tag and returns focus to its native summary',()=>{
 const callbacks=[],summary={focused:0,focus(){this.focused++}},details={open:true,querySelector(selector){assert.equal(selector,'summary');return summary;},addEventListener(name,callback){assert.equal(name,'keydown');callbacks.push(callback);}};
 runInNewContext(readFileSync(new URL('../public/brand/profile-tags.js',import.meta.url),'utf8'),{document:{querySelectorAll(selector){assert.equal(selector,'[data-profile-tag]');return[details];}}});let prevented=0;
 callbacks[0]({key:'Tab',preventDefault(){prevented++;}});assert.equal(details.open,true);assert.equal(summary.focused,0);
 callbacks[0]({key:'Escape',preventDefault(){prevented++;}});assert.equal(details.open,false);assert.equal(summary.focused,1);assert.equal(prevented,1);
 callbacks[0]({key:'Escape',preventDefault(){prevented++;}});assert.equal(summary.focused,1);assert.equal(prevented,1);
});
