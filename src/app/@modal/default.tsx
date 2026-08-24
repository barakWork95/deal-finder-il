/**
 * Nothing, which is the normal state of the drawer slot.
 *
 * Required by the parallel route: without it a hard load of any page that is
 * not an intercepted /deal/[id] has no component to put in this slot and Next
 * renders a 404 for the whole route.
 */
export default function ModalDefault() {
  return null;
}
