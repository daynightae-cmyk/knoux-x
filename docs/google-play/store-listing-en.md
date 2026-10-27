# KNOUX X — Google Play store listing (English)

App: KNOUX X — "Create · Play · Enhance"
Android package: `dev.knoux.playerx` · versionName `2.1.0`
Developer: KNOUX X, Abu Dhabi, United Arab Emirates
Repository: https://github.com/daynightae-cmyk/knoux-x
Document status: ready for the Play Console draft, **not approved for publication** until every
`OWNER ACTION REQUIRED` line below is resolved and the listing is re-checked against the APK that is
actually uploaded.

> How to read this document. Every claim is taken from an acceptance run on a real installed Android
> build (emulator, API 35, the shipped release APK). Three tiers are used and must not be confused:
> **verified** (proven on that build), **early on Android** (real code, device proof incomplete),
> **not in the Android app** (absent; must never appear as an Android feature). Character counts are
> Unicode code points of the text exactly as written, including spaces and punctuation.

---

## 1. App name (Play limit: 30 characters)

| Variant | Name | Code points | Within limit |
|---|---|---|---|
| A | `KNOUX X: Local Media Studio` | 27 | yes |
| B | `KNOUX X: Video & Vault` | 22 | yes |
| C | `KNOUX X: Edit · Play · Protect` | 30 | yes (exactly at limit) |

## 2. Short description (Play limit: 80 characters)

| Variant | Short description | Code points | Within limit |
|---|---|---|---|
| A | `Edit video on a timeline, play your files, and keep a private encrypted vault.` | 78 | yes |
| B | `Local video editing, playback, and an encrypted vault on your device.` | 69 | yes |
| C | `Create, play, and protect your media. No ads, no analytics, no account.` | 71 | yes |

## 3. Recommended default

- **App name: variant A — `KNOUX X: Local Media Studio` (27 characters).**
- **Short description: variant C — `Create, play, and protect your media. No ads, no analytics, no account.` (71 characters).**

Why these, using only verified facts:

- "Local" is the one differentiator this build can prove. Media is processed on the device, there is no
  analytics, advertising or crash-reporting SDK, no advertising ID, no account and no cloud backup of
  Vault data. "Local" is therefore a statement of fact, not a promise.
- "Media Studio" names what the verified modules actually are: an import and library flow, a Video
  Studio timeline, a media player and a Vault. It deliberately avoids naming the two features that
  cannot carry a headline here — retouch export and audio work — because their on-device proof is not
  finished, and it avoids "AI" entirely, since no AI provider exists in this build.
- Variant B is honest but narrow: it drops playback and import, which are among the strongest verified
  behaviours. Variant C sits exactly on the 30-character limit, so any later edit to the brand spacing
  breaks it, and "Protect" reads like a security guarantee we do not make.
- For the short description, variant C leads with the three verified verbs and then states three facts
  a buyer can check in the Data safety form. Variant A is the most concrete fallback if you prefer to
  lead with the timeline; variant B is the calmest but repeats the name's idea.

No variant uses "unlimited", "all", "every", "full", "4K", "AI-powered", "professional-grade" or any
other word the acceptance run does not support.

---

## 4. Full description (Play limit: 4000 characters)

The listing text is between the two marker lines below. Copy everything between them, not the markers.
**Length: 3244 characters (code points), limit 4000.** The count is the same with the soft wraps in this
file or unwrapped into one line per paragraph, because each wrap becomes a space. Re-count after any
edit.

<!-- FULL_DESCRIPTION_START -->
KNOUX X puts video editing, playback, image retouching and a private encrypted vault in one app that
works with the media already on your device.

WE TEST ON THE BUILD WE SHIP
Everything below was checked on an installed Android build. Where a feature is newer on Android, or its
device proof is not finished, we say so rather than oversell it.

IMPORT AND LIBRARY
- Bring photos and video in through the Android system picker. The access you grant keeps working after
  the app is closed or restarted.
