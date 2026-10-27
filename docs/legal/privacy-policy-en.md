# Privacy Policy — KNOUX X for Android

**Effective date: 27 October 2026 — provisional, pending publication.** The date above is the intended
effective date for the first published version of this policy. It becomes the real effective date only
when version 2.1.0 (package `dev.knoux.playerx`) and this text are published together, and the policy must
be re-dated if publication slips.

> **DRAFT — LEGAL REVIEW REQUIRED BEFORE PUBLICATION.** This document was written from the app's own
> verified behaviour and the compiled Android manifest. It is not legal advice and has not been reviewed by
> a lawyer. Do not link it from Google Play, the app, or any website until a qualified reviewer has checked
> it against the store listing, the Data safety form, and the laws of every country you distribute in.
>
> **Do not publish any contact detail in this file that has not been supplied by the developer.** Every
> place where a real value is still missing is marked `OWNER ACTION REQUIRED` rather than filled with a
> plausible-looking address, domain, phone number, or registration number.

---

## 1. Who publishes this app

- **Developer / app publisher:** KNOUX X, based in Abu Dhabi, United Arab Emirates.
- **App:** KNOUX X ("Create · Play · Enhance"), Android build, package `dev.knoux.playerx`, version 2.1.0.
  A separate Windows desktop application exists under the same brand; this policy describes the Android
  app, and any difference in the desktop build's data handling will be covered when it is published.
- **Public source repository:** https://github.com/daynightae-cmyk/knoux-x
- **Privacy contact:** not stated here on purpose. See section 12.

> OWNER ACTION REQUIRED: supply the public privacy/support email address that will appear in this policy,
> in Google Play Console, and in the app's "About" screen. Also supply, if you want them published: a
> support phone number, a postal address for the developer profile, and the URL where this policy will be
> hosted. Nothing in this document has been invented and nothing should be filled in with a guess.

## 2. The short version

- Your media is handled on your own device.
- The Android app does not upload your photos, videos, projects, file paths, or anything inside your Vault.
- No analytics, advertising, or crash-reporting service is part of the Android build, and there is no
  advertising ID.
- No account, no sign-in, and no profile server exist in the Android build, so the app does not process
  personal data to operate an account.
- The app uses the internet for two limited, listed purposes: downloading on-device retouch model files
  once, and checking our public GitHub releases for an update.
- Your Vault is encrypted locally. It is not backed up anywhere, and a forgotten PIN cannot be recovered.
- Anything you send out of the app by sharing or exporting is your own deliberate action, not collection
  by us.

## 3. What the app can access, by category

| Category | What that means in this app | Where it lives |
|---|---|---|
| Photos and videos you select | Files you bring into the media library through the Android system picker, and the clips you edit in Video Studio | Your device; app-private storage for projects |
| Audio files | Tracks listed for playback and for Audio Lab processing | Your device |
| Screen contents | Only while you deliberately start a screen recording, after the Android consent dialog | Your device, written as a recording file |
| Vault contents | Files and projects you deliberately place inside the Vault, encrypted under your PIN | Encrypted container in app-private storage; never backed up |
| Edit and project data | Split points, clip lists, and settings created while you work | Your device |
| Version information | The release list of our public GitHub repository, read by the in-app update check | Nothing is sent about you |
| Model files | Retouch face/pose model files downloaded once from Google's model hosting | Your device cache |

The app does **not** collect: your name, email, phone number, contacts, location, call logs, messages,
browsing history, device or advertising identifiers, or a profile of you. It never sees payment card data —
purchases, if any ever exist, are handled by Google Play.

## 4. Why data is used, and whether it is shared

Purposes, all of them local:

1. **Providing the feature you asked for** — importing, organising, editing, playing, retouching,
   processing audio, recording the screen, and protecting files in the Vault.
2. **Integrity and honest reporting** — a recording is only reported as successful after its duration and
   dimensions are checked; a cancelled picker or save writes nothing and reports nothing as saved; a
   damaged Vault index is recovered or contained rather than silently ignored.
3. **Keeping the app current** — reading the public GitHub release list so the app can tell you a newer
   build exists.
4. **Enabling on-device image guidance** — fetching the retouch model files the first time you use face or
   pose guidance, then caching them.
5. **User-directed export and sharing** — when you choose Share or Export, the app hands the selected file
   to the destination you chose. This is your transfer, not our collection.

Sharing by us: **none.** There is no server component in the Android build that receives your media or
your data, no data broker relationship, no advertising partner, and no "sale" or "sharing" of personal
data in the sense used by privacy laws such as the CCPA/CPRA.

## 5. Device permissions and what each one is for

These are exactly the permissions declared by the shipped Android manifest. No permission is claimed to do
something the app does not do.

