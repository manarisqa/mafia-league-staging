import { Text } from "@/components/locale-provider";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { eveningAuthLink, eveningReturn } from "@/lib/evening-return";
import { RegisterForm } from "@/app/register/register-form";

export const metadata: Metadata = { title: "Регистрация", robots: { index: false } };

export default function RegisterPage({ searchParams }: PageProps<"/register">) {
  return (
    <section className="mx-auto max-w-md px-4 py-12 sm:px-6 sm:py-16">
      <h1 className="font-display text-4xl font-bold"><Text id="register" /></h1>
      <p className="mt-3 text-muted"><Text id="registerIntro" /></p>
      <Suspense fallback={<div className="mt-8 min-h-44 rounded-card border border-border bg-surface" aria-busy="true" />}>
        <Registration searchParams={searchParams} />
      </Suspense>
    </section>
  );
}

async function Registration({ searchParams }: Pick<PageProps<"/register">, "searchParams">) {
  const next = eveningReturn((await searchParams).next);
  return (
    <>
      <div className="mt-8 rounded-card border border-border bg-surface p-6">
        <RegisterForm next={next} />
      </div>
      <p className="mt-5 text-sm text-muted">
        <Text id="haveAccount" />{" "}
        <Link href={eveningAuthLink("/login", next)} className="text-accent-text hover:underline">
          <Text id="signIn" />
        </Link>
      </p>
    </>
  );
}
