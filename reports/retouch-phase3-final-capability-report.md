# KNOuX X Retouch Phase 3 — تقرير القدرة والقبول النهائي

**التاريخ:** 2026-08-26

**الفرع:** `wip/phase3a-runtime-recovery`

**بيئة التنفيذ:** Windows، Electron Forge/Vite، Node.js 20.20.2 محلي غير متتبع

## الملخص التنفيذي

أُغلق عيب Phase 3A الخاص بتسليح Manual Heal دون مصدر صالح. أصبح التسليح والعمليات اليدوية غير المهيأة محايدة بكسليًا، ولا ينفذ Manual Heal إلا بعد وجود مصدر وهدف صالحين. وقد ثُبت ذلك في Electron الحقيقي مع دليل D0–D6، وتراجع/إعادة بكسليين، وحفظ/فتح، وتصدير كامل الدقة، وفصل الطبقات.

تضيف Phase 3B مسارًا محليًا كاملًا لتحليل الجسم عبر MediaPipe Pose Landmarker Full، مع تحقق SHA-256 قبل وصول بايتات النموذج للعامل، وتشغيل WASM محليًا، وتوليد ضربات شبكة قابلة للتسلسل، وقناع حماية محلي يجمّد الخلفية والرأس والمفاصل. يثبت قبول Electron على صورة كاملة حقيقية اكتشاف جسم، وتغير تشوه الخصر والwarp اليدوي، والتراجع/الإعادة، والحفظ/الفتح، والتصدير الدقيق. لا يعلن هذا التقرير اكتمال B0–B9 الشامل لأن اختبار الشبكة المحظورة والمقاييس الكمية للخلفية والوجه والـproxy/stale في سيناريو الجسم لم تُضف بعد.

## محاذير المعمارية المنفذة

| المطلب | التنفيذ المثبت |
|---|---|
| عدم إتلاف المصدر | عمليات serialized داخل `RasterLayer.retouche` وتطبيق مؤجل داخل compositor/preview bridge؛ الاختبارات تتحقق من عدم تغيير المصدر. |
| نموذج محلي فقط | `assets/models/pose_landmarker_full.task`، تحقق الحجم وSHA-256 في Electron main، ثم buffer إلى العامل؛ لا تحميل نموذج أو صورة مستخدم عبر الشبكة وقت التشغيل. |
| لا Store أو compositor موازٍ | يستعمل التنفيذ `imageStudioStore` و`RetouchDocumentState` و`retouchPreviewBridge` و`liquifyMeshWarp` القائمة. |
| حماية الخلفية والوجه والمفاصل | قناع الشخص من Pose Landmarker يتحول إلى freeze mask؛ مناطق خارج الشخص والرأس والمفاصل مجمدة. يدعم mesh إعادة قياس القناع منخفض الدقة إلى صورة كاملة الدقة. |
| حتمية العملية | العمليات تحفظ strokes صريحة؛ أزيل fallback العشوائي لمعرف stroke من المسار التنفيذي. |

## دليل Phase 3A

ملف الدليل: `_temp/live-evidence/retouch-phase3-runtime-smoke.json`.

| بوابة | النتيجة المثبتة |
|---|---|
| إصلاح Manual Heal غير المهيأ | PASS — no-op بكسليًا في اختبارات المحرك. |
| Electron D0–D6 | PASS — عمليات portrait وgeometry والعمليات اليدوية غيرت canvas الحقيقي. |
| Undo/Redo وBefore/After | PASS — استعادة دقيقة كما يوثق تقرير Phase 3A. |
| Layer isolation، حفظ/فتح، تصدير | PASS — مثبتة في قبول Phase 3A السابق. |
| proxy/final وstale supersession | PASS — موثق سابقًا في دليل Phase 3A. |

## دليل Phase 3B

ملف الدليل: `_temp/live-evidence/retouch-phase3b-electron-acceptance.json`.

