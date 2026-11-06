"use strict";
/* ---------- utilitaires ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const eur = n => (Number(n)||0).toLocaleString("fr-FR",{style:"currency",currency:"EUR"});
const eur0 = n => (Number(n)||0).toLocaleString("fr-FR",{style:"currency",currency:"EUR",maximumFractionDigits:0});
const num = v => { const n = parseFloat(String(v).replace(",", ".")); return isNaN(n) ? 0 : n; };
const today = () => new Date().toISOString().slice(0,10);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,7);
const days = d => d ? Math.floor((Date.now() - new Date(d).getTime()) / 86400000) : null;
const fdate = d => d ? new Date(d).toLocaleDateString("fr-FR",{day:"2-digit",month:"short"}) : "—";
const round5 = n => Math.round(n*2)/2;
const MONTHS = ["janv.","févr.","mars","avr.","mai","juin","juil.","août","sept.","oct.","nov.","déc."];
const STATUS = {stock:"En stock", listed:"En ligne", reserved:"Réservé", sold:"Vendu"};
const SHIP = {to_ship:"À expédier", shipped:"Expédié", delivered:"Livré", done:"Terminé"};
const PLATFORMS = ["Vinted","eBay","leboncoin","Vestiaire","Depop"];
const CONDITIONS = ["Neuf avec étiquette","Neuf sans étiquette","Très bon état","Bon état","Satisfaisant"];
const VIEWS = [
  ["dashboard","Tableau de bord"],["stock","Stock"],["ventes","Ventes"],["poster","Poster (IA)"],["prix","Estimer un prix"],["tracker","Tracker"],
  ["agents","Agents"],["compta","Compta"],["reglages","Réglages"]
];
const DEFAULT_SETTINGS = {
  accounts:["Compte principal"], model:"claude-opus-5-5", vintedUid:"",
  fees:{Vinted:0, eBay:13, leboncoin:0, Vestiaire:15, Depop:10},
  offerAccept:90, offerTiers:[95,92,90], offerFloor:75,
  repostDays:7, dormantDays:45, priceDropPct:10, autoSyncMinutes:120, favDiscount:10, favMode:"eur", favAmount:5, favCooldown:3, targetMult:2, minMarginEur:10, vintedOrigin:"https://www.vinted.fr",
  style:"Je tutoie, ton chaleureux et court, je signe avec un merci.",
  templates:{
    accept:"Bonjour {pseudo} ! C'est d'accord pour {offre}, je t'envoie ça dès le paiement reçu. Merci !",
    counter:"Bonjour {pseudo} ! Je ne peux pas descendre à {offre}, mais je peux te le faire à {contre}. Ça te va ?",
    decline:"Bonjour {pseudo}, merci pour ton offre mais {offre} c'est trop bas pour cet article. Je peux le faire à {contre} si ça t'intéresse.",
    favorite:"Coucou {pseudo} ! Je vois que tu as mis « {article} » en favori. Je peux te le faire à {prix} au lieu de {prixInitial} si tu le prends aujourd'hui.",
    shipped:"Bonjour {pseudo} ! Ton colis « {article} » est parti aujourd'hui. Bonne réception et merci pour ton achat !",
    review:"Merci encore {pseudo} ! Si tout te plaît, une petite évaluation m'aiderait beaucoup."
  }
};

/* ---------- état ---------- */
const S = {
  items:[], expenses:[], settings:structuredClone(DEFAULT_SETTINGS),
  view:"dashboard", stockFilter:"all", stockPlat:"", stockQ:"", sel:new Set(),
  shipFilter:"to_ship", agentTab:"offres", year:new Date().getFullYear(),
  sim:{itemId:"", price:"", offer:"", round:1, pseudo:""},
  poster:{notes:"", brand:"", size:"", condition:"Très bon état", category:"", photos:[], out:null, busy:false, err:""},
  msg:{text:"", itemId:"", out:"", busy:false},
  loaded:{items:false, expenses:false, settings:false}, dbOk:null
};
let pendingRender = false, apiKey = "", lastVintedSync = null, persistT = null, writing = false;

/* ---------- persistance (chrome.storage dans l'extension, localStorage ailleurs) ---------- */
function persist(){
  clearTimeout(persistT);
  persistT = setTimeout(async () => {
    writing = true;
    const d = {items:S.items, expenses:S.expenses, settings:S.settings, lastVintedSync, favLeads:S.favLeads||[], tracker:S.tracker||{niches:[], items:{}}};
    try { await CR.saveData(d); localStamp = d.updatedAt; }
    catch(e){ toast("Enregistrement impossible : " + (e.message || "stockage indisponible")); }
    setTimeout(() => { writing = false; }, 300);
    clearTimeout(pushT);
    pushT = setTimeout(async () => {
      try { if (await CRCloud.push(d)) { cloudState = "ok"; cloudErr = ""; } }
      catch(e){ cloudState = "err"; cloudErr = e.message; }
      footState();
    }, 1500);
  }, 250);
}
let pushT = null, localStamp = 0, cloudState = "", cloudErr = "", cloudCfg = {};
/* Récupère les changements faits ailleurs (téléphone, synchro auto du PC) */
async function pullCloud(silent){
  cloudCfg = await CRCloud.cfg();
  if (!CRCloud.connected(cloudCfg)) { cloudState = ""; footState(); return; }
  try {
    const remote = await CRCloud.pull();
    cloudState = "ok"; cloudErr = "";
    if (remote && remote.updatedAt > localStamp) {
      const d = {...remote.data, updatedAt: remote.updatedAt};
      await CR.saveData(d, true); localStamp = remote.updatedAt;
      applyData(d); render(); if (!silent) toast("Données mises à jour depuis la base en ligne");
    } else if (!remote && S.items.length) { await CRCloud.push(await CR.loadData()); }
  } catch(e) { cloudState = "err"; cloudErr = e.message; }
  footState();
}
async function saveItem(it){
  const i = S.items.findIndex(x => x.id === it.id);
  if (i >= 0) S.items[i] = it; else S.items.push(it);
  render(); persist();
}
async function delItem(id){ S.items = S.items.filter(x => x.id !== id); S.sel.delete(id); render(); persist(); }
async function saveExpense(x){
  const i = S.expenses.findIndex(e => e.id === x.id);
  if (i >= 0) S.expenses[i] = x; else S.expenses.push(x);
  render(); persist();
}
async function delExpense(id){ S.expenses = S.expenses.filter(x => x.id !== id); render(); persist(); }
async function saveSettings(){ render(); persist(); }
function applyData(d){
  S.items = Array.isArray(d.items) ? d.items : [];
  S.expenses = Array.isArray(d.expenses) ? d.expenses : [];
  const st = d.settings || {};
  S.settings = {...structuredClone(DEFAULT_SETTINGS), ...st, fees:{...DEFAULT_SETTINGS.fees, ...(st.fees||{})}, templates:{...DEFAULT_SETTINGS.templates, ...(st.templates||{})}};
  lastVintedSync = d.lastVintedSync || null;
  S.favLeads = Array.isArray(d.favLeads) ? d.favLeads : [];
  S.tracker = d.tracker && typeof d.tracker === "object" ? d.tracker : {niches:[], items:{}};
}

/* ---------- calculs ---------- */
const feePct = p => num(S.settings.fees?.[p] ?? 0);
const isSold = it => it.status === "sold" && it.sale;
const profitOf = it => isSold(it) ? num(it.sale.price) - num(it.buyPrice) - num(it.sale.fees) - num(it.sale.shipping) : 0;
function estMargin(it){
  const p = (it.platforms && it.platforms[0]) || "Vinted";
  const price = num(it.listPrice);
  return price - num(it.buyPrice) - price*feePct(p)/100;
}
const unsold = () => S.items.filter(i => i.status !== "sold");
const sold = () => S.items.filter(isSold);
function monthKey(d){ return d ? d.slice(0,7) : ""; }
function monthStats(key){
  const s = sold().filter(i => monthKey(i.sale.date) === key);
  const ca = s.reduce((a,i)=>a+num(i.sale.price),0);
  const cost = s.reduce((a,i)=>a+num(i.buyPrice),0);
  const fees = s.reduce((a,i)=>a+num(i.sale.fees)+num(i.sale.shipping),0);
  const exp = S.expenses.filter(e => monthKey(e.date) === key).reduce((a,e)=>a+num(e.amount),0);
  const purchases = S.items.filter(i => monthKey(i.buyDate) === key).reduce((a,i)=>a+num(i.buyPrice),0);
  return {n:s.length, ca, cost, fees, exp, purchases, profit: ca-cost-fees, net: ca-cost-fees-exp};
}
function lastMonths(n){
  const out = []; const d = new Date(); d.setDate(1);
  for (let k=n-1; k>=0; k--){ const x = new Date(d.getFullYear(), d.getMonth()-k, 1); out.push({key:`${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,"0")}`, label:MONTHS[x.getMonth()]}); }
  return out;
}
function fill(tpl, vars){ return String(tpl||"").replace(/\{(\w+)\}/g, (m,k) => vars[k] ?? m); }

/* Agent Offres : décision par paliers */
function decideOffer(price, offer, round, minPrice){
  const st = S.settings, P = num(price), O = num(offer);
  const tiers = (st.offerTiers||[]).map(num).filter(Boolean).sort((a,b)=>b-a);
  const floor = Math.max(P*num(st.offerFloor)/100, num(minPrice));
  if (!P || !O) return null;
  const ratio = O/P*100;
  if (ratio >= num(st.offerAccept) && O >= floor) return {kind:"accept", amount:O, ratio, why:`L'offre fait ${ratio.toFixed(0)} % du prix, au-dessus de ton seuil d'acceptation (${st.offerAccept} %).`};
  const tierPct = tiers[Math.min(Math.max(1,round)-1, tiers.length-1)] ?? st.offerAccept;
  let counter = Math.max(round5(P*tierPct/100), floor);
  if (counter <= O) return {kind:"accept", amount:O, ratio, why:`Ton palier n°${round} (${tierPct} %) donne ${eur(counter)}, l'offre est au-dessus : tu acceptes.`};
  if (O < floor) return {kind:"decline", amount:O, counter:round5(counter), ratio, why:`L'offre est sous ton prix plancher (${eur(floor)}). Refus poli avec une contre-proposition au palier n°${round}.`};
  return {kind:"counter", amount:O, counter:round5(counter), ratio, why:`L'offre fait ${ratio.toFixed(0)} % du prix. Palier n°${round} : contre-offre à ${tierPct} %.`};
}

/* Automatismes : tâches générées à partir des règles */
function buildTasks(){
  const st = S.settings, T = [];
  const toShip = sold().filter(i => i.sale.shipStatus === "to_ship");
  if (toShip.length) T.push({lvl:"bad", title:`${toShip.length} colis à expédier`, sub:toShip.slice(0,3).map(i=>i.title).join(", ")+(toShip.length>3?"…":""), act:"go-ship", label:"Voir les ventes"});
  const late = sold().filter(i => i.sale.shipStatus === "shipped" && days(i.sale.shippedAt||i.sale.date) >= 5);
  if (late.length) T.push({lvl:"warn", title:`${late.length} colis expédiés depuis plus de 5 jours`, sub:"Vérifie le suivi ou passe-les en « Livré ».", act:"go-shipped", label:"Vérifier"});
  const due = repostQueue();
  if (due.length) T.push({lvl:"warn", title:`${due.length} annonces à reposter`, sub:`Pas remontées depuis ${st.repostDays} jours ou plus.`, act:"go-repost", label:"File de repost"});
  const favs = favQueue();
  if (favs.length) T.push({lvl:"good", title:`${favs.length} articles avec des favoris à relancer`, sub:`Offre conseillée : ${favLabel()} pour déclencher l'achat.`, act:"go-fav", label:"Relancer"});
  const dorm = dormant();
  if (dorm.length) T.push({lvl:"warn", title:`${dorm.length} articles dorment depuis plus de ${st.dormantDays} jours`, sub:`Baisse automatique de ${st.priceDropPct} %, sans passer sous ton prix minimum.`, act:"drop-dormant", label:`Baisser de ${st.priceDropPct} %`});
  const noCost = S.items.filter(i => i.needsCost);
  if (noCost.length) T.push({lvl:"info", title:`${noCost.length} articles importés de Vinted sans prix d'achat`, sub:"Renseigne ce que tu les as payés pour avoir ta vraie marge.", act:"go-stock-nocost", label:"Compléter"});
  const notListed = S.items.filter(i => i.status === "stock");
  if (notListed.length) T.push({lvl:"info", title:`${notListed.length} articles pas encore en ligne`, sub:"Rédige l'annonce avec l'IA puis marque-les en ligne.", act:"go-stock-stock", label:"Voir"});
  return T;
}
function repostQueue(){ return S.items.filter(i => i.status === "listed" && days(i.lastRepostAt || i.listedAt) >= num(S.settings.repostDays)); }
function favQueue(){ return S.items.filter(i => i.status === "listed" && num(i.favorites) > 0 && (i.lastFavNudgeAt ? days(i.lastFavNudgeAt) >= num(S.settings.favCooldown) : true)); }
function dormant(){ return S.items.filter(i => i.status === "listed" && days(i.listedAt) >= num(S.settings.dormantDays) && (!i.lastDropAt || days(i.lastDropAt) >= 14)); }
function dropPrice(it, pct){
  const np = round5(num(it.listPrice)*(1-pct/100));
  const floor = num(it.minPrice) || 0;
  return Math.max(np, floor);
}

