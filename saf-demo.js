/* =====================================================================
   saf-demo.js — Compte démo SAF (demo@saf-helico.com) — 25.11.2026
   ---------------------------------------------------------------------
   À charger dans chaque page du SMS, juste APRÈS le bloc « saf-mfa-gate »
   et AVANT tout appel à supabase.createClient :
       <script src="saf-demo.js"></script>

   Quand la session ouverte est celle du compte démo :
   - pas de second facteur demandé ;
   - les pages voient le rôle « editor » (boutons visibles) ;
   - toute écriture (tables, fichiers, fonctions, RPC qui agissent) est
     simulée ici et n'atteint jamais Supabase ;
   - un bandeau jaune rappelle le mode démo.
   Pour tout autre compte, ce fichier ne change rien.

   Confort d'interface seulement : la vraie barrière est côté serveur
   (politiques demo_* de SAF_Portail_Demo_SQL.sql et gardes is_demo()).
   ===================================================================== */
(function () {
  'use strict';
  if (window.__safDemoLoaded) return;
  window.__safDemoLoaded = true;

  var DEMO_EMAIL  = 'demo@saf-helico.com';
  var UI_ROLE     = 'editor';                                   // rôle affiché dans les pages du SMS
  var STORAGE_KEY = 'sb-qaqehmxoehcvzcojcqkm-auth-token';       // session partagée avec le portail

  /* RPC qui agissent : simulées en démo. Les autres (lecture) passent. */
  var RPC_SIMULATED = {
    fleet_add_base: 1, fleet_delete_base: 1, fleet_set_assignment: 1, fleet_alert_ack: 1,
    fleet_b3_test_alert: 1, fleet_push_set_recipient: 1, portal_notify_now: 1
  };
  /* Fonctions Edge autorisées en démo (journal des connexions) ; les autres sont simulées. */
  var FN_ALLOWED = { 'sms-login-notify': 1 };

  function sessionEmail() {
    try {
      var s = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      var c = s && (s.currentSession || s);
      return c && c.user && c.user.email ? String(c.user.email).toLowerCase() : '';
    } catch (e) { return ''; }
  }
  function isDemo() { return sessionEmail() === DEMO_EMAIL; }
  window.safIsDemo = isDemo;

  /* ── Bandeau et message ─────────────────────────────────────────── */
  var CSS = '#saf-demo-bar{position:sticky;top:0;z-index:2147482000;padding:7px 14px;text-align:center;' +
    'font:600 13px/1.3 system-ui,sans-serif;background:#f2b84b;color:#2a1d00}' +
    '#saf-demo-note{position:fixed;left:50%;bottom:72px;transform:translateX(-50%);z-index:2147482001;' +
    'padding:8px 14px;border-radius:8px;font:600 12.5px/1.3 system-ui,sans-serif;background:#f2b84b;color:#2a1d00;' +
    'box-shadow:0 8px 24px rgba(0,0,0,.25);max-width:90vw;display:none}';
  function ensureStyle() {
    if (document.getElementById('saf-demo-style')) return;
    var st = document.createElement('style'); st.id = 'saf-demo-style'; st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }
  function showBar() {
    if (!isDemo() || !document.body || document.getElementById('saf-demo-bar')) return;
    ensureStyle();
    var b = document.createElement('div'); b.id = 'saf-demo-bar'; b.setAttribute('role', 'status');
    b.textContent = 'Mode démo — consultation complète ; les modifications sont simulées et ne sont pas enregistrées. / Demo mode — changes are not saved.';
    document.body.insertBefore(b, document.body.firstChild);
  }
  function notice() {
    if (!document.body) return;
    ensureStyle();
    var el = document.getElementById('saf-demo-note');
    if (!el) { el = document.createElement('div'); el.id = 'saf-demo-note'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = 'Mode démo : modification simulée, rien n\u2019a été enregistré. / Demo mode: nothing was saved.';
    el.style.display = 'block'; clearTimeout(el._t); el._t = setTimeout(function () { el.style.display = 'none'; }, 4200);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showBar); else showBar();
  window.addEventListener('storage', function (e) { if (e.key === STORAGE_KEY) showBar(); });

  /* ── Bac à sable autour du client Supabase ──────────────────────── */
  function ok(data) { return { data: data, error: null, count: null, status: 200, statusText: 'OK (demo)' }; }
  function uid() { return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2); }
  function bind(o, k) { var v = o[k]; return typeof v === 'function' ? v.bind(o) : v; }

  /* Fausse requête : accepte toute la chaîne (.select().eq().single()…) et
     renvoie un succès avec les lignes envoyées, complétées d'un id. */
  function fakeQuery(payload) {
    var single = false;
    function rows() {
      var arr = Array.isArray(payload) ? payload : [payload || {}];
      return arr.map(function (r) { return Object.assign({ id: uid(), created_at: new Date().toISOString() }, r); });
    }
    var q = new Proxy(function () {}, { get: function (_, k) {
      if (k === 'then') return function (res, rej) { notice(); var d = rows(); return Promise.resolve(ok(single ? d[0] : d)).then(res, rej); };
      if (k === 'single' || k === 'maybeSingle') return function () { single = true; return q; };
      return function () { return q; };
    } });
    return q;
  }

  var TABLE_WRITES = { insert: 1, update: 1, upsert: 1, 'delete': 1 };
  var FILE_WRITES  = { upload: 1, update: 1, move: 1, copy: 1, remove: 1, createSignedUploadUrl: 1, uploadToSignedUrl: 1 };

  function wrap(client) {
    if (!client || client.__safDemo) return client;
    return new Proxy(client, { get: function (t, k) {
      if (k === '__safDemo') return true;
      if (k === 'from') return function (table) {
        var b = t.from(table);
        return new Proxy(b, { get: function (bt, bk) {
          return (TABLE_WRITES[bk] && isDemo()) ? function (pl) { return fakeQuery(pl); } : bind(bt, bk);
        } });
      };
      if (k === 'storage') {
        var st = t.storage;
        return new Proxy(st, { get: function (stt, sk) {
          if (sk !== 'from') return bind(stt, sk);
          return function (bucket) {
            var b = stt.from(bucket);
            return new Proxy(b, { get: function (bb, bk) {
              if (FILE_WRITES[bk] && isDemo()) return function () { notice(); return Promise.resolve(ok(bk === 'remove' ? [{ name: 'demo' }] : { path: 'demo/' + uid() })); };
              return bind(bb, bk);
            } });
          };
        } });
      }
      if (k === 'functions') {
        var fn = t.functions;
        return new Proxy(fn, { get: function (ft, fk) {
          if (fk === 'invoke') return function (name) {
            if (isDemo() && !FN_ALLOWED[name]) { notice(); return Promise.resolve(ok({})); }
            return ft.invoke.apply(ft, arguments);
          };
          return bind(ft, fk);
        } });
      }
      if (k === 'rpc') return function (name) {
        if (isDemo()) {
          if (name === 'portal_role') return Promise.resolve(ok(UI_ROLE));
          if (RPC_SIMULATED[name]) { notice(); return Promise.resolve(ok(null)); }
        }
        return t.rpc.apply(t, arguments);
      };
      return bind(t, k);
    } });
  }
  window.safDemoWrap = wrap;

  /* Tous les clients créés ensuite par la page passent par le bac à sable.
     Nouvel objet plutôt que réaffectation : les exports du bundle UMD peuvent
     être en lecture seule. */
  if (window.supabase && typeof window.supabase.createClient === 'function' && !window.supabase.__safDemo) {
    var lib = window.supabase, orig = lib.createClient;
    var patched = {};
    Object.keys(lib).forEach(function (k) { patched[k] = lib[k]; });
    patched.createClient = function () { return wrap(orig.apply(lib, arguments)); };
    patched.__safDemo = true;
    window.supabase = patched;
  }

  /* Second facteur : le compte démo en est dispensé (aucune écriture possible). */
  if (typeof window.safMfaGate === 'function' && !window.safMfaGate.__safDemo) {
    var gate = window.safMfaGate;
    window.safMfaGate = async function (db, session) {
      var em = session && session.user && session.user.email ? String(session.user.email).toLowerCase() : '';
      if (em === DEMO_EMAIL || (!em && isDemo())) {
        try { var r = await db.auth.getSession(); if (r && r.data && r.data.session) return r.data.session; } catch (e) {}
        return session;
      }
      return gate.apply(this, arguments);
    };
    window.safMfaGate.__safDemo = true;
  }
})();
