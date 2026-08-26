# قبول KNOuX X Retouch — Phase 3

**الحكم الحالي: `PARTIAL`**

تؤكد هذه الوثيقة ما ثبت في تشغيل Electron **معبأ فعلياً**، ولا ترفع الحالة إلى `PASS` لمجرد نجاح مسار B0–B9. سبق قبول post-commit نظيف على `1daac673810aee6f639447db1c2bae045f7f55de`. الأدلة الأحدث للـcache، استمرارية المفاصل، ثبات مصدر raster ومصفوفة الأداء هي أدلة working-tree قبل الالتزام التالي؛ لذلك يلزم قبول post-commit جديد مع `commit` مطابق و`trackedTreeClean=true` قبل حكم إصدار نهائي.

## ملخص القرار

| بند مطلوب | الحالة | الدليل أو القيد |
|---|---|---|
| Phase 3A | `PASS` سابق، غير معاد هنا | خارج نطاق تشغيل B0–B9 الحالي؛ لا يعاد بلا ضرورة. |
| تحليل الجسم | `PASS` | جسم واحد محلياً مع segmentation؛ النموذج `mediapipe-pose-landmarker-full`. |
| التشوه | `PASS` لخصر ويدوي وسبع أدوات UI | changed pixels مؤكدة، مع Body Slim/Hips/Shoulders/Arm/Leg/Leg Length/Torso Width. |
| UI | `PARTIAL` | كل أداة عرضت `data-body-control` الصحيح، غيّرت raster، ثم undo وredo والإزالة أعادت hash الدقيق لكل أداة على حدة؛ لا يوجد بعد تسلسل undo-all/redo-all واحد يغطي الأدوات التسع معاً. |
| الخلفية | `PASS` في B6 | 10,802,186 بكسل خلفية بعيدة بلا تغيير، max delta = 0 للخصر/اليدوي/Leg. |
| الرأس/المفاصل | `PARTIAL` | الرأس byte-identical؛ سُجلت 12 منطقة مفصلية لكل عملية مع block-match RGB محلي وإزاحة لكل نقطة. لا يوجد بعد threshold معتمد للاستمرارية. |
| الاستمرارية | `PARTIAL` | القياس موجود الآن: Leg سجل maximum adjacent vector deltas بمقدار 2 و2 و3 و4 px للأذرع/الساقين؛ لا يوجد حد قبول معتمد بعد. |
| الحفظ وإعادة الفتح | `PASS` لمسار B4 | hash النهائي مطابق؛ عملية جسم ويدوية وmask حفظت وأعيدت قراءتها، وSHA مصدر raster بقي متطابقاً قبل التعديل وبعده وبعد reopen. |
| التصدير | `PASS` لمسار B5 | PNG بقياس 3000×4572 وpixel hash مطابق للرندر النهائي. |
| proxy/final | `PASS` | 672×1024 proxy ثم 3000×4572 final في نافذة الحزمة. |
| stale | `PASS` لمسار منزلق C | آخر قيمة محفوظة ولا stale overwrite في الدليل. |
| offline | `PASS` لمسار B7 | محاولة `POST https://odml.pa.googleapis.com/v1/log` سُجلت وحُجبت؛ النموذج وWASM محليان. |
| الأداء | `PASS` للمسارات المقاسة | مصفوفة 750×1143 و1500×2286 و3000×4572، cache hit/miss وrequest IDs وproxy/final وstale موثقة؛ الذاكرة تبقى `NOT MEASURED`. |
| قبول Electron | `PASS` على الالتزام السابق | exe الحقيقي، `file://...app.asar...`، حارس الشبكة قبل أول نافذة؛ يلزم تكراره بعد الالتزام التالي. |
| الإجمالي | `PARTIAL` | لا دليل SHA نهائي نظيف للتغييرات الحالية، ولا aggregate undo-all/redo-all أو threshold استمرارية أو حالة طبقتين إنتاجية بعد. |

## أدلة B0–B9 المعبأة

