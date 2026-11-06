"use strict";
const $ = s => document.querySelector(s);
const status = t => { $("#status").textContent = t; };
let lastLog = "";

$("#open").addEventListener("click", () => chrome.tabs.create({url: chrome.runtime.getURL("dashboard.html")}));
$("#copyLog").addEventListener("click", () => navigator.clipboard.writeText(lastLog).then(() => status("Rapport copié.")));

(async () => {
  const d = await CR.loadData();
  if (d.settings?.vintedUid) $("#uid").value = d.settings.vintedUid;
  if (d.lastVintedSync) status("Dernière synchro : " + new Date(d.lastVintedSync).toLocaleString("fr-FR"));
  const a = await CR.get("cr_autolog");
  if (a) $("#auto").textContent = `Synchro auto (${new Date(a.at).toLocaleString("fr-FR")}) : ${a.msg}`;
})();

$("#sync").addEventListener("click", async () => {
  const btn = $("#sync"); btn.disabled = true; status("Lecture en cours…");
  $("#log").style.display = "none"; $("#copyLog").style.display = "none";
  try {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    if (!tab || !/^https:\/\/(www\.)?vinted\.[a-z.]+\//.test(tab.url || "")) { status("L'onglet actif n'est pas Vinted. Ouvre vinted.fr, connecte-toi, puis rouvre cette fenêtre."); return; }
    const manual = $("#uid").value.trim().replace(/\D/g, "");
    const [res] = await chrome.scripting.executeScript({target: {tabId: tab.id}, func: readVinted, args: [manual]});
    const r = res?.result;
    if (!r) { status("La lecture a échoué. Recharge la page Vinted et réessaie."); return; }
    lastLog = (r.log || []).join("\n");
    $("#log").textContent = lastLog; $("#log").style.display = "block"; $("#copyLog").style.display = "inline-flex";
    if (!r.ok) { status(r.error); return; }
    const data = await CR.loadData();
    data.settings = data.settings || {};
    data.settings.vintedUid = r.uid;
    data.settings.vintedOrigin = r.origin;
    const acc = data.settings.accounts?.[0] || "Compte principal";
    const sum = CR.mergeVinted(data, {...r, account: acc});
    await CR.saveData(data);
    let cloud = "";
    try { if (await CRCloud.push(data)) cloud = " Envoyé en ligne."; } catch (e) { cloud = " Envoi en ligne échoué : " + e.message; }
    status(`Terminé : ${r.items.length} annonces lues (${sum.created} nouvelles, ${sum.updated} mises à jour), ${sum.sales} nouvelles ventes.${cloud}`);
  } catch (e) {
    status("Erreur : " + (e.message || e));
  } finally { btn.disabled = false; }
});
