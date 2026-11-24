"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "@/components/locale-provider";
import { lessons } from "./lessons";

/** Четыре шага: нажатие открывает ответ под карточками, другой шаг заменяет его. */
export function NewbiePath() {
  const { locale } = useTranslation();
  const STEPS = lessons[locale];
  const [open, setOpen] = useState<number | null>(null);
  const step = open === null ? null : STEPS[open];
  const answerRef = useRef<HTMLDivElement>(null);

  // На телефоне ответ оказывается ниже всех карточек — плавно докручиваем до него.
  useEffect(() => {
    if (open === null) return;
    const el = answerRef.current;
    if (!el || el.getBoundingClientRect().top < window.innerHeight - 120) return;
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "start", behavior: smooth ? "smooth" : "auto" });
  }, [open]);

  return (
    <>
      <ol className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((s, i) => {
          const active = open === i;
          return (
            <li key={s.title}>
              <button
                type="button"
                aria-expanded={active}
                aria-controls="newbie-answer"
                onClick={() => setOpen(active ? null : i)}
                className={`flex h-full w-full flex-col rounded-card border p-5 text-left transition-colors duration-300 ${
                  active ? "border-accent bg-accent/10" : "border-border bg-surface hover:border-accent-text"
                }`}
              >
                <span className="flex w-full items-center justify-between">
                  <span
                    className={`flex size-8 items-center justify-center rounded-full border text-sm transition-colors duration-300 ${
                      active ? "border-accent bg-accent text-text" : "border-accent-text text-accent-text"
                    }`}
                  >
                    {i + 1}
                  </span>
                  <svg
                    aria-hidden
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    className={`text-muted transition-transform duration-300 ${active ? "rotate-180" : ""}`}
                  >
                    <path d="M3 6l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                </span>
                <span className="mt-3 font-display text-lg font-bold">{s.title}</span>
                <span className="mt-2 text-sm text-muted">{s.text}</span>
              </button>
            </li>
          );
        })}
      </ol>

      <div id="newbie-answer" ref={answerRef} aria-live="polite" className="scroll-mt-20">
        {step && (
          // key заставляет анимацию проигрываться заново при смене шага.
          <div
            key={open}
            className="mt-4 motion-safe:animate-reveal rounded-card border border-accent/50 bg-surface p-5 sm:p-6"
          >
            <h3 className="font-display text-xl font-bold">
              {open! + 1}. {step.title}
            </h3>
            <div className="mt-3 max-w-3xl space-y-3 text-muted [&_li]:mt-1.5 [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5">
              {step.paragraphs.map((text) => <p key={text}>{text}</p>)}
              <ul>{step.points.map((text) => <li key={text}>{text}</li>)}</ul>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
