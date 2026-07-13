# QR Rental Asset Manager

Web app quản lý tài sản/thiết bị cho thuê bằng QR code: nhập kho, in tem QR, xuất kho theo show (quét QR bằng camera điện thoại), tự động tính khấu hao.

Không cần cài `npm install` — chỉ dùng các module lõi của Node.js (http, fs, crypto), nên chạy được ngay cả trên môi trường bị chặn truy cập internet/npm registry.

## Chạy thử trên máy tính (local)

```
cd qr-rental-app
node server.js
```

Mở trình duyệt: `http://localhost:3000`

Dữ liệu lưu trong file `data/db.json`. **Hãy backup file này định kỳ** (copy ra Google Drive/USB) vì đây là toàn bộ database của bạn.

## Dùng chung giữa máy tính (nhập kho) và điện thoại (quét QR)

Camera chỉ hoạt động qua **HTTPS** hoặc `localhost` (giới hạn bảo mật của trình duyệt) — điện thoại không thể quét camera qua địa chỉ IP nội bộ dạng `http://192.168.x.x`. Vì vậy để dùng điện thoại quét QR thực tế, bạn cần deploy app lên một địa chỉ HTTPS. Hai cách:

### Cách 1 — Deploy lên Render.com (miễn phí, khuyên dùng)
1. Tạo tài khoản tại render.com, tạo **Web Service** mới, kết nối repo chứa thư mục `qr-rental-app` (đẩy code lên GitHub trước).
2. Build command: để trống. Start command: `node server.js`.
3. Vào tab **Disks**, gắn 1 **Persistent Disk** (ví dụ 1GB) mount vào đường dẫn `/opt/render/project/src/data` — bắt buộc, nếu không dữ liệu sẽ mất mỗi lần deploy lại.
4. Sau khi deploy xong bạn có 1 địa chỉ dạng `https://ten-app.onrender.com`, dùng địa chỉ này trên cả máy tính và điện thoại.

### Cách 2 — Chạy tại chỗ + Cloudflare Tunnel / ngrok
Chạy `node server.js` trên 1 máy tính tại văn phòng, rồi dùng `cloudflared tunnel` hoặc `ngrok http 3000` để có link HTTPS công khai trỏ vào máy đó. Phù hợp nếu muốn giữ dữ liệu tại chỗ, không đưa lên cloud.

Nếu chỉ cần dùng nội bộ (không cần camera điện thoại thật, quét bằng máy quét mã vạch USB gắn vào máy tính thay vì camera), thì **không cần HTTPS** — chỉ cần chạy `node server.js` trên 1 máy trong văn phòng rồi các máy khác truy cập qua `http://<ip-máy-đó>:3000`, dùng ô "Nhập mã thủ công" hoặc máy quét mã vạch (hoạt động như bàn phím, gõ mã vào rồi Enter).

## Cấu trúc tính năng

**Nhập kho** (`/nhap-kho.html`): Nhóm sản phẩm → Chủng loại → Nhãn hiệu → Model → Mô tả → Ngày sản xuất → Ngày nhập → Giá trị nhập → Kiểu khấu hao (tháng/show) → Số kỳ dự kiến. Hệ thống tự tính đơn giá khấu hao danh định = giá trị nhập / số kỳ dự kiến.

**In tem QR** (`/tem.html`): chọn thiết bị, chọn 1 trong 3 size tem (30×20mm / 50×30mm / 80×50mm), chọn số lượng bản in, bấm In. Mã QR và tên hiển thị trên tem lấy trực tiếp từ mã ngắn (`qrCode`) — sửa mã này tại trang Nhập kho bất cứ lúc nào rồi quay lại in lại.

**Xuất kho** (`/xuat-kho.html`): tạo show mới (tên show, khách hàng, địa điểm, thời gian từ–đến) → quét QR bằng camera hoặc nhập mã tay → hệ thống tự nhận diện thiết bị, tự trừ khấu hao (thiết bị loại "show" trừ 1 đơn giá cố định; thiết bị loại "tháng" trừ theo tỷ lệ số ngày thuê/30) → hiển thị danh sách + tổng khấu hao của đơn hàng, xuất CSV.

**Lịch sử** (`/lich-su.html`): xem lại toàn bộ các show đã xuất kho.

## Công thức khấu hao

- `depreciationUnitValue` (đơn giá khấu hao danh định) = `importValue / depreciationPeriod`
- Loại **show**: mỗi lần quét trừ đúng 1 `depreciationUnitValue`.
- Loại **tháng**: mỗi lần quét trừ `depreciationUnitValue × (số ngày thuê / 30)`, số ngày thuê tính từ giờ bắt đầu–kết thúc của show.
- `remainingValue` (giá trị còn lại) = `importValue − tổng đã khấu hao`, không bao giờ âm.
- `rentalCount` (số lần đã cho thuê) tăng 1 mỗi lần thiết bị được quét vào 1 show.

## Tư vấn thêm

**Phần cứng in tem:** máy in tem nhiệt (thermal) như Xprinter XP-365B/465B hoặc Brother QL-800 in trực tiếp theo đúng kích thước tem đã chọn (khổ giấy đặt bằng đúng size trong hộp thoại in của trình duyệt). Dùng giấy tem decal nhựa (PET) chống nước, chống trầy cho thiết bị âm thanh ánh sáng hay di chuyển ngoài trời.

**Máy quét mã vạch USB/Bluetooth** (kiểu bàn phím ảo) hữu ích khi không muốn dùng camera điện thoại — quét phát ra chuỗi ký tự + Enter, ô "Nhập mã thủ công" trên trang Xuất kho sẽ nhận ngay.

**Backup & mở rộng dữ liệu:** hiện dùng 1 file JSON (`data/db.json`), đơn giản và đủ dùng cho quy mô vài trăm–vài nghìn thiết bị. Nếu đội ngũ lớn hơn, nhiều người dùng thao tác đồng thời thường xuyên, nên nâng cấp sang PostgreSQL (ví dụ Supabase/Neon có gói miễn phí) để tránh xung đột ghi file.

**Phân quyền đăng nhập:** bản hiện tại chưa có đăng nhập — ai có link đều thao tác được. Nếu cần phân quyền (nhân viên kho / quản lý), có thể bổ sung đăng nhập đơn giản (mật khẩu chung) hoặc tài khoản riêng từng nhân viên.

**Trả kho / bảo trì:** đã có nút "Thiết bị đã về kho" để mở lại trạng thái sẵn sàng cho thuê sau khi show kết thúc. Có thể mở rộng thêm luồng "Bảo trì/hỏng hóc" nếu cần theo dõi thiết bị tạm ngưng cho thuê.

**Báo cáo:** trang Lịch sử hiện xuất CSV theo từng show; có thể bổ sung báo cáo tổng hợp theo tháng/quý (tổng khấu hao, tài sản khấu hao gần hết) nếu cần.
