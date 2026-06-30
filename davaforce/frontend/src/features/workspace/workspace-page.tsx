"use client";

import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { WorkforceParticleCanvas } from "@/components/workforce-particle-canvas";
import { WorkspaceTopNav } from "@/components/shell/workspace-top-nav";
import { WorkspaceChatPanel } from "@/features/workspace/components/workspace-chat-panel";
import { WorkspaceDetailPanel } from "@/features/workspace/components/workspace-detail-panel";
import type { ChatConversationSummary, ChatMessage, DashboardView, WorkspaceAgentDetails } from "@/features/workspace/components/types";
import { isDatasetSchemaValidated } from "@/lib/workforce-schema-validation";

type WorkspaceChatPayload = {
  status: "success" | "failure";
  conversationId?: string;
  message?: string;
  detailView?: DashboardView | null;
  details?: WorkspaceAgentDetails | null;
  error?: string;
};

type WorkspaceConversationPayloadMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  detailView?: DashboardView | null;
  details?: WorkspaceAgentDetails | null;
};

type WorkspaceConversationRecord = ChatConversationSummary & {
  messages: WorkspaceConversationPayloadMessage[];
};

type WorkspaceConversationListPayload = {
  status: "success" | "failure";
  conversations?: ChatConversationSummary[];
  error?: string;
};

type WorkspaceConversationPayload = {
  status: "success" | "failure";
  conversation?: WorkspaceConversationRecord;
  error?: string;
};

type WorkspaceConversationDeletePayload = {
  status: "success" | "failure";
  deletion?: {
    conversationId: string;
    datasetId: string;
    datasetDeleted: boolean;
    replacementConversationId: string | null;
  };
  error?: string;
};

type DatasetRecord = {
  datasetId: string;
  originalFileName: string;
  label: string | null;
};

type DatasetPayload = {
  status: "success" | "failure";
  dataset?: DatasetRecord;
  error?: string;
};

type StoredWorkforceUser = {
  userId?: string;
  username?: string;
};

const activeConversationStorageKey = (datasetId: string) => `workforceWorkspaceActiveConversation:${datasetId || "default"}`;
const legacyWorkspacePromptKey = "workforcePrompt";
const legacyWorkspacePromptIdKey = `${legacyWorkspacePromptKey}:id`;
const legacyWorkspacePromptHandledIdKey = `${legacyWorkspacePromptKey}:handledId`;

const mapConversationMessages = (conversation: WorkspaceConversationRecord): ChatMessage[] =>
  conversation.messages.map((message) => ({
    id: message.id,
    role: message.role === "assistant" ? "ai" : "user",
    text: message.content,
    detailView: message.detailView ?? null,
    details: message.details ?? null,
  }));

const getWorkspaceIdentity = () => {
  const user = JSON.parse(window.localStorage.getItem("workforceUser") ?? "null") as StoredWorkforceUser | null;
  return {
    userId: user?.userId ?? "",
    datasetId: window.localStorage.getItem("workforceDatasetId") ?? "",
  };
};