| Permission | Why the app declares it |
|---|---|
| `INTERNET` | Two narrow uses: the one-time download of retouch model files, and the in-app update check against our public GitHub releases. No media, file paths, or Vault content is uploaded. |
| `POST_NOTIFICATIONS` | To show the recording notification with a stop action, and notifications for background playback, on Android 13 and newer. |
| `FOREGROUND_SERVICE` | So a user-started task (recording, playback) can keep running with a visible notification instead of being killed. |
| `FOREGROUND_SERVICE_MEDIA_PLAYBACK` | Required by Android for the service that keeps media playing while you use other apps. |
| `FOREGROUND_SERVICE_MEDIA_PROJECTION` | Required by Android for screen recording through `MediaProjection`. The system consent dialog still appears and you must accept it each time. |
| `READ_MEDIA_IMAGES` | To list and import the photos you allow, for the library and Image Studio (Android 13+). |
| `READ_MEDIA_VIDEO` | To list and import video for the library, Video Studio, and playback (Android 13+). |
| `READ_MEDIA_AUDIO` | To list audio for the player and Audio Lab (Android 13+). Note that we have not yet verified audio *output* on a device with audio hardware. |
| `READ_MEDIA_VISUAL_USER_SELECTED` | Android's "select photos" mode, so you can grant access to only the items you pick rather than a whole category. |
| `READ_EXTERNAL_STORAGE` (maxSdkVersion 32) | The equivalent read access on Android 12L and older, where the newer media permissions do not exist. |
| `RECORD_AUDIO` | Used for one narrow purpose: the optional microphone track **during screen recording**, when you choose to include your voice. The app is asked for this permission at that moment, not at install. Standalone audio recording is not implemented on Android, so the app never records from the microphone outside a screen recording you started. |
| `MODIFY_AUDIO_SETTINGS` | To let playback route and adjust audio settings on the device (for example, output device behaviour while media plays). It does not capture audio. |

> Note on the camera: KNOUX X never opens the camera — screen capture goes through
> Android's `MediaProjection` consent flow and the media library reads files that
> already exist. A folder named `Camera` in your gallery is a directory being read,
> not a camera being used. The build pipeline therefore rewrites the `CAMERA`
> declaration inherited from the Capacitor template into a manifest-merger removal
> rule (`tools:node="remove"`).
>
> **Status:** this is now verified against a compiled build. In the release artifact produced from `main` at `fe9a030`, the Android asset tooling reports **no** `CAMERA` permission at all, while `RECORD_AUDIO` and `MODIFY_AUDIO_SETTINGS` are present. The permission list in this policy therefore matches a real artifact rather than an intention. It must still be re-checked against the exact bundle that gets uploaded.

