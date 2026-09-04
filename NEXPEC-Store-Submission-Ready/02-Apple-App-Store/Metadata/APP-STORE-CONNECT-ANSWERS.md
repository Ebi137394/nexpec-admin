# App Store Connect — exact answers, field by field

Everything below is a paste-ready value or an exact selection. Items marked
🔑 OWNER are the only ones that genuinely need you.

## 1 · App record (My Apps → + → New App)
| Field | Value |
|---|---|
| Platform | iOS |
| Name | `NEXPEC` |
| Primary language | English (U.S.) |
| Bundle ID | `com.nexpec.app` (Team CLR47V4LDP) |
| SKU | `nexpec-ios-1` |
| User access | Full Access |

## 2 · Version information (1.0.0)
| Field | Value |
|---|---|
| Screenshots 6.9" + 13" | `02-Apple-App-Store/Screenshots/framed/` (raw/ alternates) |
| Promotional text | from `app-store-listing.md` § Promotional text |
| Description | from `app-store-listing.md` § Description |
| Keywords | `inspection,inspector,NDT,QA,QC,industrial,welding,audit,report,field,engineering,marketplace` |
| Support URL | `https://www.nexpecapp.com/contact` |
| Marketing URL | `https://www.nexpecapp.com` |
| Version | `1.0.0` |
| Copyright | `© 2026 Technologies NEXPEC inc.` |

## 3 · Build
Upload `01-Release-Artifacts/iOS/NEXPEC-1.0.0-build11-AppStore.ipa` via
Transporter.app (drag-and-drop) or Xcode Organizer. 🔑 OWNER (Apple ID login).
Built with the current Apple toolchain (verify stamp is recorded in
`05-QA-and-Verification-Evidence/`).

## 4 · App Review Information
| Field | Value |
|---|---|
| Sign-in required | YES |
| Demo account | `apple_tester@nexpec.com` / password in `Privacy-and-Review/review-notes.md` |
| Notes | paste the whole "Notes for the reviewer" section of `review-notes.md` |
| Contact | your name · info@nexpecapp.com · your phone 🔑 OWNER |

## 5 · App Privacy (questionnaire)
Answer exactly per `Privacy-and-Review/privacy-nutrition-labels.md`:
- Tracking: **No**
- Then add each data type listed there with purpose **App Functionality**,
  **Linked to the user's identity**, not used for tracking.
🔑 OWNER: the final "Publish" click is a legal declaration.

## 6 · Age rating
Questionnaire: answer **None/No** to every content category (violence, sexual
content, gambling, contests, medical, etc.), **Unrestricted web access: No**.
Result: **4+** (it is a business tool; there is no age-gated content).

## 7 · Export compliance
The binary declares `ITSAppUsesNonExemptEncryption = false` — App Store Connect
will not even prompt. If asked: uses only standard HTTPS/TLS → **exempt**.

## 8 · Pricing & Availability
Price: **Free** · Availability: all territories (or your preference 🔑 OWNER).

## 9 · Submit
🔑 OWNER — the final "Add for Review" / "Submit" click.
