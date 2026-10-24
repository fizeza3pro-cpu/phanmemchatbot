# PIPILABU — frontend

React 19, TypeScript, Vite, React Router và SWR. CSS riêng theo thiết kế PIPILABU; font Be Vietnam Pro được đóng gói cùng ứng dụng. Markdown và trang quản trị được tải khi cần.

## Chạy local

Yêu cầu Node.js 24+. Cài và build frontend trước khi chạy backend vì Workers phục vụ static assets từ `frontend/dist`.

```powershell
cd frontend
npm.cmd ci
npm.cmd run build
```

Mở hai terminal tại thư mục gốc:

```powershell
# Terminal 1
cd backend
npm.cmd run db:migrate:local
npm.cmd run dev
```

```powershell
# Terminal 2
cd frontend
npm.cmd run dev
```

Mở **http://localhost:5173**. Vite chuyển `/api` đến `127.0.0.1:8787`; cookie và Origin của frontend được giữ nguyên. Không đổi sang `127.0.0.1:5173` hoặc để Vite tự đổi port: Origin phải trùng `APP_ORIGIN` ở backend.

### Khi không chạy được dev trên Windows

- Lỗi `npm.ps1 cannot be loaded because running scripts is disabled`: trong PowerShell, dùng `npm.cmd run dev`. Các lệnh cài đặt/build cũng dùng `npm.cmd` như ví dụ ở trên.
- Lỗi `'vite' is not recognized`: dependencies chưa được cài đủ. Tại `frontend/`, chạy `npm.cmd ci --include=dev` rồi `npm.cmd run dev`.
- Lỗi `Port 5173 is already in use`: một phiên Vite đang chạy. Dùng trang đã mở tại `http://localhost:5173`, hoặc dừng terminal Vite cũ bằng `Ctrl+C` trước khi chạy lại. Giữ port 5173 để khớp cấu hình backend.

Trong màn hình đăng nhập, mở **Đăng nhập trong môi trường phát triển**, dùng `admin@example.test` để thử quản trị. Dùng email khác để thử người dùng thường. Đây là tài khoản local, không phải đăng nhập Google. Điều khiển này chỉ xuất hiện trong Vite development trên loopback; backend production cũng tắt endpoint local.

Thêm credentials Workers AI và Google theo [hướng dẫn backend](../backend/README.md) để sử dụng dịch vụ thật. Khi chưa có credentials, giao diện hiển thị thông báo cấu hình; không tạo câu trả lời mẫu.

Groq GPT‑OSS: điền `GROQ_API_KEY` trong `backend/.dev.vars.local`, khởi động lại backend, rồi chọn **Model cho phiên mới → Groq · GPT‑OSS 120B/20B** ở `/chat`. Trong `/admin`, có thể chọn **Dịch vụ AI → Groq** và đổi model mặc định. Phiên đã tạo giữ nguyên model; muốn đổi thì tạo phiên mới.

Bảng token hiển thị thêm **Đầu vào lượt tiếp theo** để phân biệt số token chưa dùng với số cần gửi lại lịch sử. Lượt không đủ chỗ bị từ chối và giữ ô nhập; lệch ước tính input không tự khóa phiên nếu usage thật vẫn trong quota. GPT‑OSS tính cả token suy luận vào output usage, kể cả khi chỉ hiển thị câu trả lời cuối.

## Theme và hiệu ứng

Nút mặt trời/mặt trăng trên thanh đầu trang đổi giữa theme sáng và tối, có trên trang đăng nhập, chat và quản trị. Mặc định tối theo ảnh mẫu; lựa chọn được lưu trong `localStorage` và đồng bộ giữa các tab. `public/theme.css` và `public/theme.js` tải trước React để áp dụng màu ngay, phù hợp CSP không cho phép inline script. Khi storage bị chặn, vẫn đổi được theme trong tab hiện tại.

Câu trả lời mới hiện dần sau khi backend quyết toán usage, kèm nút **Hiện ngay**. Đây là hiệu ứng frontend trên nội dung đã được duyệt; không streaming nội dung trước khi kiểm tra quota. Sao chép lấy toàn bộ câu trả lời đã xác nhận, không chỉ đoạn đang hiện. Mở lại lịch sử hiển thị đầy đủ. Giao diện chỉ cuộn theo khi người dùng đang ở cuối hội thoại và tắt chuyển động khi thiết bị bật reduced motion.