/* ---------- rendu ---------- */
function render(){
  const ae = document.activeElement;
  if (ae && $("#main").contains(ae) && /INPUT|TEXTAREA|SELECT/.test(ae.tagName) && ae.type !== "checkbox") { pendingRender = true; renderNav(); return; }
  pendingRender = false;
  renderNav();
  const fn = {dashboard:vDashboard, stock:vStock, ventes:vSales, poster:vPoster, prix:vPrice, tracker:vTracker, agents:vAgents, compta:vCompta, reglages:vSettings}[S.view] || vDashboard;
  $("#main").innerHTML = banner() + fn();
  afterRender();
}
document.addEventListener("focusout", () => setTimeout(() => { if (pendingRender) render(); }, 0));
function banner(){
  if (S.view !== "dashboard") return "";
  if (cloudState === "err") return `<div class="banner">Base en ligne : ${esc(cloudErr)} <a href="#reglages">Réglages</a></div>`;
  if (!CRCloud.connected(cloudCfg)) return `<div class="banner">Connecte ton compte en ligne dans <a href="#reglages">Réglages</a> pour retrouver tes données sur ton téléphone et partout.</div>`;
  return "";
}
function renderNav(){
  const counts = {dashboard: buildTasks().length, ventes: sold().filter(i=>i.sale.shipStatus==="to_ship").length};
  $("#nav").innerHTML = VIEWS.map(([k,l]) => `<a href="#${k}" class="${S.view===k?"on":""}">${l}${counts[k]?`<span class="badge">${counts[k]}</span>`:""}</a>`).join("");
}
const statusPill = s => `<span class="pill p-${s}">${STATUS[s]||s}</span>`;
const shipPill = s => `<span class="pill p-${s}">${SHIP[s]||s}</span>`;
const plats = arr => (arr||[]).map(p=>`<span class="plat">${esc(p)}</span>`).join("");
function loading(){ return !S.loaded.items ? `<div class="card empty">Chargement de tes données…</div>` : ""; }
const thumb = i => i.photo ? `<img class="thumb" src="${esc(i.photo)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : "";

/* Tableau de bord */
function vDashboard(){
  const months = lastMonths(6);
  const cur = monthStats(months[5].key), prev = monthStats(months[4].key);
  const stockVal = unsold().reduce((a,i)=>a+num(i.buyPrice),0);
  const potential = unsold().reduce((a,i)=>a+num(i.listPrice),0);
  const listed = S.items.filter(i=>i.status==="listed").length;
  const sellTimes = sold().map(i => (new Date(i.sale.date) - new Date(i.listedAt||i.buyDate))/86400000).filter(x=>x>=0);
  const avgSell = sellTimes.length ? Math.round(sellTimes.reduce((a,b)=>a+b,0)/sellTimes.length) : null;
  const marginPct = cur.ca ? Math.round(cur.profit/cur.ca*100) : 0;
  const delta = (a,b) => b ? `${a>=b?"+":""}${Math.round((a-b)/Math.abs(b)*100)} % vs mois dernier` : "premier mois suivi";
  const tasks = buildTasks();
  const recent = sold().sort((a,b)=>b.sale.date.localeCompare(a.sale.date)).slice(0,6);
  const hello = new Date().toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"});
  return `
  <div class="head"><div><h1>Tableau de bord</h1><p>${hello.charAt(0).toUpperCase()+hello.slice(1)} · ${S.settings.accounts.length} compte${S.settings.accounts.length>1?"s":""} suivi${S.settings.accounts.length>1?"s":""}</p></div>
  <div class="row"><button class="btn" data-act="new-expense">+ Dépense</button><button class="btn pri" data-act="new-item">+ Ajouter un article</button></div></div>
  ${loading()}
  <div class="kpis">
    <div class="kpi"><span>Chiffre d'affaires du mois</span><b>${eur0(cur.ca)}</b><small>${delta(cur.ca, prev.ca)}</small></div>
    <div class="kpi"><span>Bénéfice brut du mois</span><b class="${cur.profit>=0?"pos":"neg"}">${eur0(cur.profit)}</b><small>Marge ${marginPct} % · ${cur.n} vente${cur.n>1?"s":""}</small></div>
    <div class="kpi"><span>Stock (prix d'achat)</span><b>${eur0(stockVal)}</b><small>${unsold().length} articles · ${eur0(potential)} en vitrine</small></div>
    <div class="kpi"><span>Annonces en ligne</span><b>${listed}</b><small>${repostQueue().length} à reposter</small></div>
    <div class="kpi"><span>Délai moyen de vente</span><b>${avgSell===null?"—":avgSell+" j"}</b><small>de la mise en ligne à la vente</small></div>
  </div>
  <div class="grid g2">
    <div class="card"><div class="row"><h2>À faire aujourd'hui</h2><span class="sp"></span><span class="note">générées par tes règles</span></div>
      <div class="tasks">${tasks.length ? tasks.map(t=>`<div class="task"><span class="bar ${t.lvl}"></span><div><b>${esc(t.title)}</b><small>${esc(t.sub)}</small></div><button class="btn sm" data-act="${t.act}">${esc(t.label)}</button></div>`).join("") : `<div class="empty">Rien d'urgent. Tes annonces tournent toutes seules.</div>`}</div>
    </div>
    <div class="card chart"><div class="row"><h2>6 derniers mois</h2><span class="sp"></span><div class="legend"><span><i style="background:var(--accent-soft);border:1px solid var(--accent)"></i>CA</span><span><i style="background:var(--accent)"></i>Bénéfice</span></div></div>
      ${chart(months.map(m=>({label:m.label, ...monthStats(m.key)})))}
    </div>
  </div>
  <div class="card"><div class="row"><h2>Dernières ventes</h2><span class="sp"></span><a class="btn sm" href="#ventes">Tout voir</a></div>
    ${recent.length ? `<div class="tbl" style="border:0"><table><thead><tr><th>Date</th><th>Article</th><th>Plateforme</th><th class="n">Prix</th><th class="n">Bénéfice</th><th>Livraison</th></tr></thead><tbody>
    ${recent.map(i=>`<tr><td>${fdate(i.sale.date)}</td><td><div class="t-title">${esc(i.title)}</div><div class="t-sub">${esc(i.sale.buyer||"")}</div></td><td>${esc(i.sale.platform)}</td><td class="n">${eur(i.sale.price)}</td><td class="n ${profitOf(i)>=0?"pos":"neg"}">${eur(profitOf(i))}</td><td>${shipPill(i.sale.shipStatus)}</td></tr>`).join("")}
    </tbody></table></div>` : `<div class="empty">Aucune vente enregistrée pour l'instant.</div>`}
  </div>`;
}
function chart(data){
  const W=520, H=210, pl=46, pb=26, pt=12, pr=8;
  const max = Math.max(50, ...data.map(d=>d.ca));
  const step = niceStep(max/4); const top = Math.ceil(max/step)*step;
  const y = v => pt + (H-pt-pb) * (1 - v/top);
  const bw = (W-pl-pr)/data.length;
  let g = "";
  for (let v=0; v<=top; v+=step) g += `<line x1="${pl}" x2="${W-pr}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-width="1"/><text x="${pl-6}" y="${y(v)+4}" text-anchor="end" font-size="11" fill="var(--muted)">${v.toLocaleString("fr-FR")} €</text>`;
  const bars = data.map((d,i)=>{
    const x = pl + i*bw + bw*0.18, w = bw*0.64, last = i===data.length-1;
    const pf = Math.max(0,d.profit);
    return `<rect x="${x}" y="${y(d.ca)}" width="${w}" height="${y(0)-y(d.ca)}" rx="3" fill="var(--accent-soft)" stroke="var(--accent)" stroke-width="${last?1.5:.75}"/>
    <rect x="${x+w*0.22}" y="${y(pf)}" width="${w*0.56}" height="${y(0)-y(pf)}" rx="2" fill="var(--accent)"/>
    ${last && d.ca ? `<text x="${x+w/2}" y="${y(d.ca)-5}" text-anchor="middle" font-size="11.5" font-weight="600" fill="var(--ink)">${Math.round(d.ca)} €</text>`:""}
    <text x="${x+w/2}" y="${H-8}" text-anchor="middle" font-size="11.5" fill="${last?"var(--ink)":"var(--muted)"}">${d.label}</text>`;
  }).join("");
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Chiffre d'affaires et bénéfice par mois">${g}${bars}</svg>`;
}
function niceStep(x){ const p = Math.pow(10, Math.floor(Math.log10(x||1))); const f = x/p; return (f<=1?1:f<=2?2:f<=5?5:10)*p; }

/* Stock */
function vStock(){
  const f = S.stockFilter, q = S.stockQ.toLowerCase();
  let list = S.items.filter(i => (f==="all" || i.status===f || (f==="nocost" && i.needsCost)) && (!S.stockPlat || (i.platforms||[]).includes(S.stockPlat)) && (!q || [i.title,i.brand,i.sku,i.size,i.category].join(" ").toLowerCase().includes(q)));
  list.sort((a,b)=> (a.status==="sold") - (b.status==="sold") || (b.buyDate||"").localeCompare(a.buyDate||""));
  const cnt = k => k==="all" ? S.items.length : k==="nocost" ? S.items.filter(i=>i.needsCost).length : S.items.filter(i=>i.status===k).length;
  const sel = [...S.sel].filter(id => S.items.some(i=>i.id===id));
  const ageCls = d => d>=S.settings.dormantDays ? "age-old" : d>=S.settings.dormantDays/2 ? "age-mid" : "";
  return `
  <div class="head"><div><h1>Stock</h1><p>Prix d'achat, SKU et marge, article par article.</p></div>
  <button class="btn pri" data-act="new-item">+ Ajouter un article</button></div>
  <div class="row">
    <div class="chips">${["all","stock","listed","reserved","sold","nocost"].filter(k=>k!=="nocost"||cnt(k)).map(k=>`<button class="chip ${f===k?"on":""}" data-act="sf" data-v="${k}">${k==="all"?"Tous":k==="nocost"?"Sans prix d'achat":STATUS[k]}<span class="c">${cnt(k)}</span></button>`).join("")}</div>
    <span class="sp"></span>
    <select id="stockPlat" aria-label="Plateforme"><option value="">Toutes plateformes</option>${PLATFORMS.map(p=>`<option ${S.stockPlat===p?"selected":""}>${p}</option>`).join("")}</select>
    <input type="search" id="stockQ" placeholder="Rechercher titre, marque, SKU…" value="${esc(S.stockQ)}">
  </div>
  ${sel.length ? `<div class="bulk"><b>${sel.length} sélectionné${sel.length>1?"s":""}</b><span class="sp"></span>
    <button class="btn sm" data-act="b-list">Mettre en ligne</button>
    <button class="btn sm" data-act="b-repost">Marquer reposté</button>
    <span class="row" style="gap:4px">−<input type="number" id="bPct" value="${S.settings.priceDropPct}" min="1" max="90" aria-label="Pourcentage de baisse">%<button class="btn sm" data-act="b-drop">Baisser</button></span>
    <span class="row" style="gap:4px"><input type="number" id="bSet" placeholder="€" aria-label="Nouveau prix"><button class="btn sm" data-act="b-set">Fixer le prix</button></span>
    <button class="btn sm" data-act="b-del">Supprimer</button>
    <button class="btn sm" data-act="b-clear">Annuler</button></div>` : ""}
  ${loading()}
  ${list.length ? `<div class="tbl"><table><thead><tr><th><input type="checkbox" data-act="selall" aria-label="Tout sélectionner" ${sel.length && sel.length===list.length?"checked":""}></th><th>Article</th><th>Statut</th><th class="n">Achat</th><th class="n">Prix</th><th class="n">Marge est.</th><th class="n">Âge</th><th>Dernier repost</th><th class="n">Fav.</th><th>Plateformes</th><th></th></tr></thead><tbody>
  ${list.map(i=>{ const age = days(i.buyDate)||0; const m = i.status==="sold" ? profitOf(i) : estMargin(i);
    return `<tr><td><input type="checkbox" data-act="sel" data-id="${i.id}" ${S.sel.has(i.id)?"checked":""} aria-label="Sélectionner ${esc(i.title)}"></td>
    <td><div class="tcell">${thumb(i)}<div><div class="t-title">${esc(i.title)}</div><div class="t-sub">${[i.brand,i.size,i.condition,i.sku].filter(Boolean).map(esc).join(" · ")}${i.vintedUrl?` · <a href="${esc(i.vintedUrl)}" target="_blank" rel="noopener">voir sur Vinted</a>`:""}</div></div></div></td>
    <td>${statusPill(i.status)}</td><td class="n">${i.needsCost?`<span class="pill warnpill">à saisir</span>`:eur(i.buyPrice)}</td><td class="n">${i.status==="sold"?eur(i.sale.price):eur(i.listPrice)}</td>
    <td class="n ${m>=0?"pos":"neg"}">${eur(m)}${num(i.buyPrice)&&i.status!=="sold"?`<div class="t-sub">×${(num(i.listPrice)/num(i.buyPrice)).toFixed(1)}</div>`:""}</td>
    <td class="n ${i.status==="sold"?"":ageCls(age)}">${age} j</td>
    <td>${i.status==="listed"?(i.lastRepostAt?fdate(i.lastRepostAt):`<span class="mut">jamais</span>`)+(i.repostCount?` <span class="t-sub">(${i.repostCount}×)</span>`:""):"—"}</td>
    <td class="n">${num(i.favorites)||"—"}</td><td>${plats(i.platforms)}</td>
    <td class="n"><button class="btn sm ghost" data-act="edit" data-id="${i.id}">Modifier</button>${i.status!=="sold"?`<button class="btn sm" data-act="sell" data-id="${i.id}">Vendu</button>`:`<button class="btn sm" data-act="relist" data-id="${i.id}">Republier</button>`}</td></tr>`;}).join("")}
  </tbody></table></div>` : (S.loaded.items || S.dbOk===false ? `<div class="card empty">${S.items.length?"Aucun article ne correspond à ce filtre.":"Ton stock est vide. Ajoute ton premier article ou passe par Poster (IA)."}</div>`:"")}`;
}

/* Ventes */
function vSales(){
  const all = sold().sort((a,b)=>b.sale.date.localeCompare(a.sale.date));
  const f = S.shipFilter;
  const list = f==="all" ? all : all.filter(i=>i.sale.shipStatus===f);
  const c = k => all.filter(i=>i.sale.shipStatus===k).length;
  return `
  <div class="head"><div><h1>Ventes</h1><p>Chaque vente avec sa livraison, son bénéfice et ses messages prêts à copier.</p></div>
  <div class="row"><button class="btn" data-act="export-csv">Exporter en CSV</button><button class="btn pri" data-act="quick-sale">+ Enregistrer une vente</button></div></div>
  <div class="funnel">${Object.keys(SHIP).map(k=>`<div class="${f===k?"on":""}" data-act="shf" data-v="${k}" role="button" tabindex="0"><b>${c(k)}</b><span>${SHIP[k]}</span></div>`).join("")}</div>
  <div class="row"><button class="chip ${f==="all"?"on":""}" data-act="shf" data-v="all">Toutes les ventes <span class="c">${all.length}</span></button></div>
  ${list.length ? `<div class="tbl"><table><thead><tr><th>Date</th><th>Article</th><th>Plateforme</th><th>Acheteur</th><th class="n">Prix</th><th class="n">Frais</th><th class="n">Bénéfice</th><th>Livraison</th><th></th></tr></thead><tbody>
  ${list.map(i=>`<tr><td>${fdate(i.sale.date)}</td><td><div class="tcell">${thumb(i)}<div><div class="t-title">${esc(i.title)}</div><div class="t-sub">${esc(i.sale.account||"")}${i.sku?" · "+esc(i.sku):""}${i.sale.vintedStatus?` · Vinted : « ${esc(i.sale.vintedStatus)} »`:""}</div></div></div></td>
  <td>${esc(i.sale.platform)}</td><td>${esc(i.sale.buyer||"—")}</td><td class="n">${eur(i.sale.price)}</td><td class="n mut">${eur(num(i.sale.fees)+num(i.sale.shipping))}</td>
  <td class="n ${profitOf(i)>=0?"pos":"neg"}">${eur(profitOf(i))}</td>
  <td><select data-act="ship" data-id="${i.id}" aria-label="Statut de livraison">${Object.entries(SHIP).map(([k,l])=>`<option value="${k}" ${i.sale.shipStatus===k?"selected":""}>${l}</option>`).join("")}</select></td>
  <td class="n"><button class="btn sm" data-act="relist" data-id="${i.id}">Republier</button><button class="btn sm ghost" data-act="copy-ship" data-id="${i.id}">Message</button><button class="btn sm ghost" data-act="invoice" data-id="${i.id}">Facture</button><button class="btn sm ghost" data-act="edit-sale" data-id="${i.id}">Modifier</button></td></tr>`).join("")}
  </tbody></table></div>` : `<div class="card empty">${all.length?"Aucune vente dans ce statut.":"Aucune vente pour l'instant. Clique « Vendu » sur un article du stock."}</div>`}`;
}

