"use strict";
/* Synchro automatique : lit ton compte Vinted à intervalle régulier tant que Chrome est ouvert,
   puis envoie les données sur la base en ligne. Lecture seule sur Vinted. */
importScripts("sync-merge.js", "cloud.js", "vinted-read.js");

const ALARM = "cr-auto-sync";
const VINTED = ["fr","be","es","it","de","nl","lu","pt","co.uk","com"].map(d => `https://www.vinted.${d}/*`);
const LOG = "cr_autolog";

async function schedule(){
  const d = await CR.loadData();
  const every = Number(d.settings?.autoSyncMinutes ?? 120);
  await chrome.alarms.clear(ALARM);
  if (!every) return;
  // petit décalage aléatoire (±15 %) pour ne pas interroger Vinted à heure fixe
  const jitter = every * (0.85 + Math.random() * 0.3);
  chrome.alarms.create(ALARM, {when: Date.now() + jitter * 60000});
}
function waitComplete(tabId){
  return new Promise(res => {
    const f = (id, info) => { if (id === tabId && info.status === "complete") { chrome.tabs.onUpdated.removeListener(f); res(); } };
    chrome.tabs.onUpdated.addListener(f);
    setTimeout(() => { chrome.tabs.onUpdated.removeListener(f); res(); }, 30000);
  });
}
async function openVintedTab(origin){
  const tabs = await chrome.tabs.query({url: VINTED});
  if (tabs.length) return {tab: tabs[0], created: false};
  let tab;
  try { tab = await chrome.tabs.create({url: origin + "/", active: false}); }
  catch { const w = await chrome.windows.create({url: origin + "/", focused: false, state: "minimized"}); tab = w.tabs[0]; }
  await waitComplete(tab.id);
  await new Promise(r => setTimeout(r, 2500));
  return {tab, created: true};
}
async function runSync(reason){
  const started = Date.now();
  let msg = "", ok = false, opened = null;
  try {
    // 1. récupérer d'abord les changements faits depuis un autre appareil
    try { await CRCloud.reconcile(); } catch (e) { msg = "Base en ligne : " + e.message + " · "; }
    const data = await CR.loadData();
    const origin = data.settings?.vintedOrigin || "https://www.vinted.fr";
    opened = await openVintedTab(origin);
    const [res] = await chrome.scripting.executeScript({target: {tabId: opened.tab.id}, func: readVinted, args: [data.settings?.vintedUid || ""]});
    const r = res?.result;
    if (!r || !r.ok) throw new Error(r?.error || "lecture Vinted impossible");
    const fresh = await CR.loadData();
    fresh.settings = fresh.settings || {};
    fresh.settings.vintedUid = r.uid; fresh.settings.vintedOrigin = r.origin;
    const sum = CR.mergeVinted(fresh, {...r, account: fresh.settings.accounts?.[0] || "Compte principal"});
    await CR.saveData(fresh);
    try { await CRCloud.push(fresh); } catch (e) { msg += "envoi en ligne échoué (" + e.message + ") · "; }
    ok = true;
    msg += `${r.items.length} annonces, ${sum.created} nouvelles, ${sum.sales} ventes, ${(r.favs || []).length} favoris lus`;
  } catch (e) {
    msg += "Échec : " + (e.message || e) + ". Vérifie que tu es connecté à Vinted dans Chrome.";
  } finally {
    if (opened?.created) { try { await chrome.tabs.remove(opened.tab.id); } catch {} }
    try { const t = await runTracker(); if (t) msg += " · tracker : " + t; } catch (e) { msg += " · tracker : " + (e.message || e); }
    await CR.set(LOG, {at: started, ok, msg, reason});
    await schedule();
  }
  return {ok, msg};
}

/* Tracker : scanne chaque niche suivie (page de recherche Vinted, plus récents d'abord),
   puis vérifie les annonces qui ont disparu des résultats pour savoir si elles sont vendues. */
