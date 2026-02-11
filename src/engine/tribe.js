let TRIBE_SEQ = 1;

function average(values) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export class Tribe {
  constructor({ id, members = [], sharedResources, center = { x: 0, y: 0 }, stability = 1 }) {
    this.id = id ?? `tribe-${TRIBE_SEQ++}`;
    this.members = [...new Set(members)];
    this.sharedResources = {
      food: sharedResources?.food ?? 0,
      wood: sharedResources?.wood ?? 0,
      materials: sharedResources?.materials ?? 0,
    };
    this.center = { x: center.x, y: center.y };
    this.stability = Math.max(0, stability);
  }

  refreshCenter(agentMap) {
    const memberAgents = this.members.map((id) => agentMap.get(id)).filter(Boolean);
    if (memberAgents.length === 0) {
      this.center = { x: 0, y: 0 };
      return;
    }

    this.center = {
      x: average(memberAgents.map((agent) => agent.x)),
      y: average(memberAgents.map((agent) => agent.y)),
    };
  }

  toSerializable() {
    return {
      id: this.id,
      members: [...this.members],
      sharedResources: { ...this.sharedResources },
      center: { ...this.center },
      stability: this.stability,
    };
  }
}