- Imported media is organised into a library you browse inside the app.
- If you cancel a picker or a save, nothing is written and the app does not claim otherwise.

VIDEO STUDIO
- Timeline editing by touch: move along a clip and split it into two. Your clip list is saved and is
  there when you come back.
- Screen recording behind the Android consent dialog, with a notification that lets you stop it. A
  recording is only reported as successful once its length and dimensions have been checked.

PLAYBACK
- MP4 playback with a real decoded first frame, working seek and steady video frames. Audio output on
  every handset is still being confirmed.

VAULT
- A PIN-protected encrypted container for the files and projects you choose to protect.
- Wrong PINs are refused. Tampering is contained. A damaged index can be recovered. Deleting an item
  removes its container and its index. Unencrypted working data is cleared when the app closes, and you
  can change your PIN.
- Vault data stays on the phone. It is not backed up to any server, and a forgotten PIN cannot be
  recovered. Please keep your PIN safe.

IMAGE STUDIO AND AUDIO LAB, EARLY ON ANDROID
- Image Studio imports your photos and gives you a photo editor with on-device face and pose guidance.
  That guidance downloads its model files the first time you use it, so your first retouch session needs
  an internet connection.
- Audio Lab applies real audio effects and can produce MP3 or WAV output.
- On-device verification of these two exports is not finished. Exports are rendered by the app's built-in
  engine: MP4 where the device allows it, and WebM for slideshows when it does not, and the app tells you
  which one you got. Expect a result you can share, not a guaranteed gallery entry, not 4K, and not every
  codec. Microphone capture is not part of this Android build.

NOT IN THE ANDROID APP
- No AI generation of any kind. No cloud AI, no text to image, no text to video, no library of models.
  No AI provider exists in this build, so such a request stops with a clear message instead of a fake
  result.
- No account, no sign-in, no cloud sync, and no desktop-only tools that we have not finished bringing
  across.

PRIVACY SHAPES THE APP
- No advertising, no analytics, no crash reporting, no advertising ID.
- Your media, its file paths and your Vault contents are not uploaded. The app reaches the network for
  two narrow reasons: to download the retouch model files once, and to check our public GitHub releases
  for an update.
- English and Arabic interfaces, with a full right-to-left layout.

KNOUX X is an independent developer based in Abu Dhabi, United Arab Emirates. The app is made for adults
who work with their own footage and photographs.
<!-- FULL_DESCRIPTION_END -->

---

## 5. Release notes — "What's new" for 2.1.0

Google Play caps release notes at 500 characters. The field-ready text below is **492 characters
(code points)**, written as a single paragraph so the count is unambiguous. Copy only the line inside the
block.

```
2.1.0 is our first listed Android build, and the one we tested on device. Verified: import through the system picker with access that survives a force-stop and an app restart, timeline scrub and split with a saved clip list, screen recording behind the consent dialog with a checked MP4 output, a PIN-protected encrypted Vault with no cloud backup, and MP4 playback with working seek. Still maturing: Image Studio and Audio Lab exports. Not in this build: AI generation, accounts, cloud sync.
```

Longer internal version of the same notes, for the changelog and QA handoff (do not paste into the
Console field, it exceeds 500 characters):

- First Android build published under this listing; the release notes describe the tested APK only.
- Branded start screen that reaches the dashboard, with a bounded boot supervisor and a readable failure
  and retry panel instead of an endless spinner.
- Import via the Android system picker / Storage Access Framework, including access that survives a
  force-stop and process restart; MediaStore library organisation; selected-video access; a cancelled
  picker or save reports nothing saved and writes no file.
- Video Studio timeline: touch scrub, split a clip into two, edited clip list persists.
- Screen recording through Android MediaProjection with the real system consent dialog, a notification
  with a stop action, correct service lifecycle, and a validated real MP4 file (duration and dimensions
  checked before success is reported).
