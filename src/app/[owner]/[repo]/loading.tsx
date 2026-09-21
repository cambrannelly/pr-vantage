/** Instant shell while the PR list loads, so a sidebar click responds immediately. */
export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl px-10 py-10">
      <div className="shimmer h-3 w-28" />
      <div className="shimmer mt-3 h-9 w-56" />
      <div className="shimmer mt-4 h-4 w-40" />
      <ul className="mt-8 divide-y divide-line">
        {Array.from({ length: 6 }, (_, i) => (
          <li key={i} className="grid grid-cols-[1fr_auto] gap-6 py-5" style={{ opacity: 1 - i * 0.13 }}>
            <div>
              <div className="shimmer h-4 w-24" />
              <div className="shimmer mt-3 h-6 w-3/4" />
              <div className="shimmer mt-3 h-3.5 w-1/2" />
            </div>
            <div className="w-24">
              <div className="shimmer ml-auto h-4 w-20" />
              <div className="shimmer ml-auto mt-1.5 h-4 w-12" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
