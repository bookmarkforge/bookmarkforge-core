/**
 * Compare two RxDB revision strings deterministically.
 *
 * Valid RxDB revisions have the shape `<height>-<hash>`. The height is a
 * logical clock and must be compared numerically: lexical comparison would
 * incorrectly rank `9-...` above `10-...`. Malformed revisions retain a
 * deterministic code-unit fallback rather than throwing on untrusted input.
 */
export function compareRxRevision(left: string, right: string): number {
  const leftMatch = /^(\d+)-(.+)$/.exec(left);
  const rightMatch = /^(\d+)-(.+)$/.exec(right);

  if (leftMatch && rightMatch) {
    const leftHeight = leftMatch[1]!.replace(/^0+(?=\d)/, "");
    const rightHeight = rightMatch[1]!.replace(/^0+(?=\d)/, "");
    if (leftHeight.length !== rightHeight.length) {
      return leftHeight.length > rightHeight.length ? 1 : -1;
    }
    if (leftHeight !== rightHeight) {
      return leftHeight > rightHeight ? 1 : -1;
    }

    const hashComparison = compareCodeUnits(leftMatch[2]!, rightMatch[2]!);
    if (hashComparison !== 0) return hashComparison;
  }

  return compareCodeUnits(left, right);
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
