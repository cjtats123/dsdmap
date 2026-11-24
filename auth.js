/* CEPALCO Map login. Users, permissions and map places live on the server (/api, Netlify Blobs). */
const Auth=(()=>{
const S='cep_session',FEATS={dmap:'Map'},NA={dmap:['create','delete']},ACTS=['view','create','update','delete'];
const cs=document.currentScript,g=(cs&&cs.dataset)||{},guarded=!!(g.guard||g.admin!==undefined);
if(guarded)document.documentElement.style.visibility='hidden';
const ses=()=>{try{return JSON.parse(sessionStorage.getItem(S))}catch(e){return null}};
const put=r=>sessionStorage.setItem(S,JSON.stringify({t:r.t,u:r.u,role:r.role,perms:r.perms,must:r.must?1:0}));
async function call(a,o){const s=ses();let r;try{r=await fetch('/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({a,t:s&&s.t,...o})})}catch(e){return{e:'Cannot reach the server'}}
let j;try{j=await r.json()}catch(e){j={e:'Server error ('+r.status+')'}}
if(j&&j.must&&!/login\.html/.test(location.pathname))location.replace('login.html?must=1');return j}
const can=(f,a='view')=>{const s=ses();return !!(s&&(s.role==='admin'||(s.perms&&s.perms[f]&&s.perms[f][a])))};
const logout=()=>{const s=ses();if(s&&s.t){try{fetch('/api',{method:'POST',keepalive:true,headers:{'content-type':'application/json'},body:JSON.stringify({a:'logout',t:s.t})})}catch(e){}}sessionStorage.removeItem(S);location.href='login.html'};
async function login(u,p){const r=await call('login',{u,p});if(r.t){put(r);return true}return r.e||'Sign-in failed'}
async function chpw(o,p){const r=await call('chpw',{o,p});if(r.t){put(r);return true}return r.e||'Could not change the password'}
async function guest(){const r=await call('guest');if(r.t){put(r);return true}return r.e||'Could not continue as guest'}
function hydrate(){const s=ses();
document.querySelectorAll('[data-feature]').forEach(e=>e.hidden=!can(e.dataset.feature));
document.querySelectorAll('[data-admin]').forEach(e=>{if(e!==cs)e.hidden=s.role!=='admin'});
const slot=document.getElementById('authSlot');
if(slot){slot.textContent='';const t=document.createElement('span');t.textContent=s.u+' ('+s.role+')';const a=document.createElement('a');a.href='#';a.className='';a.textContent='Logout';a.onclick=e=>{e.preventDefault();logout()};slot.append(t,a)}}
async function guard(){const toLogin=()=>{sessionStorage.removeItem(S);location.replace('login.html?next='+encodeURIComponent(location.pathname.split('/').pop()+location.hash));return false};
if(!ses())return toLogin();
if(ses().must){location.replace('login.html?must=1');return false}
/* show the page at once from the saved session; the server re-checks every action anyway */
const allowed=()=>g.admin!==undefined?ses().role==='admin':(g.guard||'').split(',').some(f=>can(f));
hydrate();document.documentElement.style.visibility='visible';
const ok=allowed();
if(!ok){const m=document.querySelector('main');if(m){m.hidden=true;m.insertAdjacentHTML('beforebegin','<div class="wrap" style="max-width:560px;margin-top:64px"><div class="card empty"><h2 class="nobar" style="justify-content:center">Access restricted</h2><p class="sub">Your account does not have permission to view this page.</p></div></div>')}}
/* confirm in the background; reload only if the server says something changed */
call('me').then(r=>{if(!r.t)return toLogin();const before=JSON.stringify([ses().role,ses().perms]);put(r);if(JSON.stringify([r.role,r.perms])!==before)location.reload()}).catch(()=>{});
return ok}
const ready=guarded?new Promise(r=>document.addEventListener('DOMContentLoaded',()=>guard().then(r))):Promise.resolve(false);
return{FEATS,NA,ACTS,call,can,ses,logout,login,chpw,guest,ready}})();

/* helpers shared by every page: load a big library only when it is needed, and wait for typing to pause */
const LIB={};
const _libs={};
const loadLib=u=>_libs[u]||(_libs[u]=new Promise((ok,no)=>{const e=document.createElement('script');e.src=u;e.async=true;e.onload=ok;e.onerror=()=>{delete _libs[u];no(new Error('Could not load a required library. Check your internet connection.'))};document.head.appendChild(e)}));
const debounce=(f,t=150)=>{let h;return(...a)=>{clearTimeout(h);h=setTimeout(()=>f(...a),t)}};
