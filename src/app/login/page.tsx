import { Text } from "@/components/locale-provider";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { eveningAuthLink, eveningReturn } from "@/lib/evening-return";
import { LoginForm } from "@/app/login/login-form";

export const metadata: Metadata = { title: "Вход", robots: { index: false } };

export default function LoginPage(props: PageProps<"/login">) {
  return (
    <section className="mx-auto max-w-md px-4 py-12 sm:px-6 sm:py-16">
      <h1 className="font-display text-4xl font-bold"><Text id="login" /></h1>
      <p className="mt-3 text-muted"><Text id="loginIntro" /></p>
      <Suspense fallback={<div className="mt-8 min-h-44 rounded-card border border-border bg-surface" aria-busy="true" />}>
        <LoginFormWithParams searchParams={props.searchParams} />
      </Suspense>
      {/* Expose the streamed form when the browser cannot reveal the Suspense result. */}
      <noscript><style>{"@layer base { div[hidden]:has(form #email) { display: contents !important; } }"}</style></noscript>
    </section>
  );
}

async function LoginFormWithParams({
  searchParams,
}: {
  searchParams: PageProps<"/login">["searchParams"];
}) {
  const params = await searchParams;
  return <LoginSection forbidden={params.error === "forbidden"} next={eveningReturn(params.next)} />;
}

function LoginSection({ forbidden, next }: { forbidden: boolean; next?: string }) {
  return (
    <>
      <div className="mt-8 rounded-card border border-border bg-surface p-6">
        <LoginForm forbidden={forbidden} next={next} />
      </div>
      <p className="mt-5 text-sm text-muted">
        <Text id="noAccount" />{" "}
        <Link href={eveningAuthLink("/register", next)} className="text-accent-text hover:underline">
          <Text id="signUp" />
        </Link>
      </p>
    </>
  );
}
