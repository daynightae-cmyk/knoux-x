import {
  formatPaidVideoConfirmation,
  resolvePaidVideoCandidate,
  type VideoPaidCandidate,
  type VideoPaymentPlan,
} from '../../src/features/video-studio/videoPaidConfirmation';

const paid: VideoPaidCandidate = {
  id: 'minimax/video-01',
  name: 'MiniMax Video-01 (Replicate)',
  costBucket: 'paid',
  estimatedCostUsd: 0.5,
};

const free: VideoPaidCandidate = {
  id: 'free/video',
  name: 'Free Video',
  costBucket: 'free-tier',
  estimatedCostUsd: 0,
};

describe('Video Studio paid generation confirmation policy', () => {
  it('requires confirmation for an explicitly selected paid model', () => {
    expect(resolvePaidVideoCandidate(paid.id, [free, paid], null)).toEqual(paid);
  });

  it('does not request paid confirmation for an explicitly selected free model', () => {
    expect(resolvePaidVideoCandidate(free.id, [free, paid], null)).toBeNull();
  });

  it('requires confirmation for the auto-route paid candidate', () => {
    const plan: VideoPaymentPlan = {
      blocked: true,
      requiresPaymentConfirmation: true,
      cheapestPaidCandidate: paid,
    };
    expect(resolvePaidVideoCandidate('', [free, paid], plan)).toEqual(paid);
  });

  it('does not invent a paid candidate when the plan does not require payment', () => {
    const plan: VideoPaymentPlan = {
      blocked: false,
      requiresPaymentConfirmation: false,
      model: free,
    };
    expect(resolvePaidVideoCandidate('', [free, paid], plan)).toBeNull();
  });

  it('renders model and fixed-point estimated cost in the confirmation message', () => {
    expect(formatPaidVideoConfirmation('Use {model} for about ${cost}?', paid))
      .toBe('Use MiniMax Video-01 (Replicate) for about $0.50?');
  });
});
