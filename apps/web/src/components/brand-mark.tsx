import Link from "next/link";

export function BrandMark() {
  return (
    <Link href="/" className="inline-flex items-center gap-3 text-white transition hover:text-cyan-100">
      <span className="flex size-10 items-center justify-center rounded-xl border border-cyan-300/30 bg-cyan-300/10 shadow-[0_0_22px_rgba(87,205,230,0.12)]">
        <svg
          aria-hidden="true"
          className="size-6 text-cyan-300"
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
      <span className="text-xl font-semibold tracking-tight">
        Fault<span className="text-cyan-300">Trace</span>
      </span>
    </Link>
  );
}
