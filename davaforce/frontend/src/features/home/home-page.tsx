"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  BrainCircuit,
  CheckCircle2,
  FileSpreadsheet,
  GitBranch,
  LineChart,
  Moon,
  ShieldCheck,
  Sparkles,
  Sun,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { DavaForceWordmark } from "@/components/davaforce-wordmark";
import { WorkforceParticleCanvas } from "@/components/workforce-particle-canvas";
import { Button } from "@/components/ui/button";
// import { ParticleToggle } from "@/components/shell/particle-toggle";
import { UserRoleMenu } from "@/components/shell/user-role-menu";
import { LoginPanel, ProcessingPanel, SuccessPanel, UploadPanel, processingSteps } from "@/features/home/components/upload-flow-panels";
import { useThemePreference } from "@/hooks/use-theme-preference";

type Phase = "login" | "upload" | "processing" | "success";

type LoginUser = {
  userId: string;
  username: string;
  profileImage?: string;
};

type DatasetRecord = {
  datasetId: string;
  originalFileName: string;
  label: string | null;
};

type UploadProgressSnapshot = {
  status: "pending" | "processing" | "success" | "failure";
  stage?: string;
  stepIndex: number;
  progress?: number;
  message?: string;
  error?: string | null;
};

type UploadProgressWatcher = {
  ready: Promise<void>;
  done: Promise<void>;
  close: () => void;
  isClosed: () => boolean;
};

type HeroLetterGlowProps = {
  text: string;
  children?: ReactNode;
  className?: string;
};

type GlowGradientStop = {
  offset: number;
  color: string;
  opacity: number;
};

type HeroLetterGlowConfig = {
  duration: number;
  gradientSpanFactor: number;
  gradientSpanMin: number;
  gradientRiseFactor: number;
  gradientRiseMin: number;
  blurStdDeviation: number;
  contentStrokeWidth: number;
  contentStrokeColor: string;
  contentStrokeOpacity: number;
  contentShadowBlurA: number;
  contentShadowColorA: string;
  contentShadowOpacityA: number;
  contentShadowBlurB: number;
  contentShadowColorB: string;
  contentShadowOpacityB: number;
  baseStrokeWidth: number;
  baseOpacity: number;
  haloStrokeWidth: number;
  haloOpacity: number;
  traceStrokeWidth: number;
  traceOpacity: number;
  traceShadowBlurA: number;
  traceShadowColorA: string;
  traceShadowOpacityA: number;
  traceShadowBlurB: number;
  traceShadowColorB: string;
  traceShadowOpacityB: number;
  stops: GlowGradientStop[];
};

type HeroLetterGlowMetrics = {
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  fontFamily: string;
  fontSize: number;
  fontWeight: string;
  letterSpacing: number;
};

type HeroLetterGlowBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type LandingCard = {
  title: string;
  copy: string;
  icon: LucideIcon;
};

type LandingMetric = {
  label: string;
  value: string;
  copy: string;
  icon: LucideIcon;
};

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

const HERO_GLOW_CONFIG: HeroLetterGlowConfig = {
  duration: 3.2,
  gradientSpanFactor: 0.92,
  gradientSpanMin: 131,
  gradientRiseFactor: 0.26,
  gradientRiseMin: 14,
  blurStdDeviation: 0,
  contentStrokeWidth: 0,
  contentStrokeColor: "#ffd9aa",
  contentStrokeOpacity: 1,
  contentShadowBlurA: 0,
  contentShadowColorA: "#ffc888",
  contentShadowOpacityA: 0.06,
  contentShadowBlurB: 0,
  contentShadowColorB: "#ffa244",
  contentShadowOpacityB: 0.04,
  baseStrokeWidth: 1.1,
  baseOpacity: 1,
  haloStrokeWidth: 1.85,
  haloOpacity: 0.18,
  traceStrokeWidth: 1.4,
  traceOpacity: 1,
  traceShadowBlurA: 0,
  traceShadowColorA: "#ffd08e",
  traceShadowOpacityA: 0.19,
  traceShadowBlurB: 0,
  traceShadowColorB: "#ffa64a",
  traceShadowOpacityB: 0.15,
  stops: [
    { offset: 0, color: "#FF5640", opacity: 0.12 },
    { offset: 28, color: "#FF5640", opacity: 0.23 },
    { offset: 54, color: "#FFB85A", opacity: 0.16 },
    { offset: 78, color: "#FF5640", opacity: 0.08 },
    { offset: 100, color: "#FF5640", opacity: 0.08 },
  ],
};

