import Image from "next/image";
import { Activity, Clock3, Leaf, Search, ShieldQuestion, Users } from "lucide-react";

const challenges = [
  {
    icon: Search,
    title: "Difficulty identifying crop diseases",
    body: "Different diseases can look alike. Leaf spots, discoloration, lesions, or other visible changes may not make the cause clear.",
  },
  {
    icon: Clock3,
    title: "Delayed identification",
    body: "When symptoms are difficult to interpret, a farmer may lose valuable time before deciding what to do next.",
  },
  {
    icon: Users,
    title: "Limited access to timely expertise",
    body: "Agricultural specialists and reliable diagnostic support may not be immediately available whenever a field problem appears.",
  },
  {
    icon: ShieldQuestion,
    title: "Uncertainty in decision-making",
    body: "An incorrect identification can lead to unsuitable interventions, avoidable costs, and potentially more crop damage.",
  },
  {
    icon: Leaf,
    title: "Need for accessible technology",
    body: "Image-based analysis could help farmers and agricultural stakeholders get useful preliminary information from crop images.",
  },
];

const stages = [
  { title: "Farmer's challenge", icon: Users },
  { title: "Crop image", icon: Leaf },
  { title: "Dataset analysis", icon: Search },
  { title: "Image quality", icon: ShieldQuestion },
  { title: "Feature extraction", icon: Activity },
  { title: "Data-driven insights", icon: Activity },
];

export function FieldSurveySection() {
  return (
    <section id="field-survey" aria-labelledby="field-survey-title" className="space-y-5">
      <header className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-white p-5 sm:p-7">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-800">GROUND REALITY — Understanding the Problem Through Farmer Interaction</p>
        <h2 id="field-survey-title" className="mt-2 max-w-3xl text-xl font-semibold tracking-tight text-zinc-950 sm:text-2xl">
          Beyond the Dataset: Understanding the Problem Through Farmer Interaction
        </h2>
        <p className="mt-4 max-w-4xl text-sm leading-7 text-zinc-700">
          Crop diseases are not merely a dataset classification problem. They are a real-world agricultural challenge that farmers encounter in their fields.
        </p>
        <p className="mt-3 max-w-4xl text-sm leading-7 text-zinc-700">
          Identifying a disease correctly and at an early stage can be difficult. Farmers may notice changes in leaves, spots, discoloration, or other visible symptoms but may not always have immediate access to reliable diagnostic expertise.
        </p>
        <p className="mt-3 max-w-4xl text-sm leading-7 text-zinc-700">
          Uncertainty in identifying a disease can delay appropriate action. This can expose crops to further damage and potentially affect productivity, farming income, and livelihoods.
        </p>
        <p className="mt-3 max-w-4xl text-sm leading-7 text-zinc-700">
          Understanding this ground-level challenge is important when developing technology intended to support agricultural decision-making.
        </p>
      </header>

      <div className="space-y-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-800">Field interaction</p>
          <h3 className="mt-1 text-lg font-semibold text-zinc-900">Listening to Farmers — Ground-Level Interaction</h3>
        </div>
        <div className="grid items-start gap-4 md:grid-cols-2">
          <figure className="overflow-hidden rounded-2xl border border-croplens-border bg-white p-2 shadow-sm">
            <Image
              src="/field-survey/farmer-interaction-1.png"
              alt="Field-level conversation between a project team member and a farmer outdoors"
              width={715}
              height={1600}
              sizes="(max-width: 768px) 100vw, 50vw"
              className="mx-auto h-auto max-h-[38rem] w-full rounded-xl object-contain"
              priority
            />
            <figcaption className="px-2 pb-2 pt-3 text-xs leading-5 text-zinc-600">
              Field-level interaction — engaging with farmers to understand agricultural challenges and the difficulties involved in identifying crop diseases.
            </figcaption>
          </figure>
          <figure className="overflow-hidden rounded-2xl border border-croplens-border bg-white p-2 shadow-sm">
            <Image
              src="/field-survey/farmer-interaction-2.png"
              alt="Project team member speaking with a farmer at a rural shopfront"
              width={899}
              height={1599}
              sizes="(max-width: 768px) 100vw, 50vw"
              className="mx-auto h-auto max-h-[38rem] w-full rounded-xl object-contain"
            />
            <figcaption className="px-2 pb-2 pt-3 text-xs leading-5 text-zinc-600">
              Field-level interaction — engaging with farmers to understand agricultural challenges and the difficulties involved in identifying crop diseases.
            </figcaption>
          </figure>
        </div>
      </div>

      <div className="rounded-2xl border border-croplens-border bg-white p-5 shadow-sm sm:p-6">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-800">Problem understanding</p>
        <h3 className="mt-1 text-lg font-semibold text-zinc-900">The Problem We Are Trying to Address</h3>
        <p className="mt-1 text-xs leading-5 text-zinc-500">These are project problem areas to investigate, not findings measured from the photographs.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {challenges.map(({ icon: Icon, title, body }, index) => (
            <article key={title} className="rounded-xl border border-zinc-100 bg-zinc-50/70 p-4">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-800"><Icon size={16} aria-hidden="true" /></span>
                <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">0{index + 1}</span>
              </div>
              <h4 className="mt-3 text-sm font-semibold text-zinc-900">{title}</h4>
              <p className="mt-1.5 text-xs leading-5 text-zinc-600">{body}</p>
            </article>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-5 shadow-sm sm:p-6">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-800">From field context to evidence</p>
        <h3 className="mt-1 text-lg font-semibold text-zinc-900">Why CropLens Matters</h3>
        <p className="mt-3 max-w-4xl text-sm leading-6 text-zinc-700">CropLens approaches this challenge through structured agricultural image intelligence.</p>
        <p className="mt-2 max-w-4xl text-sm leading-6 text-zinc-700">By analysing rice and maize disease images, the project aims to understand the dataset&apos;s composition, image quality, visual characteristics, and underlying patterns.</p>
        <p className="mt-2 max-w-4xl text-sm leading-6 text-zinc-700">The Phase 1 work establishes the data foundation required for more reliable downstream crop disease analysis.</p>
        <ol aria-label="CropLens analytical flow" className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {stages.map(({ title, icon: Icon }, index) => (
            <li key={title} className="flex min-w-0 items-center gap-2 rounded-xl border border-white bg-white/90 p-3 text-xs font-medium text-zinc-700">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-800"><Icon size={16} aria-hidden="true" /></span>
              <span className="min-w-0">{title}</span>
              {index < stages.length - 1 && <span className="ml-auto text-emerald-700" aria-hidden="true">→</span>}
            </li>
          ))}
        </ol>
        <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-950">
          Phase 1 focuses on dataset understanding, analysis, and readiness. It does not provide a fully validated, field-ready disease diagnosis or treatment recommendation.
        </p>
      </div>
    </section>
  );
}
