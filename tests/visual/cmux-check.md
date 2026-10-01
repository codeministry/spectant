# Dashboard in the cmux web view (ISC-19, T83)

A manual probe: the principal runs it and confirms in their own words. cmux renders pages in the system WebKit, the
engine the WebKit smoke (ISC-19.1) approximates with Playwright's build; this check covers the real web view.

## Steps

1. Start the app: `spectant --no-browser` (or the host build, `./dist/spectant-darwin-<arch> --no-browser`) with at
   least one registered repository.
2. Open it in a cmux browser pane: `cmux new-pane --type browser --url http://127.0.0.1:7717`.
3. Check, in this order:
   - the overview `/` renders its workspace columns, no blank page and no unstyled flash;
   - clicking a workspace opens `/w/<ws>`: KPI band, Brief, Specs table and rail render;
   - Enter on a spec row opens the preview, Enter again the spec page; the area menu and a tab switch work;
   - back and forward keep the screen; a reload lands on the same screen;
   - ⌘K opens the palette, typing narrows it, Enter navigates;
   - the pane at its default side width (about 600 px) shows no horizontal scrollbar.
4. Record the WebKit version (system WebKit: `/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion'
   /System/Library/Frameworks/WebKit.framework/Resources/Info.plist`) and the cmux version.

## Evidence

A screenshot and the principal's confirmation go to `specs/001-app-skeleton/.evidence/` (gitignored). The
Verification stub names the WebKit and cmux versions and quotes the confirmation.
