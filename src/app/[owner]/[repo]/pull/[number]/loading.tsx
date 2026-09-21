/** Instant shell while the PR header loads from GitHub. */
export default function Loading() {
  return (
    <div className="mx-auto max-w-[1600px] px-10 py-8">
      <div className="shimmer h-3.5 w-52" />
      <div className="shimmer mt-4 h-9 w-2/3" />
      <div className="shimmer mt-4 h-4 w-96" />
      <div className="hairline my-8" />
      <div className="grid grid-cols-[minmax(0,1fr)_360px] gap-8">
        <div className="space-y-9">
          <div><div className="shimmer h-3 w-20" /><div className="shimmer mt-4 h-7 w-4/5" /></div>
          <div><div className="shimmer h-3 w-28" /><div className="shimmer mt-3 h-56" /></div>
        </div>
        <div className="shimmer h-72" />
      </div>
    </div>
  );
}
