import { Copy, Info, LockKeyhole, SlidersHorizontal } from 'lucide-react';
import type {
  Conversation,
  ConversationDetail,
  ModelId,
} from '../../lib/types';
import {
  MODEL_PROVIDERS,
  PROVIDER_NAMES,
} from '../../../../backend/shared/models';
import { formatNumber, modelName, stateName } from '../../lib/format';
import { useAuth } from '../auth';
import { useToast } from '../../components/ui';

export default function TokenPanel({
  conversation,
  mode,
  estimate,
  model,
  onEdit,
}: {
  conversation?: Conversation;
  mode?: string;
  estimate?: ConversationDetail['budget_estimate'];
  model?: ModelId;
  onEdit?: () => void;
}) {
  const { user } = useAuth();
  const notify = useToast();
  async function copyId() {
    if (!conversation) return;
    try {
      await navigator.clipboard.writeText(conversation.id);
      notify('Đã sao chép ID phiên');
    } catch {
      notify('Trình duyệt chưa cho phép sao chép ID phiên.');
    }
  }
  const ratio = conversation
    ? Math.min(1, conversation.used_total_tokens / conversation.token_limit)
    : 0;
  const locked = conversation?.requires_new_conversation;
  const activeModel = conversation?.model ?? model;
  const provider = activeModel ? MODEL_PROVIDERS[activeModel] : 'cloudflare';
  return (
    <div className="token-panel">
      <div className="panel-heading">
        <h2>Thông tin phiên</h2>
        <Info size={17} />
      </div>
      <section className="budget">
        <span className="muted">Ngân sách token</span>
        {conversation ? (
          <>
            <div className="budget-number">
              <strong>{formatNumber(conversation.remaining_tokens)}</strong>
              <span>còn lại</span>
            </div>
            <div
              className={`budget-meter ${ratio > 0.85 ? 'warning' : ''}`}
              role="progressbar"
              aria-label="Token đã sử dụng"
              aria-valuemin={0}
              aria-valuemax={conversation.token_limit}
              aria-valuenow={Math.min(
                conversation.used_total_tokens,
                conversation.token_limit
              )}
              aria-valuetext={`${formatNumber(conversation.used_total_tokens)} trên ${formatNumber(conversation.token_limit)} token`}
            >
              {Array.from({ length: 24 }, (_, i) => (
                <span key={i} className={i / 24 < ratio ? 'filled' : ''} />
              ))}
            </div>
            <div className="budget-caption">
              <span>
                Đã dùng {formatNumber(conversation.used_total_tokens)}
              </span>
              <span>/ {formatNumber(conversation.token_limit)}</span>
            </div>
          </>
        ) : (
          <>
            <div className="budget-placeholder">
              Một phiên mới,
              <br />
              một khởi đầu mới.
            </div>
            <p className="small muted">
              Hạn mức được hiển thị khi bạn tạo phiên.
            </p>
          </>
        )}
      </section>
      {conversation && (
        <>
          <dl className="token-details">
            <div>
              <dt>Token đầu vào</dt>
              <dd>{formatNumber(conversation.used_input_tokens)}</dd>
            </div>
            <div>
              <dt>Token đầu ra</dt>
              <dd>{formatNumber(conversation.used_output_tokens)}</dd>
            </div>
            <div>
              <dt>Trạng thái</dt>
              <dd>
                <span className={`status-dot ${conversation.status}`} />
                {stateName(conversation.status)}
              </dd>
            </div>
            <div>
              <dt>Model</dt>
              <dd>
                {conversation.provider_model || modelName(conversation.model)}
              </dd>
            </div>
            {user.role === 'admin' && (
              <div>
                <dt>ID phiên</dt>
                <dd>
                  <span title={conversation.id}>
                    {conversation.id.slice(0, 8)}
                  </span>
                  <button
                    className="copy-id"
                    aria-label="Sao chép ID phiên"
                    onClick={() => void copyId()}
                  >
                    <Copy size={12} />
                  </button>
                </dd>
              </div>
            )}
          </dl>
          {estimate && conversation.status === 'active' && (
            <div className="next-budget">
              <span>Đầu vào lượt tiếp theo</span>
              <strong>~{formatNumber(estimate.next_input_tokens)} token</strong>
              <p>Gồm hướng dẫn AI và lịch sử, chưa tính câu hỏi mới.</p>
              {estimate.available_output_tokens === 0 && (
                <p className="warning-text">
                  Lượt tiếp theo không còn đủ chỗ cho câu trả lời. Tạo phiên mới
                  để tiếp tục với ngân sách đầy đủ.
                </p>
              )}
            </div>
          )}
          {user.role === 'admin' && onEdit && (
            <button
              className="button secondary full-width"
              disabled={
                conversation.status !== 'active' ||
                !!conversation.active_request_id
              }
              onClick={onEdit}
            >
              <SlidersHorizontal size={16} />
              Đổi hạn mức phiên
            </button>
          )}
        </>
      )}
      <div className="token-explanation">
        <LockKeyhole size={19} />
        <h3>Trò chuyện có giới hạn rõ ràng</h3>
        <p>
          Token tính cả câu hỏi, lịch sử gửi lại và câu trả lời. Khi ngân sách
          của lượt này không đủ, câu hỏi bị từ chối; bạn có thể rút gọn hoặc tạo
          phiên mới. Phiên khóa khi đã chạm hạn mức.
        </p>
        {mode === 'conservative' && provider === 'cloudflare' && (
          <p className="small">
            Chế độ bảo thủ dự trù đầu vào theo byte UTF-8, nên có thể từ chối
            lượt chat sớm dù phiên vẫn còn token.
          </p>
        )}
        {mode === 'verified' && provider === 'cloudflare' && (
          <p className="small">
            Đầu vào được dự trù bằng tokenizer Llama và 2 token dự phòng. Số đã
            dùng được tính theo usage thực tế từ Cloudflare.
          </p>
        )}
        {provider === 'groq' && (
          <p className="small">
            GPT‑OSS dùng tokenizer Harmony. Token đầu ra gồm cả phần suy luận;
            usage Groq là số thực tế được tính vào hạn mức.
          </p>
        )}
        {provider === 'byteplus' && (
          <p className="small">
            Đếm nội dung đầu vào bằng Tokenization API của BytePlus, cộng dự
            phòng cho khuôn hội thoại. Usage thực tế gồm cả suy luận quyết định
            số token đã dùng. Không gọi API khi chỉ mở lịch sử.
          </p>
        )}
        {locked && (
          <p className="small">
            Phiên đã khóa sẽ giữ lại lịch sử và không thể mở lại bằng cách tăng
            hạn mức.
          </p>
        )}
      </div>
      <div className="provider-note">
        <span className="provider-symbol">☁</span>
        <div>
          {PROVIDER_NAMES[provider]}
          <span>Phản hồi được kiểm tra trước khi hiển thị</span>
        </div>
      </div>
    </div>
  );
}
