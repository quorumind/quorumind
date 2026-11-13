import { useLayoutEffect, useRef } from "react";

/** The motion tokens of tokens.css (--dur, --ease-out), so a reorder moves like every other transition. */
function motionTokens(element: HTMLElement): { duration: number; easing: string } {
  const style = getComputedStyle(element);
  const duration = Number.parseFloat(style.getPropertyValue("--dur"));
  return {
    duration: Number.isFinite(duration) ? duration : 280,
    easing: style.getPropertyValue("--ease-out").trim() || "cubic-bezier(0.16, 1, 0.3, 1)",
  };
}

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
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const next = new Map<string, number>();
    const motion = motionTokens(container);
    for (const element of container.querySelectorAll<HTMLElement>("[data-flip]")) {
      const key = element.dataset.flip as string;
      const top = element.getBoundingClientRect().top;
      next.set(key, top);
      const before = positions.current.get(key);
      if (before === undefined || reduce || before === top) continue;
      element.animate([{ transform: `translateY(${before - top}px)` }, { transform: "translateY(0)" }], motion);
    }
    positions.current = next;
  }, [order]);

  return ref;
}
