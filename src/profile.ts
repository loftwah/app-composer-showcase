// Profile/link presentation adapted from Linkarooie 3's typed shape and Rails
// pinning semantics. Values are data; no legacy modules, trackers or hidden DOM.
export {profileFields,profileConfiguration} from '../public/brand/profile-settings-fields.mjs';
export const iconNames = ['link','book','code','music','video','heart'] as const;
export type LinkIcon = typeof iconNames[number];
export type Decoration = {pinned:boolean;icon:LinkIcon};
export const defaultDecoration:Decoration = {pinned:false,icon:'link'};
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
