import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import useSWR from 'swr';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Info,
  Menu,
  PenLine,
  Plus,
  Trash2,
} from 'lucide-react';
import { api, ApiError, errorMessage, patch, post } from '../../lib/api';
import { formatNumber, modelName } from '../../lib/format';
import type {
  Conversation,
  ConversationDetail,
  RequestResult,
  SendResult,
  ChatConfig,
  ModelId,
} from '../../lib/types';
import {
  MODEL_PROVIDERS,
  PROVIDER_NAMES,
} from '../../../../backend/shared/models';
import {
  Brand,
  Dialog,
  ErrorNotice,
  Spinner,
  useToast,
} from '../../components/ui';
import { useAuth } from '../auth';
import { ThemeToggle, useMediaQuery } from '../theme';
import AssistantReply from './AssistantReply';
import Sidebar from './Sidebar';
import TokenPanel from './TokenPanel';
import { getPending, savePending, type PendingMessage } from './pending';

const detailKey = (id: string) => `/api/conversations/${id}?limit=30`;
export default function ChatPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: chatConfig } = useSWR<ChatConfig>('/api/chat/config');
  const [chosenModel, setChosenModel] = useState<ModelId>();
  const selectedModel =
    chosenModel && chatConfig?.model_allowlist.includes(chosenModel)
      ? chosenModel
      : chatConfig?.default_model;
  const [listRevision, setListRevision] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [transferredDraft, setTransferredDraft] = useState<{
    id: string;
    content: string;
  } | null>(null);
  const consumeDraft = useCallback(() => setTransferredDraft(null), []);
  const creatingRef = useRef(false);
  const refreshList = useCallback(
    async () => setListRevision((value) => value + 1),
    []
  );
  const create = useCallback(
    async (content?: string, sendImmediately = true, model?: ModelId) => {
      if (creatingRef.current) return false;
      creatingRef.current = true;
      setCreating(true);
      setError(null);
      try {
        const conversation = await post<Conversation>('/api/conversations', {
          title: 'Cuộc trò chuyện mới',
          ...((model ?? selectedModel)
            ? { model: model ?? selectedModel }
            : {}),
        });
        if (content && sendImmediately)
          savePending(user.id, conversation.id, {
            request_id: crypto.randomUUID(),
            content: content.trim(),
            phase: 'ready',
          });
        else if (content) setTransferredDraft({ id: conversation.id, content });
        navigate(`/chat/${conversation.id}`);
        setSidebarOpen(false);
        void refreshList();
        return true;
      } catch (e) {
        setError(e);
        return false;
      } finally {
        creatingRef.current = false;
        setCreating(false);
      }
    },
    [navigate, refreshList, user.id, selectedModel]
  );
  return (
    <div className="chat-shell">
      <a className="skip-link" href="#chat-main">
        Đến nội dung trò chuyện
      </a>
      {sidebarOpen && (
        <div
          className="sidebar-backdrop"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <Sidebar
        revision={listRevision}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        creating={creating}
        onNew={() => void create()}
      />
      <ChatWorkspace
        key={id ?? 'new'}
        id={id}
        onCreate={create}
        creating={creating}
        createError={error}
        onMenu={() => setSidebarOpen(true)}
        refreshList={refreshList}
        initialDraft={
          transferredDraft && transferredDraft.id === id
            ? transferredDraft.content
            : ''
        }
        onDraftConsumed={consumeDraft}
        chatConfig={chatConfig}
        selectedModel={selectedModel}
        onSelectModel={setChosenModel}
      />
    </div>
  );
}

function ChatWorkspace({
  id,
  onCreate,
  creating,
  createError,
  onMenu,
  refreshList,
  initialDraft,
  onDraftConsumed,
  chatConfig,
  selectedModel,
  onSelectModel,
}: {
  id?: string;
  onCreate: (
    content?: string,
    sendImmediately?: boolean,
    model?: ModelId
  ) => Promise<boolean>;
  creating: boolean;
  createError: unknown;
  onMenu: () => void;
  refreshList: () => Promise<unknown>;
  initialDraft: string;
  onDraftConsumed: () => void;
  chatConfig?: ChatConfig;
  selectedModel?: ModelId;
  onSelectModel: (model: ModelId) => void;
}) {
  const { user, logout } = useAuth();
  const compact = useMediaQuery('(max-width: 800px)');
  const [signingOut, setSigningOut] = useState(false);
  const notify = useToast();
  const navigate = useNavigate();
  const { data, error, isLoading, mutate } = useSWR<ConversationDetail>(
    id ? detailKey(id) : null,
    {
      refreshInterval: (latest) =>
        latest?.conversation.status === 'processing'
          ? 2000
          : latest?.conversation.status === 'usage_pending'
            ? 15_000
            : 30_000,
    }
  );
  const conversation = data?.conversation;
  const [pending, setPending] = useState<PendingMessage | null>(() =>
    id ? getPending(user.id, id) : null
  );
  const [draft, setDraft] = useState(initialDraft);
  useEffect(() => {
    if (initialDraft) onDraftConsumed();
  }, [initialDraft, onDraftConsumed]);
  const [sendError, setSendError] = useState<unknown>(null);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const initialSend = useRef(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [dialog, setDialog] = useState<
    'info' | 'rename' | 'delete' | 'limit' | null
  >(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogError, setDialogError] = useState<unknown>(null);
  const [editValue, setEditValue] = useState('');
  const [older, setOlder] = useState<ConversationDetail['messages']['items']>(
    []
  );
  const [nextBefore, setNextBefore] = useState<number | null | undefined>(
    undefined
  );
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState<unknown>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [revealingMessageId, setRevealingMessageId] = useState<string | null>(
    null
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const nearBottom = useRef(true);
  const [showScroll, setShowScroll] = useState(false);
  const messages = [
    ...new Map(
      [...older, ...(data?.messages.items ?? [])].map((message) => [
        message.sequence,
        message,
      ])
    ).values(),
  ].sort((a, b) => a.sequence - b.sequence);
  const blocked = !!conversation && conversation.status !== 'active';
  const isBusy = sending || !!pending || conversation?.status === 'processing';
  const bytes = new TextEncoder().encode(draft.trim()).length;
  const maxBytes = conversation?.max_input_bytes ?? 65536;
  const tooLong = bytes > maxBytes;
  const pollingId = pending?.server_id ?? conversation?.active_request_id;
  const { data: requestResult } = useSWR<RequestResult>(
    pollingId ? `/api/requests/${pollingId}` : null,
    {
      refreshInterval: (latest) => (latest?.status === 'processing' ? 2000 : 0),
    }
  );
  const updatePending = useCallback(
    (next: PendingMessage | null) => {
      setPending(next);
      if (id) savePending(user.id, id, next);
    },
    [id, user.id]
  );
  const moveToNewConversation = useCallback(
    (content?: string) => {
      void onCreate(content, false, conversation?.model).then((created) => {
        if (created) notify('Phiên cũ đã hết token. Đã mở phiên mới.');
      });
    },
    [conversation?.model, notify, onCreate]
  );
  const scrollBottom = useCallback(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
    nearBottom.current = true;
    setShowScroll(false);
  }, []);
  const followReply = useCallback(() => {
    const element = scrollRef.current;
    if (element && nearBottom.current) element.scrollTop = element.scrollHeight;
  }, []);
  const finishReveal = useCallback((messageId: string) => {
    setRevealingMessageId((current) =>
      current === messageId ? null : current
    );
  }, []);

  useEffect(() => {
    const setConnection = () => setOnline(navigator.onLine);
    window.addEventListener('online', setConnection);
    window.addEventListener('offline', setConnection);
    return () => {
      window.removeEventListener('online', setConnection);
      window.removeEventListener('offline', setConnection);
    };
  }, []);
  useEffect(() => {
    if (nearBottom.current) scrollBottom();
  }, [
    data?.messages.items.at(-1)?.id,
    pending?.request_id,
    conversation?.status,
    scrollBottom,
  ]);
  useEffect(() => {
    if (data?.messages.items.length)
      setOlder((existing) => [
        ...new Map(
          [...existing, ...data.messages.items].map((message) => [
            message.sequence,
            message,
          ])
        ).values(),
      ]);
  }, [data?.messages.items]);
  useEffect(() => {
    const textarea = inputRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
    }
  }, [draft, compact]);
  useEffect(() => {
    if (!requestResult || requestResult.status === 'processing') return;
    void mutate();
    void refreshList();
    if (pending && pending.request_id === requestResult.client_request_id) {
      if (requestResult.status === 'completed') {
        if (
          requestResult.message &&
          !data?.messages.items.some((m) => m.id === requestResult.message?.id)
        )
          setRevealingMessageId(requestResult.message.id);
        updatePending(null);
        setDraft('');
        setSendError(null);
        if (requestResult.conversation.status === 'limit_reached')
          moveToNewConversation();
      } else {
        setDraft(pending.content);
        updatePending(null);
        if (
          [
            'INSUFFICIENT_TOKEN_BUDGET',
            'SESSION_TOKEN_LIMIT_EXCEEDED',
          ].includes(requestResult.error_code ?? '')
        ) {
          setSendError(null);
          moveToNewConversation(pending.content);
        } else {
          setSendError(
            new ApiError(
              409,
              requestResult.error_code ?? 'USAGE_PENDING',
              'Lượt chat chưa hoàn tất. Hãy kiểm tra trạng thái phiên.'
            )
          );
        }
      }
    }
  }, [
    requestResult,
    pending,
    mutate,
    refreshList,
    updatePending,
    moveToNewConversation,
  ]);

  async function send(item?: PendingMessage) {
    if (!id || sendingRef.current) return;
    const attempt = item ?? {
      request_id: crypto.randomUUID(),
      content: draft.trim(),
      phase: 'sending' as const,
    };
    if (!attempt.content) return;
    sendingRef.current = true;
    setSending(true);
    setSendError(null);
    updatePending({ ...attempt, phase: 'sending' });
    try {
      const result = await post<SendResult>(
        `/api/conversations/${id}/messages`,
        { request_id: attempt.request_id, content: attempt.content }
      );
      if (!data?.messages.items.some((m) => m.id === result.message.id))
        setRevealingMessageId(result.message.id);
      await mutate(
        (latest) =>
          latest
            ? {
                ...latest,
                conversation: result.conversation,
                messages: {
                  ...latest.messages,
                  items: latest.messages.items.some(
                    (m) => m.id === result.message.id
                  )
                    ? latest.messages.items
                    : [
                        ...latest.messages.items,
                        {
                          id: `optimistic-${attempt.request_id}`,
                          conversation_id: id,
                          request_id: result.request_id,
                          sequence: result.message.sequence - 1,
                          role: 'user',
                          content: attempt.content,
                          created_at: result.message.created_at,
                        },
                        result.message,
                      ],
                },
              }
            : latest,
        { revalidate: false }
      );
      updatePending(null);
      setDraft('');
      void mutate();
      void refreshList();
      followReply();
      if (result.conversation.status === 'limit_reached')
        moveToNewConversation();
    } catch (e) {
      setSendError(e);
      if (
        e instanceof ApiError &&
        (e.status === 0 ||
          ['INTERNAL_ERROR', 'HTTP_ERROR', 'INVALID_RESPONSE'].includes(e.code))
      ) {
        updatePending({ ...attempt, phase: 'uncertain' });
      } else if (e instanceof ApiError && e.code === 'REQUEST_IN_PROGRESS') {
        updatePending({
          ...attempt,
          phase: 'waiting',
          server_id:
            typeof e.details.request_id === 'string'
              ? e.details.request_id
              : undefined,
        });
      } else {
        updatePending(null);
        setDraft(attempt.content);
        if (
          e instanceof ApiError &&
          [
            'INSUFFICIENT_TOKEN_BUDGET',
            'SESSION_TOKEN_LIMIT_EXCEEDED',
          ].includes(e.code)
        ) {
          setSendError(null);
          moveToNewConversation(attempt.content);
        } else {
          setSendError(e);
        }
      }
      void mutate();
      void refreshList();
    } finally {
      sendingRef.current = false;
      setSending(false);
      inputRef.current?.focus();
    }
  }
  useEffect(() => {
    if (pending?.phase === 'ready' && data && !initialSend.current) {
      initialSend.current = true;
      void send(pending);
    }
    // Initial send is keyed by the stored UUID. StrictMode and reconnects reuse that UUID.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, pending?.phase]);
  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!draft.trim() || tooLong || !online || isBusy || blocked || creating)
      return;
    if (!id) {
      await onCreate(draft);
      return;
    }
    await send();
  }
  async function loadOlder() {
    const before =
      nextBefore === undefined ? data?.messages.next_before : nextBefore;
    if (!before || !id) return;
    setLoadingOlder(true);
    setOlderError(null);
    const height = scrollRef.current?.scrollHeight ?? 0;
    try {
      const page = await api<ConversationDetail>(
        `${detailKey(id)}&before=${before}`
      );
      nearBottom.current = false;
      setOlder((items) => [...page.messages.items, ...items]);
      setNextBefore(page.messages.next_before);
      requestAnimationFrame(() => {
        if (scrollRef.current)
          scrollRef.current.scrollTop +=
            scrollRef.current.scrollHeight - height;
      });
    } catch (e) {
      setOlderError(e);
    } finally {
      setLoadingOlder(false);
    }
  }
  function openDialog(next: typeof dialog) {
    setDialogError(null);
    setEditValue(
      next === 'rename'
        ? (conversation?.title ?? '')
        : String(conversation?.token_limit ?? 2000)
    );
    setDialog(next);
  }
  async function saveDialog(event: FormEvent) {
    event.preventDefault();
    if (!id || dialogBusy) return;
    setDialogBusy(true);
    setDialogError(null);
    try {
      if (dialog === 'delete') {
        await api(`/api/conversations/${id}`, { method: 'DELETE' });
        savePending(user.id, id, null);
        navigate('/chat');
        notify('Đã xóa cuộc trò chuyện');
      } else if (dialog === 'rename') {
        await patch(`/api/conversations/${id}`, { title: editValue.trim() });
        await mutate();
        notify('Đã đổi tên cuộc trò chuyện');
      } else if (dialog === 'limit') {
        await patch(`/api/admin/conversations/${id}/limit`, {
          token_limit: Number(editValue),
        });
        await mutate();
        notify('Đã đổi hạn mức phiên');
      }
      setDialog(null);
      void refreshList();
    } catch (e) {
      setDialogError(e);
    } finally {
      setDialogBusy(false);
    }
  }
  async function archive() {
    if (!id) return;
    try {
      await patch(`/api/conversations/${id}`, {
        archived: conversation?.status !== 'archived',
      });
      await mutate();
      void refreshList();
      notify(
        conversation?.status === 'archived'
          ? 'Đã khôi phục cuộc trò chuyện'
          : 'Đã lưu trữ cuộc trò chuyện'
      );
    } catch (e) {
      setSendError(e);
    }
  }
  const copy = useCallback(
    async (messageId: string, content: string) => {
      try {
        await navigator.clipboard.writeText(content);
        setCopied(messageId);
        notify('Đã sao chép câu trả lời');
      } catch {
        notify(
          'Trình duyệt chưa cho phép sao chép. Hãy chọn nội dung để sao chép.'
        );
      }
    },
    [notify]
  );
  const pendingVisible =
    pending &&
    !messages.some(
      (m) => m.request_id === pending.server_id && m.role === 'user'
    );
  return (
    <>
      <main className="chat-main" id="chat-main">
        <header className="chat-header">
          <button
            className="icon-button mobile-only"
            aria-label="Mở lịch sử trò chuyện"
            onClick={onMenu}
          >
            <Menu size={21} />
          </button>
          <h1 className="reference-greeting">Xin chào, {user.display_name}</h1>
          <button
            className="header-budget"
            onClick={() => openDialog('info')}
            aria-label="Thông tin và hạn mức phiên"
          >
            <span className="header-budget-track" aria-hidden="true">
              <span
                style={{
                  width:
                    Math.min(
                      100,
                      ((conversation?.used_total_tokens ?? 0) /
                        (conversation?.token_limit ??
                          chatConfig?.default_token_limit ??
                          2000)) *
                        100
                    ) + '%',
                }}
              />
            </span>
            <span>
              {conversation?.used_total_tokens ?? 0}/
              {conversation?.token_limit ??
                chatConfig?.default_token_limit ??
                2000}{' '}
              token
            </span>
          </button>
          <div className="header-actions">
            <ThemeToggle />
            <button
              className="text-button sign-out"
              disabled={signingOut}
              onClick={async () => {
                setSigningOut(true);
                try {
                  await logout();
                } catch (e) {
                  notify(errorMessage(e));
                  setSigningOut(false);
                }
              }}
            >
              {signingOut ? 'Đang thoát…' : 'Đăng xuất'}
            </button>
          </div>
        </header>
        {!id && chatConfig && (
          <div className="chat-model-picker">
            <label htmlFor="chat-model">Model cho phiên mới</label>
            <select
              id="chat-model"
              value={selectedModel}
              disabled={creating}
              onChange={(event) => onSelectModel(event.target.value as ModelId)}
            >
              {chatConfig.model_allowlist.map((model) => (
                <option key={model} value={model}>
                  {PROVIDER_NAMES[MODEL_PROVIDERS[model]]} ·{' '}
                  {model === 'byteplus/configured'
                    ? chatConfig.byteplus_model || 'Chưa điền model'
                    : modelName(model)}
                </option>
              ))}
            </select>
          </div>
        )}
        <div
          className="conversation-scroll"
          ref={scrollRef}
          onScroll={() => {
            const el = scrollRef.current;
            if (el) {
              nearBottom.current =
                el.scrollHeight - el.scrollTop - el.clientHeight < 90;
              setShowScroll(!nearBottom.current);
            }
          }}
        >
          <div className="conversation-content">
            {isLoading && <Spinner label="Đang tải cuộc trò chuyện" />}
            {!!error && (
              <ErrorNotice error={error} retry={() => void mutate()} />
            )}{' '}
            {!isLoading &&
              !error &&
              messages.length === 0 &&
              !pending &&
              (!conversation || conversation.status === 'active') && (
                <section className="reference-welcome">
                  <h2>Mình có thể giúp gì cho bạn?</h2>
                </section>
              )}{' '}
            {(nextBefore === undefined
              ? data?.messages.next_before
              : nextBefore) != null && (
              <button
                className="button secondary older-button"
                disabled={loadingOlder}
                onClick={() => void loadOlder()}
              >
                <ChevronDown size={16} />
                {loadingOlder ? 'Đang tải…' : 'Tải tin nhắn trước đó'}
              </button>
            )}
            {!!olderError && (
              <ErrorNotice error={olderError} retry={() => void loadOlder()} />
            )}
            <div
              className="messages"
              aria-label="Nội dung cuộc trò chuyện"
              aria-live="polite"
              aria-relevant="additions"
            >
              {messages.map((message) =>
                message.role === 'assistant' ? (
                  <AssistantReply
                    key={message.id}
                    message={message}
                    animate={revealingMessageId === message.id}
                    copied={copied === message.id}
                    onCopy={copy}
                    onProgress={followReply}
                    onComplete={finishReveal}
                  />
                ) : (
                  <article className="message user" key={message.id}>
                    <div className="message-body">
                      <p>{message.content}</p>
                    </div>
                  </article>
                )
              )}
              {pendingVisible && (
                <article className="message user pending-message">
                  <div className="message-body">
                    <p>{pending.content}</p>
                  </div>
                  <small>
                    {pending.phase === 'uncertain'
                      ? 'Chưa xác nhận kết quả'
                      : 'Đang gửi'}
                  </small>
                </article>
              )}
              {(sending || conversation?.status === 'processing') && (
                <div className="thinking" role="status">
                  <Brand compact />
                  <span>Đang chuẩn bị câu trả lời</span>
                  <span className="thinking-dots">
                    <i />
                    <i />
                    <i />
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
        {showScroll && (
          <button
            className="scroll-bottom icon-button"
            onClick={scrollBottom}
            aria-label="Đến tin nhắn mới nhất"
          >
            <ArrowDown size={19} />
          </button>
        )}
        <div className="composer-area">
          {!online && (
            <div className="notice warning" role="status">
              Bạn đang mất kết nối. Tin nhắn chưa được gửi.
            </div>
          )}
          {!!createError && <ErrorNotice error={createError} />}{' '}
          {!!sendError &&
            !['limit_reached', 'usage_pending'].includes(
              conversation?.status ?? ''
            ) && <ErrorNotice error={sendError} />}{' '}
          {pending &&
            !sending &&
            !['processing', 'usage_pending', 'limit_reached'].includes(
              conversation?.status ?? ''
            ) && (
              <div className="notice warning">
                <div>
                  Kiểm tra lượt gửi trước khi tiếp tục. Hệ thống sẽ dùng lại mã
                  gửi để tránh tính token hai lần.
                  <button
                    className="text-button"
                    disabled={!online}
                    onClick={() => void send(pending)}
                  >
                    Kiểm tra kết quả
                  </button>
                </div>
              </div>
            )}
          {conversation &&
          ['limit_reached', 'usage_pending'].includes(conversation.status) ? (
            <div className="locked-composer">
              <div>
                <span className="lock-icon">
                  <Info size={20} />
                </span>
                <div>
                  <strong>
                    {conversation.status === 'limit_reached'
                      ? conversation.used_total_tokens >=
                        conversation.token_limit
                        ? 'Phiên đã chạm giới hạn'
                        : 'Phiên cần được bắt đầu lại'
                      : 'Phiên đang chờ xác nhận token'}
                  </strong>
                  <p>
                    {sendError
                      ? errorMessage(sendError)
                      : conversation.status === 'limit_reached'
                        ? 'Lịch sử vẫn được giữ lại. Bắt đầu phiên mới để tiếp tục.'
                        : 'Chưa xác nhận được số token của lượt chat. Tạo phiên mới để tiếp tục; quản trị viên sẽ đối soát phiên này.'}
                  </p>
                </div>
              </div>
              <button
                className="button"
                disabled={creating}
                onClick={() => void onCreate(draft.trim() || undefined, false)}
              >
                <Plus size={17} />
                Tạo phiên mới
              </button>
            </div>
          ) : conversation?.status === 'archived' ? (
            <div className="locked-composer">
              <p>Cuộc trò chuyện đã được lưu trữ.</p>
              <button
                className="button secondary"
                onClick={() => void archive()}
              >
                Khôi phục cuộc trò chuyện
              </button>
            </div>
          ) : (
            <form
              className={`composer ${tooLong ? 'invalid' : ''}`}
              onSubmit={submit}
            >
              <label className="sr-only" htmlFor="message-input">
                Tin nhắn của bạn
              </label>
              <textarea
                id="message-input"
                ref={inputRef}
                rows={1}
                placeholder={
                  isBusy
                    ? 'Chờ lượt chat hiện tại hoàn tất…'
                    : compact
                      ? 'Nhập tin nhắn...'
                      : 'Nhập tin nhắn... (Shift+Enter để xuống dòng)'
                }
                value={draft}
                disabled={
                  blocked ||
                  !!pending ||
                  creating ||
                  !!error ||
                  (!!id && !conversation)
                }
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    e.key === 'Enter' &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    void submit();
                  }
                }}
              />
              <button
                className="send-button"
                type="submit"
                aria-label="Gửi tin nhắn"
                disabled={
                  !draft.trim() ||
                  isBusy ||
                  blocked ||
                  tooLong ||
                  !online ||
                  creating ||
                  !!error ||
                  (!!id && !conversation)
                }
              >
                <ArrowUp size={22} />
              </button>
              {tooLong && (
                <span className="input-error">
                  {formatNumber(bytes)} / {formatNumber(maxBytes)} byte
                </span>
              )}
            </form>
          )}
        </div>
      </main>
      {dialog && (
        <Dialog
          title={
            {
              info: 'Thông tin phiên',
              rename: 'Đổi tên cuộc trò chuyện',
              delete: 'Xóa cuộc trò chuyện?',
              limit: 'Đổi hạn mức phiên',
            }[dialog]
          }
          onClose={() => {
            if (!dialogBusy) setDialog(null);
          }}
        >
          {dialog === 'info' ? (
            <>
              <TokenPanel
                conversation={conversation}
                mode={data?.token_count_mode}
                estimate={data?.budget_estimate}
                model={selectedModel}
                onEdit={() => openDialog('limit')}
              />
              {chatConfig && (
                <div className="field next-model-field">
                  <label htmlFor="next-chat-model">Model cho phiên mới</label>
                  <select
                    id="next-chat-model"
                    value={selectedModel}
                    disabled={creating}
                    onChange={(event) =>
                      onSelectModel(event.target.value as ModelId)
                    }
                  >
                    {chatConfig.model_allowlist.map((model) => (
                      <option key={model} value={model}>
                        {PROVIDER_NAMES[MODEL_PROVIDERS[model]]} ·{' '}
                        {model === 'byteplus/configured'
                          ? chatConfig.byteplus_model || 'Chưa điền model'
                          : modelName(model)}
                      </option>
                    ))}
                  </select>
                  <button
                    className="button secondary"
                    disabled={creating}
                    onClick={() => {
                      setDialog(null);
                      void onCreate();
                    }}
                  >
                    Tạo phiên mới
                  </button>
                </div>
              )}
              {conversation?.provider_model && (
                <p className="provider-model-name">
                  Model của phiên: {conversation.provider_model}
                </p>
              )}
              {conversation && (
                <div className="dialog-actions">
                  <button
                    className="button secondary"
                    disabled={isBusy}
                    onClick={() => openDialog('rename')}
                  >
                    <PenLine size={16} />
                    Đổi tên
                  </button>
                  <button
                    className="button secondary"
                    disabled={isBusy || conversation.status === 'usage_pending'}
                    onClick={() => openDialog('delete')}
                  >
                    <Trash2 size={16} />
                    Xóa phiên
                  </button>
                  {['active', 'archived'].includes(conversation.status) && (
                    <button
                      className="button secondary"
                      disabled={isBusy}
                      onClick={() => {
                        void archive();
                        setDialog(null);
                      }}
                    >
                      {conversation.status === 'archived'
                        ? 'Khôi phục phiên'
                        : 'Lưu trữ phiên'}
                    </button>
                  )}
                </div>
              )}
            </>
          ) : (
            <form onSubmit={saveDialog}>
              {dialog === 'delete' ? (
                <p>
                  Lịch sử và nội dung của phiên sẽ bị xóa. Bạn không thể khôi
                  phục cuộc trò chuyện này.
                </p>
              ) : (
                <label className="field">
                  <span>
                    {dialog === 'rename'
                      ? 'Tên cuộc trò chuyện'
                      : 'Số token tối đa'}
                  </span>
                  <input
                    autoFocus
                    required
                    type={dialog === 'limit' ? 'number' : 'text'}
                    min={dialog === 'limit' ? 1 : undefined}
                    max={dialog === 'limit' ? 1000000 : undefined}
                    maxLength={dialog === 'rename' ? 120 : undefined}
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                  />
                  {dialog === 'limit' && (
                    <small>
                      Giảm hạn mức xuống bằng hoặc thấp hơn{' '}
                      {formatNumber(conversation?.used_total_tokens)} token đã
                      dùng sẽ khóa phiên. Phiên đã khóa cần tạo mới.
                    </small>
                  )}
                </label>
              )}
              {!!dialogError && <ErrorNotice error={dialogError} />}
              <div className="dialog-actions">
                <button
                  type="button"
                  className="button secondary"
                  disabled={dialogBusy}
                  onClick={() => setDialog(null)}
                >
                  Hủy
                </button>
                <button
                  className={`button ${dialog === 'delete' ? 'danger' : ''}`}
                  disabled={dialogBusy}
                >
                  {dialogBusy
                    ? 'Đang lưu…'
                    : dialog === 'delete'
                      ? 'Xóa cuộc trò chuyện'
                      : 'Lưu thay đổi'}
                </button>
              </div>
            </form>
          )}
        </Dialog>
      )}
    </>
  );
}
