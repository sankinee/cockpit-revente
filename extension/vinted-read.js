"use strict";
/* Exécutée DANS l'onglet Vinted (même origine : les cookies de ta session servent automatiquement).
   Lecture seule : uniquement des requêtes GET. */
async function readVinted(manualUid){
  const log = [];
  const origin = location.origin;
  const getJSON = async path => {
    const r = await fetch(origin + path, {credentials: "include", headers: {"Accept": "application/json"}});
    log.push(`${r.status} ${path}`);
    if (!r.ok) return null;
    try { return await r.json(); } catch { log.push("  réponse non JSON"); return null; }
  };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  let uid = manualUid || "";
  let account = "";
  if (!uid){
    const me = await getJSON("/api/v2/users/current");
    if (me && (me.user || me.id)) { uid = String((me.user || me).id); account = (me.user || me).login || ""; }
  }
  if (!uid){ const m = document.cookie.match(/(?:^|;\s*)v_uid=(\d+)/); if (m) { uid = m[1]; log.push("ID trouvé dans les cookies"); } }
  if (!uid){ const m = location.pathname.match(/\/member\/(\d+)/); if (m) { uid = m[1]; log.push("ID trouvé dans l'adresse de la page"); } }
  if (!uid) return {ok:false, error:"ID membre introuvable. Ouvre ton profil Vinted (adresse en /member/123…) ou saisis ton ID.", log};

  const items = [];
  const routes = [p => `/api/v2/wardrobe/${uid}/items?page=${p}&per_page=96&order=newest_first`, p => `/api/v2/users/${uid}/items?page=${p}&per_page=96`];
  for (const route of routes){
    let p = 1, got = false;
    while (p <= 30){
      const j = await getJSON(route(p));
      if (!j) break;
      const list = j.items || j.user_items || [];
      if (p === 1) log.push("  clés : " + Object.keys(j).join(", ") + (list[0] ? " | article : " + Object.keys(list[0]).slice(0, 25).join(", ") : ""));
      items.push(...list); got = true;
      const tp = j.pagination?.total_pages || 1;
      if (p >= tp || !list.length) break;
      p++; await wait(700);
    }
    if (got) break;
  }

  const orders = [];
  for (let p = 1; p <= 20; p++){
    const j = await getJSON(`/api/v2/my_orders?type=sold&status=all&per_page=50&page=${p}`);
    if (!j) break;
    const list = j.my_orders || j.orders || j.transactions || [];
    if (p === 1) log.push("  clés ventes : " + Object.keys(j).join(", ") + (list[0] ? " | vente : " + Object.keys(list[0]).slice(0, 25).join(", ") : ""));
    orders.push(...list);
    const tp = j.pagination?.total_pages || 1;
    if (p >= tp || !list.length) break;
    await wait(700);
  }
  // notifications : qui a mis tes articles en favori
  const favs = [];
  for (let p = 1; p <= 3; p++){
    const j = await getJSON(`/api/v2/notifications?page=${p}&per_page=50`);
    if (!j) break;
    const list = j.notifications || j.items || [];
    if (p === 1) log.push("  clés notifications : " + Object.keys(j).join(", ") + (list[0] ? " | notif : " + Object.keys(list[0]).slice(0, 20).join(", ") : ""));
    for (const n of list){
      const text = String(n.body || n.title || n.message || "").replace(/<[^>]+>/g, "").trim();
      if (!/favori|favourite|favorite|aime|like/i.test(text + " " + (n.entry_type || "") + " " + (n.type || ""))) continue;
      favs.push({id: String(n.id), text, link: n.link || n.url || "", date: n.updated_at || n.created_at || "",
        itemVintedId: String(n.subject_id || n.item_id || (String(n.link || "").match(/items\/(\d+)/) || [])[1] || ""),
        login: (String(n.body || "").match(/<b>([^<]+)<\/b>/) || text.match(/^(\S+)/) || [])[1] || ""});
    }
    if (!list.length || p >= (j.pagination?.total_pages || 1)) break;
    await wait(700);
  }
  log.push(`${favs.length} notifications de favoris`);
  const seen = [...new Set(orders.map(o => [o.status, o.transaction_user_status, o.status_title].filter(x => typeof x === "string" && x).join(" · ")))];
  log.push(`${orders.length} ventes · statuts Vinted vus : ${seen.slice(0, 15).join(" | ") || "aucun"}`);
  return {ok: items.length > 0 || orders.length > 0, uid, account, origin, items, orders, favs, log,
    error: items.length || orders.length ? "" : "Vinted n'a rien renvoyé. Vérifie que tu es bien connecté, recharge la page Vinted et réessaie."};
}


