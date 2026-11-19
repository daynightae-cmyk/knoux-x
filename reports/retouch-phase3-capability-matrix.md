# مصفوفة قدرات KNOuX X Retouch — Phase 3

**الحالة قبل الالتزام:** `FUNCTIONAL PASS PENDING POST-COMMIT SHA PROOF`.

لا تتحول حالة الإصدار إلى `PASS` قبل إعادة قبول Electron المعبأ من SHA الجديد بشجرة tracked نظيفة. جميع الحالات أدناه موصوفة من الدليل المباشر، لا من نجاح build وحده.

| المجال | القدرة | الحالة قبل الالتزام | الدليل المباشر | شرط الإغلاق المتبقي |
|---|---|---|---|---|
| Phase 3A | Portrait Retouch | `PASS` سابق | لم تتغير ضمن الإغلاق. | لا شيء ضمن النطاق. |
| التحليل | Pose محلي لجسم واحد | `PASS` | B0: `1 body detected locally · segmentation ready`. | لا شيء لمسار subject الواحد. |
| التحليل | model/WASM محليان | `PASS` | Pose task وMediaPipe WASM داخل الحزمة؛ B7 حجب الشبكة. | لا شيء في المسار المقاس. |
| التحليل | cache hit/miss والـIDs | `PASS` | miss `0/1` ثم hit `1/1`، من دون ID طلب جديد. | لا يثبت multi-user أو عتاداً آخر. |
| أدوات الجسم | Body Slim, Waist, Hips, Shoulders, Arm, Leg, Leg Length, Torso Width | `PASS` | B1 والمصفوفة الفردية، ثم H1–H8 التراكمي. | لا شيء وظيفي؛ post-commit proof فقط. |
| أدوات الجسم | Manual Body Warp | `PASS` | B2 وH9 سجلا 16 strokes وتغير raster. | post-commit proof فقط. |
| التاريخ | لا history عند تسليح الأداة | `PASS` | H0–H9 يتحقق من عدم إدخال التاريخ قبل gesture الحقيقي. | post-commit proof فقط. |
| التاريخ | gesture واحد = history entry واحد | `PASS` | H9: `history 9→10` و`transactionActive=false` بعد completion. | post-commit proof فقط. |
| التاريخ | aggregate undo-all/redo-all | `PASS` | تسع انتقالات undo H9→H0 وتسع redo H0→H9، وكل انتقال يطابق RGBA SHA وترتيب/IDs العمليات وhistory index. | post-commit proof فقط. |
| العرض | Before/After الحقيقي | `PASS` | `\\` يعيد H0 عند الضغط وH9 عند الإفلات من دون تغيير history/dirty/diagnostics/stack. | post-commit proof فقط. |
| الطبقات | Raster A/B isolation عبر UI | `PASS` | A (مكرر عبر UI وID ثابت) يملك 9 عمليات؛ B يملك 0؛ hide/show وreopen يستعيدان B-only/composite hash بدقة. | post-commit proof فقط. |
| عدم الإتلاف | source raster immutable | `PASS` | fingerprints متطابقة قبل وبعد العمليات وundo/redo والحفظ وreopen والتصدير. | post-commit proof فقط. |
| الحماية | الخلفية البعيدة والرأس | `PASS` | B6 لعمليات Waist/Manual/Leg: background/head byte-identical داخل مناطق القياس. | تنويع fixtures خارج النطاق. |
| الحماية | freeze alpha | `PASS` | اختبار `retouch-phase3-alpha-protection` مع B6. | لا شيء في نطاق Phase 3. |
| الاستمرارية | joint continuity / displacement | `PASS` للـsampler invariant | Waist وShoulders وArm وLeg وLeg Length وManual؛ raw deltas 0/0/0/2/6/2 px وتطبيع محلي مشتق. | Jacobian/fold-over `NOT MEASURED` لأن raster renderer لا يعرّض mesh topology. |
| حفظ | aggregate Save/Reopen | `PASS` | hash H9 المركب وB-only يعادان بدقة وIDs وملكية A/B ثابتة. | post-commit proof فقط. |
| تصدير | PNG كامل مطابق | `PASS` | B5: 3000×4572، decoded pixel hash مطابق؛ aggregate export verified. | post-commit proof فقط. |
| offline | حظر HTTP(S) قبل النافذة | `PASS` | B7: telemetry request واحد مسجل ومحجوب؛ لا ادعاء بصفر request. | post-commit proof فقط. |
| rendering | proxy أثناء المعاملة | `PASS` وظيفياً | B8: proxy 672×1024 أثناء gesture. | لا شيء وظيفي. |
| rendering | final كامل بعد المعاملة | `PASS` وظيفياً | B8: final 3000×4572/full بعد release. | لا شيء وظيفي. |
| rendering | stale supersession | `PASS` | B9 يحفظ C ولا يقبل overwrite متأخراً. | post-commit proof فقط. |
| الأداء | measurement coverage | `PASS` | 750×1143 و1500×2286 و3000×4572؛ cache وproxy/final وstale. | CPU/MEMORY ما زالا `NOT MEASURED`. |
| الأداء | interactive performance quality | `PARTIAL` | full proxy في المصفوفة السابقة ≈19,045 ms؛ لا يوصف بأنه premium. | يلزم تحسين latency منفصل، وليس blocker وظيفياً لهذا الإغلاق. |
| الجودة | TypeScript | `PASS` | `tsc --noEmit`. | يعاد فقط إذا تغير مصدر بعد هذه النقطة. |
| الجودة | ESLint | `PASS` | صفر warnings مع `--max-warnings=0`. | يعاد فقط إذا تغير مصدر بعد هذه النقطة. |
| الجودة | Jest | `PASS` | 90 suites / 946 tests، و4 suites Retouch مركزة / 66 tests. | لا شيء قبل commit. |
| الجودة | Forge x64 | `PASS` | Electron Forge package نجح. | يعاد بعد commit. |
| Electron | acceptance قبل الالتزام | `PASS` | B0–B9 الكامل على 3000×4572 وH0–H9 المتوسط؛ JSON `runtimeResult=PASS`. | JSON يحمل HEAD القديم و`trackedTreeClean=false` بحكم تغييرات الإغلاق. |
| الإصدار | SHA نهائي نظيف على `origin/main` | `NOT RUN` | لا commit نهائي بعد. | commit، package، post-commit acceptance، push، ثم `HEAD==origin/main`. |

