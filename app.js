'use strict';
// TEST BUILD: runs on Vercel (Postgres via DATABASE_URL) or locally (SQLite). Use fake data only.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const PG=!!process.env.DATABASE_URL,ON_VERCEL=!!process.env.VERCEL;
const SECRET=process.env.SESSION_SECRET||(ON_VERCEL?'':crypto.randomBytes(32).toString('hex')),IDLE=30*60*1000,RULES='770ILCS23/10@2026-10';
let q;
if(PG){const {Pool}=require('pg');const url=process.env.DATABASE_URL;
 const pool=new Pool({connectionString:url,max:3,ssl:/localhost|127\.0\.0\.1/.test(url)?false:{rejectUnauthorized:false}});
 q=async(s,...a)=>(await pool.query(s,a)).rows}
else{const {DatabaseSync}=require('node:sqlite');const DATA=process.env.DATA_DIR||(ON_VERCEL?'/tmp':path.join(__dirname,'data'));fs.mkdirSync(DATA,{recursive:true});
 const db=new DatabaseSync(path.join(DATA,'liens.db'));db.exec('PRAGMA journal_mode=WAL');
 const tr=s=>s.replace(/\$(\d+)/g,'?$1').replace(/::int/g,'').replace(/ILIKE/g,'LIKE');
 q=async(s,...a)=>db.prepare(tr(s)).all(...a)}
