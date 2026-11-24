# Third-party notices

## OneBot action catalog

`src/channels/onebot-catalog.json`, `onebot-catalog-napcat.json`, and `onebot-catalog-onebot11.json` are derived from catalogs shipped with
`cortico-world-onebot` (MIT License). It is used as local action metadata; the
extension is not a runtime dependency.

## References

The integration design also references the MIT-licensed
`cortico-world-bili-video-pro` for Bilibili edge cases and public API behavior.
No third-party extension code is loaded at runtime by this package.

## Runtime dependencies

- `qrcode` — MIT License. Generates Bilibili login QR codes locally.
- `ws` — MIT License. WebSocket client used by the native OneBot channel.
- `puppeteer-core` — Apache License 2.0. Controls the local browser for Bilibili watch-together; it does not download a browser.
- `@ffmpeg-installer/ffmpeg` — installer is MIT-licensed; the bundled FFmpeg binary is subject to FFmpeg's LGPL/GPL licensing terms (see the package and FFmpeg distribution for details). Used for montage/sprite/frame extraction.

## Bundled catalog metadata

The OneBot action catalogs are data-only metadata and are not loaded as executable third-party code.
