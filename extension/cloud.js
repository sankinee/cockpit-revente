"use strict";
/* Base en ligne Supabase : ton compte (email + mot de passe) et une ligne de données par compte.
   Utilisé par le tableau de bord, la popup et la synchro automatique. */
const CRCloud = (() => {
  const KEY = "cr_cloud";
  // ton projet Supabase « cockpit-revente » (clé publique, faite pour être dans l'app)
  const DEFAULT = {url: "https://lhxozugvjuhkbmeoessp.supabase.co", key: "sb_publishable_lEQe9n8daW1BfD3VcnQK8Q_NzzBk_X6"};
  const cfg = async () => { const c = (await CR.get(KEY)) || {}; return {...c, url: c.url || DEFAULT.url, key: c.key || DEFAULT.key}; };
  const setCfg = async patch => { const c = {...(await cfg()), ...patch}; await CR.set(KEY, c); return c; };
  const base = c => String(c.url || "").replace(/\/+$/, "");
  const ready = c => !!(c.url && c.key);
  const connected = c => ready(c) && !!c.refresh_token;

  async function call(c, path, opts = {}, auth = true){
    const headers = {"apikey": c.key, "content-type": "application/json", ...(opts.headers || {})};
    if (auth) headers.Authorization = "Bearer " + (await token());
    let r;
    try { r = await fetch(base(c) + path, {...opts, headers}); }
    catch { throw new Error("Base en ligne injoignable. Vérifie ta connexion internet et l'adresse du projet."); }
    const text = await r.text();
    let j = null; try { j = text ? JSON.parse(text) : null; } catch {}
    if (!r.ok){
      const msg = j?.error_description || j?.msg || j?.message || j?.error || ("erreur " + r.status);
      if (/invalid login|invalid_credentials/i.test(msg)) throw new Error("Email ou mot de passe incorrect.");
      if (/email not confirmed/i.test(msg)) throw new Error("Confirme d'abord ton email : clique le lien reçu de Supabase, puis reconnecte-toi.");
      if (/relation .* does not exist|cockpit_data/i.test(msg)) throw new Error("La table n'existe pas encore : lance le script SQL du guide dans Supabase.");
      throw new Error("Base en ligne : " + msg);
    }
    return j;
  }
  function keepSession(j){
    return {access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + (j.expires_in || 3600) * 1000 - 60000, uid: j.user?.id, email: j.user?.email};
  }
  async function token(){
    const c = await cfg();
    if (!c.refresh_token) throw new Error("Connecte-toi à ton compte en ligne dans Réglages.");
    if (c.access_token && Date.now() < c.expires_at) return c.access_token;
    const j = await call(c, "/auth/v1/token?grant_type=refresh_token", {method: "POST", body: JSON.stringify({refresh_token: c.refresh_token})}, false)
      .catch(async e => { await setCfg({access_token: "", refresh_token: ""}); throw new Error("Session expirée : reconnecte-toi dans Réglages."); });
    const s = keepSession(j); await setCfg(s); return s.access_token;
  }
  async function signIn(url, key, email, password){
    const c = await setCfg({url: url.trim(), key: key.trim()});
    const j = await call(c, "/auth/v1/token?grant_type=password", {method: "POST", body: JSON.stringify({email, password})}, false);
    await setCfg(keepSession(j));
  }
  async function signUp(url, key, email, password){
    const c = await setCfg({url: url.trim(), key: key.trim()});
    const j = await call(c, "/auth/v1/signup", {method: "POST", body: JSON.stringify({email, password})}, false);
    if (j && j.access_token) { await setCfg(keepSession(j)); return "connected"; }
    return "confirm";
  }
  const signOut = () => setCfg({access_token: "", refresh_token: "", uid: "", email: ""});

  async function pull(){
    const c = await cfg(); if (!connected(c)) return null;
    await token(); const u = await cfg();
    const rows = await call(u, `/rest/v1/cockpit_data?select=data,updated_at&user_id=eq.${u.uid}`, {method: "GET"});
    return rows && rows[0] ? {data: rows[0].data, updatedAt: Number(rows[0].updated_at) || 0} : null;
  }
  async function push(data){
    const c = await cfg(); if (!connected(c)) return false;
    await token(); const u = await cfg();
    await call(u, "/rest/v1/cockpit_data?on_conflict=user_id", {method: "POST", headers: {Prefer: "resolution=merge-duplicates,return=minimal"},
      body: JSON.stringify({user_id: u.uid, data, updated_at: data.updatedAt || Date.now()})});
    await setCfg({lastPush: Date.now()});
    return true;
  }
  /* Rapproche cet appareil et la base en ligne : la copie la plus récente gagne. Renvoie les données à jour. */
  async function reconcile(){
    const local = await CR.loadData();
    const remote = await pull();
    if (remote && remote.updatedAt > (local.updatedAt || 0)) { const d = {...remote.data, updatedAt: remote.updatedAt}; await CR.saveData(d, true); return {data: d, from: "cloud"}; }
    if ((local.items || []).length || local.settings) await push(local);
    return {data: local, from: "local"};
  }
  return {cfg, setCfg, ready, connected, signIn, signUp, signOut, pull, push, reconcile};
})();
