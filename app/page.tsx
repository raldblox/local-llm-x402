import Link from 'next/link';
import Image from 'next/image';
import { GithubIcon, Globe } from 'lucide-react';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-6 text-foreground">
      <div className="max-w-xl space-y-3 text-center">
        <div className="flex items-center mb-6 py-1 gap-2 text-muted-foreground w-fit mx-auto p-2 border-zinc-700 border rounded-full">
          <p className="text-xs uppercase tracking-[0.3em]">local-llm-x402</p>
        </div>

        <h1 className="text-3xl font-semibold">
          Expose your local AI to the internet. Charge by usage.
        </h1>
        <p className="text-sm text-muted-foreground">
          Run a model locally with LM Studio, claim a host seat, and serve paid AI responses in a
          shared room. Guests join instantly and are charged per request.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/demo/host"
          className="rounded-md border border-border bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Try the demo
        </Link>
        <a
          href="https://github.com/raldblox/local-llm-x402"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/50"
        >
          <GithubIcon size={16} />
          GitHub
        </a>
      </div>

      <div className="flex flex-wrap mt-6 items-center justify-center gap-3 text-xs text-muted-foreground">
        <div className="flex items-center gap-2 rounded-full border border-border/60 px-3 py-2">
          <Image src="/aptos.svg" alt="Aptos" className="invert" width={18} height={18} />
          Aptos
        </div>
        <div className="flex items-center gap-2 rounded-full border border-border/60 px-3 py-2">
          <Image src="/lmstudio.svg" alt="LM Studio" className="invert" width={18} height={18} />
          LM Studio
        </div>
        <div className="flex items-center gap-2 rounded-full border border-border/60 px-3 py-2">
          <Image
            src="/usd-coin.svg"
            alt="x402"
            className="invert saturate-0 brightness-50 contrast-150"
            width={18}
            height={18}
          />
          USDC
        </div>
        <div className="flex items-center gap-2 rounded-full border border-border/60 px-3 py-2">
          <Globe size={18} className="text-white" />
          x402
        </div>
      </div>
    </main>
  );
}