const q1=async(s,...a)=>(await q(s,...a))[0],run=q,ins=async(s,...a)=>(await q1(s+' RETURNING id',...a)).id,now=()=>new Date().toISOString();
const log=(u,a,d)=>run('INSERT INTO audit(ts,user_id,action,detail) VALUES($1,$2,$3,$4)',now(),u?u.id:null,a,typeof d==='string'?d:JSON.stringify(d||{}));
const hashPw=p=>{const s=crypto.randomBytes(16).toString('hex');return s+':'+crypto.scryptSync(p,s,64).toString('hex')};
const checkPw=(p,h)=>{const [s,k]=String(h).split(':');if(!k)return false;return crypto.timingSafeEqual(crypto.scryptSync(p,s,64),Buffer.from(k,'hex'))};
const TEMPLATES=[
['Accept proposal (to attorney)','RE: {{patient}} - {{case_ref}} - DOI {{doi}} - Proposal accepted',`Hello,

Thank you for your proposal regarding {{patient}} (DOI {{doi}}). We have reviewed it against the settlement of {{settlement}} and accept the proposed amount of {{offer}} for {{clinic}} in full satisfaction of the outstanding balance of {{balance}}.

Please issue payment to {{clinic}} and reference {{patient}} / {{case_ref}}. Let us know the expected payment date.

Thank you,
{{sender}}`],
['Acknowledge - under review (to attorney)','RE: {{patient}} - {{case_ref}} - DOI {{doi}} - Proposal received',`Hello,

We received your proposal of {{offer}} ({{pct}} of the pro rata amount of {{prorata}}) for {{clinic}} regarding {{patient}} (DOI {{doi}}). We are reviewing it and, where required, will forward it to the clinic for approval. We will respond as soon as we have a decision.

Thank you,
{{sender}}`],
['Request clinic approval (to clinic)','Approval needed: {{patient}} - DOI {{doi}} - proposed {{offer}}',`Hello,

We received a reduction proposal from the attorney office ({{case_ref}}) for {{patient}} (DOI {{doi}}).

Settlement: {{settlement}}
Outstanding balance: {{balance}}
Pro rata amount: {{prorata}}
Proposed amount: {{offer}} ({{pct}} of pro rata)

{{table}}

Please reply APPROVE or DECLINE (with a counter amount if declining) so we can respond to the attorney office.

Thank you,
{{sender}}`],
['Clinic approved - confirm (to attorney)','RE: {{patient}} - {{case_ref}} - DOI {{doi}} - Proposal approved',`Hello,

The clinic has approved your proposal of {{offer}} for {{patient}} (DOI {{doi}}) in full satisfaction of the outstanding balance of {{balance}}. Please issue payment to {{clinic}} and reference {{patient}} / {{case_ref}}.

Thank you,
{{sender}}`],
['Decline / counter (to attorney)','RE: {{patient}} - {{case_ref}} - DOI {{doi}} - Proposal not accepted',`Hello,

Thank you for your proposal of {{offer}} for {{patient}} (DOI {{doi}}). Based on the settlement of {{settlement}}, our calculation of the pro rata amount for {{clinic}} is {{prorata}}, and the proposed amount is {{pct}} of that. We are unable to accept it as submitted and request payment of {{prorata}}.

{{table}}

Please let us know if you have questions.

Thank you,
{{sender}}`]];
const ID=PG?'SERIAL PRIMARY KEY':'INTEGER PRIMARY KEY',D='DOUBLE PRECISION';
const SCHEMA=[
`CREATE TABLE IF NOT EXISTS users(id ${ID},username TEXT UNIQUE NOT NULL,name TEXT,role TEXT NOT NULL DEFAULT 'negotiator',pass TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,created TEXT)`,
`CREATE TABLE IF NOT EXISTS cases(id ${ID},ref TEXT,patient TEXT,settlement ${D},owner_id INTEGER,data TEXT,deleted INTEGER DEFAULT 0,created TEXT,updated TEXT)`,
`CREATE TABLE IF NOT EXISTS calculations(id ${ID},case_id INTEGER,user_id INTEGER,ts TEXT,settlement ${D},pro_pool ${D},fac_pool ${D},rule_version TEXT)`,
`CREATE TABLE IF NOT EXISTS offers(id ${ID},case_id INTEGER,user_id INTEGER,ts TEXT,provider TEXT,category TEXT,amount ${D},status TEXT)`,
`CREATE TABLE IF NOT EXISTS audit(id ${ID},ts TEXT,user_id INTEGER,action TEXT,detail TEXT)`,
`CREATE TABLE IF NOT EXISTS templates(id ${ID},name TEXT,subject TEXT,body TEXT)`];
const ready=(async()=>{
 for(const s of SCHEMA)await run(s);
 const env=process.env.ADMIN_PASSWORD,adm=await q1('SELECT * FROM users WHERE username=$1','admin');
 if(!adm){const pw=env||crypto.randomBytes(9).toString('base64url');try{await run('INSERT INTO users(username,name,role,pass,created) VALUES($1,$2,$3,$4,$5)','admin','Administrator','admin',hashPw(pw),now());if(!env)console.log('Created admin with password: '+pw)}catch(e){}}
 else if(env&&!checkPw(env,adm.pass))await run("UPDATE users SET pass=$1,active=1,role='admin' WHERE username='admin'",hashPw(env)); // ADMIN_PASSWORD always wins
 if(!(await q1('SELECT 1 x FROM templates')))for(const t of TEMPLATES)await run('INSERT INTO templates(name,subject,body) VALUES($1,$2,$3)',...t);
})();ready.catch(e=>console.error('init failed:',e.message));

const sign=s=>crypto.createHmac('sha256',SECRET).update(s).digest('hex');
const mkCookie=(uid,secure)=>{const p=uid+'.'+(Date.now()+IDLE);return `sid=${p}.${sign(p)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=1800${secure?'; Secure':''}`};
const getUser=async req=>{const m=/(?:^|; )sid=(\d+)\.(\d+)\.([a-f0-9]+)/.exec(req.headers.cookie||'');if(!m)return null;const a=Buffer.from(sign(m[1]+'.'+m[2])),b=Buffer.from(m[3]);if(a.length!==b.length||!crypto.timingSafeEqual(a,b)||+m[2]<Date.now())return null;const u=await q1('SELECT id,username,name,role,active FROM users WHERE id=$1',+m[1]);return u&&u.active?u:null};
const send=(res,c,o,t='application/json')=>{res.writeHead(c,{'Content-Type':t+'; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'});res.end(typeof o==='string'?o:JSON.stringify(o))};
const readBody=req=>new Promise((ok,no)=>{
 if(req.body!==undefined&&req.body!==null){try{const b=req.body;return ok(typeof b==='string'?JSON.parse(b||'{}'):Buffer.isBuffer(b)?JSON.parse(b.toString()||'{}'):b)}catch(e){return ok({})}}
 let b='',n=0;req.on('data',c=>{n+=c.length;if(n>2e6){no(new Error('too large'));req.destroy()}else b+=c});req.on('end',()=>{try{ok(b?JSON.parse(b):{})}catch(e){ok({})}});req.on('error',no)});
