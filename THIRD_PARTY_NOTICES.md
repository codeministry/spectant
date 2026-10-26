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

## Angular CDK

- **Package:** `@angular/cdk`
- **Version:** 22.2.0
- **Licence:** MIT
- **Upstream:** https://github.com/angular/components
- **How it is bundled:** compiled into the JavaScript of the web build; only the `@angular/cdk/drag-drop` entry is
  imported (the workspace board's drag and drop) and the CDK code it pulls in itself. `@angular/cdk/scrolling` is
  allowed as well and not imported today.

```text
The MIT License

Copyright (c) 2026 Google LLC.

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

## Mermaid

- **Package:** `mermaid`
- **Version:** 12.2.0
- **Licence:** MIT
- **Upstream:** https://github.com/mermaid-js/mermaid
- **How it is bundled:** compiled into lazy JavaScript chunks of the web build, loaded only when a Docs tab shows a
  diagram; it is never part of the initial bundle. Its own runtime dependencies (among them d3, dagre-d3-es,
  cytoscape, katex and DOMPurify) are compiled into those chunks under their own licences; ELK (`elkjs`, below) is
  one of them.

```text
The MIT License (MIT)

Copyright (c) 2014 - 2022 Knut Sveidqvist

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

## ELK (elkjs)

- **Package:** `elkjs`
- **Version:** 0.9.3
- **Licence:** EPL-2.0
- **Upstream:** https://github.com/kieler/elkjs (source code of the shipped version: the `0.9.3` tag there, or the
  `elkjs@0.9.3` package on the npm registry)
- **How it is bundled:** a runtime dependency of Mermaid 12, unmodified, compiled into one lazy chunk of the web
  build. Spectant lays its diagrams out with ELK, so Mermaid loads that chunk whenever a page draws a diagram, never
  in the initial bundle.

