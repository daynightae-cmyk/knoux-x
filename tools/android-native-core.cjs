/* Pure decision logic for driving native Android surfaces (DocumentsUI chooser,
 * MediaProjection consent) from accessibility hierarchies.
 *
 * Kept free of adb/device access on purpose: the decisions are the part that
 * failed on CI, and they are unit tested against recorded runner XML.
 *
 * Two rules from the CI evidence drive this module:
 *  - The app's WebView stays mounted behind native dialogs, so a React locator
 *    count()/isVisible() is NOT foreground evidence. uiautomator reports the
 *    topmost window, so any foreign native package in a dump covers the app.
 *  - `dumpsys window windows` printed no mCurrentFocus on the observed runner,
 *    so window-manager focus is only a secondary source here.
 */
'use strict';

const APP_PACKAGE = 'dev.knoux.playerx';
const FIXTURE_NAME = 'KNOUX-QA.mp4';
const NATIVE_SURFACE_PACKAGES = new Set([
  'com.google.android.documentsui',
  'com.android.documentsui',
  'com.android.systemui',
  'com.android.permissioncontroller',
  'com.google.android.permissioncontroller',
]);
const APP_PICKER_PACKAGES = new Set([
  'com.android.systemui',
  'com.google.android.documentsui',
  'com.android.documentsui',
]);
const ENTIRE_SCREEN_LABELS = ['Entire screen', 'Share your entire screen', 'Share entire screen', 'Whole screen', 'Full screen', 'Entire device'];
/* Exact label match first; the fallback tolerates the wording Android uses for
 * the same control ("Share entire screen", "Full screen", ...) without ever
 * matching the single-app option, which must never be selected. */
const ENTIRE_SCREEN_PATTERN = /(entire|whole|full)\s*(device|screen)/i;
const SINGLE_APP_PATTERN = /(single app|one app|a single)/i;
const START_LABELS = ['Start now', 'Start recording', 'Start sharing', 'Start'];
const POSITIVE_BUTTON_ID = 'android:id/button1';
const SESSION_DEATH = /has been closed|Target closed|Target (page|closed)|not attached|browser has been closed|Execution context was destroyed|Page closed|Timeout \d+ ?ms exceeded/i;

function parseNodes(xml) {
  if (typeof xml !== 'string' || !xml.includes('<node')) return [];
  return [...xml.matchAll(/<node\b[^>]+>/g)].map((match) => match[0]);
}

function attrOf(node, name) {
  const found = new RegExp(`${name}="([^"]*)"`).exec(node);
  return found ? found[1] : '';
}

function nodeBoundsOf(node) {
  const found = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(node);
  return found ? { left: +found[1], top: +found[2], right: +found[3], bottom: +found[4] } : null;
}

function matchesLabelsOf(node, labels) {
  return labels.some((label) => node.includes(`text="${label}"`) || node.includes(`content-desc="${label}"`));
}

function packagesIn(nodes) {
  return [...new Set(nodes.map((node) => attrOf(node, 'package')).filter(Boolean))];
}

/* Foreign = anything that is not our own package. The app package is removed
 * deliberately: a mounted-but-background WebView must never read as foreground. */
function coveringNativeSurface(nodes) {
  return packagesIn(nodes).find((pkg) => pkg !== APP_PACKAGE) ?? null;
}

function isAppSurface(nodes) {
  const packages = packagesIn(nodes);
  return packages.length > 0 && !coveringNativeSurface(nodes);
}

/* Node matchers. A matcher is a predicate over a freshly re-dumped hierarchy,
 * never an identity comparison against a node from an earlier dump: the
 * stability check re-reads the screen and must land on the same control. */
const fixtureRowMatcher = () => (node) => matchesLabelsOf(node, [FIXTURE_NAME]);
const folderTileMatcher = () => (node) => attrOf(node, 'text') === 'Download'
  && attrOf(node, 'resource-id') === 'android:id/title'
  && attrOf(node, 'package') !== APP_PACKAGE;
const rootsDrawerMatcher = () => (node) => matchesLabelsOf(node, ['Show roots']);
const downloadsRowMatcher = () => (node) => attrOf(node, 'text') === 'Downloads'
  && attrOf(node, 'package') !== APP_PACKAGE;

/* One bounded chooser step. The recorded CI states are:
 *   - media "Videos" root: a "Download" folder tile (`android:id/title`) whose
 *     folder must be opened before the fixture is listed;
 *   - a listing that already contains the fixture row;
 *   - neither: fall back to the roots drawer.
 * "Downloads" (roots drawer row) and "Download" (folder tile) are deliberately
 * matched by exact text plus resource-id, never by substring. */
