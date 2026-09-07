// ════════════════════════════════════════════════════════════════════════════
//  StoreBadges — official Apple / Google Play download badges.
//
//  The artwork is OFFICIAL and UNMODIFIED: Apple's own marketing-tools SVG and
//  Google's own hosted PNG, both served from /brand. Neither store permits a
//  recreated lookalike, and neither permits restyling, so these are never
//  recoloured or masked — only scaled.
//
//  Sizes make them look OPTICALLY equal rather than numerically equal: Apple's
//  artwork is edge-to-edge (119.66x40), while Google's carries ~12% built-in
//  padding, so it needs a slightly taller box to read at the same height.
//
//  Plain <img> rather than next/image: SVG through next/image needs
//  dangerouslyAllowSVG, and these are fixed-size static assets where explicit
//  width/height already prevents layout shift.
// ════════════════════════════════════════════════════════════════════════════
export const APP_STORE_URL =
  'https://apps.apple.com/us/app/nexpec/id6804268926';
export const GOOGLE_PLAY_URL =
  'https://play.google.com/store/apps/details?id=com.nexpec.app';

export function StoreBadges({
  className = '',
  size = 'md',
}: {
  className?: string;
  size?: 'sm' | 'md';
}) {
  const apple = size === 'sm' ? { w: 108, h: 36 } : { w: 135, h: 45 };
  const google = size === 'sm' ? { w: 109, h: 42 } : { w: 136, h: 53 };

  return (
    // flex-wrap, not a media query: the pair sits side by side wherever there
    // is room and wraps cleanly when there is not, so it can never overflow.
    <div className={`flex flex-wrap items-center gap-3 ${className}`}>
      <a
        href={APP_STORE_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Download NEXPEC on the App Store"
        data-analytics-event="app_store_click"
        className="inline-block rounded-lg transition-opacity hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-400"
      >
        <img
          src="/brand/app-store-badge.svg"
          alt="Download on the App Store"
          width={apple.w}
          height={apple.h}
          loading="lazy"
          decoding="async"
          style={{ width: apple.w, height: apple.h }}
        />
      </a>

      <a
        href={GOOGLE_PLAY_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Get NEXPEC on Google Play"
        data-analytics-event="google_play_click"
        className="inline-block rounded-lg transition-opacity hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-400"
      >
        <img
          src="/brand/google-play-badge.png"
          alt="Get it on Google Play"
          width={google.w}
          height={google.h}
          loading="lazy"
          decoding="async"
          style={{ width: google.w, height: google.h }}
        />
      </a>
    </div>
  );
}
