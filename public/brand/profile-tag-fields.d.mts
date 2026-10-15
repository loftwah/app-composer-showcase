export type TagValues={label:string;description:string;citationLabel:string;citationURL:string;relatedLabel:string;relatedURL:string;status:'draft'|'published'|'hidden'};
export type ProfileTag=TagValues&{id:string};
export type TagCollection={version:1;revision:number;items:ProfileTag[]};
export const tagKeys:(keyof TagValues)[];
export const tagLimit:number;
export function blankTag():TagValues;
export class TagFieldError extends Error{field:string;constructor(field:string,message:string);}
export function exactTagObject(value:unknown,keys:string[]):value is Record<string,unknown>;
export function tagValues(item:TagValues):TagValues;
export function sameTag(a:TagValues|undefined|null,b:TagValues|undefined|null):boolean;
export function tagFields(input:unknown):TagValues;
export function tagHasContext(tag:TagValues):boolean;
export function tagCollection(value:unknown):TagCollection;
