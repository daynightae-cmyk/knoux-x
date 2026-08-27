# تقرير تقوية أداء Retouch في KNOuX X — Phase 3B

## الحكم التنفيذي

أُنجزت هذه المهمة على مسار **Electron المعبأ الحقيقي** (`knoux-player-x.exe`) وعلى أصل الجسم 3000×4572، لا على خادم تطوير أو مشغّل Electron بديل. عالجت التقوية عنق الزجاجة المثبت: كانت طبقة retouch المصغرة 672×1024، لكن Canvas كان يعيد تركيبها ونسخها ورسمها على مساحة الوثيقة الكاملة قبل أن يراها المستخدم. أصبح الإطار أثناء المعاملة يُركّب ويُرسم فعلياً بالحجم المصغر، بينما يبقى final بالحجم الكامل وجودة الخوارزمية نفسها. [1] [2]

| مجال القبول | الحكم | الأساس المقاس |
|---|---|---|
| قبول Phase 3 الوظيفي | **PASS** | قبول Electron المعبأ اللاحق للتقوية أنهى `CLOSURE_ONLY_PASS` لـH0–H9؛ سجل H9 تسع عمليات وصورة 3000×4572 ذات SHA-256 محدد. [3] |
| التفاعل premium الأساسي | **PASS** | أول proxy كامل 458 ms (الحد ≤1500 ms)، وfirst final visible كامل 2252 ms (الحد ≤3000 ms). [2] |
| الهدف الممتد | **PARTIAL** | final الكامل 2252 ms يحقق الحد الأساسي، لكنه يزيد 252 ms على الهدف التمددي ≤2000 ms. [2] |
| صحة الـproxy والـengine | **PASS** | محرك التشوه استقبل 672×1024 في preview و3000×4572 في final؛ لا يوجد إدخال full-resolution لمحرك preview. [2] |
| أحدث حالة/عدم الكتابة القديمة | **PASS وظيفياً، PARTIAL ككفاءة** | B9 انتهى بالقيمة الأخيرة بلا stale overwrite؛ تحت stress كانت جميع 310 طلبات الإطار مرسومة، بلا إلغاء قبل البدء أو أثناءه، لذلك لا توجد coalescing مكافئة لمسار worker بعد. [4] |
| استقرار الذاكرة | **PARTIAL** | RSS الشجري انخفض 4,390,912 bytes في stress، لكن private bytes زاد 153,260,032 bytes تقريباً في عينة واحدة؛ لا يمكن إثبات غياب نمو غير محدود من نقطتي قياس فقط. [4] |
| توصيف CPU | **PARTIAL** | قيس CPU الحقيقي لعملية Electron وشجرتها: 278,281.25 ms CPU مقابل 276,615 ms wall في stress، لكنه قياس عينة واحدة غير مطبّع بين الأجهزة. [4] |

> **تعريف القياس المستخدم بعد التقوية:** timestamp الإطار التفاعلي هو أول لحظة ينشر فيها Canvas خصائصه بعد `putImageData`؛ لا يدخل فيه حساب SHA-256 لقراءة 55 MB من البكسلات. يستمر sampler الكامل في حساب RGBA hash للتحقق، لكنه لم يعد يشوّه زمن العرض المرئي. [5]

## خط الأساس المحتفظ به والمصفوفة بعد التقوية

تُحتفظ أدناه بالقياسات التاريخية الأصلية كما كانت؛ إذ أظهرت أن الـproxy الكامل كان يقارب 19,045 ms. أضافت مهمة التقوية instrumentation مرحلياً، وبيّنت على المسار القديم أن 3,428.9 ms من trace preview كانت في compositor وحده، فوق زمن المحرك المصغر. [1] تُعرض أعمدة «بعد» وفق تعريف أول إطار مرئي المصحح الموضح أعلاه. لذلك تُستخدم مقارنة المرحلة الداخلية الكاملة لتفسير التحسن، وتُحفظ قيم البداية القديمة بدلاً من حذفها أو إعادة تسميتها.

| حجم الأصل الحقيقي | التاريخي: أول proxy | التاريخي: final بعد release | بعد: أول proxy مرئي | بعد: أول final مرئي | حكم حد preview | حكم حد final |
|---|---:|---:|---:|---:|---|---|
| 750×1143 | 2,322 ms | 605 ms | **403 ms** | **297 ms** | PASS (≤500 ms) | رصدي؛ لا حد مستقل |
| 1500×2286 | 5,453 ms | 1,347 ms | **607 ms** | **909 ms** | PASS (≤750 ms) | رصدي؛ لا حد مستقل |
| 3000×4572 | 19,045 ms | 5,082 ms | **458 ms** | **2252 ms** | PASS (≤1500 ms) | PASS (≤3000 ms)، الهدف ≤2000 ms: PARTIAL |

الـfixture الصغير والمتوسط مشتقان إعادة تحجيمياً من fixture الجسم الكامل، ثم مررا عبر واجهة Image Studio نفسها والتحليل المحلي ومنزلق Waist ومساري proxy/final. في الصف الكامل، backing preview هو 672×1024 مع بقاء interaction plane والأبعاد المنطقية 3000×4572؛ أما final فيعود إلى 3000×4572. [2] [6] [7]

