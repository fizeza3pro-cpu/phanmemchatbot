# Cloudflare Chatbot — backend

Backend TypeScript dùng Hono, Cloudflare Workers và D1; hỗ trợ AI từ Cloudflare Workers AI hoặc Groq GPT‑OSS. Giao diện React nằm tại `../frontend/`, kết nối API cùng origin và được phục vụ bằng Workers Static Assets khi triển khai.

## Chạy local

Yêu cầu Node.js 24 LTS hoặc mới hơn. Trên Windows PowerShell, dùng `npm.cmd` nếu execution policy chặn `npm.ps1`.

Build frontend bằng `npm.cmd ci` và `npm.cmd run build` trong `frontend/` trước. Các lệnh dưới đây chạy trong thư mục `backend/`. Từ thư mục gốc dự án, chạy `cd backend` trước.

```powershell
npm.cmd ci
if (!(Test-Path .dev.vars.local)) { Copy-Item .dev.vars.example .dev.vars.local }
npm.cmd run db:migrate:local
npm.cmd run dev
```

API chạy tại `http://localhost:8787`. Local chỉ bind `127.0.0.1`. Frontend Vite chạy tại `http://localhost:5173`; `APP_ORIGIN` local là origin này. Khởi chạy frontend theo [hướng dẫn giao diện](../frontend/README.md).

Điền `CLOUDFLARE_ACCOUNT_ID` và `CLOUDFLARE_API_TOKEN` trong `.dev.vars.local` để chat với Workers AI thật. D1, đăng nhập local, quản lý phiên và cấu hình có thể chạy trước khi có credentials AI. API chat trả `AI_NOT_CONFIGURED` nếu thiếu cấu hình; không sinh câu trả lời giả.

### File cấu hình local

File làm việc là `backend/.dev.vars.local`; `.dev.vars.example` là mẫu. File local đã được tạo sẵn với các ô credentials để trống và được `.gitignore` loại trừ. Khi sao chép dự án sang máy khác, tạo lại từ mẫu nếu file local chưa tồn tại.

| Biến | Cần điền khi chạy local |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Account ID Cloudflare của bạn |
| `CLOUDFLARE_API_TOKEN` | API token có quyền chạy Workers AI |
| `GROQ_API_KEY` | API key Groq để dùng GPT‑OSS 120B/20B; không cần credentials Cloudflare AI khi chọn Groq |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Credentials Google OAuth nếu muốn đăng nhập Google; đăng nhập local dùng được khi để trống |
| `ADMIN_EMAILS` | Mặc định `admin@example.test`; thêm email quản trị trước khi tài khoản đó đăng nhập lần đầu |
| `APP_ORIGIN` | Mặc định `http://localhost:5173`, trùng URL frontend |

Các giá trị local `ENVIRONMENT=development`, `ENABLE_DEV_AUTH=true` và `TOKEN_COUNT_MODE=verified` đã được điền. Khởi động lại backend sau khi thay đổi file.

Model và hạn mức token được lưu trong D1. Đăng nhập local bằng `admin@example.test`, mở **http://localhost:5173/admin**, chọn **Model mặc định** và hạn mức rồi lưu. Các thay đổi mặc định áp dụng cho phiên mới. Danh sách model đã hỗ trợ nằm ở [shared/models.ts](shared/models.ts).

### Groq GPT‑OSS

Điền `GROQ_API_KEY` trong `.dev.vars.local` rồi khởi động lại backend. Tại trang chat trống (`/chat`), chọn **Model cho phiên mới → Groq · GPT‑OSS 120B/20B** rồi gửi câu hỏi. Trong quản trị, chọn **Dịch vụ AI → Groq**, chọn **Model mặc định**, rồi lưu để đổi mặc định. Model gắn cố định với phiên khi tạo; phiên Cloudflare đã có vẫn giữ model cũ.

