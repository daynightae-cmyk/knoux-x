# مصفوفة قدرات KNOuX X Retouch — Phase 3

**الحالة العامة:** `PARTIAL`
**قاعدة الحكم:** لا تتحول أي خانة إلى `PASS` إلا بدليل مباشر من الحزمة أو اختبار وحدة محدد. تشير `PARTIAL` إلى أن جزءاً من السلوك ثبت أو قيس، لكنه لا يغلق النطاق كاملاً.

| المجال | القدرة | الحالة | الدليل المباشر | ما يمنع الإغلاق الكامل |
|---|---|---|---|---|
| التحليل | Pose محلي لجسم واحد | `PASS` | B0: `1 body detected locally · segmentation ready`. | لا شيء لمسار subject الواحد. |
| التحليل | نموذج محلي مع WASM محلي | `PASS` | model SHA موثق وملفات WASM داخل `app.asar`. | لا شيء في مسار B7. |
| التحليل | cache hit/miss وتحليل stale بالـIDs | `PASS` للمسار المقاس | ثلاث دورات UI: miss ثم hit بلا request ID جديد؛ requested/completed/pending IDs موثقة. | لا سباق UI متزامن فعلي في الدليل. |
| أدوات الجسم | Waist | `PASS` | B1 يغير raster؛ B6 metrics. | تسلسل undo-all عام غير مثبت. |
| أدوات الجسم | Manual Body Warp | `PASS` | B2: 16 stroke، B3 undo/redo، B6 metrics. | تثبيت قبل/بعد مستقل لكل ترتيب عمليات ما زال ناقصاً. |
| أدوات الجسم | Body Slim | `PASS` | rendered control، changed، exact undo وredo ثم remove restore. | لا تسلسل undo-all مركب. |
| أدوات الجسم | Hips | `PASS` | rendered control، changed، exact undo وredo ثم remove restore. | لا تسلسل undo-all مركب. |
| أدوات الجسم | Shoulders | `PASS` | rendered control، changed، exact undo وredo ثم remove restore. | لا تسلسل undo-all مركب. |
| أدوات الجسم | Arm | `PASS` | rendered control، changed، exact undo وredo ثم remove restore. | لا تسلسل undo-all مركب. |
| أدوات الجسم | Leg | `PASS` | المصفوفة + B6 Leg: 1,076,057 core pixels changed، exact undo/redo/remove. | لا threshold continuity للـdistal. |
| أدوات الجسم | Leg Length | `PASS` | rendered control، changed، exact undo وredo ثم remove restore. | لا تسلسل undo-all مركب. |
| أدوات الجسم | Torso Width | `PASS` | rendered control، changed، exact undo وredo ثم remove restore. | لا تسلسل undo-all مركب. |
| rendering | proxy أثناء المعاملة | `PASS` | 672×1024 في صفوف 750×1143 و1500×2286 و3000×4572. | لا budget زمني معتمد. |
| rendering | final كامل بعد المعاملة | `PASS` | final صادق لكل صف: 750×1143 و1500×2286 و3000×4572. | لا budget زمني معتمد. |
| rendering | stale supersession | `PASS` | B9: قيمة C محفوظة، لا overwrite؛ request diagnostics معروضة لتحليل الجسم. | لا سباق تحليل UI متزامن فعلي في الدليل. |
| الحماية | الخلفية البعيدة | `PASS` | Waist/Manual/Leg: 0 changed، max channel delta=0. | لا شيء ضمن fixture المقاس. |
| الحماية | الرأس | `PASS` | Waist/Manual/Leg: 0 changed داخل head region. | لا تنويع وضعيات أو وجوه. |
| الحماية | freeze alpha | `PASS` في وحدة المحرك | اختبار alpha يستعيد البكسلات المحمية حيث alpha>0 ولا يغير source. | يلزم ربط إضافي بمشاهد متعددة إنتاجية لإغلاق أوسع. |
| الحماية | قياس المفاصل | `PARTIAL` | 12 guard لكل عملية؛ local RGB block-match، displacement وفروق متجهات متجاورة مسجلة. | لا threshold continuity/displacement نهائي. |
| عدم الإتلاف | source raster immutable | `PASS` | اختبار alpha وcompositor، إضافة SHA production UI قبل التعديل وبعده وبعد reopen متطابقة. | حالة طبقتين إنتاجية مستقلة ما زالت ناقصة. |
| عدم الإتلاف | عزل طبقتين raster | `PASS` في الوحدة | `image-studio-compositor` يثبت layer-aware override دون تغيير asset. | لا سيناريو إنتاجي مصور من UI في الدليل الحالي. |
| حفظ | Save/Reopen | `PASS` لمسار B4 | project SHA، body+manual operation، freeze mask، final hash exact، source SHA invariant. | لا يحفظ أدوات المصفوفة السبعة في مشروع واحد. |
| تصدير | PNG نهائي مطابق | `PASS` لمسار B5 | 3000×4572 وpixel hash exact. | لا إحصاء alpha/export متعدد الصيغ. |
| offline | حظر HTTP(S) قبل النافذة | `PASS` | Electron session guard؛ telemetry attempt محجوب ومسجل. | لا شيء لمسار B7 الحالي. |
| الأداء | تحليل محلي | `PASS` رصدي | 424 ms صغير، 1,544 ms متوسط، 1,983 ms كامل. | قياس واحد لكل حجم وجهاز. |
| الأداء | latency proxy/final | `PASS` للمسارات المقاسة | small 2,322/605 ms، medium 5,453/1,347 ms، full 19,045/5,082 ms. | لا budgets زمنية معتمدة. |
| الأداء | الذاكرة | `NOT MEASURED` | مسجل صراحةً في B9. | يلزم قياس قابل لإعادة الإنتاج. |
| Electron | قبول exe المعبأ | `PASS` قبل الالتزام | URL داخل `file://...app.asar...` و`packaged=true`. | يجب إعادة التشغيل بعد SHA النهائي. |
| الجودة | TypeScript | `PASS` قبل الالتزام | `npm run typecheck` نجح بعد diagnostics التحليل. | يعاد بعد الالتزام ضمن البوابة النهائية. |
| الجودة | Lint | `PASS` قبل الالتزام | `npm run lint -- --max-warnings=0` نجح. | يعاد بعد التقارير ضمن البوابة النهائية. |
| الجودة | Jest كامل | `PASS` سابق | 89 suites، 944 tests سابقاً؛ اختبار diagnostics الجديد نجح مركزاً. | يعاد كاملاً بعد التغييرات الحالية. |
| الإصدار | SHA نهائي نظيف على `origin/main` | `NOT RUN` | لا التزام نهائي حتى الآن. | commit، post-commit acceptance، push والتحقق مطلوبون. |

## دلالة الحالات

| الرمز | المعنى |
|---|---|
| `PASS` | الدليل الحالي يختبر السلوك المحدد مباشرة. |
| `PARTIAL` | يوجد دليل جزئي أو إطار اختبار، لكن البوابة المكتملة لم تتحقق. |
| `NOT MEASURED` | لم تُجمع بيانات، ولذلك لا يقدَّم تخمين. |
| `NOT RUN` | خطوة إصدار لازمة لم تحدث بعد. |

## ربط الأدلة

| الملف | الغرض |
|---|---|
| `_temp/live-evidence/retouch-phase3b-electron-acceptance.json` | JSON الخام للـB0–B9 في Electron المعبأ. |
| `tools/phase3b-electron-acceptance.cjs` | إجراءات UI الحقيقية، snapshots RGBA، B6 وB7 وB8 وB9. |
| `tests/unit/retouch-phase3-alpha-protection.test.ts` | freeze alpha ومصدر raster. |
| `artifacts/retouch-phase3b-performance.md` | القياسات والحدود المعلنة. |
| `artifacts/retouch-phase3-final-acceptance.md` | الحكم التفصيلي وبوابات ما قبل الإغلاق. |
