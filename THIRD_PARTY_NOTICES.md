# Third-party notices

Spectant is licensed under the Apache License, Version 2.0 (see `LICENSE`). It ships, embeds or copies the
third-party material listed below, each under its own licence. Versions are the ones pinned in `package.json`,
`web/package.json` and `bun.lock`.

A `spectant` binary contains the Bun runtime and the production web build. The web build contains the compiled
runtime dependencies of `web/`, the generated stylesheet (Tailwind CSS and daisyUI), the inlined Lucide icons and the
three font files with their licence texts. `core/` and `server/` have no third-party runtime dependency; they use only
Bun and Node built-ins (`bun:sqlite`, `node:fs`, `node:path`, `node:os`, `node:crypto`).

The notice texts below are copied verbatim from the licence files of the installed packages.

## Angular

- **Packages:** `@angular/core`, `@angular/common`, `@angular/compiler`, `@angular/platform-browser`,
  `@angular/router`, `@angular/forms`
- **Version:** 22.2.0
- **Licence:** MIT
- **Upstream:** https://github.com/angular/angular
- **How it is bundled:** compiled into the JavaScript of the web build (only the code the app imports ends up in the
  bundle; `@angular/forms` is a declared dependency and not imported today).

```text
The MIT License

Copyright (c) 2010-2026 Google LLC. https://angular.dev/license

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

## Transloco

- **Package:** `@jsverse/transloco`
- **Version:** 8.4.0
- **Licence:** MIT
- **Upstream:** https://github.com/jsverse/transloco
- **How it is bundled:** compiled into the JavaScript of the web build (runtime i18n).

```text
MIT License

Copyright (c) 2019-2024 Netanel Basal, Shahar Kazaz, and Itay Oded.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### @jsverse/utils

- **Package:** `@jsverse/utils` (a dependency of Transloco)
- **Version:** 1.0.0-beta.5
- **Licence:** MIT, as declared in the package's `package.json`
- **Upstream:** https://github.com/jsverse/utils
- **How it is bundled:** compiled into the JavaScript of the web build, imported by Transloco.
- **Notice:** the published package carries no licence file, so no copyright line can be reproduced here; the MIT
  terms above apply.

`@jsverse/transloco-utils` 8.4.0 (MIT) is a declared dependency of Transloco for its configuration tooling; the
runtime bundle does not import it.

## RxJS

- **Package:** `rxjs`
- **Version:** 7.8.2
- **Licence:** Apache-2.0 (the same text as `LICENSE`); the package has no NOTICE file
- **Upstream:** https://github.com/ReactiveX/rxjs
- **How it is bundled:** compiled into the JavaScript of the web build.

```text
Copyright (c) 2015-2018 Google, Inc., Netflix, Inc., Microsoft Corp. and contributors

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

## tslib

- **Package:** `tslib`
- **Version:** 2.8.1
- **Licence:** 0BSD
- **Upstream:** https://github.com/microsoft/tslib
- **How it is bundled:** TypeScript helper functions compiled into the JavaScript of the web build.

```text
Copyright (c) Microsoft Corporation.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
```

## Tailwind CSS

- **Package:** `tailwindcss` (built through `@tailwindcss/postcss`, same version)
- **Version:** 4.3.3
- **Licence:** MIT
- **Upstream:** https://github.com/tailwindlabs/tailwindcss
- **How it is bundled:** the base styles and the utilities the app uses are generated into the stylesheet of the web
  build at build time; no Tailwind code runs in the app.

```text
MIT License

Copyright (c) Tailwind Labs, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## daisyUI

- **Package:** `daisyui`
- **Version:** 5.7.46
- **Licence:** MIT
- **Upstream:** https://github.com/saadeghi/daisyui
- **How it is bundled:** its component styles are generated into the stylesheet of the web build at build time, as a
  Tailwind CSS plugin.

```text
MIT License

Copyright (c) 2020 Pouya Saadeghi

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Lucide icons

- **Package:** `lucide-static`
- **Version:** 1.48.0
- **Licence:** ISC; the icons derived from the Feather project are also under MIT (both notices below)
- **Upstream:** https://github.com/lucide-icons/lucide
- **How it is bundled:** only the icons named in `web/src/app/shared/icons/icon-names.ts` are inlined. A build-time
  script reads their SVG files from the pinned package and writes the shape data into
  `web/src/app/shared/icons/icons.ts`, which is compiled into the web build. Of the inlined icons, `check`,
  `chevron-down`, `chevron-right`, `minimize-2`, `moon`, `search`, `target` and `x` are among those Lucide lists as
  derived from Feather.

```text
ISC License

Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

For the icons Lucide derives from Feather:

