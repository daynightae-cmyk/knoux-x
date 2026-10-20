# Third-Party Notices

KNOUX X includes the following third-party components. Their licenses apply to
those components, not to the rest of the application.

## @breezystack/lamejs 1.2.7

- Purpose: on-device MP3 encoding for the Audio Lab (video/audio to MP3, merge,
  batch conversion and trimmed exports).
- License: GNU Lesser General Public License v3.0 (LGPL-3.0).
- Copyright: Alex Zhukov and lamejs contributors; derived from the LAME project.
- Source: https://github.com/shijinyu/lamejs
- Upstream: https://lame.sourceforge.io/

The library is imported as a separate ES module and emitted by the bundler as
its own lazily loaded chunk (`lamejs-*.js`), so it can be replaced with a
compatible build of the same library without modifying KNOUX X.

A copy of the LGPL-3.0 license text is distributed with the package at
`node_modules/@breezystack/lamejs/LICENSE` and is available from
https://www.gnu.org/licenses/lgpl-3.0.html. Written offers for corresponding
source are available on request through the project repository:
https://github.com/daynightae-cmyk/knoux-x
