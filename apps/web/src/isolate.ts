/**
 * A name set inside a sentence (a workspace, an author, a scenario) wrapped in Unicode isolates, as <bdi> does: in a
 * right-to-left sentence a Latin name keeps its own order and its punctuation stays with it, and the sentence around
 * it is not reordered by the name's direction. Works for strings (labels, confirmations) where markup cannot.
 */
export const isolate = (name: string): string => `⁨${name}⁩`;
