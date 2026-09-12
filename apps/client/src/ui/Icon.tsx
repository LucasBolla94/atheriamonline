/** Small original UI pictograms share one stroke and remain legible at touch size. */
const paths = {
  home: 'M3 11 12 3l9 8M5 10v11h5v-7h4v7h5V10',
  castle: 'M4 21V5h4v4h3V3h3v6h3V5h4v16H4m6 0v-6h5v6',
  chat: 'M4 4h16v12H9l-5 5V4m4 4h8m-8 4h5',
  bag: 'M6 7h12l3 14H3L6 7m3 0V5a3 3 0 0 1 6 0v2',
  shirt: 'm8 3 4 2 4-2 6 5-4 4v9H6v-9L2 8l6-5',
  compass: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20m4 6-2 6-6 2 2-6 6-2',
  leaf: 'M20 3C7 1 1 9 7 16s15 0 13-13M4 21 15 10',
  exit: 'M10 3H4v18h6m4-14 5 5-5 5M8 12h12',
  coin: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18m3 6h-5v6h5',
} as const;
export function Icon({ name }: { name: keyof typeof paths }): JSX.Element {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