/* Poster IA */
function vPoster(){
  const P = S.poster, o = P.out;
  return `
  <div class="head"><div><h1>Poster</h1><p>Crée la fiche une fois, copie-la sur chaque plateforme.</p></div></div>
  <div class="grid g2">
    <div class="card" style="display:flex;flex-direction:column;gap:12px">
      <h2>L'article</h2>
      <label class="drop" for="photoIn">Ajoute jusqu'à 4 photos : l'IA lit la marque, la matière et l'état<input type="file" id="photoIn" accept="image/*" multiple hidden></label>
      ${P.relist?`<div class="banner">Remise en vente de « ${esc(P.relist.title)} » (vendu ${eur(P.relist.price)} le ${fdate(P.relist.date)}). Ajoute les photos de la paire que tu remets en vente, puis lance la rédaction : l'IA écrit une annonce neuve.</div>`:""}
      ${P.photos.length?`<div class="photos">${P.photos.map((p,ix)=>`<div style="display:flex;flex-direction:column;gap:4px;align-items:center"><img src="${p.url}" alt="Photo ${ix+1} de l'article"><div class="row" style="gap:2px"><button class="btn sm ghost" data-act="ph-rot" data-v="${ix}" title="Pivoter de 90°" aria-label="Pivoter la photo ${ix+1}">↻</button><button class="btn sm ghost" data-act="ph-sq" data-v="${ix}" title="Recadrer en carré" aria-label="Recadrer la photo ${ix+1} en carré">▢</button><button class="btn sm ghost" data-act="ph-lum" data-v="${ix}" title="Éclaircir" aria-label="Éclaircir la photo ${ix+1}">☀</button><button class="btn sm ghost danger" data-act="ph-del" data-v="${ix}" title="Retirer" aria-label="Retirer la photo ${ix+1}">×</button></div></div>`).join("")}</div>
      <div class="row"><button class="btn sm" data-act="ph-dl">Télécharger les photos retouchées</button><button class="btn sm ghost" data-act="clear-photos">Tout retirer</button></div>`:""}
      <div class="form">
        <label class="f">Marque<input type="text" id="pBrand" value="${esc(P.brand)}" placeholder="ex. Levi's"></label>
        <label class="f">Taille<input type="text" id="pSize" value="${esc(P.size)}" placeholder="ex. M / 38 / W32"></label>
        <label class="f">État<select id="pCond">${CONDITIONS.map(c=>`<option ${P.condition===c?"selected":""}>${c}</option>`).join("")}</select></label>
        <label class="f">Catégorie<input type="text" id="pCat" value="${esc(P.category)}" placeholder="ex. Jean, veste, sneakers"></label>
        <label class="f full">Ce que tu sais sur l'article<textarea id="pNotes" placeholder="Couleur, matière, défauts, mesures, prix payé…">${esc(P.notes)}</textarea></label>
      </div>
      <div class="row"><button class="btn pri" data-act="gen-listing" ${P.busy?"disabled":""}>${P.busy?"Rédaction en cours…":"Rédiger avec l'IA"}</button><button class="btn" data-act="tpl-listing">Fiche modèle sans IA</button></div>
      ${P.err?`<div class="banner">${esc(P.err)}</div>`:""}
    </div>
    <div class="card" style="display:flex;flex-direction:column;gap:12px">
      <h2>L'annonce</h2>
      ${o ? `
      <label class="f">Titre<input type="text" id="oTitle" value="${esc(o.title)}"></label>
      <label class="f">Description<textarea id="oDesc" rows="8">${esc(o.description)}</textarea></label>
      <div class="form"><label class="f">Prix conseillé (€)<input type="number" id="oPrice" value="${esc(o.price)}"></label><label class="f">Hashtags<input type="text" id="oTags" value="${esc((o.hashtags||[]).join(" "))}"></label></div>
      ${o.priceWhy?`<p class="note">${esc(o.priceWhy)}</p>`:""}
      <h3>Copier pour</h3>
      <div class="row">${PLATFORMS.map(p=>`<button class="btn sm" data-act="copy-plat" data-v="${p}">${p}</button>`).join("")}</div>
      <p class="note">eBay : titre coupé à 80 caractères. leboncoin et Vestiaire : sans hashtags.</p>
      <div class="row"><button class="btn pri" data-act="publish-vinted">Publier sur Vinted</button><span class="sp"></span><button class="btn" data-act="listing-to-stock">Ajouter au stock</button></div>
      <p class="note" style="margin:0">« Publier sur Vinted » ouvre le formulaire de vente avec le titre, la description, le prix et les photos déjà remplis. Tu choisis la catégorie, la marque et la taille, puis tu cliques « Ajouter ».</p>`
      : `<div class="empty">Remplis la fiche à gauche puis lance la rédaction. Le titre, la description, les hashtags et un prix conseillé apparaîtront ici.</div>`}
    </div>
  </div>`;
}

/* Agents */
function vAgents(){
  const st = S.settings, t = S.agentTab;
  const head = `
  <div class="head"><div><h1>Agents</h1><p>Tes règles de négociation, de relance et de repost, appliquées article par article.</p></div></div>
  <div class="grid g3">
    <div class="card agent"><span class="dot"></span><div><h3>Agent Offres</h3><div class="note">Accepte dès ${st.offerAccept} %, paliers ${st.offerTiers.join(" / ")} %, plancher ${st.offerFloor} %</div></div></div>
    <div class="card agent"><span class="dot"></span><div><h3>Agent Favoris</h3><div class="note">${favQueue().length} à relancer · offre ${favLabel()}, pause ${st.favCooldown} j</div></div></div>
    <div class="card agent"><span class="dot"></span><div><h3>Repost</h3><div class="note">Tous les ${st.repostDays} j · ${repostQueue().length} annonces dues</div></div></div>
  </div>
  <div class="tabs" role="tablist">${[["offres","Offres"],["favoris","Favoris"],["repost","Repost"],["messages","Messages"]].map(([k,l])=>`<button class="${t===k?"on":""}" data-act="atab" data-v="${k}" role="tab">${l}</button>`).join("")}</div>`;
  return head + ({offres:aOffers, favoris:aFavs, repost:aRepost, messages:aMessages}[t])();
}
function listedOptions(sel){ return S.items.filter(i=>i.status==="listed"||i.status==="reserved").map(i=>`<option value="${i.id}" ${sel===i.id?"selected":""}>${esc(i.title)} · ${eur(i.listPrice)}</option>`).join(""); }
function aOffers(){
  const s = S.sim, it = S.items.find(i=>i.id===s.itemId);
  const price = it ? it.listPrice : s.price;
  const r = decideOffer(price, s.offer, num(s.round)||1, it?.minPrice);
  let res = `<div class="result"><span class="note">Saisis le prix et l'offre reçue pour voir la réponse de l'agent.</span></div>`;
  if (r){
    const vars = {pseudo:s.pseudo||"", offre:eur(r.amount), contre:eur(r.counter||r.amount), article:it?.title||"l'article"};
    const msg = fill(S.settings.templates[r.kind], vars).replace(/ !/g," !").replace("Bonjour  ","Bonjour ");
    const lbl = {accept:"Accepter", counter:`Contre-offre à ${eur(r.counter)}`, decline:`Refuser · proposer ${eur(r.counter)}`}[r.kind];
    res = `<div class="result ${r.kind}"><h2>${lbl}</h2><p style="margin:4px 0 10px">${esc(r.why)}</p><div class="msg" id="offerMsg">${esc(msg)}</div>
    <div class="row" style="margin-top:10px"><button class="btn sm" data-act="copy-el" data-v="offerMsg">Copier le message</button>${r.kind==="accept"&&it?`<button class="btn sm pri" data-act="sell-at" data-id="${it.id}" data-v="${r.amount}">Enregistrer la vente à ${eur(r.amount)}</button>`:""}${r.kind!=="accept"?`<button class="btn sm" data-act="round-next">Nouvelle offre (palier ${Math.min((num(s.round)||1)+1, S.settings.offerTiers.length)})</button>`:""}</div></div>`;
  }
  return `<div class="grid g2"><div class="card" style="display:flex;flex-direction:column;gap:12px"><h2>Offre reçue</h2>
    <div class="form">
      <label class="f full">Article<select id="simItem"><option value="">Prix saisi à la main</option>${listedOptions(s.itemId)}</select></label>
      ${it?"":`<label class="f">Prix affiché (€)<input type="number" id="simPrice" value="${esc(s.price)}"></label>`}
      <label class="f">Offre de l'acheteur (€)<input type="number" id="simOffer" value="${esc(s.offer)}"></label>
      <label class="f">Pseudo de l'acheteur<input type="text" id="simPseudo" value="${esc(s.pseudo)}"></label>
      <label class="f">Tour de négociation<select id="simRound">${S.settings.offerTiers.map((p,ix)=>`<option value="${ix+1}" ${num(s.round)===ix+1?"selected":""}>${ix+1}ᵉ offre · palier ${p} %</option>`).join("")}</select></label>
    </div>
    ${it?`<p class="note">Prix affiché ${eur(it.listPrice)}${it.minPrice?` · minimum fixé ${eur(it.minPrice)}`:""} · acheté ${eur(it.buyPrice)}</p>`:""}
    <button class="btn pri" data-act="sim-run" style="align-self:flex-start">Calculer la réponse</button>
  </div>
  <div style="display:flex;flex-direction:column;gap:12px">${res}<p class="note">Les seuils se règlent dans Réglages. L'agent ne descend jamais sous le prix minimum de l'article ni sous ton plancher.</p></div></div>`;
}
function aFavs(){
  const q = favQueue(), st = S.settings;
  const leads = (S.favLeads||[]).filter(l => !l.done).slice().reverse();
  const leadsHtml = `<div class="card"><div class="row"><h2>Ils ont mis ton article en favori</h2><span class="sp"></span><span class="note">lu à chaque synchro Vinted</span></div>
    ${leads.length ? `<div class="tasks">${leads.slice(0,40).map(l => { const x = S.items.find(i => String(i.vintedId) === String(l.itemVintedId));
      return `<div class="task" style="grid-template-columns:auto 1fr auto">${x?thumb(x):"<span></span>"}<div><b>${esc(l.login||"Un membre")}${x?` · ${esc(x.title)}`:""}</b><small>${esc(l.text)}${x?` · offre conseillée <b>${eur(favPrice(x))}</b> au lieu de ${eur(x.listPrice)}`:""}</small></div>
      <div class="row" style="gap:4px"><button class="btn sm" data-act="lead-copy" data-id="${esc(l.id)}">Copier le message</button>${l.link?`<a class="btn sm" href="${esc(l.link.startsWith("http")?l.link:(l.origin||st.vintedOrigin)+l.link)}" target="_blank" rel="noopener">Ouvrir</a>`:""}<button class="btn sm pri" data-act="lead-done" data-id="${esc(l.id)}">Envoyé</button></div></div>`; }).join("")}</div>`
    : `<div class="empty">Personne en attente. Lance « Lire mon compte Vinted » pour récupérer les nouveaux favoris.</div>`}
    <p class="note">Ouvre la conversation, colle le message, envoie l'offre à ${favLabel()} avec le bouton d'offre de Vinted, puis clique « Envoyé ».</p></div>`;
  if (!q.length) return leadsHtml + `<div class="card empty">Aucun article avec des favoris à relancer.</div>`;
  return leadsHtml + `<div class="tbl"><table><thead><tr><th>Article</th><th class="n">Favoris</th><th class="n">Prix</th><th class="n">Offre conseillée</th><th class="n">Marge après remise</th><th></th></tr></thead><tbody>
  ${q.map(i=>{ const np = favPrice(i); const m = np - num(i.buyPrice);
  return `<tr><td><div class="t-title">${esc(i.title)}</div><div class="t-sub">${i.lastFavNudgeAt?"Relancé le "+fdate(i.lastFavNudgeAt):"Jamais relancé"}</div></td><td class="n">${i.favorites}</td><td class="n">${eur(i.listPrice)}</td><td class="n"><b>${eur(np)}</b></td><td class="n ${m>=0?"pos":"neg"}">${eur(m)}</td>
  <td class="n"><button class="btn sm" data-act="copy-fav" data-id="${i.id}">Copier le message</button><button class="btn sm pri" data-act="fav-done" data-id="${i.id}">Relancé</button></td></tr>`;}).join("")}
  </tbody></table></div><p class="note">Envoie l'offre depuis l'appli de la plateforme, puis clique « Relancé » : l'article sort de la liste pendant ${st.favCooldown} jours.</p>`;
}
function aRepost(){
  const q = repostQueue();
  if (!q.length) return `<div class="card empty">Toutes tes annonces sont à jour. Prochain passage dès qu'une annonce dépasse ${S.settings.repostDays} jours.</div>`;
  return `<div class="row"><span class="note">${q.length} annonces dues. Republie-les sur la plateforme, puis valide ici pour relancer le compteur.</span><span class="sp"></span><button class="btn pri" data-act="repost-all">Tout marquer reposté</button></div>
  <div class="tbl"><table><thead><tr><th>Article</th><th>Mise en ligne</th><th>Dernier repost</th><th class="n">Reposts</th><th class="n">Prix</th><th></th></tr></thead><tbody>
  ${q.map(i=>`<tr><td><div class="t-title">${esc(i.title)}</div><div class="t-sub">${plats(i.platforms)}</div></td><td>${fdate(i.listedAt)} <span class="t-sub">(${days(i.listedAt)} j)</span></td><td>${i.lastRepostAt?fdate(i.lastRepostAt)+` <span class="t-sub">(${days(i.lastRepostAt)} j)</span>`:"jamais"}</td><td class="n">${i.repostCount||0}</td><td class="n">${eur(i.listPrice)}</td>
  <td class="n"><button class="btn sm" data-act="repost-one" data-id="${i.id}">Reposté</button></td></tr>`).join("")}
  </tbody></table></div>`;
}
function aMessages(){
  const m = S.msg, T = S.settings.templates;
  const names = {accept:"Accepter une offre", counter:"Contre-offre", decline:"Refus d'offre", favorite:"Relance favori", shipped:"Colis expédié", review:"Demande d'évaluation"};
  return `<div class="grid g2"><div class="card" style="display:flex;flex-direction:column;gap:12px"><h2>Répondre à un acheteur</h2>
    <label class="f">Message reçu<textarea id="mText" placeholder="Colle ici le message de l'acheteur">${esc(m.text)}</textarea></label>
    <label class="f">Article concerné<select id="mItem"><option value="">Aucun en particulier</option>${listedOptions(m.itemId)}</select></label>
    <div class="row"><button class="btn pri" data-act="gen-reply" ${m.busy?"disabled":""}>${m.busy?"Rédaction…":"Rédiger la réponse dans mon style"}</button></div>
    ${m.out?`<div class="msg" id="replyOut">${esc(m.out)}</div><div class="row"><button class="btn sm" data-act="copy-el" data-v="replyOut">Copier</button></div>`:""}
    <p class="note">Ton style : « ${esc(S.settings.style)} » (modifiable dans Réglages).</p>
  </div>
  <div class="card"><h2>Réponses toutes prêtes</h2><div class="tasks">${Object.entries(T).map(([k,v])=>`<div class="task" style="grid-template-columns:1fr auto"><div><b>${names[k]||k}</b><small>${esc(v)}</small></div><button class="btn sm" data-act="copy-tpl" data-v="${k}">Copier</button></div>`).join("")}</div></div></div>`;
}