function chooserAction(nodes) {
  const fixture = nodes.find(fixtureRowMatcher());
  if (fixture) return { type: 'file-row', node: fixture, kind: 'fixture', note: 'fixture-row-visible' };
  const folder = nodes.find(folderTileMatcher());
  if (folder) return { type: 'folder-tile', node: folder, kind: 'folder', note: 'media-download-folder-tile' };
  const roots = nodes.find(rootsDrawerMatcher());
  if (roots) return { type: 'roots-drawer', node: roots, kind: 'roots', note: 'roots-drawer-available' };
  return { type: 'wait', note: 'no-known-target-in-dump' };
}

/* Only after the roots drawer is open. Exact "Downloads" text: the top-left
 * breadcrumb chip of the Downloads root carries the same text and tapping it
 * is a harmless no-op, while the folder tile in the media root is "Download". */
function downloadsRootAction(nodes) {
  const row = nodes.find(downloadsRowMatcher());
  return row ? { type: 'downloads-root', node: row, kind: 'downloads', note: 'drawer-downloads-row' } : { type: 'wait', note: 'drawer-has-no-downloads-row' };
}

/* MediaProjection consent, decided from the live hierarchy only — never from
 * window-manager focus, which is unavailable on this runner. Controls are
 * matched inside the active SystemUI/permission-controller dialog package, so
 * a consent title that merely mentions "KNOUX X" can never be tapped. */
function consentAction(nodes, state = {}) {
  const native = packagesIn(nodes).filter((pkg) => NATIVE_SURFACE_PACKAGES.has(pkg));
  const dialog = native.find((pkg) => pkg.includes('systemui') || pkg.includes('permissioncontroller')) ?? native[0] ?? null;
  if (!dialog) return { type: 'wait', note: `no-native-consent-window (packages=${packagesIn(nodes).join(',') || 'none'})` };
  const inDialog = (node) => attrOf(node, 'package') === dialog;
  const labelOf = (node) => attrOf(node, 'text') || attrOf(node, 'content-desc');
  const inDialogLabels = nodes.filter((node) => inDialog(node) && labelOf(node));
  if (!state.entireScreenChosen) {
    const exact = inDialogLabels.find((node) => ENTIRE_SCREEN_LABELS.includes(labelOf(node)));
    const fuzzy = inDialogLabels.find((node) => {
      const label = labelOf(node);
      return ENTIRE_SCREEN_PATTERN.test(label) && !SINGLE_APP_PATTERN.test(label);
    });
    const entire = exact ?? fuzzy;
    if (entire) return { type: 'tap-entire', node: entire, kind: 'entire', note: 'prefer-entire-screen' };
    /* Recorded on API 35 (run 39192720751): the dialog shows the *current* mode
     * in a single clickable row ("A single app") and the whole-screen option is
     * only reachable by opening that selector. Tapping the row is what reveals
     * it; the positive button is only pressed once the mode is settled. */
    if (!state.modeSelectorTapped) {
      const modeRow = inDialogLabels.find((node) => SINGLE_APP_PATTERN.test(labelOf(node)) && node.includes('clickable="true"'))
        ?? inDialogLabels.find((node) => SINGLE_APP_PATTERN.test(labelOf(node)));
      if (modeRow) return { type: 'tap-mode-selector', node: modeRow, kind: 'mode', note: 'open-mode-selector' };
    }
  }
  const start = nodes.find((node) => inDialog(node)
    && (START_LABELS.includes(attrOf(node, 'text')) || attrOf(node, 'resource-id') === POSITIVE_BUTTON_ID));
  if (start) return { type: 'tap-start', node: start, kind: 'start', note: 'positive-button' };
  if (APP_PICKER_PACKAGES.has(dialog)) {
    const row = nodes.find((node) => inDialog(node) && attrOf(node, 'text') === 'KNOUX X' && node.includes('clickable="true"'))
      ?? nodes.find((node) => inDialog(node) && attrOf(node, 'text') === 'KNOUX X');
    if (row) return { type: 'tap-app-row', node: row, kind: 'app', note: 'single-app-picker-row' };
  }
  return { type: 'unrecognized', note: `unrecognized-native-dialog (${dialog})` };
}

function isSessionDeath(message) {
  return SESSION_DEATH.test(String(message ?? ''));
}

module.exports = {
  APP_PACKAGE,
  FIXTURE_NAME,
  NATIVE_SURFACE_PACKAGES,
  APP_PICKER_PACKAGES,
  ENTIRE_SCREEN_LABELS,
  START_LABELS,
  POSITIVE_BUTTON_ID,
  parseNodes,
  attrOf,
  nodeBoundsOf,
  matchesLabelsOf,
  packagesIn,
  coveringNativeSurface,
  isAppSurface,
  fixtureRowMatcher,
  folderTileMatcher,
  rootsDrawerMatcher,
  downloadsRowMatcher,
  chooserAction,
  downloadsRootAction,
  consentAction,
  isSessionDeath,
};