const uploadAssurances: LandingCard[] = [
  {
    title: "Private workspace",
    copy: "Workbook data stays scoped to the signed-in planner session.",
    icon: ShieldCheck,
  },
  {
    title: "Structured import",
    copy: "Rows are normalized into people, skills, availability, and opportunities.",
    icon: FileSpreadsheet,
  },
  {
    title: "Ready to validate",
    copy: "Validate the generated table headers before opening the workforce planning assistant.",
    icon: Sparkles,
  },
];

const planningHighlights: LandingCard[] = [
  {
    title: "Supply clarity",
    copy: "See bench, partial capacity, release windows, skill matches, and EWA constraints in one evidence view.",
    icon: UsersRound,
  },
  {
    title: "Demand fit",
    copy: "Translate opportunity roles into candidate pools and balanced staffing options without spreadsheet hopping.",
    icon: GitBranch,
  },
  {
    title: "Decision support",
    copy: "Review confidence, gaps, risks, and approval-ready next actions before committing a staffing plan.",
    icon: LineChart,
  },
];

const landingMetrics: LandingMetric[] = [
  { label: "Routes", value: "5", copy: "Specialist paths for supply, risk, teams, and approvals.", icon: GitBranch },
  { label: "Windows", value: "30 / 60 / 90", copy: "Bench and availability snapshots for planning horizons.", icon: LineChart },
  { label: "Format", value: ".xlsx", copy: "Upload the workforce workbook planners already maintain.", icon: FileSpreadsheet },
];

const sampleQuestions = [
  "Who is available for React work in India?",
  "Build staffing options for OPP-009",
  "Show bench capacity in 60 days",
  "Explain capability gaps and risks",
];

const planningFlow: LandingCard[] = [
  {
    title: "Upload workbook",
    copy: "Start from the source planners already trust.",
    icon: FileSpreadsheet,
  },
  {
    title: "Normalize evidence",
    copy: "Availability, skills, roles, and opportunity demand become queryable.",
    icon: BrainCircuit,
  },
  {
    title: "Plan with confidence",
    copy: "Move from candidate supply to staffing decisions with a clear evidence trail.",
    icon: CheckCircle2,
  },
];

