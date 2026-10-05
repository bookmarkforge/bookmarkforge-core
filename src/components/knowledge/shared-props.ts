import { type Variants } from "motion/react";
import type { TFunction } from "i18next";

export interface CardProps {
  cardVariants: Variants;
  t?: TFunction;
}
