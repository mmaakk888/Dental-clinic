/** Retain visited editors to preserve drafts, without mounting untouched sections. */
export function retainVisitedSettingsSection<Section extends string>(visited: ReadonlySet<Section>, section: Section): ReadonlySet<Section> {
  if (visited.has(section)) return visited;
  return new Set([...visited, section]);
}
