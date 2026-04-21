/* ══════════════════════════════════════════════════════════════
   Effe Printing — client Supabase condiviso
   Include:
   - Config (URL + publishable key)
   - Header helper _sbH()
   - SB.get/upsert/del/setDiff per chiamate dirette
   - Esposte come globali per compatibilita` con il codice esistente
   ══════════════════════════════════════════════════════════════ */
(function(){
  var URL_ = 'https://pkxeljiuqbtsyfgbdbfb.supabase.co';
  var KEY_ = 'sb_publishable_cE0yIitgfyw9WQ71YELk4A_e-15R5YD';

  function H(){
    return {
      'apikey': KEY_,
      'Authorization': 'Bearer ' + KEY_,
      'Content-Type': 'application/json'
    };
  }

  // GET: ritorna array di record
  async function get(table, params){
    var qs = params ? ('?' + params) : '?select=*';
    var r = await fetch(URL_ + '/rest/v1/' + table + qs, {headers: H()});
    if(!r.ok) throw new Error('SB.get ' + table + ': HTTP ' + r.status);
    return r.json();
  }

  // UPSERT: insert + update per on_conflict
  async function upsert(table, rows, conflict){
    if(!Array.isArray(rows)) rows = [rows];
    if(!rows.length) return;
    var qs = conflict ? ('?on_conflict=' + conflict) : '';
    var r = await fetch(URL_ + '/rest/v1/' + table + qs, {
      method: 'POST',
      headers: Object.assign(H(), {'Prefer': 'resolution=merge-duplicates'}),
      body: JSON.stringify(rows)
    });
    if(!r.ok){
      var t = await r.text();
      throw new Error('SB.upsert ' + table + ': ' + t);
    }
    return r;
  }

  // DELETE: params è la query string es. "id=eq.5" o "id=in.(1,2,3)"
  async function del(table, params){
    var r = await fetch(URL_ + '/rest/v1/' + table + '?' + params, {
      method: 'DELETE', headers: H()
    });
    if(!r.ok) throw new Error('SB.del ' + table + ': HTTP ' + r.status);
    return r;
  }

  // SETDIFF: pattern diff-based riusabile
  // Legge gli id esistenti, cancella SOLO quelli rimossi, upserta il resto.
  // idField default 'id' ma puoi passare 'ts' per tabelle append-only.
  async function setDiff(table, rows, idField){
    idField = idField || 'id';
    var rIds = await fetch(URL_ + '/rest/v1/' + table + '?select=' + idField,
      {headers: H()});
    if(!rIds.ok) throw new Error('SB.setDiff read: HTTP ' + rIds.status);
    var existing = (await rIds.json()).map(function(x){ return x[idField]; });
    var incoming = new Set(rows.map(function(r){ return r[idField]; }));
    var toDelete = existing.filter(function(id){ return !incoming.has(id); });
    if(toDelete.length){
      await del(table, idField + '=in.(' + toDelete.join(',') + ')');
    }
    if(rows.length){
      await upsert(table, rows, idField);
    }
  }

  // Esposizione globale
  window.SB_URL = URL_;
  window.SB_KEY = KEY_;
  window._sbH   = H;          // alias legacy
  window.SB     = {URL: URL_, KEY: KEY_, H: H, get: get, upsert: upsert, del: del, setDiff: setDiff};
})();
