import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {profileConfiguration,decoration,presentation,decorateCards,icon} from '../src/profile.ts';
import worker from '../src/worker.ts';
const cfg={title:'Fictional garden',intro:'Public fictional notes',theme:'midnight',layout:'compact',handle:'garden.studio',website:'https://example.test/',github:'https://github.com/example',bluesky:'',linkedin:''};
const database=()=>{
 const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync(new URL('../migrations/0001.sql',import.meta.url),'utf8'));
 const statement=(sql,values=[])=>({bind(...next){return statement(sql,next)},async first(){return sqlite.prepare(sql).get(...values)??null},async all(){return {results:sqlite.prepare(sql).all(...values)}},async run(){sqlite.prepare(sql).run(...values);return {success:true}}});
 return {sqlite,DB:{prepare:statement,async batch(list){sqlite.exec('BEGIN');try{const results=[];for(const item of list)results.push(await item.run());sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}}}};
};
function fixture(){const db=database();globalThis.BUILD_SHA='f'.repeat(40);globalThis.MANIFEST={id:'showcase',contract:1};const env={DB:db.DB,OWNER_API_TOKEN:'fictional-owner',PUBLIC_ORIGIN:'https://showcase.example.test',PROVIDER_ORIGIN:'https://photos.example.test',PROVIDER_ID:'guestbook',PROVIDER_MOUNT:'/guestbook',ITEM_PROVIDER:{async fetch(){return new Response(JSON.stringify({contract:1,provider:'guestbook',items:[]}));}}};const request=(path,body,auth=true,origin='https://showcase.example.test')=>worker.fetch(new Request('https://showcase.example.test'+path,{method:body?'POST':'GET',headers:{...(auth?{Authorization:'Bearer fictional-owner'}:{}),Origin:origin,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),env,{waitUntil(){}});return {...db,env,request};}
test('profile validates safe social identities and older clients preserve authored optional fields',()=>{
 const previous={...cfg,ownerExtension:'retained'};assert.deepEqual(profileConfiguration(cfg,previous),previous);
 const legacy={title:'Changed name',intro:'Changed bio',theme:'daylight',layout:'grid'};const next=profileConfiguration(legacy,previous);assert.equal(next.handle,cfg.handle);assert.equal(next.github,cfg.github);assert.equal(next.ownerExtension,'retained');assert.equal(next.title,'Changed name');assert.equal(profileConfiguration({...cfg,github:''}).github,'');
 for(const patch of [{handle:'<script>'},{github:'https://example.test/spoof'},{website:'javascript:alert(1)'},{website:'https://user:password@example.test'},{linkedin:'https://linkedin.com.evil.test/'},{theme:['midnight']},{layout:['compact']},{website:17},{website:'https://example.test/'+ 'é'.repeat(600)}])assert.throws(()=>profileConfiguration({...cfg,...patch}));
});
test('bounded decorations are escaped fixed icons and stable pinned-first order preserves authored positions',()=>{
 const cards=[{id:'one',position:0},{id:'two',position:1},{id:'three',position:2}];const styles=presentation({two:{pinned:true,icon:'book'},three:{pinned:true,icon:'code'}});assert.deepEqual(decorateCards(cards,styles).map(c=>c.id),['two','three','one']);assert.deepEqual(decorateCards(cards,styles,false).map(c=>c.id),['one','two','three']);assert.deepEqual(cards.map(c=>c.id),['one','two','three']);assert.match(icon('<script>'),/<svg/);assert.doesNotMatch(icon('<script>'),/<script>/);for(const value of [{pinned:'true',icon:'link'},{pinned:false,icon:'<svg onload=evil()>'},{pinned:false,icon:'link',html:'unsafe'}])assert.throws(()=>decoration(value));assert.throws(()=>presentation({'bad.path':{pinned:false,icon:'link'}}));
});
test('real SQLite API stores profile/style independently, rejects unauthorised writes and excludes hidden cards',async()=>{
 const f=fixture();try{
  assert.equal((await f.request('/api/config',cfg)).status,200);
  const first=await (await f.request('/api/cards',{title:'Ordinary fictional link',description:'Reading',url:'https://example.test/one',status:'published'})).json();
  const second=await (await f.request('/api/cards',{title:'Pinned fictional link',description:'Notes',url:'https://example.test/two',status:'published'})).json();
  const hidden=await (await f.request('/api/cards',{title:'Private secret title',description:'Private',url:'https://example.test/private',status:'draft'})).json();
  const raw=()=>JSON.stringify(f.sqlite.prepare('SELECT * FROM cards ORDER BY position').all());const before=raw();
  assert.equal((await f.request('/api/presentation',{id:second.id,pinned:true,icon:'book'},false)).status,401);
  assert.equal((await f.request('/api/presentation',{id:'unknown',pinned:true,icon:'book'})).status,404);
  assert.equal((await f.request('/api/presentation',{id:second.id,pinned:'true',icon:'book'})).status,400);
  assert.equal((await f.request('/api/presentation',{id:second.id,pinned:true,icon:'book'})).status,200);
  assert.equal((await f.request('/api/presentation',{id:hidden.id,pinned:true,icon:'heart'})).status,200);
  assert.equal(raw(),before);
  const publicCards=await (await f.request('/api/cards',null,false)).json();assert.deepEqual(publicCards.cards.map(c=>c.id),[second.id,first.id]);assert.equal(publicCards.cards[0].icon,'book');
  const html=await (await f.request('/',null,false)).text();assert.match(html,/@garden.studio/);assert.match(html,/aria-label="Profile links"/);assert.match(html,/compact-link/);assert.doesNotMatch(html,/Private secret title|example.test\/private/);assert.match(html,/data-copy-profile hidden/);
  const owner=await (await f.request('/api/export')).json();assert.deepEqual(owner.cards.map(c=>c.id),[first.id,second.id,hidden.id]);
  await f.request('/api/cards',{id:second.id,delete:true});assert.equal(f.sqlite.prepare("SELECT value FROM settings WHERE id='presentation'").get().value.includes(second.id),false);
 }finally{f.sqlite.close();}
});
test('cookie-origin enforcement and malformed saved styles preserve all rows',async()=>{
 const f=fixture();try{
  await f.request('/api/config',cfg);const card=await (await f.request('/api/cards',{title:'Fictional card',url:'https://example.test/',status:'draft'})).json();
  f.sqlite.prepare("INSERT INTO settings VALUES('presentation','{invalid')").run();const before=f.sqlite.prepare('SELECT * FROM cards').all();
  const res=await f.request('/api/presentation',{id:card.id,pinned:true,icon:'link'});assert.equal(res.status,400);assert.equal(f.sqlite.prepare("SELECT value FROM settings WHERE id='presentation'").get().value,'{invalid');assert.deepEqual(f.sqlite.prepare('SELECT * FROM cards').all(),before);
  const rejected=await worker.fetch(new Request('https://showcase.example.test/api/presentation',{method:'POST',headers:{Origin:'https://other.example.test','Content-Type':'application/json'},body:JSON.stringify({id:card.id,pinned:true,icon:'book'})}),f.env,{waitUntil(){}});assert.equal(rejected.status,403);assert.deepEqual(f.sqlite.prepare('SELECT * FROM cards').all(),before);
 }finally{f.sqlite.close();}
});
test('pinned provider cards still disappear after source revocation, including public JSON and compact HTML',async()=>{
 const f=fixture();try{
  let visible=true;f.env.ITEM_PROVIDER.fetch=async()=>new Response(JSON.stringify({contract:1,provider:'guestbook',id:'photo',visibility:visible?'public':'private',title:'Fictional public photo',description:'Published source',url:'https://photos.example.test/item/photo',image:'https://photos.example.test/media/photo'}));
  await f.request('/api/config',cfg);const c=await (await f.request('/api/cards',{item:'photo',status:'published'})).json();await f.request('/api/presentation',{id:c.id,pinned:true,icon:'heart'});
  assert.equal((await (await f.request('/api/cards',null,false)).json()).cards.length,1);visible=false;assert.equal((await (await f.request('/api/cards',null,false)).json()).cards.length,0);assert.doesNotMatch(await (await f.request('/',null,false)).text(),/Fictional public photo|media\/photo/);
 }finally{f.sqlite.close();}
});

test('concurrent removal cannot recreate orphan presentation or disable a full collection',async()=>{
 const f=fixture();try{
  const ids=[];for(let i=0;i<8;i++){const value=await(await f.request('/api/cards',{title:'Fictional '+i,url:'https://example.test/'+i,status:'published'})).json();ids.push(value.id);await f.request('/api/presentation',{id:value.id,pinned:false,icon:'link'});}
  let started,release;const paused=new Promise(resolve=>started=resolve),gate=new Promise(resolve=>release=resolve);const prepare=f.DB.prepare;
  f.DB.prepare=sql=>{const statement=prepare(sql);if(sql.startsWith('INSERT INTO settings(id,value)')&&sql.includes('presentation')){const bind=statement.bind;statement.bind=(...values)=>{const bound=bind(...values),first=bound.first;bound.first=async()=>{started();await gate;return first();};return bound;};}return statement;};
  const pending=f.request('/api/presentation',{id:ids[0],pinned:true,icon:'book'});await paused;
  assert.equal((await f.request('/api/cards',{id:ids[0],delete:true})).status,200);release();assert.equal((await pending).status,404);f.DB.prepare=prepare;
  const replacement=await(await f.request('/api/cards',{title:'Replacement fictional link',url:'https://example.test/replacement',status:'published'})).json();assert.equal((await f.request('/api/presentation',{id:replacement.id,pinned:true,icon:'heart'})).status,200);
  const styles=JSON.parse(f.sqlite.prepare("SELECT value FROM settings WHERE id='presentation'").get().value);assert.equal(Object.keys(styles).length,8);assert.equal(Object.hasOwn(styles,ids[0]),false);assert.equal((await f.request('/api/cards',null,false)).status,200);assert.equal((await f.request('/',null,false)).status,200);assert.equal((await f.request('/api/export')).status,200);
 }finally{f.sqlite.close();}
});

test('the bounded configuration API accepts all four maximum-sized canonical social links',async()=>{
 const f=fixture();try{
  const long=base=>base+'x'.repeat(2048-base.length);const input={...cfg,website:long('https://example.test/'),github:long('https://github.com/'),bluesky:long('https://bsky.app/'),linkedin:long('https://linkedin.com/')};
  assert(JSON.stringify(input).length>8192);const res=await f.request('/api/config',input);assert.equal(res.status,200);const body=await res.json();assert.equal(body.config.linkedin.length,2048);assert.equal((await f.request('/',null,false)).status,200);
 }finally{f.sqlite.close();}
});

test('guarded manual-link edits atomically preserve a concurrent visibility change',async()=>{
 const f=fixture();try{
  const expected={title:'Fictional original',description:'Original note',url:'https://example.test/original',status:'published'};
  const card=await(await f.request('/api/cards',expected)).json();
  const update={id:card.id,title:'Fictional edited',description:'Edited note',url:'https://example.test/edited',status:'published',expected};
  await f.request('/api/cards',{id:card.id,status:'hidden'});
  assert.equal((await f.request('/api/cards',update)).status,409);
  assert.equal(f.sqlite.prepare('SELECT status FROM cards WHERE id=?').get(card.id).status,'hidden');
  update.expected={...expected,status:'hidden'};update.status='draft';
  assert.equal((await f.request('/api/cards',update)).status,200);
  assert.equal(f.sqlite.prepare('SELECT status FROM cards WHERE id=?').get(card.id).status,'draft');
  let started,release;const paused=new Promise(resolve=>started=resolve),gate=new Promise(resolve=>release=resolve),prepare=f.DB.prepare;
  f.DB.prepare=sql=>{const statement=prepare(sql);if(sql.startsWith('UPDATE cards SET')&&sql.includes('RETURNING')){const bind=statement.bind;statement.bind=(...values)=>{const bound=bind(...values),first=bound.first;bound.first=async()=>{started();await gate;return first();};return bound;};}return statement;};
  const pending=f.request('/api/cards',{...update,expected:{title:update.title,description:update.description,url:update.url,status:'draft'},status:'published'});
  await paused;await f.request('/api/cards',{id:card.id,status:'hidden'});release();assert.equal((await pending).status,409);
  assert.equal(f.sqlite.prepare('SELECT status FROM cards WHERE id=?').get(card.id).status,'hidden');
 }finally{f.sqlite.close();}
});

test('guarded edits refuse source-owned records and malformed compare data without changing cards',async()=>{
 const f=fixture();try{
  f.sqlite.prepare('INSERT INTO cards(id,title,description,url,provider,item_id,position,status) VALUES(?,?,?,?,?,?,?,?)').run('photo-card','Source title','Source description','https://photos.example.test/item/photo','guestbook','photo',0,'hidden');
  const before=JSON.stringify(f.sqlite.prepare('SELECT * FROM cards').all());
  const expected={title:'Source title',description:'Source description',url:'https://photos.example.test/item/photo',status:'hidden'};
  assert.equal((await f.request('/api/cards',{id:'photo-card',title:'Overwrite',description:'',url:'https://example.test/',status:'draft',expected})).status,400);
  const card=await(await f.request('/api/cards',{title:'Fictional',description:'',url:'https://example.test/',status:'draft'})).json();
  for(const compare of [null,[],{title:'Fictional'}, {...expected,extra:'unsafe'}])assert.equal((await f.request('/api/cards',{id:card.id,title:'Changed',description:'',url:'https://example.test/',status:'draft',expected:compare})).status,400);
  assert.equal(JSON.stringify(f.sqlite.prepare('SELECT * FROM cards WHERE id=?').all('photo-card')),before);
 }finally{f.sqlite.close();}
});

test('canonical URL bounds reject future oversized writes while guarded edits can repair legacy stored URLs',async()=>{
 const f=fixture();try{
  const raw='https://example.test/'+'é'.repeat(600),legacy=new URL(raw).href;
  assert(legacy.length>2048);assert.equal((await f.request('/api/cards',{title:'Fictional',description:'',url:raw,status:'draft'})).status,400);
  const expected={title:'Fictional legacy',description:'Repairable',url:legacy,status:'hidden'};
  f.sqlite.prepare('INSERT INTO cards(id,title,description,url,position,status) VALUES(?,?,?,?,?,?)').run('legacy',expected.title,expected.description,expected.url,0,expected.status);
  assert.equal((await f.request('/api/cards',{id:'legacy',title:expected.title,description:expected.description,url:'https://example.test/repaired',status:'hidden',expected})).status,200);
  assert.equal(f.sqlite.prepare('SELECT url FROM cards WHERE id=?').get('legacy').url,'https://example.test/repaired');
  assert.equal((await f.request('/api/cards',{id:'legacy',url:raw,status:'hidden'})).status,400);
  const huge='https://example.test/'+'x'.repeat(24000),large={...expected,url:huge};f.sqlite.prepare('UPDATE cards SET url=? WHERE id=?').run(huge,'legacy');assert(JSON.stringify(large).length>8192);
  assert.equal((await f.request('/api/cards',{id:'legacy',title:expected.title,description:expected.description,url:'https://example.test/short',status:'hidden',expected:large})).status,200);
 }finally{f.sqlite.close();}
});

test('owner edit snapshots preserve exact line endings and keep authored HTML inert',async()=>{
 const f=fixture();try{
  const expected={title:'Fictional <img src=x onerror=alert(1)>',description:'First\r\nSecond & "quoted" <script>unsafe()</script>',url:'https://example.test/exact',status:'hidden'};
  assert.equal((await f.request('/api/cards',expected)).status,201);
  const owner=await(await f.request('/owner')).text(),attribute=owner.match(/data-link-snapshot="([^"]*)"/);
  assert(attribute);assert.doesNotMatch(attribute[1],/[<>]/);
  const decoded=attribute[1].replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
  assert.deepEqual(JSON.parse(decoded),expected);
  const anonymous=await(await f.request('/owner',null,false)).text();assert.doesNotMatch(anonymous,/data-link-snapshot|Fictional &lt;img/);
 }finally{f.sqlite.close();}
});

test('a status-only legacy update cannot overwrite a newer guarded content edit',async()=>{
 const f=fixture();try{
  const expected={title:'Fictional original',description:'Original note',url:'https://example.test/original',status:'published'};
  const card=await(await f.request('/api/cards',expected)).json();
  let started,release;const paused=new Promise(resolve=>started=resolve),gate=new Promise(resolve=>release=resolve),prepare=f.DB.prepare;
  f.DB.prepare=sql=>{
   const statement=prepare(sql);
   if(sql.startsWith('UPDATE cards SET')&&!sql.includes('RETURNING')){
    const bind=statement.bind;statement.bind=(...values)=>{const bound=bind(...values),run=bound.run;bound.run=async()=>{started();await gate;return run();};return bound;};
   }
   return statement;
  };
  const hiding=f.request('/api/cards',{id:card.id,status:'hidden'});await paused;
  const edited={id:card.id,title:'Fictional newer edit',description:'Keep this newer note',url:'https://example.test/newer',status:'published',expected};
  assert.equal((await f.request('/api/cards',edited)).status,200);
  release();assert.equal((await hiding).status,200);
  const saved=f.sqlite.prepare('SELECT * FROM cards WHERE id=?').get(card.id);
  assert.equal(saved.title,edited.title);assert.equal(saved.description,edited.description);assert.equal(saved.url,edited.url);assert.equal(saved.status,'hidden');
 }finally{f.sqlite.close();}
});
