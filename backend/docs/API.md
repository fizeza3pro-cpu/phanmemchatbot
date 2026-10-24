# Backend API contract

Base URL local: `http://localhost:8787`, hoặc `/api` qua Vite tại `http://localhost:5173`. Prefix `/api`. API trả JSON và không streaming trong bản đầu. Các thao tác ghi local yêu cầu `Origin: http://localhost:5173` theo cấu hình hiện tại.

Response thành công:

```json
{ "data": { "...": "..." } }
```

Response lỗi:

```json
{
  "error": {
    "code": "INSUFFICIENT_TOKEN_BUDGET",
    "message": "Token còn lại chưa đủ cho câu hỏi và lịch sử. Rút gọn câu hỏi hoặc tạo phiên mới; phiên chưa bị khóa.",
    "details": {
      "used_tokens": 1800,
      "token_limit": 2000,
      "remaining_tokens": 200,
      "requires_new_conversation": false
    },
    "request_id": "trace-uuid"
  }
}
```

`X-Request-ID` là trace của request HTTP; khác `request_id` UUID do client gửi để idempotency và ID request AI do server tạo. Lưu ID client cho đến khi nhận trạng thái terminal; nếu mạng bị ngắt, gửi lại đúng ID và nội dung, không tự tạo ID mới.

## Authentication

Cookie session do backend cấp. Mọi thao tác ghi yêu cầu `Origin` chính xác và JSON Content-Type. Không có CORS cho origin bên ngoài.

| Method | Path | Quyền | Chức năng |
| --- | --- | --- | --- |
| GET | `/health` | Public | Health của process, không kiểm tra provider |
| GET | `/auth/google` | Public | Redirect đăng nhập Google |
| GET | `/auth/google/callback` | OAuth state | Xác minh và tạo session, redirect `/chat` |
| POST | `/auth/logout` | Cookie nếu có | Thu hồi session |
| POST | `/auth/dev` | Local development | `{ "email": "admin@example.test" }` |
| GET | `/me` | User | id, email, display_name, role, status |
| GET | `/chat/config` | User | `default_model`, `default_token_limit`, `model_allowlist`, `byteplus_model`; không chứa API key |

## Conversations

| Method | Path | Body/query | Chức năng |
| --- | --- | --- | --- |
| POST | `/conversations` | `title?`, `model?`, hoặc `{}` | Tạo phiên theo settings hiện tại; model phải nằm trong allowlist; HTTP 201 |
| GET | `/conversations` | `limit=30&offset=0&search=...` | Danh sách của user, `items` và `next_offset` |
| GET | `/conversations/:id` | `limit=30&before=sequence` | Thông tin, quota, trang tin nhắn; `budget_estimate` dự trù đầu vào lượt kế tiếp và output khả dụng |
| PATCH | `/conversations/:id` | `title?`, `archived?` | Đổi tên, lưu trữ/mở lại phiên active đã lưu trữ |
| DELETE | `/conversations/:id` | Không body | Xóa nội dung; HTTP 204, chưa cho xóa phiên đang xử lý/pending |
| POST | `/conversations/:id/messages` | `request_id`, `content` | Gửi một lượt chat |
| GET | `/requests/:id` | Không body | Trạng thái và câu trả lời đã lưu nếu completed |

Gửi câu hỏi:

`byteplus/configured` là lựa chọn BytePlus trong allowlist. Tạo phiên lưu `provider_model` và `model_context_tokens` từ cấu hình máy chủ. Client không được gửi các trường snapshot này. `budget_estimate` của BytePlus là `null` khi đọc phiên để không gọi provider từ GET; Tokenization chỉ chạy trước inference. `BYTEPLUS_NOT_CONFIGURED`, `BYTEPLUS_CONFIG_INVALID`, `BYTEPLUS_TOKENIZER_UNAVAILABLE` trả 503, không khóa phiên hoặc tính usage inference.

```json
{
  "request_id": "ee94d809-395e-4c48-8421-8114617633ee",
  "content": "Giải thích Cloudflare Workers là gì."
}
```

Kết quả chat:

```json
{
  "data": {
    "request_id": "server-request-uuid",
    "client_request_id": "ee94d809-395e-4c48-8421-8114617633ee",
    "status": "completed",
    "message": {
      "id": "message-uuid",
      "role": "assistant",
      "content": "...",
      "sequence": 2
    },
    "usage": { "input_tokens": 100, "output_tokens": 80, "total_tokens": 180 },
    "conversation": {
      "id": "conversation-uuid",
      "status": "active",
      "model": "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      "token_limit": 2000,
      "used_total_tokens": 180,
      "remaining_tokens": 1820,
      "requires_new_conversation": false
    }
  }
}
```

Ví dụ response chỉ minh họa các trường chính; dữ liệu thực còn có timestamps, snapshot limits và các tổng input/output. GET chi tiết trả `data.messages.items` theo sequence tăng dần, cùng `next_before`. Để lấy trang cũ hơn, gửi `before=next_before`. `limit` từ 1 đến 100.

