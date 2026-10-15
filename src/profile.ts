// Profile/link presentation adapted from Linkarooie 3's typed shape and Rails
// pinning semantics. Values are data; no legacy modules, trackers or hidden DOM.
export const profileFields = [
  {key:'handle',label:'Handle',maxLength:40,default:''},
  {key:'website',label:'Website',maxLength:2048,default:''},
  {key:'github',label:'GitHub',maxLength:2048,default:''},
  {key:'bluesky',label:'Bluesky',maxLength:2048,default:''},
  {key:'linkedin',label:'LinkedIn',maxLength:2048,default:''},
] as const;
export const iconNames = ['link','book','code','music','video','heart'] as const;
export type LinkIcon = typeof iconNames[number];
export type Decoration = {pinned:boolean;icon:LinkIcon};
export const defaultDecoration:Decoration = {pinned:false,icon:'link'};
const hosts:Record<string,string[]>={github:['github.com'],bluesky:['bsky.app'],linkedin:['linkedin.com','www.linkedin.com']};
export function profileConfiguration(input:Record<string,unknown>,previous:Record<string,unknown>={}) {
  const result:Record<string,unknown>={...previous};
  for(const [key,max] of [['title',80],['intro',240]] as const){
    const value=input[key];
    if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))throw Error('Check the '+key+' text.');
    result[key]=value.trim();
  }
  if(!result.title)throw Error('Give your profile a title.');
  if(typeof input.theme!=='string'||!['daylight','midnight'].includes(input.theme))throw Error('Choose a supported theme.');
  if(typeof input.layout!=='string'||!['grid','editorial','compact'].includes(input.layout))throw Error('Choose a supported layout.');
  result.theme=input.theme;result.layout=input.layout;
  for(const field of profileFields){
    if(!Object.hasOwn(input,field.key))continue; // Older settings clients preserve these fields.
    const raw=input[field.key];
    if(typeof raw!=='string'||raw.length>field.maxLength||/[\u0000-\u001f]/.test(raw))throw Error('Check your '+field.label+' value.');
    const value=raw.trim();
    if(field.key==='handle'){
      if(value&&!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,39}$/.test(value))throw Error('Use letters, numbers, dots, underscores or hyphens for the handle.');
      result[field.key]=value;
    }else{
      if(!value){result[field.key]='';continue;}
      let url:URL;try{url=new URL(value);}catch{throw Error('Use a full HTTPS address for '+field.label+'.');}
      if(url.protocol!=='https:'||url.username||url.password||hosts[field.key]&&!hosts[field.key].includes(url.hostname))throw Error('Use an HTTPS '+field.label+' address without embedded credentials.');
      result[field.key]=url.href;
    }
  }
  return result;
}
export function decoration(input:unknown):Decoration {
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Choose a supported link style.');
  const value=input as Record<string,unknown>;
  if(typeof value.pinned!=='boolean'||!iconNames.includes(value.icon as LinkIcon)||Object.keys(value).some(key=>!['pinned','icon'].includes(key)))throw Error('Choose a supported link style.');
  return {pinned:value.pinned,icon:value.icon as LinkIcon};
}
export function presentation(input:unknown):Record<string,Decoration> {
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length>8)throw Error('The saved link styles need owner review.');
  return Object.fromEntries(Object.entries(input).map(([id,value])=>{
    if(!/^[a-zA-Z0-9-]{1,64}$/.test(id))throw Error('The saved link styles need owner review.');
    return [id,decoration(value)];
  }));
}
export function decorateCards<T extends {id:string}>(cards:T[],styles:Record<string,Decoration>,sort=true) {
  // Stable sort preserves the owner's position/id order inside either group.
  const decorated=cards.map(card=>({...card,...(styles[card.id]??defaultDecoration)}));
  return sort?decorated.sort((a,b)=>Number(b.pinned)-Number(a.pinned)):decorated;
}
// Original functional vector geometry; fixed paths, never imported SVG/markup.
export function icon(name:string) {
 const paths:Record<string,string>={
  link:'<path d="m10 13 4-4m-6 7-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 1 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0"/>',
  book:'<path d="M12 6c-3-2-6-2-9-1v14c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1Zm0 0v14"/>',
  code:'<path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18"/>',
  music:'<path d="M9 18V5l12-2v13M9 9l12-2"/><ellipse cx="6" cy="18" rx="3" ry="3"/><ellipse cx="18" cy="16" rx="3" ry="3"/>',
  video:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3Z"/>',
  heart:'<path d="M20 5a5 5 0 0 0-8 1 5 5 0 0 0-8-1C-1 10 7 16 12 21c5-5 13-11 8-16Z"/>',
  pin:'<path d="m16 3 5 5-4 2-3 5-2 2-5-5 2-2 5-3Zm-6 13-6 6"/>',
  arrow:'<path d="M7 17 17 7M7 7h10v10"/>',
 };
 return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]??paths.link}</svg>`;
}
