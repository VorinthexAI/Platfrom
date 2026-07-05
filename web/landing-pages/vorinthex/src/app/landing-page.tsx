"use client";

import Image from "next/image";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type CSSProperties,
  type PointerEvent,
  type SVGProps,
} from "react";

import { Button, InboxIcon, Spinner } from "@vorinthex/shared/ui";

import { WaitlistForm } from "./waitlist-form";

type BadgeSignal = {
  Icon: ComponentType<BadgeIconProps>;
  label: string;
};

const waitlistSignals: BadgeSignal[] = [
  { Icon: IdeaBadgeIcon, label: "Idea" },
  { Icon: ProductBadgeIcon, label: "Product" },
  { Icon: MarketingBadgeIcon, label: "Marketing" },
  { Icon: GrowthBadgeIcon, label: "Growth" },
];

const quizQuestions = [
  {
    insight:
      "You do not need a finished idea. Vorinthex AI is built to help find, shape, validate, build, market, and grow mobile apps from absolute zero.",
    options: [
      "Find the idea for me",
      "Turn a rough idea into an app",
      "Build and grow multiple apps",
    ],
    prompt: "What do you want Vorinthex AI to help you create?",
  },
  {
    insight:
      "The platform is designed so you do not need to code, design, understand app-store complexity, or know how to market before you begin.",
    options: ["Not technical", "I know the basics", "I can build but want speed"],
    prompt: "How technical are you?",
  },
  {
    insight:
      "The goal is not just launching something. It is creating mobile app assets that can be tested, improved, marketed, and scaled into real monthly revenue.",
    options: [
      "Make the first app real",
      "Find something people will pay for",
      "Build a portfolio of apps",
    ],
    prompt: "What matters most to you?",
  },
  {
    insight:
      "Vorinthex AI works around autopilot, but serious users still steer the strategy. You stay in control without doing every technical, product, or growth step yourself.",
    options: [
      "Give direction only",
      "Review key decisions",
      "Stay close to the process",
    ],
    prompt: "How involved do you want to be?",
  },
  {
    insight:
      "This is expensive because it is meant to replace the painful gap between idea, product, code, design, marketing, analytics, and growth.",
    options: ["A real app launched", "Revenue potential", "A repeatable app system"],
    prompt: "What would make this worth paying for?",
  },
];

const founderIntroInsight =
  "At {age}, I am already using Vorinthex AI behind the scenes to build and scale apps. The first proof: idea to live on the App Store and Play Store in 20 days.";

const deploymentNudge = "ci-redeploy-2026-07-01-2";
const titleText = "Your hidden AI team for mobile apps.";
const mosaicColumns = 8;
const mosaicRows = 12;
const marketForecast = [
  { value: 391, year: "2026" },
  { value: 459, year: "2027" },
  { value: 537, year: "2028" },
  { value: 630, year: "2029" },
  { value: 738, year: "2030" },
];
const anonymousDistinctIdCookie = "vx_waitlist_distinct_id";
const anonymousDistinctIdMaxAgeSeconds = 15 * 60;
const waitlistCapacity = 25;

