# KNOUX X — التهيئة الأولية قبل التخصيص

تمت إضافة سكربت Windows مخصص لتجهيز المشروع الموجود في:

```text
D:\Knoux-x.zip
```

ورفع النسخة الصحيحة إلى:

```text
https://github.com/daynightae-cmyk/knoux-x.git
```

## ما الذي ينفذه السكربت؟

- يتحقق من وجود ZIP وGit وNode.js وnpm.
- يحسب SHA-256 للملف المصدر.
- يفك الضغط داخل مجلد Staging معزول.
- يحدد تلقائيًا المشروع الحقيقي داخل `Knoux-x-main\KNOUX`.
- يستبعد نسخة Vite التجريبية المكررة خارج `KNOUX`.
- يحتفظ بنسخة احتياطية من Workspace السابق.
- ينشئ مجلدات وملفات Scaffold الناقصة قبل التخصيص.
- لا ينشئ ملفات ICO أو PNG صفرية تفسد عملية التغليف.
- يستبدل إعداد Webpack المفقود بمسار Electron Forge + Vite متماسك.
- ينشئ Manifest وتقرير Bootstrap وقائمة فحوص.
- ينشئ Commit ويرفعه إلى فرع `bootstrap/pre-customization-...` مستقل.
- لا يحتوي على GitHub Token أو API keys أو شهادات.

## التشغيل المباشر

ضع الملف المضغوط بالاسم التالي:

```text
D:\Knoux-x.zip
```

ثم شغّل:

```text
RUN-KNOUX-BOOTSTRAP.cmd
```

## تشغيل PowerShell يدويًا

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\Initialize-KnouxX.ps1 `
  -ZipPath "D:\Knoux-x.zip" `
  -RepositoryUrl "https://github.com/daynightae-cmyk/knoux-x.git" `
  -WorkspaceRoot "D:\Knoux-X-Bootstrap"
```

لتثبيت الحزم أثناء التهيئة:

```powershell
.\scripts\Initialize-KnouxX.ps1 -InstallDependencies
```

للمعاينة دون نسخ أو Commit أو Push:

```powershell
.\scripts\Initialize-KnouxX.ps1 -PlanOnly
```

## الناتج المتوقع

```text
D:\Knoux-X-Bootstrap\repository
D:\Knoux-X-Bootstrap\backups
D:\Knoux-X-Bootstrap\logs
```

بعد التشغيل راجع:

```text
docs\BOOTSTRAP-REPORT.md
docs\bootstrap-manifest.json
docs\CUSTOMIZATION-CHECKLIST.md
```

لا تبدأ التخصيص البصري أو إضافة الخصائص قبل نجاح مسار البناء الأساسي محليًا.