const routes=[];const route=(m,p,roles,h)=>routes.push({m,re:new RegExp('^'+p.replace(/:(\w+)/g,'(?<$1>[^/]+)')+'$'),roles,h});
const canSee=(u,c)=>c&&!c.deleted&&(u.role==='admin'||c.owner_id===u.id);
const diffOffers=async(cid,uid,oldD,newD)=>{const old=Object.fromEntries(((oldD&&oldD.liens)||[]).map(l=>[l.id,l]));for(const l of newD.liens||[]){const o=old[l.id],off=+l.offer||0,po=o?(+o.offer||0):0,st=l.status||'Proposal Received',ps=o?o.status:'Proposal Received';if((off!==po||st!==ps)&&(off>0||st!=='Proposal Received'))await run('INSERT INTO offers(case_id,user_id,ts,provider,category,amount,status) VALUES($1,$2,$3,$4,$5,$6,$7)',cid,uid,now(),String(l.name||''),String(l.category||''),off,st)}};

const tries=new Map(); // per-instance only (test build)
route('POST','/api/login',null,async({req,res,body,secure})=>{const k=(req.headers['x-forwarded-for']||req.socket.remoteAddress||'')+'|'+String(body.username||'').toLowerCase(),t=tries.get(k)||{n:0,until:0};
 if(t.until>Date.now())return send(res,429,{error:'Too many attempts. Try again in a few minutes.'});
 const u=await q1('SELECT * FROM users WHERE LOWER(username)=LOWER($1)',String(body.username||''));
 if(!u||!u.active||!checkPw(String(body.password||''),u.pass)){if(++t.n>=5){t.until=Date.now()+600000;t.n=0}tries.set(k,t);await log(u,'login_failed',String(body.username||'').slice(0,60));return send(res,401,{error:'Invalid username or password'})}
 tries.delete(k);res.setHeader('Set-Cookie',mkCookie(u.id,secure));await log(u,'login','');send(res,200,{ok:true})});
route('POST','/api/logout',null,async({res,user})=>{res.setHeader('Set-Cookie','sid=; Path=/; Max-Age=0');if(user)await log(user,'logout','');send(res,200,{ok:true})});
route('GET','/api/me',['*'],({res,user})=>send(res,200,user));

route('GET','/api/cases',['*'],async({res,user,query})=>{const s='%'+(query.get('q')||'')+'%';send(res,200,await q('SELECT c.id,c.ref,c.patient,c.settlement,c.updated,u.username AS owner FROM cases c LEFT JOIN users u ON u.id=c.owner_id WHERE c.deleted=0 AND ($1=1 OR c.owner_id=$2) AND (c.ref ILIKE $3 OR c.patient ILIKE $3) ORDER BY c.updated DESC LIMIT 200',user.role==='admin'?1:0,user.id,s))});
route('GET','/api/cases/:id',['*'],async({res,user,params})=>{const c=await q1('SELECT * FROM cases WHERE id=$1',+params.id);if(!canSee(user,c))return send(res,404,{error:'Not found'});await log(user,'case_view',{id:c.id});send(res,200,{id:c.id,ref:c.ref,data:JSON.parse(c.data)})});
route('POST','/api/cases',['*'],async({res,user,body})=>{const d=body.data;if(!d||typeof d!=='object'||!String(body.ref||'').trim())return send(res,400,{error:'Case reference required'});
 const t=now(),id=await ins('INSERT INTO cases(ref,patient,settlement,owner_id,data,deleted,created,updated) VALUES($1,$2,$3,$4,$5,0,$6,$6)',String(body.ref).trim(),String(d.patient||''),+body.settlement||0,user.id,JSON.stringify(d),t);
 await diffOffers(id,user.id,null,d);await log(user,'case_create',{id});send(res,200,{id})});
