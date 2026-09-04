# Google Play Console — exact answers, screen by screen

## 1 · Create app
| Field | Value |
|---|---|
| App name | `NEXPEC` |
| Default language | English (US) |
| App or game | App |
| Free or paid | Free |
| Declarations | accept both checkboxes 🔑 OWNER |

## 2 · Main store listing
| Field | Value |
|---|---|
| Short description | `Vetted industrial inspectors, controlled contracts, professional reports.` |
| Full description | from `play-listing.md` |
| App icon | `Feature-Graphic-and-Icon/play-icon-512.png` |
| Feature graphic | `Feature-Graphic-and-Icon/feature-graphic-1024x500.png` |
| Phone screenshots | `Screenshots/framed/` (min 2) |
| 7" & 10" tablet | reuse the framed set (in-range sizes) |

## 3 · App content (Policy → App content)
| Declaration | Answer |
|---|---|
| Privacy policy | `https://www.nexpecapp.com/legal/privacy` |
| Ads | **No ads** |
| App access | "All or some functionality is restricted" → add instruction set: credentials from `Data-Safety-and-Review/review-notes.md` |
| Content ratings (IARC) | Business/Productivity; No to all content questions; **users can interact** (moderated chat, in-app report control) 🔑 OWNER (legal declaration) |
| Target audience | **18 and over** |
| News app | No |
| COVID-19 tracing/status | No |
| Data safety | per `Data-Safety-and-Review/data-safety-answers.md` (collected: yes; shared: no; encrypted in transit: yes; deletion: in-app + `https://www.nexpecapp.com/account/delete`) 🔑 OWNER final submit |
| Government app | No |
| Financial features | None to declare (records offline manual settlement for real-world services) 🔑 OWNER confirm reading |
| Health | No |

## 4 · Release (Testing → Internal testing first)
1. Create internal testing release.
2. Upload `01-Release-Artifacts/Android/NEXPEC-1.0.0-versionCode16-production.aab`.
3. Release notes: `Initial release: verified inspector marketplace, controlled contracts, structured reporting, manual settlement dashboard, beta AI inspection tools.`
4. Add your email as tester → roll out to internal testing.
5. **Read the pre-launch report** (this definitively answers the 16 KB check —
   see `05-QA-and-Verification-Evidence/ANDROID-16KB-FINDING.md`).
6. Promote to Production only after the report is clean 🔑 OWNER.

## Known risk to check at step 5
Expo SDK 52 native libraries are 4 KB-aligned (31/40). Google's 16 KB
requirement may block or warn at upload for new apps targeting Android 15.
If the console blocks: the documented fix is the Expo SDK 53+ upgrade next
cycle; nothing about this package changes except the AAB.
