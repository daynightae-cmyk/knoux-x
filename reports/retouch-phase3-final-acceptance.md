# قبول KNOuX X Retouch — Phase 3

**الحكم قبل الالتزام: `FUNCTIONAL PASS PENDING POST-COMMIT SHA PROOF`**

هذا التقرير يقتصر على الدليل الحي من تطبيق Electron معبأ فعلياً. في تشغيل pre-commit الأخير كان `runtimeResult=PASS`، لكن `trackedTreeClean=false` و`commit=9adf5dff568ff7fcae01674e63e0aa832333673e` لأن تغييرات الإغلاق لم تُلتزم بعد. لذلك لا يُعلن الحكم النهائي للإصدار أو الدفع قبل إعادة التعبئة وإعادة القبول بعد الالتزام، على أن يحمل ملف الدليل SHA الجديد نفسه و`trackedTreeClean=true`.

## ملخص الدليل المعبأ قبل الالتزام

| البند | النتيجة | الدليل الحي |
|---|---|---|
| Phase 3A Portrait | `PASS` سابق ومحتفظ به | لم يُعد بناؤه أو تغييره في مهمة الإغلاق هذه. |
| تحليل الجسم المحلي | `PASS` | `mediapipe-pose-landmarker-full` اكتشف جسماً واحداً محلياً مع segmentation؛ cache miss أولاً ثم hit واحد بلا request ID جديد. |
| أدوات الجسم الفردية | `PASS` | Waist وBody Slim وHips وShoulders وArm وLeg وLeg Length وTorso Width وManual Body Warp جميعها غيّرت Raster في Electron معبأ. |
| H9 Manual Body Warp | `PASS` | gesture حقيقي على Canvas بعد `Fit canvas` سجل 16 strokes، وتغير raster النهائي، ومعاملة تاريخ واحدة من 9 إلى 10. |
| aggregate history H0–H9 | `PASS` قبل الالتزام | عشر حالات متتالية من H0 إلى H9؛ تسعة undo و تسعة redo أعادت SHA RGBA وترتيب العمليات بدقة. |
| Before/After | `PASS` قبل الالتزام | ضغط وإفلات `\\` أعادا H0 ثم H9 بالضبط من دون تغيير history أو dirty أو diagnostics أو stack. |
| two-raster-layer isolation | `PASS` قبل الالتزام | Layer A يحمل العمليات التسع وLayer B لا يحمل أياً منها؛ hide/show يعيد B-only وcomposite بدقة، وكذلك بعد reopen. |
| source immutability | `PASS` قبل الالتزام | source fingerprints لطبقتي Raster متطابقة قبل العمليات وبعدها وundo-all وredo-all والحفظ وreopen والتصدير. |
| save / reopen | `PASS` قبل الالتزام | SHA المركب بعد reopen يساوي SHA H9، مع ثبات IDs وملكية A/B. |
| full-resolution PNG export | `PASS` | B5 صدّر PNG 3000×4572 مع decoded pixel hash مطابق؛ export aggregate المتوسط verified. |
| proxy → final | `PASS` | B8 شاهد preview/proxy 672×1024 أثناء gesture ثم final/full 3000×4572 بعد release. |
| stale supersession | `PASS` | B9 حافظ على القيمة C ولم يرصد overwrite متأخراً من A أو B. |
| offline/network guard | `PASS` | request telemetry خارجي واحد سُجل وحُجب؛ لا ادعاء زائف بصفر محاولات. |
| measurement coverage | `PASS` | أحجام 750×1143 و1500×2286 و3000×4572، cache وproxy/final وstale مسجلة. |
| interactive performance quality | `PARTIAL` | full-resolution proxy سابقاً يقارب 19.0 s؛ لا يوصف بأنه premium-interactive. CPU والذاكرة `NOT MEASURED`. |
| قبول Electron النهائي للإصدار | `PENDING` | يلزم قبول معبأ ثانٍ بعد SHA النهائي وبشجرة tracked نظيفة. |

## قبول B0–B9 على Raster الكامل

