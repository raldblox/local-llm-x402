import Link from 'next/link'

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-6 text-foreground">
      <div className="max-w-xl space-y-3 text-center">
        <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">local-llm-x402</p>
        <h1 className="text-3xl font-semibold">Host your local model. Charge per token.</h1>
        <p className="text-sm text-muted-foreground">
          Connect LM Studio, claim a host seat, and share a paid chat room. Guests join instantly.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/demo/host"
          className="rounded-md border border-border bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Open demo (host)
        </Link>
        <Link
          href="/demo/guest"
          className="rounded-md border border-border bg-muted px-4 py-2 text-sm font-medium text-foreground"
        >
          Open demo (guest)
        </Link>
      </div>
    </main>
  )
}