const hexToRgba = (hex: string, opacity: number) => {
  const normalized = hex.replace("#", "");
  const expanded = normalized.length === 3 ? normalized.split("").map((chunk) => chunk + chunk).join("") : normalized;
  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) {
    return `rgba(255,86,64,${opacity})`;
  }

  const red = Number.parseInt(expanded.slice(0, 2), 16);
  const green = Number.parseInt(expanded.slice(2, 4), 16);
  const blue = Number.parseInt(expanded.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${opacity})`;
};

function HeroLetterGlow({ text, children, className = "" }: HeroLetterGlowProps) {
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const measureTextRef = useRef<SVGTextElement>(null);
  const filterId = useId().replace(/:/g, "");
  const [metrics, setMetrics] = useState<HeroLetterGlowMetrics | null>(null);
  const [glyphBox, setGlyphBox] = useState<HeroLetterGlowBox | null>(null);
  const config = HERO_GLOW_CONFIG;

  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    const measure = measureRef.current;
    if (!wrapper || !measure) return;

    const updateMetrics = () => {
      const wrapperRect = wrapper.getBoundingClientRect();
      const styles = window.getComputedStyle(measure);
      const letterSpacing = styles.letterSpacing === "normal" ? 0 : Number.parseFloat(styles.letterSpacing);
      const range = document.createRange();
      range.selectNodeContents(measure);

      const rangeRect = range.getBoundingClientRect();
      const fallbackRect = measure.getBoundingClientRect();
      const textRect =
        rangeRect.width > 0 && rangeRect.height > 0
          ? rangeRect
          : fallbackRect;

      setMetrics({
        offsetX: textRect.left - wrapperRect.left,
        offsetY: textRect.top - wrapperRect.top,
        width: textRect.width,
        height: textRect.height,
        fontFamily: styles.fontFamily,
        fontSize: Number.parseFloat(styles.fontSize) || textRect.height,
        fontWeight: styles.fontWeight,
        letterSpacing: Number.isFinite(letterSpacing) ? letterSpacing : 0,
      });
    };

    updateMetrics();

    const observer = new ResizeObserver(() => updateMetrics());
    observer.observe(wrapper);
    observer.observe(measure);

    return () => observer.disconnect();
  }, [text]);

  useLayoutEffect(() => {
    if (!measureTextRef.current || !metrics) return;

    const frameId = window.requestAnimationFrame(() => {
      const nextBox = measureTextRef.current?.getBBox();
      if (!nextBox) return;

      setGlyphBox({
        x: nextBox.x,
        y: nextBox.y,
        width: nextBox.width,
        height: nextBox.height,
      });
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [metrics, text]);

  const classes = ["hero-letter-glow", className].filter(Boolean).join(" ");
  const gradientId = `${filterId}-gradient`;
  const gradientSpan = metrics ? Math.max(config.gradientSpanMin, metrics.width * config.gradientSpanFactor) : config.gradientSpanMin;
  const gradientRise = metrics ? Math.max(config.gradientRiseMin, metrics.height * config.gradientRiseFactor) : config.gradientRiseMin;
  const contentStyle: CSSProperties = {
    WebkitTextStroke: `${config.contentStrokeWidth}px ${hexToRgba(config.contentStrokeColor, config.contentStrokeOpacity)}`,
    textShadow: `0 0 ${config.contentShadowBlurA}px ${hexToRgba(config.contentShadowColorA, config.contentShadowOpacityA)}, 0 0 ${config.contentShadowBlurB}px ${hexToRgba(config.contentShadowColorB, config.contentShadowOpacityB)}`,
  };
  const traceStyle: CSSProperties = {
    filter: `drop-shadow(0 0 ${config.traceShadowBlurA}px ${hexToRgba(config.traceShadowColorA, config.traceShadowOpacityA)}) drop-shadow(0 0 ${config.traceShadowBlurB}px ${hexToRgba(config.traceShadowColorB, config.traceShadowOpacityB)})`,
  };

  return (
    <span ref={wrapperRef} className={classes}>
      <span ref={measureRef} aria-hidden="true" className="hero-letter-glow__measure">
        {text}
      </span>
      <span className="hero-letter-glow__content" style={contentStyle}>
        {children ?? text}
      </span>
      {metrics ? (
        <svg
          aria-hidden="true"
          className="hero-letter-glow__svg"
          width={metrics.width}
          height={metrics.height}
          style={{
            left: metrics.offsetX,
            top: metrics.offsetY,
            width: metrics.width,
            height: metrics.height,
          }}
          viewBox={`0 0 ${metrics.width} ${metrics.height}`}
          preserveAspectRatio="xMinYMin meet"
        >
          <defs>
            <linearGradient
              id={gradientId}
              gradientUnits="userSpaceOnUse"
              x1="0"
              y1="0"
              x2={gradientSpan}
              y2={gradientRise}
              spreadMethod="repeat"
            >
              {config.stops.map((stop, index) => (
                <stop key={`${gradientId}-stop-${index}`} offset={`${stop.offset}%`} stopColor={stop.color} stopOpacity={stop.opacity} />
              ))}
              <animateTransform
                attributeName="gradientTransform"
                type="translate"
                from="0 0"
                to={`${gradientSpan} 0`}
                dur={`${config.duration}s`}
                repeatCount="indefinite"
              />
            </linearGradient>
            <filter
              id={filterId}
              x="-60%"
              y="-60%"
              width="220%"
              height="220%"
              colorInterpolationFilters="sRGB"
            >
              <feGaussianBlur in="SourceGraphic" stdDeviation={config.blurStdDeviation} result="heroGlowBlur" />
              <feMerge>
                <feMergeNode in="heroGlowBlur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <text
            ref={measureTextRef}
            x="0"
            y={metrics.fontSize}
            fill="none"
            fontFamily={metrics.fontFamily}
            fontSize={metrics.fontSize}
            fontWeight={metrics.fontWeight}
            letterSpacing={metrics.letterSpacing}
            opacity="0"
          >
            {text}
          </text>

          {glyphBox ? (
            <g transform={`translate(${-glyphBox.x} ${-glyphBox.y})`}>
              <text
                className="hero-letter-glow__outline-base"
                style={{ opacity: config.baseOpacity }}
                x="0"
                y={metrics.fontSize}
                fill="none"
                stroke={`url(#${gradientId})`}
                strokeWidth={config.baseStrokeWidth}
                fontFamily={metrics.fontFamily}
                fontSize={metrics.fontSize}
                fontWeight={metrics.fontWeight}
                letterSpacing={metrics.letterSpacing}
              >
                {text}
              </text>
              <text
                className="hero-letter-glow__outline-halo"
                style={{ opacity: config.haloOpacity }}
                x="0"
                y={metrics.fontSize}
                fill="none"
                filter={`url(#${filterId})`}
                stroke={`url(#${gradientId})`}
                strokeWidth={config.haloStrokeWidth}
                fontFamily={metrics.fontFamily}
                fontSize={metrics.fontSize}
                fontWeight={metrics.fontWeight}
                letterSpacing={metrics.letterSpacing}
              >
                {text}
              </text>
              <text
                className="hero-letter-glow__outline-trace"
                style={{ ...traceStyle, opacity: config.traceOpacity }}
                x="0"
                y={metrics.fontSize}
                fill="none"
                stroke={`url(#${gradientId})`}
                strokeWidth={config.traceStrokeWidth}
                fontFamily={metrics.fontFamily}
                fontSize={metrics.fontSize}
                fontWeight={metrics.fontWeight}
                letterSpacing={metrics.letterSpacing}
              >
                {text}
              </text>
            </g>
          ) : null}
        </svg>
      ) : null}
    </span>
  );
}