استخدمت B0–B9 fixture محلياً كاملاً `retouch-phase3b-fullbody-fixture.jpg` بقياس **3000×4572** وSHA-256 `a9560409d1c078835ac48be2ccaef922f00da700f2e0e950bfd4edcca159a0b4`. أثبت B0 pose محلياً، ثم سجل cache `0→1` hit/miss ومدة hit مقدارها 125 ms. أثبت B1 تغير Waist، وأثبت B2 manual body warp (16 strokes)، وأعاد B3 undo/redo الهاش الدقيق. وأثبت B4 الاستمرارية عبر الحفظ وإعادة الفتح، وأثبت B5 PNG كاملاً 3000×4572، وأثبت B6 حماية الخلفية/الرأس، وأثبت B7 الحجب الصريح، وأثبت B8 proxy/final، وأثبت B9 supersession.

| الاختبار | النتيجة | تفاصيل قابلة للتحقق |
|---|---|---|
| B0 | `PASS` | جسم واحد وsegmentation محليان؛ `first: hits=0, misses=1` ثم `afterCacheHit: hits=1, misses=1`. |
| B1 | `PASS` | تغير Waist النهائي عن baseline بعد release حقيقي للـrange. |
| Body tool matrix | `PASS` | الأدوات السبع التلقائية أعادت pixel hash الصحيح في undo وredo والإزالة الفردية. |
| B2 / B3 | `PASS` | Manual warp سجل 16 stroke؛ undo/redo أعادا SHA الدقيق. |
| B4 / B5 | `PASS` | save/reopen exact، وPNG export 3000×4572 مطابق للرندر الكامل. |
| B6 | `PASS` | الخلفية والرأس protected byte-identical في قياسات Waist وManual وLeg، مع تغير core المشروع. |
| B7 | `PASS` | حارس الشبكة قبل أول نافذة؛ telemetry `POST https://odml.pa.googleapis.com/v1/log` حُجب وسُجل. |
| B8 | `PASS` | proxy RGBA 672×1024 ثم final RGBA 3000×4572. |
| B9 | `PASS` | انتهت آخر قيمة C وبقي الهاش النهائي مطابقاً لها؛ لا stale overwrite. |

## H0–H9 والتاريخ المجمع وعزل الطبقات

استُخدم fixture جسم محلي متوسط منفصل لمرحلة الإغلاق التراكمية كي تظل إعادة الرسم والـundo/redo التسعة قابلة للإتمام في Electron المعبأ؛ وهو `retouch-phase3b-fullbody-medium.jpg` بقياس **1500×2286** وSHA-256 `b9333abb71bcb190c1d6bf289f6c567b5447a51a4820d4921d10a57ded8e89e9`. يظل مسار المنتج نفسه: Image Studio UI → RasterLayer `retouche` → renderer → compositor → ImageStudioCanvas؛ ولم تستدع الأدلة دوال التشوه مباشرة.

| الحالة | العملية المتراكمة | عمليات A | شرط الهاش |
|---|---|---:|---|
| H0 | baseline لطبقة A بعد duplicate من UI | 0 | B-only وH0 متطابقان. |
| H1 | Body Slim | 1 | يختلف عن H0. |
| H2 | Waist | 2 | يختلف عن H1. |
| H3 | Hips | 3 | يختلف عن H2. |
| H4 | Shoulders | 4 | يختلف عن H3. |
| H5 | Arm | 5 | يختلف عن H4. |
| H6 | Leg | 6 | يختلف عن H5. |
| H7 | Leg Length | 7 | يختلف عن H6. |
| H8 | Torso Width | 8 | يختلف عن H7. |
| H9 | Manual Body Warp | 9 | يختلف عن H8؛ `manualStrokeCount=16`؛ history `9→10`. |

كل slider body تم تسليحه بلا إدخال history عند اختيار الأداة، ثم أصبح gesture range واحد إدخال تاريخ واحد فقط. سجلت حلقة undo الحالات H9→H0، وسجلت حلقة redo H0→H9، وكل منهما تضم تسع انتقالات تتحقق من **SHA RGBA المعروض** وترتيب ومعرّفات العمليات وhistory index؛ لا يعتمد هذا الإثبات على Zustand وحده. طبقة A المكررة، التي حُددت بـ`data-layer-id` الثابت، امتلكت العمليات التسع حصراً؛ طبقة B الأصلية امتلكت صفر عمليات. hide/show لـA أعاد B-only بدقة ثم composite، وأعاد reopen كلا الهاشين بالضبط.

