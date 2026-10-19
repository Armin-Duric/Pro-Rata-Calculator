'use strict';
// Zero-dependency prototype: Node >= 22.5 (built-in node:sqlite). Not production-hardened.
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const {DatabaseSync}=require('node:sqlite');
const PORT=process.env.PORT||3000, DATA=process.env.DATA_DIR||path.join(__dirname,'data');
const SECRET=process.env.SESSION_SECRET||crypto.randomBytes(32).toString('hex'), IDLE=30*60*1000, RULES='770ILCS23/10@2026-10';
fs.mkdirSync(DATA,{recursive:true});
const db=new DatabaseSync(path.join(DATA,'liens.db'));
db.exec(`PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,username TEXT UNIQUE NOT NULL,name TEXT,role TEXT NOT NULL DEFAULT 'negotiator',pass TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,created TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS cases(id INTEGER PRIMARY KEY,ref TEXT,patient TEXT,settlement REAL,owner_id INTEGER,data TEXT,deleted INTEGER DEFAULT 0,created TEXT DEFAULT CURRENT_TIMESTAMP,updated TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS calculations(id INTEGER PRIMARY KEY,case_id INTEGER,user_id INTEGER,ts TEXT DEFAULT CURRENT_TIMESTAMP,settlement REAL,pro_pool REAL,fac_pool REAL,rule_version TEXT);
CREATE TABLE IF NOT EXISTS offers(id INTEGER PRIMARY KEY,case_id INTEGER,user_id INTEGER,ts TEXT DEFAULT CURRENT_TIMESTAMP,provider TEXT,category TEXT,amount REAL,status TEXT);
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,ts TEXT DEFAULT CURRENT_TIMESTAMP,user_id INTEGER,action TEXT,detail TEXT);
CREATE TABLE IF NOT EXISTS templates(id INTEGER PRIMARY KEY,name TEXT,subject TEXT,body TEXT);`);
const q=(s,...a)=>db.prepare(s).all(...a), q1=(s,...a)=>db.prepare(s).get(...a), run=(s,...a)=>db.prepare(s).run(...a);
const log=(u,a,d)=>run('INSERT INTO audit(user_id,action,detail) VALUES(?,?,?)',u?u.id:null,a,typeof d==='string'?d:JSON.stringify(d||{}));
const hashPw=p=>{const s=crypto.randomBytes(16).toString('hex');return s+':'+crypto.scryptSync(p,s,64).toString('hex')};
const checkPw=(p,h)=>{const [s,k]=String(h).split(':');if(!k)return false;return crypto.timingSafeEqual(crypto.scryptSync(p,s,64),Buffer.from(k,'hex'))};
if(!q1('SELECT 1 x FROM users')){const pw=process.env.ADMIN_PASSWORD||crypto.randomBytes(9).toString('base64url');run('INSERT INTO users(username,name,role,pass) VALUES(?,?,?,?)','admin','Administrator','admin',hashPw(pw));console.log(`Created user "admin" with password: ${pw}`)}
const ri=process.argv.indexOf('--reset-admin');
if(ri>-1){const pw=process.argv[ri+1];if(!pw||pw.length<10){console.error('Usage: node server.js --reset-admin <new password, 10+ characters>');process.exit(1)}
 run("UPDATE users SET pass=?,active=1,role='admin' WHERE username='admin'",hashPw(pw));console.log('Admin password reset. You can now sign in as "admin".');process.exit(0)}
