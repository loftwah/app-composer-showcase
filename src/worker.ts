import { collectResourceItem, collectionWriteProof } from "./resource-collection.ts";
import {
  providerItems,
  providerItem,
  resolveCard as resolve,
  exportCard,
  sourceSelection,
  querySource,
  SourceSelectionError,
} from "./item-provider.ts";
import {creatorProfile} from './creator-profile.ts';
import {profileConfiguration,profileFields,iconNames,decoration,presentation,decorateCards,icon,groupNames,cardLimit} from './profile.ts';
import {achievementStudio,publicAchievements} from './achievement-view.ts';
import {AchievementError,readAchievements,changeAchievements} from './achievements.ts';
import {TagError,readTags,changeTags} from './tags.ts';
import {publicTags,tagStudio} from './tag-view.ts';
import {ProfilePortabilityError,exportProfileSettings,changeProfileSettings} from './profile-portability.ts';
import {profilePortabilityStudio} from './profile-portability-view.ts';
import {health,publish,pageEvent,type PublisherEnv} from "./publisher.mjs";
import {
  authorised,
  basePath,
  client,
  commonAPI,
  configForm,
  error,
  escape,
  html,
  json,
  login,
  readJSON,
  safeURL,
  settings,
  text,
  type BaseEnv,
} from "./common.ts";
interface Env extends BaseEnv, PublisherEnv {
  ITEM_PROVIDER: Fetcher;
  PROVIDER_ORIGIN: string;
  PROVIDER_ID: string;
  PROVIDER_MOUNT: string;
  PROVIDER_BASE?: string;
  ASSETS?: Fetcher;
}
const defaults = {
  title: "Linkarooie",
  // Keep these defaults identical to app.manifest.json: Init prefills from the
  // manifest, and an unconfigured instance must render the same introduction.
  intro:
    "A small collection, chosen with care. Feature a moment from the guestbook or add something of your own.",
  bluesky: "",
  theme: "daylight",
  layout: "grid",
  ...Object.fromEntries(profileFields.map(field=>[field.key,field.default])),
};
async function styles(env:Env){
 const row=await env.DB.prepare("SELECT value FROM settings WHERE id='presentation'").first<{value:string}>();
 return row?presentation(JSON.parse(row.value)):{};
}
function styleForm(card:any){
 return `<form data-presentation-card><label>Link icon<select name="icon">${iconNames.map(name=>`<option value="${name}" ${card.icon===name?'selected':''}>${name}</option>`).join('')}</select></label><label>Link group<select name="group"><option value="">Other links</option>${groupNames.map(group=>`<option ${card.group===group?'selected':''}>${group}</option>`).join('')}</select></label><label class="profile-check"><input name="pinned" type="checkbox" ${card.pinned?'checked':''}>Feature in the top eight</label><button type="submit" class="secondary">Save link style</button><p role="status" aria-live="polite"></p></form>`;
}
const app = {
  async fetch(req: Request, env: Env): Promise<Response> {
    try {
      const u = new URL(req.url),
        base = basePath(u, "showcase"),
        path = u.pathname.slice(base.length) || "/";
      const owner = await authorised(req, env, "showcase_session");
      const common = await commonAPI(req, env, path, base, "showcase_session");
      if (common) return common;
      if(path==='/api/profile-settings'){
        if(!['GET','POST'].includes(req.method))return new Response(null,{status:405,headers:{Allow:'GET, POST','Cache-Control':'no-store'}});
        if(!owner)return error('Owner sign-in required',401);
        if(req.method==='GET')return new Response(JSON.stringify(await exportProfileSettings(env.DB,defaults)),{headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Disposition':'attachment; filename="linkarooie-profile.json"'}});
        if(req.headers.get('Origin')!==u.origin&&!req.headers.get('Authorization'))return error('Write origin is not authorised',403);
        return json(await changeProfileSettings(env.DB,await readJSON(req,65536),defaults));
      }
      if(path==='/api/tags'){
        if(req.method==='GET')return json({contract:1,tags:(await readTags(env.DB)).collection.items.filter(item=>item.status==='published')});
        if(req.method!=='POST')return new Response(null,{status:405,headers:{Allow:'GET, POST','Cache-Control':'no-store'}});
        if(!owner)return error('Owner sign-in required',401);
        if(req.headers.get('Origin')!==u.origin&&!req.headers.get('Authorization'))return error('Write origin is not authorised',403);
        const command=await readJSON(req,16384),saved=await changeTags(env.DB,command);
        return json({ok:true,...saved},command.action==='create'?201:200);
      }
      if(path==='/api/achievements'){
        if(req.method==='GET')return json({contract:1,achievements:(await readAchievements(env.DB)).collection.items.filter(item=>item.status==='published')});
        if(req.method!=='POST')return new Response(null,{status:405,headers:{Allow:'GET, POST','Cache-Control':'no-store'}});
        if(!owner)return error('Owner sign-in required',401);
        if(req.headers.get('Origin')!==u.origin&&!req.headers.get('Authorization'))return error('Write origin is not authorised',403);
        const command=await readJSON(req),saved=await changeAchievements(env.DB,command);
        return json({ok:true,...saved},command.action==='create'?201:200);
      }
      if (path === "/build.json")
        return json({
          app: "showcase",
          revision: BUILD_SHA,
          contract: 1,
          dataVersion: 1,
        });
      if (path === "/app.manifest.json") return json(MANIFEST);
      if (path === "/api/cards" && req.method === "GET") {
        const { results } = await env.DB.prepare(
          "SELECT * FROM cards WHERE status='published' ORDER BY position,id LIMIT 64",
        ).all();
        const cards = await Promise.all(
          results.map((c) => resolve(env, c).catch(() => null)),
        );
        return json({ contract: 1, cards: decorateCards(cards.filter(card=>card!==null),await styles(env)) });
      }
      if (path === "/api/provider" && req.method === "GET") {
        if (!owner) return error("Owner sign-in required", 401);
        const p = await providerItems(env, querySource(u.searchParams)).catch(() => null);
        return p
          ? json(p)
          : error("Source unavailable; no items can be featured", 503);
      }
      if (
        ["/api/cards", "/api/reorder", "/api/presentation"].includes(path) &&
        req.method === "POST"
      ) {
        if (!owner) return error("Owner sign-in required", 401);
        if (
          req.headers.get("Origin") !== u.origin &&
          !req.headers.get("Authorization")
        )
          return error("Write origin is not authorised", 403);
        const b = await readJSON(req,path==='/api/cards'?32768:8192);
        if (["resource", "configuration", "source_resource", "source_configuration"].some(key => Object.hasOwn(b,key)))
          return error("Use an explicit supported source selection.");
        const selectedSource = Object.hasOwn(b, "source")
          ? sourceSelection(b.source)
          : undefined;
        if (selectedSource && (path !== "/api/cards" || b.id || typeof b.item !== "string"))
          return error("A source reference belongs to a new contribution card only.");
        if (selectedSource) {
          const refused = collectionWriteProof(req, base, BUILD_SHA, selectedSource);
          if (refused) return refused;
        }
        if(path==='/api/presentation'){
          if(typeof b.id!=='string'||!/^[a-zA-Z0-9-]{1,64}$/.test(b.id))return error('Choose a current card.');
          const current=await env.DB.prepare("SELECT value FROM settings WHERE id='presentation'").first<{value:string}>();
          const savedStyles:Record<string,import('./profile.ts').Decoration>=current?presentation(JSON.parse(current.value)):{};
          const exists=await env.DB.prepare('SELECT id FROM cards WHERE id=?').bind(b.id).first();
          if(!exists)return error('Card no longer exists. Refresh the collection.',404);
          // Older reviewed clients may change the icon/pin without clearing its group.
          const value=decoration({pinned:b.pinned,icon:b.icon,...(b.group!==undefined?{group:b.group}:savedStyles[b.id]?.group!==undefined?{group:savedStyles[b.id].group}:{})});
          const next:Record<string,import('./profile.ts').Decoration>={...savedStyles,[b.id]:value};
          if(Object.values(next).filter(style=>style.pinned).length>8)return error('Choose up to eight featured picks. Unpin one before featuring another.',409);
          const saved=await env.DB.prepare("INSERT INTO settings(id,value) SELECT 'presentation',?1 WHERE EXISTS(SELECT 1 FROM cards WHERE id=?2) AND ((?3 IS NULL AND NOT EXISTS(SELECT 1 FROM settings WHERE id='presentation')) OR EXISTS(SELECT 1 FROM settings WHERE id='presentation' AND value=?3)) ON CONFLICT(id) DO UPDATE SET value=excluded.value WHERE settings.value=?3 RETURNING value").bind(JSON.stringify(next),b.id,current?.value??null).first();
          if(!saved){const exists=await env.DB.prepare('SELECT id FROM cards WHERE id=?').bind(b.id).first();return error(exists?'Link styles changed. Refresh and compare before saving again.':'Card no longer exists. Refresh the collection.',exists?409:404);}
          return json({ok:true,...value});
        }
        if (path === "/api/reorder") {
          if (
            !Array.isArray(b.ids) ||
            b.ids.length > cardLimit ||
            new Set(b.ids).size !== b.ids.length
          )
            return error("Supply a unique order of up to 64 cards");
          const { results } = await env.DB.prepare("SELECT id FROM cards").all<{
            id: string;
          }>();
          if (
            b.ids.length !== results.length ||
            b.ids.some((id: unknown) => !results.some((c) => c.id === id))
          )
            return error("Order must include every current card");
          await env.DB.batch(
            b.ids.map((id: string, i: number) =>
              env.DB.prepare("UPDATE cards SET position=? WHERE id=?").bind(
                i,
                id,
              ),
            ),
          );
          return json({ ok: true });
        }
        const status = ["draft", "published", "hidden"].includes(b.status)
          ? b.status
          : "draft";
        if (b.id) {
          const id = text(b.id, 64);
          const c = await env.DB.prepare("SELECT * FROM cards WHERE id=?")
            .bind(id)
            .first<any>();
          if (!c) return error("Card not found", 404);
          if (b.delete === true) {
            await env.DB.batch([
              env.DB.prepare("DELETE FROM cards WHERE id=?").bind(id),
              env.DB.prepare("UPDATE settings SET value=json_remove(value,?) WHERE id='presentation'").bind('$.'+JSON.stringify(id)),
            ]);
            return json({ ok: true });
          }
          if(b.expected!==undefined){
            const expected=b.expected;
            // A former 8 KiB raw URL can expand to at most 24 KiB in storage.
            // Compare it without truncation so the owner can repair that record.
            if(c.provider||!expected||typeof expected!=='object'||Array.isArray(expected)||Object.keys(expected).length!==4||!['title','description','url','status'].every(key=>Object.hasOwn(expected,key))||typeof expected.title!=='string'||expected.title.length>100||typeof expected.description!=='string'||expected.description.length>240||typeof expected.url!=='string'||expected.url.length>24576||!['draft','published','hidden'].includes(expected.status))return error('Use a current authored link snapshot.');
            if(typeof b.title!=='string'||!text(b.title,100)||b.title.length>100||typeof b.description!=='string'||b.description.length>240||typeof b.url!=='string'||b.url.length>2048||!['draft','published','hidden'].includes(b.status))return error('Check the link text, destination and visibility.');
            const url=safeURL(b.url);if(url.length>2048)return error('Use an HTTPS destination up to 2048 characters.');
            const saved=await env.DB.prepare('UPDATE cards SET title=?,description=?,url=?,status=? WHERE id=? AND provider IS NULL AND title=? AND description=? AND url=? AND status=? RETURNING id').bind(text(b.title,100),text(b.description,240),url,b.status,id,expected.title,expected.description,expected.url,expected.status).first();
            if(!saved)return error('This link changed or was removed. Refresh and compare before saving again.',409);
            return json({ok:true});
          }
          if (status === "published" && c.provider && !(await resolve(env, c)))
            return error("Source is no longer eligible", 409);
          if (!c.provider && b.title !== undefined && !text(b.title, 100))
            return error("Give this card a title");
          await env.DB.prepare(
            "UPDATE cards SET title=COALESCE(?,title),description=COALESCE(?,description),url=COALESCE(?,url),status=? WHERE id=?",
          )
            .bind(
              b.title === undefined ? null : text(b.title, 100),
              b.description === undefined
                ? null
                : text(b.description, 240),
              b.url === undefined ? null : safeURL(b.url),
              status,
              id,
            )
            .run();
          return json({ ok: true });
        }
        if (selectedSource)
          return collectResourceItem(env, String(b.item), selectedSource, status);
        const count = await env.DB.prepare(
          "SELECT COUNT(*) as n FROM cards",
        ).first<{ n: number }>();
        if ((count?.n ?? cardLimit) >= cardLimit)
          return error(
            "This collection has 64 cards; remove one before adding another",
            409,
          );
        let title = "",
          description = "",
          url: string | null = null,
          item: string | null = null,
          providerID: string | null = null;
        if (b.item) {
          item = text(b.item, 64);
          const p = await providerItem(env, item).catch(() => null);
          if (!p || p.visibility !== "public")
            return error(
              "Choose a currently approved public contribution",
              409,
            );
          providerID = String(p.provider);
          title = text(p.title, 160);
          description = text(p.description, 240);
        } else {
          title = text(b.title, 100);
          description = text(b.description ?? "", 240);
          url = safeURL(b.url);
          if (!title) return error("Give this card a title");
        }
        const id = crypto.randomUUID();
        const created=await env.DB.prepare(
          "INSERT INTO cards(id,title,description,url,provider,item_id,position,status) SELECT ?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM cards)<64 RETURNING id",
        )
          .bind(
            id,
            title,
            description,
            url,
            providerID,
            item,
            count?.n ?? 0,
            status,
          )
          .first();
        if(!created)return error('This collection has 64 cards; remove one before adding another',409);
        return json({ id, status }, 201);
      }
      if (path === "/api/export" && req.method === "GET") {
        if (!owner) return error("Owner sign-in required", 401);
        const achievements=await readAchievements(env.DB).then(value=>({achievementCollection:value.collection})).catch(()=>({achievementCollection:null,achievementProblem:'review_required'}));
        const tags=await readTags(env.DB).then(value=>({tagCollection:value.collection})).catch(()=>({tagCollection:null,tagProblem:'review_required'}));
        return json({
          dataVersion: 1,
          config: await settings(env, defaults),
          presentationVersion:1,
          cards: decorateCards((await Promise.all((await env.DB.prepare("SELECT * FROM cards ORDER BY position,id").all()).results.map(card => exportCard(env,card)))).filter(card=>card!==null),await styles(env),false),
          ...achievements,
          ...tags,
        });
      }
      const config = profileConfiguration(await settings(env, defaults));
      if (path === "/owner") {
        if (!owner)
          return html(
            String(config.title),
            login() + client(base, "showcase_session"),
            base,
            "showcase",
            String(config.theme),
            String(config.intro),
            env.PUBLIC_ORIGIN,
            path,
            env.PROVIDER_ORIGIN,
          );
        const { results } = await env.DB.prepare(
          "SELECT * FROM cards ORDER BY position,id LIMIT 64",
        ).all();
        const savedStyles=await styles(env);
        const achievements=await readAchievements(env.DB).then(saved=>saved.collection).catch(()=>null);
        const tags=await readTags(env.DB).then(saved=>saved.collection).catch(()=>null);
        const selectedSource = querySource(u.searchParams);
        const available = await providerItems(env, selectedSource).catch(() => null);
        const currentCards = await Promise.all(results.map(async (card) => {
          if (card.source_resource == null && card.source_configuration == null) return card;
          return await resolve(env,card).catch(() => null) ?? {...card,title:"Source unavailable",description:"",url:null};
        }));
        return html(
          String(config.title),
          `<h1>The collection studio.</h1><p>Choose, order and publish up to 64 cards. Featured contributions are checked against their source on every public request.</p><div class="row"><button id="logout" class="secondary">Sign out</button><a href="${base}/api/export">Export your collection</a></div><p role="status" class="message" aria-live="polite"></p>${configForm(config)}${profilePortabilityStudio(base)}<h2>Feature an approved moment</h2><form id="feature">${selectedSource ? `<input type="hidden" name="source" value="${escape(JSON.stringify(selectedSource))}">` : ""}<label>Source contribution<select name="item" required><option value="">Choose a moment</option>${(available?.items ?? []).map((p: any) => `<option value="${escape(p.id)}">${escape(p.title)}</option>`).join("")}</select></label><button ${available ? "" : "disabled"}>Feature publicly</button></form>${available ? "" : "<p>The source is unavailable. Existing private or unavailable items stay hidden.</p>"}<h2>Add your own card</h2><form id="manual"><label>Title<input name="title" maxlength="100" required></label><label>Description<textarea name="description" maxlength="240"></textarea></label><label>Destination<input name="url" type="url" placeholder="https://" required></label><button>Add a draft</button></form><h2>Arrange the collection</h2><div id="cards" data-base="${base}" data-source="${escape(BUILD_SHA)}" data-target="${escape(u.origin + base)}">${currentCards.map((card: any) => {const c={...card,...(savedStyles[card.id]??{pinned:false,icon:'link'})};return `<article data-card="${escape(c.id)}"><h3>${escape(c.title)}</h3><p>${escape(c.status)} · ${c.provider ? "Linked source contribution · content follows its source" : "Your authored card"}</p>${c.provider ? "" : `<details class="card-editor"><summary>Edit this link</summary><form data-edit-card data-link-snapshot="${escape(JSON.stringify({title:c.title,description:c.description,url:c.url,status:c.status}))}"><label>Card title<input name="title" maxlength="100" value="${escape(c.title)}" required></label><label>Card description<textarea name="description" maxlength="240">${escape(c.description)}</textarea></label><label>Card destination<input name="url" type="url" pattern="https://.*" value="${escape(c.url)}" required></label><p class="small">Use a public HTTPS link. Saving keeps the visibility you select below.</p><label>Visibility<select name="status">${["draft","published","hidden"].map(status=>`<option value="${status}" ${c.status===status?"selected":""}>${status}</option>`).join("")}</select></label><div class="row"><button type="submit">Save card</button><button type="button" class="secondary" data-preview-card>Preview without saving</button></div><div class="card-draft-preview" data-card-preview hidden><p class="small">Preview · not saved</p><a target="_blank" rel="noopener noreferrer"><strong></strong><span></span><small></small></a></div><p data-edit-message role="status" aria-live="polite"></p></form></details>`}${styleForm(c)}<div class="row card-actions"><button type="button" data-move="up" class="secondary">Move up</button><button type="button" data-move="down" class="secondary">Move down</button><button type="button" data-status="published" class="secondary">Publish</button><button type="button" data-status="hidden" class="secondary">Hide</button><button type="button" data-delete="true" class="secondary">Remove</button></div></article>`;}).join("")}</div>${achievementStudio(achievements)}${tagStudio(tags)}${client(base, "showcase_session")}<script type="module" src="${base}/brand/collection-studio.js"></script>`,
          base,
          "showcase",
          String(config.theme),
          String(config.intro),
          env.PUBLIC_ORIGIN,
          path,
          env.PROVIDER_ORIGIN,
        );
      }
      if (path === "/") {
        const { results } = await env.DB.prepare(
          "SELECT * FROM cards WHERE status='published' ORDER BY position,id LIMIT 64",
        ).all();
        const resolved = decorateCards((await Promise.all(results.map((c) => resolve(env,c).catch(()=>null)))).filter(card=>card!==null),await styles(env));
        const achievementSection=await readAchievements(env.DB).then(saved=>publicAchievements(saved.collection)).catch(()=>'');
        const tagSection=await readTags(env.DB).then(saved=>publicTags(saved.collection,base)).catch(()=>'');
        const profileLinks=profileFields.filter(field=>field.key!=='handle'&&!field.image&&config[field.key]).map(field=>`<a href="${escape(config[field.key])}" rel="me noopener noreferrer">${field.label}${icon('arrow')}</a>`).join('');
        const profileIdentity=config.handle?`<p class="profile-handle">@${escape(config.handle)}</p>`:'';
        const share=`<div class="profile-share"><button type="button" class="secondary" data-share-profile hidden>Share profile</button><button type="button" class="secondary" data-copy-profile hidden>Copy profile link</button><p role="status" aria-live="polite" data-share-status></p><label data-share-fallback hidden>Published profile URL<input readonly value="${escape(new URL(env.PUBLIC_ORIGIN).origin+base+'/')}"></label></div><script type="module" src="${base}/brand/profile-share.js"></script>`;
        const href=(c:any)=>c.provider&&base?(new URL(c.url).pathname.startsWith(env.PROVIDER_MOUNT+'/')?new URL(c.url).pathname:env.PROVIDER_MOUNT+new URL(c.url).pathname):c.url;
        const cardMarkup=(c:any)=>config.layout==='compact'?`<article data-gallery-item data-kind="${c.provider?'photo':'link'}"><a class="compact-link" href="${escape(href(c))}"><span class="link-symbol">${icon(c.icon)}</span><span class="compact-copy"><span class="compact-title">${escape(c.title)}</span>${c.description?`<span class="compact-description">${escape(c.description)}</span>`:''}<span class="compact-destination">${escape(new URL(c.url).hostname)}${c.pinned?' · Pinned':''}</span></span><span class="link-direction">${icon('arrow')}</span></a></article>`:`<article data-gallery-item data-kind="${c.provider?'photo':'link'}"><a href="${escape(href(c))}">${c.image?`<img src="${escape(c.image)}" alt="${escape(c.title)}" width="1200" height="900" loading="lazy">`:`<div class="link-preview"><span class="link-symbol">${icon(c.icon)}</span><strong>${escape(new URL(c.url).hostname)}</strong></div>`}<h3>${escape(c.title)}</h3></a><p>${escape(c.description)}</p><span class="badge">${c.pinned?'Pinned · ':''}${c.provider?'Live source contribution':'Curated link'}</span></article>`;
        return html(
          String(config.title),
          config.layout==='profile'?creatorProfile(config,resolved,base,share,tagSection,achievementSection,href):`<section class="collection-hero" aria-labelledby="collection-title"><div class="collection-copy"><p class="collection-kicker">Linkarooie · Curated collection</p><h1 id="collection-title">${escape(config.title)}</h1>${profileIdentity}<p class="lede">${escape(config.intro)}</p>${profileLinks?`<nav class="profile-social" aria-label="Profile links">${profileLinks}</nav>`:''}<div class="collection-actions"><a class="button" href="#collection">Explore the collection</a><a href="${base}/owner">Curate this collection</a></div><p class="collection-note">Up to eight picks, arranged by the owner.</p>${share}</div><figure><img class="collection-art" src="${base}/brand/linkarooie-art-20261018-960.webp" srcset="${base}/brand/linkarooie-art-20261018-480.webp 480w, ${base}/brand/linkarooie-art-20261018-960.webp 960w" sizes="(max-width: 820px) calc(100vw - 40px), (max-width: 1248px) 50vw, 584px" width="960" height="960" fetchpriority="high" alt="A lime kangaroo selects an orange cassette beside a handheld game and notebook in a purple workshop."><figcaption>Original illustration for Linkarooie. The collection below holds the published links and moments.</figcaption></figure></section>${tagSection}<section class="collection-section" id="collection" aria-labelledby="picks-title"><div class="collection-heading"><h2 id="picks-title">Worth a closer look</h2>${resolved.length ? "<p>Follow a link. Open a moment.</p>" : ""}</div>${resolved.length > 1 ? `<div class="gallery-controls"><label>Find in this collection<input id="gallery-search" type="search" placeholder="Caption, title or alias" autocomplete="off"></label><label>Show<select id="gallery-type" aria-label="Show"><option value="">Photos and links</option><option value="photo">Photos</option><option value="link">Links</option></select></label></div><p id="gallery-count" class="small" role="status" aria-live="polite"></p><p id="gallery-empty" class="gallery-empty" hidden>No items match. Try another search or show photos and links.</p>` : ""}<div class="gallery ${escape(config.layout)}">${resolved.map(cardMarkup).join("") || '<div class="collection-empty"><h3>No published links yet</h3><p>The owner can publish a link or feature an approved photo. Draft and unavailable items stay out of this collection.</p></div>'}</div></section>${achievementSection}<aside class="collection-context"><p>A reading list, a tiny portfolio or the eight things you keep recommending. Links are chosen here; photos come from <a href="${base ? "/guestbook/" : "https://guestbook.loftwah.com/"}">Here / there</a> and remain subject to its current approval.</p></aside>`,
          base,
          "showcase",
          String(config.theme),
          String(config.intro),
          env.PUBLIC_ORIGIN,
          path,
          env.PROVIDER_ORIGIN,
          config,
        );
      }
      if (env.ASSETS)
        return env.ASSETS.fetch(new Request(u.origin + path, req));
      return error("Page not found", 404);
    } catch (e) {
      if(e instanceof SourceSelectionError)return error(e.message,400);
      if(e instanceof AchievementError||e instanceof TagError||e instanceof ProfilePortabilityError)return error(e.message,e.status);
      return error(e instanceof Error ? e.message : "Request failed", 400);
    }
  },
} satisfies ExportedHandler<Env>;
declare const BUILD_SHA: string;
declare const MANIFEST: unknown;

export default {async fetch(req:Request,env:Env,context:ExecutionContext){
 const base=basePath(new URL(req.url),"showcase");
 const probe=health(req,base+'/healthz',"showcase",BUILD_SHA);if(probe)return probe;
 const response=await app.fetch(req,env);const event=pageEvent(req,response,base);
 if(event)publish(env,context,req,event);return response;
}} satisfies ExportedHandler<Env>;
