// Shares only the server-rendered published canonical URL, never an owner draft.
const copy=document.querySelector('[data-copy-profile]');
const share=document.querySelector('[data-share-profile]');
const output=document.querySelector('[data-share-status]');
const fallback=document.querySelector('[data-share-fallback]');
const canonical=document.querySelector('link[rel=canonical]')?.href;
if(copy&&canonical){
 copy.hidden=false;
 copy.addEventListener('click',async()=>{
  try{await navigator.clipboard.writeText(canonical);output.textContent='Profile link copied.';fallback.hidden=true;}
  catch{fallback.hidden=false;const input=fallback.querySelector('input');input.value=canonical;input.focus();input.select();output.textContent='Copy the selected profile URL using your browser.';}
 });
 if(typeof navigator.share==='function'){
  share.hidden=false;
  share.addEventListener('click',async()=>{
   share.disabled=true;
   try{await navigator.share({title:document.title,text:document.querySelector('meta[name=description]')?.content??'',url:canonical});output.textContent='';}
   catch(error){if(error?.name!=='AbortError')output.textContent='Sharing is unavailable here. Use Copy profile link.';}
   finally{share.disabled=false;}
  });
 }
}
