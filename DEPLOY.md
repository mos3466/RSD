# نشر RASD على Render (أو Railway)

1. ارفع مجلد المشروع إلى مستودع GitHub (بدون node_modules و .env).
2. أنشئ قاعدة MySQL (مثلاً TiDB Cloud Serverless مجاني، أو Railway MySQL)، وانسخ رابط الاتصال إلى DATABASE_URL.
3. في Render: New > Blueprint > اختر المستودع. سيقرأ render.yaml تلقائياً.
4. عبّي المتغيرات الفارغة: DATABASE_URL, VITE_APP_ID, OWNER_OPEN_ID, BUILT_IN_FORGE_API_KEY.
   - VITE_* تُقرأ وقت البناء، فأي تغيير فيها يحتاج Redeploy.
5. أنشئ الجداول مرة واحدة من جهازك:
   DATABASE_URL="<الرابط>" pnpm db:push
6. افتح https://<اسم-الخدمة>.onrender.com/api/health وتأكد إن ok = true.
7. في إعدادات تطبيق Manus OAuth أضف الرابط الجديد كـ Redirect URL.

Railway: نفس الخطوات، Build = pnpm build ، Start = pnpm start ، وأضف نفس المتغيرات يدوياً.
