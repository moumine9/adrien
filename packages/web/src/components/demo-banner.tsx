/** Shown in the demo build only (see layout.tsx): the decisions here are a made-up sample, not a repository's log. */
export function DemoBanner() {
  return (
    <div className="border-b-4 border-border bg-caution text-ink">
      <p className="mx-auto max-w-6xl px-4 py-2 text-sm sm:px-6">
        <strong className="font-heading">Demo data.</strong> The decisions here are a made-up sample, answered from your
        browser. Nothing on this page reads a repository.
      </p>
    </div>
  );
}
