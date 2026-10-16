export { useReducedMotion } from "motion/react";

/**
 * getMotionProps - Returns motion props that respect reduced motion preference
 *
 * Usage:
 * <m.div {...getMotionProps(reducedMotion, { initial: { opacity: 0 }, animate: { opacity: 1 } })} />
 */
export function getMotionProps(
  reducedMotion: boolean,
  motionProps: Record<string, unknown>,
): Record<string, unknown> {
  if (reducedMotion) {
    return {
      initial: false,
      animate: false,
      exit: false,
      transition: { duration: 0 },
    };
  }
  return motionProps;
}