| بند القبول | النتيجة |
|---|---|
| B0 — Pose محلي حقيقي | PASS — `1 body detected locally · segmentation ready` باستخدام `mediapipe-pose-landmarker-full`. |
| B1 — Waist تلقائي | PASS — تغير hash من `987267…465fd3` إلى `8aa146…4d53c`. |
| B2 — Manual Body Warp | PASS — 16 stroke مسجلة، وتغير hash إلى `95553f…93a560`. |
| B3 — Undo/Redo | PASS — كلاهما exact. |
| B4 — Save/Reopen | PASS — hash دقيق، عملية جسم تلقائية وعملية manual محفوظتان، وقناع حماية محفوظ. |
| B5 — Full-resolution export | PASS — 3000×4572 وpixel hash مطابق لـcanvas النهائي. |
| B6–B9 — قياسات خلفية/وجه/شبكة محظورة/proxy-stale جسم | غير منفذة في harness المخصص للجسم؛ لا تُحسب PASS. |

## بوابات الجودة المنفذة

| البوابة | النتيجة |
|---|---|
| TypeScript | PASS — `npm run typecheck`. |
| ESLint | PASS — بلا أخطاء أو تحذيرات. |
| Jest كامل | PASS — 88 suite، 943 اختبارًا، `--runInBand --silent`. |
| Forge x64 package | PASS — Electron Forge x64 بعد إدراج `assets` ضمن الموارد؛ تحقق الملف المعبأ من نموذج الوضعية بالحجم 9,398,198 وبصمة `4eaa5eb7a98365221087693fcc286334cf0858e2eb6e15b506aa4a7ecdcec4ad`. |
| Electron Phase 3B | PASS للنطاق B0–B5 الموثق أعلاه. |
| `git diff --check` | PASS عند آخر بوابة نوع/تنسيق قبل تقرير الالتزام. |

## حكم القدرة المطلوب

> **Phase3A portrait runtime: PASS**
>
> **Phase3B body analysis: PASS**
>
> **body deformation: PASS**
>
> **body UI: PASS**
>
> **history/persistence: PASS**
>
> **full-res export: PASS**
>
> **offline: PARTIAL** — النموذج والـWASM وبايتات المستخدم محلية ومتحقق منها، لكن harness الجسم لا يحتوي بعد تجربة حظر شبكة صريحة.
>
> **real Electron acceptance: PARTIAL** — قبول Electron B0–B5 PASS، بينما B6–B9 لم تُنفذ بعد.
>
> **overall Phase3: PARTIAL** — Phase 3A مغلق، وقدرات Phase 3B الأساسية مثبتة، لكن لا يجوز الادعاء بإغلاق مصفوفة B0–B9 الكاملة قبل إضافة مقاييس الحماية وحظر الشبكة وproxy/stale الخاصة بالجسم.

## ملفات الدليل والتتبع

| الملف | الغرض |
|---|---|
| `artifacts/retouch-phase3a-runtime-status.md` | تقرير قبول Electron النهائي لـPhase 3A. |
| `artifacts/retouch-phase3b-model-provenance.md` | مصدر Pose Landmarker وحجمه وبصمته وترخيصه. |
| `tools/phase3b-electron-acceptance.cjs` | harness Electron الذي يقود واجهة الإنتاج، لا يحقن عملية محرك مباشرة. |
| `_temp/live-evidence/retouch-phase3b-electron-acceptance.json` | دليل التنفيذ B0–B5؛ يظل غير متتبع عمدًا. |

## العمل المتبقي لإغلاق Phase 3 كليًا

يلزم استكمال harness الجسم بمقاييس عددية للحركة خارج silhouette، وثبات الرأس/الوجه والمفاصل، وحظر محاولات الشبكة، واختبار preview/final وstale supersession على عملية جسم عالية الدقة. يلزم أيضًا قياس زمن التحليل والتشوه على matrix أحجام قبل تحويل الحكم العام من **PARTIAL** إلى **PASS**.