Nút, dialog, drawer và thông báo có chuyển động ngắn để phản hồi thao tác. Tên hiển thị, tiêu đề trang và metadata đã đổi thành PIPILABU. Khóa lưu lượt đang chờ `mach:pending:v1` được giữ để tránh mất UUID hoặc gửi lại lượt cũ khi cập nhật giao diện.

## Các màn hình

Giao diện chat dùng sidebar và hội thoại mở theo ảnh tham chiếu. Bấm thanh token trên đầu để mở thông tin, chỉnh hạn mức (admin), đổi tên, lưu trữ và xóa phiên. Model cho phiên mới nằm ở `/chat` hoặc trong hộp thoại thông tin phiên. Chọn **BytePlus ModelArk** sau khi điền cấu hình theo [hướng dẫn BytePlus](../backend/docs/BYTEPLUS.md).

- `/chat`: bắt đầu trò chuyện; phiên chỉ tạo khi bấm tạo mới hoặc gửi câu hỏi đầu tiên.
- `/chat/:id`: lịch sử, Markdown, sao chép, đổi tên, lưu trữ/khôi phục, xóa, token đầu vào/đầu ra và hạn mức.
- `/admin`: hạn mức mặc định, model, hướng dẫn AI, giới hạn câu hỏi/câu trả lời, tần suất sử dụng và đổi hạn mức phiên theo ID.
- `/admin/users`: quyền và trạng thái tài khoản.
- `/admin/requests`: usage, trạng thái lượt gọi và đối soát token đã xác minh.
- `/admin/audit`: nhật ký quản trị.

User thường không được truy cập quản trị. Thay đổi hạn mức mặc định áp dụng cho phiên mới. Chỉ quản trị viên được chỉnh hạn mức phiên active; phiên đã khóa không thể mở lại bằng tăng hạn mức.

## Gửi tin nhắn và khôi phục kết nối

Backend là nguồn dữ liệu về token và trạng thái phiên. Frontend không ước lượng quota bằng số ký tự. Câu trả lời chỉ được hiển thị sau khi backend trả kết quả đã quyết toán; không streaming trước khi kiểm tra usage.

Một lượt gửi có UUID riêng. Nếu mất phản hồi, nút **Kiểm tra kết quả** gửi lại cùng UUID và nội dung để backend lấy kết quả cũ. Không tự tạo lượt AI mới khi kết quả chưa rõ. Lượt đang xử lý được thăm dò trạng thái; phiên đang chờ usage dừng gửi và hướng dẫn tạo phiên mới.

Khi câu hỏi và lịch sử vượt ngân sách còn lại, backend từ chối riêng lượt này, không cộng token và giữ ô nhập để sửa câu hỏi. Phiên chưa bị khóa chỉ vì kiểm tra đầu vào. Khi phiên đã chạm hạn mức hoặc cần đóng sau inference, nút **Tạo phiên mới** trong phần thông báo mang câu hỏi sang ô nhập dưới dạng bản nháp; frontend không tự gửi lại trong phiên mới.

Chỉ lượt chưa xác nhận được lưu tạm trong `sessionStorage`, gắn với tài khoản và phiên; xóa khi hoàn tất hoặc đăng xuất. Lịch sử được lấy từ máy chủ. Cache dữ liệu được tách theo tài khoản và được thay mới khi đăng xuất/đổi người dùng. Tin nhắn lỗi còn lại trong ô nhập để sửa và gửi lại.

## Build và triển khai

```powershell
npm.cmd run typecheck
npm.cmd run build
```

`dist/` là bản production. Từ `backend/`, Wrangler đã cấu hình Workers Static Assets để phục vụ bản build và chạy Worker trước mọi đường dẫn `/api`. SPA routing hỗ trợ mở trực tiếp URL phiên chat hoặc quản trị. Đặt `APP_ORIGIN` theo domain HTTPS production, cấu hình D1 và secrets rồi triển khai theo tài liệu backend.

`npm.cmd run preview` dùng port 5173; dừng Vite dev trước khi preview. Cần backend vẫn chạy tại 8787 để API hoạt động. Bản preview production chỉ đăng nhập Google; điều khiển local không được đóng gói.

Hướng thiết kế và tự đánh giá: [DESIGN.md](DESIGN.md). Kết quả kiểm tra trình duyệt và giới hạn xác minh: [QA.md](QA.md).