Chỉ chạy một backend trên cổng 8787. Nếu đã thêm key nhưng giao diện vẫn báo chưa cấu hình, dừng các terminal Wrangler cũ bằng `Ctrl+C`, chạy lại `npm.cmd run dev` tại `backend/` rồi tải lại trang. Hai tiến trình cùng cổng có thể khiến request đi vào phiên cũ chưa nạp key.

Adapter gọi `https://api.groq.com/openai/v1/chat/completions`, không streaming, dùng `max_completion_tokens`, `reasoning_effort=low` và `include_reasoning=false`. Usage `prompt_tokens + completion_tokens` được quyết toán một lần; completion đã gồm phần suy luận, không cộng reasoning thêm lần nữa. Tham khảo [API Groq](https://console.groq.com/docs/api-reference) và [GPT‑OSS reasoning](https://console.groq.com/docs/reasoning).

GPT‑OSS dùng tokenizer `o200k_harmony` từ `gpt-tokenizer`, không dùng tokenizer Llama. Preflight có thêm 32 token dự trù framing của Groq; đây là ước tính, không phải usage tính phí. Usage thực tế được kiểm tra trước khi lưu/hiển thị câu trả lời. Đã smoke test GPT‑OSS 20B thật qua proxy frontend: HTTP 200, usage input 115 + output 37 = 152 token. Chưa có đủ dữ liệu đối chiếu preflight cho nhiều lượt/model Groq.

### Đăng nhập local

Local có endpoint developer login để thử API trước khi cấu hình Google OAuth. Endpoint này chỉ hoạt động khi `ENVIRONMENT=development`, `ENABLE_DEV_AUTH=true` và hostname là loopback. Cấu hình production tắt endpoint này.

```powershell
$chatSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$chatHeaders = @{ Origin = 'http://localhost:5173' }
Invoke-RestMethod -Uri 'http://localhost:8787/api/auth/dev' -Method Post `
  -Headers $chatHeaders -ContentType 'application/json' -WebSession $chatSession `
  -Body '{"email":"admin@example.test"}'

$chatConversation = Invoke-RestMethod -Uri 'http://localhost:8787/api/conversations' `
  -Method Post -Headers $chatHeaders -ContentType 'application/json' `
  -WebSession $chatSession -Body '{"title":"Phiên đầu tiên"}'

$chatBody = @{ request_id = [guid]::NewGuid().ToString(); content = 'Xin chào, bạn có thể giúp tôi những gì?' } | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:8787/api/conversations/$($chatConversation.data.id)/messages" `
  -Method Post -Headers $chatHeaders -ContentType 'application/json' `
  -WebSession $chatSession -Body $chatBody
```

Đổi email để tạo user thường. `ADMIN_EMAILS` quyết định quyền admin khi tạo tài khoản lần đầu, không tự cấp lại quyền đã bị quản trị viên thu hồi.

## Chính sách token

- Hạn mức mặc định 2.000 token/phiên, chỉnh qua API quản trị để frontend sử dụng.
- Tổng token = tổng usage đầu vào + đầu ra của các lần inference đã quyết toán; system prompt và lịch sử gửi lại được tính trong input mỗi lượt.
- Prompt không đủ chỗ cho output: không gọi AI, không cộng token, từ chối riêng lượt này và giữ phiên active. Người dùng có thể rút gọn câu hỏi hoặc tạo phiên mới nếu lịch sử đã quá dài.
- Nếu còn ngân sách: cap `max_tokens` theo phần còn lại, kiểm tra usage thực tế rồi mới lưu và trả nội dung.
- Nếu provider vượt ngân sách hoặc cap: không lưu/hiển thị câu trả lời; ghi usage thật và khóa phiên.
- Nếu provider thiếu usage, timeout hoặc lỗi có khả năng đã inference: phiên chuyển `usage_pending`; không tự gán usage bằng 0 hoặc tự gọi lại.
- Usage đầu vào lệch dự trù nhưng tổng thực tế vẫn trong quota: trả câu trả lời và ghi đúng usage, không khóa phiên chỉ vì lệch ước tính. Model chỉ suy luận/chưa có câu trả lời hiển thị: vẫn cộng usage thật, giữ phiên active nếu còn quota.
- Chỉ một lượt đang chạy mỗi phiên. `request_id` của client phải là UUID; gửi lại cùng ID/nội dung trả kết quả cũ và không gọi AI lần hai. Đổi nội dung phải tạo UUID mới.
- Tạo phiên mới tạo ID khác, tổng 0 và lịch sử trống. Phiên đã chạm quota hoặc bị khóa sau inference không được mở lại bằng đổi hạn mức hoặc archive/unarchive. Migration `0002_reopen_preflight_rejections.sql` chỉ khôi phục các phiên bị khóa nhầm bởi kiểm tra đầu vào cũ, còn dưới quota và không có lượt chưa quyết toán.
- Hạn mức theo phiên không phải hạn mức tổng tài khoản/ngày. Hiện đã có rate limit gửi tin và tạo phiên; quota ngày và thanh toán chưa được triển khai.

### Hai chế độ preflight

`TOKEN_COUNT_MODE=conservative` là tùy chọn dự trù Llama theo byte. Chế độ này dùng số byte UTF-8 của toàn bộ raw prompt cộng dự phòng BOS/EOS làm giới hạn trên cho tokenizer byte-level BPE. Có thể từ chối lượt chat sớm hơn mức token thực tế, đặc biệt với tiếng Việt; từ chối trước inference không khóa phiên. GPT‑OSS luôn dùng tokenizer Harmony riêng. Usage thật vẫn là nguồn quyết toán.

`TOKEN_COUNT_MODE=verified` là cấu hình mặc định local và production, dùng `llama3-tokenizer-js` để đếm raw prompt Llama và cộng 2 token dự phòng BOS/EOS. Đã đối chiếu 7 lượt Cloudflare thật lưu trong D1 của model Llama 3.3: usage đầu vào cao hơn tokenizer thô 1 token ở cả 7 lượt. Đây là dữ liệu hiện tại, không bảo đảm mọi model/prompt tương lai; cần đối chiếu thêm khi đổi model/template. Chênh lệch ước tính không tự khóa phiên; guard tổng usage thực tế vẫn chặn response vượt quota. Inference thực tế có thể đã được provider tính phí dù response bị chặn.

Model hỗ trợ ban đầu:

- `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (mặc định).
- `@cf/meta/llama-3.1-8b-instruct-fast`.
- `openai/gpt-oss-120b` qua Groq.
- `openai/gpt-oss-20b` qua Groq.

Profile model fast tạm dùng context cap 60.000 để tránh giả định context lớn hơn chưa kiểm chứng. Tất cả model phải trả usage hợp lệ; nếu model/endpoint không trả usage, backend giữ phiên pending và không hiển thị câu trả lời. Ưu tiên kiểm chứng model mặc định 3.3 trước khi bật model khác. [Giới hạn Cloudflare công bố](https://developers.cloudflare.com/ai-search/configuration/models/supported-models/).

BytePlus có lựa chọn `byteplus/configured`; model thực tế và context được cấu hình trong backend, lưu cùng phiên mới. Xem [cấu hình BytePlus](docs/BYTEPLUS.md). User không được tự truyền model hoặc endpoint upstream.

## Xác thực production

Google OAuth authorization code với state dùng một lần, PKCE và email đã xác minh từ Google userinfo. Session token ngẫu nhiên lưu hash SHA-256 trong D1, cookie HttpOnly/SameSite=Lax/Secure, hết hạn sau 7 ngày. Production HTTPS dùng cookie `__Host-chatbot_session`.

Biến cần cấu hình:

| Biến | Loại | Ý nghĩa |
| --- | --- | --- |
| `APP_ORIGIN` | vars | Origin chính xác, không có dấu `/` cuối |
| `ENVIRONMENT` | vars | `production` khi deploy public |
| `ENABLE_DEV_AUTH` | vars | `false` khi deploy public |
| `ADMIN_EMAILS` | vars/secret | Email admin bootstrap, phân cách dấu phẩy |
| `TOKEN_COUNT_MODE` | vars | `conservative` hoặc `verified` |
| `CLOUDFLARE_ACCOUNT_ID` | secret | Account ID Cloudflare |
| `CLOUDFLARE_API_TOKEN` | secret | Token có quyền chạy Workers AI |
| `GROQ_API_KEY` | secret | API key Groq, dùng cho GPT‑OSS |
| `BYTEPLUS_API_KEY` | secret | API key BytePlus ModelArk |
| `BYTEPLUS_MODEL` | vars | Model ID hoặc endpoint ID BytePlus |
| `BYTEPLUS_BASE_URL` | vars | Tiền tố API ModelArk, mặc định Singapore `/api/v3` |
| `BYTEPLUS_CONTEXT_TOKENS` | vars | Context model, lưu trong phiên mới; mặc định 32768 |
| `GOOGLE_CLIENT_ID` | secret | OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | secret | OAuth client secret |

Google OAuth callback: `${APP_ORIGIN}/api/auth/google/callback`. Scope chỉ `openid email profile`; không lưu access/refresh token Google. Endpoint bắt đầu đăng nhập là `/api/auth/google`, callback redirect về `/chat` để frontend tiếp nhận.

Mọi API ghi yêu cầu header `Origin` trùng `APP_ORIGIN`; JSON body yêu cầu `Content-Type: application/json`. Frontend cùng origin dùng `credentials: 'same-origin'`.

## Kiểm tra và build

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Test integration dùng Miniflare với D1 thật trong runtime local; provider được mock để thử quota, lỗi và cạnh tranh request, không gọi AI trả phí. `build` chỉ bundle/dry-run, không publish lên Cloudflare.

Đã kiểm tra: TypeScript, 59 test (quota, D1, concurrency, idempotency, quyền truy cập, OAuth, Groq, BytePlus, reasoning usage, từ chối prompt và khôi phục khóa preflight cũ), migration local, bundle Workers và HTTP/browser smoke test qua Wrangler. Đã đối chiếu tokenizer offline với 7 lượt Workers AI thật lưu trong D1 và gọi một lượt GPT‑OSS 20B thật thành công qua proxy frontend. Groq xác nhận API key có quyền dùng 20B/120B; BytePlus thật đang chờ key/model, inference 120B, Google OAuth thật và production chưa kiểm chứng.

## Triển khai

1. Tạo D1 bằng `npx.cmd wrangler d1 create chatbot-production`, điền database ID thật vào `wrangler.jsonc`.
2. Đổi `APP_ORIGIN`, cấu hình `ADMIN_EMAILS`; giữ development auth tắt.
3. Đặt secrets bằng `npx.cmd wrangler secret put TEN_BIEN`; không ghi giá trị vào source control.
4. Áp dụng migrations bằng `npm.cmd run db:migrate:remote`.
5. Build frontend trong `../frontend/` rồi deploy bằng `npm.cmd run deploy` tại `backend/` khi đã sẵn sàng. Wrangler phục vụ `../frontend/dist`, giữ `/api` và `/api/*` chạy qua Worker; các URL giao diện dùng SPA routing.
6. Smoke test Google OAuth, quyền sở hữu, chat thật, usage và giới hạn token.

Cron 5 phút thu hồi session/state/rate-limit hết hạn và chuyển request quá 2 phút sang `usage_pending`. Admin đối chiếu log provider rồi quyết toán bằng API reconciliation có ghi chú/audit. Quyết toán thủ công luôn đóng phiên cũ và yêu cầu phiên mới.

Xóa phiên xóa ngay nội dung tin nhắn và prompt/request content; giữ ledger kỹ thuật tối thiểu không chứa hội thoại trong 30 ngày, sau đó cron xóa. Nhật ký admin chứa metadata thay đổi, không chứa API key hoặc nội dung chat.

Các tài liệu liên quan: [API contract](docs/API.md), [kế hoạch](../PLAN.md).
