// Connects the calculator page to the server: login, case storage, logging, Outlook drafts.
(async()=>{
const J=async(u,o={})=>{const r=await fetch(u,{credentials:'same-origin',headers:{'Content-Type':'application/json'},...o,body:o.body&&JSON.stringify(o.body)});if(r.status===401){location='/login.html';throw new Error('Login required')}const d=await r.json();if(!r.ok)throw new Error(d.error||'Request failed');return d};
const me=await J('/api/me'),$=id=>document.getElementById(id);
const bar=document.querySelector('#rule-badge').parentElement;
bar.className+=' flex-wrap';bar.insertAdjacentHTML('beforeend',`<span class="text-xs font-bold text-red-600">TEST ENVIRONMENT - fake data only</span><span class="text-xs text-slate-500">${escapeHtml(me.name||me.username)}</span>${me.role==='admin'?'<a href="/admin.html" class="text-xs text-blue-600">Admin</a>':''}<button id="logout" class="text-xs text-slate-500 underline">Sign out</button>`);
$('logout').onclick=async()=>{await J('/api/logout',{method:'POST'}).catch(()=>{});location='/login.html'};
const logEvent=(type,data)=>J('/api/event',{method:'POST',body:{type,case_id:currentCaseId,data}}).catch(()=>{});
const logCalc=()=>{const s=readState(),sum=c=>s.liens.filter(l=>l.category===c).reduce((a,l)=>a+toCents(l.amount),0),r=computePoolsCents(toCents(s.settlement),sum('professional'),sum('provider'));return logEvent('calculation',{settlement:s.settlement,pro_pool:r.pro/100,fac_pool:r.fac/100})};

window.saveCurrentCase=async()=>{const st=readState();if(!st.name)return alert('Please enter an Attorney / Case Reference.');
 try{const body={ref:st.name,settlement:st.settlement,data:st};const r=currentCaseId?await J('/api/cases/'+currentCaseId,{method:'PUT',body}):await J('/api/cases',{method:'POST',body});currentCaseId=r.id;await logCalc();await renderSavedCasesList();alert('Case saved.')}catch(e){alert('Save failed: '+e.message)}};
window.loadCase=async id=>{try{const c=await J('/api/cases/'+id);currentCaseId=id;applyState(c.data)}catch(e){alert(e.message)}};
window.deleteCase=async id=>{if(!confirm('Delete this case?'))return;try{await J('/api/cases/'+id,{method:'DELETE'});if(currentCaseId===id)currentCaseId=null;renderSavedCasesList()}catch(e){alert(e.message)}};
window.clearAllData=()=>{if(confirm('Clear the local provider-name directory in this browser? (Cases are stored on the server.)')){localStorage.removeItem('il_provider_directory');providerDirectory=[];updateProviderDatalist()}};
window.renderSavedCasesList=async()=>{const box=$('saved-cases-list');let rows=[];try{rows=await J('/api/cases?q='+encodeURIComponent($('search-saved').value||''))}catch(e){}
 $('saved-count').innerText=rows.length;box.replaceChildren();if(!rows.length){box.innerHTML='<div class="py-2 text-center text-slate-400 italic">No saved cases</div>';return}
 rows.forEach(c=>{const d=document.createElement('div');d.className='py-1.5 px-2 hover:bg-slate-50 cursor-pointer flex justify-between items-center rounded';d.onclick=()=>loadCase(c.id);
  const i=document.createElement('div');i.innerHTML='<div class="font-semibold text-slate-800"></div><div class="text-[10px] text-slate-400"></div>';i.firstChild.textContent=(c.patient?c.patient+' - ':'')+c.ref;i.lastChild.textContent=formatUSD(c.settlement)+' • '+String(c.updated).slice(0,10)+(me.role==='admin'?' • '+c.owner:'');
  const x=document.createElement('button');x.className='text-slate-300 hover:text-red-500 p-1';x.setAttribute('aria-label','Delete saved case');x.textContent='✕';x.onclick=e=>{e.stopPropagation();deleteCase(c.id)};d.append(i,x);box.appendChild(d)})};
renderSavedCasesList();

// ---- Email templates: copy to clipboard, then paste into Outlook (no mailbox access needed) ----
let T=[];try{T=await J('/api/templates')}catch(e){}
const prev=$('email-preview-container'),bar2=document.createElement('div');bar2.className='flex flex-wrap items-end gap-2 text-xs';
bar2.innerHTML='<label class="block">Template<select id="tpl" class="block w-60 p-1.5 border border-slate-300 rounded"></select></label><label class="block">Provider<select id="tpl-prov" class="block w-48 p-1.5 border border-slate-300 rounded"></select></label><button id="tpl-copy" class="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg">Copy email</button><button id="tpl-subj" class="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg">Copy subject</button>';
prev.parentElement.insertBefore(bar2,prev);
T.forEach(t=>{const o=document.createElement('option');o.value=t.id;o.textContent=t.name;$('tpl').appendChild(o)});
$('tpl-prov').onfocus=()=>{const s=$('tpl-prov'),v=s.value;s.replaceChildren(new Option('(none)',''));liens.forEach((l,i)=>s.appendChild(new Option(l.name||'(unnamed)',i)));s.value=v};$('tpl-prov').onfocus();
const num=x=>parseFloat(String(x).replace(/[^0-9.\-]/g,''))||0;
const flash=(b,txt)=>{const o=b.textContent;b.textContent=txt;setTimeout(()=>b.textContent=o,2000)};
const copyHtml=async(html,plain)=>{
 if(navigator.clipboard&&window.ClipboardItem){await navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([html],{type:'text/html'}),'text/plain':new Blob([plain],{type:'text/plain'})})]);return}
 const d=document.createElement('div');d.innerHTML=html;d.style.cssText='position:fixed;left:-9999px';document.body.appendChild(d);const r=document.createRange();r.selectNodeContents(d);const s=getSelection();s.removeAllRanges();s.addRange(r);const ok=document.execCommand('copy');s.removeAllRanges();d.remove();if(!ok)throw new Error('copy failed')};