db.prepare("DELETE FROM templates WHERE (name='Initial pro rata proposal' AND subject LIKE '%Pro rata proposal (DOI%') OR (name='Follow-up on pending offer' AND subject LIKE 'Follow-up: %') OR (name='Acceptance confirmation' AND subject LIKE 'Confirmation: %')").run();
if(!q1("SELECT 1 x FROM templates WHERE name='Accept proposal'")){const T=[
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
{{sender}}`]];T.forEach(t=>run('INSERT INTO templates(name,subject,body) VALUES(?,?,?)',...t))}

const sign=s=>crypto.createHmac('sha256',SECRET).update(s).digest('hex');
const mkCookie=(uid,secure)=>{const p=uid+'.'+(Date.now()+IDLE);return `sid=${p}.${sign(p)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=1800${secure?'; Secure':''}`};
const getUser=req=>{const m=/(?:^|; )sid=(\d+)\.(\d+)\.([a-f0-9]+)/.exec(req.headers.cookie||'');if(!m)return null;const a=Buffer.from(sign(m[1]+'.'+m[2])),b=Buffer.from(m[3]);if(a.length!==b.length||!crypto.timingSafeEqual(a,b)||+m[2]<Date.now())return null;const u=q1('SELECT id,username,name,role,active FROM users WHERE id=?',+m[1]);return u&&u.active?u:null};
const send=(res,c,o,t='application/json')=>{res.writeHead(c,{'Content-Type':t+'; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'});res.end(typeof o==='string'?o:JSON.stringify(o))};
const readBody=req=>new Promise((ok,no)=>{let b='',n=0;req.on('data',c=>{n+=c.length;if(n>2e6){no(new Error('too large'));req.destroy()}else b+=c});req.on('end',()=>{try{ok(b?JSON.parse(b):{})}catch(e){ok({})}});req.on('error',no)});
const routes=[];const route=(m,p,roles,h)=>routes.push({m,re:new RegExp('^'+p.replace(/:(\w+)/g,'(?<$1>[^/]+)')+'$'),roles,h});
const canSee=(u,c)=>c&&!c.deleted&&(u.role==='admin'||c.owner_id===u.id);
const diffOffers=(cid,uid,oldD,newD)=>{const old=Object.fromEntries(((oldD&&oldD.liens)||[]).map(l=>[l.id,l]));for(const l of newD.liens||[]){const o=old[l.id],off=+l.offer||0,po=o?(+o.offer||0):0,st=l.status||'Proposal Received',ps=o?o.status:'Proposal Received';if((off!==po||st!==ps)&&(off>0||st!=='Proposal Received'))run('INSERT INTO offers(case_id,user_id,provider,category,amount,status) VALUES(?,?,?,?,?,?)',cid,uid,String(l.name||''),String(l.category||''),off,st)}};

const tries=new Map();
route('POST','/api/login',null,({req,res,body,secure})=>{const k=(req.socket.remoteAddress||'')+'|'+String(body.username||'').toLowerCase(),t=tries.get(k)||{n:0,until:0};
 if(t.until>Date.now())return send(res,429,{error:'Too many attempts. Try again in a few minutes.'});
 const u=q1('SELECT * FROM users WHERE username=? COLLATE NOCASE',String(body.username||''));
 if(!u||!u.active||!checkPw(String(body.password||''),u.pass)){if(++t.n>=5){t.until=Date.now()+600000;t.n=0}tries.set(k,t);log(u,'login_failed',String(body.username||'').slice(0,60));return send(res,401,{error:'Invalid username or password'})}
 tries.delete(k);res.setHeader('Set-Cookie',mkCookie(u.id,secure));log(u,'login','');send(res,200,{ok:true})});
route('POST','/api/logout',null,({res,user})=>{res.setHeader('Set-Cookie','sid=; Path=/; Max-Age=0');if(user)log(user,'logout','');send(res,200,{ok:true})});
route('GET','/api/me',['*'],({res,user})=>send(res,200,user));

route('GET','/api/cases',['*'],({res,user,query})=>{const s='%'+(query.get('q')||'')+'%';send(res,200,q('SELECT c.id,c.ref,c.patient,c.settlement,c.updated,u.username owner FROM cases c LEFT JOIN users u ON u.id=c.owner_id WHERE c.deleted=0 AND (?=1 OR c.owner_id=?) AND (c.ref LIKE ? OR c.patient LIKE ?) ORDER BY c.updated DESC LIMIT 200',user.role==='admin'?1:0,user.id,s,s))});
route('GET','/api/cases/:id',['*'],({res,user,params})=>{const c=q1('SELECT * FROM cases WHERE id=?',+params.id);if(!canSee(user,c))return send(res,404,{error:'Not found'});log(user,'case_view',{id:c.id});send(res,200,{id:c.id,ref:c.ref,data:JSON.parse(c.data)})});
route('POST','/api/cases',['*'],({res,user,body})=>{const d=body.data;if(!d||typeof d!=='object'||!String(body.ref||'').trim())return send(res,400,{error:'Case reference required'});
 const id=Number(run('INSERT INTO cases(ref,patient,settlement,owner_id,data) VALUES(?,?,?,?,?)',String(body.ref).trim(),String(d.patient||''),+body.settlement||0,user.id,JSON.stringify(d)).lastInsertRowid);diffOffers(id,user.id,null,d);log(user,'case_create',{id});send(res,200,{id})});
route('PUT','/api/cases/:id',['*'],({res,user,params,body})=>{const c=q1('SELECT * FROM cases WHERE id=?',+params.id);if(!canSee(user,c))return send(res,404,{error:'Not found'});const d=body.data;if(!d||typeof d!=='object'||!String(body.ref||'').trim())return send(res,400,{error:'Case reference required'});
 run('UPDATE cases SET ref=?,patient=?,settlement=?,data=?,updated=CURRENT_TIMESTAMP WHERE id=?',String(body.ref).trim(),String(d.patient||''),+body.settlement||0,JSON.stringify(d),c.id);diffOffers(c.id,user.id,JSON.parse(c.data),d);log(user,'case_update',{id:c.id});send(res,200,{id:c.id})});
route('DELETE','/api/cases/:id',['*'],({res,user,params})=>{const c=q1('SELECT * FROM cases WHERE id=?',+params.id);if(!canSee(user,c))return send(res,404,{error:'Not found'});run('UPDATE cases SET deleted=1 WHERE id=?',c.id);log(user,'case_delete',{id:c.id});send(res,200,{ok:true})});
route('POST','/api/event',['*'],({res,user,body})=>{const t=body.type,d=body.data||{},cid=body.case_id?+body.case_id:null;if(!['calculation','email_draft','copy_proposal','csv_export'].includes(t))return send(res,400,{error:'Bad event'});
 if(t==='calculation')run('INSERT INTO calculations(case_id,user_id,settlement,pro_pool,fac_pool,rule_version) VALUES(?,?,?,?,?,?)',cid,user.id,+d.settlement||0,+d.pro_pool||0,+d.fac_pool||0,RULES);else log(user,t,{case_id:cid,template:String(d.template||'')});send(res,200,{ok:true})});

route('GET','/api/templates',['*'],({res})=>send(res,200,q('SELECT * FROM templates ORDER BY id')));
route('POST','/api/templates',['admin'],({res,user,body})=>{const id=Number(run('INSERT INTO templates(name,subject,body) VALUES(?,?,?)',String(body.name||'New template'),String(body.subject||''),String(body.body||'')).lastInsertRowid);log(user,'template_create',{id});send(res,200,{id})});
route('PUT','/api/templates/:id',['admin'],({res,user,params,body})=>{run('UPDATE templates SET name=?,subject=?,body=? WHERE id=?',String(body.name||''),String(body.subject||''),String(body.body||''),+params.id);log(user,'template_update',{id:+params.id});send(res,200,{ok:true})});

route('GET','/api/users',['admin'],({res})=>send(res,200,q('SELECT id,username,name,role,active,created FROM users ORDER BY username')));
route('POST','/api/users',['admin'],({res,user,body})=>{const un=String(body.username||'').trim(),role=body.role||'negotiator';
 if(!/^[a-z0-9._@-]{3,60}$/i.test(un)||!['admin','negotiator'].includes(role)||String(body.password||'').length<10)return send(res,400,{error:'Username 3-60 chars, valid role, password min 10 chars'});
 if(q1('SELECT 1 x FROM users WHERE username=? COLLATE NOCASE',un))return send(res,400,{error:'Username already exists'});
 const id=Number(run('INSERT INTO users(username,name,role,pass) VALUES(?,?,?,?)',un,String(body.name||un),role,hashPw(String(body.password))).lastInsertRowid);log(user,'user_create',{id,username:un,role});send(res,200,{id})});
route('PATCH','/api/users/:id',['admin'],({res,user,params,body})=>{const id=+params.id,u=q1('SELECT * FROM users WHERE id=?',id);if(!u)return send(res,404,{error:'No such user'});
 if(id===user.id&&(body.active===false||(body.role&&body.role!=='admin')))return send(res,400,{error:'You cannot demote or deactivate yourself'});
 if(body.role&&!['admin','negotiator'].includes(body.role))return send(res,400,{error:'Bad role'});
 if(body.password&&String(body.password).length<10)return send(res,400,{error:'Password must be at least 10 characters'});
 run('UPDATE users SET name=?,role=?,active=?,pass=? WHERE id=?',body.name??u.name,body.role??u.role,body.active===undefined?u.active:(body.active?1:0),body.password?hashPw(String(body.password)):u.pass,id);
 log(user,'user_update',{id,fields:Object.keys(body)});send(res,200,{ok:true})});

route('GET','/api/reports/summary',['admin'],({res,query})=>{const f=query.get('from')||'0000',t=(query.get('to')||'9999')+'~',w=(col)=>`${col}>=? AND ${col}<?`;
 const p=[];for(let i=0;i<7;i++)p.push(f,t);
 send(res,200,q(`SELECT u.username,u.name,
 (SELECT COUNT(*) FROM cases c WHERE c.owner_id=u.id AND ${w('c.created')}) cases,
 (SELECT COUNT(*) FROM calculations x WHERE x.user_id=u.id AND ${w('x.ts')}) calculations,
 (SELECT COUNT(*) FROM offers o WHERE o.user_id=u.id AND o.status='Proposal Received' AND ${w('o.ts')}) proposals_logged,
 (SELECT COUNT(*) FROM offers o WHERE o.user_id=u.id AND o.status='Sent to Clinic' AND ${w('o.ts')}) sent_to_clinic,
 (SELECT COUNT(*) FROM offers o WHERE o.user_id=u.id AND o.status='Accepted' AND ${w('o.ts')}) accepted,
 (SELECT COUNT(*) FROM offers o WHERE o.user_id=u.id AND o.status='Declined / Countered' AND ${w('o.ts')}) declined_countered,
 (SELECT COUNT(*) FROM audit a WHERE a.user_id=u.id AND a.action='email_draft' AND ${w('a.ts')}) email_drafts
 FROM users u ORDER BY u.username`,...p))});
route('GET','/api/audit',['admin'],({res})=>send(res,200,q('SELECT a.ts,u.username,a.action,a.detail FROM audit a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 100')));

const PAGES={'/login.html':[0,'login.html'],'/app-bridge.js':[0,'app-bridge.js'],'/':[1,'index.html'],'/admin.html':[2,'admin.html']};
http.createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://x'),secure=req.headers['x-forwarded-proto']==='https'||!!req.socket.encrypted,user=getUser(req);
 if(user)res.setHeader('Set-Cookie',mkCookie(user.id,secure));
 const pg=PAGES[url.pathname];
 if(pg){const [lvl,f]=pg;if(lvl&&!user){res.writeHead(302,{Location:'/login.html'});return res.end()}if(lvl===2&&user.role!=='admin'){res.writeHead(302,{Location:'/'});return res.end()}
  return send(res,200,fs.readFileSync(path.join(__dirname,'public',f),'utf8'),f.endsWith('.js')?'application/javascript':'text/html')}
 for(const r of routes){if(r.m!==req.method)continue;const m=r.re.exec(url.pathname);if(!m)continue;
  if(r.roles){if(!user)return send(res,401,{error:'Login required'});if(r.roles[0]!=='*'&&!r.roles.includes(user.role))return send(res,403,{error:'Forbidden'})}
  const body=['POST','PUT','PATCH'].includes(req.method)?await readBody(req):{};
  return r.h({req,res,user,params:m.groups||{},query:url.searchParams,body,secure})}
 send(res,404,{error:'Not found'});
}catch(e){console.error(e);send(res,500,{error:'Server error'})}}).listen(PORT,()=>console.log('Listening on '+PORT));
