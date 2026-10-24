# PIPILABU — hướng thiết kế

## Bố cục theo ảnh tham chiếu

Yêu cầu mới thay bố cục ba cột bằng sidebar 312px và hội thoại rộng 924px căn giữa vùng còn lại. Nền than `#262521`, sidebar `#201F1C`, ô nhập `#30302C`, bong bóng `#3A3935`, chữ `#E8E7E3`, nhấn olive `#514B2E`; thước token dùng cam dịu. Chữ Be Vietnam Pro, nội dung 18px, điều khiển 15–16px; số token monospace 14px. Đầu trang có lời chào, thước token, theme và đăng xuất. Bot trả lời dạng văn bản, nút sao chép bên dưới; ô nhập bo 28px ở đáy. Giữ tên PIPILABU theo yêu cầu đã có; tên người dùng lấy từ tài khoản thực tế.

Rà brief: bỏ rail token, avatar bot, caption composer và các thẻ gợi ý; các hành động quản lý nằm trong hộp thoại mở từ thước token. Model được chọn cho phiên mới, có BytePlus với tên model từ backend. Theme sáng vẫn dùng được. Mobile dùng drawer lịch sử, header chia hai hàng khi cần và giữ ô nhập đủ rộng. Chuyển động và kiểm tra usage trước khi hiển thị giữ nguyên.


## Theme, chuyển động và chất lượng

Theme mặc định tối theo ảnh; lựa chọn sáng/tối lưu và đồng bộ qua localStorage. Bootstrap theme chạy trước React để tránh lóe nền. Đăng nhập, quản trị và dialog dùng cùng palette. Không thêm glow hoặc các hiệu ứng trang trí vào hội thoại.

Câu trả lời mới đã được backend quyết toán hiện dần theo cụm Unicode trong tối đa chín giây, có nút Hiện ngay. Lịch sử hiện đầy đủ, sao chép lấy toàn bộ câu trả lời. Cuộn theo khi ở cuối trang và giữ vị trí nếu đang đọc phía trên. Chuyển động 140–200ms phản hồi nút, dialog và drawer; reduced motion hiển thị ngay và tắt animation.

Thông tin, lỗi và quota lấy từ backend. Lỗi preflight giữ draft và phiên active; vượt quota thực tế hoặc usage chưa rõ giữ lại câu trả lời và có hướng tiếp tục. API key chỉ lưu ở backend. BytePlus dùng Tokenization của đúng model, không dùng công thức ký tự để tính số đã dùng.

Giữ focus bàn phím rõ, dialog giữ/khôi phục focus, drawer tách focus khỏi main. Mobile từ 360px không tràn ngang; placeholder ngắn ở mobile, Shift+Enter xuống dòng ở desktop, Enter gửi. Font được lưu trong bản build, Markdown không cho chạy HTML tùy ý. Kết quả kiểm tra và ảnh nằm trong QA.md và output/playwright.
