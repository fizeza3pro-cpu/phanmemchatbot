export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details: Record<string, unknown> = {},
    public requestId?: string
  ) {
    super(message);
  }
}

export async function api<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...options,
      credentials: 'same-origin',
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
      signal: options.signal ?? AbortSignal.timeout(90_000),
    });
  } catch {
    throw new ApiError(
      0,
      'NETWORK_ERROR',
      'Chưa nhận được phản hồi từ máy chủ. Kiểm tra kết nối và thử lại.'
    );
  }
  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    if (
      response.status === 401 &&
      !path.startsWith('/api/auth') &&
      path !== '/api/me'
    ) {
      window.dispatchEvent(new Event('auth-expired'));
    }
    throw new ApiError(
      response.status,
      payload?.error?.code ?? 'HTTP_ERROR',
      payload?.error?.message ?? 'Máy chủ chưa sẵn sàng. Vui lòng thử lại.',
      payload?.error?.details ?? {},
      payload?.error?.request_id
    );
  }
  if (!payload || !Object.hasOwn(payload, 'data'))
    throw new ApiError(
      502,
      'INVALID_RESPONSE',
      'Phản hồi từ máy chủ không hợp lệ.'
    );
  return payload.data as T;
}
export const post = <T>(path: string, body: unknown) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(body) });
export const patch = <T>(path: string, body: unknown) =>
  api<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
export function errorMessage(error: unknown): string {
  if (!(error instanceof ApiError))
    return error instanceof Error
      ? error.message
      : 'Có lỗi xảy ra. Vui lòng thử lại.';
  if (
    error.code === 'INSUFFICIENT_TOKEN_BUDGET' &&
    typeof error.details.remaining_tokens === 'number' &&
    typeof error.details.preflight_input_tokens === 'number'
  ) {
    const fmt = new Intl.NumberFormat('vi-VN');
    return `Còn ${fmt.format(error.details.remaining_tokens)} token; câu hỏi và lịch sử cần khoảng ${fmt.format(error.details.preflight_input_tokens)} token đầu vào. Chưa đủ chỗ cho câu trả lời. Bạn có thể rút gọn câu hỏi hoặc tạo phiên mới; phiên này chưa bị khóa.`;
  }
  const messages: Record<string, string> = {
    AI_NOT_CONFIGURED:
      'Dịch vụ AI chưa được cấu hình. Quản trị viên cần thêm thông tin Cloudflare để bắt đầu trả lời.',
    GROQ_NOT_CONFIGURED:
      'Groq chưa được cấu hình. Quản trị viên cần thêm API key Groq trên máy chủ.',
    AUTH_NOT_CONFIGURED:
      'Đăng nhập Google chưa được cấu hình. Liên hệ quản trị viên để kích hoạt.',
    USAGE_PENDING:
      'Phiên đang chờ xác nhận token từ nhà cung cấp. Hãy tạo phiên mới để tiếp tục.',
    INSUFFICIENT_TOKEN_BUDGET:
      'Token còn lại chưa đủ cho câu hỏi và lịch sử này. Hãy rút gọn câu hỏi hoặc tạo phiên mới. Phiên chưa bị khóa.',
    SESSION_TOKEN_LIMIT_EXCEEDED:
      'Phiên đã chạm hạn mức token. Hãy tạo phiên mới để tiếp tục.',
    AI_USAGE_MISMATCH:
      'Usage từ nhà cung cấp không hợp lệ. Phiên đã được khóa; hãy tạo phiên mới.',
    AI_EMPTY_RESPONSE:
      'Model chưa tạo câu trả lời hiển thị. Token thực tế đã được tính; bạn có thể sửa câu hỏi và gửi lại nếu phiên còn ngân sách.',
    REQUEST_IN_PROGRESS: 'Phiên đang xử lý một tin nhắn. Vui lòng chờ kết quả.',
    RATE_LIMITED: `Bạn đang gửi quá nhanh. Thử lại sau ${Number(error.details.retry_after_seconds) || 60} giây.`,
    INPUT_TOO_LARGE: 'Tin nhắn quá dài. Hãy rút gọn nội dung trước khi gửi.',
    ACCOUNT_BLOCKED:
      'Tài khoản đã bị tạm khóa. Liên hệ quản trị viên để được hỗ trợ.',
    LAST_ADMIN: 'Cần giữ ít nhất một quản trị viên đang hoạt động.',
    AI_UNAVAILABLE: 'Dịch vụ AI đang không khả dụng. Bạn có thể gửi lại sau.',
    AI_RATE_LIMITED:
      'Nhà cung cấp AI đang giới hạn lượt gọi. Vui lòng thử lại sau.',
    MODEL_DISABLED:
      'Model của phiên đã bị tắt. Hãy tạo phiên mới để dùng cấu hình hiện tại.',
  };
  return messages[error.code] ?? error.message;
}