Trạng thái phiên: `active`, `processing`, `usage_pending`, `limit_reached`, `archived`. Phiên deleted không truy cập được.

Trạng thái request: `processing`, `completed`, `rejected`, `failed`, `usage_pending`, `suppressed`. Request bị suppressed không có nội dung assistant trong API hoặc database messages.

## Admin

Mọi endpoint dưới `/admin` kiểm tra role admin đang có trong database, không tin role client gửi.

| Method | Path | Chức năng |
| --- | --- | --- |
| GET | `/admin/settings` | Cấu hình hiện tại và version |
| PUT | `/admin/settings` | Lưu cấu hình đầy đủ, tạo version mới, áp dụng phiên mới |
| PATCH | `/admin/conversations/:id/limit` | `{ "token_limit": 5000 }`, chỉ phiên active/chưa xử lý |
| GET | `/admin/stats` | Tổng users, conversations, requests và tokens |
| GET | `/admin/users` | Danh sách users phân trang |
| PATCH | `/admin/users/:id` | `{ "status": "blocked" }` hoặc `{ "role": "admin" }` |
| GET | `/admin/requests` | Phân trang, `status` tùy chọn; không trả nội dung chat |
| POST | `/admin/requests/:id/reconcile` | Quyết toán usage đã xác minh; luôn đóng phiên |
| GET | `/admin/audit-logs` | Nhật ký thay đổi phân trang |

Body cập nhật settings (loại các trường `version`, `created_at`, `updated_by` của GET):

```json
{
  "default_token_limit": 2000,
  "default_model": "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "model_allowlist": ["@cf/meta/llama-3.3-70b-instruct-fp8-fast"],
  "system_prompt": "Bạn là trợ lý AI hữu ích. Trả lời bằng tiếng Việt.",
  "max_input_bytes": 16384,
  "max_output_tokens": 512,
  "message_rate_per_minute": 20,
  "conversation_rate_per_hour": 30
}
```

Body reconciliation chỉ dùng sau khi admin đối chiếu được provider logs:

```json
{
  "input_tokens": 150,
  "output_tokens": 80,
  "note": "Đã đối chiếu provider request ID và xác nhận usage."
}
```

Không nhập số 0 để bỏ qua usage chưa rõ. Note tối thiểu 10 ký tự; số token và note được audit. Backend không tự truy cập hay suy đoán log Cloudflare.

## Lỗi chính và hành vi frontend

| HTTP | Code | Xử lý |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR`, `INVALID_JSON` | Hiển thị lỗi input |
| 401 | `UNAUTHENTICATED` | Đăng nhập lại |
| 403 | `FORBIDDEN`, `INVALID_ORIGIN`, `ACCOUNT_BLOCKED` | Dừng thao tác, hiển thị lý do |
| 404 | `NOT_FOUND` | Phiên/request không tồn tại hoặc không thuộc user |
| 409 | `INSUFFICIENT_TOKEN_BUDGET` | Không gọi AI, không cộng token, giữ composer để sửa câu hỏi; `requires_new_conversation=false` |
| 409 | `SESSION_TOKEN_LIMIT_EXCEEDED` | Phiên đã chạm quota; khóa composer, tạo phiên mới |
| 409 | `REQUEST_IN_PROGRESS` | Giữ trạng thái đang trả lời, polling request/phiên |
| 409/503 | `USAGE_PENDING` | Thông báo chờ đối soát, không tự gọi AI lại |
| 409 | `IDEMPOTENCY_CONFLICT` | Không đổi nội dung với UUID đã dùng |
| 409 | `SESSION_NOT_EDITABLE`, `LAST_ADMIN` | Hiển thị lỗi quản trị |
| 413 | `INPUT_TOO_LARGE` | Rút ngắn câu hỏi hoặc tạo phiên mới |
| 429 | `RATE_LIMITED` | Chờ theo `Retry-After` |
| 502 | `AI_USAGE_MISMATCH` | Provider vượt cap output; không có câu trả lời, phiên đã khóa |
| 502 | `AI_EMPTY_RESPONSE` | Model chưa có câu trả lời hiển thị; usage thật đã cộng, phiên vẫn active nếu còn quota |
| 502 | `AI_UNAVAILABLE`, `AI_RATE_LIMITED` | Provider từ chối; có thể tạo lượt mới sau khi xử lý lỗi |
| 503 | `AI_NOT_CONFIGURED`, `GROQ_NOT_CONFIGURED`, `AUTH_NOT_CONFIGURED`, `MODEL_DISABLED` | Cần admin cấu hình |

Client có thể chọn `model` trong allowlist khi tạo phiên. Khi gửi tin nhắn, client không được ghi đè `model`, `used_tokens`, `token_limit`, `role` hay history; backend dùng model và lịch sử đã lưu. `budget_estimate.next_input_tokens` gồm hướng dẫn và lịch sử với một câu hỏi trống, chưa tính câu hỏi thật; không phải token đã dùng hay cam kết chi phí provider.
