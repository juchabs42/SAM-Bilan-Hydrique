# SAM Bilan Hydrique — V1

Application statique destinée à GitHub Pages, avec Supabase pour l'authentification et le stockage des parcelles/irrigations/corrections de pluie, et Open-Meteo pour ET₀ et précipitations.

## Mise en route

1. Créer un projet Supabase.
2. Dans **SQL Editor**, exécuter `supabase.sql`.
3. Dans **Authentication > Users**, créer les comptes utilisateurs. L'application ne propose volontairement pas d'inscription publique.
4. Copier la **Project URL** et la **publishable/anon key** dans `config.js`.
5. Déposer tous les fichiers à la racine du dépôt GitHub.
6. Activer **Settings > Pages** et publier depuis la branche souhaitée.

## Modèle agronomique V1

- Pommier uniquement.
- Début de saison : 1er mars, stock initial = RU.
- RUM et classe texturale : tableau fourni dans le classeur Excel source.
- Sable + limon + argile doivent totaliser 100 %.
- RU = RUM × profondeur racinaire.
- p FAO fixé à 0,50 pour cette V1 ; seuil de réserve facilement utilisable affiché à 50 % de RU.
- ETc = ET₀ × Kc.
- Stock J = stock J-1 - ETc + pluie utilisée + irrigation.
- Stock borné entre 0 et RU ; l'excédent est compté en drainage/perte.
- Pluie Open-Meteo intégrée à 100 %, remplaçable jour par jour par une correction manuelle.
- Pas d'efficience d'irrigation en V1.
- Prévision : aujourd'hui + 7 jours, sans irrigation future.

## Kc pommier

Sans couvert : 0,60 / 0,95 / 0,75.

Couvert actif : 0,80 / 1,20 / 0,85.

Calendrier :
- 01/03–30/04 : Kc initial
- 01/05–31/05 : interpolation initial → mi-saison
- 01/06–10/08 : Kc mi-saison
- 11/08–30/09 : interpolation mi-saison → fin
- 01/10–31/10 : Kc fin
- hors période : Kc = 0

## Fichiers

- `index.html` : interface
- `style.css` : thème et responsive mobile
- `app.js` : logique métier, météo, Supabase et graphiques
- `config.js` : URL/clé publique Supabase
- `supabase.sql` : tables + RLS
- `manifest.json`, `sw.js`, `icon.svg` : PWA
