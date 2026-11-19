/** The three steps of early access, as the website lists them. */
const STEPS = [
  { title: "Ask for access", text: "Leave your email. You’ll get a link to a short form." },
  { title: "Tell us a little about you", text: "Five quick questions about how you’d use Navi. About two minutes." },
  { title: "Get your invite", text: "When there’s room, you’ll get an email with a link that signs you straight in." },
];

export type Step = 1 | 2 | 3;

export function Steps({ current, className = "" }: { current: Step; className?: string }) {
  return (
    <ol className={`sky-steps ${className}`}>
      {STEPS.map((s, i) => {
        const n = i + 1;
        const state = n < current ? "done" : n === current ? "now" : undefined;
        return (
          <li key={s.title} data-state={state} aria-current={state === "now" ? "step" : undefined}>
            <b>{s.title}{state === "done" && <span className="sr-only"> (done)</span>}</b>
            <span>{s.text}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** Content on the left, the website's sky panel (with where you are in the steps) on the right. */
export function SkyShell({ step, children }: { step: Step; children: React.ReactNode }) {
  return (
    <main className="sky-main">
      <div className="sky-col">
        {children}
        <Steps current={step} className="sky-steps-m" />
      </div>
      <aside className="sky-side" aria-label="How early access works">
        <picture>
          <source media="(max-width: 900px)" srcSet="/landing/a/hero2.webp" />
          <img src="/landing/a/hero2-tall.webp" alt="" />
        </picture>
        <div className="sky-glass">
          <p className="t">How early access works</p>
          <Steps current={step} />
        </div>
      </aside>
    </main>
  );
}