## تشخيص مرحلي موثق

يبيّن trace الكامل أن محرك preview لم يكن سبب انتظار 19 ثانية. قبل التقوية، ظل التشوه على 672×1024 قريباً من 112 ms، لكن compositor أعاد توسيع/دمج raster مصغر على 13,716,000 بكسل وبلغت كلفته 3,428.9 ms في trace instrumented. بعد التقوية، يعالج compositor 688,128 بكسلاً فقط أثناء transaction، متجاوزاً 13,027,872 بكسلاً من عمل preview غير الضروري. [1] [2]

| مرحلة trace الكاملة | قبل: preview القديمة | بعد: preview | بعد: final | الملاحظة |
|---|---:|---:|---:|---|
| Proxy source→672×1024 / reuse | 95.4 ms إنشاء | 0 ms reuse | غير منطبق | cache الـWeakMap أعاد buffer متوافقاً للحجم دون إعادة downscale. [1] [2] |
| Mask bridge | 26.2 ms | 24.0 ms | 26.0 ms | لا تعطيل للأقنعة أو اختصار لعملياتها. [1] [2] |
| Retouch engine | 112.2 ms | 114.0 ms | 1935.1 ms | preview مدخله 672×1024؛ final مدخله 3000×4572. [1] [2] |
| Layer retouch | 234.0 ms | 138.3 ms | 1961.2 ms | لا تعديل لخوارزمية التشوه النهائية. [1] [2] |
| Canvas compositor | **3428.9 ms** | **13.8 ms** | 117.0 ms | التحسن الرئيسي: تركيب preview بالحجم المصغر، وfast path normal للـfinal. [1] [2] |
| Canvas paint | 10.9 ms | 0.5 ms | 18.8 ms | الإطار المرئي موثّق بعد paint. [1] [2] |
| Trace الإجمالي | **3682.0 ms** | **161.6 ms** | **2108.3 ms** | لا يشمل فقط latency الأحداث قبل بدء trace. [1] [2] |

### التغييرات المنفذة

أضيفت telemetry محكومة صراحةً؛ تظل خاملة افتراضياً ولا تجمع traces إلا عند تفعيل acceptance. تسجل حدود UI/store والتحميل وproxy creation/reuse وتحويل العمليات والأقنعة ومدخل المحرك، وطبقة retouch، وresample/compositor، و`ImageData` وpaint، مع requested/started/completed/discarded/superseded/painted. [5]

أثناء transaction، يمر Canvas `renderCanvas` المصغر إلى `flattenDocument` بدلاً من إعادة توسيع ناتج retouch المصغر إلى وثيقة كاملة. الخصائص المنطقية للوثيقة والـCSS interaction plane تبقى كاملة، ولذلك لم تتبدل إحداثيات المؤشر أو Before/After أو دلالات document dimensions. [5]

أضيف cache لـproxy source باستخدام `WeakMap<RgbaBuffer, Map<dimensions, RgbaBuffer>>`. مفتاحه هو هوية أصل raster غير القابل للتعديل وأبعاد proxy؛ لذا يتحرر مع الأصل ولا يخلط أصولاً أو أحجاماً. رصد trace إعادة استخدام 0 ms في تشغيل Electron الحقيقي. [2] جرى أيضاً استبدال normal blend العام، الذي كان ينشئ كائنات RGBA قصيرة العمر لكل بكسل، بمسار typed-array مكافئ حسابياً، مع adoption للبفر الناتج لمنع نسخ إضافي بحجم 54,864,000 bytes في final. يحمي guard مسار البيانات غير المكتملة/array-like ويعيده للمسار المرجعي. [5]

## صحة المخرجات والأقفال الوظيفية

لم تخفض التقوية final resolution، ولم تتجاوز masks أو body operations، ولم تغيّر مخطط `RasterLayer.retouche` أو history أو التخزين أو التصدير. أثبتت اختبارات compositor أن normal opaque path يحافظ على طول البفر والبايتات ويعيد نسخة مستقلة، كما قورن normal fast path مباشرةً بمعادلة `compositeRgba` المرجعية مع حالات alpha شفافة وغير شفافة. [8]

قبول H0–H9 المعبأ اللاحق للتقوية مر بنجاح. سجّل H9 hash `1f4c8d0c778c2f4af225ee1f55585c9c3f65d06f7e5797bbeeaf6041f3efa968` عند 3000×4572 وتسع عمليات، ويشمل سلسلة body reshapes وManual Body Warp. سجلات joint continuity اللاحقة أكدت `pass: true` لـWaist وLeg وManual Body Warp؛ سجل Leg أكبر ratio مقاس 0.0056824 مقابل allowed 0.0272756. كما بقي fingerprint للمصدر ثابتاً، وحالة stress النهائية `transactionActive=false` و`renderError=null`. [3] [4]

