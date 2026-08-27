# تقرير أداء KNOuX X Retouch — Phase 3B

**حالة تغطية الأداء:** `PASS` لمسارات التحليل، cache، proxy/final وstale المقاسة.
**جودة الأداء التفاعلي:** `PARTIAL`؛ صف الـproxy الكامل ≈19,045 ms، ولذلك لا يُسوَّق كاستجابة premium-interactive ولا يمنع بمفرده القبول الوظيفي.
**حالة CPU والذاكرة:** `NOT MEASURED`.

أُجريت مصفوفة الأداء في تشغيل Electron **معبأ فعلياً** باستخدام `knoux-player-x.exe`، لا خادم تطوير ولا `_electron.launch`. نشأت صورتا الحجم الصغير والمتوسط محلياً من fixture الجسم الكامل نفسه عبر إعادة تحجيم حقيقية، ثم استُخدمت الصور الثلاث في مسارات UI الفعلية للتحليل، منزلق الخصر، proxy/final، وتسلسل stale. تحفظ JSONات الخام تحت `_temp/live-evidence/retouch-phase3b-performance-{small,medium,full}.json`.

> القياسات رصدية لجهاز Windows المتصل ودورة واحدة لكل حجم، وليست SLA أو وعداً بأداء موحد على كل جهاز.

## مصفوفة الأحجام الحقيقية

| الحجم | أبعاد المصدر | تحليل محلي | cache hit | أول proxy | final بعد pointer-up | stale proxy | buffer proxy | buffer final |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| صغير | 750×1143 | 424 ms | 87 ms | 2,322 ms | 605 ms | 6,111 ms | 672×1024 | 750×1143 |
| متوسط | 1500×2286 | 1,544 ms | 106 ms | 5,453 ms | 1,347 ms | 12,831 ms | 672×1024 | 1500×2286 |
| كامل | 3000×4572 | 1,983 ms | 141 ms | 19,045 ms | 5,082 ms | 42,239 ms | 672×1024 | 3000×4572 |

يتحقق كل صف من أن buffer المعاينة أصغر من raster النهائي عند الإمكان، وأن معاملة الواجهة تعود إلى full-quality buffer بعد رفع المؤشر. كما أن تسلسل stale انتهى بالقيمة الأخيرة ولم يكتب نتيجة قديمة فوقها. هذه **تغطية قياس وظيفية مكتملة**، لكنها لا تعني جودة تفاعل ممتازة: زمن proxy الكامل ≈19.0 ثانية حدّ جودة مستقل معلن كـ`PARTIAL`.

## cache ومعرّفات الطلبات

تظهر كل دورة **cache miss واحداً** للتحليل الأول، ثم **cache hit واحداً** عند إعادة طلب التحليل لنفس الأصل والأبعاد. لم يُرسل طلب Pose جديد في cache hit: بقيت قائمة `requestedIds` بطول 1 وقائمة `completedIds` بطول 1، ولم تبقَ طلبات معلقة. يسجل العميل أيضاً `inFlightDedupes` للحالات المتزامنة؛ لم تحدث dedupe متزامنة في هذه دورات UI المتسلسلة، ولذلك لا تُعرض قيمة غير مقاسة كادعاء أداء.

| الحجم | cache hits | cache misses | request IDs | completed IDs | pending IDs |
|---|---:|---:|---:|---:|---:|
| صغير | 1 | 1 | 1 | 1 | 0 |
| متوسط | 1 | 1 | 1 | 1 | 0 |
| كامل | 1 | 1 | 1 | 1 | 0 |

الحماية من تحليل UI القديم تعمل عبر تسلسل request محلي في `ImageStudioRetouchPanel`: لا تُحدّث النتيجة الحالة المرئية إذا تغيّر تسلسل الطلب أو تبدل العميل قبل اكتمالها. ويغطي اختبار الوحدة عميل التحليل من خلال cache miss وin-flight dedupe وcache hit ومعرّف الطلب المكتمل.

## نطاق القياس وحدوده

| البند | الحالة | التفسير |
|---|---|---|
| تحليل Pose محلي | `PASS` | نموذج محلي وWASM محليان داخل الحزمة؛ كل الأحجام الثلاثة قِيست. |
| cache hit/miss | `PASS` | سجلت UI cache hit حقيقياً بلا request جديد في كل حجم. |
| request IDs | `PASS` | IDs المطلوبة والمكتملة والمعلقة معروضة من العميل المحلي. |
| stale | `PASS` | آخر قيمة UI محفوظة، ولا stale overwrite في B9. |
| proxy → final | `PASS` وظيفياً | أبعاد buffer المرصودة صادقة لكل صف. |
| جودة التفاعل | `PARTIAL` | صف 3000×4572: أول proxy 19,045 ms وfinal بعد release 5,082 ms؛ لا budget أو SLA يبرر وصف premium. |
| CPU | `NOT MEASURED` | لا توجد telemetry قابلة لإعادة الإنتاج. |
| الذاكرة | `NOT MEASURED` | لم تجمع telemetry للذاكرة؛ لا يُقدّم تقدير بديل. |
| حد تجربة أو SLA | `NOT DEFINED` | لا يوجد budget معتمد في هذا المشروع لاشتقاق حكم pass/fail زمني. |

## المراجع الداخلية

1. `_temp/live-evidence/retouch-phase3b-performance-small.json` — تشغيل Electron المعبأ 750×1143.
2. `_temp/live-evidence/retouch-phase3b-performance-medium.json` — تشغيل Electron المعبأ 1500×2286.
3. `_temp/live-evidence/retouch-phase3b-performance-full.json` — تشغيل Electron المعبأ 3000×4572.
4. `src/features/image-editor/retouch/bodyAnalysisClient.ts` — cache LRU، in-flight dedupe، ومعرّفات الطلبات.
5. `tests/unit/body-analysis-client-diagnostics.test.ts` — اختبار cache وrequest IDs.
