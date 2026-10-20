const { parseNodes, webViewBounds } = require('../../tools/android-native-core.cjs');
test('maps only a measured positive rectangle belonging to this app', () => {
  const nodes = parseNodes('<node class="android.webkit.WebView" package="dev.knoux.playerx" bounds="[0,136][1080,2337]" />');
  expect(webViewBounds(nodes)).toEqual({ left: 0, top: 136, right: 1080, bottom: 2337 });
});
test.each([
  '',
  '<node class="android.webkit.WebView" package="com.google.android.documentsui" bounds="[0,0][1080,2400]" />',
  '<node class="android.webkit.WebView" package="dev.knoux.playerx" bounds="[0,0][0,0]" />',
  '<node class="android.view.View" package="dev.knoux.playerx" bounds="[0,0][1080,2400]" />',
])('refuses missing, foreign or unmeasured WebView geometry: %s', (xml) => {
  expect(webViewBounds(parseNodes(xml))).toBeNull();
});
