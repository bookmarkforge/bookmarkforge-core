# Hướng dẫn sử dụng — BookmarkForge v1

**Phiên bản:** 1.0.0 · **Cập nhật:** tháng 9 năm 2026 · **Giấy phép:** MIT

## Bắt đầu

BookmarkForge lưu dấu trang, ghi chú và tài liệu để giúp bạn sắp xếp kiến thức cá nhân. Nội dung két dữ liệu nằm trong bộ nhớ cục bộ của trình duyệt và không được gửi đến BookmarkForge. Nhà cung cấp AI bên ngoài chỉ nhận dữ liệu bạn chủ động gửi cho tính năng đó.

Két dữ liệu được mã hóa cục bộ bằng AES-GCM; Argon2id tạo khóa từ mật khẩu chính. Bộ phận hỗ trợ không thể khôi phục mật khẩu đã mất.

1. Mở [bookmarkforgeapp.com](https://bookmarkforgeapp.com).
2. Tạo mật khẩu chính dài ít nhất 12 ký tự.
3. Lưu an toàn 24 từ khôi phục.
4. Thường xuyên xuất bản sao lưu `.bmf` đã mã hóa.

## Dấu trang và tìm kiếm

Free có tìm kiếm thông minh theo từ khóa và ý nghĩa. Free hỗ trợ **2.500 dấu trang** và không giới hạn số thiết bị; nếu không dùng đồng bộ Pro, mỗi thiết bị có một két riêng. Khi đạt 2.500, không dữ liệu nào bị xóa: đọc, tìm kiếm và xuất vẫn hoạt động, chỉ việc lưu mới bị tạm dừng. Pro bỏ giới hạn và đồng bộ tối đa năm thiết bị qua P2P.

## Nhập từ Pocket

Vào **Cài đặt → Nhập** rồi chọn `ril_export.html` hoặc CSV xuất từ Pocket. Trước khi lưu, ứng dụng hiển thị bản xem trước gồm liên kết, ngày tháng và thẻ. Trạng thái đã đọc, chưa đọc và đã lưu trữ được giữ nguyên. Khi đạt giới hạn Free, kết quả nêu rõ số mục đã nhập và việc đã chạm giới hạn; các mục còn lại không bị tính là bỏ qua.

## Ghi chú, AI và đồng bộ

Trình chỉnh sửa hỗ trợ ghi chú có cấu trúc, bảng và liên kết giữa tài liệu. AI cục bộ WebLLM/Ollama, trò chuyện RAG, thẻ ghi nhớ và đồng bộ P2P là tính năng Pro. Khi dùng API key riêng, điều khoản của nhà cung cấp tương ứng sẽ áp dụng.

## Sao lưu và hỗ trợ

Lưu nhiều bản `.bmf` ở các vị trí khác nhau. Khôi phục cần mật khẩu chính. Nếu không lưu được, kiểm tra bộ đếm Free; nếu đồng bộ lỗi, kiểm tra mạng, tường lửa và ID thiết bị. Không gửi mật khẩu hoặc từ khôi phục cho bộ phận hỗ trợ.

Hỗ trợ: `bookmarkforge@proton.me`.

*Cập nhật: tháng 9 năm 2026 · Phiên bản 1.0.0*