/* Compta */
function vCompta(){
  const y = S.year, rows = [];
  for (let m=0;m<12;m++){ const key=`${y}-${String(m+1).padStart(2,"0")}`; rows.push({label:MONTHS[m], key, ...monthStats(key)}); }
  const tot = rows.reduce((a,r)=>{ for (const k of ["n","ca","cost","fees","exp","purchases","profit","net"]) a[k]=(a[k]||0)+r[k]; return a; },{});
  const byPlat = {}; sold().filter(i=>i.sale.date.startsWith(String(y))).forEach(i=>{ const p=i.sale.platform||"Autre"; byPlat[p]=byPlat[p]||{n:0,ca:0,pr:0}; byPlat[p].n++; byPlat[p].ca+=num(i.sale.price); byPlat[p].pr+=profitOf(i); });
  const exps = S.expenses.filter(e=>(e.date||"").startsWith(String(y))).sort((a,b)=>b.date.localeCompare(a.date));
  const years = [...new Set([new Date().getFullYear(), ...S.items.flatMap(i=>[i.buyDate,i.sale?.date]).filter(Boolean).map(d=>+d.slice(0,4))])].sort();
  return `
  <div class="head"><div><h1>Compta</h1><p>Ta marge réelle : ventes, coût des articles, frais et dépenses.</p></div>
  <div class="row"><select id="yearSel" aria-label="Année">${years.map(v=>`<option ${v===y?"selected":""}>${v}</option>`).join("")}</select><button class="btn" data-act="export-csv">Exporter les ventes</button><button class="btn pri" data-act="new-expense">+ Dépense</button></div></div>
  <div class="kpis">
    <div class="kpi"><span>CA ${y}</span><b>${eur0(tot.ca)}</b><small>${tot.n} ventes</small></div>
    <div class="kpi"><span>Achats de stock ${y}</span><b>${eur0(tot.purchases)}</b><small>argent sorti pour acheter</small></div>
    <div class="kpi"><span>Dépenses</span><b>${eur0(tot.exp)}</b><small>emballages, abonnements…</small></div>
    <div class="kpi"><span>Bénéfice net</span><b class="${tot.net>=0?"pos":"neg"}">${eur0(tot.net)}</b><small>marge ${tot.ca?Math.round(tot.net/tot.ca*100):0} %</small></div>
  </div>
  <div class="tbl"><table><thead><tr><th>Mois</th><th class="n">Ventes</th><th class="n">CA</th><th class="n">Coût des vendus</th><th class="n">Frais</th><th class="n">Dépenses</th><th class="n">Bénéfice net</th><th class="n">Achats stock</th></tr></thead><tbody>
  ${rows.map(r=>`<tr><td>${r.label}</td><td class="n">${r.n||"—"}</td><td class="n">${r.ca?eur(r.ca):"—"}</td><td class="n mut">${r.cost?eur(r.cost):"—"}</td><td class="n mut">${r.fees?eur(r.fees):"—"}</td><td class="n mut">${r.exp?eur(r.exp):"—"}</td><td class="n ${r.net>0?"pos":r.net<0?"neg":""}">${r.ca||r.exp?eur(r.net):"—"}</td><td class="n">${r.purchases?eur(r.purchases):"—"}</td></tr>`).join("")}
  <tr><td><b>Total</b></td><td class="n"><b>${tot.n}</b></td><td class="n"><b>${eur(tot.ca)}</b></td><td class="n">${eur(tot.cost)}</td><td class="n">${eur(tot.fees)}</td><td class="n">${eur(tot.exp)}</td><td class="n"><b>${eur(tot.net)}</b></td><td class="n">${eur(tot.purchases)}</td></tr>
  </tbody></table></div>
  <div class="grid g2">
    <div class="card"><h2>Par plateforme</h2>${Object.keys(byPlat).length?`<table><thead><tr><th>Plateforme</th><th class="n">Ventes</th><th class="n">CA</th><th class="n">Bénéfice</th></tr></thead><tbody>${Object.entries(byPlat).map(([p,v])=>`<tr><td>${esc(p)}</td><td class="n">${v.n}</td><td class="n">${eur(v.ca)}</td><td class="n">${eur(v.pr)}</td></tr>`).join("")}</tbody></table>`:`<div class="empty">Pas encore de ventes cette année.</div>`}</div>
    <div class="card"><h2>Dépenses</h2>${exps.length?`<table><tbody>${exps.map(e=>`<tr><td>${fdate(e.date)}</td><td>${esc(e.label)}<div class="t-sub">${esc(e.category||"")}</div></td><td class="n">${eur(e.amount)}</td><td class="n"><button class="btn sm ghost danger" data-act="del-exp" data-id="${e.id}">Supprimer</button></td></tr>`).join("")}</tbody></table>`:`<div class="empty">Aucune dépense enregistrée.</div>`}</div>
  </div>
  <p class="note">Indicatif : vérifie tes obligations de déclaration (micro-entreprise, seuils de déclaration des plateformes) avec un professionnel.</p>`;
}

/* Réglages */
function vSettings(){
  const st = S.settings, demo = S.items.filter(i=>i.demo).length + S.expenses.filter(e=>e.demo).length;
  const T = st.templates;
  const tn = {accept:"Accepter une offre", counter:"Contre-offre", decline:"Refus d'offre", favorite:"Relance favori", shipped:"Colis expédié", review:"Demande d'évaluation"};
  return `
  <div class="head"><div><h1>Réglages</h1><p>Les règles que suivent tes agents.</p></div><button class="btn pri" data-act="save-settings">Enregistrer</button></div>
  ${demo?`<div class="banner row"><span>${demo} éléments d'exemple sont chargés pour te montrer l'app.</span><span class="sp"></span><button class="btn sm" data-act="del-demo">Supprimer les exemples</button></div>`:""}
  <div class="grid g2">
    <div class="card"><h2>Comptes et plateformes</h2><div class="form">
      <label class="f full">Comptes (séparés par des virgules)<input type="text" id="sAcc" value="${esc(st.accounts.join(", "))}"></label>
      ${PLATFORMS.map(p=>`<label class="f">Frais vendeur ${p} (%)<input type="number" step="0.1" id="fee_${p}" value="${st.fees[p]??0}"></label>`).join("")}
    </div></div>
    <div class="card"><h2>Agent Offres</h2><div class="form">
      <label class="f">Accepter dès (% du prix)<input type="number" id="sAccept" value="${st.offerAccept}"></label>
      <label class="f">Plancher absolu (% du prix)<input type="number" id="sFloor" value="${st.offerFloor}"></label>
      <label class="f full">Paliers de contre-offre (%, du 1er au dernier tour)<input type="text" id="sTiers" value="${st.offerTiers.join(", ")}"></label>
    </div></div>
    <div class="card"><h2>Repost, dormants, favoris</h2><div class="form">
      <label class="f">Reposter tous les (jours)<input type="number" id="sRepost" value="${st.repostDays}"></label>
      <label class="f">Article dormant après (jours)<input type="number" id="sDorm" value="${st.dormantDays}"></label>
      <label class="f">Baisse des dormants (%)<input type="number" id="sDrop" value="${st.priceDropPct}"></label>
      <label class="f">Type d'offre favoris<select id="sFavMode"><option value="eur" ${st.favMode!=="pct"?"selected":""}>Montant fixe (€)</option><option value="pct" ${st.favMode==="pct"?"selected":""}>Pourcentage (%)</option></select></label>
      <label class="f">Remise favoris en €<input type="number" step="0.5" id="sFavEur" value="${st.favAmount}"></label>
      <label class="f">Remise favoris en %<input type="number" id="sFav" value="${st.favDiscount}"></label>
      <label class="f">Revendre au moins × (prix d'achat)<input type="number" step="0.1" id="sMult" value="${st.targetMult}"></label>
      <label class="f">Marge minimum par article (€)<input type="number" id="sMinM" value="${st.minMarginEur}"></label>
      <label class="f">Pause entre deux relances (jours)<input type="number" id="sFavCd" value="${st.favCooldown}"></label>
    </div></div>
    <div class="card"><h2>Ton style de réponse</h2><label class="f">Décris comment tu écris à tes acheteurs<textarea id="sStyle">${esc(st.style)}</textarea></label></div>
  </div>
  <div class="card"><h2>Messages types</h2><p class="note">Variables : {pseudo} {article} {offre} {contre} {prix} {prixInitial}</p><div class="form">
    ${Object.keys(T).map(k=>`<label class="f">${tn[k]||k}<textarea id="tpl_${k}" rows="3">${esc(T[k])}</textarea></label>`).join("")}
  </div></div>
  <div class="row"><span class="sp"></span><button class="btn pri" data-act="save-settings">Enregistrer les réglages</button></div>
  <div class="grid g3">
    <div class="card" style="display:flex;flex-direction:column;gap:10px"><h2>IA (Claude)</h2>
      <p class="note" style="margin:0">Pour rédiger les annonces et les réponses. Crée une clé sur console.anthropic.com, paiement à l'usage. Elle reste sur cet appareil et n'est jamais exportée.</p>
      <label class="f">Clé API<input type="text" id="sKey" value="${apiKey?"••••••••"+esc(apiKey.slice(-4)):""}" placeholder="sk-ant-…" autocomplete="off"></label>
      <label class="f">Modèle<select id="sModel">${[["claude-opus-5-5","Claude Opus 5.5 (meilleure qualité)"],["claude-sonnet-5-5","Claude Sonnet 5.5 (équilibré)"],["claude-haiku-5-5","Claude Haiku 5.5 (le moins cher)"]].map(([v,l])=>`<option value="${v}" ${st.model===v?"selected":""}>${l}</option>`).join("")}</select></label>
      <div class="row"><button class="btn sm pri" data-act="save-key">Enregistrer la clé</button>${apiKey?`<button class="btn sm danger" data-act="del-key">Retirer</button>`:""}</div>
    </div>
    <div class="card" style="display:flex;flex-direction:column;gap:10px"><h2>Vinted</h2>
      <p class="note" style="margin:0">${CR.hasChrome ? (lastVintedSync ? "Dernière synchro : "+new Date(lastVintedSync).toLocaleString("fr-FR") : "Pas encore synchronisé.") : "La synchro Vinted tourne depuis l'extension Chrome de ton PC."}</p>
      <label class="f">Synchro automatique<select id="sAuto">${[[0,"Désactivée"],[30,"Toutes les 30 min"],[60,"Toutes les heures"],[120,"Toutes les 2 h"],[240,"Toutes les 4 h"]].map(([v,l])=>`<option value="${v}" ${Number(st.autoSyncMinutes)===v?"selected":""}>${l}</option>`).join("")}</select></label>
      <p class="note" style="margin:0" id="autoLog">${esc(S.autoLog ? `Dernière synchro auto (${new Date(S.autoLog.at).toLocaleString("fr-FR")}) : ${S.autoLog.msg}` : "Aucune synchro auto pour l'instant. Elle tourne quand ton PC est allumé avec Chrome ouvert.")}</p>
      ${CR.hasChrome?`<button class="btn sm" data-act="sync-now" style="align-self:flex-start">Synchroniser maintenant</button>`:""}
      <label class="f">ID membre Vinted<input type="text" id="sUid" value="${esc(st.vintedUid||"")}" placeholder="détecté automatiquement"></label>
    </div>
    <div class="card" style="display:flex;flex-direction:column;gap:10px"><h2>Accès partout (Supabase)</h2>
      ${CRCloud.connected(cloudCfg) ? `<p style="margin:0">Connecté : <b>${esc(cloudCfg.email||"")}</b> ${cloudState==="ok"?`<span class="pill p-sold">synchronisé</span>`:cloudState==="err"?`<span class="pill p-to_ship">erreur</span>`:""}</p>
        ${cloudErr?`<p class="note" style="margin:0">${esc(cloudErr)}</p>`:""}
        <div class="row"><button class="btn sm" data-act="cloud-pull">Récupérer maintenant</button><button class="btn sm danger" data-act="cloud-out">Se déconnecter</button></div>`
      : `<p class="note" style="margin:0">Pour retrouver ton tableau de bord sur ton téléphone. Choisis un email et un mot de passe, puis clique « Créer mon compte ». Ensuite, utilise les mêmes sur chaque appareil.</p>
        <input type="hidden" id="cUrl" value="${esc(cloudCfg.url||"")}"><input type="hidden" id="cKey" value="${esc(cloudCfg.key||"")}">
        <label class="f">Email<input type="text" id="cEmail" autocomplete="username"></label>
        <label class="f">Mot de passe<input type="password" id="cPw" autocomplete="current-password"></label>
        <div class="row"><button class="btn sm pri" data-act="cloud-in">Se connecter</button><button class="btn sm" data-act="cloud-up">Créer mon compte</button></div>`}
    </div>
    <div class="card" style="display:flex;flex-direction:column;gap:10px"><h2>Sauvegarde</h2>
      <p class="note" style="margin:0">${S.items.length} articles, ${S.expenses.length} dépenses. Exporte un fichier pour garder une copie ou passer sur un autre ordinateur.</p>
      <div class="row"><button class="btn sm" data-act="export-json">Exporter (.json)</button><button class="btn sm" data-act="import-json">Importer…</button></div>
    </div>
  </div>`;
}

