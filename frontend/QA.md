# Kiểm tra frontend

Thực hiện ngày 05/10/2026 trên Windows, Chromium qua Playwright CLI, Vite `localhost:5173`, API Wrangler/D1 local `127.0.0.1:8787`.

## Build

- TypeScript frontend và backend: đạt.
- Frontend production build: đạt; trang quản trị và Markdown được tách thành các chunk tải khi cần.
- Workers dry-run cùng thư mục static assets: đạt; chưa publish.
- 52 kiểm thử backend: đạt sau bản sửa khóa phiên sớm và bổ sung Groq.
- Trang `/chat` được phục vụ từ Workers Static Assets, có CSP và các header bảo vệ trình duyệt. API giữ routing riêng.

## Luồng dùng API local thật

- Đăng nhập local admin, tạo phiên, đổi tên và cập nhật lịch sử ngay sau thao tác.
- Thiếu credentials AI: hiện lỗi cấu hình, giữ câu hỏi trong ô nhập, không sinh câu trả lời.
- Lưu hạn mức mặc định từ 2.000 sang 2.500; phiên mới có hạn mức 2.500. Sau kiểm tra, cấu hình được khôi phục về 2.000.
- Trang cấu hình, tài khoản, lượt gọi và nhật ký tải được dữ liệu; thao tác lưu có phản hồi.
- Hạ quyền quản trị viên hoạt động cuối cùng bị backend từ chối và giao diện giải thích lý do.
- Người dùng thường không thấy điều khiển quản trị và được đưa về chat khi truy cập `/admin`.
- Đổi tài khoản khi lịch sử đang tải: không hiển thị lịch sử hoặc quyền của tài khoản trước; đăng nhập local mới đi về `/chat`.
- Bản frontend production được tải trực tiếp qua Wrangler local, không có lỗi thực thi JavaScript hoặc lỗi CSP trong luồng mở trang/nhập nháp đã thử.

## Luồng dùng fixtures API trong trình duyệt

Các response AI, usage và lịch sử dưới đây được Playwright chặn riêng trong trình duyệt kiểm thử. Không có inference Cloudflare thật và không ghi câu trả lời giả vào D1 hoặc mã ứng dụng.

- Mất phản hồi: giữ lượt chưa xác nhận, khóa gửi lượt mới; **Kiểm tra kết quả** dùng lại UUID, chỉ hiển thị một câu trả lời đã xác nhận.
- Markdown có bảng, danh sách, code và liên kết; HTML thô không thực thi.
- Mất mạng: vô hiệu hóa gửi, giữ bản nháp.
- Hết quota: không thêm câu trả lời, thay ô nhập bằng hướng dẫn tạo phiên mới; hạn mức phiên khóa không chỉnh được.
- Tạo phiên mới: trạng thái active, usage 0.
- Câu hỏi bị từ chối do hạn mức được giữ thành nháp trong phiên mới để xem lại trước khi gửi.
- Usage chưa xác định: dừng gửi và không hiện nội dung chưa quyết toán.
- Lượt đang xử lý: thăm dò đến completed, cập nhật lịch sử và mở lại ô nhập.
- Lịch sử 60 tin: tải 30 tin gần nhất rồi tải 30 tin trước; không trùng, không mất hai tin ở ranh giới phân trang sau lượt gửi mới.

## Bố cục và bàn phím

- Đã xem ảnh desktop 1440×960 và mobile 390×844 / 360×800.
- Chat, đăng nhập và quản trị không tràn ngang ở các kích thước đã thử; bảng quản trị cuộn trong vùng bảng khi cần.
- Dialog đóng bằng Escape và khôi phục focus; drawer lịch sử mobile giữ focus, đưa nội dung nền vào trạng thái inert rồi khôi phục khi đóng.
- CSS hỗ trợ reduced motion; ô nhập xử lý Enter, Shift+Enter và IME.
- Sau lượt xem ảnh đầu tiên đã tăng cỡ chữ phụ, độ tương phản và sửa cập nhật cache lịch sử. Cache hội thoại được đặt trong provider riêng theo tài khoản.