- Vault: encrypted container (KNVX, AES-GCM with PBKDF2 and AndroidKeyStore), wrong-PIN refusal,
  membership gate, tamper containment, corrupt-index recovery, delete integrity, PIN rotation, and
  plaintext cache cleared on process kill. Local only; `allowBackup=false` in the shipped APK.
- MP4 playback: first frame decoded, seek working, video frames rendering.
- Unchanged and still honest: no AI provider in the Android build; audio output and the Image Studio and
  Audio Lab exports are not yet device-proven on Android.

> OWNER ACTION REQUIRED: if 2.1.0 also contains bug fixes or translations beyond the items above, supply
> the actual changelog entries; nothing here has been invented, and the public 500-character note must
> not be padded with fixes that were not shipped.

---

## 6. Category recommendation

- **Primary recommendation: "Video players & editors".** This is the storefront label for the
  `VIDEO_PLAYERS` category, and it fits the two strongest verified pillars: importing and playing MP4
  video, and editing it on a timeline.
- **Alternative: "Art & Design"** if you would rather be found by people shopping for creative tooling;
  it also gives less prominence to the word "player", which understates the Vault.
- **Alternative: "Tools"** if the privacy and Vault angle is what you want to lead with commercially. It
  is the safest claim-wise and the weakest for discovery.
- **Content rating:** fill the Play content-rating questionnaire on the shipping build and enter the real
  result; the listing assumes a general-audience app with user-owned media and no in-app purchase of
  media. Do not copy another app's rating.

> OWNER ACTION REQUIRED: confirm the final Console category, the content-rating questionnaire outcome,
> and whether any in-app product or subscription exists in 2.1.0. The listing text above assumes a
> single paid or free app with no in-app purchases; that assumption is not verified and must be replaced
> with the real pricing configuration before publication.

---

## 7. Screenshot alt text

Use one line per screenshot, describing only screens that exist in the shipping build. Order matters: the
first two are shown above the fold on most devices.

1. Dashboard of KNOUX X on Android showing the entry points for the media library, Video Studio, Image
   Studio, Audio Lab, slideshow, player and Vault.
2. The Android system file picker open over the app, with photos and video folders available to import.
3. Media library listing imported clips and images inside the app.
4. Video Studio timeline with a clip split into two parts and the scrub handle under the playhead.
5. Android screen-recording consent dialog, with the app's recording notification and stop action below
   it.
6. Media player showing a decoded video frame with the seek bar and time readout.
7. Vault lock screen with the PIN keypad on a dark background.
8. Vault contents list with an encrypted item and its change-PIN and delete actions.
9. Image Studio photo editor with crop and adjustment controls on a portrait photo.
10. Language setting showing the English and Arabic interfaces, the second screen laid out
    right-to-left.

Do not screenshot or caption: AI generation, cloud sync, 4K or codec-selection dialogs, microphone
recording, or an export landing in the shared gallery. None of these is proven in this build.

> OWNER ACTION REQUIRED: capture these screenshots from the exact release APK that is uploaded, at the
> device resolution you publish at, and confirm the real module names shown in the shipping dashboard
> before the alt text is pasted into the Console. The names above follow the tested build's module list;
> a screenshot that shows a different label is a listing mismatch.

---

## 8. Open items in this document

Every placeholder inserted above, in order:

1. Section 5 — actual 2.1.0 changelog entries beyond the verified items.
2. Section 6 — final Console category, content-rating outcome, and the real in-app purchase or pricing
   configuration.
3. Section 7 — screenshots captured from the shipping release APK and confirmation of on-screen module
   names.

Contact details, support address and developer website are deliberately absent from the public listing
text as well; see the privacy policy document for those placeholders. They must not be invented here.

> OWNER ACTION REQUIRED: provide the public support email address, the support phone number and the
> developer website URL that Play Console asks for. The listing must not publish a fabricated address or
> domain.