/* ---------- modales ---------- */
function modal(html){ $("#modal").innerHTML = `<div class="modal-bg" data-act="close-bg"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`; const f = $("#modal input, #modal select"); if (f) f.focus(); }
function closeModal(){ $("#modal").innerHTML = ""; if (pendingRender) render(); }
function itemModal(it){
  const n = !it; it = it || {id:uid(), status:"stock", buyDate:today(), platforms:["Vinted"], condition:"Très bon état", account:S.settings.accounts[0], favorites:0};
  modal(`<h2>${n?"Nouvel article":"Modifier l'article"}</h2>
  <form id="itemForm" class="form" data-id="${it.id}" data-new="${n?1:0}">
    <label class="f full">Titre<input type="text" name="title" required value="${esc(it.title)}"></label>
    <label class="f">Marque<input type="text" name="brand" value="${esc(it.brand)}"></label>
    <label class="f">Taille<input type="text" name="size" value="${esc(it.size)}"></label>
    <label class="f">Catégorie<input type="text" name="category" value="${esc(it.category)}"></label>
    <label class="f">État<select name="condition">${CONDITIONS.map(c=>`<option ${it.condition===c?"selected":""}>${c}</option>`).join("")}</select></label>
    <label class="f">Prix d'achat (€)<input type="number" step="0.01" name="buyPrice" value="${esc(it.buyPrice)}"></label>
    <label class="f">Date d'achat<input type="date" name="buyDate" value="${esc(it.buyDate)}"></label>
    <label class="f">Acheté où<input type="text" name="buySource" value="${esc(it.buySource)}" placeholder="Vide-grenier, Vinted, friperie…"></label>
    <label class="f">SKU<input type="text" name="sku" value="${esc(it.sku || ("A-"+String(S.items.length+1).padStart(3,"0")))}"></label>
    <label class="f">Prix de vente affiché (€)<input type="number" step="0.5" name="listPrice" value="${esc(it.listPrice)}"></label>
    <label class="f">Prix minimum accepté (€)<input type="number" step="0.5" name="minPrice" value="${esc(it.minPrice)}"></label>
    <label class="f">Statut<select name="status">${Object.entries(STATUS).filter(([k])=>k!=="sold"||it.status==="sold").map(([k,l])=>`<option value="${k}" ${it.status===k?"selected":""}>${l}</option>`).join("")}</select></label>
    <label class="f">Compte<select name="account">${S.settings.accounts.map(a=>`<option ${it.account===a?"selected":""}>${esc(a)}</option>`).join("")}</select></label>
    <label class="f">Favoris<input type="number" name="favorites" value="${esc(it.favorites||0)}"></label>
    <div class="f full"><span class="note">Plateformes</span><div class="checks">${PLATFORMS.map(p=>`<label><input type="checkbox" name="plat" value="${p}" ${(it.platforms||[]).includes(p)?"checked":""}>${p}</label>`).join("")}</div></div>
    <label class="f full">Description / notes<textarea name="notes">${esc(it.notes)}</textarea></label>
    <p class="note full" id="marginPrev"></p>
    <div class="acts full">${n?"":`<button type="button" class="btn danger" data-act="del-item" data-id="${it.id}">Supprimer</button><span class="sp"></span>`}<button type="button" class="btn" data-act="close">Annuler</button><button class="btn pri">Enregistrer</button></div>
  </form>`);
  const upd = () => { const f = $("#itemForm"); const bp = num(f.buyPrice.value), lp = num(f.listPrice.value); const p = [...f.querySelectorAll("[name=plat]:checked")][0]?.value || "Vinted"; const m = lp - bp - lp*feePct(p)/100; $("#marginPrev").innerHTML = lp ? `Marge estimée sur ${p} : <b class="${m>=0?"pos":"neg"}">${eur(m)}</b>${bp?` (×${(lp/bp).toFixed(1)})`:""}` : ""; };
  $("#itemForm").addEventListener("input", upd); upd();
}
function readItemForm(f, base){
  const g = k => f[k].value.trim();
  const it = {...base, title:g("title"), brand:g("brand"), size:g("size"), category:g("category"), condition:g("condition"), buyPrice:num(g("buyPrice")), buyDate:g("buyDate"), buySource:g("buySource"), sku:g("sku"), listPrice:num(g("listPrice")), minPrice:num(g("minPrice")), account:g("account"), favorites:num(g("favorites")), notes:g("notes"), platforms:[...f.querySelectorAll("[name=plat]:checked")].map(x=>x.value)};
  const status = g("status");
  if (it.buyPrice > 0) it.needsCost = false;
  if (status === "listed" && base.status !== "listed" && !base.listedAt) it.listedAt = today();
  if (status === "listed" && !it.listedAt) it.listedAt = today();
  it.status = status;
  return it;
}
function sellModal(it, presetPrice){
  const s = it.sale || {};
  const plat = s.platform || (it.platforms||[])[0] || "Vinted";
  const price = presetPrice ?? s.price ?? it.listPrice ?? "";
  modal(`<h2>${it.sale?"Modifier la vente":"Enregistrer la vente"}</h2><p class="note" style="margin:0">${esc(it.title)} · acheté ${eur(it.buyPrice)}</p>
  <form id="sellForm" class="form" data-id="${it.id}">
    <label class="f">Prix de vente (€)<input type="number" step="0.01" name="price" required value="${esc(price)}"></label>
    <label class="f">Date<input type="date" name="date" value="${esc(s.date||today())}"></label>
    <label class="f">Plateforme<select name="platform">${PLATFORMS.map(p=>`<option ${plat===p?"selected":""}>${p}</option>`).join("")}<option ${plat==="Main propre"?"selected":""}>Main propre</option></select></label>
    <label class="f">Compte<select name="account">${S.settings.accounts.map(a=>`<option ${(s.account||it.account)===a?"selected":""}>${esc(a)}</option>`).join("")}</select></label>
    <label class="f">Frais de plateforme (€)<input type="number" step="0.01" name="fees" value="${esc(s.fees ?? round5(num(price)*feePct(plat)/100))}"></label>
    <label class="f">Port à ta charge (€)<input type="number" step="0.01" name="shipping" value="${esc(s.shipping??0)}"></label>
    <label class="f">Acheteur<input type="text" name="buyer" value="${esc(s.buyer)}"></label>
    <label class="f">Livraison<select name="shipStatus">${Object.entries(SHIP).map(([k,l])=>`<option value="${k}" ${(s.shipStatus||"to_ship")===k?"selected":""}>${l}</option>`).join("")}</select></label>
    <p class="note full" id="profitPrev"></p>
    <div class="acts full">${it.sale?`<button type="button" class="btn danger" data-act="unsell" data-id="${it.id}">Annuler la vente</button><span class="sp"></span>`:""}<button type="button" class="btn" data-act="close">Annuler</button><button class="btn pri">Enregistrer</button></div>
  </form>`);
  const f = $("#sellForm");
  const upd = e => { if (e && (e.target.name==="platform"||e.target.name==="price") && !it.sale) f.fees.value = round5(num(f.price.value)*feePct(f.platform.value)/100); const p = num(f.price.value)-num(it.buyPrice)-num(f.fees.value)-num(f.shipping.value); $("#profitPrev").innerHTML = `Bénéfice : <b class="${p>=0?"pos":"neg"}">${eur(p)}</b>`; };
  f.addEventListener("input", upd); upd();
}
function quickSaleModal(){
  const opts = unsold().map(i=>`<option value="${i.id}">${esc(i.title)} · ${eur(i.listPrice)}</option>`).join("");
  if (!opts) { toast("Aucun article en stock à vendre. Ajoute d'abord un article."); return; }
  modal(`<h2>Quel article as-tu vendu ?</h2><label class="f">Article<select id="qsItem">${opts}</select></label><div class="acts"><button class="btn" data-act="close">Annuler</button><button class="btn pri" data-act="qs-go">Continuer</button></div>`);
}
function expenseModal(){
  modal(`<h2>Nouvelle dépense</h2><form id="expForm" class="form">
  <label class="f full">Libellé<input type="text" name="label" required placeholder="Sachets d'envoi, abonnement, essence…"></label>
  <label class="f">Montant (€)<input type="number" step="0.01" name="amount" required></label>
  <label class="f">Date<input type="date" name="date" value="${today()}"></label>
  <label class="f full">Catégorie<select name="category"><option>Emballage</option><option>Abonnement</option><option>Transport</option><option>Mise en avant</option><option>Autre</option></select></label>
  <div class="acts full"><button type="button" class="btn" data-act="close">Annuler</button><button class="btn pri">Ajouter</button></div></form>`);
}

/* ---------- presse-papiers, export, toast ---------- */
async function copy(text){
  try { await navigator.clipboard.writeText(text); toast("Copié"); }
  catch { modal(`<h2>Copie manuelle</h2><textarea rows="8" id="manualCopy">${esc(text)}</textarea><div class="acts"><button class="btn pri" data-act="close">Fermer</button></div>`); $("#manualCopy").select(); }
}
let toastT;
function toast(t){ let el = $(".toast"); if (!el){ el = document.createElement("div"); el.className="toast"; document.body.appendChild(el); } el.textContent = t; clearTimeout(toastT); toastT = setTimeout(()=>el.remove(), 2400); }
function csvSales(){
  const head = ["Date","Article","Marque","SKU","Plateforme","Compte","Acheteur","Prix de vente","Prix d'achat","Frais","Port","Bénéfice","Livraison"];
  const q = v => `"${String(v??"").replace(/"/g,'""')}"`;
  const rows = sold().sort((a,b)=>a.sale.date.localeCompare(b.sale.date)).map(i=>[i.sale.date,i.title,i.brand,i.sku,i.sale.platform,i.sale.account,i.sale.buyer,num(i.sale.price).toFixed(2).replace(".",","),num(i.buyPrice).toFixed(2).replace(".",","),num(i.sale.fees).toFixed(2).replace(".",","),num(i.sale.shipping).toFixed(2).replace(".",","),profitOf(i).toFixed(2).replace(".",","),SHIP[i.sale.shipStatus]].map(q).join(";"));
  return [head.map(q).join(";"), ...rows].join("\n");
}
/* Retouches simples : pivoter 90°, recadrer en carré, éclaircir */
function editPhoto(blob, kind){
  return new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(blob);
    img.onload = () => {
      const c = document.createElement("canvas"), g = c.getContext("2d"), w = img.width, h = img.height;
      if (kind === "ph-rot") { c.width = h; c.height = w; g.translate(h, 0); g.rotate(Math.PI/2); g.drawImage(img, 0, 0); }
      else if (kind === "ph-sq") { const s = Math.min(w, h); c.width = c.height = s; g.drawImage(img, (w-s)/2, (h-s)/2, s, s, 0, 0, s, s); }
      else { c.width = w; c.height = h; g.filter = "brightness(1.12) contrast(1.04)"; g.drawImage(img, 0, 0); }
      URL.revokeObjectURL(url);
      c.toBlob(b => b ? res(b) : rej(new Error()), "image/jpeg", 0.92);
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error()); };
    img.src = url;
  });
}
function offerFile(filename, data){
  const type = filename.endsWith(".csv") ? "text/csv;charset=utf-8" : filename.endsWith(".json") ? "application/json" : "text/html;charset=utf-8";
  const blob = data instanceof Blob ? data : new Blob([filename.endsWith(".csv") ? "﻿" + data : data], {type});
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function invoiceHtml(i){
  return `<!DOCTYPE html><html lang="fr"><meta charset="utf-8"><title>Facture ${esc(i.sku||i.id)}</title><body style="font-family:sans-serif;max-width:640px;margin:40px auto;color:#222">
<h1>Facture</h1><p>N° ${esc((i.sale.date||"").replace(/-/g,""))}-${esc(i.sku||i.id)}<br>Date : ${esc(i.sale.date)}</p>
<p><b>Vendeur :</b> ${esc(i.sale.account||S.settings.accounts[0])}<br><b>Acheteur :</b> ${esc(i.sale.buyer||"")}<br><b>Plateforme :</b> ${esc(i.sale.platform)}</p>
<table style="width:100%;border-collapse:collapse"><tr><th style="text-align:left;border-bottom:1px solid #999">Article</th><th style="text-align:right;border-bottom:1px solid #999">Montant</th></tr>
<tr><td>${esc(i.title)} ${i.brand?"("+esc(i.brand)+")":""}</td><td style="text-align:right">${eur(i.sale.price)}</td></tr>
<tr><td><b>Total</b></td><td style="text-align:right"><b>${eur(i.sale.price)}</b></td></tr></table>
<p style="font-size:12px;color:#666">Vente entre particuliers / TVA non applicable selon ta situation.</p></body></html>`;
}

/* ---------- IA ---------- */
async function genListing(){
  const P = S.poster;
  P.busy = true; P.err = ""; render();
  const prompt = `Tu es un expert de la revente de vêtements et objets d'occasion en France (Vinted, leboncoin, eBay, Vestiaire, Depop).
Rédige une annonce qui vend, en français, à partir de ces infos${P.photos.length?" et des photos jointes":""}.
Marque: ${P.brand||"?"} | Taille: ${P.size||"?"} | État: ${P.condition} | Catégorie: ${P.category||"?"}
Notes du vendeur: ${P.notes||"aucune"}
${P.relist?`Il s'agit d'une remise en vente d'un modèle identique déjà vendu. Ancienne annonce, à NE PAS recopier : titre « ${P.relist.title} », description « ${P.relist.description||""} ». Écris un titre et une description entièrement reformulés, avec une autre structure et d'autres mots, en décrivant l'état de cet exemplaire d'après les notes et les photos.\n`:""}Règles: titre de 60 caractères max avec marque + type + détail clé + taille; description en 4 à 7 lignes courtes (matière, coupe, mesures si connues, état honnête avec défauts, envoi rapide), ton naturel, sans emoji excessif; 5 à 8 hashtags pertinents; un prix de vente conseillé réaliste en euros pour le marché de l'occasion français, avec une justification d'une phrase.
Réponds UNIQUEMENT en JSON: {"title":string,"description":string,"hashtags":[string],"price":number,"priceWhy":string,"category":string}`;
  try {
    const images = [];
    for (const p of P.photos) images.push(await toJpegB64(p.blob));
    const text = await askClaude(prompt, images, 4000);
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("Réponse illisible, réessaie.");
    const out = JSON.parse(m[0]);
    P.out = {title:String(out.title||""), description:String(out.description||""), hashtags:Array.isArray(out.hashtags)?out.hashtags.map(h=>String(h).startsWith("#")?h:"#"+h):[], price:num(out.price)||"", priceWhy:String(out.priceWhy||""), category:String(out.category||P.category)};
  } catch(e) { P.err = e.message || "La rédaction a échoué. Réessaie ou utilise la fiche modèle."; }
  P.busy = false; render();
}
/* Appel direct à l'API Claude avec la clé de l'utilisateur */
async function askClaude(prompt, images = [], maxTokens = 2000){
  if (!apiKey) throw new Error("Ajoute ta clé API Claude dans Réglages pour utiliser l'IA (ou utilise la fiche modèle).");
  const content = [...images.map(data => ({type:"image", source:{type:"base64", media_type:"image/jpeg", data}})), {type:"text", text:prompt}];
  let r;
  try {
    r = await fetch("https://api.anthropic.com/v1/messages", {
      method:"POST",
      headers:{"content-type":"application/json", "x-api-key":apiKey, "anthropic-version":"2023-06-01",
        "anthropic-dangerous-direct-browser-access":"true", "anthropic-beta":"server-side-fallback-2026-07-01"},
      body: JSON.stringify({model:S.settings.model || "claude-opus-5-5", max_tokens:maxTokens, output_config:{effort:"low"}, fallbacks:"default", messages:[{role:"user", content}]})
    });
  } catch { throw new Error("Impossible de joindre l'API Claude. Vérifie ta connexion."); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok){
    if (r.status === 401) throw new Error("Clé API refusée. Vérifie-la dans Réglages.");
    if (r.status === 429) throw new Error("Trop de demandes d'un coup. Réessaie dans une minute.");
    if (r.status === 400 && /credit|billing/i.test(j.error?.message || "")) throw new Error("Crédit API épuisé : recharge ton compte sur console.anthropic.com.");
    throw new Error("Erreur de l'API Claude : " + (j.error?.message || r.status));
  }
  if (j.stop_reason === "refusal") throw new Error("L'IA a refusé cette demande. Reformule tes notes.");
  return (j.content || []).filter(b => b.type === "text").map(b => b.text).join("").trim();
}
/* Réduit la photo (1024 px max) pour limiter le coût */
function toJpegB64(blob){
  return new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(blob);
    img.onload = () => {
      const k = Math.min(1, 1024 / Math.max(img.width, img.height));
      const c = document.createElement("canvas"); c.width = Math.round(img.width*k); c.height = Math.round(img.height*k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      res(c.toDataURL("image/jpeg", 0.85).split(",")[1]);
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("Une photo n'a pas pu être lue.")); };
    img.src = url;
  });
}
function tplListing(){
  const P = S.poster;
  const title = [P.category||"Article", P.brand, P.size?`taille ${P.size}`:""].filter(Boolean).join(" ").slice(0,60);
  P.out = {title, description:`${P.category||"Article"} ${P.brand||""}${P.size?", taille "+P.size:""}.\nÉtat : ${P.condition.toLowerCase()}.\n${P.notes||"Détails sur demande."}\nEnvoi soigné sous 24 à 48 h.\nN'hésite pas à faire une offre ou à regrouper tes achats.`, hashtags:[P.brand,P.category].filter(Boolean).map(t=>"#"+t.toLowerCase().replace(/\s+/g,"")), price:"", priceWhy:"", category:P.category};
  P.err = ""; render();
}
function platText(p){
  const o = S.poster.out; if (!o) return "";
  const tags = (o.hashtags||[]).join(" ");
  if (p === "eBay") return `${o.title.slice(0,80)}\n\n${o.description}`;
  if (p === "leboncoin" || p === "Vestiaire") return `${o.title}\n\n${o.description}`;
  return `${o.title}\n\n${o.description}\n\n${tags}`;
}
async function genReply(){
  const m = S.msg; if (!m.text.trim()) { toast("Colle d'abord le message de l'acheteur."); return; }
  if (!apiKey) { toast("Ajoute ta clé API Claude dans Réglages, ou utilise les réponses toutes prêtes."); return; }
  const it = S.items.find(i=>i.id===m.itemId), st = S.settings;
  m.busy = true; render();
  const ctx = it ? `Article: ${it.title} (${it.brand||""}, taille ${it.size||"?"}, ${it.condition||""}). Prix affiché ${it.listPrice} €. Prix minimum que j'accepte: ${it.minPrice||round5(it.listPrice*st.offerFloor/100)} €. Notes: ${it.notes||""}` : "Pas d'article précis.";
  const prompt = `Tu écris à la place d'un revendeur particulier sur une plateforme de seconde main française. Rédige UNE réponse courte (2 à 4 phrases) au message de l'acheteur.
Style du vendeur: ${st.style}
Règles de négociation: accepte dès ${st.offerAccept} % du prix, contre-offre au-dessus du minimum, ne descends jamais sous le minimum. Ne promets rien que tu ne sais pas (mesures inconnues: propose de vérifier).
${ctx}
Message de l'acheteur: """${m.text}"""
Réponds uniquement avec le texte du message, sans guillemets.`;
  try { m.out = await askClaude(prompt, [], 1500); }
  catch(e){ m.out = ""; toast(e.message || "La rédaction a échoué, réessaie."); }
  m.busy = false; render();
}

