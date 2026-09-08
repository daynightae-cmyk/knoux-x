const fs = require('node:fs');

const file = 'tests/unit/video-studio-ai.test.ts';
const before = "    expect(result.cheapestPaidCandidate?.id).toBe('minimax/video-01');";
const after = "    expect(result.cheapestPaidCandidate?.id).toBe('fal-ai/kling-video/v3/standard/text-to-video');";
const text = fs.readFileSync(file, 'utf8');
const count = text.split(before).length - 1;
if (count !== 1) throw new Error(`${file}: expected one stale cheapest-candidate assertion, found ${count}`);
fs.writeFileSync(file, text.replace(before, after), 'utf8');
console.log('Fal cheapest paid candidate expectation refreshed.');
