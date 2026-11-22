/**
 * Icons drawn on every card (the Lucide `Tag` and `Box`, same paths and stroke). The sprite holds each drawing once
 * in the document, and an `Icon` points at it with `<use>`, so a card with several chips adds one `<svg>` and one
 * `<use>` per icon instead of a full drawing. Colour comes from `currentColor` through the inherited stroke.
 */
export type IconName = 'tag' | 'box';

/** Mount once, at the app root, so every `Icon` can refer to its symbol. */
export function IconSprite() {
  return (
    <svg aria-hidden="true" focusable="false" style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}>
      <symbol id="icon-tag" viewBox="0 0 24 24">
        <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" />
        <circle cx="7.5" cy="7.5" r=".5" fill="currentColor" />
      </symbol>
      <symbol id="icon-box" viewBox="0 0 24 24">
        <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
        <path d="m3.3 7 8.7 5 8.7-5" />
        <path d="M12 22V12" />
      </symbol>
    </svg>
  );
}

/** A sprite icon. Size it with `className` (for example `size-3.5`), as with the Lucide icons it replaces. */
export function Icon({
  name,
  className,
  strokeWidth = 2,
}: {
  name: IconName;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={className}
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <use href={`#icon-${name}`} />
    </svg>
  );
}