/* ---------- Vinted : exécuter du code dans un onglet Vinted ouvert ---------- */
const hasTabs = () => typeof chrome !== "undefined" && chrome.tabs && chrome.scripting;
function waitTab(id){
  return new Promise(res => {
    const done = (tid, info) => { if (tid === id && info.status === "complete") { chrome.tabs.onUpdated.removeListener(done); res(); } };
    chrome.tabs.onUpdated.addListener(done);
    chrome.tabs.get(id, t => { if (t && t.status === "complete") { chrome.tabs.onUpdated.removeListener(done); res(); } });
    setTimeout(() => { chrome.tabs.onUpdated.removeListener(done); res(); }, 20000);
  });
}
async function vintedTab(path, active){
  const origin = S.settings.vintedOrigin || "https://www.vinted.fr";
  if (path) { const t = await chrome.tabs.create({url: origin + path, active: !!active}); await waitTab(t.id); return t; }
  const tabs = await chrome.tabs.query({url: ["fr","be","es","it","de","nl","lu","pt","co.uk","com"].map(d => `https://www.vinted.${d}/*`)});
  if (tabs.length) return tabs[0];
  const t = await chrome.tabs.create({url: origin + "/", active: false}); await waitTab(t.id); return t;
}
async function runInVinted(func, args, path, active){
  if (!hasTabs()) throw new Error("Cette fonction marche seulement dans l'extension Chrome.");
  const tab = await vintedTab(path, active);
  const [r] = await chrome.scripting.executeScript({target:{tabId: tab.id}, func, args});
  return r?.result;
}

