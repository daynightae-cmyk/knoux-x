# مصفوفة قدرات KNOuX X Retouch — Phase 3

**الحالة العامة:** `PARTIAL`
**قاعدة الحكم:** لا تتحول أي خانة إلى `PASS` إلا بدليل مباشر من الحزمة أو اختبار وحدة محدد. تشير `PARTIAL` إلى أن جزءاً من السلوك ثبت أو قيس، لكنه لا يغلق النطاق كاملاً.

| المجال | القدرة | الحالة | الدليل المباشر | ما يمنع الإغلاق الكامل |
|---|---|---|---|---|
| التحليل | Pose محلي لجسم واحد | `PASS` | B0: `1 body detected locally · segmentation ready`. | لا شيء لمسار subject الواحد. |
| التحليل | نموذج محلي مع WASM محلي | `PASS` | model SHA موثق وملفات WASM داخل `app.asar`. | لا شيء في مسار B7. |
| التحليل | cache hit/miss وتحليل stale بالـIDs | `PARTIAL` | stale رندر للمنزلق B9 مثبت. | لا instrumentation تحليل/cache ذات request IDs. |
| أدوات الجسم | Waist | `PASS` | B1 يغير raster؛ B6 metrics. | تسلسل undo-all عام غير مثبت. |
| أدوات الجسم | Manual Body Warp | `PASS` | B2: 16 stroke، B3 undo/redo، B6 metrics. | تثبيت قبل/بعد مستقل لكل ترتيب عمليات ما زال ناقصاً. |
| أدوات الجسم | Body Slim | `PASS` | المصفوفة: rendered control، changed، exact remove restore. | لا تسلسل undo-all. |
| أدوات الجسم | Hips | `PASS` | المصفوفة: rendered control، changed، exact remove restore. | لا تسلسل undo-all. |
| أدوات الجسم | Shoulders | `PASS` | المصفوفة: rendered control، changed، exact remove restore. | لا تسلسل undo-all. |
| أدوات الجسم | Arm | `PASS` | المصفوفة: rendered control، changed، exact remove restore. | لا تسلسل undo-all. |
| أدوات الجسم | Leg | `PASS` | المصفوفة + B6 Leg: 1,076,057 core pixels changed. | لا بوابة continuity للـdistal. |
| أدوات الجسم | Leg Length | `PASS` | المصفوفة: rendered control، changed، exact remove restore. | لا تسلسل undo-all. |
| أدوات الجسم | Torso Width | `PASS` | المصفوفة: rendered control، changed، exact remove restore. | لا تسلسل undo-all. |
| rendering | proxy أثناء المعاملة | `PASS` | B8: 672×1024. | لا مصفوفة أحجام. |
| rendering | final كامل بعد المعاملة | `PASS` | B8: 3000×4572. | لا مصفوفة أحجام. |
| rendering | stale supersession | `PASS` | B9: قيمة C محفوظة، لا overwrite. | لا request IDs للتحليل. |
| الحماية | الخلفية البعيدة | `PASS` | Waist/Manual/Leg: 0 changed، max channel delta=0. | لا شيء ضمن fixture المقاس. |
| الحماية | الرأس | `PASS` | Waist/Manual/Leg: 0 changed داخل head region. | لا تنويع وضعيات أو وجوه. |
| الحماية | freeze alpha | `PASS` في وحدة المحرك | اختبار alpha يستعيد البكسلات المحمية حيث alpha>0 ولا يغير source. | يلزم ربط إضافي بمشاهد متعددة إنتاجية لإغلاق أوسع. |
| الحماية | قياس المفاصل | `PARTIAL` | 12 guard لكل عملية؛ تغيرات Leg distal مسجلة بصدق. | لا threshold continuity/displacement نهائي. |
| عدم الإتلاف | source raster immutable | `PASS` في الوحدة | اختبار alpha وcompositor يثبتان عدم تحور input. | لا proof UI إنتاجي مستقل قبل/بعد source hash. |
| عدم الإتلاف | عزل طبقتين raster | `PASS` في الوحدة | `image-studio-compositor` يثبت layer-aware override دون تغيير asset. | لا سيناريو إنتاجي مصور من UI في الدليل الحالي. |
| حفظ | Save/Reopen | `PASS` لمسار B4 | project SHA، body+manual operation، freeze mask، final hash exact. | لا يحفظ أدوات المصفوفة السبعة في مشروع واحد. |
| تصدير | PNG نهائي مطابق | `PASS` لمسار B5 | 3000×4572 وpixel hash exact. | لا إحصاء alpha/export متعدد الصيغ. |
| offline | حظر HTTP(S) قبل النافذة | `PASS` | Electron session guard؛ telemetry attempt محجوب ومسجل. | لا شيء لمسار B7 الحالي. |
| الأداء | تحليل محلي | `PASS` رصدي | 1,301 ms على fixture كبير. | قياس واحد فقط. |
| الأداء | latency proxy/final | `PARTIAL` | proxy=19,571 ms، final=4,502 ms. | لا budgets ولا مقارنة أحجام. |
| الأداء | الذاكرة | `NOT MEASURED` | مسجل صراحةً في B9. | يلزم قياس قابل لإعادة الإنتاج. |
| Electron | قبول exe المعبأ | `PASS` قبل الالتزام | URL داخل `file://...app.asar...` و`packaged=true`. | يجب إعادة التشغيل بعد SHA النهائي. |
| الجودة | TypeScript | `PASS` قبل الالتزام | `npm run typecheck` نجح بعد إصلاح fetch guard. | يعاد بعد التقارير/الالتزام ضمن البوابة النهائية. |
| الجودة | Lint | `PASS` قبل الالتزام | `npm run lint -- --max-warnings=0` نجح. | يعاد بعد التقارير ضمن البوابة النهائية. |
| الجودة | Jest كامل | `PASS` قبل الالتزام | 89 suites، 944 tests. | يعاد فقط إن حدث تغير source/test لاحق. |
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
