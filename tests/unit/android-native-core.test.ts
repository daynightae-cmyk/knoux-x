/**
 * Regression contracts for the native Android surfaces the installed-APK
 * acceptance harness has to drive (DocumentsUI chooser + MediaProjection consent).
 *
 * Fixtures are real runner XML, recorded from CI:
 *  - run 39187255689 `mp4-actual-player-first-frame-seek-audio-native-ui.xml`:
 *    the chooser sat in the media "Videos" root with a "Download" folder tile,
 *    while `currentFocus()` reported null and `focusAtFailure` was empty.
 *  - run 39188659686: the same chooser walk then selected KNOUX-QA.mp4, after
 *    which the app process died and the WebView session closed mid-case.
 *
 * The harness gates taps on foreground identity derived from these hierarchies,
 * so the decisions are asserted here instead of only on a device.
 */

// The decision core ships as CommonJS because the CI harness runs it through
// plain `node`; import it directly (esModuleInterop handles the interop).
// eslint-disable-next-line @typescript-eslint/no-var-requires
import * as core from '../../tools/android-native-core.cjs';

const DOCUMENTSUI = 'com.google.android.documentsui';
const SYSTEMUI = 'com.android.systemui';
const APP = core.APP_PACKAGE;

const hierarchy = (nodes: string[]): string => `<?xml version='1.0' encoding='UTF-8'?>
<hierarchy rotation="0">
${nodes.map((node) => `  ${node}`).join('\n')}
</hierarchy>`;

interface NodeSpec {
  text?: string;
  resourceId?: string;
  contentDesc?: string;
  className?: string;
  package?: string;
  clickable?: boolean;
  bounds?: string;
}

/* Builds one accessibility node in the exact attribute shape uiautomator emits.
 * Attributes are written once each: a duplicated text/resource-id attribute would
 * silently change what attrOf() resolves to. */
const node = (spec: NodeSpec): string => [
  '<node index="0"',
  `text="${spec.text ?? ''}"`,
  `resource-id="${spec.resourceId ?? ''}"`,
  `class="${spec.className ?? 'android.widget.TextView'}"`,
  `package="${spec.package ?? ''}"`,
  `content-desc="${spec.contentDesc ?? ''}"`,
  'checkable="false"',
  'checked="false"',
  `clickable="${spec.clickable ?? false}"`,
  'enabled="true"',
  'focusable="false"',
  'focused="false"',
  'scrollable="false"',
  'long-clickable="false"',
  'password="false"',
  'selected="false"',
  `bounds="${spec.bounds ?? '[0,0][0,0]'}"`,
  '/>',
].join(' ');

const videoRootChooser = hierarchy([
  node({ package: DOCUMENTSUI, text: 'Videos', bounds: '[55,262][145,292]' }),
  node({ package: DOCUMENTSUI, text: 'Large files', bounds: '[55,340][305,385]' }),
  // The recorded runner XML: the media root exposes a "Download" FOLDER tile,
  // which is not the "Downloads" roots-drawer row.
  node({ package: DOCUMENTSUI, text: 'Download', resourceId: 'android:id/title', bounds: '[188,721][352,772]' }),
  node({ package: DOCUMENTSUI, contentDesc: 'Show roots', className: 'android.widget.ImageButton', bounds: '[44,173][104,233]' }),
]);

const downloadFolderListing = hierarchy([
  node({ package: DOCUMENTSUI, text: 'Download', bounds: '[55,262][145,292]' }),
  node({ package: DOCUMENTSUI, text: 'KNOUX-QA.mp4', resourceId: 'android:id/title', bounds: '[40,180][1040,260]' }),
]);

const rootsDrawer = hierarchy([
  node({ package: APP, text: 'Record Native screen capture', resourceId: 'record-card' }),
  node({ package: DOCUMENTSUI, contentDesc: 'Show roots', className: 'android.widget.ImageButton', bounds: '[44,173][104,233]' }),
  node({ package: DOCUMENTSUI, text: 'Recent', bounds: '[40,300][720,380]' }),
  node({ package: DOCUMENTSUI, text: 'Downloads', bounds: '[40,660][720,740]' }),
]);

const consentDialog = hierarchy([
  node({ package: SYSTEMUI, text: 'Start recording or casting?', resourceId: 'android:id/alertTitle' }),
  node({ package: SYSTEMUI, text: 'A single app', bounds: '[40,900][500,1000]' }),
  node({ package: SYSTEMUI, text: 'Entire screen', bounds: '[540,900][1040,1000]' }),
  // The dialog title mentions KNOUX X; a substring match would tap the title.
  node({ package: SYSTEMUI, text: 'KNOUX X will be able to record this screen', resourceId: 'android:id/message', bounds: '[40,1050][1040,1300]' }),
  node({ package: SYSTEMUI, text: 'Start now', resourceId: 'android:id/button1', bounds: '[640,1650][1040,1740]' }),
]);

const singleAppPicker = hierarchy([
  node({ package: SYSTEMUI, text: 'Select app', bounds: '[40,200][1040,260]' }),
  node({ package: SYSTEMUI, text: 'KNOUX X', resourceId: 'android:id/title', className: 'android.widget.TextView', bounds: '[80,400][600,480]' }),
  node({ package: SYSTEMUI, resourceId: 'android:id/icon', bounds: '[20,400][70,480]', clickable: true }),
  node({ package: SYSTEMUI, text: 'Start sharing', resourceId: 'android:id/button1', bounds: '[640,1650][1040,1740]' }),
]);

