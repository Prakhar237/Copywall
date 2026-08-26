import type { Transition } from "motion/react";

export const comicSpring: Transition = {
  type: "spring",
  stiffness: 340,
  damping: 22,
  mass: 0.75,
};

export const tapPress = {
  whileHover: { y: -3 },
  whileTap: { y: 3, x: 2, scale: 0.98 },
};