/* Lit les annonces affichées sur une page de recherche Vinted (exécutée dans l'onglet). */
async function readCatalogDom(){
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const SEL = '[data-testid^="product-item-id-"], .feed-grid__item, .new-item-box__container';
  const parseEur = s => { const m = String(s).match(/(\d[\d\s\u202f\u00a0.]*(?:,\d{1,2})?)\s*€/); return m ? parseFloat(m[1].replace(/[\s\u202f\u00a0.]/g, "").replace(",", ".")) : 0; };
  let cards = [];
  for (let i = 0; i < 24; i++){ cards = [...document.querySelectorAll(SEL)]; if (cards.length > 4) break; await sleep(500); }
  for (let k = 0; k < 3; k++){ window.scrollTo(0, document.body.scrollHeight); await sleep(1200); }
  cards = [...document.querySelectorAll(SEL)];
  const seen = new Set(), out = [];
  for (const c of cards){
    const a = c.querySelector('a[href*="/items/"]') || (c.tagName === "A" ? c : null);
    const href = a ? a.href : "";
    const id = (href.match(/\/items\/(\d+)/) || (c.getAttribute("data-testid") || "").match(/(\d{5,})/) || [])[1] || "";
    if (!id || seen.has(id)) continue; seen.add(id);
    const info = (a && (a.getAttribute("title") || a.getAttribute("aria-label"))) || c.querySelector("img")?.alt || "";
    const priceEl = c.querySelector('[data-testid$="price-text"], [data-testid*="--price"]');
    const price = parseEur(priceEl ? priceEl.textContent : (info.match(/prix\s*:?\s*([^,]+,\d{2}\s*€)/i)?.[1] || c.textContent));
    const field = k => (info.match(new RegExp(k + "\\s*:\\s*([^,]+)", "i")) || [])[1]?.trim() || "";
    const favEl = c.querySelector('[data-testid*="favourite"], [aria-label*="favori" i], button[class*="favourite"]');
    const fav = parseInt(((favEl && (favEl.textContent || favEl.getAttribute("aria-label"))) || "").replace(/\D/g, "")) || 0;
    if (price) out.push({id, price, title: info.split(",")[0] || "", brand: field("marque") || field("brand"), size: field("taille") || field("size"),
      status: field("état") || field("condition"), fav, url: href, photo: c.querySelector("img")?.src || ""});
  }
  return {items: out, log: [`page catalogue : ${cards.length} cartes, ${out.length} prix lus`]};
}

/* Vérifie si des annonces sont vendues en ouvrant leur page (lecture seule, une à la fois). */
async function checkItemsSold(ids){
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const res = {};
  for (const id of ids){
    try {
      const r = await fetch(location.origin + "/items/" + id, {credentials: "include"});
      if (r.status === 404 || r.status === 410) res[id] = "gone";
      else if (!r.ok) res[id] = "unknown";
      else {
        const h = await r.text();
        if (/"is_closed"\s*:\s*true|"closing_action"\s*:\s*"sold"|"item_closing_action"\s*:\s*"sold"|"is_sold"\s*:\s*true|data-testid="item-status--sold"|>\s*Vendu\s*</i.test(h)) res[id] = "sold";
        else if (/"is_hidden"\s*:\s*true|"is_deleted"\s*:\s*true/.test(h)) res[id] = "gone";
        else res[id] = "active";
      }
    } catch { res[id] = "unknown"; }
    await sleep(900 + Math.random() * 600);
  }
  return res;
}