route('PUT','/api/cases/:id',['*'],async({res,user,params,body})=>{const c=await q1('SELECT * FROM cases WHERE id=$1',+params.id);if(!canSee(user,c))return send(res,404,{error:'Not found'});const d=body.data;if(!d||typeof d!=='object'||!String(body.ref||'').trim())return send(res,400,{error:'Case reference required'});
 await run('UPDATE cases SET ref=$1,patient=$2,settlement=$3,data=$4,updated=$5 WHERE id=$6',String(body.ref).trim(),String(d.patient||''),+body.settlement||0,JSON.stringify(d),now(),c.id);await diffOffers(c.id,user.id,JSON.parse(c.data),d);await log(user,'case_update',{id:c.id});send(res,200,{id:c.id})});
route('DELETE','/api/cases/:id',['*'],async({res,user,params})=>{const c=await q1('SELECT * FROM cases WHERE id=$1',+params.id);if(!canSee(user,c))return send(res,404,{error:'Not found'});await run('UPDATE cases SET deleted=1 WHERE id=$1',c.id);await log(user,'case_delete',{id:c.id});send(res,200,{ok:true})});
route('POST','/api/event',['*'],async({res,user,body})=>{const t=body.type,d=body.data||{},cid=body.case_id?+body.case_id:null;if(!['calculation','email_draft','copy_proposal','csv_export'].includes(t))return send(res,400,{error:'Bad event'});
 if(t==='calculation')await run('INSERT INTO calculations(case_id,user_id,ts,settlement,pro_pool,fac_pool,rule_version) VALUES($1,$2,$3,$4,$5,$6,$7)',cid,user.id,now(),+d.settlement||0,+d.pro_pool||0,+d.fac_pool||0,RULES);else await log(user,t,{case_id:cid,template:String(d.template||'')});send(res,200,{ok:true})});

route('GET','/api/templates',['*'],async({res})=>send(res,200,await q('SELECT * FROM templates ORDER BY id')));
route('POST','/api/templates',['admin'],async({res,user,body})=>{const id=await ins('INSERT INTO templates(name,subject,body) VALUES($1,$2,$3)',String(body.name||'New template'),String(body.subject||''),String(body.body||''));await log(user,'template_create',{id});send(res,200,{id})});
route('PUT','/api/templates/:id',['admin'],async({res,user,params,body})=>{await run('UPDATE templates SET name=$1,subject=$2,body=$3 WHERE id=$4',String(body.name||''),String(body.subject||''),String(body.body||''),+params.id);await log(user,'template_update',{id:+params.id});send(res,200,{ok:true})});

route('GET','/api/users',['admin'],async({res})=>send(res,200,await q('SELECT id,username,name,role,active,created FROM users ORDER BY username')));
route('POST','/api/users',['admin'],async({res,user,body})=>{const un=String(body.username||'').trim(),role=body.role||'negotiator';
 if(!/^[a-z0-9._@-]{3,60}$/i.test(un)||!['admin','negotiator'].includes(role)||String(body.password||'').length<10)return send(res,400,{error:'Username 3-60 chars, valid role, password min 10 chars'});
 if(await q1('SELECT 1 x FROM users WHERE LOWER(username)=LOWER($1)',un))return send(res,400,{error:'Username already exists'});
 const id=await ins('INSERT INTO users(username,name,role,pass,created) VALUES($1,$2,$3,$4,$5)',un,String(body.name||un),role,hashPw(String(body.password)),now());await log(user,'user_create',{id,username:un,role});send(res,200,{id})});