function UploadConfidenceStrip() {
  return (
    <div className="mt-3 hidden grid-cols-3 gap-2 sm:grid">
      {uploadAssurances.map((item) => {
        const Icon = item.icon;
        return (
          <div
            key={item.title}
            aria-label={`${item.title}. ${item.copy}`}
            className="flex min-h-[4.5rem] flex-col justify-between rounded-lg border border-[var(--home-border)] bg-[var(--home-panel)]/78 px-3 py-2.5 shadow-sm shadow-black/5 backdrop-blur"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand">
              <Icon className="h-4 w-4" strokeWidth={2.1} />
            </span>
            <span className="mt-2 block text-xs font-semibold leading-4 text-[var(--home-text)]">{item.title}</span>
          </div>
        );
      })}
    </div>
  );
}

function LandingSupportSections() {
  return (
    <section className="relative z-10 mx-auto max-w-6xl px-6 pb-28">
      <div className="grid gap-3 md:grid-cols-3">
        {planningHighlights.map((item, index) => {
          const Icon = item.icon;
          const toneClass =
            index === 0
              ? "bg-[#5899C4]/10 text-[#3279A6]"
              : index === 1
                ? "bg-[#30A661]/10 text-[#278A51]"
                : "bg-[#CF820E]/10 text-[#A5660B]";

          return (
            <article
              key={item.title}
              className="rounded-lg border border-[var(--home-border)] bg-[var(--home-panel)]/84 p-4 shadow-xl shadow-black/5 backdrop-blur"
            >
              <div className={`flex h-9 w-9 items-center justify-center rounded-md ${toneClass}`}>
                <Icon className="h-4.5 w-4.5" strokeWidth={2.1} />
              </div>
              <h2 className="mt-4 font-display text-lg font-semibold leading-6 text-[var(--home-text)]">{item.title}</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--home-muted)]">{item.copy}</p>
            </article>
          );
        })}
      </div>

      <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:items-stretch">
        <div className="flex min-w-0 flex-col justify-between rounded-xl border border-[var(--home-border)] bg-[var(--home-panel)]/72 p-5 shadow-sm shadow-black/5 backdrop-blur md:p-6">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-brand">Planning workspace</p>
            <h2 className="mt-3 max-w-2xl font-display text-2xl font-semibold leading-tight text-[var(--home-text)] md:text-[2.35rem]">
              Workbook evidence, ready for staffing decisions.
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--home-muted)]">
              Upload the workbook, normalize the planning evidence, and move into supply, demand, risk, and approval conversations without spreadsheet hopping.
            </p>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-[0.9fr_1.25fr_0.9fr]">
            {landingMetrics.map((metric) => {
              const Icon = metric.icon;
              return (
                <article
                  key={metric.label}
                  className="group min-w-0 rounded-lg border border-[var(--home-border)] bg-[var(--home-bg)]/55 p-4 text-left shadow-sm shadow-black/5 transition hover:border-brand/35 hover:bg-[var(--home-panel)]/88"
                >
                  <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--home-muted)]">
                    <Icon className="h-4 w-4 shrink-0 text-brand" strokeWidth={2.2} />
                    <span>{metric.label}</span>
                  </div>
                  <div className="mt-4 whitespace-nowrap font-display text-[clamp(1.35rem,2.4vw,1.65rem)] font-semibold leading-none tracking-normal text-[var(--home-text)]">{metric.value}</div>
                </article>
              );
            })}
          </div>
        </div>

        <div className="grid h-full auto-rows-fr gap-3">
          {planningFlow.map((item, index) => {
            const Icon = item.icon;
            return (
              <article
                key={item.title}
                className="grid min-h-[7.25rem] grid-cols-[2.75rem_minmax(0,1fr)] items-center gap-3 rounded-xl border border-[var(--home-border)] bg-[var(--home-panel)]/72 p-4 shadow-sm shadow-black/5 backdrop-blur"
              >
                <span className="relative flex h-11 w-11 items-center justify-center rounded-lg bg-brand/10 text-brand">
                  <Icon className="h-5 w-5" strokeWidth={2.1} />
                  <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--home-text)] px-1 text-[10px] font-semibold text-[var(--home-bg)]">
                    {index + 1}
                  </span>
                </span>
                <span className="min-w-0">
                  <span className="block font-display text-base font-semibold leading-6 text-[var(--home-text)]">{item.title}</span>
                  <span className="mt-1 block text-sm leading-6 text-[var(--home-muted)]">{item.copy}</span>
                </span>
              </article>
            );
          })}
        </div>
      </div>
      <div className="mt-10 grid gap-6 rounded-lg border border-[var(--home-border)] bg-[var(--home-panel)]/84 p-4 shadow-xl shadow-black/5 backdrop-blur lg:grid-cols-[0.9fr_1.1fr] lg:p-5">
        <div className="min-w-0">
          <h2 className="font-display text-xl font-semibold text-[var(--home-text)]">Planner questions that fit the flow</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--home-muted)]">
            The assistant routes each question to the smallest evidence-backed path needed.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {sampleQuestions.map((question) => (
            <span
              key={question}
              className="rounded-full border border-[var(--home-border)] bg-[var(--home-soft)] px-3 py-2 text-xs font-medium leading-5 text-[var(--home-text)]"
            >
              {question}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

const stepFromUploadProgress = (snapshot: UploadProgressSnapshot) => {
  if (snapshot.status === "success" || snapshot.stage === "complete" || (snapshot.progress ?? 0) >= 100) {
    return processingSteps.length - 1;
  }

  if (Number.isFinite(snapshot.stepIndex) && snapshot.stepIndex >= 0) {
    return Math.min(processingSteps.length - 1, Math.trunc(snapshot.stepIndex));
  }

  const progress = snapshot.progress ?? 0;
  if (progress >= 95) return 2;
  if (progress >= 55) return 1;
  if (progress >= 10) return 0;
  return -1;
};

export default function HomePage() {
  const router = useRouter();
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [dataset, setDataset] = useState<DatasetRecord | null>(null);
  const [user, setUser] = useState<LoginUser | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const { toggleTheme } = useThemePreference();
  const [phase, setPhase] = useState<Phase>("login");
  const [activeStep, setActiveStep] = useState(-1);
  const activeStepRef = useRef(-1);
  const targetStepRef = useRef(-1);
  const isRevealingStepsRef = useRef(false);
  const revealRunRef = useRef(0);
  const preparedUploadRef = useRef<{ uploadId: string; watcher: UploadProgressWatcher } | null>(null);
  const [error, setError] = useState("");
  const [hasCheckedStoredUser, setHasCheckedStoredUser] = useState(false);

  const setCompletedStep = (step: number) => {
    const nextStep = Math.max(-1, Math.min(processingSteps.length - 1, step));
    activeStepRef.current = nextStep;
    setActiveStep(nextStep);
  };

  const requestStepReveal = (targetStep: number, delayMs = 650) => {
    targetStepRef.current = Math.max(
      targetStepRef.current,
      Math.max(-1, Math.min(processingSteps.length - 1, targetStep)),
    );

    if (isRevealingStepsRef.current) {
      return;
    }

    isRevealingStepsRef.current = true;
    const runId = revealRunRef.current;
    void (async () => {
      while (runId === revealRunRef.current && activeStepRef.current < targetStepRef.current) {
        await wait(delayMs);
        if (runId === revealRunRef.current && activeStepRef.current < targetStepRef.current) {
          setCompletedStep(activeStepRef.current + 1);
        }
      }

      if (runId !== revealRunRef.current) {
        return;
      }

      isRevealingStepsRef.current = false;
      if (activeStepRef.current < targetStepRef.current) {
        requestStepReveal(targetStepRef.current, delayMs);
      }
    })();
  };

  const revealProcessingSteps = async (targetStep: number, delayMs = 650) => {
    const finalStep = Math.max(-1, Math.min(processingSteps.length - 1, targetStep));
    requestStepReveal(finalStep, delayMs);

    while (activeStepRef.current < finalStep) {
      await wait(80);
    }
  };
  useEffect(() => {
    const storedUser = window.localStorage.getItem("workforceUser");
    if (!storedUser) {
      setHasCheckedStoredUser(true);
      return;
    }

    try {
      const parsed = JSON.parse(storedUser) as LoginUser;
      if (parsed.userId && parsed.username) {
        setUser(parsed);
        setPhase("upload");
      } else {
        window.localStorage.removeItem("workforceUser");
      }
    } catch {
      window.localStorage.removeItem("workforceUser");
    } finally {
      setHasCheckedStoredUser(true);
    }
  }, []);

  useEffect(() => {
    if (phase !== "success") return;

    const timer = window.setTimeout(() => router.push("/validate"), 1900);
    return () => window.clearTimeout(timer);
  }, [phase, router]);

  const handleLogin = async (username: string, password: string) => {
    setError("");
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const payload = await response.json();

    if (!response.ok || payload.status !== "success") {
      throw new Error(payload.error ?? "Login failed.");
    }

    const nextUser = {
      userId: payload.userId as string,
      username: payload.username as string,
      profileImage: payload.profileImage as string | undefined,
    };
    setUser(nextUser);
    window.localStorage.setItem("workforceUser", JSON.stringify(nextUser));
    setPhase("upload");
  };

  const uploadWorkbook = async (file: File, owner: LoginUser, uploadId: string) => {
    const body = new FormData();
    body.append("file", file);
    body.append("userId", owner.userId);
    body.append("label", file.name);
    body.append("uploadId", uploadId);

    const response = await fetch("/api/workforce-datasets", {
      method: "POST",
      body,
    });
    const payload = await response.json();

    if (!response.ok || payload.status !== "success") {
      throw new Error(payload.error ?? "Failed to import workbook.");
    }

    return payload.dataset as DatasetRecord;
  };

  const watchUploadProgress = (owner: LoginUser, uploadId: string): UploadProgressWatcher => {
    const eventsUrl = `/api/workforce-datasets/events?userId=${encodeURIComponent(owner.userId)}&uploadId=${encodeURIComponent(uploadId)}`;
    const events = new EventSource(eventsUrl);
    let settled = false;
    let markReady = () => {};
    let failReady = (_error: Error) => {};

    const ready = new Promise<void>((resolve, reject) => {
      markReady = resolve;
      failReady = reject;
    });

    const done = new Promise<void>((resolve, reject) => {
      const readProgress = (event: MessageEvent<string>) => {
        try {
          if (process.env.NODE_ENV === "development") {
            console.debug("workforce upload SSE", event.type, event.data);
          }
          const snapshot = JSON.parse(event.data) as UploadProgressSnapshot;
          const nextStep = stepFromUploadProgress(snapshot);

          if (event.type === "session") {
            requestStepReveal(nextStep, 0);
            markReady();
          } else {
            requestStepReveal(nextStep);
          }

          if (snapshot.status === "success") {
            settled = true;
            requestStepReveal(processingSteps.length - 1);
            events.close();
            resolve();
          }

          if (snapshot.status === "failure") {
            settled = true;
            events.close();
            reject(new Error(snapshot.error ?? "Failed to import workbook."));
          }
        } catch {
          settled = true;
          failReady(new Error("Failed to read upload progress."));
          events.close();
          reject(new Error("Failed to read upload progress."));
        }
      };

      events.addEventListener("session", readProgress);
      events.addEventListener("progress", readProgress);
      events.addEventListener("complete", readProgress);
      events.addEventListener("failed", readProgress);
      events.onerror = () => {
        if (settled) return;
        failReady(new Error("Upload progress stream disconnected."));
        events.close();
        reject(new Error("Upload progress stream disconnected."));
      };
    });

    return {
      ready,
      done,
      close: () => events.close(),
      isClosed: () => events.readyState === EventSource.CLOSED,
    };
  };

  const prepareUploadProgress = async () => {
    if (!user || preparedUploadRef.current) {
      if (preparedUploadRef.current) {
        await Promise.race([preparedUploadRef.current.watcher.ready.catch(() => undefined), wait(3500)]);
      }
      return;
    }

    const uploadId = crypto.randomUUID();
    const watcher = watchUploadProgress(user, uploadId);
    preparedUploadRef.current = { uploadId, watcher };
    void watcher.done.catch(() => undefined);
    await Promise.race([watcher.ready.catch(() => undefined), wait(3500)]);
  };

  const closePreparedUploadProgress = () => {
    const prepared = preparedUploadRef.current;
    if (!prepared) {
      return;
    }

    prepared.watcher.close();
    void prepared.watcher.done.catch(() => undefined);
    preparedUploadRef.current = null;
  };

  const handleFiles = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;

    if (!user) {
      setPhase("login");
      setError("Sign in before uploading workforce data.");
      return;
    }

    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      setError("Only .xlsx workbooks are supported.");
      return;
    }

    setError("");
    setUploadedFile(file);
    setDataset(null);
    targetStepRef.current = -1;
    isRevealingStepsRef.current = false;
    revealRunRef.current += 1;
    setCompletedStep(-1);
    setPhase("processing");

    let progressWatcher: UploadProgressWatcher | null = null;
    try {
      let prepared = preparedUploadRef.current;
      const uploadId = prepared?.uploadId ?? crypto.randomUUID();
      if (prepared?.watcher.isClosed()) {
        prepared.watcher.close();
        prepared = { uploadId, watcher: watchUploadProgress(user, uploadId) };
      }

      progressWatcher = prepared?.watcher ?? watchUploadProgress(user, uploadId);
      preparedUploadRef.current = null;
      await Promise.race([progressWatcher.ready.catch(() => undefined), wait(3000)]);
      if (progressWatcher.isClosed()) {
        progressWatcher.close();
        progressWatcher = watchUploadProgress(user, uploadId);
        await Promise.race([progressWatcher.ready.catch(() => undefined), wait(3000)]);
      }

      const progressPromise = progressWatcher.done.catch((progressError) => {
        if (progressError instanceof Error && progressError.message === "Upload progress stream disconnected.") {
          return;
        }
        throw progressError;
      });
      const createdDataset = await uploadWorkbook(file, user, uploadId);
      await revealProcessingSteps(processingSteps.length - 1, 620);
      await Promise.race([progressPromise.catch(() => undefined), wait(450)]);
      progressWatcher.close();
      window.localStorage.setItem("workforceDatasetId", createdDataset.datasetId);
      window.localStorage.setItem("workforceDatasetName", createdDataset.originalFileName || file.name);
      window.localStorage.removeItem("workforceDatasetSchemaValidated");
      setDataset(createdDataset);
      setPhase("success");
    } catch (uploadError) {
      progressWatcher?.close();
      void progressWatcher?.done.catch(() => undefined);
      setPhase(user ? "upload" : "login");
      setError(uploadError instanceof Error ? uploadError.message : "Failed to import workbook.");
    }
  };

  const resetUpload = () => {
    closePreparedUploadProgress();
    setUploadedFile(null);
    setDataset(null);
    setPhase(user ? "upload" : "login");
    targetStepRef.current = -1;
    isRevealingStepsRef.current = false;
    revealRunRef.current += 1;
    setCompletedStep(-1);
    setError("");
  };

  const logout = () => {
    closePreparedUploadProgress();
    window.localStorage.removeItem("workforceUser");
    window.localStorage.removeItem("workforceDatasetId");
    window.localStorage.removeItem("workforceDatasetName");
    window.localStorage.removeItem("workforceDatasetSchemaValidated");
    window.localStorage.removeItem("workforcePrompt");
    setUser(null);
    resetUpload();
    setPhase("login");
  };

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[var(--home-bg)] text-[var(--home-text)] transition-colors duration-300">
      <WorkforceParticleCanvas />
      <nav className="relative z-10 px-4 py-5 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-6xl items-center justify-between rounded-2xl border border-[var(--home-border)] bg-[var(--home-panel)] px-4 py-2.5 shadow-2xl shadow-black/10 backdrop-blur md:px-5">
          <Link href="/" className="flex min-w-0 items-center gap-2.5">
            <img src="/assets/davaforce-logo-mark.png" alt="" className="h-12 w-12 shrink-0 object-contain" />
            <DavaForceWordmark />
          </Link>
          <div className="flex shrink-0 items-center gap-3 sm:gap-5">
            {/* <ParticleToggle /> */}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="text-[var(--home-text)] hover:bg-[var(--home-soft)] hover:text-[var(--home-text)]"
              onClick={toggleTheme}
              aria-label="Toggle theme"
            >
              <Moon className="h-4 w-4 dark:hidden" />
              <Sun className="hidden h-4 w-4 dark:block" />
            </Button>
            {user ? (
              <UserRoleMenu
                userId={user.userId}
                username={user.username}
                profileImage={user.profileImage}
                onSignOut={logout}
              />
            ) : (
              <Button
                type="button"
                variant="ghost"
                className="h-12 text-base font-semibold text-[var(--home-text)] hover:bg-[var(--home-soft)] hover:text-[var(--home-text)]"
                onClick={() => setPhase("login")}
              >
                Sign in
              </Button>
            )}
          </div>
        </div>
      </nav>

      <main className="relative z-10 mx-auto flex min-h-0 max-w-6xl items-center px-6 pb-4 pt-12 lg:pt-14">
        {!hasCheckedStoredUser ? (
          <div className="w-full" />
        ) : (
        <AnimatePresence mode="wait">
          {phase === "success" ? (
            <SuccessPanel key="success" file={uploadedFile} />
          ) : (
            <motion.div
              key={phase === "login" ? "login" : "landing"}
              className="grid w-full items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(420px,480px)] xl:gap-10"
              initial={{ opacity: 0, y: 20, filter: "blur(8px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: -18, filter: "blur(8px)" }}
              transition={{ duration: 0.48, ease: [0.22, 1, 0.36, 1] }}
            >
              <section className="min-w-0 max-w-[49rem] text-left">
                <h1 className="font-display font-semibold tracking-tight">
                  <span className="block text-left text-[clamp(2rem,4vw,3.35rem)] leading-[0.98]">
                    Turn
                  </span>
                  <span className="mt-2 block whitespace-nowrap text-[clamp(1.9rem,3.75vw,2.75rem)] leading-[0.98]">
                    <HeroLetterGlow text="opportunity & demand" className="align-middle">
                      <span className="text-brand">
                        opportunity &amp;{" "}
                        <span className="relative inline-block">
                          demand
                          <motion.span
                            className="pointer-events-none absolute right-0 -top-32 hidden h-32 w-32 items-center justify-center sm:flex"
                            initial={{ opacity: 0, y: 12, rotate: -8, scale: 0.86 }}
                            animate={{ opacity: 1, y: [0, -8, 0], rotate: [-8, -3, -8], scale: 1 }}
                            transition={{
                              opacity: { duration: 0.4, delay: 0.42 },
                              scale: { duration: 0.55, delay: 0.42, ease: [0.22, 1, 0.36, 1] },
                              y: { duration: 3.2, repeat: Infinity, ease: "easeInOut" },
                              rotate: { duration: 3.2, repeat: Infinity, ease: "easeInOut" },
                            }}
                            aria-hidden="true"
                          >
                            <img
                              src="/assets/icon.png"
                              alt=""
                              className="h-full w-full object-contain drop-shadow-[0_18px_18px_rgba(25,43,55,0.18)]"
                            />
                          </motion.span>
                        </span>
                      </span>
                    </HeroLetterGlow>
                  </span>
                  <span className="mt-2 block text-left text-[clamp(2rem,4vw,3.35rem)] leading-[0.98]">
                    into
                  </span>
                  <span className="mt-2 hidden whitespace-nowrap text-[clamp(1.9rem,3.75vw,2.75rem)] leading-[0.98] sm:block">
                    <HeroLetterGlow text="evidence-backed teams" className="align-middle">
                      <span className="text-brand">
                        evidence-backed teams
                      </span>
                    </HeroLetterGlow>
                  </span>
                  <span className="mt-2 hidden text-[2.15rem] leading-[1.02] max-[639px]:block">
                    <span className="block text-brand">evidence-backed</span>
                    <span className="mt-1 block text-brand">teams</span>
                  </span>
                </h1>
                <p className="mt-6 max-w-xl text-base text-[var(--home-muted)]">
                  Sign in, upload a workforce workbook, then ask questions against the normalized dataset.
                </p>
              </section>

              <section className={`min-h-[28rem] w-full justify-self-end ${phase === "login" ? "lg:-mt-6" : ""}`}>
                <motion.div
                  className="overflow-hidden rounded-2xl"
                  initial={false}
                  animate={{ height: phase === "processing" ? 325 : phase === "login" && !user ? 380 : 260 }}
                  style={{ transformOrigin: "top center" }}
                  transition={{ type: "tween", duration: phase === "processing" ? 1.25 : 0.95, ease: [0.4, 0, 0.2, 1] }}
                >
                  <AnimatePresence mode="wait" initial={false}>
                    {phase === "login" && !user ? (
                      <LoginPanel key="login" error={error} onLogin={handleLogin} />
                    ) : null}

                    {phase === "upload" ? (
                      <UploadPanel
                        key="upload"
                        error={error}
                        isDragging={isDragging}
                        uploadedFile={uploadedFile}
                        onDragStateChange={setIsDragging}
                        onUploadIntent={prepareUploadProgress}
                        onFiles={handleFiles}
                        onReset={resetUpload}
                      />
                    ) : null}

                    {phase === "processing" ? (
                      <ProcessingPanel key="processing" activeStep={activeStep} file={uploadedFile} />
                    ) : null}
                  </AnimatePresence>
                </motion.div>
                {phase === "upload" ? <UploadConfidenceStrip /> : null}
              </section>
            </motion.div>
          )}
        </AnimatePresence>
        )}
      </main>

      <div>
        {phase === "login" || phase === "upload" ? <LandingSupportSections /> : null}
      </div>

    </div>
  );
}






































