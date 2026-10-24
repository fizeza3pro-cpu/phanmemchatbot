# PIPILABU

Ứng dụng chatbot tiếng Việt **PIPILABU**, hỗ trợ Cloudflare Workers AI, Groq GPT‑OSS và BytePlus ModelArk, giới hạn token theo phiên. Backend nằm trong `backend/`, giao diện React nằm trong `frontend/`.

```text
backend/
  worker/
  shared/
  migrations/
  tests/
  docs/
  package.json
  wrangler.jsonc
  README.md
frontend/
  src/
  public/
  package.json
  vite.config.ts
  README.md
PLAN.md
```

Cài và build frontend trước, từ thư mục gốc dự án:

```powershell
cd frontend
npm.cmd ci
npm.cmd run build
```

Chạy backend trong terminal thứ nhất:

```powershell
cd backend
npm.cmd ci
npm.cmd run db:migrate:local
npm.cmd run dev
```

Chạy frontend trong terminal thứ hai:

```powershell
cd frontend
npm.cmd run dev
```

Mở **http://localhost:5173**. Đăng nhập local bằng `admin@example.test` trong mục dành cho môi trường phát triển để thử giao diện và quản trị. Chat thật cần credentials của provider đã chọn trong backend; đăng nhập production cần Google OAuth. [Cấu hình BytePlus](backend/docs/BYTEPLUS.md).

Hướng dẫn giao diện: [frontend/README.md](frontend/README.md). Cấu hình credentials và triển khai: [backend/README.md](backend/README.md).

Hợp đồng API: [backend/docs/API.md](backend/docs/API.md). Kế hoạch toàn dự án: [PLAN.md](PLAN.md).