> OWNER ACTION REQUIRED: confirm the final permission list against the APK that is actually uploaded
> (`aapt2 dump permissions` or the Console's own manifest report), and paste the per-permission
> justifications into the Console. The table above must match that build, not an earlier one.
> The microphone-track path of screen recording is implemented but **not yet verified on a device with
> audio hardware**, so its Console justification must be written from a real demonstration, not from
> this document.

## 6. Third parties that actually touch anything

Only these, and each one is a plain network request for a file — not a monitoring SDK:

1. **Google (model hosting, `storage.googleapis.com`).** The first time you use on-device face/pose
   guidance in Image Studio, the app downloads the MediaPipe model files that make it work. The download is
   verified against a pinned SHA-256 checksum and then cached, so the model is not fetched again and the
   feature does not need the internet after that first use. The request carries only what an ordinary HTTPS
   file request carries (the address of the file, your IP address, and standard device/network metadata as
   seen by the host); your media, filenames, project data and Vault contents are not part of it. The host's
   own logging is governed by Google's privacy policy, not ours.
2. **GitHub (public release assets).** The in-app update check reads the release asset list of
   `daynightae-cmyk/knoux-x` to see whether a newer version exists. Nothing about you is sent beyond the
   ordinary request. Distribution through Google Play means Google Play's own terms and privacy policy
   apply to installing, purchasing and updating the app; that data is collected by Google as the store
   operator, not by us.
3. **The Android platform and its WebView.** The app's media engine runs inside the Android System WebView
   supplied by your device. Capacitor and the open-source libraries used by the app are bundled code, not
   analytics services; they send no data of theirs own, and no third-party analytics, advertising or
   crash-reporting SDK is present in the build.

No AI provider is configured in the Android build. There is no cloud AI generation, so no prompt and no
image is ever sent to an AI service from this app; the related desktop-side plans are not available here,
and a request of that kind fails with a clear message instead of pretending to work.

## 7. Retention, deletion and your control

- **How long:** on your device, for as long as you keep it. The app keeps no server-side copy, so there is
  nothing of yours retained anywhere else.
- **Deleting content:** delete media, projects or Vault items from inside the app. The Vault delete path was
  verified to remove the encrypted container and its index, so a deleted Vault item is not left behind in
  the container.
- **Uninstalling:** removes the app's private storage, including project data and the Vault container.
  Media you imported stays in your own media library, where it always was; recordings and exports you saved
  stay where you saved them.
- **Backing up:** Vault data is deliberately excluded from Android's auto-backup
  (`android:allowBackup=false` in the shipped APK). There is therefore no cloud copy of your Vault, and no
  server-side recovery of it.
- **Revoking access:** any permission in section 5 can be revoked in Android settings at
  *Apps › KNOUX X › Permissions*; the app also asks through the system picker when it needs media access.
- **Clearing the app's data:** Android's "Clear storage" removes everything the app holds privately. Before
  you do it, export anything you want to keep — and know that a Vault you cannot unlock is not recoverable
  by us.

## 8. How the Vault is protected, and what is not promised

What is actually done, as verified on an installed Android build:

- Vault content is stored in an encrypted container (KNVX format) using AES-GCM, with the key derived
  through PBKDF2 and protected by the Android keystore (`AndroidKeyStore`).
- A wrong PIN is refused. PIN rotation is supported. Working plaintext is cleared when the app process
  ends.
- Tampering with a container is contained rather than trusted, and a damaged index can be recovered.
- Downloads of model files are integrity-checked against a pinned SHA-256 checksum.
- No cloud backup, no telemetry, no remote unlock: nothing about your Vault leaves the device, including
  its contents, its size, and its filenames.

What we do **not** claim, honestly:

- We do not say "military-grade", "unhackable", "anonymous", or "end-to-end encrypted", and we do not
  promise that your data can never be lost or exposed. A determined attacker with physical access to an
  unlocked or rooted device, a weak PIN you chose, or your own careless sharing of an exported file can all
  defeat what these measures do.
- The app and the Vault format have **not** been through an independent penetration test or external
  security audit. If that ever changes, this section will be rewritten to describe who tested what.
- Encryption without recovery is a real trade-off, and it is yours to accept: **if you forget your Vault
  PIN, there is no reset, no recovery email, and no way for us to open your Vault.** Your data stays
  encrypted and unreachable. Use a PIN you will remember.

## 9. Your rights and how to get support

Because the Android app never receives your personal data, there is nothing for us to export, correct or
delete on your behalf: your files, projects and Vault are already under your control on your device, and
sections 2, 3 and 7 describe how to move or destroy them. If a public authority or a data-protection regime
in your country asks us to confirm our handling, the answer is the one above: no personal data is collected
by the app, and no user media is transmitted by it.

To exercise your rights, or to report a privacy concern:

- Use the in-app controls for deletion, export and permission revocation described above.
- Contact the developer through the address in section 1.

> OWNER ACTION REQUIRED: confirm the support channel(s) that will be published — email address, and any
> in-app feedback route that actually exists in 2.1.0 — plus the response time you are willing to commit
> to. Do not publish a support channel that no one reads; privacy laws and the Play policy both assume a
> working contact.

## 10. Accounts and the Play account-deletion requirement

The Android app has no account, no sign-in, and no profile server, and it stores no server-side record of
you. There is therefore no account to delete and the Google Play account-deletion requirement does not
apply to this app. If an account is ever introduced, this section must be replaced with a real account
deletion flow and a matching web endpoint before the app can be released.

## 11. Children

KNOUX X is not directed at children. It is marketed to adults who work with their own footage and
photographs, it collects no child-directed data, and it requests none. It has no child-mode, no social
features, no chat, and no user-generated content shown to other people, because nothing is transmitted
between users at all.

## 12. Changes to this policy, and where it lives

- **Effective date of this version:** 27 October 2026 (provisional, as stated at the top of this document).
- Material changes get a new version of this page with a new effective date, and the change will be
  summarised at the top of the policy. Where the app itself can show it, an update note will appear at
  launch after the change.
- Because the app cannot upload your data, a policy change is never needed in order to start collecting
  something new — but it is needed if a new network destination, SDK or account is ever introduced.

> OWNER ACTION REQUIRED: provide the public URL where this policy will be hosted (the Play Console "Privacy
> policy" field requires a live, publicly reachable page). Until it exists, this file is a local draft and
> the app must not be submitted.

> OWNER ACTION REQUIRED: have this policy reviewed by a qualified lawyer for each market you distribute
> in — at minimum the UAE, plus any region with statutory privacy rights you intend to serve (for example
> the EU/UK under GDPR, or California under CCPA/CPRA). Confirm the final effective date at the moment of
> publication, and make sure the Data safety form in Google Play Console says exactly what sections 3 to 7
> of this policy say; a mismatch between the form and the policy is a rejection risk, not a cosmetic issue.

## 13. Checklist of open items in this document

1. Section 1 — public privacy/support email, and optional phone, postal address and policy URL.
2. Section 5 — the final permission list read from the APK that is actually uploaded, and the per-permission
   Console justifications, above all the microphone-track-of-screen-recording justification, which has not
   yet been verified on a device with audio hardware. (The unused `CAMERA` permission has been removed from
   this build.)
3. Section 9 — the support channel and the response time you will commit to.
4. Section 12 — the hosted policy URL, legal review, the confirmed effective date, and alignment with the
   Play Data safety form.

Every one of these is marked in place with `OWNER ACTION REQUIRED`. Nothing else in this policy needs a
value that was not verified from the app itself.
