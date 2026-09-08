const fs = require('node:fs');

function replaceOnce(file, before, after) {
  let text = fs.readFileSync(file, 'utf8');
  const count = text.split(before).length - 1;
  if (count !== 1) throw new Error(`${file}: expected one match, found ${count}`);
  fs.writeFileSync(file, text.replace(before, after), 'utf8');
}

replaceOnce(
  'src/features/video-studio/VideoStudioView.tsx',
  "import type { FFmpegCapabilities, ProbeResult } from '../../../electron/creative/ffmpeg-service';\n",
  "import type { FFmpegCapabilities, ProbeResult } from '../../../electron/creative/ffmpeg-service';\nimport { formatPaidVideoConfirmation, resolvePaidVideoCandidate, type VideoPaymentPlan } from './videoPaidConfirmation';\n",
);

replaceOnce(
  'src/features/video-studio/VideoStudioView.tsx',
`  const handleAiGenerate = useCallback(async (): Promise<void> => {
    const api = videoStudioAPI();
    if (!api || !aiPrompt.trim()) return;

    setAiGenerating(true);
    setAiPlanResult(null);
    try {
      const result = await api.createJob({
        task: aiTask,
        prompt: aiPrompt,
        negativePrompt: aiNegativePrompt || null,
        seed: aiSeed,
        width: aiWidth,
        height: aiHeight,
        durationSeconds: aiDuration,
        fps: aiFPS,
        explicitModelId: aiModelId || undefined,
        allowPaidFallback: false,
      });

      setJobs((prev) => [...prev, {
        id: result.id,
        status: result.status,
        phase: result.phase,
        provider: '',
        modelId: aiModelId,
        task: aiTask,
        prompt: aiPrompt,
      }]);
      setAiGenerating(false);
    } catch {
      setAiGenerating(false);
    }
  }, [aiDuration, aiFPS, aiHeight, aiModelId, aiNegativePrompt, aiPrompt, aiSeed, aiTask, aiWidth]);`,
`  const handleAiGenerate = useCallback(async (): Promise<void> => {
    const api = videoStudioAPI();
    if (!api || !aiPrompt.trim()) return;

    setAiGenerating(true);
    setAiPlanResult(null);
    try {
      let plan: VideoPaymentPlan | null = null;
      if (!aiModelId) {
        plan = await api.aiPlan(aiTask, false) as VideoPaymentPlan;
        setAiPlanResult(plan);
        if (plan.blocked && !plan.requiresPaymentConfirmation) return;
      }

      const paidCandidate = resolvePaidVideoCandidate(aiModelId, models, plan);
      let allowPaidFallback = false;
      if (paidCandidate) {
        const confirmation = formatPaidVideoConfirmation(t('videoStudio.aiPaidConfirm'), paidCandidate);
        if (!window.confirm(confirmation)) return;
        allowPaidFallback = true;
      }

      const result = await api.createJob({
        task: aiTask,
        prompt: aiPrompt,
        negativePrompt: aiNegativePrompt || null,
        seed: aiSeed,
        width: aiWidth,
        height: aiHeight,
        durationSeconds: aiDuration,
        fps: aiFPS,
        explicitModelId: aiModelId || undefined,
        allowPaidFallback,
      });

      setJobs((prev) => [...prev, {
        id: result.id,
        status: result.status,
        phase: result.phase,
        provider: '',
        modelId: aiModelId,
        task: aiTask,
        prompt: aiPrompt,
      }]);
    } finally {
      setAiGenerating(false);
    }
  }, [aiDuration, aiFPS, aiHeight, aiModelId, aiNegativePrompt, aiPrompt, aiSeed, aiTask, aiWidth, models, t]);`,
);

replaceOnce(
  'src/locales/videoStudio.ts',
  "  aiPlanPaid: 'Paid model — confirmation required',\n",
  "  aiPlanPaid: 'Paid model — confirmation required',\n  aiPaidConfirm: 'This generation may cost about ${cost} using {model}. Continue?',\n",
);
replaceOnce(
  'src/locales/videoStudio.ts',
  "  aiPlanPaid: 'نموذج مدفوع — تأكيد مطلوب',\n",
  "  aiPlanPaid: 'نموذج مدفوع — تأكيد مطلوب',\n  aiPaidConfirm: 'قد تكلف عملية التوليد نحو ${cost} باستخدام {model}. هل تريد المتابعة؟',\n",
);
