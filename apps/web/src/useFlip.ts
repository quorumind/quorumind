import { useLayoutEffect, useRef } from "react";

/**
 * Animates children of a container to their new place when their order changes (FLIP).
 * Each child needs a stable `data-flip` key. Respects reduced motion.
 */
export function useFlip<T extends HTMLElement>(order: string) {
  const ref = useRef<T>(null);
  const positions = useRef(new Map<string, number>());

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the order changes.
  useLayoutEffect(() => {
    const container = ref.current;
    if (!container) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const next = new Map<string, number>();
    for (const element of container.querySelectorAll<HTMLElement>("[data-flip]")) {
      const key = element.dataset.flip as string;
      const top = element.getBoundingClientRect().top;
      next.set(key, top);
      const before = positions.current.get(key);
      if (before === undefined || reduce || before === top) continue;
      element.animate([{ transform: `translateY(${before - top}px)` }, { transform: "translateY(0)" }], {
        duration: 420,
        easing: "cubic-bezier(.2,.8,.2,1)",
      });
    }
    positions.current = next;
  }, [order]);

  return ref;
}
