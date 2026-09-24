import Link from "next/link";

export function BrandMark({ href = "/", compact = false }: { href?: string; compact?: boolean }) {
  return (
    <Link href={href} className="inline-flex cursor-pointer items-center gap-3 text-white transition-colors hover:text-teal-100 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-teal-300">
      <span className="flex size-9 items-center justify-center rounded-md border border-teal-300/25 bg-teal-300/10">
        <svg
          aria-hidden="true"
          className="size-5 text-teal-300"
          fill="none"
          viewBox="0 0 24 24"
        >
          <path
            d="M3.5 15.5h4.2l2.5-7 3.1 10 2.2-6h5"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
          />
        </svg>
      </span>
      {!compact && <span className="text-lg font-semibold tracking-tight">Fault<span className="text-teal-300">Trace</span></span>}
    </Link>
  );
}
