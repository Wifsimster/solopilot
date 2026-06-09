# Personas du workflow ADR

Chaque décision d'architecture (ADR) passe par une **revue de personas** : une
équipe virtuelle qui challenge la proposition avant qu'elle ne soit actée. La
section `## Participants` de chaque ADR liste les personas consultés et leur
position. Ce fichier est la **source de vérité** des intitulés de rôle — les
ADR doivent y être conformes pour éviter les divergences (`Architect` vs
`Tech Lead / Architect`, `PO` vs `Product Owner`, `Frontend` vs
`Frontend Engineer`…).

## Roster canonique

| Persona | Rôle (intitulé canonique) | Angle de revue |
|---|---|---|
| **SOLID Alex** | Senior Backend Engineer | Schéma de données, frontières de modules, patterns d'implémentation, strangler-fig |
| **Whiteboard Damien** | Tech Lead / Architect | Composition, réutilisation de l'existant, YAGNI, séquencement des phases |
| **Sprint Zero Sarah** | Product Owner | Cadrage du scope, valeur utilisateur, coupes, anti-features |
| **Edge-Case Nico** | QA Engineer | Cas limites, risques, dégradation gracieuse, tests de fumée |
| **Pixel-Perfect Hugo** | Frontend Engineer | Primitives UI, alignement shadcn/Radix, ergonomie |
| **Figma Fiona** | UX/UI Designer | Langage de design, tokens, accessibilité (WCAG) |
| **Devil's-Advocate Nora** | Red-team | Remise en cause, dette de maintenance, lock-in, arbitrages honnêtes |

## Convention

- L'intitulé de rôle apparaît **entre parenthèses** juste après le nom :
  `- SOLID Alex (Senior Backend Engineer) — …`.
- Tous les personas ne sont pas convoqués sur chaque ADR : on invite ceux dont
  l'angle est pertinent (Hugo/Fiona sur les ADR design, Alex/Damien/Nico sur le
  back-end, etc.).
- Les intitulés sont en anglais (comme le reste du code) ; le corps des ADR peut
  être en français.

> Si une nouvelle décision introduit un persona ou révise un intitulé, mettez à
> jour ce tableau **d'abord**, puis les ADR concernés.
