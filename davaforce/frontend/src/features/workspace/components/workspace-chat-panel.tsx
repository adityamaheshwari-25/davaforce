"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, History, Loader2, Mic, MicOff, Plus, Search, Sparkles, Square, Trash2, Upload, Volume2, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useMovingGlowBorder } from "@/hooks/use-moving-glow-border";
import { useWebSpeechInput } from "@/hooks/use-web-speech-input";
import type { ChatConversationSummary, ChatMessage, DashboardView, WorkspaceAgentDetails } from "./types";

type WorkspaceChatPanelProps = {
  chatEndRef: RefObject<HTMLDivElement | null>;
  chatInput: string;
  chatInputRef: RefObject<HTMLTextAreaElement | null>;
  isAutoSending: boolean;
  isLoadingConversations: boolean;
  isThinking: boolean;
  messages: ChatMessage[];
  activeConversationId: string | null;
  canSendMessage: boolean;
  currentDatasetId: string;
  conversations: ChatConversationSummary[];
  needsDatasetForNewChat: boolean;
  selectedDetails: WorkspaceAgentDetails | null;
  sourceName: string;
  onChatInputChange: (value: string) => void;
  onDeleteConversation: (conversationId: string) => Promise<void> | void;
  onSelectDetail: (view: DashboardView | null, details?: WorkspaceAgentDetails | null) => void;
  onSelectConversation: (conversationId: string) => void;
  onStartNewChat: () => void;
  onSendMessage: () => void;
  onUploadRequired: () => void;
};

const renderInlineMarkdown = (value: string, keyPrefix: string): ReactNode[] =>
  value.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={`${keyPrefix}-strong-${index}`} className="font-semibold text-[var(--home-text)]">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <span key={`${keyPrefix}-text-${index}`}>{part}</span>
    ),
  );

function AssistantMarkdown({ text }: { text: string }) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];

  const flushBullets = () => {
    if (!bullets.length) return;

    const groupIndex = blocks.length;
    blocks.push(
      <ul key={`bullet-group-${groupIndex}`} className="space-y-2.5">
        {bullets.map((item, index) => (
          <li
            key={`${groupIndex}-bullet-${index}`}
            className="grid grid-cols-[0.65rem_minmax(0,1fr)] gap-2.5 leading-6"
          >
            <span className="mt-[0.65rem] h-1.5 w-1.5 rounded-full bg-brand/80 shadow-sm shadow-brand/20" aria-hidden="true" />
            <span className="min-w-0">{renderInlineMarkdown(item, `${groupIndex}-bullet-${index}`)}</span>
          </li>
        ))}
      </ul>,
    );
    bullets = [];
  };

  lines.forEach((line, index) => {
    const bulletMatch = /^[-*]\s+(.+)$/.exec(line) ?? /^\d+\.\s+(.+)$/.exec(line);
    if (bulletMatch) {
      bullets.push(bulletMatch[1]);
      return;
    }

    flushBullets();
    blocks.push(
      <p key={`paragraph-${index}`} className="leading-6">
        {renderInlineMarkdown(line, `paragraph-${index}`)}
      </p>,
    );
  });

  flushBullets();

  return <div className="space-y-2">{blocks}</div>;
}

const speechText = (value: string) =>
  value
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();

