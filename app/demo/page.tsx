import Link from 'next/link'

export default function DemoPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-foreground">
      <h1 className="text-2xl font-semibold">Choose a demo role</h1>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/demo/host"
          className="rounded-md border border-border bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Host
        </Link>
        <Link
          href="/demo/guest"
          className="rounded-md border border-border bg-muted px-4 py-2 text-sm font-medium text-foreground"
        >
          Guest
        </Link>
      </div>
    </main>
  )
}
