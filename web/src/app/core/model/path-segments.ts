/** A path cut after each `/`, so the template can offer a line break there (`<wbr>`) and nowhere else. */
export function pathSegments(path: string): readonly string[] {
  return path.split(/(?<=\/)/u).filter((segment) => segment.length > 0);
}