Ảnh và script kiểm tra local nằm trong `../output/playwright/`, được bỏ qua bởi Git. Một số ảnh chat có nội dung và usage fixtures, không phải kết quả AI thật.

## Chưa kiểm chứng bằng dịch vụ thật

Google OAuth và deployment production vẫn chưa kiểm chứng. Phần đối soát token thủ công có form và API đã kiểm thử ở backend; chưa đối soát request pending từ tài khoản Cloudflare thật.

## Sửa khóa phiên sớm — 2026-10-05

- D1 local có ba phiên bị khóa bởi `INSUFFICIENT_TOKEN_BUDGET` khi mới dùng 461, 787 và 656 trên 2.000 token. Kiểm tra theo byte UTF-8 đã dự trù đầu vào cao hơn usage thực tế.
- Đã đối chiếu tokenizer offline với 7 lượt Workers AI đã lưu của model Llama 3.3: input usage cao hơn tokenizer thô 1 token ở cả 7 lượt. Local chuyển sang `verified` với 2 token dự phòng. Không phát sinh thêm lượt AI trong lần kiểm tra này.
- Preflight từ chối riêng câu hỏi và giữ phiên active. Các guard usage thực tế, idempotency và usage pending vẫn được kiểm thử. Backend có 44 test qua; frontend typecheck/build qua.
- Migration `0002_reopen_preflight_rejections.sql` khôi phục riêng khóa preflight cũ dưới quota; giữ nguyên token và lịch sử. Các khóa quota thật, request đang chạy, pending và suppressed không được khôi phục.

## Groq GPT‑OSS và quota

- 52 test backend qua, gồm routing Groq, Harmony tokenizer, hidden reasoning không hiển thị/không cộng hai lần, missing usage pending, idempotency, missing API key, real usage vượt quota, input estimate lệch nhưng tổng còn trong quota và empty answer dưới quota.
- Browser/HTTP local xác nhận chọn GPT‑OSS 120B/20B ở chat và chọn provider/model trong quản trị. Model 20B được gắn với phiên mới; thiếu API key không khóa hoặc tiêu token. Không lưu thay đổi model mặc định trong lần QA này.
- Browser xác nhận backend đang chạy `verified`, cả ba phiên cũ active với usage 461/656/787, input tiếp theo được hiển thị và composer sửa được. Một câu hỏi lớn hơn quota được thử qua API thật: không gọi AI, usage vẫn 0, giữ draft và phiên active.
- Mobile 390px không tràn ngang với model picker và phiên Groq; đã xem lại ảnh picker/admin. Các phiên QA tạo riêng đã xóa. Script: `../output/playwright/groq-quota.js`.
- Sau khi người dùng điền key, endpoint Groq models trả HTTP 200 và có cả GPT‑OSS 20B/120B. Đã sửa runtime chạy trùng cổng/treo, khởi động lại một backend nạp key mới. Một lượt GPT‑OSS 20B qua proxy Vite thật trả HTTP 200, có câu trả lời và usage 115 input + 37 output = 152 token; phiên vẫn active. Phiên kiểm tra đã xóa và đăng xuất tài khoản kiểm tra. Chưa kiểm tra inference 120B hoặc đối chiếu Harmony trên nhiều lượt; không gọi thêm Cloudflare AI.

## Ảnh tham chiếu và BytePlus

- 18/10/2026: xác định 26 lượt BytePlus trong D1 local đều lỗi `BYTEPLUS_TOKENIZER_UNAVAILABLE` trước inference và chưa tính token. API key, model, Tokenization và Chat API hoạt động khi gọi trực tiếp. Nguyên nhân là Worker không hỗ trợ `fetch` với `redirect: error`; đã chuyển cả Tokenization và Chat sang `redirect: manual`, không theo chuyển hướng. Test qua Worker thật trên cổng 8788 với D1 tạm trả HTTP 200, usage 68 input + 19 output = 87; phiên active. Cấu hình `.dev.vars.local` giữ nguyên.

