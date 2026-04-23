/* ══════════════════════════════════════════════════════════════
   Effe Printing — client Supabase condiviso (con autenticazione)
   Intercetta le fetch verso /rest/ e aggiunge il JWT automaticamente.
   Nessun file HTML va modificato.
   ══════════════════════════════════════════════════════════════ */
(function(){
  var URL_ = 'https://pkxeljiuqbtsyfgbdbfb.supabase.co';
  var KEY_ = 'sb_publishable_cE0yIitgfyw9WQ71YELk4A_e-15R5YD';

  // ═══ UTENTE CONDIVISO DEL PORTALE (creato in Authentication → Users) ═══
  var AUTH_EMAIL = 'portale@effeprinting.local';
  var AUTH_PWD   = 'PVrPduE..?56MQ)';

  var _token = null, _refresh = null, _expiresAt = 0, _authPromise = null;
  var originalFetch = window.fetch.bind(window);

  async function doSignIn(){
    var r = await originalFetch(URL_ + '/auth/v1/token?grant_type=password', {
      method:'POST',
      headers:{'apikey':KEY_,'Content-Type':'application/json'},
      body: JSON.stringify({email:AUTH_EMAIL, password:AUTH_PWD})
    });
    if(!r.ok) throw new Error('SB signIn failed: HTTP ' + r.status);
    var d = await r.json();
    _token = d.access_token; _refresh = d.refresh_token;
    _expiresAt = Date.now() + (d.expires_in - 60) * 1000;
  }

  async function doRefresh(){
    var r = await originalFetch(URL_ + '/auth/v1/token?grant_type=refresh_token', {
      method:'POST',
      headers:{'apikey':KEY_,'Content-Type':'application/json'},
      body: JSON.stringify({refresh_token:_refresh})
    });
    if(!r.ok){ _refresh = null; return doSignIn(); }
    var d = await r.json();
    _token = d.access_token; _refresh = d.refresh_token;
    _expiresAt = Date.now() + (d.expires_in - 60) * 1000;
  }

  async function ensureAuth(){
    if(_token && Date.now() < _expiresAt) return;
    if(_authPromise) return _authPromise;
    _authPromise = (_refresh ? doRefresh() : doSignIn()).finally(function(){
      _authPromise = null;
    });
    return _authPromise;
  }

  // Intercetta tutte le fetch verso /rest/ e inietta il JWT
  window.fetch = async function(url, opts){
    var u = (typeof url === 'string') ? url : (url && url.url);
    if(u && u.indexOf(URL_ + '/rest/') === 0){
      await ensureAuth();
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
    await ensureAuth();
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
      'Authorization': 'Bearer ' + (_token || KEY_),
      'Content-Type': 'application/json'
    };
  }

  // Esposizione globale
  window.SB_URL = URL_;
  window.SB_KEY = KEY_;
  window._sbH = _sbHLegacy;
  window.SB = {URL:URL_, KEY:KEY_, H:H, get:get, upsert:upsert, del:del, setDiff:setDiff};
})();
