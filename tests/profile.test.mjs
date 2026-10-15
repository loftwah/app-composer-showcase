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
 for(const patch of [{handle:'<script>'},{github:'https://example.test/spoof'},{website:'javascript:alert(1)'},{website:'https://user:password@example.test'},{linkedin:'https://linkedin.com.evil.test/'},{theme:['midnight']},{layout:['compact']},{website:17}])assert.throws(()=>profileConfiguration({...cfg,...patch}));
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