export default function WorkspacePage() {
  const router = useRouter();
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversations, setConversations] = useState<ChatConversationSummary[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [activeConversationDatasetId, setActiveConversationDatasetId] = useState<string | null>(null);
  const [isLoadingConversations, setIsLoadingConversations] = useState(false);
  const [isAutoSending, setIsAutoSending] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [selectedDetails, setSelectedDetails] = useState<WorkspaceAgentDetails | null>(null);
  const [sourceName, setSourceName] = useState("normalized dataset");
  const [datasetId, setDatasetId] = useState("");
  const [handledPrompt, setHandledPrompt] = useState("");
  const [isCheckingAccess, setIsCheckingAccess] = useState(true);
  const datasetIdRef = useRef("");
  const activeConversationIdRef = useRef<string | null>(null);
  const activeConversationDatasetIdRef = useRef<string | null>(null);
  const pendingHandoffIdRef = useRef("");
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const input = chatInputRef.current;
    if (!input) return;

    input.style.height = "0px";
    const nextHeight = Math.min(input.scrollHeight, 112);
    input.style.height = `${nextHeight}px`;
    input.style.overflowY = input.scrollHeight > 112 ? "auto" : "hidden";
  }, [chatInput]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isThinking]);

  const fetchConversations = async () => {
    const { userId } = getWorkspaceIdentity();
    if (!userId) return [];

    const params = new URLSearchParams({ userId });
    const response = await fetch(`/api/workforce-chats?${params.toString()}`);
    const payload = (await response.json()) as WorkspaceConversationListPayload;
    if (!response.ok || payload.status !== "success") {
      throw new Error(payload.error ?? "Failed to load previous chats.");
    }

    const nextConversations = payload.conversations ?? [];
    setConversations(nextConversations);
    return nextConversations;
  };

  const activateDatasetContext = async (nextDatasetId: string) => {
    const { userId } = getWorkspaceIdentity();
    if (!userId || !nextDatasetId) return;

    datasetIdRef.current = nextDatasetId;
    setDatasetId(nextDatasetId);
    window.localStorage.setItem("workforceDatasetId", nextDatasetId);

    try {
      const params = new URLSearchParams({ userId, datasetId: nextDatasetId });
      const response = await fetch(`/api/workforce-datasets?${params.toString()}`, { cache: "no-store" });
      const payload = (await response.json()) as DatasetPayload;
      if (!response.ok || payload.status !== "success" || !payload.dataset) {
        throw new Error(payload.error ?? "Failed to load dataset metadata.");
      }

      const nextSourceName = payload.dataset.originalFileName || payload.dataset.label || "normalized dataset";
      setSourceName(nextSourceName);
      window.localStorage.setItem("workforceDatasetName", nextSourceName);
      window.dispatchEvent(new Event("workforce-dataset-changed"));
    } catch {
      setSourceName("normalized dataset");
      window.dispatchEvent(new Event("workforce-dataset-changed"));
    }
  };

  const openConversation = async (conversationId: string) => {
    const { userId } = getWorkspaceIdentity();
    if (!userId) return;

    setIsLoadingConversations(true);
    try {
      const params = new URLSearchParams({ userId });
      const response = await fetch(`/api/workforce-chats/${conversationId}?${params.toString()}`);
      const payload = (await response.json()) as WorkspaceConversationPayload;
      if (!response.ok || payload.status !== "success" || !payload.conversation) {
        throw new Error(payload.error ?? "Failed to load chat.");
      }

      const nextMessages = mapConversationMessages(payload.conversation);
      await activateDatasetContext(payload.conversation.datasetId);
      activeConversationIdRef.current = payload.conversation.id;
      activeConversationDatasetIdRef.current = payload.conversation.datasetId;
      setActiveConversationId(payload.conversation.id);
      setActiveConversationDatasetId(payload.conversation.datasetId);
      setMessages(nextMessages);
      setSelectedDetails(null);
      window.localStorage.setItem(activeConversationStorageKey(payload.conversation.datasetId), payload.conversation.id);
    } finally {
      setIsLoadingConversations(false);
    }
  };

  useEffect(() => {
    const storedUser = window.localStorage.getItem("workforceUser");
    if (!storedUser) {
      router.replace("/");
      return;
    }

    const storedPrompt = window.localStorage.getItem(legacyWorkspacePromptKey) ?? "";
    const storedPromptId = window.localStorage.getItem(legacyWorkspacePromptIdKey) ?? "";
    const storedDatasetId = window.localStorage.getItem("workforceDatasetId") ?? "";
    let storedUserRecord: StoredWorkforceUser | null = null;
    try {
      storedUserRecord = JSON.parse(storedUser) as StoredWorkforceUser | null;
    } catch {
      window.localStorage.removeItem("workforceUser");
      router.replace("/");
      return;
    }
    const storedHandledPrompt = window.localStorage.getItem(`${legacyWorkspacePromptKey}:handled`) ?? "";
    const storedHandledPromptId = window.localStorage.getItem(legacyWorkspacePromptHandledIdKey) ?? "";
    const promptMarker = storedPromptId || storedPrompt;
    const handledMarker = storedPromptId ? storedHandledPromptId : storedHandledPrompt;
    const hasPendingPrompt = Boolean(storedPrompt && promptMarker !== handledMarker);

    datasetIdRef.current = storedDatasetId;
    setDatasetId(storedDatasetId);
    setSourceName(window.localStorage.getItem("workforceDatasetName") ?? "normalized dataset");
    setHandledPrompt(storedHandledPrompt);

    let cancelled = false;
    let pressTimer: number | null = null;
    let sendTimer: number | null = null;

    const hydrate = async () => {
      if (storedDatasetId) {
        try {
          if (!storedUserRecord?.userId || !(await isDatasetSchemaValidated(storedUserRecord.userId, storedDatasetId))) {
            router.replace("/validate");
            return;
          }
        } catch {
          router.replace("/validate");
          return;
        }
      }

      if (cancelled) return;
      setIsCheckingAccess(false);
      setIsLoadingConversations(true);
      try {
        const nextConversations = await fetchConversations();
        if (cancelled) return;

        if (hasPendingPrompt) {
          activeConversationIdRef.current = null;
          activeConversationDatasetIdRef.current = null;
          setActiveConversationId(null);
          setActiveConversationDatasetId(null);
          setMessages([]);
          setSelectedDetails(null);
        } else {
          const storedActiveConversationId = window.localStorage.getItem(activeConversationStorageKey(storedDatasetId));
          const nextActiveConversation =
            nextConversations.find((conversation) => conversation.id === storedActiveConversationId) ??
            nextConversations.find((conversation) => conversation.datasetId === storedDatasetId) ??
            null;

          if (nextActiveConversation) {
            await openConversation(nextActiveConversation.id);
          }
          return;
        }

        pendingHandoffIdRef.current = promptMarker;
        setChatInput(storedPrompt);
        pressTimer = window.setTimeout(() => setIsAutoSending(true), 420);
        sendTimer = window.setTimeout(() => {
          setChatInput("");
          setIsAutoSending(false);
          void submitMessage(storedPrompt, "handoff");
        }, 760);
      } finally {
        if (!cancelled) {
          setIsLoadingConversations(false);
        }
      }
    };

    void hydrate();

    return () => {
      cancelled = true;
      if (pressTimer) window.clearTimeout(pressTimer);
      if (sendTimer) window.clearTimeout(sendTimer);
    };
  }, [router]);

  const requestChatAnswer = async (message: string): Promise<WorkspaceChatPayload> => {
    const { userId, datasetId } = getWorkspaceIdentity();
    const currentConversationId = activeConversationIdRef.current;
    const currentConversationDatasetId = activeConversationDatasetIdRef.current;
    const targetDatasetId = currentConversationId ? currentConversationDatasetId || datasetId : datasetId;
    const response = await fetch("/api/workforce-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId,
        datasetId: targetDatasetId,
        conversationId: currentConversationId,
        message,
      }),
    });
    const payload = (await response.json()) as WorkspaceChatPayload;

    if (!response.ok || payload.status !== "success") {
      throw new Error(payload.error ?? "Failed to answer workforce question.");
    }

    return payload;
  };

  const submitMessage = async (message: string, idPrefix = "chat") => {
    const nextMessage = message.trim();
    if (!nextMessage || isThinking) return;
    const currentDatasetId = datasetIdRef.current || window.localStorage.getItem("workforceDatasetId") || "";
    const currentConversationDatasetId = activeConversationDatasetIdRef.current;
    if (!currentDatasetId && !currentConversationDatasetId) {
      setMessages((current) => [
        ...current,
        {
          id: `${idPrefix}-ai-upload-required-${Date.now()}`,
          role: "ai",
          text: "Upload a workforce workbook before starting a new chat. You can still open previous chats from history.",
        },
      ]);
      return;
    }

    setChatInput("");
    setSelectedDetails(null);
    setMessages((current) => [
      ...current,
      { id: `${idPrefix}-user-${Date.now()}`, role: "user", text: nextMessage },
    ]);
    setIsThinking(true);

    try {
      const payload = await requestChatAnswer(nextMessage);
      setIsThinking(false);
      if (payload.conversationId) {
        const { datasetId: storedDatasetId } = getWorkspaceIdentity();
        const targetDatasetId = activeConversationDatasetIdRef.current || storedDatasetId;
        activeConversationIdRef.current = payload.conversationId;
        activeConversationDatasetIdRef.current = targetDatasetId;
        setActiveConversationId(payload.conversationId);
        setActiveConversationDatasetId(targetDatasetId);
        window.localStorage.setItem(activeConversationStorageKey(targetDatasetId), payload.conversationId);
      }
      if (idPrefix === "handoff") {
        const handoffId = pendingHandoffIdRef.current || nextMessage;
        setHandledPrompt(nextMessage);
        window.localStorage.setItem(`${legacyWorkspacePromptKey}:handled`, nextMessage);
        window.localStorage.setItem(legacyWorkspacePromptHandledIdKey, handoffId);
        pendingHandoffIdRef.current = "";
      }
      setMessages((current) => [
        ...current,
        {
          id: `${idPrefix}-ai-${Date.now()}`,
          role: "ai",
          text: payload.message ?? "I prepared a workforce answer from the tool evidence.",
          detailView: payload.detailView ?? payload.details?.view ?? null,
          details: payload.details ?? null,
        },
      ]);
      setSelectedDetails(null);
      void fetchConversations();
    } catch (error) {
      setIsThinking(false);
      setMessages((current) => [
        ...current,
        {
          id: `${idPrefix}-ai-error-${Date.now()}`,
          role: "ai",
          text: error instanceof Error ? error.message : "Failed to answer workforce question.",
        },
      ]);
    }
  };

  const startNewConversation = () => {
    activeConversationIdRef.current = null;
    activeConversationDatasetIdRef.current = null;
    setActiveConversationId(null);
    setActiveConversationDatasetId(null);
    setMessages([]);
    setSelectedDetails(null);
    if (datasetId) {
      window.localStorage.removeItem(activeConversationStorageKey(datasetId));
    }
  };

  const deleteConversation = async (conversationId: string) => {
    const { userId } = getWorkspaceIdentity();
    if (!userId) return;

    const params = new URLSearchParams({ userId });
    const response = await fetch(`/api/workforce-chats/${encodeURIComponent(conversationId)}?${params.toString()}`, {
      method: "DELETE",
    });
    const payload = (await response.json()) as WorkspaceConversationDeletePayload;
    if (!response.ok || payload.status !== "success" || !payload.deletion) {
      throw new Error(payload.error ?? "Failed to delete chat.");
    }

    const deletedDatasetId = payload.deletion.datasetId;
    const isDeletingActiveConversation = activeConversationIdRef.current === conversationId;
    const activeConversationKey = activeConversationStorageKey(deletedDatasetId);
    if (window.localStorage.getItem(activeConversationKey) === conversationId || payload.deletion.datasetDeleted) {
      window.localStorage.removeItem(activeConversationKey);
    }

    if (isDeletingActiveConversation) {
      activeConversationIdRef.current = null;
      activeConversationDatasetIdRef.current = null;
      setActiveConversationId(null);
      setActiveConversationDatasetId(null);
      setMessages([]);
      setSelectedDetails(null);
    }

    if (payload.deletion.datasetDeleted) {
      const activeDatasetId = datasetIdRef.current || window.localStorage.getItem("workforceDatasetId") || "";
      if (activeDatasetId === deletedDatasetId) {
        datasetIdRef.current = "";
        setDatasetId("");
        setSourceName("normalized dataset");
        window.localStorage.removeItem("workforceDatasetId");
        window.localStorage.removeItem("workforceDatasetName");
        window.localStorage.removeItem("workforceDatasetSchemaValidated");
        window.localStorage.removeItem(legacyWorkspacePromptKey);
        window.localStorage.removeItem(legacyWorkspacePromptIdKey);
        window.localStorage.removeItem(`${legacyWorkspacePromptKey}:handled`);
        window.localStorage.removeItem(legacyWorkspacePromptHandledIdKey);
        window.dispatchEvent(new Event("workforce-dataset-changed"));
        router.replace("/?action=upload");
        return;
      }
    }

    await fetchConversations();
  };

  const sendMessage = () => {
    void submitMessage(chatInput);
  };

  const redirectToUpload = () => {
    router.push("/?action=upload");
  };

  const startNewChatOnSameData = () => {
    if (!datasetIdRef.current && !window.localStorage.getItem("workforceDatasetId")) {
      router.push("/?action=upload");
      return;
    }

    activeConversationIdRef.current = null;
    activeConversationDatasetIdRef.current = null;
    setActiveConversationId(null);
    setActiveConversationDatasetId(null);
    setMessages([]);
    setSelectedDetails(null);
    router.push("/ask");
  };

  const selectDetail = (_view: DashboardView | null, details?: WorkspaceAgentDetails | null) => {
    setSelectedDetails((current) => (current && details && current === details ? null : details ?? null));
  };

  const canSendMessage = Boolean(datasetId || activeConversationDatasetId);
  const needsDatasetForNewChat = !datasetId && !activeConversationId;

  if (isCheckingAccess) {
    return <div className="min-h-screen bg-[var(--home-bg)]" />;
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-[var(--home-bg)] text-[var(--home-text)]">
      <WorkforceParticleCanvas />
      <WorkspaceTopNav />

      <main className="relative z-10 mx-auto h-[calc(100vh-6rem)] w-full max-w-[126rem] px-6 pb-6 2xl:px-8">
        <ResizablePanelGroup orientation="horizontal" className="h-full min-h-0 overflow-hidden">
          <ResizablePanel
            defaultSize="23.75rem"
            minSize="23.75rem"
            maxSize="42rem"
            groupResizeBehavior="preserve-pixel-size"
            className="min-w-0 pr-2"
          >
            <WorkspaceChatPanel
              chatEndRef={chatEndRef}
              chatInput={chatInput}
              chatInputRef={chatInputRef}
              isAutoSending={isAutoSending}
              isThinking={isThinking}
              messages={messages}
              activeConversationId={activeConversationId}
              canSendMessage={canSendMessage}
              currentDatasetId={datasetId}
              conversations={conversations}
              needsDatasetForNewChat={needsDatasetForNewChat}
              selectedDetails={selectedDetails}
              isLoadingConversations={isLoadingConversations}
              sourceName={sourceName}
              onChatInputChange={setChatInput}
              onDeleteConversation={deleteConversation}
              onSelectDetail={selectDetail}
              onSelectConversation={(conversationId) => void openConversation(conversationId)}
              onStartNewChat={startNewChatOnSameData}
              onSendMessage={sendMessage}
              onUploadRequired={redirectToUpload}
            />
          </ResizablePanel>

          <ResizableHandle
            withHandle
            className="mx-2 w-3 rounded-full bg-transparent after:w-5 after:bg-transparent [&>div]:h-12 [&>div]:w-4 [&>div]:rounded-full [&>div]:border-brand [&>div]:bg-brand [&>div]:text-white [&>div]:shadow-lg [&>div]:shadow-black/10 dark:[&>div]:text-[var(--home-bg)]"
          />

          <ResizablePanel minSize="32rem" maxSize="80rem" className="min-w-0 pl-2">
            <motion.section
              className="smooth-chat-scroll h-full min-h-0 overflow-x-hidden overflow-y-auto rounded-2xl border border-[var(--home-border)] bg-[var(--home-panel)] shadow-2xl shadow-black/10 backdrop-blur"
              initial={{ opacity: 0, x: 48, scale: 0.98 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              transition={{ delay: 0.28, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            >
              <WorkspaceDetailPanel sourceName={sourceName} details={selectedDetails} />
            </motion.section>
          </ResizablePanel>
        </ResizablePanelGroup>
      </main>
    </div>
  );
}