export function WorkspaceChatPanel({
  chatEndRef,
  chatInput,
  chatInputRef,
  isAutoSending,
  isLoadingConversations,
  isThinking,
  messages,
  activeConversationId,
  canSendMessage,
  currentDatasetId,
  conversations,
  needsDatasetForNewChat,
  selectedDetails,
  sourceName,
  onChatInputChange,
  onDeleteConversation,
  onSelectDetail,
  onSelectConversation,
  onStartNewChat,
  onSendMessage,
  onUploadRequired,
}: WorkspaceChatPanelProps) {
  const glowBorder = useMovingGlowBorder<HTMLDivElement>();
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [historySearch, setHistorySearch] = useState("");
  const [pendingDeleteConversation, setPendingDeleteConversation] = useState<ChatConversationSummary | null>(null);
  const [isDeletingConversation, setIsDeletingConversation] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const voiceInput = useWebSpeechInput({
    disabled: !canSendMessage,
    onChange: onChatInputChange,
    value: chatInput,
  });
  const hasConversationHistory = conversations.length > 0;
  const filteredConversations = useMemo(() => {
    const query = historySearch.trim().toLowerCase();
    if (!query) return conversations;

    return conversations.filter((conversation) => {
      const haystack = [
        conversation.title,
        conversation.activeOpportunityName,
        conversation.lastMessage,
        conversation.datasetId,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [conversations, historySearch]);
  const speechSupported =
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    "SpeechSynthesisUtterance" in window;

  useEffect(
    () => () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    },
    [],
  );

  const toggleSpeech = (message: ChatMessage) => {
    if (!speechSupported || message.role !== "ai") return;

    if (speakingMessageId === message.id) {
      window.speechSynthesis.cancel();
      setSpeakingMessageId(null);
      return;
    }

    const textToRead = speechText(message.text);
    if (!textToRead) return;

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(textToRead);
    utterance.rate = 0.96;
    utterance.pitch = 1;
    utterance.onend = () => setSpeakingMessageId((current) => (current === message.id ? null : current));
    utterance.onerror = () => setSpeakingMessageId((current) => (current === message.id ? null : current));
    setSpeakingMessageId(message.id);
    window.speechSynthesis.speak(utterance);
  };

  return (
    <>
      <motion.aside
        className="flex h-full min-h-0 flex-col rounded-2xl border border-[var(--home-border-strong)] bg-[var(--home-panel)] p-4 shadow-2xl shadow-black/10 backdrop-blur"
        initial={{ opacity: 0.92, x: 0, y: 0, scale: 1 }}
        animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      >
      <div className="flex items-center justify-between gap-3 border-b border-[var(--home-border)] pb-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-brand/10">
            <Sparkles className="h-4 w-4 text-brand" />
          </div>
          <div className="min-w-0">
            <div className="font-display text-sm font-semibold">Chat</div>
            <div className="max-w-[14rem] truncate text-xs text-[var(--home-muted)]">Source: {sourceName}</div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-[var(--home-muted)] hover:bg-[var(--home-soft)] hover:text-[var(--home-text)]"
                aria-label="New chat options"
                title="New chat options"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 border-[var(--home-border)] bg-[var(--home-panel)] p-2 text-left text-[var(--home-text)]">
              <DropdownMenuItem asChild className="cursor-pointer rounded-md p-0 focus:bg-[var(--home-soft)]">
                <Link href="/?action=upload" className="flex w-full flex-col items-start px-3 py-2 text-left">
                  <span className="text-sm font-medium">Upload new data</span>
                  <span className="text-xs text-[var(--home-muted)]">Replace the active dataset</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="cursor-pointer rounded-md px-3 py-2 focus:bg-[var(--home-soft)] data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50"
                disabled={!canSendMessage}
                onSelect={() => onStartNewChat()}
              >
                <div className="flex w-full flex-col items-start text-left">
                  <span className="text-sm font-medium">New chat on same data</span>
                  <span className="text-xs text-[var(--home-muted)]">Start from the ask screen</span>
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-[var(--home-muted)] hover:bg-[var(--home-soft)] hover:text-[var(--home-text)]"
            disabled={isLoadingConversations || !hasConversationHistory}
            aria-label="Previous chats"
            title="Previous chats"
            onClick={() => setIsHistoryOpen(true)}
          >
            {isLoadingConversations ? <Loader2 className="h-4 w-4 animate-spin" /> : <History className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      <div className="smooth-chat-scroll min-h-0 flex-1 space-y-4 overflow-y-auto py-4 pr-1">
        {messages.map((message) =>
          message.role === "user" ? (
            <motion.div
              key={message.id}
              className="ml-auto w-fit max-w-[82%] rounded-xl rounded-tr-sm bg-brand px-3 py-2.5 text-right text-sm text-brand-foreground shadow-sm shadow-brand/20"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35 }}
            >
              {message.text}
            </motion.div>
          ) : (
            <motion.div
              key={message.id}
              className="mr-auto flex max-w-[88%] gap-2"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35 }}
            >
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-brand/10">
                <Sparkles className="h-3.5 w-3.5 text-brand" />
              </div>
              <div className="rounded-xl rounded-tl-sm border border-[var(--home-border)] bg-[var(--home-soft)] px-3 py-2.5 text-sm text-[var(--home-text)]">
                <AssistantMarkdown text={message.text} />
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--home-border)] text-[var(--home-muted)] hover:bg-[var(--home-panel)] hover:text-[var(--home-text)] disabled:cursor-not-allowed disabled:opacity-45"
                    onClick={() => toggleSpeech(message)}
                    disabled={!speechSupported}
                    aria-label={speakingMessageId === message.id ? "Stop reading message" : "Read message aloud"}
                    title={speechSupported ? (speakingMessageId === message.id ? "Stop reading" : "Read aloud") : "Text to speech is not supported in this browser"}
                  >
                    {speakingMessageId === message.id ? <Square className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
                  </button>
                  {message.detailView ? (() => {
                    const isDetailOpen = Boolean(message.details && selectedDetails === message.details);

                    return (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-full border border-brand/30 px-2.5 py-1 text-xs font-medium text-brand hover:bg-brand/10"
                        onClick={() => onSelectDetail(message.detailView ?? null, message.details ?? null)}
                      >
                        {isDetailOpen ? (
                          <>
                            Hide details <ArrowLeft className="h-3 w-3" />
                          </>
                        ) : (
                          <>
                            View details <ArrowRight className="h-3 w-3" />
                          </>
                        )}
                      </button>
                    );
                  })() : null}
                </div>
              </div>
            </motion.div>
          ),
        )}

        {messages.length === 0 && needsDatasetForNewChat ? (
          <motion.div
            className="mx-auto flex max-w-[20rem] flex-col items-center justify-center rounded-2xl border border-dashed border-brand/35 bg-brand/5 px-5 py-6 text-center"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-md border border-brand/30 bg-brand/10 text-brand">
              <Upload className="h-5 w-5" />
            </div>
            <div className="mt-3 font-display text-sm font-semibold text-[var(--home-text)]">Upload a workbook first</div>
            <Button asChild className="mt-4 h-9 rounded-md bg-brand px-4 text-sm text-brand-foreground hover:bg-brand/90">
              <Link href="/?action=upload">Upload workbook</Link>
            </Button>
          </motion.div>
        ) : null}

        {isThinking ? (
          <motion.div
            className="mr-auto flex max-w-[88%] gap-2"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
          >
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-brand/10">
              <Sparkles className="h-3.5 w-3.5 text-brand" />
            </div>
            <div className="flex items-center gap-2 rounded-xl rounded-tl-sm border border-[var(--home-border)] bg-[var(--home-soft)] px-3 py-2.5 text-sm text-[var(--home-muted)]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Processing workforce data
            </div>
          </motion.div>
        ) : null}
        <div ref={chatEndRef} />
      </div>

      <motion.div
        ref={glowBorder.ref}
        onFocusCapture={glowBorder.onFocusCapture}
        onBlurCapture={glowBorder.onBlurCapture}
        className="moving-glow-border overflow-hidden rounded-full"
        initial={{ opacity: 0.92, y: 0, scale: 1 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      >
        <form
          className="relative flex items-center gap-2 rounded-full bg-[var(--home-panel-strong)] p-2.5"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSendMessage) {
              onUploadRequired();
              return;
            }
            voiceInput.stopListening();
            onSendMessage();
          }}
        >
          <textarea
            ref={chatInputRef}
            value={chatInput}
            onChange={(event) => onChatInputChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (!canSendMessage) {
                  onUploadRequired();
                  return;
                }
                voiceInput.stopListening();
                onSendMessage();
              }
            }}
            placeholder={canSendMessage ? "Ask a follow-up..." : "Upload a workbook first"}
            disabled={!canSendMessage}
            rows={1}
            className="smooth-chat-scroll block max-h-32 min-h-10 flex-1 resize-none overflow-hidden rounded-full bg-transparent px-4 py-2.5 text-sm leading-5 text-[var(--home-text)] placeholder:text-[var(--home-muted)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
          />
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className={`h-10 w-10 rounded-full border border-[var(--home-border)] text-[var(--home-muted)] hover:bg-[var(--home-soft)] hover:text-[var(--home-text)] [&_svg]:size-4 ${
                voiceInput.isListening ? "border-brand/50 bg-brand/10 text-brand" : ""
              }`}
              disabled={!canSendMessage}
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
              {voiceInput.isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </Button>
            <motion.div animate={isAutoSending ? { scale: [1, 0.88, 1] } : { scale: 1 }} transition={{ duration: 0.32 }}>
              <Button
                type="submit"
                size="icon"
                className="h-10 w-10 rounded-full bg-brand text-brand-foreground hover:bg-brand/90 [&_svg]:size-5"
                disabled={!canSendMessage}
                aria-label="Send message"
              >
                <ArrowRight className="h-5 w-5" strokeWidth={3} />
              </Button>
            </motion.div>
          </div>
        </form>
      </motion.div>
      {voiceInput.error || voiceInput.isListening ? (
        <p className="mt-2 px-2 text-center text-xs font-medium text-[var(--home-muted)]">
          {voiceInput.error || "Listening..."}
        </p>
      ) : null}
      </motion.aside>

      <AnimatePresence>
        {isHistoryOpen ? (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-5 backdrop-blur-md"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onMouseDown={() => setIsHistoryOpen(false)}
          >
            <motion.div
              className="flex max-h-[82vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[var(--home-border-strong)] bg-[var(--home-panel)] shadow-2xl shadow-black/30"
              initial={{ opacity: 0, y: 26, scale: 0.96, filter: "blur(8px)" }}
              animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: 18, scale: 0.98, filter: "blur(8px)" }}
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4 border-b border-[var(--home-border)] px-5 py-4">
                <div>
                  <div className="flex items-center gap-2">
                    <div className="flex h-9 w-9 items-center justify-center rounded-md bg-brand/10">
                      <History className="h-4 w-4 text-brand" />
                    </div>
                    <div>
                      <h2 className="font-display text-xl font-semibold text-[var(--home-text)]">Chat history</h2>
                      <p className="text-xs text-[var(--home-muted)]">Select a previous conversation to restore its messages and dataset.</p>
                    </div>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 text-[var(--home-muted)] hover:bg-[var(--home-soft)] hover:text-[var(--home-text)]"
                  onClick={() => setIsHistoryOpen(false)}
                  aria-label="Close chat history"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="border-b border-[var(--home-border)] px-5 py-4">
                <div className="flex items-center gap-2 rounded-xl border border-[var(--home-border)] bg-[var(--home-panel-strong)] px-3 py-2">
                  <Search className="h-4 w-4 text-[var(--home-muted)]" />
                  <input
                    value={historySearch}
                    onChange={(event) => setHistorySearch(event.target.value)}
                    placeholder="Search chats, opportunities, or datasets..."
                    className="h-8 flex-1 bg-transparent text-sm text-[var(--home-text)] placeholder:text-[var(--home-muted)] focus:outline-none"
                    autoFocus
                  />
                </div>
              </div>

              <div className="smooth-chat-scroll min-h-0 flex-1 space-y-1.5 overflow-y-auto p-4">
                {filteredConversations.length ? (
                  filteredConversations.map((conversation) => {
                    const isActive = conversation.id === activeConversationId;
                    return (
                      <div
                        key={conversation.id}
                        className={`group grid h-14 w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 rounded-lg border px-3 text-left transition ${
                          isActive
                            ? "border-brand/60 bg-brand/10 shadow-sm shadow-brand/10"
                            : "border-[var(--home-border)] bg-[var(--home-soft)] hover:border-brand/35 hover:bg-brand/5"
                        }`}
                      >
                        <button
                          type="button"
                          className="flex min-w-0 items-center gap-3 text-left"
                          onClick={() => {
                            setIsHistoryOpen(false);
                            onSelectConversation(conversation.id);
                          }}
                        >
                          <span
                            className={`h-8 w-1 shrink-0 rounded-full ${
                              isActive ? "bg-brand" : "bg-[var(--home-border-strong)] group-hover:bg-brand/50"
                            }`}
                            aria-hidden="true"
                          />
                          <div className="min-w-0">
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="truncate font-display text-sm font-semibold text-[var(--home-text)]">
                                {conversation.title}
                              </span>
                              {isActive ? (
                                <span className="shrink-0 rounded-full bg-brand px-2 py-0.5 text-[10px] font-semibold text-brand-foreground">
                                  Active
                                </span>
                              ) : null}
                            </div>
                            <div className="mt-0.5 truncate text-xs text-[var(--home-muted)]">
                              {conversation.lastMessage ||
                                (conversation.datasetId === currentDatasetId
                                  ? "Current upload"
                                  : conversation.activeOpportunityName ?? "Previous upload")}
                            </div>
                          </div>
                        </button>
                        <div className="flex shrink-0 items-center gap-2 text-[11px] text-[var(--home-muted)]">
                          <span className="rounded-full border border-[var(--home-border)] px-2 py-0.5 font-medium">
                            {conversation.messageCount}
                          </span>
                          <span className="hidden w-28 truncate sm:inline">{new Date(conversation.updatedAt).toLocaleDateString()}</span>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0 text-[var(--home-muted)] hover:bg-brand/10 hover:text-brand"
                          aria-label="Delete chat"
                          title="Delete chat"
                          onClick={() => setPendingDeleteConversation(conversation)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    );
                  })
                ) : (
                  <div className="rounded-xl border border-dashed border-[var(--home-border)] bg-[var(--home-soft)] px-4 py-10 text-center text-sm text-[var(--home-muted)]">
                    No matching chats found.
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {pendingDeleteConversation ? (
          <motion.div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-5 backdrop-blur-md"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onMouseDown={() => {
              if (!isDeletingConversation) setPendingDeleteConversation(null);
            }}
          >
            <motion.div
              className="w-full max-w-md rounded-2xl border border-[var(--home-border-strong)] bg-[var(--home-panel)] p-5 text-left shadow-2xl shadow-black/30"
              initial={{ opacity: 0, y: 22, scale: 0.96, filter: "blur(8px)" }}
              animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: 16, scale: 0.98, filter: "blur(8px)" }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand">
                  <Trash2 className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-display text-lg font-semibold text-[var(--home-text)]">Delete this chat?</h3>
                  <p className="mt-1 text-sm leading-5 text-[var(--home-muted)]">
                    This removes the conversation and its messages. If this is the only chat for its dataset, the uploaded dataset and dashboard data will also be deleted.
                  </p>
                </div>
              </div>

              <div className="mt-4 rounded-xl border border-[var(--home-border)] bg-[var(--home-soft)] px-3 py-2">
                <div className="truncate text-sm font-semibold text-[var(--home-text)]">{pendingDeleteConversation.title}</div>
                <div className="mt-0.5 text-xs text-[var(--home-muted)]">
                  {pendingDeleteConversation.messageCount} messages - {new Date(pendingDeleteConversation.updatedAt).toLocaleDateString()}
                </div>
              </div>

              <div className="mt-5 flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="border-[var(--home-border)] bg-[var(--home-panel-strong)] text-[var(--home-text)] hover:bg-[var(--home-soft)] hover:text-[var(--home-text)]"
                  disabled={isDeletingConversation}
                  onClick={() => setPendingDeleteConversation(null)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  className="bg-brand text-brand-foreground hover:bg-brand/90"
                  disabled={isDeletingConversation}
                  onClick={() => {
                    const conversationId = pendingDeleteConversation.id;
                    setIsDeletingConversation(true);
                    void Promise.resolve(onDeleteConversation(conversationId))
                      .catch((error) => {
                        console.error(error);
                      })
                      .finally(() => {
                        setIsDeletingConversation(false);
                        setPendingDeleteConversation(null);
                      });
                  }}
                >
                  {isDeletingConversation ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Delete chat
                </Button>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}


