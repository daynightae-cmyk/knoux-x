# KNOuX X — تسليم التكامل، 20 أكتوبر 2026

## REALITY

الدفعة اتنفذت واترفعت، لكن القبول الكامل **لسه غير مغلق**. التوصية: **عدم دمج main**.
تسجيل Capacitor App وتكافؤ Debug/Release اتصلحوا، وBack اتثبت في حالات فعلية
على نسختَي APK. المانعان المستقلان: فقد محاكي API35 أثناء SAF/Player، وعدم
استقرار تصدير Windows عند حارس مدة الفيديو.

الأساس المتحقق وقت البداية وإعادة الفحص: PR #60 على
`1d76a0db840f82606a70ecccfbc1dea5e734a914`، وفرع integration ما زال عليه.
آخر كود مختبر: `ee1a62fdbf476371182c9231592261a89c2feee3`.
APKا API35 على `33764b600a2716991bd2b4d5f5f5285ef06dc268`.
Windows packaged identity: `3e74e493bc03d484f80ffc9a5a1d721174e55ce2`.
الاختلافات اللاحقة في أدوات الاختبار والتشخيص، وليس واجهة المنتج أو محركه.

## CHANGES

- `package.json` و`package-lock.json`: Core/CLI/Android=8.5.0 وApp=8.1.2.
  Debug كان ينزل App بـ--no-save وRelease لا ينزله، والحزمة لم تكن معلنة في
  dependencies. اكتشاف Capacitor يعتمد على manifest، فالتنزيل وحده لم يكفِ.
  كل إصدارات الحزم القديمة المقفولة اتاحتفظ بها من غير تغيير.
- `tools/verify-android-app-plugin.cjs` واختباراته: رفض غياب الحزمة أو انجراف
  النسخة أو غياب AppPlugin من JSON أو Gradle. cap add/sync الحقيقي والبناءان نجحوا.
- workflowا Android: npm ci مقفول، نفس functional suite، ومدخل API35/34
  للمقارنة. Release لا يعلن PASS من غير نجاح الحالات الفعلية.
- `prepare-android-native-media.cjs` و`prepare-android-functional-closure.cjs`:
  تشخيص Activity/memory/WebView termination ونتيجة SAF وعدد العناصر. لا
  autoreload ولا إخفاء crashes ولا طباعة محتوى الملفات.
- `android-acceptance-diagnostics.sh` و`run-android-installed-acceptance.sh`:
  logcat وADB وصحة المضيف قبل الفقد، وkernel/journal/cgroup عند توفرها.
  كود فشل الأمر الأصلي محفوظ؛ اختبار exit 37 أعاده 37.
- `android-real-workflows.cjs` و`android-native-core.cjs`: قياس native bounds،
  منع API-play/seek fallback PASS، Back بإدخال ADB، restart حقيقي لاختبار
  slideshow، وswipe/split/save. الحالات التي لم تُنفذ تظل blocked.
- `run-packaged-timeline-export-cdp-e2e.cjs`: استبدال DOM click الذي يتخطى
  overlay بماوس CDP بعد hit-test، وتخطي التعريف من زرّه عند ظهوره. fixture
  project يُنشأ عبر production IPC؛ لا ادعاء بإنشائه يدويًا أو بلمس مادي.

كل أسماء الأدوات أعلاه تحت tools/؛ مصفوفة العقود التفصيلية في CONTRACTS.md.

## GIT

