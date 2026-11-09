# fzstd 0.1.1

Vendored browser ESM decoder from the unmodified `package/esm/index.mjs` in the official npm `fzstd@0.1.1` release. MIT license is preserved in `fzstd-0.1.1-LICENSE`.

- Source: https://github.com/101arrowz/fzstd
- Package: https://registry.npmjs.org/fzstd/-/fzstd-0.1.1.tgz
- Verified tarball integrity: `sha512-dkuVSOKKwh3eas5VkJy1AW1vFpet8TA/fGmVA5krThl8YcOVE/8ZIoEA1+U1vEn5ckxxhLirSdY837azmbaNHA==`

The site serves the decoder itself; it does not use a third-party CDN at runtime. `scripts/build-character-zstd.mjs` compresses with Node.js 24's native Zstandard implementation and independently decodes every generated chapter using this same browser decoder, comparing the original complete byte SHA256 before publishing. All network and cached transports remain SHA-bound to the original chapter JSON.
