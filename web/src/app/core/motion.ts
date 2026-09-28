/**
 * True while the user asks for reduced motion (ISC-66). The router's view-transition hook (T59) calls
 * `transition.skipTransition()` when this holds; the CSS side of the same switch lives in `src/styles/motion.css`.
 */
export const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