| قفل بعد التقوية | النتيجة |
|---|---|
| Waist وLeg وManual Body Warp ضمن H0–H9 | PASS؛ لا تغير في mesh/engine، وjoint-continuity المسجل نجح لكل عملية. [3] |
| H9 exact RGBA داخل run | PASS؛ hash 3000×4572 موثق، مع undo/redo التجميعي المثبت في closure. [3] |
| Source immutability | PASS؛ SHA-256 للمصدر قبل/بعد ثابت في closure وstress. [3] [4] |
| A→B→C وعدم stale overwrite | PASS؛ القيمة الأخيرة 0.7 والحالة النهائية/hash مستقران. [4] |
| Layer/history semantics | PASS؛ stress انتهى عند historyCount 55 وhistoryIndex 54 بلا معاملة معلقة. [4] |

## الضغط والموارد

نفذ stress الكامل على الحزمة 3000×4572: **20 Waist gestures، 20 body-operation changes، 10 Manual Body Warp strokes، A→B→C، وزوجا undo/redo**. استغرق التسلسل 276,614 ms ونجح وظيفياً. تؤكد counters أن التطبيق لم ينهَر أو يعلق، لكن تبيّن أيضاً أن مسار Canvas الحالي ينفذ كل frame بدأه؛ لم تُدمج `retouchRenderQueue`/worker في هذا المسار لأن ذلك كان سيستلزم إعادة تصميم غير متناسبة مع التحسين الآمن المطلوب. [4]

| بند stress والموارد | القيمة الموثقة | الحكم |
|---|---:|---|
| UI interactions | 53 | PASS وظيفياً |
| requested / started / completed / painted | 310 / 310 / 310 / 310 | PASS للسلامة؛ PARTIAL للكفاءة |
| discarded-before-start / superseded-during-render | 0 / 0 | لا cancellation مستفاد منه في هذه العينة |
| Renderer JS heap قبل/بعد | 10,000,000 / 10,000,000 bytes | رصد ثابت، لكن external array buffers غير مكشوفة |
| Electron-tree RSS قبل/بعد | 1,776,623,616 / 1,772,232,704 bytes | انخفض 4,390,912 bytes |
| Electron-tree private bytes قبل/بعد | 1,585,778,688 / 1,739,038,720 bytes | زاد 153,260,032 bytes؛ لا يعد دليلاً على leak من عينة واحدة |
| CPU العملية/الشجرة | 278,281.25 ms | قياس فعلي، غير مطبّع للأجهزة |
| Wall time | 276,615 ms | عينة stress واحدة |

## بوابات الجودة المنفذة

اكتمل `npm ci` تحت Node 20.20.2 (مع تحذير تنظيف EPERM غير حاجب)، ثم نجحت typecheck وESLint بلا warnings. نجحت مجموعة retouch المركزة (6 suites / 63 tests في التشغيل المخصص)، ثم Jest الكامل المتسلسل: **91 suites / 951 tests PASS**. أُعيد بناء Forge x64، ونفذت مصفوفة Electron المعبأة للأحجام الثلاثة، وstress الكامل، ثم قبول H0–H9 اللاحق للتقوية. [3] [4] [9]

## القيود والخطوة التالية

تحقق الحد التفاعلي الأساسي دون التضحية بالدقة أو semantics. يبقى final الكامل محكوماً أساساً بمحرك body reshape نفسه (نحو 1.9 s من 2.1 s trace)، لا بالـcompositor بعد الآن. لا تُصنّف الذاكرة أو CPU كـPASS مطلق: يلزم تكرار stress دورات متعددة وتحليل plateau للـprivate bytes/array buffers إن أُريد حكم استقرار أقوى. كما أن دمج worker queue أو ROI النهائي ليس ضرورياً لتحقيق هذا الهدف، ويُترك لمهمة مستقلة تتضمن عقد cancellation ومخرجات exactness منفصلة.

## المراجع الداخلية

[1]: ../_temp/live-evidence/retouch-phase3b-performance-instrumented-before.json "Instrumented packaged baseline"
[2]: ../_temp/live-evidence/retouch-phase3b-performance-full-visible-frame.json "Final packaged full-resolution visible-frame evidence"
[3]: ../_temp/live-evidence/retouch-phase3b-functional-after-performance-precommit.json "Post-hardening packaged Phase 3B closure evidence"
[4]: ../_temp/live-evidence/retouch-phase3b-performance-final-precommit.json "Precommit packaged performance stress and resource evidence"
[5]: ../tools/phase3b-electron-acceptance.cjs "Packaged Electron acceptance and timing methodology"
[6]: ../_temp/live-evidence/retouch-phase3b-performance-small-visible-frame.json "Small packaged visible-frame matrix evidence"
[7]: ../_temp/live-evidence/retouch-phase3b-performance-medium-visible-frame.json "Medium packaged visible-frame matrix evidence"
[8]: ../tests/unit/image-studio-compositor.test.ts "Normal blend exactness and opaque-copy regression tests"
[9]: ../_temp/live-evidence/retouch-performance-full-jest-final.log "Full serial Jest result"