| الاختبار | النتيجة | تفاصيل قابلة للتحقق |
|---|---|---|
| B0 | `PASS` | Pose محلي لجسم واحد مع segmentation؛ cache miss أولاً ثم cache hit بلا request ID جديد، مع صفوف صغيرة ومتوسطة وكاملة. |
| B1 | `PASS` | Waist غيّر full canvas عن baseline. |
| مصفوفة الجسم | `PASS` لكل أداة | الأدوات السبع التلقائية تغيّر البكسلات ثم تعود hash السابق في undo وredo والإزالة؛ مع B1 Waist وB2 Manual تصبح الأدوات التسع مغطاة وظيفياً، لكن لا aggregate sequence بعد. |
| B2 | `PASS` | Manual Body Warp أنتج 16 stroke وتغيّر نهائي. |
| B3 | `PASS` | undo وredo أعادا hash الدقيق لمسار اليدوي. |
| B4 | `PASS` | save/reopen exact؛ وثّق project SHA وmask وعمليات الجسم/اليدوي وSHA source raster الثابت في قبل/بعد/reopen. |
| B5 | `PASS` | export exact 3000×4572، hash raster مطابق. |
| B6 | `PASS` لقياس الخلفية/الرأس وLeg | Waist وManual وLeg رُصدت؛ الخلفية والرأس protected byte-identical. |
| B7 | `PASS` | الحارس في `session.defaultSession` قبل إنشاء النافذة؛ كل محاولة HTTP(S) ملغاة ومسجلة. |
| B8 | `PASS` | proxy حقيقي 672×1024 أثناء gesture، final حقيقي 3000×4572 بعد pointer-up. |
| B9 | `PASS` | سلسلة C لا تُستبدل بنتيجة قديمة؛ مقاييس الرصد في تقرير الأداء. |

> الفرق بين **«محمي»** و**«مقاس»** جوهري. alpha غير الصفري يعني freeze في المحرك، وقد أضيف اختبار وحدة يثبت ثبات البكسلات المجمّدة ومصدر raster. أما الدوائر حول نقاط مفاصل Pose فهي قياسات موضعية صادقة؛ ليست كلها أجزاء من freeze mask ولا يصح تسميتها حماية جامدة حيث لا يغطيها القناع.

## حماية الصورة ونتائج B6

| العملية | core changed | الخلفية البعيدة changed / total | الرأس changed / total | نتيجة المفاصل |
|---|---:|---:|---:|---|
| Waist | 311,066 | 0 / 10,802,186 | 0 / 240,920 | 12/12 guards byte-identical في هذه العملية. |
| Manual Body Warp | 495,415 | 0 / 10,802,186 | 0 / 240,920 | 12/12 guards byte-identical في هذه العملية. |
| Leg | 1,076,057 | 0 / 10,802,186 | 0 / 240,920 | سُجلت 12 guards؛ proximal/joint مناطق ثابتة، أما distal غير المغطى بالقناع فله displacement مرصود. |

يعني نجاح Leg أن أثر الأداة ظهر في core مع بقاء الخلفية والرأس دون تغيير، لا أن كل نقطة limb يجب أن تتجمد؛ الهدف من Leg يتضمن حركة مشروعة في الأطراف. يسجل harness الآن local-RGB block match وإزاحات نقاط المفاصل وفروق المتجهات المتجاورة، لكنه لا يفرض threshold غير معتمد؛ لذلك تبقى بوابة الاستمرارية `PARTIAL`.

## موارد offline المحلية

| الأصل | الحالة |
|---|---|
| Pose model | داخل `resources/assets/models/pose_landmarker_full.task`، الحجم 9,398,198 bytes، SHA-256 `4eaa5eb7a98365221087693fcc286334cf0858e2eb6e15b506aa4a7ecdcec4ad`. |
| MediaPipe WASM | موجود داخل `app.asar` تحت `.vite/renderer/main_window/mediapipe` بثلاثة ملفات WASM. |
| الشبكة | محاولة telemetry واحدة من Chromium سُجلت **محجوبة**؛ لا يُدّعى أنه لم تقع محاولة. |

## بوابات الإغلاق المتبقية

لا بد من إكمال العناصر التالية قبل تحويل الحكم إلى `PASS`:

1. تنفيذ قبول ما بعد الالتزام على الحزمة التي تنتج من SHA النهائي، مع `commit` مطابق و`trackedTreeClean=true`.
2. إضافة تسلسل undo-all ثم redo-all واحد للأدوات التسع مع snapshots صادقة لكل حالة متتالية.
3. إثبات two-raster-layer isolation عبر سيناريو UI إنتاجي؛ source non-mutation وbefore/after hash مثبتان الآن.
4. قياس الذاكرة وCPU إن أريد تحويل تقرير الأداء إلى ملف قياس موارد كامل؛ cache/matrix/request IDs وstale مثبتة الآن.
5. اعتماد وتطبيق threshold استمرارية/displacement هندسي لكل مفصل؛ القياسات موجودة، لكن لا يصح اختراع حد قبول.

## المراجع الداخلية

1. `_temp/live-evidence/retouch-phase3b-electron-acceptance.json` — دليل B0–B9 الحي للحزمة المعبأة، قبل الالتزام التالي.
2. `tools/phase3b-electron-acceptance.cjs` — مصدر الاختبار، لقطات RGBA، metrics، B7، proxy/final وstale.
3. `tests/unit/retouch-phase3-alpha-protection.test.ts` — اختبار alpha freeze وعدم تحور source raster.
4. `artifacts/retouch-phase3b-performance.md` — مصفوفة الأداء والـcache وقيود الموارد.