export function LandingPage() {
  void deploymentNudge;

  const [joined, setJoined] = useState(false);
  const [showInvitedSignIn, setShowInvitedSignIn] = useState(false);
  const [ticketCheckoutError, setTicketCheckoutError] = useState<string | null>(
    null,
  );
  const [ticketCheckoutPending, setTicketCheckoutPending] = useState(false);
  const [ticketReserved, setTicketReserved] = useState(false);
  const [waitlistEmailHash, setWaitlistEmailHash] = useState<string | null>(
    null,
  );
  const [panelReplayToken, setPanelReplayToken] = useState(0);
  const [quizStep, setQuizStep] = useState(0);
  const [quizAnswers, setQuizAnswers] = useState<string[]>([]);
  const viewedWaitlistEventsRef = useRef<Set<string>>(new Set());
  const typedTitle = useTypedText(titleText);
  const isWaitlistMember = Boolean(waitlistEmailHash);

  useEffect(() => {
    const distinctId = getOrCreateAnonymousDistinctId();

    void fetch("/api/platform/events", {
      body: JSON.stringify({
        distinctId,
        slug: "waitlist.visited",
        metadata: {
          path: window.location.pathname,
          source: "client",
        },
      }),
      headers: {
        "Content-Type": "application/json",
      },
      keepalive: true,
      method: "POST",
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!joined || showInvitedSignIn || !waitlistEmailHash) {
      return;
    }

    const viewEvent =
      quizStep === 0
        ? {
            payload: { step: 0 },
            slug: "waitlist:founder_note_viewed",
          }
        : quizStep === quizQuestions.length + 1
          ? {
              payload: { step: quizQuestions.length + 1 },
              slug: "waitlist:ticket_viewed",
            }
          : null;

    if (!viewEvent) {
      return;
    }

    const eventKey = `${waitlistEmailHash}:${viewEvent.slug}`;

    if (viewedWaitlistEventsRef.current.has(eventKey)) {
      return;
    }

    viewedWaitlistEventsRef.current.add(eventKey);
    sendWaitlistEvent({
      emailHash: waitlistEmailHash,
      payload: viewEvent.payload,
      slug: viewEvent.slug,
    });
  }, [joined, quizStep, showInvitedSignIn, waitlistEmailHash]);

  return (
    <main className="min-h-screen overflow-x-hidden bg-background text-foreground lg:h-dvh lg:overflow-hidden">
      <section
        className={`vui-mobile-deck mx-auto grid w-full max-w-7xl grid-cols-1 lg:h-dvh lg:min-h-0 lg:grid-cols-[minmax(0,0.9fr)_minmax(440px,0.78fr)] ${
          joined ? "vui-mobile-deck-open" : ""
        }`}
      >
        <div className="vui-mobile-panel vui-mobile-panel-hero relative flex min-h-dvh flex-col px-5 py-6 sm:px-10 sm:py-8 lg:grid lg:h-dvh lg:min-h-0 lg:grid-cols-[repeat(100,minmax(0,1fr))] lg:grid-rows-[repeat(100,minmax(0,1fr))] lg:px-14 lg:py-12 lg:pb-12">
          <div
            className="vui-scanline col-span-full row-start-1 row-end-[-1]"
            aria-hidden="true"
          />

          <header className="relative z-10 col-span-full row-start-1 row-end-[12] flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Image
                alt="Vorinthex AI"
                className="h-8 w-8"
                height={32}
                priority
                src="/logos/logo-transparent.png"
                width={32}
              />
              <span className="text-lg font-medium">Vorinthex AI</span>
            </div>
            <span className="hidden text-sm text-muted sm:block">
              Mobile apps, built and grown on autopilot.
            </span>
          </header>

          <div className="relative z-10 mt-12 max-w-3xl sm:mt-14 lg:col-span-full lg:row-start-[15] lg:row-end-[90] lg:mt-0">
            <p className="vui-label mb-4 sm:mb-7">
              Mobile apps, built and grown on autopilot.
            </p>
            <h1
              aria-label={titleText}
              className="grid max-w-4xl text-[2.05rem] font-light leading-[0.92] text-balance sm:text-6xl lg:text-8xl"
            >
              <span className="col-start-1 row-start-1 invisible">
                {titleText}
              </span>
              <span aria-hidden="true" className="col-start-1 row-start-1">
                {typedTitle}
                <span className="vui-type-caret" />
              </span>
            </h1>
            <p className="mt-4 max-w-2xl text-[15px] italic leading-7 text-muted sm:mt-8 sm:text-2xl sm:leading-9">
              Vorinthex AI builds, markets, and grows mobile apps on autopilot
              from one quiet agent system.
            </p>
            <p className="mt-3 text-sm leading-6 text-muted sm:mt-5 sm:text-lg sm:leading-8">
              Private early access for founders and makers.
            </p>

            <WaitlistForm
              isWaitlistMember={isWaitlistMember}
              onInvitedSignIn={() => {
                setPanelReplayToken((current) => current + 1);
                setShowInvitedSignIn(true);
                setJoined(true);
              }}
              onJoined={({ emailHash }) => {
                setPanelReplayToken((current) => current + 1);
                setWaitlistEmailHash(emailHash);
                setShowInvitedSignIn(false);
                setJoined(true);
              }}
            />
          </div>

          <div className="relative z-10 mt-auto flex flex-wrap items-end content-end gap-2 pb-1 pt-8 sm:gap-3 sm:pb-2 lg:col-span-full lg:row-start-[92] lg:row-end-[-1] lg:mt-0 lg:pt-0">
            {waitlistSignals.map(({ Icon, label }) => (
              <span className="vui-badge" key={label}>
                <span className="vui-pulse-dot h-1.5 w-1.5 rounded-full bg-accent" />
                {label}
                <Icon className="ml-1" />
              </span>
            ))}
          </div>

        </div>

        <aside className="vui-mobile-panel vui-mobile-panel-sales vui-stage-shell border-t border-border bg-surface lg:border-l lg:border-t-0">
          <div
            className={`vui-right-stage ${
              joined ? "vui-right-stage-open" : ""
            }`}
          >
            <div className="vui-stage-panel vui-stage-panel-primary relative flex items-center justify-center overflow-hidden p-4 sm:p-10">
              <MosaicField />
              <div className="vui-early-access-frame">
                <EarlyAccessPanel />
              </div>
            </div>

            <JoinedPanel
              key={`joined-panel-${showInvitedSignIn ? "invite" : "quiz"}-${panelReplayToken}`}
              replayToken={panelReplayToken}
              onAnswer={(answer) => {
                const questionIndex = quizStep - 1;
                const question = quizQuestions[questionIndex];

                sendWaitlistQuestionEvent({
                  answer,
                  emailHash: waitlistEmailHash,
                  question: question.prompt,
                  step: questionIndex + 1,
                });

                setQuizAnswers((current) => {
                  const next = [...current];
                  next[questionIndex] = answer;
                  return next;
                });
                setQuizStep((step) =>
                  Math.min(quizQuestions.length + 1, step + 1),
                );
              }}
              onBack={() => setQuizStep((step) => Math.max(0, step - 1))}
              onIntroNext={() => setQuizStep(1)}
              onTicketReserve={async () => {
                setTicketCheckoutError(null);
                setTicketCheckoutPending(true);

                try {
                  if (!waitlistEmailHash) {
                    throw new Error("Join the waitlist before buying a ticket.");
                  }

                  const response = await fetch(
                    "/api/payments/private-beta-ticket/checkout",
                    {
                      method: "POST",
                      headers: {
                        "Content-Type": "application/json",
                        "Idempotency-Key": createIdempotencyKey(
                          "private-beta-ticket",
                        ),
                      },
                      body: JSON.stringify({
                        email_hash: waitlistEmailHash,
                      }),
                    },
                  );
                  const data = (await response.json().catch(() => null)) as
                    | {
                        checkoutUrl?: string;
                        message?: string;
                      }
                    | null;

                  if (!response.ok || !data?.checkoutUrl) {
                    throw new Error(
                      data?.message ?? "Couldn't start checkout. Try again.",
                    );
                  }

                  setTicketReserved(true);
                  window.location.assign(data.checkoutUrl);
                } catch (error) {
                  setTicketCheckoutError(
                    error instanceof Error
                      ? error.message
                      : "Couldn't start checkout. Try again.",
                  );
                  setTicketCheckoutPending(false);
                }
              }}
              ticketCheckoutError={ticketCheckoutError}
              ticketCheckoutPending={ticketCheckoutPending}
              quizAnswers={quizAnswers}
              quizStep={quizStep}
              showInvitedSignIn={showInvitedSignIn}
              ticketReserved={ticketReserved}
            />
          </div>
        </aside>
      </section>
    </main>
  );
}

function sendWaitlistQuestionEvent({
  answer,
  emailHash,
  question,
  step,
}: {
  answer: string;
  emailHash: string | null;
  question: string;
  step: number;
}) {
  if (!emailHash) {
    return;
  }

  sendWaitlistEvent({
    emailHash,
    payload: {
      step,
      question,
      answer,
    },
    slug: "waitlist:question",
  });
}

function sendWaitlistEvent({
  emailHash,
  payload,
  slug,
}: {
  emailHash: string;
  payload: Record<string, unknown>;
  slug: string;
}) {
  void fetch("/api/users/events", {
    body: JSON.stringify({
      email_hash: emailHash,
      events: [
        {
          distinctId: emailHash,
          slug,
          payload,
        },
      ],
    }),
    headers: {
      "Content-Type": "application/json",
    },
    keepalive: true,
    method: "POST",
  }).catch(() => undefined);
}

function createIdempotencyKey(scope: string) {
  if (typeof crypto.randomUUID === "function") {
    return `${scope}:${crypto.randomUUID()}`;
  }

  return `${scope}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
}

function getOrCreateAnonymousDistinctId() {
  const existing = getClientCookie(anonymousDistinctIdCookie);

  if (existing) {
    return existing;
  }

  const distinctId = createRandomHash();
  setClientCookie(
    anonymousDistinctIdCookie,
    distinctId,
    anonymousDistinctIdMaxAgeSeconds,
  );

  return distinctId;
}

function getClientCookie(name: string) {
  const encodedName = `${encodeURIComponent(name)}=`;
  const cookie = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(encodedName));

  return cookie ? decodeURIComponent(cookie.slice(encodedName.length)) : null;
}

function setClientCookie(name: string, value: string, maxAgeSeconds: number) {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";

  document.cookie = [
    `${encodeURIComponent(name)}=${encodeURIComponent(value)}`,
    `Max-Age=${maxAgeSeconds}`,
    "Path=/",
    "SameSite=Lax",
    secure,
  ].join("; ");
}

function createRandomHash() {
  const bytes = new Uint8Array(16);

  if (typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function EarlyAccessPanel() {
  const maxForecastValue = Math.max(
    ...marketForecast.map((forecast) => forecast.value),
  );

  return (
    <div className="vui-early-access-panel relative z-10 grid grid-cols-[repeat(100,minmax(0,1fr))] grid-rows-[repeat(100,minmax(0,1fr))]">
      <div className="relative col-span-full row-start-1 row-end-[7]">
        <div className="pointer-events-none absolute right-4 top-0 max-w-[230px] rotate-3 border border-border bg-background px-4 py-2 text-xs text-muted shadow-sm">
          Do not wait for public pricing.
        </div>
      </div>

      <div className="vui-float-card relative col-span-full row-start-[8] row-end-[32] border border-border bg-background/90 p-5 shadow-sm backdrop-blur sm:p-6 lg:p-5">
        <p className="vui-label mb-3">Private beta pricing</p>
        <h2 className="max-w-md text-[2rem] font-light leading-tight text-balance sm:text-4xl lg:text-3xl">
          Join early. Lock in the quiet advantage.
        </h2>
        <p className="mt-3 max-w-md text-base leading-6 text-muted sm:mt-4 lg:text-sm lg:leading-5">
          Accepted waitlist members can enter at{" "}
          <span className="text-foreground">$799/mo</span>. Join after launch
          and founder access starts at{" "}
          <span className="text-foreground">$1,999/mo</span>.
        </p>
      </div>

      <div className="vui-float-card vui-float-card-slow col-span-full row-start-[38] row-end-[62] border border-border bg-background/90 p-5 shadow-sm backdrop-blur sm:p-6 lg:p-5">
        <div className="flex items-start justify-between gap-4">
          <span>
            <span className="vui-label block">Launch gate</span>
            <span className="mt-2 block text-lg font-light leading-6 sm:mt-3 lg:mt-2 lg:text-base lg:leading-5">
              Launching early, mid, or late 2027 depends on the waitlist.
            </span>
            <span className="mt-2 block text-sm leading-6 text-muted sm:mt-3 lg:mt-2 lg:text-xs lg:leading-5">
              Only {waitlistCapacity} people will be accepted into private beta
              pricing. Selection will be random from the waitlist, so joining
              early gives you a shot before the door closes.
            </span>
          </span>
          <span className="shrink-0 text-right">
            <span className="block text-2xl font-light sm:text-3xl">{waitlistCapacity}</span>
            <span className="mt-1 block text-[10px] uppercase tracking-[0.18em] text-muted">
              private seats
            </span>
          </span>
        </div>
        <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-secondary lg:mt-4">
          <div className="h-full w-full rounded-full bg-accent" />
        </div>
      </div>
      <div className="vui-float-card vui-float-card-delayed col-start-1 col-end-[48] row-start-[68] row-end-[96] grid content-start grid-cols-1 grid-rows-[8.25rem_auto] border border-border bg-background/90 p-4 shadow-sm backdrop-blur sm:p-5 lg:grid-rows-[7rem_auto] lg:p-4">
        <div className="row-start-1 flex items-start justify-between gap-4">
          <span>
            <span className="vui-label block">
              6-month target
            </span>
            <span className="mt-1 block text-xs leading-5 text-muted">
              With this model, we are confident serious apps can target
              $10k USD MRR post-launch.
            </span>
          </span>
          <GrowthBadgeIcon className="h-4 w-4 shrink-0 sm:h-5 sm:w-5" />
        </div>
        <div className="row-start-2">
          <div className="text-3xl font-light sm:text-4xl">$10k</div>
          <div className="mt-1 text-[10px] uppercase tracking-[0.16em] text-muted sm:text-xs sm:tracking-[0.18em]">
            MRR model
          </div>
        </div>
      </div>
      <div className="relative col-start-1 col-end-[48] row-start-[97] row-end-[-1]">
        <div className="pointer-events-none absolute bottom-0 left-0 max-w-[200px] -rotate-2 border border-border bg-background px-3 py-2 text-xs text-muted shadow-sm">
          Build, launch, learn, repeat.
        </div>
      </div>

      <div className="vui-float-card vui-float-card-slow col-start-[54] col-end-[101] row-start-[68] row-end-[96] grid content-start grid-cols-1 grid-rows-[8.25rem_auto] border border-border bg-background/90 p-4 shadow-sm backdrop-blur sm:p-5 lg:grid-rows-[7rem_auto] lg:p-4">
        <div className="row-start-1 flex items-start justify-between gap-4">
          <span>
            <span className="vui-label block">
              Market signal
            </span>
            <span className="mt-1 block text-xs leading-5 text-muted">
              Mobile apps are forecast to keep compounding.
            </span>
          </span>
          <ProductBadgeIcon className="h-4 w-4 shrink-0 sm:h-5 sm:w-5" />
        </div>
        <div className="row-start-2">
          <div className="flex h-12 items-end gap-2 sm:h-16 lg:h-10">
            {marketForecast.map((forecast) => (
              <div
                className="flex flex-1 flex-col items-center gap-1"
                key={forecast.year}
              >
                <div
                  className="w-full rounded-t-sm bg-accent/80"
                  style={{
                    height: `${Math.round((forecast.value / maxForecastValue) * 40)}px`,
                  }}
                />
                <span className="text-[10px] text-muted">{forecast.year}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs leading-5 text-muted">
            Forecast model based on Mordor Intelligence: $391B in 2026 to
            $864B by 2030.
          </p>
        </div>
      </div>
    </div>
  );
}

function WaitlistQuiz({
  answers,
  onAnswer,
  onBack,
  onIntroNext,
  onTicketReserve,
  ticketCheckoutError,
  ticketCheckoutPending,
  step,
  ticketReserved,
}: {
  answers: string[];
  onAnswer: (answer: string) => void;
  onBack: () => void;
  onIntroNext: () => void;
  onTicketReserve: () => void | Promise<void>;
  ticketCheckoutError: string | null;
  ticketCheckoutPending: boolean;
  step: number;
  ticketReserved: boolean;
}) {
  const founderAge = getFounderAge();
  const totalSteps = quizQuestions.length + 2;
  const isDone = step === totalSteps - 1;
  const isIntro = step === 0;
  const questionIndex = Math.max(0, step - 1);
  const currentQuestion = quizQuestions[questionIndex];
  const selectedAnswer = answers[questionIndex];
  const progress = isDone
    ? 100
    : Math.round(((step + 1) / totalSteps) * 100);

  return (
    <div className="vui-quiz-sheet relative w-full max-w-[500px] border border-border bg-surface p-3 sm:p-8">
      <div className="mb-4 sm:mb-6">
        <div className="mb-3 flex items-center justify-between text-xs text-muted">
          <span className="flex items-center gap-2">
            <button
              aria-label="Go back"
              className={`flex h-6 w-6 items-center justify-center rounded-full border border-border transition-colors ${
                isIntro
                  ? "pointer-events-none opacity-35"
                  : "cursor-pointer hover:border-accent hover:text-foreground"
              }`}
              disabled={isIntro}
              onClick={onBack}
              type="button"
            >
              <ChevronBackIcon />
            </button>
            {`Step ${step + 1} of ${totalSteps}`}
          </span>
          <span>{progress}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full bg-accent transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {isDone ? (
        <div className="vui-quiz-step" key="ticket">
          <p className="vui-label mb-3 sm:mb-5">You are in the room</p>
          <h2 className="text-[1.95rem] font-normal leading-[1.04] text-balance sm:text-4xl">
            Buy the ticket. Guarantee the private beta price.
          </h2>
          <p className="mt-2 text-sm italic leading-6 text-muted sm:mt-4 sm:text-lg sm:leading-8">
            Waitlist members will be picked at random for private beta pricing.
            Buy a one-time $99 ticket if you want to move ahead of the queue.
          </p>
          <div className="mt-5 rounded-[24px] border border-border bg-background p-3 sm:mt-6 sm:p-4">
            <div className="flex items-start justify-between gap-4">
              <span>
                <span className="block text-xs font-medium sm:text-sm">
                  Private beta ticket
                </span>
                <span className="mt-1 block text-[11px] leading-4 text-muted sm:text-xs sm:leading-5">
                  One-time payment. Waitlist members are randomly selected for
                  only {waitlistCapacity} private beta pricing spots. This ticket guarantees
                  you are selected and accepted for the $799/mo private beta
                  price, so you do not have to enter at the $1,999/mo founder
                  access price when we launch.
                </span>
              </span>
              <span className="text-3xl font-light">$99</span>
            </div>
          </div>
          <div className="mt-7">
            <Button
              className="w-full"
              disabled={ticketCheckoutPending}
              onClick={onTicketReserve}
              type="button"
              variant="primary"
            >
              {ticketCheckoutPending ? (
                <span className="inline-flex items-center justify-center gap-2">
                  <span>Opening checkout</span>
                  <Spinner className="h-4 w-4 border-background/55 border-t-background" />
                </span>
              ) : ticketReserved ? (
                "Ticket reserved"
              ) : (
                "Buy $99 ticket"
              )}
            </Button>
            {ticketCheckoutError ? (
              <p className="mt-3 text-sm leading-5 text-[var(--vui-color-danger)]">
                {ticketCheckoutError}
              </p>
            ) : null}
          </div>
        </div>
      ) : isIntro ? (
        <div className="vui-quiz-step" key="founder-intro">
          <p className="vui-label mb-3 sm:mb-5">Founder note</p>
          <h2 className="text-[1.95rem] font-normal leading-[1.04] text-balance sm:text-4xl">
            I am already building with Vorinthex AI in private.
          </h2>
          <p className="mt-2 text-sm italic leading-6 text-muted sm:mt-4 sm:text-lg sm:leading-8">
            {founderIntroInsight.replace("{age}", String(founderAge))}
          </p>
          <p className="mt-2 text-[13px] leading-5 text-muted sm:mt-4 sm:text-base sm:leading-7">
            This is the same system I am shaping for people who want mobile apps
            built, launched, marketed, and grown without needing to become
            technical first.
          </p>
          <div className="mt-7">
            <Button
              className="w-full"
              onClick={onIntroNext}
              type="button"
              variant="primary"
            >
              Next
            </Button>
          </div>
        </div>
      ) : (
        <div className="vui-quiz-step" key={currentQuestion.prompt}>
          <p className="vui-label mb-3 sm:mb-5">Founder fit check</p>
          <h2 className="text-[1.95rem] font-normal leading-[1.04] text-balance sm:text-4xl">
            {currentQuestion.prompt}
          </h2>
          <p className="mt-2 text-[13px] italic leading-5 text-muted sm:mt-4 sm:text-base sm:leading-7">
            {currentQuestion.insight.replace("{age}", String(founderAge))}
          </p>
          <div className="mt-4 space-y-2 sm:mt-7 sm:space-y-3">
            {currentQuestion.options.map((option) => (
              <button
                className={`w-full cursor-pointer rounded-[20px] border px-4 py-2 text-left text-sm transition-colors sm:py-3 ${
                  selectedAnswer === option
                    ? "border-accent text-foreground"
                    : "border-border text-muted hover:border-accent hover:text-foreground"
                }`}
                key={option}
                onClick={() => onAnswer(option)}
                type="button"
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function JoinedPanel({
  onAnswer,
  onBack,
  onIntroNext,
  onTicketReserve,
  ticketCheckoutError,
  ticketCheckoutPending,
  quizAnswers,
  quizStep,
  showInvitedSignIn,
  replayToken,
  ticketReserved,
}: {
  onAnswer: (answer: string) => void;
  onBack: () => void;
  onIntroNext: () => void;
  onTicketReserve: () => void | Promise<void>;
  ticketCheckoutError: string | null;
  ticketCheckoutPending: boolean;
  quizAnswers: string[];
  quizStep: number;
  showInvitedSignIn: boolean;
  replayToken: number;
  ticketReserved: boolean;
}) {
  return (
    <div
      className="vui-stage-panel vui-stage-panel-secondary vui-panel-swap relative flex min-h-[100dvh] w-full items-center justify-center overflow-hidden bg-background p-4 sm:p-10"
      key={`${showInvitedSignIn ? "invited-signin" : "waitlist-quiz"}-${replayToken}`}
    >
      <MosaicField />
      <div className="flex w-full max-w-[520px] flex-col gap-3">
        {showInvitedSignIn ? (
          <InvitedSignIn />
        ) : (
          <WaitlistQuiz
            answers={quizAnswers}
            ticketReserved={ticketReserved}
            onAnswer={onAnswer}
            onBack={onBack}
            onIntroNext={onIntroNext}
            onTicketReserve={onTicketReserve}
            ticketCheckoutError={ticketCheckoutError}
            ticketCheckoutPending={ticketCheckoutPending}
            step={quizStep}
          />
        )}
      </div>
    </div>
  );
}

function InvitedSignIn() {
  const [signInLinkSent, setSignInLinkSent] = useState(false);

  return (
    <div className="vui-quiz-sheet relative w-full max-w-[460px] border border-border bg-surface p-6 sm:p-8">
      {signInLinkSent ? (
        <div className="py-6 text-center">
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-border bg-background">
            <InboxIcon size="lg" variant="accent" />
          </span>
          <p className="vui-label mt-6">Sign-in link sent</p>
          <h2 className="mt-4 text-4xl font-normal leading-tight text-balance">
            Check your email for a sign-in link.
          </h2>
          <p className="mt-4 text-lg italic leading-8 text-muted">
            Use the same inbox that received the invite. The link opens your
            private beta access when it is ready.
          </p>
        </div>
      ) : (
        <>
          <p className="vui-label mb-5">Invited access</p>
          <h2 className="text-4xl font-normal leading-tight text-balance">
            Sign in with the email that received the invite.
          </h2>
          <p className="mt-4 text-lg italic leading-8 text-muted">
            Private beta members enter through email first. The full dashboard
            stays hidden until access opens.
          </p>
          <form
            className="mt-8 space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              setSignInLinkSent(true);
            }}
          >
            <label className="sr-only" htmlFor="invited-email">
              Invite email
            </label>
            <input
              autoComplete="email"
              className="vui-control min-h-12 bg-background px-4 text-[17px]"
              id="invited-email"
              inputMode="email"
              placeholder="you@example.com"
              type="email"
            />
            <Button className="w-full" type="submit" variant="primary">
              Sign in
            </Button>
          </form>
        </>
      )}
    </div>
  );
}

function getFounderAge() {
  const today = new Date();
  const birthDate = new Date(2005, 9, 27);
  let age = today.getFullYear() - birthDate.getFullYear();
  const hasBirthdayPassed =
    today.getMonth() > birthDate.getMonth() ||
    (today.getMonth() === birthDate.getMonth() &&
      today.getDate() >= birthDate.getDate());

  if (!hasBirthdayPassed) {
    age -= 1;
  }

  return age;
}

type BadgeIconProps = Omit<SVGProps<SVGSVGElement>, "color">;

function BadgeIconFrame(props: BadgeIconProps) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      focusable="false"
      height="16"
      viewBox="0 0 16 16"
      width="16"
      {...props}
    />
  );
}

function ChevronBackIcon(props: BadgeIconProps) {
  return (
    <BadgeIconFrame {...props}>
      <path
        d="M9.8 4.2 6 8l3.8 3.8"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.4"
      />
    </BadgeIconFrame>
  );
}

function IdeaBadgeIcon(props: BadgeIconProps) {
  return (
    <BadgeIconFrame {...props}>
      <path
        d="M8 2.5v2M4.1 4.1l1.4 1.4m6.4-1.4-1.4 1.4M5.5 8.1a2.5 2.5 0 1 1 5 0c0 1.1-.8 1.7-1.3 2.3-.3.3-.4.6-.4 1H7.2c0-.4-.1-.7-.4-1-.5-.6-1.3-1.2-1.3-2.3Z"
        stroke="var(--vui-color-accent)"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.2"
      />
      <path
        d="M7.1 13h1.8"
        stroke="var(--vui-color-accent)"
        strokeLinecap="round"
        strokeWidth="1.2"
      />
    </BadgeIconFrame>
  );
}

function ProductBadgeIcon(props: BadgeIconProps) {
  return (
    <BadgeIconFrame {...props}>
      <path
        d="M3 5.2 8 2.5l5 2.7v5.6l-5 2.7-5-2.7V5.2Z"
        stroke="var(--vui-color-accent)"
        strokeLinejoin="round"
        strokeWidth="1.2"
      />
      <path
        d="M3.3 5.4 8 8l4.7-2.6M8 8v5.1"
        stroke="var(--vui-color-accent)"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.2"
      />
    </BadgeIconFrame>
  );
}

function MarketingBadgeIcon(props: BadgeIconProps) {
  return (
    <BadgeIconFrame {...props}>
      <path
        d="M3 8.6h2.4l5.8 3.1V4.3L5.4 7.4H3v1.2Z"
        stroke="var(--vui-color-accent)"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.2"
      />
      <path
        d="M5.4 8.7 6 12"
        stroke="var(--vui-color-accent)"
        strokeLinecap="round"
        strokeWidth="1.2"
      />
    </BadgeIconFrame>
  );
}

function GrowthBadgeIcon(props: BadgeIconProps) {
  return (
    <BadgeIconFrame {...props}>
      <path
        d="M3 11.5 6.4 8l2.2 2.1L13 5.2"
        stroke="var(--vui-color-accent)"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.2"
      />
      <path
        d="M10.1 5.2H13v2.9"
        stroke="var(--vui-color-accent)"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.2"
      />
    </BadgeIconFrame>
  );
}

function useTypedText(text: string) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const [typedText, setTypedText] = useState("");

  useEffect(() => {
    if (prefersReducedMotion) {
      return;
    }

    let index = 0;
    const timer = window.setInterval(() => {
      index += 1;
      setTypedText(text.slice(0, index));

      if (index >= text.length) {
        window.clearInterval(timer);
      }
    }, 54);

    return () => window.clearInterval(timer);
  }, [prefersReducedMotion, text]);

  return prefersReducedMotion ? text : typedText;
}

function usePrefersReducedMotion() {
  return useSyncExternalStore(
    (onStoreChange) => {
      const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
      mediaQuery.addEventListener("change", onStoreChange);

      return () => mediaQuery.removeEventListener("change", onStoreChange);
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

function MosaicField() {
  const [pointer, setPointer] = useState({
    active: false,
    inside: false,
    x: -100,
    y: -100,
  });
  const tiles = useMemo(
    () =>
      Array.from({ length: mosaicColumns * mosaicRows }, (_, index) => {
        const column = index % mosaicColumns;
        const row = Math.floor(index / mosaicColumns);

        return {
          column,
          id: index,
          row,
          x: ((column + 0.5) / mosaicColumns) * 100,
          y: ((row + 0.5) / mosaicRows) * 100,
        };
      }),
    [],
  );

  const updatePointer = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();

    setPointer((current) => ({
      ...current,
      inside: true,
      x: ((event.clientX - bounds.left) / bounds.width) * 100,
      y: ((event.clientY - bounds.top) / bounds.height) * 100,
    }));
  };

  return (
    <div
      className="vui-mosaic-field absolute inset-0"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        setPointer((current) => ({ ...current, active: true }));
        updatePointer(event);
      }}
      onPointerLeave={() =>
        setPointer({ active: false, inside: false, x: -100, y: -100 })
      }
      onPointerMove={updatePointer}
      onPointerUp={(event) => {
        event.currentTarget.releasePointerCapture(event.pointerId);
        setPointer((current) => ({ ...current, active: false }));
        updatePointer(event);
      }}
    >
      {tiles.map((tile) => {
        const distance = pointer.inside
          ? Math.hypot(pointer.x - tile.x, pointer.y - tile.y)
          : 999;
        const influence = Math.max(0, 1 - distance / (pointer.active ? 34 : 26));
        const raise = Math.round(influence * (pointer.active ? 22 : 12));
        const shade = 0.14 + influence * 0.28;

        return (
          <span
            className="vui-mosaic-tile"
            key={tile.id}
            style={
              {
                "--tile-opacity": shade.toFixed(2),
                "--tile-raise": `${raise}px`,
              } as CSSProperties
            }
          />
        );
      })}
    </div>
  );
}
