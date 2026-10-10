import React from "react";
import { MotionConfig } from "motion/react";
import { useReducedMotion } from "../hooks/useReducedMotion";

function MotionInner({ children }: { children: React.ReactNode }) {
  const reducedMotion = useReducedMotion();
  const reduceSetting = reducedMotion ? ("user" as const) : ("never" as const);
  return <MotionConfig reducedMotion={reduceSetting}>{children}</MotionConfig>;
}

export default function MotionThemeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return <MotionInner>{children}</MotionInner>;
}
