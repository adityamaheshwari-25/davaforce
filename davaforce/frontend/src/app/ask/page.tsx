"use client";

import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Mic, MicOff } from "lucide-react";
import { WorkforceParticleCanvas } from "@/components/workforce-particle-canvas";
import { WorkspaceTopNav } from "@/components/shell/workspace-top-nav";
import { Button } from "@/components/ui/button";
import { useMovingGlowBorder } from "@/hooks/use-moving-glow-border";
import { useWebSpeechInput } from "@/hooks/use-web-speech-input";
import { isDatasetSchemaValidated } from "@/lib/workforce-schema-validation";

export default function AskPage() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [sourceName, setSourceName] = useState("normalized dataset");
  const [isLaunching, setIsLaunching] = useState(false);
  const [isCheckingAccess, setIsCheckingAccess] = useState(true);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const glowBorder = useMovingGlowBorder<HTMLDivElement>();
  const voiceInput = useWebSpeechInput({
    disabled: isLaunching,
    onChange: setPrompt,
    value: prompt,
  });

  useEffect(() => {
    let cancelled = false;

    const checkAccess = async () => {
      const storedUser = window.localStorage.getItem("workforceUser");
      const datasetId = window.localStorage.getItem("workforceDatasetId");
      if (!storedUser) {
        router.replace("/");
        return;
      }
      if (!datasetId) {
        router.replace("/?action=upload");
        return;
      }

      try {
        const parsedUser = JSON.parse(storedUser) as { userId?: string } | null;
        const userId = parsedUser?.userId ?? "";
        if (!userId || !(await isDatasetSchemaValidated(userId, datasetId))) {
          router.replace("/validate");
          return;
        }
      } catch {
        router.replace("/validate");
        return;
      }

      if (cancelled) return;
      const storedSource = window.localStorage.getItem("workforceDatasetName");
      if (storedSource) {
        setSourceName(storedSource);
      }
      setIsCheckingAccess(false);
    };

    void checkAccess();

    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    const input = promptRef.current;
    if (!input) return;

    input.style.height = "0px";
    const nextHeight = Math.min(input.scrollHeight, 112);
    input.style.height = `${nextHeight}px`;
    input.style.overflowY = input.scrollHeight > 112 ? "auto" : "hidden";
  }, [prompt]);

  useEffect(() => {
    if (isLaunching) {
      document.body.dataset.hideAppFooter = "true";
    } else {
      delete document.body.dataset.hideAppFooter;
    }

    return () => {
      delete document.body.dataset.hideAppFooter;
    };
  }, [isLaunching]);

  const ask = () => {
    const nextPrompt = prompt.trim();
    if (!nextPrompt || isLaunching) return;

    voiceInput.stopListening();
    window.localStorage.setItem("workforcePrompt", nextPrompt);
    window.localStorage.setItem("workforcePrompt:id", crypto.randomUUID());
    setIsLaunching(true);
    window.setTimeout(() => router.push("/workspace"), 1250);
  };

  if (isCheckingAccess) {
    return <div className="min-h-screen bg-[var(--home-bg)] transition-colors duration-300" />;
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-[var(--home-bg)] text-[var(--home-text)] transition-colors duration-300">
      <WorkforceParticleCanvas />
      <WorkspaceTopNav />

      <motion.main
        className="relative z-10 min-h-[calc(100vh-9.5rem)]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.35 }}
      >
        <motion.div
          className="fixed left-1/2 top-1/2 w-[min(44rem,calc(100vw-3rem))]"
          initial={{ x: "-50%", y: "calc(-50% + 120px)", scale: 0.97, opacity: 0, filter: "blur(12px)" }}
          animate={
            isLaunching
              ? {
                  left: 40,
                  top: "calc(100vh - 15.5rem)",
                  x: 0,
                  y: 0,
                  width: "min(348px, calc(100vw - 5rem))",
                  scale: 1,
                  opacity: 0.92,
                  filter: "blur(0px)",
                }
              : { x: "-50%", y: "-50%", scale: 1, opacity: 1, filter: "blur(0px)" }
          }
          transition={{ type: "tween", duration: isLaunching ? 1.15 : 0.72, ease: [0.16, 1, 0.3, 1] }}
        >
          <motion.div
            className="mb-5 text-center transition-colors duration-300"
            animate={isLaunching ? { opacity: 0, y: -10, filter: "blur(6px)" } : { opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: isLaunching ? 0.18 : 0.25 }}
          >
            <h1 className="font-display text-3xl font-semibold text-[var(--home-text)] transition-colors duration-300">
              Start exploring your data!
            </h1>
            <p className="mt-2 truncate text-sm text-[var(--home-muted)] transition-colors duration-300">Source: {sourceName}</p>
          </motion.div>

          <div
            ref={glowBorder.ref}
            onFocusCapture={glowBorder.onFocusCapture}
            onBlurCapture={glowBorder.onBlurCapture}
            className="moving-glow-border overflow-hidden rounded-full"
          >
            <form
              onSubmit={(event) => {
                event.preventDefault();
                ask();
              }}
              className={`relative flex items-center rounded-full bg-[var(--home-panel-strong)] transition-[background-color,box-shadow] duration-300 ${
                isLaunching ? "gap-2 p-2.5" : "gap-3 p-3"
              }`}
            >
              <textarea
                ref={promptRef}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    ask();
                  }
                }}
                placeholder="Ask about staffing, skills, availability..."
                rows={1}
                className={`smooth-chat-scroll block flex-1 resize-none overflow-hidden rounded-full bg-transparent text-left text-[var(--home-text)] placeholder:text-[var(--home-muted)] transition-colors duration-300 focus:outline-none ${
                  isLaunching
                    ? "max-h-32 min-h-10 px-4 py-2.5 text-sm leading-5"
                    : "max-h-40 min-h-14 px-5 py-[15px] text-base leading-6"
                }`}
              />
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className={`rounded-full border border-[var(--home-border)] text-[var(--home-muted)] hover:bg-[var(--home-soft)] hover:text-[var(--home-text)] ${
                    isLaunching ? "h-10 w-10 [&_svg]:size-5" : "h-12 w-12 [&_svg]:size-5"
                  } ${voiceInput.isListening ? "border-brand/50 bg-brand/10 text-brand" : ""}`}
                  disabled={isLaunching}
                  onClick={voiceInput.toggleListening}
                  aria-label={voiceInput.isListening ? "Stop voice input" : "Start voice input"}
                  title={
                    voiceInput.isSupported
                      ? voiceInput.isListening
                        ? "Stop voice input"
                        : "Start voice input"
                      : "Voice input is not supported in this browser"
                  }
                >
                  {voiceInput.isListening ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                </Button>
                <Button
                  type="submit"
                  size="icon"
                  className={`rounded-full bg-brand text-brand-foreground hover:bg-brand/90 ${
                    isLaunching ? "h-10 w-10 [&_svg]:size-5" : "h-12 w-12 [&_svg]:size-6"
                  }`}
                  aria-label="Ask"
                >
                  <ArrowRight className={isLaunching ? "h-5 w-5" : "h-6 w-6"} strokeWidth={3} />
                </Button>
              </div>
            </form>
          </div>
          {voiceInput.error || voiceInput.isListening ? (
            <p className="mt-2 text-center text-xs font-medium text-[var(--home-muted)]">
              {voiceInput.error || "Listening..."}
            </p>
          ) : null}
        </motion.div>
      </motion.main>
    </div>
  );
}