route('PATCH','/api/users/:id',['admin'],async({res,user,params,body})=>{const id=+params.id,u=await q1('SELECT * FROM users WHERE id=$1',id);if(!u)return send(res,404,{error:'No such user'});
 if(id===user.id&&(body.active===false||(body.role&&body.role!=='admin')))return send(res,400,{error:'You cannot demote or deactivate yourself'});
 if(body.role&&!['admin','negotiator'].includes(body.role))return send(res,400,{error:'Bad role'});
 if(body.password&&String(body.password).length<10)return send(res,400,{error:'Password must be at least 10 characters'});
 await run('UPDATE users SET name=$1,role=$2,active=$3,pass=$4 WHERE id=$5',body.name??u.name,body.role??u.role,body.active===undefined?u.active:(body.active?1:0),body.password?hashPw(String(body.password)):u.pass,id);
 await log(user,'user_update',{id,fields:Object.keys(body)});send(res,200,{ok:true})});

route('GET','/api/reports/summary',['admin'],async({res,query})=>{const f=query.get('from')||'0000',t=(query.get('to')||'9999')+'~';
 send(res,200,await q(`SELECT u.username,u.name,
 (SELECT COUNT(*)::int FROM cases c WHERE c.owner_id=u.id AND c.created>=$1 AND c.created<$2) AS cases,
 (SELECT COUNT(*)::int FROM calculations x WHERE x.user_id=u.id AND x.ts>=$1 AND x.ts<$2) AS calculations,
 (SELECT COUNT(*)::int FROM offers o WHERE o.user_id=u.id AND o.status='Proposal Received' AND o.ts>=$1 AND o.ts<$2) AS proposals_logged,
 (SELECT COUNT(*)::int FROM offers o WHERE o.user_id=u.id AND o.status='Sent to Clinic' AND o.ts>=$1 AND o.ts<$2) AS sent_to_clinic,
 (SELECT COUNT(*)::int FROM offers o WHERE o.user_id=u.id AND o.status='Accepted' AND o.ts>=$1 AND o.ts<$2) AS accepted,
 (SELECT COUNT(*)::int FROM offers o WHERE o.user_id=u.id AND o.status='Declined / Countered' AND o.ts>=$1 AND o.ts<$2) AS declined_countered,
 (SELECT COUNT(*)::int FROM audit a WHERE a.user_id=u.id AND a.action='email_draft' AND a.ts>=$1 AND a.ts<$2) AS email_drafts
 FROM users u ORDER BY u.username`,f,t))});
route('GET','/api/audit',['admin'],async({res})=>send(res,200,await q('SELECT a.ts,u.username,a.action,a.detail FROM audit a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 100')));

const PAGES={'/login.html':[0,'login.html'],'/app-bridge.js':[0,'app-bridge.js'],'/':[1,'index.html'],'/admin.html':[2,'admin.html']};
module.exports=async(req,res)=>{try{
 await ready;if(!SECRET)return send(res,500,'Set the SESSION_SECRET environment variable in Vercel, then redeploy.','text/plain');
 const url=new URL(req.url,'http://x'),secure=req.headers['x-forwarded-proto']==='https'||!!req.socket.encrypted,user=await getUser(req);
 if(user)res.setHeader('Set-Cookie',mkCookie(user.id,secure));
 const pg=PAGES[url.pathname];
 if(pg){const [lvl,f]=pg;if(lvl&&!user){res.writeHead(302,{Location:'/login.html'});return res.end()}if(lvl===2&&user.role!=='admin'){res.writeHead(302,{Location:'/'});return res.end()}
  return send(res,200,fs.readFileSync(path.join(__dirname,'views',f),'utf8'),f.endsWith('.js')?'application/javascript':'text/html')}
 for(const r of routes){if(r.m!==req.method)continue;const m=r.re.exec(url.pathname);if(!m)continue;
  if(r.roles){if(!user)return send(res,401,{error:'Login required'});if(r.roles[0]!=='*'&&!r.roles.includes(user.role))return send(res,403,{error:'Forbidden'})}
  const body=['POST','PUT','PATCH'].includes(req.method)?await readBody(req):{};
  return await r.h({req,res,user,params:m.groups||{},query:url.searchParams,body,secure})}
 send(res,404,{error:'Not found'});
}catch(e){console.error(e);send(res,500,{error:'Server error'})}};
