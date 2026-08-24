/**
 * Closes the drawer on a client-side navigation to anything else.
 *
 * `default.tsx` is not enough on its own: a slot that stops matching stays on
 * screen, so opening a tender and then clicking through to /alerts would carry
 * the drawer along with it. Matching every other path to a page that renders
 * nothing is what actually dismisses it — see the note under "Modals" in
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/parallel-routes.md.
 */
export default function ModalCatchAll() {
  return null;
}