const homeBehindDocumentsUi = hierarchy([
  node({ package: APP, text: 'Record Native screen capture', resourceId: 'record-card', bounds: '[40,400][1040,700]' }),
  node({ package: APP, text: 'KNOUX X', bounds: '[328,214][585,272]' }),
  node({ package: DOCUMENTSUI, text: 'Videos', bounds: '[55,262][145,292]' }),
  node({ package: DOCUMENTSUI, text: 'Download', resourceId: 'android:id/title', bounds: '[188,721][352,772]' }),
]);

describe('native Android surface decisions', () => {
  test('foreground identity ignores a mounted-but-background app WebView', () => {
    const nodes = core.parseNodes(homeBehindDocumentsUi);
    expect(core.packagesIn(nodes)).toEqual(expect.arrayContaining([APP, DOCUMENTSUI]));
    expect(core.coveringNativeSurface(nodes)).toBe(DOCUMENTSUI);
    expect(core.isAppSurface(nodes)).toBe(false);
  });

  test('an app-only hierarchy is the one case that reads as foreground', () => {
    const nodes = core.parseNodes(hierarchy([node({ package: APP, text: 'KNOUX X', bounds: '[328,214][585,272]' })]));
    expect(core.coveringNativeSurface(nodes)).toBeNull();
    expect(core.isAppSurface(nodes)).toBe(true);
  });

  test('chooses the folder tile in the media Videos root, never a substring root', () => {
    const action = core.chooserAction(core.parseNodes(videoRootChooser));
    expect(action.type).toBe('folder-tile');
    expect(action.note).toBe('media-download-folder-tile');
    // "Download" (folder tile) must not satisfy the roots-drawer Downloads row.
    expect(core.downloadsRootAction(core.parseNodes(videoRootChooser)).type).toBe('wait');
  });

  test('picks the fixture row once it is listed', () => {
    const action = core.chooserAction(core.parseNodes(downloadFolderListing));
    expect(action.type).toBe('file-row');
    expect(core.fixtureRowMatcher()(action.node)).toBe(true);
    expect(core.folderTileMatcher()(action.node)).toBe(false);
  });

  test('falls back to the roots drawer and its exact Downloads row', () => {
    const closed = core.chooserAction(core.parseNodes(hierarchy([
      node({ package: DOCUMENTSUI, text: 'Recent', bounds: '[40,300][720,380]' }),
      node({ package: DOCUMENTSUI, contentDesc: 'Show roots', bounds: '[44,173][104,233]' }),
    ])));
    expect(closed.type).toBe('roots-drawer');
    const open = core.downloadsRootAction(core.parseNodes(rootsDrawer));
    expect(open.type).toBe('downloads-root');
    expect(core.downloadsRowMatcher()(open.node)).toBe(true);
  });

  test('consent prefers Entire screen, then the positive button', () => {
    const nodes = core.parseNodes(consentDialog);
    expect(core.consentAction(nodes).type).toBe('tap-entire');
    expect(core.consentAction(nodes, { entireScreenChosen: true }).type).toBe('tap-start');
  });

  test('consent never taps the KNOUX X string from a dialog title', () => {
    const action = core.consentAction(core.parseNodes(consentDialog), { entireScreenChosen: true });
    expect(action.type).toBe('tap-start');
    const withoutPositiveButton = core.parseNodes(hierarchy([
      node({ package: SYSTEMUI, text: 'KNOUX X will be able to record this screen', resourceId: 'android:id/message', bounds: '[40,1050][1040,1300]' }),
    ]));
    expect(core.consentAction(withoutPositiveButton, { entireScreenChosen: true }).type).toBe('unrecognized');
  });

  test('consent recognises the API 35 single-app picker row', () => {
    // With a positive button present the confirmation wins first; the app row
    // is only ever tapped when the dialog offers no button to press.
    expect(core.consentAction(core.parseNodes(singleAppPicker), { entireScreenChosen: true }).type).toBe('tap-start');
    const rowOnly = core.parseNodes(hierarchy([
      node({ package: SYSTEMUI, text: 'KNOUX X', resourceId: 'android:id/title', bounds: '[80,400][600,480]' }),
    ]));
    const action = core.consentAction(rowOnly, { entireScreenChosen: true });
    expect(action.type).toBe('tap-app-row');
    expect(action.note).toBe('single-app-picker-row');
  });

  test('consent is decided from the hierarchy alone, never from window focus', () => {
    // deviceState.focus and focusAtFailure were null on the observed runner
    // while a real consent dialog was on screen: the decision must not depend
    // on any dumpsys answer.
    expect(core.consentAction(core.parseNodes(consentDialog)).type).toBe('tap-entire');
    const appOnly = core.parseNodes(hierarchy([node({ package: APP, text: 'Start screen recording' })]));
    expect(core.consentAction(appOnly).note).toMatch(/^no-native-consent-window/);
  });

  test('session-death signatures cover the real renderer failures', () => {
    expect(core.isSessionDeath('locator.count: Target page, context or browser has been closed')).toBe(true);
    expect(core.isSessionDeath('locator.evaluate: Timeout 30000ms exceeded.')).toBe(true);
    expect(core.isSessionDeath('Trusted tap target unavailable: not attached (locator.evaluate: Timeout 30000ms exceeded.)')).toBe(true);
    expect(core.isSessionDeath('Trusted tap target unavailable: com.google.android.documentsui covers the app (uiautomator)')).toBe(false);
    expect(core.isSessionDeath('No decoded video frames')).toBe(false);
  });

  test('bounds survive the hierarchy format recorded by the runner', () => {
    const recorded = '<node index="1" text="Download" resource-id="android:id/title" class="android.widget.TextView" package="com.google.android.documentsui" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" bounds="[188,721][352,772]" />';
    expect(core.nodeBoundsOf(recorded)).toEqual({ left: 188, top: 721, right: 352, bottom: 772 });
    expect(core.attrOf(recorded, 'resource-id')).toBe('android:id/title');
  });
});