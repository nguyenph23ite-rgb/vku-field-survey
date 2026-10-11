# VKU Field Survey — Offline Data Collection

Ứng dụng khảo sát cơ sở vật chất trong khuôn viên VKU, hướng đến việc
ghi nhận dữ liệu khi mất kết nối và đồng bộ khi mạng hoạt động trở lại.

## Công nghệ

- TypeScript và Vite
- Progressive Web App (PWA)
- Service Worker và Cache Storage
- IndexedDB để lưu phiếu khảo sát trên thiết bị
- Capacitor để đóng gói ứng dụng Android
- Capacitor Camera và Geolocation
- Node.js để chạy API tiếp nhận phiếu khảo sát

## Chức năng

- Tạo và lưu phiếu khảo sát trên thiết bị.
- Hỗ trợ lưu dữ liệu khi ngoại tuyến.
- Có hàng đợi đồng bộ phiếu khảo sát lên API.
- Chụp ảnh bằng plugin Camera trong ứng dụng Android.
- Có tích hợp plugin Geolocation; cần kiểm thử riêng việc lấy tọa độ thực tế.
- Có Service Worker để lưu bộ tài nguyên ứng dụng phục vụ sử dụng ngoại tuyến.

## Yêu cầu

- Node.js và npm
- Android Studio và Android SDK nếu chạy ứng dụng Android
- Thiết bị Android hoặc trình giả lập để kiểm thử các chức năng gốc

## Cài đặt và chạy bản web

```powershell
npm install
npm run dev
```

Mở địa chỉ mà Vite hiển thị trong cửa sổ dòng lệnh.

## Kiểm tra bản dựng

```powershell
npm run build
```

Lệnh này kiểm tra TypeScript, tạo bản dựng trong thư mục `dist`
và chạy script hoàn thiện danh sách tài nguyên của Service Worker.

Có thể xem bản dựng bằng:

```powershell
npm run preview
```

## Chạy API cục bộ

Mở một cửa sổ PowerShell tại thư mục dự án:

```powershell
node .\server.cjs
```

API sử dụng cổng 3000. Có thể kiểm tra tình trạng máy chủ tại:

```text
http://localhost:3000/api/health
```

API hiện có các đường dẫn:

- `GET /api/health`
- `GET /api/surveys`
- `POST /api/surveys`
- `DELETE /api/surveys/:id`

Dữ liệu thử nghiệm được lưu trong `server-data/surveys.json`.
Tệp dữ liệu này và các bản sao lưu không được đưa vào Git.

## Chạy ứng dụng Android

Sau khi cài các gói npm và hoàn tất bản dựng web:

```powershell
npx cap sync android
npx cap open android
```

Sau đó dùng Android Studio để dựng và chạy ứng dụng.

Nếu API đang chạy trên máy phát triển ở cổng 3000 và ứng dụng Android
được cấu hình gọi cổng 3001 trên thiết bị giả lập, có thể chuyển tiếp cổng:

```powershell
adb reverse tcp:3001 tcp:3000
```

Địa chỉ API của ứng dụng phải khớp với cấu hình hiện hành. Khi triển khai
trên máy chủ thật, cần cấu hình URL API phù hợp thay cho địa chỉ cục bộ.

## Cấu trúc chính

```text
src/                  Mã nguồn giao diện và nghiệp vụ
public/               Manifest, Service Worker và tài nguyên tĩnh
scripts/              Script hỗ trợ bản dựng
server.cjs            API Node.js
capacitor.config.ts   Cấu hình Capacitor
android/              Dự án Android
```

## Lưu ý

- Dữ liệu trong IndexedDB là dữ liệu cục bộ của trình duyệt hoặc ứng dụng.
- Cần kiểm thử riêng việc đồng bộ khi mất mạng, khôi phục kết nối và xử lý
  dữ liệu trùng lặp trên máy chủ.
- Cần xác minh quyền truy cập và kết quả lấy tọa độ GPS trên thiết bị thật.
- Chưa cung cấp URL demo công khai trong tài liệu này.

