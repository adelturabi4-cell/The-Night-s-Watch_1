/** Primary workflow: explore a location, inspect the evidence, plan the A/B route. */
export const FLOW = [
  { key: 'explore', title: 'Explore', hint: 'Pick a point on Mars' },
  { key: 'location', title: 'Analyze', hint: 'Read the site evidence' },
  { key: 'planner', title: 'Plan route', hint: 'Compare three routes' },
] as const
export type FlowKey = typeof FLOW[number]['key']
