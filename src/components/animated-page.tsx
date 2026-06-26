import type { PropsWithChildren } from "react";
import { motion } from "motion/react";
import { pageTransition, pageVariants } from "@/lib/motion";

export function AnimatedPage({ children }: PropsWithChildren) {
  return (
    <motion.div
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={pageTransition}
      className="min-h-0"
    >
      {children}
    </motion.div>
  );
}
