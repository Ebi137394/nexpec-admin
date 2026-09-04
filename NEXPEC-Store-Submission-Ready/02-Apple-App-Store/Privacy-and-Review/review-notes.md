# App Review information — NEXPEC 1.0.0

## Demo account (works on the live production backend)
- Email: apple_tester@nexpec.com
- Password: Rev!7bkXn1mk6StN7q
- Role: Client (the buying side — full portal access)

This account owns a demo inspection job — "Demo: Pipeline UT Inspection (App
Review)" — pre-loaded so the reviewer can see the client workflow (job details,
applications, contract and report surfaces) without waiting for real
marketplace activity. The job is intentionally hidden from the public
marketplace so real inspectors do not apply to it.

Verified working on 2026-08-21: login succeeds and the demo job is visible from
this account.

## Notes for the reviewer
1. **Account types.** Clients can use the app immediately after signup.
   Inspector, agency and supplier accounts enter a "verification in progress"
   state until our operations team approves them — this is deliberate (vetted
   marketplace). The demo account above bypasses nothing; it is a normal,
   verified client account.
2. **Payments.** NEXPEC brokers real-world professional inspection services
   (physical-world services → out of IAP scope, Guideline 3.1.5(a)). This
   release settles engagements by manual payment (bank transfer / invoice)
   recorded by our operations team. Online card payment is not offered in this release; the payment-options panel notes it as "Coming soon" (informational, not tappable), and the Finance area is a settlement dashboard (contract value / paid / outstanding) driven by NEXPEC-confirmed manual payments. No digital
   content or services are sold in-app; there is no IAP.
3. **AI features (beta).** The AI Co-Inspector tools run on-device (TensorFlow
   Lite) and are advisory only. Every AI observation requires human inspector
   confirmation before it can enter a report. A beta disclaimer is shown on the
   AI surfaces.
4. **User-generated content.** Chat exists only between verified, contracted
   parties and NEXPEC staff. Every conversation carries an in-app "Report this
   conversation" control (flag icon); reports route to our staffed moderation
   inbox with an audit trail. NEXPEC administrators can retire rooms.
5. **Sign in with Apple** is offered alongside Google sign-in. Password
   reset works from the sign-in screen (deep link nexpec://reset-password).
6. **Account deletion** is available in-app: Profile → Security → Delete
   Account. Public deletion page: https://www.nexpecapp.com/account/delete
7. **Camera/photos/location/calendar/notifications** are requested only in the
   flows that use them (inspection capture, report evidence, site check-in,
   schedule sync). The app functions without granting them.

## Contact
- Support: info@nexpecapp.com
- Website: https://www.nexpecapp.com

## Note on the SSO / Enterprise buttons (for the reviewer)
The 🔐 SSO and 🏢 Enterprise buttons open our real single-sign-on flow for
companies with a registered identity provider. No demo IdP is provisioned, so
entering any domain shows an informative message ("Single sign-on is not
active for this domain yet…") and directs the user to email + password. This
is the intended behaviour — please use the demo account above to sign in.
