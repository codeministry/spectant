// Global setup for the Vitest component specs (`angular.json` › test › setupFiles).
//
// jsdom has no Popover API, so the specs stub `showPopover` / `hidePopover`, and `:popover-open` never matches.
// Since jsdom 30.1.3 its default stylesheet's `[popover]:not(:popover-open):not(dialog[open]) { display: none }`
// applies, which makes every element inside a stubbed popover unfocusable: `focus()` becomes a no-op and focus stays
// on `<body>`. jsdom orders that rule against author rules by specificity alone, so this override repeats its exact
// selector and wins by coming later; popover content stays focusable, as it was before. Whether a popover really
// shows or hides is measured on real Chromium and WebKit by the browser tier, never here.
const style = document.createElement('style');
style.dataset['testSetup'] = 'popover';
style.textContent = '[popover]:not(:popover-open):not(dialog[open]) { display: block; }';
document.head.appendChild(style);