## منهج بوابة الاستمرارية

> حد القبول ليس 4px عالمياً ولا حكماً جمالياً. لكل سلسلة arm/leg يحسب harness `continuityRatio = maximumAdjacentDeltaPx / localLimbLengthPx`، ويشتق `allowedRatio = 2 × searchRadiusPx / localLimbLengthPx` من search radius الفعلي 16px في block matcher المحلي.

هذا يحافظ على التمييز بين **استمرارية displacement المقاسة** وبين **تجميد freeze mask**. يتحقق الدليل من finite coordinates وclamping؛ أما mesh Jacobian وfold-over فـ`NOT MEASURED` لأن منتج raster liquify لا يعرّض مثلثات أو quads للحكم عليها.

## ربط الأدلة

| الملف | الغرض |
|---|---|
| `_temp/live-evidence/retouch-phase3b-electron-acceptance.json` | JSON الخام لقبول pre-commit، B0–B9 وH0–H9. |
| `tools/phase3b-electron-acceptance.cjs` | إجراءات Electron المعبأة، B0–B9، حارس الشبكة وproxy/final/stale. |
| `tools/phase3b-final-closure-helper.cjs` | H0–H9 وundo/redo وBefore/After وA/B والحفظ والتصدير والاستمرارية. |
| `tests/unit/retouch-phase2-integration.test.ts` | عدم إنشاء history عند التسليح ومعاملة retouch. |
| `tests/unit/retouch-phase3-alpha-protection.test.ts` | حماية alpha وعدم تحور source raster. |
| `artifacts/retouch-phase3-final-acceptance.md` | تقرير القرار والأرقام التشغيلية الكاملة. |
| `artifacts/retouch-phase3b-performance.md` | مصفوفة الأداء والحدود المعلنة. |
