import { createClient } from '@supabase/supabase-js';
import { createHash, randomBytes } from 'node:crypto';
const URL=process.env.SUPABASE_URL, SVC=process.env.SUPABASE_SERVICE_ROLE_KEY, ANON=process.env.SUPABASE_ANON_KEY;
const svc=createClient(URL,SVC,{auth:{persistSession:false}});
const RUN='stg-'+Date.now().toString(36);
let pass=0,fail=0;
const ok=m=>{pass++;console.log('  PASS  '+m)};
const bad=(m,d)=>{fail++;console.error('  FAIL  '+m+(d?' — '+d:''))};
async function asUser(email,pw){const c=createClient(URL,ANON,{auth:{persistSession:false}});
  const {data,error}=await c.auth.signInWithPassword({email,password:pw});
  if(error) throw new Error(email+': '+error.message); return {c,id:data.user.id};}

// A tiny, valid PNG — real bytes, so MIME sniffing and size are meaningful.
const PNG=Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000100ffff03000006000557bfabd40000000049454e44ae426082','hex');
const SHA=createHash('sha256').update(PNG).digest('hex');

console.log('\nSupabase Storage — end-to-end proof on Staging\nrun '+RUN+'\n');
const {c:insp,id:inspId}=await asUser('qa.inspector@nexpec.test','NexpecQA!2026');
const {c:other}=await asUser('qa.supplier@nexpec.test','NexpecQA!2026');
const anon=createClient(URL,ANON,{auth:{persistSession:false}});
const key=`${inspId}/${RUN}.png`;

// 1. upload as the owning user
const up=await insp.storage.from('inspector_certificates').upload(key,PNG,{contentType:'image/png'});
if(up.error) bad('inspector uploads own certificate',up.error.message);
else ok('inspector uploaded to inspector_certificates');

// 2. metadata: size + mime must be real, not assumed
const {data:list}=await svc.storage.from('inspector_certificates').list(inspId,{search:RUN+'.png'});
const meta=(list||[])[0];
if(meta && meta.metadata?.size===PNG.length && meta.metadata?.mimetype==='image/png')
  ok(`metadata truthful — size=${meta.metadata.size}B mime=${meta.metadata.mimetype}`);
else bad('metadata',JSON.stringify(meta?.metadata));

// 3. signed download + byte-for-byte hash
const {data:sig}=await insp.storage.from('inspector_certificates').createSignedUrl(key,60);
if(sig?.signedUrl){
  const r=await fetch(sig.signedUrl); const buf=Buffer.from(await r.arrayBuffer());
  if(r.status===200 && createHash('sha256').update(buf).digest('hex')===SHA)
    ok('signed download returned byte-identical content (sha256 match)');
  else bad('signed download',`http=${r.status} bytes=${buf.length}`);
}else bad('createSignedUrl','no url');

// 4. isolation — another supplier and anon must NOT read it
const o=await other.storage.from('inspector_certificates').download(key);
if(o.error) ok('cross-user read refused — '+String(o.error.message).slice(0,50));
else bad('CROSS-USER READ ALLOWED','another role downloaded a private certificate');
const a=await anon.storage.from('inspector_certificates').download(key);
if(a.error) ok('anonymous read refused — '+String(a.error.message).slice(0,50));
else bad('ANONYMOUS READ ALLOWED','private bucket served an anonymous caller');

// 5. expired signed URL must stop working
const {data:sh}=await insp.storage.from('inspector_certificates').createSignedUrl(key,1);
if(sh?.signedUrl){ await new Promise(r=>setTimeout(r,2500));
  const r2=await fetch(sh.signedUrl);
  if(r2.status>=400) ok(`expired signed URL refused (http ${r2.status})`);
  else bad('EXPIRED URL STILL SERVED',`http ${r2.status}`);
}

// 6. MIME allowlist must reject a disallowed type
const evil=await insp.storage.from('inspector_certificates')
  .upload(`${inspId}/${RUN}.exe`,Buffer.from('MZ'),{contentType:'application/x-msdownload'});
if(evil.error) ok('disallowed MIME rejected — '+String(evil.error.message).slice(0,50));
else {bad('DISALLOWED MIME ACCEPTED'); await svc.storage.from('inspector_certificates').remove([`${inspId}/${RUN}.exe`]);}

// 7. cleanup, then prove it is really gone
await insp.storage.from('inspector_certificates').remove([key]);
const {data:after}=await svc.storage.from('inspector_certificates').list(inspId,{search:RUN+'.png'});
if(!(after||[]).length) ok('test object deleted — no QA residue');
else bad('object survived cleanup');

console.log(`\n  PASS ${pass}   FAIL ${fail}\n`);
process.exit(fail?1:0);
