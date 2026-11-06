# Cockpit Revente : installation

## 1. Installer l'extension dans Chrome (2 minutes)

1. Ouvre Chrome et va sur `chrome://extensions`.
2. Active **Mode développeur** (interrupteur en haut à droite).
3. Clique **Charger l'extension non empaquetée** et choisis le dossier `E:\cockpit-revente\extension`.
4. Épingle l'extension : icône puzzle 🧩 à côté de la barre d'adresse → punaise sur « Cockpit Revente ».

Pour mettre à jour après une modification des fichiers : bouton ↻ sur la carte de l'extension dans `chrome://extensions`.

## 2. Ouvrir le tableau de bord

Clique sur l'icône **CR** → **Ouvrir le tableau de bord**. Tes données sont enregistrées dans Chrome, sur cet ordinateur.
Pense à faire **Réglages → Sauvegarde → Exporter** de temps en temps.

## 3. Lire ton compte Vinted

1. Ouvre **vinted.fr** et connecte-toi.
2. Clique sur l'icône **CR** → **Lire mon compte Vinted**.
3. Tes annonces (prix, favoris, vues, photo) et tes ventes arrivent dans le tableau de bord.
   Les articles importés sans prix d'achat apparaissent dans « À faire aujourd'hui » : complète-les pour avoir ta vraie marge.

L'extension **lit seulement** : elle ne publie, ne modifie et n'envoie rien sur Vinted.
Lance-la quand tu veux (une ou deux fois par jour suffit).

**Si ça ne marche pas** : Vinted ne documente pas son fonctionnement interne et le change parfois.
Clique **Copier le rapport** dans la fenêtre de l'extension et envoie-le à Claude pour qu'il ajuste le code.
Si ton ID membre n'est pas détecté : ouvre ton profil Vinted, l'adresse contient `/member/123456789-…`, colle ce nombre dans le champ prévu.

## 4. Activer l'IA (facultatif)

1. Crée une clé sur https://console.anthropic.com (paiement à l'usage, quelques centimes par annonce).
2. Tableau de bord → **Réglages → IA** → colle la clé → **Enregistrer la clé**.
3. Choisis le modèle : Opus 5.5 (meilleure qualité), Sonnet 5.5, ou Haiku 5.5 (le moins cher).

La clé reste sur ton ordinateur et n'est jamais incluse dans les sauvegardes exportées.

## 5. Accès partout + synchro automatique (Supabase, gratuit)

### a. Créer la base (une seule fois, 5 minutes)
1. Va sur https://supabase.com → **Start your project** → crée un compte puis un projet (région Europe, garde le mot de passe de la base quelque part).
2. Dans le projet : menu **SQL Editor** → **New query** → colle ceci → **Run** :

```sql
create table public.cockpit_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at bigint not null default 0
);
alter table public.cockpit_data enable row level security;
create policy "lire ses donnees" on public.cockpit_data for select using (auth.uid() = user_id);
create policy "creer ses donnees" on public.cockpit_data for insert with check (auth.uid() = user_id);
create policy "modifier ses donnees" on public.cockpit_data for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

3. Menu **Project Settings → API** (ou **API Keys**) : copie l'**URL du projet** et la **clé publique** (*anon* ou *publishable*). Ne prends jamais la clé *service_role* / *secret*.

### b. Se connecter
1. Tableau de bord (extension) → **Réglages → Accès partout** → colle l'URL et la clé, choisis un email et un mot de passe → **Créer mon compte**.
2. Clique le lien de confirmation reçu par email, puis **Se connecter**.
3. Sur ton téléphone : ouvre ta version web (section 6), **Réglages → Accès partout**, mêmes URL, clé, email et mot de passe → **Se connecter**.

### c. Synchro automatique
**Réglages → Vinted → Synchro automatique** : toutes les 2 h par défaut. Tant que ton PC est allumé avec Chrome ouvert,
l'extension lit ton compte Vinted, scanne les niches du Tracker, puis envoie tout en ligne. Un onglet Vinted s'ouvre en arrière-plan quelques secondes puis se ferme.
PC éteint ou Chrome fermé : tu vois les dernières données envoyées, la synchro reprend au rallumage.

## 6. Version web sur GitHub Pages (pour le téléphone)

Pour consulter ton tableau de bord depuis un autre appareil, sans la synchro Vinted :

1. Crée un compte sur https://github.com puis un dépôt public, par exemple `cockpit-revente`.
2. **Add file → Upload files** : glisse tous les fichiers de ce dossier (sauf `LISEZMOI.md` si tu veux).
3. **Settings → Pages** → Source : *Deploy from a branch*, branche `main`, dossier `/ (root)` → **Save**.
4. Après une minute, ton site est sur `https://<ton-pseudo>.github.io/cockpit-revente/`.

Sur la version web, les données restent dans le navigateur de l'appareil.
Pour y retrouver tes données de l'extension : **Exporter** depuis l'extension, puis **Importer** sur le site.
