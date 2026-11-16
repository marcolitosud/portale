/* ══════════════════════════════════════════════════════════════
   Effe Printing — client Supabase condiviso (con autenticazione)
   Intercetta le fetch verso /rest/ e aggiunge il JWT automaticamente.
   Nessun file HTML va modificato.
   ══════════════════════════════════════════════════════════════ */
/* ══════════════════════════════════════════════════════════════
   Effe Printing — client Supabase condiviso (con autenticazione)
   Nessuna credenziale nel codice: l'utente fa login dal portale
   (index.html) con le proprie credenziali Supabase; qui si conserva
   solo la sessione (access/refresh token) nel localStorage del
   dispositivo. Intercetta le fetch verso /rest/ e aggiunge il JWT.
   ══════════════════════════════════════════════════════════════ */
(function(){
  var URL_ = 'https://pkxeljiuqbtsyfgbdbfb.supabase.co';
  var KEY_ = 'sb_publishable_cE0yIitgfyw9WQ71YELk4A_e-15R5YD';
  var STORE = 'ep_sb_session';
  var DOMAIN = '@effeprinting.local';

  var _authPromise = null;
  var originalFetch = window.fetch.bind(window);

  function load(){
    try{ return JSON.parse(localStorage.getItem(STORE)) || null; }catch(e){ return null; }
  }
  function save(d){
    var s = {
      access_token: d.access_token,
      refresh_token: d.refresh_token,
      expires_at: Date.now() + (d.expires_in - 60) * 1000,
      user: d.user ? {id:d.user.id, email:d.user.email, app_metadata:d.user.app_metadata||{}} : (load()||{}).user
    };
    localStorage.setItem(STORE, JSON.stringify(s));
    return s;
  }
  function clear(){
    localStorage.removeItem(STORE);
    // invalida anche le vecchie sessioni "di reparto" usate dalle guardie delle pagine
    Object.keys(localStorage).forEach(function(k){ if(k.indexOf('ep_sess3_')===0) localStorage.removeItem(k); });
  }
  function toLogin(){
    var here = location.pathname.split('/').pop();
    if(here !== '' && here !== 'index.html') location.replace('index.html');
  }

  function emailOf(user){
    user = (user||'').trim().toLowerCase();
    return user.indexOf('@') >= 0 ? user : user + DOMAIN;
  }

  async function signIn(user, pwd){
    var r = await originalFetch(URL_ + '/auth/v1/token?grant_type=password', {
      method:'POST',
      headers:{'apikey':KEY_,'Content-Type':'application/json'},
      body: JSON.stringify({email:emailOf(user), password:pwd})
    });
    if(!r.ok) return null;
    return save(await r.json());
  }

  async function doRefresh(){
    var cur = load();
    if(!cur || !cur.refresh_token) throw new Error('nessuna sessione');
    var r = await originalFetch(URL_ + '/auth/v1/token?grant_type=refresh_token', {
      method:'POST',
      headers:{'apikey':KEY_,'Content-Type':'application/json'},
      body: JSON.stringify({refresh_token:cur.refresh_token})
    });
    if(!r.ok){
      // un'altra scheda potrebbe aver già ruotato il token: ricontrolla
      var again = load();
      if(again && again.refresh_token !== cur.refresh_token && Date.now() < again.expires_at) return again;
      throw new Error('refresh fallito: HTTP ' + r.status);
    }
    return save(await r.json());
  }

  async function ensureAuth(){
    var s = load();
    if(s && s.access_token && Date.now() < s.expires_at) return s;
    if(_authPromise) return _authPromise;
    _authPromise = doRefresh().catch(function(e){
      clear(); toLogin(); throw e;
    }).finally(function(){ _authPromise = null; });
    return _authPromise;
  }

  async function signOut(){
    var s = load();
    if(s && s.access_token){
      try{
        await originalFetch(URL_ + '/auth/v1/logout', {
          method:'POST', headers:{'apikey':KEY_,'Authorization':'Bearer ' + s.access_token}
        });
      }catch(e){}
    }
    clear();
  }

  function hasSession(){ var s = load(); return !!(s && s.refresh_token); }
  function currentUser(){ var s = load(); return s ? s.user : null; }
  function canAccess(reparto){
    var u = currentUser();
    var rep = (u && u.app_metadata && u.app_metadata.reparti) || [];
    return rep.indexOf('*') >= 0 || rep.indexOf(reparto) >= 0;
  }

  // Intercetta tutte le fetch verso /rest/ e inietta il JWT
  window.fetch = async function(url, opts){
    var u = (typeof url === 'string') ? url : (url && url.url);
    if(u && u.indexOf(URL_ + '/rest/') === 0){
      var _s = await ensureAuth();
      var _token = _s.access_token;
      opts = opts || {};
      opts.headers = opts.headers || {};
      if(opts.headers instanceof Headers){
        opts.headers.set('Authorization', 'Bearer ' + _token);
        opts.headers.set('apikey', KEY_);
      } else {
        opts.headers['Authorization'] = 'Bearer ' + _token;
        opts.headers['apikey'] = KEY_;
      }
    }
    return originalFetch(url, opts);
  };

  async function H(){
    var _token = (await ensureAuth()).access_token;
    return {
      'apikey': KEY_,
      'Authorization': 'Bearer ' + _token,
      'Content-Type': 'application/json'
    };
  }

  async function get(table, params){
    var qs = params ? ('?' + params) : '?select=*';
    var r = await fetch(URL_ + '/rest/v1/' + table + qs, {headers: await H()});
    if(!r.ok) throw new Error('SB.get ' + table + ': HTTP ' + r.status);
    return r.json();
  }

  async function upsert(table, rows, conflict){
    if(!Array.isArray(rows)) rows = [rows];
    if(!rows.length) return;
    var qs = conflict ? ('?on_conflict=' + conflict) : '';
    var r = await fetch(URL_ + '/rest/v1/' + table + qs, {
      method:'POST',
      headers: Object.assign(await H(), {'Prefer':'resolution=merge-duplicates'}),
      body: JSON.stringify(rows)
    });
    if(!r.ok){ var t = await r.text(); throw new Error('SB.upsert ' + table + ': ' + t); }
    return r;
  }

  async function del(table, params){
    var r = await fetch(URL_ + '/rest/v1/' + table + '?' + params, {
      method:'DELETE', headers: await H()
    });
    if(!r.ok) throw new Error('SB.del ' + table + ': HTTP ' + r.status);
    return r;
  }

  async function setDiff(table, rows, idField){
    idField = idField || 'id';
    var rIds = await fetch(URL_ + '/rest/v1/' + table + '?select=' + idField, {headers: await H()});
    if(!rIds.ok) throw new Error('SB.setDiff read: HTTP ' + rIds.status);
    var existing = (await rIds.json()).map(function(x){ return x[idField]; });
    var incoming = new Set(rows.map(function(r){ return r[idField]; }));
    var toDelete = existing.filter(function(id){ return !incoming.has(id); });
    if(toDelete.length) await del(table, idField + '=in.(' + toDelete.join(',') + ')');
    if(rows.length) await upsert(table, rows, idField);
  }

  // Legacy helper (sincrono): il fallback usa KEY_ ma il monkey-patch
  // della fetch sostituisce comunque l'Authorization con il JWT
  function _sbHLegacy(){
    return {
      'apikey': KEY_,
      'Authorization': 'Bearer ' + (((load()||{}).access_token) || KEY_),
      'Content-Type': 'application/json'
    };
  }

  // Esposizione globale
  window.SB_URL = URL_;
  window.SB_KEY = KEY_;
  window._sbH = _sbHLegacy;
  window.SB = {URL:URL_, KEY:KEY_, H:H, get:get, upsert:upsert, del:del, setDiff:setDiff,
               signIn:signIn, signOut:signOut, hasSession:hasSession, currentUser:currentUser, canAccess:canAccess};
})();
