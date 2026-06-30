"use client";

import { motion } from "framer-motion";
import { ArrowRight, FileText, KeyRound, Loader2, Upload, X } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const processingSteps = [
  "Reading workbook structure",
  "Normalizing skills and availability",
  "Converting rows into a planning table",
  "Data processing done",
];

export function LoginPanel({
  error,
  onLogin,
}: {
  error: string;
  onLogin: (username: string, password: string) => Promise<void>;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSsoSubmitting, setIsSsoSubmitting] = useState(false);
  const [localError, setLocalError] = useState("");

  const signInWithSso = async () => {
    setLocalError("");
    setIsSsoSubmitting(true);
    try {
      await onLogin("sarah", "sarah123");
    } catch (loginError) {
      setLocalError(loginError instanceof Error ? loginError.message : "Login failed.");
    } finally {
      setIsSsoSubmitting(false);
    }
  };

  const signInWithPassword = async () => {
    setLocalError("");
    setIsSubmitting(true);
    try {
      await onLogin(username, password);
    } catch (loginError) {
      setLocalError(loginError instanceof Error ? loginError.message : "Login failed.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <motion.div
      className="rounded-2xl border border-[var(--home-border-strong)] bg-[var(--home-panel)] p-4 text-left shadow-2xl shadow-black/10 backdrop-blur"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ type: "tween", duration: 0.18 }}
    >
      <div>
        <h2 className="font-display text-xl font-semibold text-[var(--home-text)]">Sign in</h2>
        <p className="mt-1 text-sm text-[var(--home-muted)]">Continue with your work account.</p>
      </div>

      <form
        className="mt-5 space-y-3"
        autoComplete="off"
        onSubmit={async (event) => {
          event.preventDefault();
          await signInWithPassword();
        }}
      >
        <div>
          <Label className="mb-1 block text-xs text-[var(--home-muted)]">Username</Label>
          <Input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="Enter Username"
            autoComplete="off"
          />
        </div>
        <div>
          <Label className="mb-1 block text-xs text-[var(--home-muted)]">Password</Label>
          <Input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Enter Password"
            autoComplete="new-password"
          />
        </div>
        {error || localError ? (
          <div className="rounded-lg border border-brand/30 bg-brand/10 px-3 py-2 text-xs text-brand">
            {localError || error}
          </div>
        ) : null}
        <Button type="submit" className="w-full bg-brand text-brand-foreground hover:bg-brand/90" disabled={isSubmitting || isSsoSubmitting}>
          {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Sign in <ArrowRight className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-3 text-xs text-[var(--home-muted)]">
          <span className="h-px flex-1 bg-[var(--home-border)]" />
          <span>or</span>
          <span className="h-px flex-1 bg-[var(--home-border)]" />
        </div>
        <Button
          type="button"
          variant="outline"
          className="h-10 w-full border-[var(--home-border)] bg-[var(--home-panel-strong)] text-[var(--home-text)] hover:bg-[var(--home-soft)] hover:text-[var(--home-text)]"
          disabled={isSubmitting || isSsoSubmitting}
          onClick={signInWithSso}
        >
          {isSsoSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          <KeyRound className="h-4 w-4" />
          Continue with SSO
        </Button>
      </form>
    </motion.div>
  );
}

export function UploadPanel({
  error,
  isDragging,
  uploadedFile,
  onDragStateChange,
  onUploadIntent,
  onFiles,
  onReset,
}: {
  error: string;
  isDragging: boolean;
  uploadedFile: File | null;
  onDragStateChange: (isDragging: boolean) => void;
  onUploadIntent: () => Promise<void>;
  onFiles: (files: FileList | null) => void;
  onReset: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const openFilePicker = () => {
    void onUploadIntent();
    inputRef.current?.click();
  };

  return (
    <motion.div
      className="h-full rounded-2xl border border-[var(--home-border-strong)] bg-[var(--home-panel)] p-2 shadow-2xl shadow-black/10 backdrop-blur"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ type: "tween", duration: 0.18 }}
    >
      <div
        role="button"
        tabIndex={0}
        onPointerEnter={() => void onUploadIntent()}
        onFocus={() => void onUploadIntent()}
        onClick={openFilePicker}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") {
            return;
          }
          event.preventDefault();
          openFilePicker();
        }}
        onDragOver={(event) => {
          event.preventDefault();
          void onUploadIntent();
          onDragStateChange(true);
        }}
        onDragLeave={() => onDragStateChange(false)}
        onDrop={(event) => {
          event.preventDefault();
          onDragStateChange(false);
          void onFiles(event.dataTransfer.files);
        }}
        className={`flex h-full cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-6 py-6 text-center transition ${
          isDragging
            ? "border-brand bg-brand/10"
            : "border-[var(--home-border-strong)] bg-[var(--home-soft)] hover:border-brand hover:bg-brand/10"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="sr-only"
          onChange={(event) => void onFiles(event.target.files)}
        />
        <div className="flex h-12 w-12 items-center justify-center rounded-md border border-[#ff9b73]/80 bg-transparent text-[#ff9b73] shadow-lg shadow-brand/10">
          <Upload className="h-6 w-6" strokeWidth={2.35} />
        </div>
        <div className="mt-5 font-display text-lg font-semibold text-[var(--home-text)]">
          Upload Excel workforce data
        </div>
        <div className="mt-1 text-sm text-[var(--home-muted)]">Drop a .xlsx workbook here</div>
        {error ? <div className="mt-4 rounded-lg bg-brand/10 px-3 py-2 text-xs text-brand">{error}</div> : null}
      </div>

      {uploadedFile ? (
        <div className="mt-2 flex items-center justify-between rounded-xl border border-[var(--home-border)] bg-[var(--home-soft)] px-4 py-3 text-left">
          <div className="flex min-w-0 items-center gap-3">
            <FileText className="h-5 w-5 shrink-0 text-brand" strokeWidth={2.1} />
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-[var(--home-text)]">{uploadedFile.name}</div>
              <div className="text-xs text-[var(--home-muted)]">{formatFileSize(uploadedFile.size)}</div>
            </div>
          </div>
          <button
            type="button"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--home-muted)] hover:bg-[var(--home-soft)] hover:text-[var(--home-text)]"
            onClick={onReset}
            aria-label="Remove uploaded file"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}
    </motion.div>
  );
}

export function ProcessingPanel({ activeStep, file }: { activeStep: number; file: File | null }) {
  return (
    <motion.div
      className="h-full rounded-2xl border border-[var(--home-border-strong)] bg-[var(--home-panel)] p-4 text-left shadow-2xl shadow-black/10 backdrop-blur"
      initial={{ opacity: 0, clipPath: "inset(0 0 100% 0)" }}
      animate={{ opacity: 1, clipPath: "inset(0 0 0% 0)" }}
      exit={{ opacity: 0, clipPath: "inset(0 0 100% 0)" }}
      transition={{ type: "tween", duration: 1.1, ease: [0.4, 0, 0.2, 1] }}
    >
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[#ff9b73]/60 bg-[#ff9b73]/10 text-[#ff9b73]">
          <FileText className="h-4 w-4" strokeWidth={2.1} />
        </div>
        <div className="min-w-0">
          <div className="truncate font-display text-sm font-semibold leading-tight text-[var(--home-text)]">
            {file?.name ?? "Workbook"}
          </div>
          <div className="text-xs text-[var(--home-muted)]">Processing and preparing your dataset</div>
        </div>
      </div>

      <div className="mt-4 space-y-2.5">
        {processingSteps.map((step, index) => {
          const isDone = index <= activeStep;
          const isLoading = index === activeStep + 1;
          return (
            <div key={step} className="flex h-[48px] items-center gap-3 rounded-lg border border-[var(--home-border)] bg-[var(--home-soft)] px-4">
              <div className={`flex h-7 w-7 items-center justify-center rounded-md ${isDone ? "bg-brand text-brand-foreground" : "bg-[var(--home-soft)] text-[var(--home-muted)]"}`}>
                {isDone ? (
                  <MiniMotionCheck />
                ) : isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <span className="h-2 w-2 rounded-full bg-current" />
                )}
              </div>
              <span className={isDone ? "text-sm text-[var(--home-text)]" : "text-sm text-[var(--home-muted)]"}>
                {step}
              </span>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}

export function SuccessPanel({ file }: { file: File | null }) {
  return (
    <motion.div
      className="mx-auto flex w-full max-w-2xl flex-col items-center justify-center text-center"
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98, y: -18 }}
      transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
    >
      <motion.div
        className="flex h-32 w-32 items-center justify-center rounded-full bg-brand text-brand-foreground shadow-[0_0_70px_rgba(255,86,64,0.5)]"
        initial={{ scale: 0.72 }}
        animate={{ scale: 1 }}
        transition={{ duration: 0.85, ease: [0.22, 1, 0.36, 1] }}
      >
        <svg viewBox="0 0 64 64" className="h-20 w-20" aria-hidden="true">
          <motion.path
            d="M17 33.5 27.2 43 48 21"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="7"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ duration: 0.7, delay: 0.16, ease: "easeInOut" }}
          />
        </svg>
      </motion.div>
      <h2 className="mt-8 font-display text-4xl font-semibold text-[var(--home-text)]">Data processing done</h2>
      <p className="mt-3 max-w-md text-sm text-[var(--home-muted)]">
        {file?.name ?? "Your workbook"} is normalized and ready for table validation.
      </p>
    </motion.div>
  );
}

function MiniMotionCheck() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <motion.path
        d="M5 12.5 9.5 17 19 7"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="3"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.34, ease: "easeOut" }}
      />
    </svg>
  );
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  const kb = size / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}