/* Recherche des annonces en ligne (exécutée dans l'onglet Vinted, lecture seule) */
async function vintedMarket(q, pages){
  const out = [], log = [];
  for (let p = 1; p <= pages; p++){
    const path = `/api/v2/catalog/items?search_text=${encodeURIComponent(q)}&per_page=96&page=${p}&order=relevance`;
    const r = await fetch(location.origin + path, {credentials:"include", headers:{Accept:"application/json"}});
    log.push(`${r.status} recherche page ${p}`);
    if (!r.ok) break;
    const j = await r.json().catch(() => ({}));
    const list = j.items || [];
    for (const v of list){
      const pr = v.price && typeof v.price === "object" ? v.price.amount : v.price;
      out.push({price: parseFloat(String(pr).replace(",", ".")) || 0, title: v.title || "", brand: v.brand_title || "", size: v.size_title || "",
        status: v.status || "", fav: v.favourite_count || 0, url: v.url || "", photo: v.photo?.url || ""});
    }
    if (!list.length || p >= (j.pagination?.total_pages || 1)) break;
    await new Promise(r => setTimeout(r, 800));
  }
  return {items: out, log};
}
/* Secours : lit la page de résultats Vinted affichée (exécutée dans l'onglet ouvert sur /catalog) */
async function vintedMarketDom(){
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const parseEur = s => { const m = String(s).match(/(\d[\d\s  .]*(?:,\d{1,2})?)\s*€/); return m ? parseFloat(m[1].replace(/[\s  .]/g, "").replace(",", ".")) : 0; };
  let cards = [];
  for (let i = 0; i < 24; i++){
    cards = [...document.querySelectorAll('[data-testid^="product-item-id-"], .feed-grid__item, .new-item-box__container')];
    if (cards.length > 4) break;
    await sleep(500);
  }
  window.scrollTo(0, document.body.scrollHeight); await sleep(1500);
  cards = [...document.querySelectorAll('[data-testid^="product-item-id-"], .feed-grid__item, .new-item-box__container')];
  const seen = new Set(), out = [];
  for (const c of cards){
    const a = c.querySelector('a[href*="/items/"]') || (c.tagName === "A" ? c : null);
    const href = a ? a.href : "";
    if (href && seen.has(href)) continue; seen.add(href);
    const info = (a && (a.getAttribute("title") || a.getAttribute("aria-label"))) || c.querySelector("img")?.alt || "";
    const priceEl = c.querySelector('[data-testid$="price-text"], [data-testid*="--price"]');
    const price = parseEur(priceEl ? priceEl.textContent : (info.match(/prix\s*:?\s*([^,]+,\d{2}\s*€)/i)?.[1] || c.textContent));
    const field = k => (info.match(new RegExp(k + "\\s*:\\s*([^,]+)", "i")) || [])[1]?.trim() || "";
    if (price) out.push({price, title: info.split(",")[0] || "", brand: field("marque"), size: field("taille"), status: field("état"), fav: 0, url: href, photo: c.querySelector("img")?.src || ""});
  }
  return {items: out, log: [`page catalogue : ${cards.length} cartes, ${out.length} prix lus`]};
}
const pct = (arr, p) => { if (!arr.length) return 0; const i = (arr.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return arr[lo] + (arr[hi] - arr[lo]) * (i - lo); };
function priceStats(prices){
  const a = prices.filter(x => x > 0).sort((x, y) => x - y);
  if (!a.length) return null;
  // on écarte les prix aberrants (lots, erreurs de saisie)
  const q1 = pct(a, .25), q3 = pct(a, .75), iqr = q3 - q1;
  const b = a.filter(x => x >= q1 - 1.5*iqr && x <= q3 + 1.5*iqr);
  return {n: a.length, kept: b.length, min: b[0], p25: pct(b, .25), med: pct(b, .5), p75: pct(b, .75), max: b[b.length-1], mean: b.reduce((s, x) => s + x, 0) / b.length};
}
function maxBuyPrice(salePrice, platform){
  const st = S.settings, net = salePrice * (1 - feePct(platform || "Vinted") / 100);
  return Math.max(0, Math.min(net / (num(st.targetMult) || 2), net - num(st.minMarginEur)));
}
function myHistory(q){
  const words = q.toLowerCase().split(/\s+/).filter(w => w.length > 1);
  const hit = S.items.filter(i => words.length && words.every(w => [i.title, i.brand, i.size, i.category].join(" ").toLowerCase().includes(w)));
  const soldHit = hit.filter(isSold);
  const avg = arr => arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : null;
  const sellDays = soldHit.map(i => (new Date(i.sale.date) - new Date(i.listedAt || i.buyDate)) / 864e5).filter(x => x >= 0);
  return {n: hit.length, sold: soldHit.length, buy: avg(hit.filter(i => num(i.buyPrice) > 0).map(i => num(i.buyPrice))), sale: avg(soldHit.map(i => num(i.sale.price))), days: avg(sellDays)};
}
function vPrice(){
  const E = S.est || (S.est = {q:"", cond:"", busy:false, err:"", res:null});
  const r = E.res, st = S.settings;
  let body = `<div class="card empty">Tape ce que tu veux acheter ou vendre, par exemple « UGG Classic Mini 38 » ou « veste Carhartt Detroit ».</div>`;
  if (r){
    const items = E.cond ? r.items.filter(i => norm(i.status).includes(norm(E.cond))) : r.items;
    const s = priceStats(items.map(i => i.price)), h = myHistory(r.q);
    body = s ? `
    <div class="kpis">
      <div class="kpi"><span>Prix moyen sur Vinted</span><b>${eur0(s.mean)}</b><small>médiane ${eur0(s.med)} · ${s.kept} annonces</small></div>
      <div class="kpi"><span>Prix max à afficher</span><b>${eur0(s.p75)}</b><small>75 % des annonces sont en dessous</small></div>
      <div class="kpi"><span>Prix minimum à accepter</span><b>${eur0(s.p25)}</b><small>sous ce prix tu brades</small></div>
      <div class="kpi"><span>Prix d'achat max</span><b class="pos">${eur0(maxBuyPrice(s.med))}</b><small>pour revendre ×${st.targetMult} et garder ${eur0(st.minMarginEur)} mini</small></div>
    </div>
    <div class="grid g2">
      <div class="card"><h2>Ce que ça donne</h2><table><tbody>
        <tr><td>Fourchette des annonces</td><td class="n">${eur(s.min)} → ${eur(s.max)}</td></tr>
        <tr><td>Si tu achètes à ${eur(maxBuyPrice(s.med))} et revends ${eur(s.med)}</td><td class="n pos">+${eur(s.med*(1-feePct("Vinted")/100) - maxBuyPrice(s.med))}</td></tr>
        <tr><td>Si tu revends au prix max (${eur(s.p75)})</td><td class="n pos">+${eur(s.p75*(1-feePct("Vinted")/100) - maxBuyPrice(s.med))}</td></tr>
        <tr><td>Annonces écartées (lots, prix aberrants)</td><td class="n">${s.n - s.kept}</td></tr>
      </tbody></table>
      <p class="note">Ce sont les prix des annonces encore en ligne, pas des ventes conclues : les acheteurs paient souvent un peu moins. Vise la médiane pour vendre vite.</p></div>
      <div class="card"><h2>Ton historique</h2>${h.n ? `<table><tbody>
        <tr><td>Articles similaires suivis</td><td class="n">${h.n} (${h.sold} vendus)</td></tr>
        <tr><td>Ton prix d'achat moyen</td><td class="n">${h.buy===null?"—":eur(h.buy)}</td></tr>
        <tr><td>Ton prix de vente moyen</td><td class="n">${h.sale===null?"—":eur(h.sale)}</td></tr>
        <tr><td>Délai de vente moyen</td><td class="n">${h.days===null?"—":Math.round(h.days)+" j"}</td></tr></tbody></table>` : `<div class="empty">Aucun article similaire dans ton stock pour l'instant.</div>`}</div>
    </div>
    <div class="tbl"><table><thead><tr><th>Annonce</th><th>État</th><th>Taille</th><th class="n">Fav.</th><th class="n">Prix</th></tr></thead><tbody>
    ${items.slice().sort((a,b)=>a.price-b.price).slice(0,60).map(i=>`<tr><td><div class="tcell">${i.photo?`<img class="thumb" src="${esc(i.photo)}" alt="" loading="lazy" referrerpolicy="no-referrer">`:""}<div><div class="t-title">${i.url?`<a href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.title)}</a>`:esc(i.title)}</div><div class="t-sub">${esc(i.brand)}</div></div></div></td><td>${esc(i.status)}</td><td>${esc(i.size)}</td><td class="n">${i.fav||"—"}</td><td class="n">${eur(i.price)}</td></tr>`).join("")}
    </tbody></table></div>` : `<div class="card empty">Aucune annonce trouvée${E.cond?" dans cet état":""}. Essaie des mots plus simples (marque + modèle).</div>`;
  }
  return `
  <div class="head"><div><h1>Estimer un prix</h1><p>Prix moyen, prix max, prix minimum et prix d'achat à ne pas dépasser, d'après les annonces Vinted.</p></div></div>
  <div class="card"><form id="estForm" class="row">
    <input type="search" id="estQ" value="${esc(E.q)}" placeholder="ex. UGG Classic Mini 38" style="flex:1;min-width:200px" aria-label="Article à estimer">
    <select id="estCond" aria-label="État"><option value="">Tous états</option>${CONDITIONS.map(c=>`<option ${E.cond===c?"selected":""}>${c}</option>`).join("")}</select>
    <button class="btn pri" ${E.busy?"disabled":""}>${E.busy?"Recherche…":"Estimer"}</button>
  </form>
  <p class="note" style="margin:8px 0 0">Prix d'achat max calculé pour revendre au moins ×${st.targetMult} et garder ${eur0(st.minMarginEur)} de marge (modifiable dans Réglages).</p>
  ${E.err?`<div class="banner" style="margin-top:8px">${esc(E.err)}</div>`:""}</div>
  ${body}`;
}
const norm = s => String(s||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"");
async function runEstimate(){
  const E = S.est; E.q = $("#estQ").value.trim(); E.cond = $("#estCond").value;
  if (!E.q) { toast("Tape un article à estimer."); return; }
  E.busy = true; E.err = ""; render();
  try {
    let res = null, log = [];
    try { res = await runInVinted(vintedMarket, [E.q, 2]); log = res?.log || []; } catch(e) { log.push("API : " + e.message); }
    if (!res || !res.items.length) {
      // secours : on ouvre la page de recherche Vinted en arrière-plan et on lit les annonces affichées
      const path = `/catalog?search_text=${encodeURIComponent(E.q)}&order=relevance`;
      const dom = await runInVinted(vintedMarketDom, [], path, false);
      log = log.concat(dom?.log || []);
      res = dom;
      try { const tabs = await chrome.tabs.query({url: (S.settings.vintedOrigin || "https://www.vinted.fr") + "/catalog*"}); for (const t of tabs) if (!t.active) chrome.tabs.remove(t.id); } catch {}
    }
    E.res = {q:E.q, items: res?.items || []};
    if (!E.res.items.length) E.err = "Aucun prix lu. Vérifie que tu es connecté sur vinted.fr dans Chrome. Détail : " + log.join(" · ");
  } catch(e) { E.err = e.message || "La recherche a échoué."; }
  E.busy = false; render();
}

/* Pré-remplit le formulaire « Vendre » de Vinted (exécuté dans l'onglet Vinted). Tu valides toi-même. */
async function fillVintedForm(d){
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const pick = sels => { for (const s of sels) { const el = document.querySelector(s); if (el) return el; } return null; };
  const setVal = (el, v) => {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
    el.dispatchEvent(new Event("input", {bubbles:true})); el.dispatchEvent(new Event("change", {bubbles:true})); el.dispatchEvent(new Event("blur", {bubbles:true}));
  };
  const done = [], missing = [];
  let title = null;
  for (let i = 0; i < 30 && !title; i++) { title = pick(['input[name="title"]','#title','input[data-testid*="title"]','input[id*="title"]']); if (!title) await sleep(500); }
  if (title) { setVal(title, d.title); done.push("titre"); } else missing.push("titre");
  const desc = pick(['textarea[name="description"]','#description','textarea[data-testid*="description"]','textarea[id*="description"]','textarea']);
  if (desc) { setVal(desc, d.description); done.push("description"); } else missing.push("description");
  const price = pick(['input[name="price"]','#price','input[data-testid*="price"]','input[id*="price"]']);
  if (price && d.price) { setVal(price, String(d.price).replace(".", ",")); done.push("prix"); } else missing.push("prix");
  const file = pick(['input[type="file"][accept*="image"]','input[type="file"]']);
  if (file && d.photos.length) {
    try {
      const dt = new DataTransfer();
      d.photos.forEach((b64, i) => { const bin = atob(b64), u = new Uint8Array(bin.length); for (let k = 0; k < bin.length; k++) u[k] = bin.charCodeAt(k); dt.items.add(new File([u], `photo-${i+1}.jpg`, {type:"image/jpeg"})); });
      file.files = dt.files; file.dispatchEvent(new Event("change", {bubbles:true})); file.dispatchEvent(new Event("input", {bubbles:true}));
      done.push(d.photos.length + " photos");
    } catch { missing.push("photos"); }
  } else if (d.photos.length) missing.push("photos");
  return {done, missing};
}
async function publishToVinted(){
  readOut(); const o = S.poster.out;
  if (!o || !o.title) { toast("Rédige d'abord l'annonce."); return; }
  if (!hasTabs()) { toast("La publication sur Vinted marche seulement dans l'extension Chrome."); return; }
  toast("Ouverture de Vinted…");
  try {
    const photos = []; for (const p of S.poster.photos) photos.push(await toJpegB64(p.blob));
    const desc = o.description + ((o.hashtags||[]).length ? "\n\n" + o.hashtags.join(" ") : "");
    const r = await runInVinted(fillVintedForm, [{title:o.title, description:desc, price:o.price, photos}], "/items/new", true);
    modal(`<h2>Annonce préparée sur Vinted</h2>
      <p>${r && r.done.length ? "Rempli : " + esc(r.done.join(", ")) + "." : "Je n'ai pas pu remplir le formulaire automatiquement."}${r && r.missing.length ? " À faire toi-même : " + esc(r.missing.join(", ")) + "." : ""}</p>
      <p>Dans l'onglet Vinted, choisis la <b>catégorie</b>, la <b>marque</b>, la <b>taille</b> et l'<b>état</b>, vérifie, puis clique <b>Ajouter</b>.</p>
      ${r && r.missing.length ? `<p class="note">Les champs manquants : utilise les boutons « Copier pour Vinted » et colle-les.</p>` : ""}
      <div class="acts"><button class="btn pri" data-act="close">Compris</button></div>`);
  } catch(e) { toast(e.message || "Impossible d'ouvrir Vinted."); }
}

/* ---------- Tracker de niches ---------- */
async function trackNow(nicheId){
  if (!CR.hasChrome || !chrome.runtime?.sendMessage) { toast("Le scan tourne depuis l'extension Chrome de ton PC."); return; }
  await new Promise(r => setTimeout(r, 400)); // laisse l'enregistrement de la niche se terminer
  toast("Scan Vinted en cours (environ 30 s)…");
  try { const r = await chrome.runtime.sendMessage({type:"track-now", niche:nicheId}); toast(r?.ok ? (r.msg || "Scan terminé") : ("Scan échoué : " + (r?.msg || ""))); }
  catch { toast("Le scan n'a pas pu démarrer : recharge l'extension."); }
}
const dAgo = ms => { const d = Math.floor((Date.now() - ms) / 864e5); return d <= 0 ? "aujourd'hui" : d === 1 ? "hier" : `il y a ${d} j`; };
const dDur = ms => { const h = ms / 3600e3; return h < 24 ? `${Math.max(1, Math.round(h))} h` : `${Math.round(h / 24)} j`; };
function nicheStats(n){
  const recs = Object.values((S.tracker.items || {})[n.id] || {});
  const sold = recs.filter(r => r.sold), live = recs.filter(r => !r.sold && !r.gone);
  const wk = sold.filter(r => Date.now() - r.soldAt < 7 * 864e5);
  const ps = priceStats(sold.map(r => num(r.price)));
  const durs = sold.map(r => r.soldAt - r.firstSeen).filter(x => x > 0).sort((a, b) => a - b);
  const days = recs.length ? Math.max(1, (Date.now() - Math.min(...recs.map(r => r.firstSeen))) / 864e5) : 1;
  return {recs, sold, live, wk: wk.length, perDay: sold.length / days, med: ps ? ps.med : null, p25: ps?.p25, p75: ps?.p75, dur: durs.length ? pct(durs, .5) : null,
    rate: recs.length ? Math.round(sold.length / recs.length * 100) : 0};
}
function trackCard(r){
  return `<div class="tcard">
    <div class="tphoto">${r.photo?`<img src="${esc(r.photo)}" alt="" loading="lazy" referrerpolicy="no-referrer">`:""}${r.fav?`<span class="tfav">♥ ${r.fav}</span>`:""}</div>
    <div class="tbody">
      <div class="row" style="gap:6px"><b>${esc(r.brand||"")}</b>${r.status?`<span class="t-sub">${esc(r.status)}</span>`:""}<span class="sp"></span>
        <button class="btn sm ghost tstar ${r.star?"on":""}" data-act="trk-star" data-id="${esc(r.id)}" aria-label="${r.star?"Retirer des favoris":"Ajouter aux favoris"}">${r.star?"★":"☆"}</button></div>
      <div class="t-title" style="font-weight:500">${esc(r.title)}</div>
      ${r.size?`<div class="t-sub">Taille ${esc(r.size)}</div>`:""}
      <div class="row" style="align-items:flex-end;margin-top:auto"><b class="tprice">${eur(r.price)}</b><span class="sp"></span>
        <div style="text-align:right">${r.sold?`<div class="t-sub">Vendu ${dAgo(r.soldAt)}</div><span class="pill p-shipped">Vendu en ${dDur(r.soldAt - r.firstSeen)}</span>`:`<div class="t-sub">Vu ${dAgo(r.firstSeen)}</div><span class="pill p-listed">En vente</span>`}</div></div>
      ${r.url?`<a href="${esc(r.url)}" target="_blank" rel="noopener" class="tlink">Voir l'annonce ↗</a>`:""}
    </div></div>`;
}
function vTracker(){
  const T = S.tracker, niches = T.niches || [];
  const cur = niches.find(n => n.id === S.trkNiche) || niches[0];
  const tab = S.trkTab || "sold";
  let main = `<div class="card empty">Ajoute une niche à suivre, par exemple « COS manteau long », « UGG Tasman » ou « Carhartt Detroit ». Ton PC la scanne à chaque synchro automatique et repère les annonces qui se vendent.</div>`;
  if (cur){
    const s = nicheStats(cur);
    let list = tab === "sold" ? s.sold.sort((a, b) => b.soldAt - a.soldAt) : tab === "live" ? s.live.sort((a, b) => b.firstSeen - a.firstSeen) : s.recs.filter(r => r.star);
    main = `
    <div class="card"><div class="row"><div><h2>${esc(cur.q)}</h2><p class="note" style="margin:2px 0 0">${s.recs.length} annonces suivies depuis ${cur.createdAt?fdate(new Date(cur.createdAt).toISOString()):"—"} · dernier scan ${cur.lastScan?dAgo(cur.lastScan)+" à "+new Date(cur.lastScan).toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"}):"jamais"}</p></div><span class="sp"></span>
      ${CR.hasChrome?`<button class="btn sm" data-act="trk-scan" data-id="${esc(cur.id)}">Scanner maintenant</button>`:""}<button class="btn sm ghost danger" data-act="trk-del" data-id="${esc(cur.id)}">Ne plus suivre</button></div></div>
    <div class="kpis">
      <div class="kpi"><span>Ventes détectées</span><b>${s.sold.length}</b><small>${s.wk} ces 7 derniers jours</small></div>
      <div class="kpi"><span>Ventes par jour</span><b>${s.perDay.toFixed(1)}</b><small>taux de vente ${s.rate} %</small></div>
      <div class="kpi"><span>Prix de vente médian</span><b>${s.med===null?"—":eur0(s.med)}</b><small>${s.med===null?"pas encore de vente":`de ${eur0(s.p25)} à ${eur0(s.p75)}`}</small></div>
      <div class="kpi"><span>Délai de vente médian</span><b>${s.dur===null?"—":dDur(s.dur)}</b><small>de l'apparition à la vente</small></div>
      <div class="kpi"><span>Prix d'achat max</span><b class="pos">${s.med===null?"—":eur0(maxBuyPrice(s.med))}</b><small>pour revendre au prix médian</small></div>
    </div>
    <div class="tabs">${[["sold",`Flux de ventes (${s.sold.length})`],["live",`En vente (${s.live.length})`],["star",`Favoris (${s.recs.filter(r=>r.star).length})`]].map(([k,l])=>`<button class="${tab===k?"on":""}" data-act="trk-tab" data-v="${k}">${l}</button>`).join("")}</div>
    ${list.length ? `<div class="tgrid">${list.slice(0, 120).map(trackCard).join("")}</div>`
      : `<div class="card empty">${tab==="sold" ? "Aucune vente détectée pour l'instant. Il faut quelques scans (quelques heures à un jour) pour voir les premières ventes." : tab==="live" ? "Pas encore scanné. Clique « Scanner maintenant » ou attends la prochaine synchro auto." : "Clique l'étoile d'une annonce pour la garder ici."}</div>`}`;
  }
  return `
  <div class="head"><div><h1>Tracker</h1><p>Suis des niches et vois ce qui se vend vraiment sur Vinted, à quel prix et en combien de temps.</p></div></div>
  <div class="trk">
    <div class="card trk-side">
      <form id="trkForm" class="row" style="gap:6px"><input type="text" id="trkQ" placeholder="Marque + modèle" style="flex:1;min-width:0" aria-label="Niche à suivre"><button class="btn sm pri">Suivre</button></form>
      <div class="trk-list">${niches.map(n => { const st = nicheStats(n); return `<button class="trk-item ${cur&&cur.id===n.id?"on":""}" data-act="trk-pick" data-id="${esc(n.id)}"><span>${esc(n.q)}</span><span class="t-sub">${st.sold.length} vendus · ${st.med===null?"—":eur0(st.med)}</span></button>`; }).join("") || `<p class="note">Aucune niche suivie.</p>`}</div>
      <p class="note" style="margin:0">8 niches max. Les scans tournent sur ton PC (Chrome ouvert), même si tu ajoutes une niche depuis ton téléphone.</p>
    </div>
    <div class="trk-main" style="display:flex;flex-direction:column;gap:16px;min-width:0">${main}</div>
  </div>`;
}

/* Offre favoris : remise fixe en € (par défaut −5 €) ou en % */
function favPrice(it){
  const st = S.settings, p = num(it.listPrice);
  const np = st.favMode === "pct" ? round5(p * (1 - num(st.favDiscount)/100)) : p - num(st.favAmount);
  return Math.max(np, num(it.minPrice), 0);
}
const favLabel = () => S.settings.favMode === "pct" ? `−${S.settings.favDiscount} %` : `−${eur0(S.settings.favAmount)}`;

/* ---------- événements ---------- */
document.addEventListener("click", async e => {
  const el = e.target.closest("[data-act]"); if (!el) return;
  const a = el.dataset.act, id = el.dataset.id, v = el.dataset.v;
  const it = id ? S.items.find(i=>i.id===id) : null;
  if (a === "close-bg") { if (e.target === el) closeModal(); return; }
  switch(a){
    case "close": closeModal(); break;
    case "new-item": itemModal(); break;
    case "edit": itemModal(it); break;
    case "sell": sellModal(it); break;
    case "edit-sale": sellModal(it); break;
    case "sell-at": sellModal(it, num(v)); break;
    case "quick-sale": quickSaleModal(); break;
    case "qs-go": { const x = S.items.find(i=>i.id===$("#qsItem").value); closeModal(); if (x) sellModal(x); break; }
    case "new-expense": expenseModal(); break;
    case "del-item": { closeModal(); await delItem(id); toast("Article supprimé"); break; }
    case "unsell": { const x = {...it, status:"listed"}; delete x.sale; closeModal(); await saveItem(x); toast("Vente annulée, l'article est de nouveau en ligne"); break; }
    case "sf": S.stockFilter = v; S.sel.clear(); render(); break;
    case "go-stock-nocost": S.stockFilter="nocost"; location.hash="stock"; break;
    case "relist": {
      S.poster.photos.forEach(p=>URL.revokeObjectURL(p.url));
      S.poster = {notes:"", brand:it.brand||"", size:it.size||"", condition:CONDITIONS.includes(it.condition)?it.condition:"Très bon état", category:it.category||"", photos:[], out:null, busy:false, err:"",
        relist:{id:it.id, title:it.title, description:it.notes||"", price:num(it.sale?.price)||num(it.listPrice), date:it.sale?.date}};
      location.hash = "poster"; break;
    }
    case "ph-rot": case "ph-sq": case "ph-lum": {
      const p = S.poster.photos[+v]; if (!p) break;
      try { readPoster(); const blob = await editPhoto(p.blob, a); URL.revokeObjectURL(p.url); S.poster.photos[+v] = {blob, url:URL.createObjectURL(blob)}; render(); }
      catch { toast("Retouche impossible sur cette photo."); }
      break;
    }
    case "ph-del": { readPoster(); const p = S.poster.photos.splice(+v,1)[0]; if (p) URL.revokeObjectURL(p.url); render(); break; }
    case "ph-dl": S.poster.photos.forEach((p,ix) => offerFile(`photo-${ix+1}.jpg`, p.blob)); break;
    case "save-key": { const k = $("#sKey").value.trim(); if (!k || k.startsWith("••")) { toast("Colle ta clé complète (elle commence par sk-ant-)."); break; } apiKey = k; await CR.saveKey(k); render(); toast("Clé enregistrée sur cet appareil"); break; }
    case "del-key": apiKey = ""; await CR.saveKey(""); render(); toast("Clé retirée"); break;
    case "export-json": offerFile(`cockpit-revente-${today()}.json`, JSON.stringify({app:"cockpit-revente", version:1, exportedAt:new Date().toISOString(), items:S.items, expenses:S.expenses, settings:S.settings, lastVintedSync}, null, 1)); break;
    case "import-json": $("#importIn").click(); break;
    case "import-ok": { const d = window.__pendingImport; window.__pendingImport = null; closeModal(); if (d) { applyData(d); persist(); render(); toast(`${S.items.length} articles importés`); } break; }
    case "sel": el.checked ? S.sel.add(id) : S.sel.delete(id); render(); break;
    case "selall": { const rows = [...document.querySelectorAll("[data-act=sel]")].map(x=>x.dataset.id); if (el.checked) rows.forEach(r=>S.sel.add(r)); else S.sel.clear(); render(); break; }
    case "b-clear": S.sel.clear(); render(); break;
    case "b-list": await bulk(x => x.status==="sold"?x:{...x, status:"listed", listedAt:x.listedAt||today()}, "mis en ligne"); break;
    case "b-repost": await bulk(x => x.status!=="listed"?x:{...x, lastRepostAt:today(), repostCount:(x.repostCount||0)+1}, "marqués repostés"); break;
    case "b-drop": { const p = num($("#bPct").value); if (p<=0||p>=90) { toast("Indique un pourcentage entre 1 et 89."); break; } await bulk(x => x.status==="sold"?x:{...x, listPrice:dropPrice(x,p), lastDropAt:today()}, `baissés de ${p} %`); break; }
    case "b-set": { const p = num($("#bSet").value); if (p<=0) { toast("Indique un prix."); break; } await bulk(x => x.status==="sold"?x:{...x, listPrice:p}, `fixés à ${eur(p)}`); break; }
    case "b-del": { const ids = [...S.sel]; modal(`<h2>Supprimer ${ids.length} article${ids.length>1?"s":""} ?</h2><p>Cette action efface aussi leurs ventes de la compta.</p><div class="acts"><button class="btn" data-act="close">Annuler</button><button class="btn pri" data-act="b-del-ok">Supprimer</button></div>`); break; }
    case "b-del-ok": { const ids = [...S.sel]; closeModal(); for (const x of ids) await delItem(x); S.sel.clear(); toast("Articles supprimés"); break; }
    case "shf": S.shipFilter = v; render(); break;
    case "copy-ship": copy(fill(S.settings.templates.shipped, {pseudo:it.sale.buyer||"", article:it.title})); break;
    case "invoice": offerFile(`facture-${it.sku||it.id}.html`, invoiceHtml(it)); break;
    case "export-csv": offerFile(`ventes-${today()}.csv`, csvSales()); break;
    case "del-exp": await delExpense(id); break;
    case "go-ship": S.shipFilter="to_ship"; location.hash="ventes"; break;
    case "go-shipped": S.shipFilter="shipped"; location.hash="ventes"; break;
    case "go-repost": S.agentTab="repost"; location.hash="agents"; break;
    case "go-fav": S.agentTab="favoris"; location.hash="agents"; break;
    case "go-stock-stock": S.stockFilter="stock"; location.hash="stock"; break;
    case "drop-dormant": { const d = dormant(), p = num(S.settings.priceDropPct); for (const x of d) await saveItem({...x, listPrice:dropPrice(x,p), lastDropAt:today()}); toast(`${d.length} prix baissés de ${p} %`); break; }
    case "atab": S.agentTab = v; render(); break;
    case "sim-run": readSim(); render(); break;
    case "round-next": readSim(); S.sim.round = Math.min((num(S.sim.round)||1)+1, S.settings.offerTiers.length); S.sim.offer=""; render(); break;
    case "copy-el": copy($("#"+v).textContent); break;
    case "copy-fav": { const np = favPrice(it); copy(fill(S.settings.templates.favorite, {pseudo:"", article:it.title, prix:eur(np), prixInitial:eur(it.listPrice)}).replace("Coucou  !","Coucou !")); break; }
    case "fav-done": await saveItem({...it, lastFavNudgeAt:today()}); toast("Relance enregistrée"); break;
    case "repost-one": await saveItem({...it, lastRepostAt:today(), repostCount:(it.repostCount||0)+1}); toast("Repost enregistré"); break;
    case "repost-all": { const q = repostQueue(); for (const x of q) await saveItem({...x, lastRepostAt:today(), repostCount:(x.repostCount||0)+1}); toast(`${q.length} reposts enregistrés`); break; }
    case "copy-tpl": copy(S.settings.templates[v]); break;
    case "gen-reply": S.msg.text = $("#mText").value; S.msg.itemId = $("#mItem").value; genReply(); break;
    case "gen-listing": readPoster(); genListing(); break;
    case "tpl-listing": readPoster(); tplListing(); break;
    case "clear-photos": S.poster.photos.forEach(p=>URL.revokeObjectURL(p.url)); S.poster.photos=[]; render(); break;
    case "copy-plat": readOut(); copy(platText(v)); break;
    case "publish-vinted": publishToVinted(); break;
    case "cloud-in": case "cloud-up": {
      const cc = await CRCloud.cfg();
      const url = $("#cUrl").value.trim() || cc.url, key = $("#cKey").value.trim() || cc.key, email = $("#cEmail").value.trim(), pw = $("#cPw").value;
      if (!/^https:\/\/.+/.test(url) || !key || !email || pw.length < 6) { toast("Remplis l'URL, la clé, l'email et un mot de passe de 6 caractères minimum."); break; }
      el.disabled = true;
      try {
        if (a === "cloud-up") { const r = await CRCloud.signUp(url, key, email, pw); if (r === "confirm") { toast("Compte créé : clique le lien reçu par email, puis « Se connecter »."); el.disabled = false; break; } }
        else await CRCloud.signIn(url, key, email, pw);
        await pullCloud(false); render(); toast("Connecté : tes données sont en ligne");
      } catch(e) { toast(e.message); el.disabled = false; }
      break;
    }
    case "cloud-out": await CRCloud.signOut(); cloudCfg = await CRCloud.cfg(); cloudState = ""; render(); footState(); toast("Déconnecté"); break;
    case "cloud-pull": await pullCloud(false); render(); break;
    case "trk-pick": S.trkNiche = id; render(); break;
    case "trk-tab": S.trkTab = v; render(); break;
    case "trk-scan": trackNow(id); break;
    case "trk-del": { const T = S.tracker; T.niches = T.niches.filter(n => n.id !== id); if (T.items) delete T.items[id]; S.trkNiche = null; persist(); render(); toast("Niche retirée"); break; }
    case "trk-star": { for (const box of Object.values(S.tracker.items || {})) if (box[id]) box[id].star = !box[id].star; persist(); render(); break; }
    case "sync-now": { el.disabled = true; toast("Synchro Vinted en cours…"); try { const r = await chrome.runtime.sendMessage({type:"sync-now"}); toast(r?.ok ? "Synchro terminée" : (r?.msg || "Synchro échouée")); S.autoLog = await CR.get("cr_autolog"); render(); } catch { toast("La synchro n'a pas pu démarrer."); } el.disabled = false; break; }
    case "lead-copy": { const L = (S.favLeads||[]).find(x=>x.id===id); const x = L && S.items.find(i=>String(i.vintedId)===String(L.itemVintedId)); copy(fill(S.settings.templates.favorite, {pseudo:L?.login||"", article:x?.title||"l'article", prix:x?eur(favPrice(x)):"", prixInitial:x?eur(x.listPrice):""}).replace("Coucou  !","Coucou !")); break; }
    case "lead-done": { const L = (S.favLeads||[]).find(x=>x.id===id); if (L) { L.done = true; persist(); render(); } break; }
    case "listing-to-stock": { readOut(); const o = S.poster.out, P = S.poster; itemModal(null); const f = $("#itemForm"); f.title.value=o.title; f.brand.value=P.brand; f.size.value=P.size; f.category.value=o.category||P.category; f.condition.value=P.condition; f.listPrice.value=o.price||""; f.notes.value=o.description+"\n\n"+(o.hashtags||[]).join(" "); f.dispatchEvent(new Event("input")); break; }
    case "save-settings": readSettings(); await saveSettings(); toast("Réglages enregistrés"); break;
    case "del-demo": { const n = S.items.filter(i=>i.demo); const ex = S.expenses.filter(x=>x.demo); for (const x of n) await delItem(x.id); for (const x of ex) await delExpense(x.id); toast("Exemples supprimés"); break; }
  }
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && $("#modal").innerHTML) closeModal();
  if ((e.key === "Enter" || e.key === " ") && e.target.matches(".funnel [data-act]")) { e.preventDefault(); e.target.click(); }
});
async function bulk(fn, label){
  const ids = [...S.sel]; let n = 0;
  for (const id of ids){ const x = S.items.find(i=>i.id===id); if (!x) continue; const y = fn(x); if (y !== x) { await saveItem(y); n++; } }
  S.sel.clear(); render(); toast(`${n} article${n>1?"s":""} ${label}`);
}
document.addEventListener("submit", async e => {
  e.preventDefault();
  const f = e.target;
  if (f.id === "itemForm"){ const base = S.items.find(i=>i.id===f.dataset.id) || {id:f.dataset.id, createdAt:today()}; const it = readItemForm(f, base); closeModal(); await saveItem(it); toast(f.dataset.new==="1"?"Article ajouté":"Article mis à jour"); }
  if (f.id === "sellForm"){ const it = S.items.find(i=>i.id===f.dataset.id); const g = k => f[k].value; const prev = it.sale||{};
    const sale = {price:num(g("price")), date:g("date")||today(), platform:g("platform"), account:g("account"), fees:num(g("fees")), shipping:num(g("shipping")), buyer:g("buyer").trim(), shipStatus:g("shipStatus")};
    if (sale.shipStatus==="shipped" && prev.shipStatus!=="shipped") sale.shippedAt = today(); else if (prev.shippedAt) sale.shippedAt = prev.shippedAt;
    closeModal(); await saveItem({...it, status:"sold", sale}); toast(`Vente enregistrée : ${eur(profitOf({...it,status:"sold",sale}))} de bénéfice`); }
  if (f.id === "estForm"){ runEstimate(); return; }
  if (f.id === "trkForm"){
    const q = $("#trkQ").value.trim(); if (!q) return;
    const T = S.tracker; T.niches = T.niches || [];
    if (T.niches.length >= 8) { toast("8 niches maximum : retire-en une d'abord."); return; }
    if (T.niches.some(n => n.q.toLowerCase() === q.toLowerCase())) { toast("Tu suis déjà cette niche."); return; }
    const n = {id: uid(), q, createdAt: Date.now()}; T.niches.push(n); S.trkNiche = n.id; S.trkTab = "live";
    $("#trkQ").value = ""; $("#trkQ").blur(); persist(); render();
    toast(CR.hasChrome ? "Niche ajoutée : premier scan en cours…" : "Niche ajoutée : ton PC la scannera à la prochaine synchro.");
    if (CR.hasChrome) setTimeout(() => trackNow(n.id), 900);
    return;
  }
  if (f.id === "expForm"){ const x = {id:uid(), label:f.label.value.trim(), amount:num(f.amount.value), date:f.date.value||today(), category:f.category.value}; closeModal(); await saveExpense(x); toast("Dépense ajoutée"); }
});
document.addEventListener("change", async e => {
  const t = e.target;
  if (t.matches("[data-act=ship]")) { const it = S.items.find(i=>i.id===t.dataset.id); const sale = {...it.sale, shipStatus:t.value, shipManual:true}; if (t.value==="shipped") sale.shippedAt = today(); t.blur(); await saveItem({...it, sale}); toast(`Statut : ${SHIP[t.value]}`); }
  if (t.id === "stockPlat") { S.stockPlat = t.value; t.blur(); render(); }
  if (t.id === "yearSel") { S.year = +t.value; t.blur(); render(); }
  if (t.id === "simItem") { readSim(); t.blur(); render(); }
  if (t.id === "simRound") { readSim(); t.blur(); render(); }
  if (t.id === "importIn" && t.files[0]) {
    try {
      const d = JSON.parse(await t.files[0].text());
      if (!Array.isArray(d.items)) throw 0;
      window.__pendingImport = d;
      modal(`<h2>Remplacer tes données ?</h2><p>Le fichier contient ${d.items.length} articles et ${(d.expenses||[]).length} dépenses. Tes données actuelles (${S.items.length} articles) seront remplacées.</p><div class="acts"><button class="btn" data-act="close">Annuler</button><button class="btn pri" data-act="import-ok">Remplacer</button></div>`);
    } catch { toast("Ce fichier n'est pas une sauvegarde Cockpit Revente."); }
    t.value = "";
  }
  if (t.id === "photoIn") {
    const files = [...t.files].slice(0, 4 - S.poster.photos.length);
    for (const file of files) S.poster.photos.push({blob:file, url:URL.createObjectURL(file)});
    readPoster(); t.blur(); render();
  }
});
let qT;
document.addEventListener("input", e => {
  if (e.target.id === "stockQ") { S.stockQ = e.target.value; clearTimeout(qT); qT = setTimeout(() => { const pos = e.target.selectionStart; pendingRender=false; renderNav(); $("#main").innerHTML = banner()+vStock(); afterRender(); const n = $("#stockQ"); if (n){ n.focus(); n.setSelectionRange(pos,pos); } }, 200); }
});
function readSim(){ const g = id => $("#"+id)?.value; S.sim = {itemId:g("simItem")??S.sim.itemId, price:g("simPrice")??S.sim.price, offer:g("simOffer")??S.sim.offer, round:g("simRound")??S.sim.round, pseudo:g("simPseudo")??S.sim.pseudo}; }
function readPoster(){ const P = S.poster, g = id => $("#"+id)?.value; if ($("#pBrand")) { P.brand=g("pBrand"); P.size=g("pSize"); P.condition=g("pCond"); P.category=g("pCat"); P.notes=g("pNotes"); } readOut(); }
function readOut(){ const o = S.poster.out; if (!o || !$("#oTitle")) return; o.title=$("#oTitle").value; o.description=$("#oDesc").value; o.price=$("#oPrice").value; o.hashtags=$("#oTags").value.split(/\s+/).filter(Boolean); }
function readSettings(){
  const st = S.settings, g = id => $("#"+id).value;
  st.accounts = g("sAcc").split(",").map(s=>s.trim()).filter(Boolean); if (!st.accounts.length) st.accounts=["Compte principal"];
  PLATFORMS.forEach(p => st.fees[p] = num(g("fee_"+p)));
  st.offerAccept = num(g("sAccept")); st.offerFloor = num(g("sFloor"));
  st.offerTiers = g("sTiers").split(/[,; ]+/).map(num).filter(x=>x>0&&x<=100); if (!st.offerTiers.length) st.offerTiers=[95];
  st.repostDays = num(g("sRepost"))||7; st.dormantDays = num(g("sDorm"))||45; st.priceDropPct = num(g("sDrop"))||10; st.favDiscount = num(g("sFav")); st.favCooldown = num(g("sFavCd"));
  st.favMode = g("sFavMode"); st.favAmount = num(g("sFavEur")); st.targetMult = num(g("sMult")) || 2; st.minMarginEur = num(g("sMinM"));
  st.style = g("sStyle");
  if ($("#sModel")) st.model = g("sModel");
  if ($("#sUid")) st.vintedUid = g("sUid").replace(/\D/g, "");
  if ($("#sAuto")) { st.autoSyncMinutes = Number(g("sAuto")); if (CR.hasChrome && chrome.runtime?.sendMessage) setTimeout(() => chrome.runtime.sendMessage({type:"reschedule"}).catch(()=>{}), 800); }
  Object.keys(st.templates).forEach(k => st.templates[k] = g("tpl_"+k));
}
function afterRender(){
  if (S.view === "poster" || S.view === "agents") {
    // garde la saisie en mémoire pour qu'un rafraîchissement des données ne l'efface pas
    $("#main").querySelectorAll("input,textarea,select").forEach(el => el.addEventListener("input", () => { if (S.view==="poster") readPoster(); else { readSim(); if ($("#mText")) { S.msg.text=$("#mText").value; S.msg.itemId=$("#mItem").value; } } }));
  }
}

/* ---------- routage ---------- */
function route(){ const h = location.hash.slice(1); S.view = VIEWS.some(v=>v[0]===h) ? h : "dashboard"; closeModal(); pendingRender=false; render(); window.scrollTo(0,0); }
window.addEventListener("hashchange", route);

/* ---------- démarrage ---------- */
route();
function footState(){
  const el = $("#syncState"); if (!el) return;
  const v = lastVintedSync ? "Vinted lu " + new Date(lastVintedSync).toLocaleString("fr-FR", {day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit"}) : "Vinted pas encore lu";
  const c = cloudState === "ok" ? "en ligne ✓" : cloudState === "err" ? "en ligne : erreur" : "hors ligne";
  el.textContent = `${S.items.length} articles · ${v} · ${c}`;
}
(async () => {
  try { const d = await CR.loadData(); localStamp = d.updatedAt || 0; applyData(d); apiKey = await CR.loadKey(); }
  catch { toast("Impossible de lire tes données enregistrées."); }
  S.loaded.items = S.loaded.expenses = S.loaded.settings = true;
  footState(); render();
  try { S.autoLog = await CR.get("cr_autolog"); } catch {}
  await pullCloud(true);
  // la popup ou la synchro auto a écrit pendant que le tableau de bord est ouvert
  CR.onExternalChange(d => { if (writing || !d) return; localStamp = d.updatedAt || localStamp; applyData(d); footState(); render(); toast("Données Vinted mises à jour"); });
  // sur téléphone / version web : on regarde la base en ligne toutes les minutes et au retour sur la page
  setInterval(() => { if (document.visibilityState === "visible") pullCloud(true); }, 60000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") pullCloud(false); });
})();
const _render = render;
render = function(){ _render(); if (S.loaded.items) footState(); };
