# KNOUX Player X — إغلاق المرحلة 01

هذه الحزمة تُحاذي TypeScript وESLint، تصلح أخطاء TypeScript المعروفة، تحفظ نسخة احتياطية مؤرخة، ثم تشغّل بوابات التحقق دون العمل على `main`.

## التشغيل المحلي

1. أغلق أي نسخة مفتوحة من KNOUX Player X.
2. شغّل `RUN-PHASE-01-CLOSEOUT.cmd`.
3. بعد نجاح الإصلاح شغّل `VERIFY-PHASE-01-CLOSEOUT.cmd`.
4. عند الحاجة استخدم `ROLLBACK-PHASE-01-CLOSEOUT.cmd` لاستعادة أحدث نسخة احتياطية.

## البيئة المطلوبة

- Windows PowerShell 5.1 أو أحدث.
- Node.js المحمول `v20.20.2` داخل `D:\Knoux-X-Bootstrap\.tools\node-v20.20.2-win-x64`.
- Visual Studio Build Tools 2022 مع MSVC x64/x86.

لا تنفذ الحزمة على `main` أو `master`. لا تدمج الفرع تلقائيًا.