> لم يعد الضغط على Canvas لتهيئة اختصار Before/After جزءاً من الاختبار، لأنه يبدأ stroke مشروعاً إن كان Manual Body Warp نشطاً. الاختصار مستمع نافذة ولا يحتاج ذلك التركيز؛ إزالة click جعلت اختبار `\\` محايداً فعلاً للتاريخ والـdirty والعمليات.

## بوابة joint continuity / displacement

بوابة الاستمرارية ليست threshold تجميلياً عالمياً. لكل انتقال من Waist وShoulders وArm وLeg وLeg Length وManual Body Warp، يقارن harness إزاحات block-match RGB حول سلاسل arm/leg محلية ويطبع الإزاحة بالـpx وطول الطرف المحلي. النسبة المسموح بها مشتقة من بنية sampler الفعلية: `2 × searchRadiusPx / localLimbLengthPx`، حيث `searchRadiusPx=16`، لا من حد ثابت 4px.

| العملية | أكبر adjacent delta مسجل | نطاق طول الطرف المحلي | نطاق allowed ratio المشتق | النتيجة |
|---|---:|---:|---:|---|
| Waist | 0 px | 314.17–447.82 px | 0.03573–0.05093 | `PASS` |
| Shoulders | 0 px | 314.17–447.82 px | 0.03573–0.05093 | `PASS` |
| Arm | 0 px | 314.17–447.82 px | 0.03573–0.05093 | `PASS` |
| Leg | 2 px | 314.17–447.82 px | 0.03573–0.05093 | `PASS` |
| Leg Length | 6 px | 314.17–447.82 px | 0.03573–0.05093 | `PASS` |
| Manual Body Warp | 2 px | 314.17–447.82 px | 0.03573–0.05093 | `PASS` |

التشغيل تحقق كذلك من finite coordinates وclamping. لا يدّعي الدليل mesh Jacobian أو triangle/quad fold-over: مسار liquify raster لا يعرّض topology كهذا، لذلك يبقى هذان البندان **NOT MEASURED** بدلاً من اختراع برهان هندسي أقوى.

## بوابات الجودة المنفذة

| البوابة | النتيجة |
|---|---|
| Node | `v20.20.2` |
| `npm ci` | حاولت scripts الكاملة مرتين وتوقفت في تنزيل ffprobe؛ اكتملت شجرة lockfile عبر `npm ci --ignore-scripts` ثم شُغلت scripts الرسمية المحددة لـElectron وffmpeg-static وffprobe-static. |
| TypeScript | `PASS` — `tsc --noEmit`. |
| ESLint | `PASS` — صفر warnings مع `--max-warnings=0`. |
| اختبارات Retouch المركزة | `PASS` — 4 suites / 66 tests. |
| Jest serial الكامل | `PASS` — 90 suites / 946 tests. |
| Forge x64 | `PASS` — Electron package. |
| pre-commit packaged acceptance | `PASS` — B0–B9 الكامل وH0–H9 المتوسط والعزل والاستمرارية. |
| `git diff --check` | `PASS` قبل إنشاء الوثائق النهائية؛ يعاد قبل staging. |

## شرط الإغلاق المتبقي

لا توجد بوابة وظيفية متبقية في تشغيل pre-commit. الشرط الوحيد قبل الحكم النهائي هو: الالتزام المقصود، ثم إعادة تعبئة Forge x64 وتشغيل القبول المعبأ مرة أخرى من الشجرة النظيفة بحيث يثبت JSON أن `commit` يساوي SHA الجديد، و`trackedTreeClean=true`، وحقول `aggregateHistory.verified` و`twoLayerIsolation.verified` و`jointContinuity.verified` و`sourceImmutability.verified` جميعها `true`.

## المراجع الداخلية

1. `_temp/live-evidence/retouch-phase3b-electron-acceptance.json` — دليل pre-commit المعبأ الأخير.
2. `tools/phase3b-electron-acceptance.cjs` — B0–B9، قياس Canvas RGBA، الحارس الشبكي والـproxy/final/stale.
3. `tools/phase3b-final-closure-helper.cjs` — H0–H9، undo/redo، Before/After، A/B، الحفظ والتصدير والاستمرارية.
4. `tests/unit/retouch-phase2-integration.test.ts` و`tests/unit/retouch-phase3-alpha-protection.test.ts` — معاملات التاريخ وحماية المصدر/alpha.
5. `artifacts/retouch-phase3b-performance.md` — مصفوفة الأداء وقيود الجودة التفاعلية.
