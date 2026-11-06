"use strict";
/* Stockage partagé (extension : chrome.storage ; hors extension : localStorage)
   et fusion des données lues sur Vinted dans les données du tableau de bord. */
const CR = (() => {
  const KEY = "cr_data", KEY_API = "cr_apikey";
  const hasChrome = typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;
  async function get(k){
    if (hasChrome) return (await chrome.storage.local.get(k))[k];
    try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : undefined; } catch { return undefined; }
  }
  async function set(k, v){
    if (hasChrome) return chrome.storage.local.set({[k]: v});
    try { localStorage.setItem(k, JSON.stringify(v)); } catch(e) { throw new Error("Stockage du navigateur indisponible ou plein."); }
  }
  const loadData = async () => (await get(KEY)) || {items:[], expenses:[], settings:null, updatedAt:0};
  // updatedAt sert à savoir quelle copie est la plus récente (cet appareil ou la base en ligne)
  const saveData = (d, keepStamp) => { if (!keepStamp) d.updatedAt = Date.now(); return set(KEY, d); };
  const loadKey = async () => (await get(KEY_API)) || "";
  const saveKey = k => set(KEY_API, k);
  function onExternalChange(cb){ if (hasChrome) chrome.storage.onChanged.addListener((ch, area) => { if (area === "local" && ch[KEY]) cb(ch[KEY].newValue); }); }

  const num = v => { const n = parseFloat(String(v ?? "").replace(",", ".")); return isNaN(n) ? 0 : n; };
  const isoDay = v => {
    if (!v) return "";
    if (typeof v === "number") return new Date(v < 1e12 ? v * 1000 : v).toISOString().slice(0, 10);
    const d = new Date(v); return isNaN(d) ? "" : d.toISOString().slice(0, 10);
  };
  const priceOf = p => typeof p === "object" && p ? num(p.amount ?? p.value) : num(p);
  const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  /* Statut Vinted (texte libre, FR ou EN) → statut du tableau de bord. null = vente annulée/remboursée. */
  function shipFromText(t, date){
    t = norm(t);
    if (/annul|rembours|cancel|refund|echou|failed|expir|rejet/.test(t)) return null;
    let s = "to_ship";
    if (/termin|complete|finalis|vendu|sold|paiement (recu|effectue|transfere)|argent/.test(t)) s = "done";
    else if (/livre|delivered|recu|received|point relais|disponible/.test(t)) s = "delivered";
    else if (/envoy|expedi|shipped|transit|en route|chemin|depose|pris en charge|suivi/.test(t)) s = "shipped";
    // Vinted clôture une commande quelques jours après la livraison : une vente ancienne encore « en cours » est terminée
    const age = date ? (Date.now() - new Date(date).getTime()) / 864e5 : 0;
    if (s !== "done" && s !== "to_ship" && age > 14) s = "done";
    if (s === "to_ship" && age > 30) s = "done";
    return s;
  }
  const nid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  /* imp = {uid, items:[...vinted items], orders:[...vinted sold orders], origin} */
  function mergeVinted(data, imp){
    const today = new Date().toISOString().slice(0, 10);
    const items = data.items || (data.items = []);
    let created = 0, updated = 0, sales = 0;
    for (const v of imp.items || []){
      const vid = String(v.id);
      let it = items.find(i => String(i.vintedId) === vid)
        || items.find(i => !i.vintedId && i.status !== "sold" && v.title && norm(i.title) === norm(v.title));
      const status = v.is_sold || v.is_closed ? "sold" : v.is_reserved ? "reserved" : (v.is_hidden || v.is_draft) ? "stock" : "listed";
      const photo = v.photo?.url || v.photo?.thumbnails?.[0]?.url || v.photos?.[0]?.url || v.photos?.[0]?.thumbnails?.[0]?.url || "";
      const url = v.url ? (String(v.url).startsWith("http") ? v.url : (imp.origin || "") + v.url) : (v.path ? (imp.origin || "") + v.path : "");
      const fields = {
        vintedId: vid, vintedUrl: url, photo,
        listPrice: priceOf(v.price ?? v.price_numeric ?? v.total_item_price),
        favorites: num(v.favourite_count ?? v.favorite_count),
        views: num(v.view_count),
        vintedSyncedAt: today
      };
      if (it){
        Object.assign(it, fields);
        if (!it.title) it.title = v.title || "";
        if (it.status !== "sold" && status !== "sold") { if (status === "listed" && !it.listedAt) it.listedAt = isoDay(v.created_at_ts || v.created_at) || today; it.status = status; }
        if (!it.platforms?.includes("Vinted")) it.platforms = [...(it.platforms || []), "Vinted"];
        updated++;
      } else if (status !== "sold") {
        items.push({ id: nid(), ...fields, title: v.title || "Article Vinted", brand: v.brand_title || v.brand || "", size: v.size_title || v.size || "",
          condition: v.status || "", category: v.catalog_title || "", status, listedAt: isoDay(v.created_at_ts || v.created_at) || today,
          buyDate: isoDay(v.created_at_ts || v.created_at) || today, buyPrice: 0, needsCost: true, platforms: ["Vinted"], account: imp.account || "Compte principal", createdAt: today });
        created++;
      }
    }
    for (const o of imp.orders || []){
      const oid = String(o.transaction_id ?? o.id ?? o.conversation_id ?? "");
      if (!oid) continue;
      const price = priceOf(o.price ?? o.item_price ?? o.total_amount);
      const date = isoDay(o.date ?? o.created_at ?? o.updated_at) || today;
      const statusText = [o.status, o.transaction_user_status, o.status_title].filter(x => typeof x === "string" && x).join(" · ");
      const ship = shipFromText(statusText, date);
      const known = items.find(i => i.sale && String(i.sale.vintedOrderId) === oid);
      if (known){
        // vente déjà importée : on met à jour son statut, sauf si tu l'as changé à la main
        if (ship === null) { known.status = known.vintedId ? "stock" : known.status; known.sale.cancelled = true; continue; }
        known.sale.vintedStatus = statusText;
        if (!known.sale.shipManual) known.sale.shipStatus = ship;
        continue;
      }
      if (ship === null) continue;
      const title = o.title || o.item_title || "";
      const itemId = o.item_id ?? o.item?.id;
      let it = itemId ? items.find(i => String(i.vintedId) === String(itemId)) : null;
      if (!it && title) it = items.find(i => i.status !== "sold" && norm(i.title) === norm(title));
      const sale = { price, date, platform: "Vinted", account: imp.account || "Compte principal", fees: 0, shipping: 0,
        buyer: o.user?.login || o.opposite_user?.login || o.buyer?.login || "", shipStatus: ship, vintedOrderId: oid, vintedStatus: statusText };
      if (it){ it.status = "sold"; it.sale = {...(it.sale || {}), ...sale}; }
      else items.push({ id: nid(), title: title || "Vente Vinted", status: "sold", sale, buyPrice: 0, needsCost: true, buyDate: date, listedAt: date,
        platforms: ["Vinted"], photo: o.photo?.url || o.photo?.thumbnails?.[0]?.url || "", account: imp.account || "Compte principal", createdAt: today });
      sales++;
    }
    // personnes qui ont mis un article en favori (on garde ce que tu as déjà traité)
    const leads = data.favLeads || (data.favLeads = []);
    for (const f of imp.favs || []){
      if (!f.id || leads.some(l => l.id === f.id)) continue;
      leads.push({...f, origin: imp.origin || "", done: false});
    }
    data.favLeads = leads.slice(-300);
    data.lastVintedSync = new Date().toISOString();
    return {created, updated, sales};
  }
  return {hasChrome, get, set, loadData, saveData, loadKey, saveKey, onExternalChange, mergeVinted};
})();
