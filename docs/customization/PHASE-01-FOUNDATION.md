# PHASE 01 â€” KNOUX Foundation & First Build

This phase begins the real product customization while protecting the existing codebase.

## Applied foundation

- Central brand contract in src/config/brand.ts.
- KNOUX Neon Core tokens in src/styles/knoux-tokens.css.
- Global token import without replacing the existing interface.
- Product metadata normalized in package.json.
- Repository doctor command: 
pm run doctor.
- Complete verification command: 
pm run phase1:verify.
- Deterministic line-ending rules in .gitattributes.

## Brand baseline

- Product: KNOUX Player X
- Short name: KNOUX X
- Developer: Eng. Sadek Elgazar (Knoux)
- Website: https://knoux.store
- Theme: Knoux Neon Core

## Safety

All work is performed on a dedicated customization/phase-01-foundation-* branch. Do not merge until every build gate is PASS.