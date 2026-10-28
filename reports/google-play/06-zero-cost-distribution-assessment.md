# 06 — Zero-cost distribution assessment

Researched 2026-10-28 against Google's own documentation. **No account was
created, no terms were accepted, no payment was made, and nothing was enrolled.**
Account-level decisions belong to the owner.

## Headline finding

Google offers a **free Limited Distribution developer account** in the Android
Developer Console. This is materially better than the assumption carried in the
mission brief, and it changes what is achievable without spending money.

Verified from Google's developer-verification FAQ:

> "For developers like students and hobbyists who don't want to provide a
> government ID, we offer a limited distribution account… This lets you share apps
> with up to 20 specific devices for testing and personal use at no cost and
> without ID verification." — *updated 8 June 2026*

> "We are waiving the fee for developers who qualify for a Limited Distribution
> account." — *updated 25 March 2026*

> "We would support migrating limited distribution accounts to full accounts but
> not the other way around." — *updated 8 June 2026*

| Property | Limited Distribution | Full Distribution |
|---|---|---|
| Fee | **free** | US$25 one-time |
| Government ID verification | **not required** | required |
| Developer identity | may remain unverified | verified |
| Reach | up to **20 named devices** | Google Play store listing |
| Purpose | testing and personal use | public distribution |
| Upgrade path | **can migrate to Full** | **cannot downgrade to Limited** |

## One correction to the mission brief

The brief states: *"Changing from the limited account plan to full distribution is
not a simple in-place upgrade."*

Google's published position is the opposite direction of that concern: Limited →
Full **is supported**, and it is Full → Limited that is refused. The asymmetry is
therefore **favourable to starting on Limited** — it is the reversible-to-upgrade
choice, not a trap.

That said, "we would support migrating" is a statement of intent, not a documented
self-service procedure. Treat the upgrade path as *permitted but operationally
unproven* until Google's own console documents the steps.

## Why this matters for the actual blocker

The single hardest `NO-GO` reason in the launch record is not payment — it is:

> **zero physical devices have ever executed this build**

Audio output has never been measured (`audioPeak: 0` on a headless emulator), and
no video, audio or slideshow export has been proven on real hardware. A 20-device
test channel is exactly the shape of that gap: it would allow a
**production-signed** build to be installed on the owner's own phones for real
device QA, without a store listing and without paying.

This does **not** make the app publishable on Google Play. Limited Distribution is
not a store listing, and the mission's end state is a public listing.

## Open questions the owner must resolve, not me

1. **Eligibility.** Google describes it for "students and hobbyists" and developers
   who decline ID verification. KNOUX X is a commercial product from a company in
   Abu Dhabi. Whether it qualifies, and whether choosing an identity-free tier
   conflicts with commercial intent or later verification, is a judgement call with
   business consequences.
2. **Availability.** The FAQ says the tier is "launching in August". Confirm it is
   actually offered in the owner's region today before planning around it.
3. **Signing model.** It is **not documented here** whether Limited Distribution
   uses Play App Signing, requires an upload key, or how it interacts with the
   Option A/B decision already recorded in `01-signing-and-play-app-signing-decision.md`.
   **Do not assume the two decisions are independent** — resolve signing strategy
   against the actual console before enrolling anything.
4. **Package ownership.** Whether a Limited Distribution account claims
   `dev.knoux.playerx` in a way that blocks or complicates a later full account is
   unverified.
5. **Terms of service.** Accepting them is an owner-only action. I have not read,
   accepted, or interacted with any registration flow.

## Free paths available regardless of any Google account

These need no registration at all and are already partially built:

- **Direct production-signed APK installation.** The release pipeline already
  produces a signed APK with full provenance. Sideload onto the owner's own devices
  gives real device QA for free. Constraint: an APK signed by a *different*
  certificate than an existing install cannot update it in place — the CI-signed
  test builds on any device would need uninstall first, which **destroys Vault
  data**. Export Vault contents before any such swap.
- **Private CI artifacts.** Every release-acceptance run uploads APK and AAB to a
  private, expiring artifact store. Good for short-lived verification, not for
  sustained testing.
- **GitHub Release with an explicit prerelease label.** Available, but this is
  public distribution of an APK and should not be confused with Play, and should
  not happen before the owner authorises a release.

## What was NOT done

No account was created or inspected. No eligibility was asserted. No terms were
accepted. No identity declaration was made. No payment instrument was touched.
The `PLAY_ACCOUNT_PAYMENT_BLOCKED` verdict in the readiness report is now better
stated as **`PLAY_ACCOUNT_PAYMENT_NOT_REQUIRED_FOR_TESTING`** — payment blocks a
*public listing*, not *device testing*.
