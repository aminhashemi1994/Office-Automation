# راه‌اندازی سرور LiveKit (تماس صوتی/تصویری و کنفرانس)

از این نسخه، تماس‌ها به‌جای WebRTC نقطه‌به‌نقطه (mesh) از یک سرور **LiveKit (SFU)**
عبور می‌کنند. سامانه فقط توکن اتصال می‌سازد؛ خودِ سرور LiveKit باید جدا اجرا شود.

سه متغیر در `.env` این دو بخش را به هم وصل می‌کنند:

```
LIVEKIT_URL=ws://localhost:7880        # آدرسی که مرورگر با آن وصل می‌شود
LIVEKIT_API_KEY=devkey                 # باید با کلید سرور LiveKit یکی باشد
LIVEKIT_API_SECRET=secret
```

---

## ۱) توسعه/تست روی همان دستگاه

سورس سرور در `livekit/livekit` قرار دارد. ساده‌ترین راه اجرای حالت dev:

```bash
# با باینری آماده (نصب: https://docs.livekit.io/home/self-hosting/local/)
livekit-server --dev

# یا از داخل همان سورس Go:
cd livekit/livekit && go run ./cmd/server --dev
```

حالت `--dev` کلیدها را ثابت `devkey` / `secret` می‌گذارد و روی `ws://localhost:7880`
گوش می‌دهد — دقیقاً همان مقادیر پیش‌فرض `.env`. کافی است سامانه را با
`npm run dev` بالا بیاورید و تماس بگیرید.

> نکته: مرورگر برای دسترسی به میکروفون/دوربین به «بستر امن» نیاز دارد؛ روی
> `localhost` مجاز است، ولی روی IP محلی با http نه. برای شبکه از HTTPS استفاده کنید.

---

## ۲) استقرار تولیدی (پشت nginx)

۱. تولید کلید واقعی:
```bash
livekit-server generate-keys
```
مقادیر خروجی را در `.env` (`LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET`) و در
`config.yaml` سرور LiveKit بگذارید.

۲. نمونهٔ `livekit.yaml`:
```yaml
port: 7880
rtc:
  udp_port: 7882          # یا بازهٔ port_range_start/end
  tcp_port: 7881          # برای عبور از فایروال‌های سخت‌گیر
  use_external_ip: true
keys:
  <API_KEY>: <API_SECRET>
```
اجرا: `livekit-server --config livekit.yaml`

۳. در `.env` سامانه:
```
LIVEKIT_URL=wss://automation.tooscore.ir/livekit
```
بلوک `location /livekit` در `deploy/automation.tooscore.ir.conf` وب‌سوکت را به
`127.0.0.1:7880` پراکسی می‌کند.

۴. **فایروال:** پورت‌های مدیا را باز کنید — `udp_port` (و در صورت نیاز `tcp_port`).
   بدون این، اتصال برقرار می‌شود ولی صدا/تصویر رد و بدل نمی‌شود.

---

## قابلیت‌های فعال‌شده در سمت کلاینت
- صدا و تصویر چندنفره (کنفرانس) با کیفیت وفق‌پذیر (`adaptiveStream` + `dynacast`)
- اشتراک صفحه (Screen Share)
- بی‌صدا/قطع میکروفون و دوربین
- تشخیص گویندهٔ فعال (هایلایت کاشی) و نشانگر کیفیت اتصال
- انتخاب دستگاه میکروفون/دوربین/بلندگو
- اتصال مجدد خودکار هنگام افت شبکه
- ضبط تماس (صوتی/تصویری) در سمت مرورگر و ذخیره روی سرور
