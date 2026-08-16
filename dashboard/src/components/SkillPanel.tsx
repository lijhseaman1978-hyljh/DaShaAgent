// V3 Phase 3 - Step 2 §十三：SkillPanel —— 团队成员与已装技能。
type Agent = { id: string; name: string; role: string };
type Skill = { name: string };

export default function SkillPanel({ agents, skills }: { agents: Agent[]; skills: Skill[] }) {
  if (agents.length === 0 && skills.length === 0) return <div className="empty">暂无</div>;
  return (
    <ul className="list">
      {agents.map((a) => (
        <li key={a.id ?? a.name}>
          <span>{a.name}</span>
          <span className="pill p-idle">{a.role}</span>
        </li>
      ))}
      {skills.map((s, i) => (
        <li key={`${s.name}-${i}`}>
          <span>{s.name}</span>
          <span className="pill p-ok">skill</span>
        </li>
      ))}
    </ul>
  );
}
