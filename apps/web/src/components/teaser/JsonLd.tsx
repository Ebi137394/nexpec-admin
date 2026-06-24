// ════════════════════════════════════════════════════════════════════════════
//  components/teaser/JsonLd.tsx — schema.org structured-data injector (RSC)
//
//  Renders a single <script type="application/ld+json"> in the server-rendered
//  HTML so crawlers (incl. Google Jobs for JobPosting) read it on first fetch.
// ════════════════════════════════════════════════════════════════════════════
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      // Server-rendered, static object → safe to inline.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