- 59 test backend pass, gồm 7 test BytePlus: snapshot model/context, Tokenization trước inference, chặn vượt quota, idempotency, usage pending, lỗi đếm token giữ active và key thiếu không claim request.
- UI theo ảnh: sidebar 312px; tại 2048×1082, composer rộng 924px ở x=718 và y≈993. Nền than, thước token trên header, user bubble bo tròn và bot trả lời dạng văn bản. Giữ tên PIPILABU; lời chào dùng tài khoản thật.
- Playwright qua desktop, theme sáng/tối và lưu sau reload, mobile 390/360px không tràn ngang, ô nhập mobile không bị cắt placeholder, drawer giữ focus và đóng bằng Escape.
- Qua chọn BytePlus và tên model cấu hình, tạo phiên mới với model đã chọn, quản trị chọn provider, đổi hạn mức/đổi tên, khóa phiên và đăng xuất. Hiển thị dần, copy toàn bộ khi đang reveal, Markdown, history không chạy lại hiệu ứng và reduced motion đều qua. Không có JavaScript page error.
- Script `../output/playwright/byteplus-ui.js` dùng API giả lập, không gọi provider trả phí hoặc sửa hội thoại thật. Ảnh `byteplus-reference-*.png` và `byteplus-longreply-*.png` đã xem lại. BytePlus thật cần key/model của người dùng; chưa kiểm chứng inference tài khoản này.
- Cấu hình local được bổ sung, không thay key Cloudflare/Groq. Migration `0004_byteplus.sql` giữ lịch sử, usage và settings mặc định; chỉ thêm snapshot và lựa chọn BytePlus.
- Frontend typecheck/build và Worker dry-run cuối cùng pass (34 assets, Worker gzip khoảng 2954 KiB). Bản build qua Wrangler local có theme hoạt động khi storage bị chặn, không lỗi CSP/JavaScript; health và theme.js HTTP 200. Chưa deploy.

## PIPILABU, theme và hiển thị dần (trước bố cục tham chiếu)

- Đổi tên ở logo, câu trả lời, trang đăng nhập, footer quản trị, metadata và tiêu đề trình duyệt. Theme sáng/tối được kiểm tra ở đăng nhập, chat, quản trị, dialog và drawer.
- Playwright xác nhận theme mặc định theo hệ thống, lưu sau reload, lựa chọn ưu tiên hơn hệ thống, đồng bộ giữa các tab và vẫn đổi được khi lưu cấu hình theme bị chặn.
- Câu trả lời mới hiện từ một phần ngắn đến toàn bộ nội dung; kiểm tra cả kết thúc tự nhiên và Hiện ngay. Revalidation không chạy lại hiệu ứng; mở lịch sử không gọi AI hoặc chạy lại animation.
- Sao chép trong lúc hiển thị dần lấy toàn bộ nội dung đã quyết toán. Markdown, code, link và tiếng Việt/emoji giữ nguyên. Kiểm tra clipboard có chuẩn hóa xuống dòng Windows trong script.
- Token usage đã cập nhật trước khi nội dung hiện dần. Cuộn lên đọc giữ vị trí trong lúc câu trả lời tăng; nút đến tin mới nhất vẫn hoạt động.
- Reduced motion tắt hiển thị dần và animation dialog. Dialog đóng bằng Escape, trả focus về nút mở kể cả khi bên trong có input autofocus.
- Desktop 1440×960, mobile 390×844 và 360×800 không tràn ngang; nút đổi theme vẫn hiện trên mobile. Đã xem lại ảnh sáng/tối, quản trị, dialog và drawer ở trạng thái kết thúc chuyển động.
- Script `../output/playwright/pipilabu-ui.js` qua toàn bộ kiểm tra với ba phản hồi API giả lập; không gọi AI thật, không sửa dữ liệu D1. Không có JavaScript page error. Ảnh `pipilabu-*.png` cùng thư mục artifact được Git bỏ qua.
- Frontend typecheck/build và Worker dry-run qua; Workers phục vụ `theme.css`/`theme.js` với MIME và CSP đúng. Script `pipilabu-production.js` xác nhận bản build tải và đổi theme được dưới CSP, kể cả khi tất cả lệnh đọc/ghi storage bị chặn; không có page error hoặc CSP error. Đây là kiểm tra bản build qua Wrangler local, chưa deploy production.
