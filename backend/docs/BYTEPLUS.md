# BytePlus ModelArk

Trong [../.dev.vars.local](../.dev.vars.local), điền `BYTEPLUS_API_KEY` và `BYTEPLUS_MODEL`: model ID hoặc endpoint ID `ep-...` có quyền gọi trong tài khoản của bạn. Các biến đã được thêm sẵn; cấu hình Cloudflare/Groq được giữ nguyên.

```dotenv
BYTEPLUS_API_KEY=""
BYTEPLUS_BASE_URL="https://ark.ap-southeast.bytepluses.com/api/v3"
BYTEPLUS_MODEL=""
BYTEPLUS_CONTEXT_TOKENS="32768"
BYTEPLUS_MAX_TOKENS_PARAMETER="max_completion_tokens"
BYTEPLUS_THINKING="disabled"
```

Base URL là tiền tố API, không thêm `/chat/completions`. Context cần đặt theo model của bạn. `max_completion_tokens` giới hạn cả câu trả lời và suy luận; nếu model chỉ hỗ trợ `max_tokens`, dùng `BYTEPLUS_THINKING="disabled"`. Các giá trị thinking: `disabled`, `enabled`, `auto`, `omit` (không gửi trường này). Mặc định tắt suy luận để dành ngân sách phiên nhỏ cho câu trả lời. Không tự thử lại bằng tham số khác sau lỗi inference chưa rõ usage.

Tại thư mục backend, áp dụng migration bằng `npm.cmd run db:migrate:local`, khởi động lại bằng `npm.cmd run dev`. Ở `/chat`, chọn **BytePlus ModelArk** cho phiên mới. Với phiên đang mở, bấm số token trên đầu, chọn model cho phiên mới rồi bấm **Tạo phiên mới**. Model/context đã lưu trong phiên cũ không đổi khi sửa tên model trong env. Key được đọc lúc backend khởi động; cần khởi động lại sau khi sửa file.

Backend gọi Tokenization API với text của đúng model, cộng 8 token mỗi message và 16 token dự phòng cho khuôn hội thoại. Đây là dự trù; số đã dùng luôn lấy từ usage input + output thực tế. Output đã gồm suy luận, không cộng lần thứ hai. Nếu vượt quota, câu trả lời bị giữ lại và phiên khóa. Nếu chỉ lỗi Tokenization hoặc đầu vào quá dài, phiên vẫn active và không tính token inference. Mở lịch sử, thăm dò phiên và đọc config không gọi BytePlus. Nếu model không hỗ trợ Tokenization, backend trả lỗi rõ ràng và không dùng bộ đếm của model khác để gọi inference.

Production: đặt key bằng `npx.cmd wrangler secret put BYTEPLUS_API_KEY --env=`; các biến model/base URL/context/thinking đặt trong `vars` production của `wrangler.jsonc`. Áp dụng migration remote theo quy trình triển khai. API key chỉ nằm trên máy chủ.

Đã kiểm tra với API BytePlus thật qua Worker local và D1 tạm: model `deepseek-v4-1-flash-260910` trả HTTP 200, usage 68 token đầu vào + 19 token đầu ra. Tokenization đếm text; khuôn chat vẫn có thể khác giữa các model, nên usage thực tế là bước cuối trước khi nội dung được hiển thị. Worker dùng `redirect: manual` cho request BytePlus vì runtime không hỗ trợ `redirect: error`; các phản hồi chuyển hướng không được theo tới địa chỉ khác.

Tài liệu: [Base URL và xác thực](https://docs.byteplus.com/en/docs/modelark/base-url-and-authentication), [Chat API](https://docs.byteplus.com/en/docs/modelark/chat-api), [Tokenization API](https://docs.byteplus.com/en/docs/modelark/tokenization-api).
