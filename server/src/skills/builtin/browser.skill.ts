// skills/builtin/browser.skill.ts
// V3 Phase 1 - Step 9 §二：内置技能 —— Browser Skill。

import type { Skill } from '../core/skill';

export const BrowserSkill: Skill = {
  id: 'browser',
  name: 'Browser Skill',
  description: '网页打开、抓取、表单交互',
  capabilities: ['browser', 'web_browse', 'scrape'],
  async execute(input: any) {
    return { skill: 'browser', input, output: `Browsed: ${input}` };
  },
};