async function runTracker(onlyNiche){
  const data = await CR.loadData();
  const T = data.tracker; if (!T || !(T.niches || []).length) return "";
  const origin = data.settings?.vintedOrigin || "https://www.vinted.fr";
  const niches = T.niches.filter(n => !onlyNiche || n.id === onlyNiche).slice(0, 8);
  let tab;
  try { tab = await chrome.tabs.create({url: origin + "/", active: false}); }
  catch { const w = await chrome.windows.create({url: origin + "/", focused: false, state: "minimized"}); tab = w.tabs[0]; }
  const scan = {}, checks = {};
  try {
    await waitComplete(tab.id);
    for (const n of niches){
      const now = Date.now();
      await chrome.tabs.update(tab.id, {url: `${origin}/catalog?search_text=${encodeURIComponent(n.q)}&order=newest_first`});
      await waitComplete(tab.id); await new Promise(r => setTimeout(r, 2500));
      const [res] = await chrome.scripting.executeScript({target: {tabId: tab.id}, func: readCatalogDom});
      scan[n.id] = {now, items: res?.result?.items || []};
      // annonces suivies absentes de cette page : à vérifier (15 max par niche et par passage)
      const recs = Object.values((T.items || {})[n.id] || {});
      const onPage = new Set(scan[n.id].items.map(i => i.id));
      const todo = recs.filter(r => !r.sold && !r.gone && !onPage.has(r.id) && (!r.lastCheck || now - r.lastCheck > 6 * 3600e3))
        .sort((a, b) => (a.lastCheck || 0) - (b.lastCheck || 0)).slice(0, 15).map(r => r.id);
      if (todo.length) { const [c] = await chrome.scripting.executeScript({target: {tabId: tab.id}, func: checkItemsSold, args: [todo]}); checks[n.id] = c?.result || {}; }
    }
  } finally { try { await chrome.tabs.remove(tab.id); } catch {} }
  // on relit les données (elles ont pu changer pendant le scan) puis on fusionne
  const fresh = await CR.loadData();
  const FT = fresh.tracker || (fresh.tracker = {niches: [], items: {}});
  FT.items = FT.items || {};
  let found = 0, soldNow = 0;
  for (const n of niches){
    if (!FT.niches.some(x => x.id === n.id)) continue;
    const box = FT.items[n.id] || (FT.items[n.id] = {});
    const s = scan[n.id]; if (!s) continue;
    for (const it of s.items){
      const r = box[it.id] || (box[it.id] = {id: it.id, firstSeen: s.now});
      Object.assign(r, {title: it.title || r.title, price: it.price, brand: it.brand || r.brand, size: it.size || r.size, status: it.status || r.status,
        fav: Math.max(it.fav || 0, r.fav || 0), url: it.url || r.url, photo: it.photo || r.photo, lastSeen: s.now});
      found++;
    }
    for (const [id, st] of Object.entries(checks[n.id] || {})){
      const r = box[id]; if (!r) continue;
      r.lastCheck = s.now;
      if (st === "sold") { r.sold = true; r.soldAt = s.now; soldNow++; }
      if (st === "gone") r.gone = true;
    }
    // on garde au plus 600 annonces par niche (les plus anciennes non vendues partent d'abord)
    const all = Object.values(box);
    if (all.length > 600) all.sort((a, b) => (b.sold - a.sold) || (b.lastSeen - a.lastSeen)).slice(600).forEach(r => delete box[r.id]);
    const nn = FT.niches.find(x => x.id === n.id); nn.lastScan = s.now; nn.lastCount = s.items.length;
  }
  FT.lastRun = Date.now();
  await CR.saveData(fresh);
  try { await CRCloud.push(fresh); } catch {}
  return `${found} annonces vues, ${soldNow} ventes détectées`;
}

chrome.runtime.onInstalled.addListener(schedule);
chrome.runtime.onStartup.addListener(schedule);
chrome.alarms.onAlarm.addListener(a => { if (a.name === ALARM) runSync("auto"); });
chrome.runtime.onMessage.addListener((m, _s, reply) => {
  if (m?.type === "reschedule") { schedule().then(() => reply({ok: true})); return true; }
  if (m?.type === "sync-now") { runSync("manuel").then(reply); return true; }
  if (m?.type === "track-now") { runTracker(m.niche).then(msg => reply({ok: true, msg}), e => reply({ok: false, msg: e.message})); return true; }
});