const build=()=>{const t=T.find(x=>x.id==$('tpl').value);if(!t){alert('No template selected.');return null}
 const s=readState(),pi=$('tpl-prov').value,l=pi===''?null:s.liens[+pi],pr=l&&$('prorata-val-'+pi)?$('prorata-val-'+pi).value:'';
 const v={patient:s.patient,case_ref:s.name,clinic:s.facility,doi:fmtDate(s.doi),settlement:formatUSD(s.settlement),provider:l?l.name:'',balance:l?formatUSD(l.amount):'',prorata:pr,offer:l&&l.offer?formatUSD(l.offer):'',pct:l&&l.offer&&num(pr)>0?Math.round(l.offer/num(pr)*100)+'%':'',sender:me.name||me.username};
 const fill=x=>x.replace(/\{\{(\w+)\}\}/g,(m,k)=>k==='table'?m:(v[k]??''));
 return {subj:fill(t.subject).replace(/[\r\n]+/g,' '),name:t.name,
  html:'<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt">'+escapeHtml(fill(t.body)).replace(/\n/g,'<br>').replace('{{table}}',()=>prev.innerHTML)+'</div>',
  plain:fill(t.body).replace('{{table}}',()=>prev.innerText)}};
$('tpl-copy').onclick=async()=>{const m=build();if(!m)return;try{await copyHtml(m.html,m.plain);flash($('tpl-copy'),'Copied!');logEvent('email_draft',{template:m.name})}catch(e){alert('Copy failed. Check that the browser allows clipboard access for this site.')}};
$('tpl-subj').onclick=async()=>{const m=build();if(!m)return;try{await navigator.clipboard.writeText(m.subj);flash($('tpl-subj'),'Copied!')}catch(e){alert('Copy failed.')}};
})();
