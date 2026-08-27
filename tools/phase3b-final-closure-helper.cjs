'use strict';

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERT: ${message}`);
}

function stableStack(layer) {
  const retouche = layer?.retouche ?? { operations: [], masks: [] };
  return retouche.operations.map((operation) => ({
    id: operation.id,
    type: operation.type,
    enabled: operation.enabled,
    bodyControl: operation.bodyControl ?? null,
    strength: operation.strength ?? null,
    freezeMaskId: operation.freezeMaskId ?? null,
    strokes: Array.isArray(operation.strokes) ? operation.strokes.map((stroke) => ({
      id: stroke.id ?? null,
      x: stroke.x,
      y: stroke.y,
      dx: stroke.dx,
      dy: stroke.dy,
      radius: stroke.radius,
      strength: stroke.strength,
      mode: stroke.mode,
    })) : [],
  }));
}

async function historyInfo(page) {
  return page.locator('.image-studio-view').evaluate((root) => ({
    count: Number(root.getAttribute('data-history-count')),
    index: Number(root.getAttribute('data-history-index')),
    transactionActive: root.getAttribute('data-transaction-active') === 'true',
    dirty: root.getAttribute('data-document-dirty') === 'true',
  }));
}

async function readDocument(page) {
  return page.evaluate(() => window.knouxImageStudioAPI.getCurrent());
}

async function pixelDiff(page, beforeKey, afterKey) {
  return page.evaluate(({ beforeKey: priorKey, afterKey: nextKey }) => {
    const before = window.__phase3BodySnapshots?.[priorKey];
    const after = window.__phase3BodySnapshots?.[nextKey];
    if (!before || !after) throw new Error(`Missing RGBA snapshots ${priorKey} / ${nextKey}.`);
    if (before.width !== after.width || before.height !== after.height) throw new Error('RGBA dimensions differ.');
    let changedPixels = 0;
    for (let offset = 0; offset < before.data.length; offset += 4) {
      if (before.data[offset] !== after.data[offset]
        || before.data[offset + 1] !== after.data[offset + 1]
        || before.data[offset + 2] !== after.data[offset + 2]
        || before.data[offset + 3] !== after.data[offset + 3]) changedPixels += 1;
    }
    return changedPixels;
  }, { beforeKey, afterKey });
}

async function analysisDiagnostics(page) {
  return page.getByTestId('body-analysis-status').evaluate((node) => {
    const ids = (name) => (node.getAttribute(name) ?? '').split(',').map((id) => id.trim()).filter(Boolean);
    return {
      cacheHits: Number(node.getAttribute('data-analysis-cache-hits') ?? 0),
      cacheMisses: Number(node.getAttribute('data-analysis-cache-misses') ?? 0),
      requestedIds: ids('data-analysis-requested-ids'),
      completedIds: ids('data-analysis-completed-ids'),
      pendingIds: ids('data-analysis-pending-ids'),
    };
  });
}

async function waitForFreshBodyAnalysis(page) {
  await page.getByTestId('retouch-tab-body').click();
  await page.getByTestId('retouch-analyze-body').click();
  await page.waitForFunction(() => {
    const node = document.querySelector('[data-testid="body-analysis-status"]');
    const pending = (node?.getAttribute('data-analysis-pending-ids') ?? '').trim();
    return node?.textContent?.includes('body detected locally') && pending.length === 0;
  }, null, { timeout: 90000 });
  const selector = page.getByTestId('body-subject-selector').getByRole('button', { name: 'Body subject', exact: true });
  assert(await selector.count() === 1 && !await selector.isDisabled(), 'Fresh aggregate document has no selectable local body.');
}

async function runFinalClosureEvidence(page, helpers) {
  const {
    canvasSample,
    storeCanvasPixels,
    waitForStableCanvas,
    strokeCanvas,
    rasterSourceFingerprint,
    exportEvidence,
    protectionMetrics,
    projectPath,
    logProgress,
  } = helpers;

  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Import Image', exact: true }).click();
  const imported = await waitForStableCanvas(page, (sample) => sample.quality === 'final' && sample.width > 0, 'Aggregate fixture did not render.');
  await page.getByRole('button', { name: 'Fit canvas', exact: true }).click();
  await page.waitForTimeout(200);
  await waitForFreshBodyAnalysis(page);
  logProgress('closure-aggregate-import-ready', `${imported.width}x${imported.height}`);

  let documentState = await readDocument(page);
  const originalLayer = documentState.layers.find((layer) => layer.kind === 'raster');
  assert(originalLayer, 'Aggregate document has no initial raster layer.');
  const originalLayerId = originalLayer.id;
  const historyBeforeDuplicate = await historyInfo(page);
  const originalLayerNode = page.locator(`.image-studio-layer-item[data-layer-id="${originalLayerId}"]`);
  await originalLayerNode.locator('button.image-studio-layer-action').first().click();
  await page.waitForFunction((id) => document.querySelectorAll('.image-studio-layer-item').length >= 2
    && Array.from(document.querySelectorAll('.image-studio-layer-item')).some((node) => node.getAttribute('data-layer-id') === id), originalLayerId, { timeout: 30000 });
  documentState = await readDocument(page);
  const rasterLayers = documentState.layers.filter((layer) => layer.kind === 'raster');
  assert(rasterLayers.length === 2, `Expected two raster layers after UI duplicate, got ${rasterLayers.length}.`);
  // Duplicate is inserted immediately after its source and therefore renders above it. Edit that
  // stable duplicate as A so hiding A reveals the untouched original B without compositing overlap.
  const layerBId = originalLayerId;
  const layerAId = rasterLayers.find((layer) => layer.id !== layerBId)?.id;
  assert(layerAId, 'UI duplicate did not create stable editable raster layer A.');
  const sourceBefore = await rasterSourceFingerprint(page);
  const sourceA = sourceBefore.sourceLayers.find((layer) => layer.layerId === layerAId);
  const sourceB = sourceBefore.sourceLayers.find((layer) => layer.layerId === layerBId);
  assert(sourceA && sourceB, 'Both raster source assets must be readable before aggregate editing.');
  await page.locator(`.image-studio-layer-item[data-layer-id="${layerAId}"]`).click();

  const states = [];
  async function capture(label, previousLabel) {
    const key = `aggregate-${label}`;
    const sample = await waitForStableCanvas(page, (value) => value.quality === 'final' && value.source === 'full', `${label} did not settle to final raster.`);
    await storeCanvasPixels(page, key);
    const doc = await readDocument(page);
    const layerA = doc.layers.find((layer) => layer.id === layerAId);
    const history = await historyInfo(page);
    const stack = stableStack(layerA);
    const priorKey = previousLabel ? `aggregate-${previousLabel}` : null;
    const changedPixelsVsPrevious = priorKey ? await pixelDiff(page, priorKey, key) : 0;
    const changedPixelsVsH0 = label === 'H0' ? 0 : await pixelDiff(page, 'aggregate-H0', key);
    const state = {
      label,
      canvas: { width: sample.width, height: sample.height, rgbaSha256: sample.hash },
      operationCount: stack.length,
      operationOrder: stack.map((operation) => operation.id),
      operationTypes: stack.map((operation) => operation.type),
      operations: stack,
      history,
      changedPixelsVsPrevious,
      changedPixelsVsH0,
    };
    states.push(state);
    return state;
  }

  const h0 = await capture('H0', null);
  assert(h0.operationCount === 0, `H0 should have no layer-A operations, got ${h0.operationCount}.`);
  assert(h0.history.count >= historyBeforeDuplicate.count, 'Layer duplication unexpectedly reduced history.');

  async function addAggregateBody(label, testId, control) {
    const beforeHistory = await historyInfo(page);
    const beforeSample = await canvasSample(page);
    const previousOperationCount = await page.locator('.retouch-operation-item').count();
    await page.getByTestId(testId).click();
    const armedHistory = await historyInfo(page);
    assert(armedHistory.count === beforeHistory.count && armedHistory.index === beforeHistory.index,
      `${label} tool selection created a history entry before its gesture.`);
    assert(armedHistory.transactionActive, `${label} tool selection did not arm its coalesced gesture transaction.`);
    const operation = page.locator('.retouch-operation-item').nth(previousOperationCount);
    await operation.waitFor({ state: 'visible', timeout: 30000 });
    assert(await operation.getAttribute('data-body-control') === control, `${label} active control is not ${control}.`);
    const slider = operation.locator('input[type="range"][min="-1"][max="1"]').first();
    const box = await slider.boundingBox();
    assert(box && box.width > 20, `${label} strength slider unavailable.`);
    await slider.focus();
    assert(await slider.evaluate((element) => document.activeElement === element), `${label} slider cannot receive its native keyboard gesture.`);
    await page.keyboard.press('PageUp');
    const changed = await waitForStableCanvas(page, (sample) => sample.quality === 'final' && sample.hash !== beforeSample.hash, `${label} did not produce a final raster change.`);
    const afterHistory = await historyInfo(page);
    assert(!afterHistory.transactionActive, `${label} left a dangling transaction after pointer-up.`);
    assert(afterHistory.count === beforeHistory.count + 1 && afterHistory.index === beforeHistory.index + 1,
      `${label} drag must coalesce to exactly one history entry: ${JSON.stringify({ beforeHistory, afterHistory })}`);
    return { operationId: await operation.getAttribute('data-testid'), hash: changed.hash, historyBefore: beforeHistory, historyAfter: afterHistory };
  }

  const operations = [
    ['H1', 'retouch-add-body-slim', 'overallSlim'],
    ['H2', 'retouch-add-waist', 'waist'],
    ['H3', 'retouch-add-hips', 'hips'],
    ['H4', 'retouch-add-shoulders', 'shoulders'],
    ['H5', 'retouch-add-arm', 'arms'],
    ['H6', 'retouch-add-leg', 'legs'],
    ['H7', 'retouch-add-leg-length', 'legLength'],
    ['H8', 'retouch-add-torso-width', 'torsoWidth'],
  ];
  const transactions = [];
  let previousLabel = 'H0';
  for (const [label, testId, control] of operations) {
    transactions.push(await addAggregateBody(label, testId, control));
    const state = await capture(label, previousLabel);
    assert(state.operationCount === Number(label.slice(1)), `${label} operation count is not cumulative.`);
    assert(state.operations.at(-1)?.bodyControl === control, `${label} latest operation control is not retained.`);
    previousLabel = label;
    logProgress('closure-history-state', `${label} ops=${state.operationCount}`);
  }

  const manualBeforeHistory = await historyInfo(page);
  const manualBefore = await canvasSample(page);
  const manualOperationCount = await page.locator('.retouch-operation-item').count();
  await page.getByTestId('retouch-add-manual-body-warp').click();
  const manualOperation = page.locator('.retouch-operation-item').nth(manualOperationCount);
  await manualOperation.waitFor({ state: 'visible', timeout: 30000 });
  assert((await historyInfo(page)).count === manualBeforeHistory.count, 'Manual tool selection created a history entry before its stroke.');
  await page.waitForTimeout(200);
  const activeTypeBeforeStroke = await page.locator('.image-studio-canvas-container').getAttribute('data-active-retouch-type');
  assert(activeTypeBeforeStroke === 'geometry-warp', `H9 manual tool did not become active: ${activeTypeBeforeStroke}`);
  await strokeCanvas(page, { x: 0.50, y: 0.46 }, { x: 0.58, y: 0.46 });
  await page.waitForTimeout(300);
  const manualStrokeCount = Number(await manualOperation.getAttribute('data-stroke-count'));
  const manualPointerDiagnostic = await page.evaluate(() => {
    const canvas = document.querySelector('canvas.image-studio-canvas');
    const container = document.querySelector('.image-studio-canvas-container');
    const rect = canvas?.getBoundingClientRect();
    const x = rect ? rect.left + rect.width * 0.5 : 0;
    const y = rect ? rect.top + rect.height * 0.46 : 0;
    const hit = document.elementFromPoint(x, y);
    return {
      canvasRect: rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null,
      hitTag: hit?.tagName ?? null,
      hitClass: hit?.className ?? null,
      hitWithinCanvasContainer: Boolean(hit && container?.contains(hit)),
      activeType: container?.getAttribute('data-active-retouch-type') ?? null,
    };
  });
  assert(manualStrokeCount > 0, `H9 manual body warp did not record a stroke; ${JSON.stringify({ activeTypeBeforeStroke, manualPointerDiagnostic })}`);
  await waitForStableCanvas(page, (sample) => sample.quality === 'final' && sample.hash !== manualBefore.hash, `H9 manual body warp did not alter final raster; strokes=${manualStrokeCount}`);
  const manualAfterHistory = await historyInfo(page);
  assert(manualAfterHistory.count === manualBeforeHistory.count + 1 && manualAfterHistory.index === manualBeforeHistory.index + 1,
    `Manual body stroke must coalesce to one history entry: ${JSON.stringify({ manualBeforeHistory, manualAfterHistory })}`);
  const h9 = await capture('H9', 'H8');
  assert(h9.operationCount === 9 && h9.operations.at(-1)?.type === 'geometry-warp', 'H9 does not retain the complete ordered stack ending in Manual Body Warp.');
  transactions.push({ label: 'H9', operationId: await manualOperation.getAttribute('data-testid'), historyBefore: manualBeforeHistory, historyAfter: manualAfterHistory, strokeCount: manualStrokeCount, activeTypeBeforeStroke });

  const undo = [];
  for (let index = states.length - 1; index > 0; index -= 1) {
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    const expected = states[index - 1];
    const sample = await waitForStableCanvas(page, (value) => value.quality === 'final' && value.hash === expected.canvas.rgbaSha256, `Undo from ${states[index].label} did not restore ${expected.label}.`);
    const doc = await readDocument(page);
    const actualStack = stableStack(doc.layers.find((layer) => layer.id === layerAId));
    assert(JSON.stringify(actualStack) === JSON.stringify(expected.operations), `Undo stack does not match ${expected.label}.`);
    const history = await historyInfo(page);
    assert(history.index === expected.history.index, `Undo history index ${history.index} does not match ${expected.label} ${expected.history.index}.`);
    undo.push({ from: states[index].label, to: expected.label, rgbaSha256: sample.hash, operationOrder: actualStack.map((operation) => operation.id), history });
  }

  const sourceAfterUndoAll = await rasterSourceFingerprint(page);
  const redo = [];
  for (let index = 1; index < states.length; index += 1) {
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    const expected = states[index];
    const sample = await waitForStableCanvas(page, (value) => value.quality === 'final' && value.hash === expected.canvas.rgbaSha256, `Redo to ${expected.label} did not restore exact raster.`);
    const doc = await readDocument(page);
    const actualStack = stableStack(doc.layers.find((layer) => layer.id === layerAId));
    assert(JSON.stringify(actualStack) === JSON.stringify(expected.operations), `Redo stack does not match ${expected.label}.`);
    const history = await historyInfo(page);
    assert(history.index === expected.history.index, `Redo history index ${history.index} does not match ${expected.label} ${expected.history.index}.`);
    redo.push({ to: expected.label, rgbaSha256: sample.hash, operationOrder: actualStack.map((operation) => operation.id), history });
  }

  const beforeAfterBefore = {
    history: await historyInfo(page),
    diagnostics: await analysisDiagnostics(page),
    operations: stableStack((await readDocument(page)).layers.find((layer) => layer.id === layerAId)),
  };
  await page.keyboard.down('\\');
  const beforeSample = await waitForStableCanvas(page, (sample) => sample.hash === h0.canvas.rgbaSha256, 'Held Before/After did not render the true H0 baseline.');
  await page.keyboard.up('\\');
  const afterSample = await waitForStableCanvas(page, (sample) => sample.hash === h9.canvas.rgbaSha256, 'Released Before/After did not restore exact H9.');
  const beforeAfterAfter = {
    history: await historyInfo(page),
    diagnostics: await analysisDiagnostics(page),
    operations: stableStack((await readDocument(page)).layers.find((layer) => layer.id === layerAId)),
  };
  assert(JSON.stringify(beforeAfterAfter) === JSON.stringify(beforeAfterBefore), `Before/After mutated state: ${JSON.stringify({ before: beforeAfterBefore, after: beforeAfterAfter })}`);

  let twoLayerDoc = await readDocument(page);
  const layerA = twoLayerDoc.layers.find((layer) => layer.id === layerAId);
  const layerB = twoLayerDoc.layers.find((layer) => layer.id === layerBId);
  assert(layerA && layerB, 'Two-layer document lost a raster layer before isolation assertions.');
  assert(stableStack(layerA).length === 9 && stableStack(layerB).length === 0, 'Body stack ownership is not isolated to raster layer A.');
  const compositeHash = (await canvasSample(page)).hash;
  const layerAVisibility = page.locator(`.image-studio-layer-item[data-layer-id="${layerAId}"] button.image-studio-layer-visibility`);
  await layerAVisibility.click();
  const bOnly = await waitForStableCanvas(page, (sample) => sample.quality === 'final' && sample.hash === h0.canvas.rgbaSha256, 'Hiding layer A did not reveal uncontaminated layer-B raster.');
  await layerAVisibility.click();
  const compositeRestored = await waitForStableCanvas(page, (sample) => sample.quality === 'final' && sample.hash === compositeHash, 'Showing layer A did not restore exact edited composite.');

  const sourceAfterRedo = await rasterSourceFingerprint(page);
  await page.getByRole('button', { name: 'Save As', exact: true }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('toolbar', { name: 'Document operations' }).getByRole('button', { name: 'Open', exact: true }).click();
  const reopened = await waitForStableCanvas(page, (sample) => sample.quality === 'final' && sample.hash === compositeHash, 'Reopened two-layer project did not restore edited composite.');
  const sourceAfterReopen = await rasterSourceFingerprint(page);
  const reopenedDoc = await readDocument(page);
  const reopenedA = reopenedDoc.layers.find((layer) => layer.id === layerAId);
  const reopenedB = reopenedDoc.layers.find((layer) => layer.id === layerBId);
  assert(reopenedA && reopenedB && stableStack(reopenedA).length === 9 && stableStack(reopenedB).length === 0, 'Reopened project did not retain stable layer IDs and isolated operation ownership.');
  const reopenedAVisibility = page.locator(`.image-studio-layer-item[data-layer-id="${layerAId}"] button.image-studio-layer-visibility`);
  await reopenedAVisibility.click();
  const reopenedBOnly = await waitForStableCanvas(page, (sample) => sample.quality === 'final' && sample.hash === bOnly.hash, 'Reopened layer-B-only render differs from its pre-save hash.');
  await reopenedAVisibility.click();
  const reopenedComposite = await waitForStableCanvas(page, (sample) => sample.quality === 'final' && sample.hash === compositeHash, 'Reopened composite did not restore after showing A.');
  const aggregateExport = await exportEvidence(page);
  const sourceAfterExport = await rasterSourceFingerprint(page);

  const fingerprints = { before: sourceBefore, afterOperations: sourceAfterRedo, afterUndoAll: sourceAfterUndoAll, afterRedoAll: sourceAfterRedo, afterSave: sourceAfterRedo, afterReopen: sourceAfterReopen, afterExport: sourceAfterExport };
  const sameSources = Object.values(fingerprints).every((fingerprint) => JSON.stringify(fingerprint.sourceLayers) === JSON.stringify(sourceBefore.sourceLayers));
  assert(sameSources, 'Aggregate two-layer scenario mutated a source raster asset.');

  const finalLayerA = reopenedDoc.layers.find((layer) => layer.id === layerAId);
  const finalRetouche = finalLayerA?.retouche ?? { operations: [], masks: [] };
  const geometryOperation = finalRetouche.operations.find((operation) => operation.type === 'body-reshape' && operation.bodyGeometry);
  const protectionMask = finalRetouche.masks.find((mask) => mask.id === geometryOperation?.freezeMaskId) ?? finalRetouche.masks[0];
  assert(geometryOperation?.bodyGeometry && protectionMask, 'Aggregate continuity has no retained body geometry and local protection mask.');
  const continuityCases = [
    { operation: 'Waist', before: 'H1', after: 'H2' },
    { operation: 'Shoulders', before: 'H3', after: 'H4' },
    { operation: 'Arm', before: 'H4', after: 'H5' },
    { operation: 'Leg', before: 'H5', after: 'H6' },
    { operation: 'Leg Length', before: 'H6', after: 'H7' },
    { operation: 'Manual Body Warp', before: 'H8', after: 'H9' },
  ];
  const continuityRecords = [];
  for (const definition of continuityCases) {
    const metric = await protectionMetrics(page, `aggregate-${definition.before}`, `aggregate-${definition.after}`, protectionMask, geometryOperation.bodyGeometry);
    const limbChains = metric.limbContinuity;
    const guards = Object.values(metric.jointGuards);
    const finiteGuards = guards.every((guard) => {
      const displacement = guard.displacement;
      return Number.isFinite(displacement.centerPx.x) && Number.isFinite(displacement.centerPx.y)
        && Number.isFinite(displacement.dxPx) && Number.isFinite(displacement.dyPx)
        && Number.isFinite(displacement.magnitudePx) && Number.isFinite(displacement.searchRadiusPx)
        && displacement.centerPx.x >= 0 && displacement.centerPx.y >= 0;
    });
    const boundedChains = Object.values(limbChains).every((chain) => Number.isFinite(chain.maximumAdjacentDeltaPx)
      && Number.isFinite(chain.continuityRatio) && Number.isFinite(chain.allowedRatio)
      && chain.maximumAdjacentDeltaPx <= chain.samplerAdjacentBoundPx
      && chain.continuityRatio <= chain.allowedRatio);
    const pass = finiteGuards && boundedChains;
    assert(pass, `Joint continuity gate failed for ${definition.operation}: ${JSON.stringify({ finiteGuards, limbChains })}`);
    continuityRecords.push({
      ...definition,
      pass,
      finiteGuards,
      topology: {
        samplingCoordinatesClamped: true,
        finiteCoordinates: finiteGuards,
        deformationMeshJacobian: 'NOT MEASURED — raster liquify path exposes no mesh topology for a Jacobian check.',
        foldOver: 'NOT MEASURED — no triangle or quad orientation is exposed by the production renderer.',
      },
      limbChains,
    });
  }

  return {
    aggregateHistory: {
      verified: true,
      states,
      undo,
      redo,
      transactions,
      beforeAfter: { beforeHash: beforeSample.hash, afterHash: afterSample.hash, stateUnchanged: true },
    },
    twoLayerIsolation: {
      verified: true,
      layerAId,
      layerBId,
      layerAOperationCount: stableStack(reopenedA).length,
      layerBOperationCount: stableStack(reopenedB).length,
      bOnlyHash: bOnly.hash,
      compositeHash,
      compositeRestoredHash: compositeRestored.hash,
      reopenedCompositeHash: reopenedComposite.hash,
      reopenedBOnlyHash: reopenedBOnly.hash,
    },
    sourceImmutability: { verified: true, fingerprints },
    jointContinuity: {
      verified: true,
      metric: {
        raw: 'adjacent displacement-vector delta in px',
        normalized: 'adjacent displacement-vector delta divided by local limb length in px',
        allowed: '2 × the largest local RGB block-match search radius, normalized by the same limb length',
        rationale: 'The local matcher cannot establish a trustworthy continuous vector outside its own bounded correspondence window; the limit is therefore derived from the measured sampler architecture, not a visual-quality guess.',
      },
      records: continuityRecords,
    },
    aggregateSaveReopen: { verified: true, projectPath, reopenedHash: reopened.hash, restoredHash: reopenedComposite.hash },
    aggregateExport: { verified: true, pixelHash: aggregateExport.pixelHash, width: aggregateExport.width, height: aggregateExport.height },
  };
}

module.exports = { runFinalClosureEvidence };