```text
The MIT License (MIT) (for the icons listed above)

Copyright (c) 2013-present Cole Bemis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Manrope

- **Font:** Manrope Variable, upright, weight axis 200 to 800, `latin` subset
- **Version:** 4.504 (googlefonts/manrope at commit `6f81ebecdf65e4463b798cc07b16a4f8d5216917`, the source Google
  Fonts builds from)
- **Licence:** SIL Open Font License, Version 1.1
- **Upstream:** https://github.com/googlefonts/manrope
- **How it is bundled:** the local file `web/public/fonts/manrope-variable.woff2`, served by the app from `/fonts/`
  inside the binary, never fetched from a font host. It is the `latin` subset of the variable face as Google Fonts
  serves it, downloaded once on 2026-09-29 and unchanged. The full licence text ships beside it as
  `web/public/fonts/LICENSE-Manrope.txt` and is copied into the web build with the font.
- **Reserved Font Name:** none is declared in the copyright statement.

```text
Copyright 2018 The Manrope Project Authors (https://github.com/sharanda/manrope)

This Font Software is licensed under the SIL Open Font License, Version 1.1.
```

## Sora

- **Font:** Sora Variable, upright, weight axis 100 to 800, `latin` subset
- **Version:** 2.000 (sora-xor/sora-font at commit `7f9a9c5d0ccd1c099cfac420aa27133df1c5fdc4`, the source Google
  Fonts builds from)
- **Licence:** SIL Open Font License, Version 1.1
- **Upstream:** https://github.com/sora-xor/sora-font
- **How it is bundled:** the local file `web/public/fonts/sora-variable.woff2`, served by the app from `/fonts/`
  inside the binary, never fetched from a font host. It is the `latin` subset of the variable face as Google Fonts
  serves it, downloaded once on 2026-09-29 and unchanged. The full licence text ships beside it as
  `web/public/fonts/LICENSE-Sora.txt` and is copied into the web build with the font.
- **Reserved Font Name:** none is declared in the copyright statement.

```text
Copyright 2019 The Sora Project Authors (https://github.com/sora-xor/sora-font)

This Font Software is licensed under the SIL Open Font License, Version 1.1.
```

## JetBrains Mono

- **Font:** JetBrains Mono Variable, upright
- **Version:** 2.304 (release v2.304, `fonts/variable/JetBrainsMono[wght].ttf`)
- **Licence:** SIL Open Font License, Version 1.1
- **Upstream:** https://github.com/JetBrains/JetBrainsMono
- **How it is bundled:** the local file `web/public/fonts/jetbrains-mono-variable.woff2`, served by the app from
  `/fonts/` inside the binary, never fetched from a font host. The release ships no variable woff2, so the TTF was
  encoded to woff2 with Google's reference encoder; the glyphs and names are unchanged. The full licence text ships
  beside it as `web/public/fonts/LICENSE-JetBrainsMono.txt` and is copied into the web build with the font.
- **Reserved Font Name:** none is declared in the copyright statement.

```text
Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono)

This Font Software is licensed under the SIL Open Font License, Version 1.1.
```

## Bun runtime

- **Tool:** Bun
- **Version:** 1.3.12 (`packageManager` in `package.json`)
- **Licence:** MIT for Bun's own code; the runtime includes third-party libraries under their own licences, among them
  JavaScriptCore from WebKit (LGPL-2) and SQLite (public domain)
- **Upstream:** https://github.com/oven-sh/bun, licensing overview at https://bun.com/docs/project/licensing
- **How it is bundled:** `bun build --compile` embeds the Bun runtime into every `spectant` binary.
- **Notice:** no Bun licence file is installed in this repository, so no copyright line is reproduced here; the
  upstream licensing page lists every library the runtime includes and where its source is available.

## Frozen fixture: leadgen

- **Path:** `core/fixtures/leadgen/`
- **Licence:** Apache-2.0
- **Upstream:** https://github.com/codeministry/leadgen
- **How it is included:** a frozen copy of that repository's spec files, used as a parser fixture by the tests; it is
  not part of the binary.
- **Notice:** `core/fixtures/leadgen/LICENSE-leadgen.txt` carries the upstream NOTICE attribution (Apache-2.0 § 4(d))
  and the licence text; it is not repeated here.

## The ISA format

The spec format Spectant reads (the master `ISA.md`, claims, the Test Strategy columns and the gates) originates from
the ISA format of the LifeOS project, **LifeOS (MIT)**: https://github.com/danielmiessler/LifeOS. Spectant adopts the
format and parses it with its own implementation in `core/`; no LifeOS code is copied into this repository. No
LifeOS licence file is present locally, so no copyright line is reproduced here; the MIT licence and its copyright
notice are in the upstream repository.

## Development dependencies

Used to build, lint and test Spectant; none of them is shipped in the binary or the web build.

| Package | Version | Licence |
|---------|---------|---------|
| `@angular/build`, `@angular/cli`, `@angular/compiler-cli` | 22.2.0 | MIT |
| `@tailwindcss/postcss` | 4.3.3 | MIT |
| `postcss` | 8.5.28 | MIT |
| `@playwright/test` (and `playwright`, `playwright-core`) | 1.63.0 | Apache-2.0 |
| `vitest` | 5.0.2 | MIT |
| `jsdom` | 30.1.1 | MIT |
| `typescript` | 6.0.3 | Apache-2.0 |
| `eslint`, `@eslint/js` | 9.39.5 | MIT |
| `typescript-eslint` | 8.70.1 | MIT |
| `angular-eslint` | 22.5.0 | MIT |
| `stylelint` | 17.15.0 | MIT |
| `stylelint-config-standard` | 40.0.0 | MIT |
| `bun-types` | 1.3.12 | MIT |

Their transitive dependencies are pinned in `bun.lock`.