- worktree منفصل: `K:\Knoux Projects\knoux-x\Worktrees\Knoux-X-Integration-Closure-20261020`.
- الفرع: `feat/knoux-x-integration-closure-20261020`.
- [Draft PR #61](https://github.com/daynightae-cmyk/knoux-x/pull/61) إلى
  `feat/knoux-x-integration-20261019`. آخر فحص MERGEABLE يثبت غياب التعارض
  النصي فقط، ولا يثبت قبول الإصدار.
- #57: back policy وatomic rename retry موجودان بالفعل مع اختبارات أقوى.
  اتاحتفظ بالفرق اللازم لتسجيل App/Back runtime؛ مفيش cherry-pick كامل يعيد
  viewport checks الأقدم أو يشترط موت process بدل خروج Activity.
- #52: الفرق الفريد المتبقي كتابة React imports/namespace؛ استثناء Android
  من StrictMode والـoptional lazy overlay موجودان. لا تحسين سلوكي فريد للنقل.
- لا حذف فروع أو commits أو stashes أو worktrees. ملفات البناء والتجارب
  غير المتتبعة محفوظة؛ لا reset/clean ولا git add -A.

## TESTS

| الاختبار | النتيجة وحدودها |
|---|---|
| CI على ee1a62f | TypeScript/lint PASS؛ 152 suites / 1335 tests PASS |
| plugin/bounds/release contract محلي | 3 suites / 18 tests PASS |
| أول full checkpoint محلي | 151 suites / 1329 tests PASS |
| full rerun محلي لاحق | Beauty تجاوز 30s؛ isolated rerun 5/5 PASS، من غير رفع المهلة؛ توقيت غير مستقر |
| إعداد البناء | YAML، Bash/JS syntax، lock dry-run، generated plugin/Gradle PASS |
| [Debug API35 39345446893](https://github.com/daynightae-cmyk/knoux-x/actions/runs/39345446893) | build/static/launch PASS؛ onboarding/Back PASS؛ suite FAIL أثناء playback |
| [Release API35 39345460085](https://github.com/daynightae-cmyk/knoux-x/actions/runs/39345460085) | نفس الحدود؛ acceptance لم تتحول PASS |
| [Debug API34 39354147723](https://github.com/daynightae-cmyk/knoux-x/actions/runs/39354147723) | build/static/launch PASS؛ initial WebView attach timeout، لا cases |
| Windows package + IPC | PASS على packaged SHA 3e74e49؛ ASAR/context bridge حقيقيان |
| Windows timeline export | FAIL ثم ملف فعلي ناجح ثم FAIL بالنقر الأقوى؛ غير مستقر |
| هاتف حقيقي | NOT_RUN؛ لا جهاز أو Android SDK محلي متاح وقت التنفيذ |

اتصلح خطآن في harness أثناء التنفيذ: quoting متعدد الأسطر عند emulator-runner،
وعقد Release القديم بعد نقل التنفيذ إلى shared runner. محاولة محلية استُخدم
فيها Vitest بالخطأ لم تشغل اختبارات Jest؛ أُعيد الأمر الصحيح ونجح 18/18.
لا تُحسب تلك المحاولة نتيجة وظيفية للمنتج.

أدلة API35: SAF result=-1 ثم count=1 ثم Activity resume في البناءين. بعدها
انقطع logcat ثم اختفى host QEMU PID 4815 بحلول 00:13:01Z وPID 4966 بحلول
00:12:53Z قبل cleanup. الذاكرة المتاحة نحو 9.4 GiB، من غير swap مستخدم قبل
الاختفاء. لم يظهر renderer-gone أو fatal app crash في السطور المختارة المسجلة.
**سبب الخروج غير مثبت**؛ ده لا يثبت OOM ولا سبب crash المنتج أو المحاكي.

API34 مختلف: app PID 3640 وADB وQEMU ظلوا أحياء؛ WebView provider
`com.google.android.webview 113.0.5672.136`. فشل attach قبل SAF وأي case؛
kernel وجزء التشخيص محفوظان في android-api34-ee1a62f/diagnostics.json.
النتيجة لا تثبت سبب API35 ولا تعتبر API34 حلًا.

## VISUAL

لا source changes في src/ أو assets/ أو public/ مقارنة بأساس integration.
الهوية والثيمات وRTL/motion محفوظة بالكود؛ ده لا يعادل إعادة قبول كل الشاشات.
راجعت screenshots فعلية من Debug/Release عند 360×800 و390×844 و412×915،
وقست أبعاد PNG. اللقطات أساسًا onboarding إنجليزي؛ لا ادعاء بكل routes أو
العربية أو landscape في هذه الدفعة.

لقطة Windows الجديدة 1264×761 تُظهر المحرر ورسالة رفض التصدير بلا overlay.
اللقطة القديمة المصاحبة لمحاولة service PASS تُظهر onboarding فوق المحرر؛
اسمها الصريح windows-service-pass-onboarding-overlay.png، وحدودها محفوظة.

## FUNCTIONAL

| المسار | الحالة الحالية |
|---|---|
| Cold launch → onboarding → Home | ANDROID_EMULATOR_VERIFIED في Debug/Release API35 |
| Back: drawer وSettings → Home | ANDROID_EMULATOR_VERIFIED في البناءين؛ KEYCODE_BACK فعلي |
| SAF selection | PARTIAL؛ native callback أعاد عنصرًا؛ player case لم يكتمل |
| Player decode/seek/pause/resume/audio | BLOCKED بفقد session/emulator؛ لا synthetic fallback PASS |
| Recording finalize/ffprobe/editor | BLOCKED؛ لم تُحاول بعد فقد الجلسة |
| Photos-to-Video restart restoration | BLOCKED؛ الاختبار الأقوى موجود ولم يصل للتنفيذ |
| Native timeline وroot Back exit | BLOCKED؛ لم تُنفذ بعد الفقد |
| Photo/Beauty native save/reopen | NOT_TESTED؛ unit coverage لا تثبت ملفًا محفوظًا على الجهاز |
| Windows persistence/openRecent/title selection | VERIFIED في packaged renderer/IPC؛ آخر اختيار بماوس CDP مع hit-test |
| Windows durable export | PARTIAL/UNSTABLE؛ ملف ناجح محفوظ، وآخر محاولة رُفضت |

الملف الناجح outputs/windows-timeline-3e74e49.webm حجمه 1,234,821 bytes،
VP8+Opus، 1920×1080، 99 video packets، مدى PTS مقاس 3.328s لمشروع 3.5s
ضمن الحارس القائم 0.35s. header duration=0؛ لم أعتمد عليه. early/late frames
اتعملها strict decode والعنوان موجود بعد انتهاء source عند 1.5s. SHA256:
`5903175096314c03e87a8b1db6afe0f0a10689fce226aa665256a33f43523f42`.
النجاح لا يلغي محاولتَي الفشل ولا يثبت موثوقية التصدير.

Release APK هو TEST_SIGNED وproductionSigned=false وحالته BUILT. APK
checksums والمسارات وrun URLs في provenance JSON لكل بناء؛ APKs والـraw
logs في GitHub artifacts وتحت _temp/ محليًا. لم يتغير توقيع owner.

## MERGE

لا merge إلى main أو Recovery أو PR60. #61 يظل Draft للمراجعة. إصلاح تسجيل
dependencies والتشخيص قابلان للمراجعة مستقلين، لكن **الشجرة المجمعة غير مقبولة
للإصدار**. أهلية main تتطلب installed suite كاملة، وملفات export سليمة يعاد
فتحها، وإغلاق عدم استقرار Windows، وتوثيق الجهاز وحدود التحقق. مفيش نشر إنتاجي.

## NEXT

1. مهمة runner صغيرة: exit code/core dump لـQEMU API35 مع kernel/cgroup logs،
   وتشخيص API34 devtools sockets/provider، ثم جهاز فعلي أو emulator مستقل.
2. مهمة Player/SAF: MP4 chooser ثم frame وtrusted play/seek/pause/resume
   ثم القراءة بعد restart، وكل نتيجة مرتبطة بالـAPK SHA.
3. Recording ثم Slideshow ثم Timeline: تشغيل الحالات المحجوبة والتحقق من
   bytes/ffprobe/reopen بالتتابع؛ بلا إعادة تصميم.
4. Windows export: قياس أول/آخر encoded timestamps وبدء/تفريغ recorder حول
   generator/manual capture؛ تثبيت سبب truncation قبل إصلاحه، بلا توسيع tolerance.
5. Photo/Beauty: صورة فعلية ومعالجة حقيقية ثم native save وإثبات الملف وإعادة فتحه.

توقفت عند تسليم دفعة التكامل دي؛ لم أبدأ redesign أو cleanup أو خدمة جديدة.
