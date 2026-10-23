// MIT. App-owned release check: public HTML and image responses, never credentials or private records.
import assert from 'node:assert/strict';
import {imageDimensions} from '../public/brand/share-image.mjs';
export {imageDimensions};

// The page may declare the card format, width and height, or configure its own
// HTTPS share image of unknown format. Both are acceptable; a claim that does
// not match the bytes is not. Declaring all three is verified exactly, omitting
// them still requires a real raster image of at least 1200x630.
export function sharingMetadata(html){
 const tags=new Map();
 for(const [tag]of html.matchAll(/<meta\s+[^>]*>/gi)){
  const attributes=Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(([,key,a,b])=>[key.toLowerCase(),a??b]));
  const key=attributes.name??attributes.property;if(!key)continue;
  assert(!tags.has(key),'Duplicate sharing metadata: '+key);tags.set(key,attributes.content);
 }
 const title=html.match(/<title>([^<]+)<\/title>/i)?.[1];assert(title?.trim(),'Missing page title');
 const description=tags.get('description');assert(description?.trim(),'Missing description');
 for(const key of ['og:title','twitter:title'])assert.equal(tags.get(key),title,'Title differs: '+key);
 for(const key of ['og:description','twitter:description'])assert.equal(tags.get(key),description,'Description differs: '+key);
 assert.equal(tags.get('twitter:card'),'summary_large_image');
 assert.equal(tags.get('twitter:image'),tags.get('og:image'));
 for(const key of ['og:image:alt','twitter:image:alt'])assert(tags.get(key)?.trim(),'Missing image text: '+key);
 const type=tags.get('og:image:type'),declaredWidth=tags.get('og:image:width'),declaredHeight=tags.get('og:image:height');
 const declaredCount=[type,declaredWidth,declaredHeight].filter(value=>value!==undefined).length;
 assert(declaredCount===0||declaredCount===3,'Declare og:image type, width and height together or not at all');
 if(declaredCount===3){
  assert(['image/png','image/jpeg','image/webp'].includes(type),'Unsupported declared image type');
  assert(/^[1-9][0-9]*$/.test(declaredWidth)&&/^[1-9][0-9]*$/.test(declaredHeight),'Declare whole positive dimensions');
  assert(Number(declaredWidth)>=1200&&Number(declaredHeight)>=630,'Declared image dimensions missing or too small');
 }
 return{title,description,image:tags.get('og:image'),type,declared:declaredCount===3,width:Number(declaredWidth),height:Number(declaredHeight)};
}
export function jpegDimensions(bytes){const dimensions=imageDimensions(bytes);assert.equal(dimensions.format,'image/jpeg','Invalid JPEG');return dimensions;}
async function readPublic(url,request){
 const response=await request(url,{redirect:'manual',signal:AbortSignal.timeout(10000),headers:{'User-Agent':'Twitterbot/1.0','X-Composer-Verification':'1'}});
 assert.equal(response.status,200,'Public sharing response unavailable: '+url);assert(!response.headers.get('cf-mitigated'),'Sharing probe challenged');
 const chunks=[];let size=0;const reader=response.body.getReader();try{for(;;){const{done,value}=await reader.read();if(done)break;size+=value.length;assert(size<=5*1024**2,'Sharing response too large');chunks.push(value);}}finally{await reader.cancel();}
 return{response,bytes:Buffer.concat(chunks)};
}
export async function verifySharing(value,request=fetch){
 const origin=new URL(value);assert(origin.protocol==='https:'&&!origin.username&&!origin.password&&origin.pathname==='/'&&!origin.search&&!origin.hash,'Select the verified public HTTPS origin');
 const page=await readPublic(origin,request);assert.match(page.response.headers.get('content-type')??'',/^text\/html/);
 const metadata=sharingMetadata(page.bytes.toString()),image=new URL(metadata.image);assert(image.protocol==='https:'&&image.origin===origin.origin&&!image.username&&!image.password,'Sharing image must stay at the verified public origin');
 const asset=await readPublic(image,request);
 const served=(asset.response.headers.get('content-type')??'').split(';')[0].trim();
 assert(['image/jpeg','image/png','image/webp'].includes(served),'Sharing image must be a JPEG, PNG or WebP');
 const dimensions=imageDimensions(asset.bytes);
 assert(dimensions.format===served,'Sharing image bytes disagree with the served content type');
 assert(dimensions.width>=1200&&dimensions.height>=630,'Sharing image is smaller than the 1200x630 card');
 if(metadata.declared){assert.equal(metadata.type,served,'Declared image type disagrees with the response and bytes');assert.equal(dimensions.width,metadata.width);assert.equal(dimensions.height,metadata.height);}
 const result={origin:origin.origin,title:metadata.title,image:image.href,imageBytes:asset.bytes.length,declared:metadata.declared,format:dimensions.format,width:dimensions.width,height:dimensions.height,probe:'Twitterbot/1.0',actualXRenderingVerified:false};console.log(JSON.stringify(result));return result;
}