```text
# Eclipse Public License - v 2.0

THE ACCOMPANYING PROGRAM IS PROVIDED UNDER THE TERMS OF THIS ECLIPSE
PUBLIC LICENSE (“AGREEMENT”). ANY USE, REPRODUCTION OR DISTRIBUTION OF
THE PROGRAM CONSTITUTES RECIPIENT'S ACCEPTANCE OF THIS AGREEMENT.

## 1. DEFINITIONS

“Contribution” means:

-   a\) in the case of the initial Contributor, the initial content
    Distributed under this Agreement, and
-   b\) in the case of each subsequent Contributor:
    -   i\) changes to the Program, and
    -   ii\) additions to the Program;

    where such changes and/or additions to the Program originate from
    and are Distributed by that particular Contributor. A Contribution
    “originates” from a Contributor if it was added to the Program by
    such Contributor itself or anyone acting on such Contributor's
    behalf. Contributions do not include changes or additions to the
    Program that are not Modified Works.

“Contributor” means any person or entity that Distributes the Program.

“Licensed Patents” mean patent claims licensable by a Contributor which
are necessarily infringed by the use or sale of its Contribution alone
or when combined with the Program.

“Program” means the Contributions Distributed in accordance with this
Agreement.

“Recipient” means anyone who receives the Program under this Agreement
or any Secondary License (as applicable), including Contributors.

“Derivative Works” shall mean any work, whether in Source Code or other
form, that is based on (or derived from) the Program and for which the
editorial revisions, annotations, elaborations, or other modifications
represent, as a whole, an original work of authorship.

“Modified Works” shall mean any work in Source Code or other form that
results from an addition to, deletion from, or modification of the
contents of the Program, including, for purposes of clarity any new file
in Source Code form that contains any contents of the Program. Modified
Works shall not include works that contain only declarations,
interfaces, types, classes, structures, or files of the Program solely
in each case in order to link to, bind by name, or subclass the Program
or Modified Works thereof.

“Distribute” means the acts of a) distributing or b) making available in
any manner that enables the transfer of a copy.

“Source Code” means the form of a Program preferred for making
modifications, including but not limited to software source code,
documentation source, and configuration files.

“Secondary License” means either the GNU General Public License, Version
2.0, or any later versions of that license, including any exceptions or
additional permissions as identified by the initial Contributor.

## 2. GRANT OF RIGHTS

-   a\) Subject to the terms of this Agreement, each Contributor hereby
    grants Recipient a non-exclusive, worldwide, royalty-free copyright
    license to reproduce, prepare Derivative Works of, publicly display,
    publicly perform, Distribute and sublicense the Contribution of such
    Contributor, if any, and such Derivative Works.
-   b\) Subject to the terms of this Agreement, each Contributor hereby
    grants Recipient a non-exclusive, worldwide, royalty-free patent license
    under Licensed Patents to make, use, sell, offer to sell, import and
    otherwise transfer the Contribution of such Contributor, if any, in
    Source Code or other form. This patent license shall apply to the
    combination of the Contribution and the Program if, at the time the
    Contribution is added by the Contributor, such addition of the
    Contribution causes such combination to be covered by the
    Licensed Patents. The patent license shall not apply to any other
    combinations which include the Contribution. No hardware per se is
    licensed hereunder.
-   c\) Recipient understands that although each Contributor grants the
    licenses to its Contributions set forth herein, no assurances are
    provided by any Contributor that the Program does not infringe the
    patent or other intellectual property rights of any other entity. Each
    Contributor disclaims any liability to Recipient for claims brought by
    any other entity based on infringement of intellectual property rights
    or otherwise. As a condition to exercising the rights and licenses
    granted hereunder, each Recipient hereby assumes sole responsibility to
    secure any other intellectual property rights needed, if any. For
    example, if a third party patent license is required to allow Recipient
    to Distribute the Program, it is Recipient's responsibility to acquire
    that license before distributing the Program.
-   d\) Each Contributor represents that to its knowledge it has sufficient
    copyright rights in its Contribution, if any, to grant the copyright
    license set forth in this Agreement.
-   e\) Notwithstanding the terms of any Secondary License, no Contributor
    makes additional grants to any Recipient (other than those set forth in
    this Agreement) as a result of such Recipient's receipt of the Program
    under the terms of a Secondary License (if permitted under the terms of
    Section 3).

## 3. REQUIREMENTS

3.1 If a Contributor Distributes the Program in any form, then:

-   a\) the Program must also be made available as Source Code, in accordance
    with section 3.2, and the Contributor must accompany the Program with a
    statement that the Source Code for the Program is available under this
    Agreement, and informs Recipients how to obtain it in a reasonable
    manner on or through a medium customarily used for software exchange;
    and
-   b\) the Contributor may Distribute the Program under a license different
    than this Agreement, provided that such license:
    -   i\) effectively disclaims on behalf of all other Contributors all
        warranties and conditions, express and implied, including warranties or
        conditions of title and non-infringement, and implied warranties or
        conditions of merchantability and fitness for a particular purpose;
    -   ii\) effectively excludes on behalf of all other Contributors all
        liability for damages, including direct, indirect, special, incidental
        and consequential damages, such as lost profits;
    -   iii\) does not attempt to limit or alter the recipients' rights in the
        Source Code under section 3.2; and
    -   iv\) requires any subsequent distribution of the Program by any party to
        be under a license that satisfies the requirements of this section 3.

3.2 When the Program is Distributed as Source Code:

-   a\) it must be made available under this Agreement, or if the Program (i)
    is combined with other material in a separate file or files made
    available under a Secondary License, and (ii) the initial Contributor
    attached to the Source Code the notice described in Exhibit A of this
    Agreement, then the Program may be made available under the terms of
    such Secondary Licenses, and
-   b\) a copy of this Agreement must be included with each copy of
    the Program.

3.3 Contributors may not remove or alter any copyright, patent,
trademark, attribution notices, disclaimers of warranty, or limitations
of liability (‘notices’) contained within the Program from any copy of
the Program which they Distribute, provided that Contributors may add
their own appropriate notices.

## 4. COMMERCIAL DISTRIBUTION

Commercial distributors of software may accept certain responsibilities
with respect to end users, business partners and the like. While this
license is intended to facilitate the commercial use of the Program, the
Contributor who includes the Program in a commercial product offering
should do so in a manner which does not create potential liability for
other Contributors. Therefore, if a Contributor includes the Program in
a commercial product offering, such Contributor (“Commercial
Contributor”) hereby agrees to defend and indemnify every other
Contributor (“Indemnified Contributor”) against any losses, damages and
costs (collectively “Losses”) arising from claims, lawsuits and other
legal actions brought by a third party against the Indemnified
Contributor to the extent caused by the acts or omissions of such
Commercial Contributor in connection with its distribution of the
Program in a commercial product offering. The obligations in this
section do not apply to any claims or Losses relating to any actual or
alleged intellectual property infringement. In order to qualify, an
Indemnified Contributor must: a) promptly notify the Commercial
Contributor in writing of such claim, and b) allow the Commercial
Contributor to control, and cooperate with the Commercial Contributor
in, the defense and any related settlement negotiations. The Indemnified
Contributor may participate in any such claim at its own expense.

For example, a Contributor might include the Program in a commercial
product offering, Product X. That Contributor is then a Commercial
Contributor. If that Commercial Contributor then makes performance
claims, or offers warranties related to Product X, those performance
claims and warranties are such Commercial Contributor's responsibility
alone. Under this section, the Commercial Contributor would have to
defend claims against the other Contributors related to those
performance claims and warranties, and if a court requires any other
Contributor to pay any damages as a result, the Commercial Contributor
must pay those damages.

## 5. NO WARRANTY {#warranty}

EXCEPT AS EXPRESSLY SET FORTH IN THIS AGREEMENT, AND TO THE EXTENT
PERMITTED BY APPLICABLE LAW, THE PROGRAM IS PROVIDED ON AN “AS IS”
BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, EITHER EXPRESS OR
IMPLIED INCLUDING, WITHOUT LIMITATION, ANY WARRANTIES OR CONDITIONS OF
TITLE, NON-INFRINGEMENT, MERCHANTABILITY OR FITNESS FOR A PARTICULAR
PURPOSE. Each Recipient is solely responsible for determining the
appropriateness of using and distributing the Program and assumes all
risks associated with its exercise of rights under this Agreement,
including but not limited to the risks and costs of program errors,
compliance with applicable laws, damage to or loss of data, programs or
equipment, and unavailability or interruption of operations.

## 6. DISCLAIMER OF LIABILITY {#disclaimer}

EXCEPT AS EXPRESSLY SET FORTH IN THIS AGREEMENT, AND TO THE EXTENT
PERMITTED BY APPLICABLE LAW, NEITHER RECIPIENT NOR ANY CONTRIBUTORS
SHALL HAVE ANY LIABILITY FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING WITHOUT LIMITATION LOST
PROFITS), HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
ARISING IN ANY WAY OUT OF THE USE OR DISTRIBUTION OF THE PROGRAM OR THE
EXERCISE OF ANY RIGHTS GRANTED HEREUNDER, EVEN IF ADVISED OF THE
POSSIBILITY OF SUCH DAMAGES.

## 7. GENERAL

If any provision of this Agreement is invalid or unenforceable under
applicable law, it shall not affect the validity or enforceability of
the remainder of the terms of this Agreement, and without further action
by the parties hereto, such provision shall be reformed to the minimum
extent necessary to make such provision valid and enforceable.

If Recipient institutes patent litigation against any entity (including
a cross-claim or counterclaim in a lawsuit) alleging that the Program
itself (excluding combinations of the Program with other software or
hardware) infringes such Recipient's patent(s), then such Recipient's
rights granted under Section 2(b) shall terminate as of the date such
litigation is filed.

All Recipient's rights under this Agreement shall terminate if it fails
to comply with any of the material terms or conditions of this Agreement
and does not cure such failure in a reasonable period of time after
becoming aware of such noncompliance. If all Recipient's rights under
this Agreement terminate, Recipient agrees to cease use and distribution
of the Program as soon as reasonably practicable. However, Recipient's
obligations under this Agreement and any licenses granted by Recipient
relating to the Program shall continue and survive.

Everyone is permitted to copy and distribute copies of this Agreement,
but in order to avoid inconsistency the Agreement is copyrighted and may
only be modified in the following manner. The Agreement Steward reserves
the right to publish new versions (including revisions) of this
Agreement from time to time. No one other than the Agreement Steward has
the right to modify this Agreement. The Eclipse Foundation is the
initial Agreement Steward. The Eclipse Foundation may assign the
responsibility to serve as the Agreement Steward to a suitable separate
entity. Each new version of the Agreement will be given a distinguishing
version number. The Program (including Contributions) may always be
Distributed subject to the version of the Agreement under which it was
received. In addition, after a new version of the Agreement is
published, Contributor may elect to Distribute the Program (including
its Contributions) under the new version.

Except as expressly stated in Sections 2(a) and 2(b) above, Recipient
receives no rights or licenses to the intellectual property of any
Contributor under this Agreement, whether expressly, by implication,
estoppel or otherwise. All rights in the Program not expressly granted
under this Agreement are reserved. Nothing in this Agreement is intended
to be enforceable by any entity that is not a Contributor or Recipient.
No third-party beneficiary rights are created under this Agreement.

## Exhibit A – Form of Secondary Licenses Notice {#exhibit-a}

“This Source Code may also be made available under the following
Secondary Licenses when the conditions for such availability set forth
in the Eclipse Public License, v. 2.0 are satisfied: {name license(s),
version(s), and exceptions or additional permissions here}.”

> Simply including a copy of this Agreement, including this Exhibit A is
> not sufficient to license the Source Code under Secondary Licenses.
>
> If it is not possible or desirable to put the notice in a particular
> file, then You may include the notice in a location (such as a LICENSE
> file in a relevant directory) where a recipient would be likely to
> look for such a notice.
>
> You may add additional accurate notices of copyright ownership.
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
- **Version:** 1.61.0
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
- **Version:** 1.4.4 (`packageManager` in `package.json`)
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
| `bun-types` | 1.4.4 | MIT |
| `jscpd` (and its platform binary package `jscpd-<os>-<cpu>`) | 5.4.0 | MIT |

Their transitive dependencies are pinned in `bun.lock`.
