export const pageTransition = {
  duration: 0.18,
  ease: [0.22, 1, 0.36, 1],
} as const;

export const pageVariants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
} as const;

export const listContainer = {
  animate: {
    transition: {
      staggerChildren: 0.035,
    },
  },
} as const;

export const listItem = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
} as const;
