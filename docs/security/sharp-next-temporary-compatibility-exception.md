# Sharp/Next temporary compatibility exception

Owner: TECM Admin Web maintainers  
Review no later than: 2026-08-22

## Decision

Admin Web pins Node to `22.x` and overrides Next's optional Sharp dependency to exactly `0.35.3`. This is an intentional, temporary compatibility exception; it is not a claim that Next 15 officially supports Sharp 0.35 through its declared semver range.

The security advisory [GHSA-f88m-g3jw-g9cj](https://github.com/advisories/GHSA-f88m-g3jw-g9cj) affects `sharp <0.35.0`. Next 15.5.x currently declares optional Sharp `^0.34.3`, so following the upstream range resolves to an affected release. Sharp 0.35.3 is used to keep the HIGH-severity audit gate clear while Next's declaration has not yet caught up.

## Compensating controls and evidence

- Admin Web does not currently accept image uploads, use `next/image`, call the Next image optimizer, or decode user-controlled images.
- Next image optimization is disabled globally with `images.unoptimized: true`.
- CI scans application source for `next/image`, direct optimizer use, application Sharp imports, and image-upload/decoding endpoints. Generated output, dependencies, and documentation are outside the scan.
- CI runs `npm ls next sharp` to reject an invalid, extraneous, or duplicated Sharp tree. A bounded Node 22 smoke test verifies the exact installed Sharp version, loads Sharp, and processes only a program-generated trusted 2x2 image through metadata, resize, PNG, and WebP operations without writing artifacts.
- CI runs `npm audit --audit-level=high`, the smoke test, production build, unit tests, type checking, and the image-processing guard.

Production must not add image uploads, `next/image`, remote image optimization, or other untrusted image-decoding paths without re-reviewing this exception and its threat model.

## Removal condition

When a supported Next 15 release formally declares compatibility with Sharp 0.35 or newer, remove the Sharp override, regenerate `package-lock.json` with npm, and repeat the full dependency, audit, runtime, build, and image-processing verification.
