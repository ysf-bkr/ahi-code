import * as path from 'path';
import * as fs from 'fs/promises';
import { frontmatterList, frontmatterScalar, parseFrontmatter } from '../../shared/frontmatter';
import type { AgentDefinition } from '../../shared/agents/types';

export interface DiscoveredSkill {
  name: string;
  description: string;
  path: string;
  content: string;
}

export interface CustomAgentDef {
  name: string;
  role: string;
  description: string;
  path: string;
  prompt: string;
  allowedTools?: string[];
}

export class SkillManager {
  private skills: DiscoveredSkill[] = [];
  private customAgents: CustomAgentDef[] = [];
  private agentsMdContent: string = '';
  private agentsMdPath?: string;

  public async loadWorkspaceCustomizations(workspaceRoot?: string): Promise<void> {
    this.skills = [];
    this.customAgents = [];
    this.agentsMdContent = '';
    this.agentsMdPath = undefined;

    if (!workspaceRoot) return;

    // 1. Kökte AGENTS.md veya agent.md ara
    const rootAgentFiles = ['AGENTS.md', 'agent.md', '.agents.md'];
    for (const f of rootAgentFiles) {
      try {
        const p = path.join(workspaceRoot, f);
        const content = await fs.readFile(p, 'utf-8');
        if (content.trim()) {
          this.agentsMdContent = content.trim();
          this.agentsMdPath = p;
          break;
        }
      } catch {
        // dosya yok
      }
    }

    // 2. .agents/skills/ veya skills/ altında yetenekleri ara
    const skillDirs = [path.join(workspaceRoot, '.agents', 'skills'), path.join(workspaceRoot, 'skills')];
    const seenSkills = new Set<string>();

    for (const sDir of skillDirs) {
      try {
        const entries = await fs.readdir(sDir, { withFileTypes: true });
        // Önce doğrudan .agents/skills/<ad>.md dosyalarını ara (her biri ayrı klasörde olmak zorunda değil)
        for (const entry of entries) {
          if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
            const skillName = entry.name.replace(/\.md$/i, '');
            if (seenSkills.has(skillName.toLowerCase())) continue;
            const skillFile = path.join(sDir, entry.name);
            try {
              const raw = await fs.readFile(skillFile, 'utf-8');
              const skill = this.parseSkillMarkdown(skillName, skillFile, raw);
              this.skills.push(skill);
              seenSkills.add(skillName.toLowerCase());
            } catch {
              // Dosya okunamadı.
            }
          }
        }

        // Geriye dönük uyumluluk: alt klasör içinde SKILL.md varsa
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const skillName = entry.name;
            if (seenSkills.has(skillName.toLowerCase())) continue;
            const skillFile = path.join(sDir, entry.name, 'SKILL.md');
            try {
              const raw = await fs.readFile(skillFile, 'utf-8');
              const skill = this.parseSkillMarkdown(entry.name, skillFile, raw);
              this.skills.push(skill);
              seenSkills.add(skillName.toLowerCase());
            } catch {
              // SKILL.md yok
            }
          }
        }
      } catch {
        // yetenek klasörü yok
      }
    }

    // 3. .agents/agents/ altında özel alt ajanları ara
    const agentDirs = [path.join(workspaceRoot, '.agents', 'agents'), path.join(workspaceRoot, 'agents')];
    const seenAgents = new Set<string>();

    for (const aDir of agentDirs) {
      try {
        const entries = await fs.readdir(aDir, { withFileTypes: true });
        // Önce doğrudan .agents/agents/<ad>.md dosyalarını ara (her ajan ayrı klasörde değil, doğrudan .md)
        for (const entry of entries) {
          if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
            const agentName = entry.name.replace(/\.md$/i, '');
            if (seenAgents.has(agentName.toLowerCase())) continue;
            const agentFile = path.join(aDir, entry.name);
            try {
              const raw = await fs.readFile(agentFile, 'utf-8');
              const agent = this.parseAgentMarkdown(agentName, agentFile, raw);
              this.customAgents.push(agent);
              seenAgents.add(agentName.toLowerCase());
              if (agent.role) seenAgents.add(agent.role.toLowerCase());
            } catch {
              // Dosya okunamadı
            }
          }
        }

        // Geriye dönük uyumluluk: alt klasör içinde AGENT.md varsa
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const agentName = entry.name;
            if (seenAgents.has(agentName.toLowerCase())) continue;
            const agentFile = path.join(aDir, entry.name, 'AGENT.md');
            try {
              const raw = await fs.readFile(agentFile, 'utf-8');
              const agent = this.parseAgentMarkdown(entry.name, agentFile, raw);
              this.customAgents.push(agent);
              seenAgents.add(agentName.toLowerCase());
              if (agent.role) seenAgents.add(agent.role.toLowerCase());
            } catch {
              // AGENT.md yok
            }
          }
        }
      } catch {
        // agents klasörü yok
      }
    }
  }

  public getSkills(): DiscoveredSkill[] {
    return this.skills;
  }

  public getCustomAgents(): CustomAgentDef[] {
    return this.customAgents;
  }

  public getAgentsMd(): string {
    return this.agentsMdContent;
  }

  public getAgentsMdPath(): string | undefined {
    return this.agentsMdPath;
  }

  public getPromptContext(): string {
    let text = '';

    // AGENTS.md kuralları tek yerden WorkspaceRuleManager tarafından eklenir.
    if (this.skills.length > 0) {
      text += `\n\n=== AVAILABLE SKILLS ===\nThe following custom skills are defined under .agents/skills. To use a skill, read its full instructions with the 'read_skill' tool:\n`;
      for (const s of this.skills) {
        text += `- **${s.name}**: ${s.description}\n`;
      }
    }

    if (this.customAgents.length > 0) {
      text += `\n\n=== CUSTOM SUBAGENTS (.agents/agents) ===\nThe following project-specific subagents can be called with 'invoke_subagent':\n`;
      for (const a of this.customAgents) {
        text += `- **${a.name}** (${a.role}): ${a.description}\n`;
      }
    }

    return text;
  }

  public async createTemplateStructure(workspaceRoot: string): Promise<void> {
    const baseDir = path.join(workspaceRoot, '.agents');
    const skillsDir = path.join(baseDir, 'skills');
    const agentsDir = path.join(baseDir, 'agents');

    await fs.mkdir(skillsDir, { recursive: true });
    await fs.mkdir(agentsDir, { recursive: true });

    // Kök AGENTS.md
    const agentsMdPath = path.join(workspaceRoot, 'AGENTS.md');
    try {
      await fs.access(agentsMdPath);
    } catch {
      const templateAgentsMd = `# AhiCode Project Guidelines (AGENTS.md)

This file defines the core principles that the AhiCode agent must follow when writing code and running tests in this project.

## 1. Architectural Principles
- Code should be modular and readable.
- Type safety (TypeScript) is a priority.
- Avoid adding unnecessary external libraries.

## 2. Testing Standards
- Run and verify tests after every change.

## 3. Language Policy
- Keep \`README.md\` and all Markdown files under \`docs/**\` in Turkish.
- Keep all user-facing application UI, including VS Code setting descriptions, in Turkish.
- Use English for all other repository content, including documentation, code comments, logs, tests, and filenames.
`;
      await fs.writeFile(agentsMdPath, templateAgentsMd, 'utf-8');
    }

    // Örnek yetenek: Ayrı klasörde değil, doğrudan .agents/skills/code-quality.md
    const skillPath = path.join(skillsDir, 'code-quality.md');
    try {
      await fs.access(skillPath);
    } catch {
      const templateSkill = `---
name: code-quality
description: Reviews clean-code, linting, and refactoring standards; use when writing or reviewing code.
license: MIT
metadata:
  author: Yusuf BEKAR
  email: ybekar@msn.com
---

# Code Quality

1. Use descriptive names.
2. Follow the single-responsibility principle.
3. Avoid ambiguous types; define types explicitly.
4. Verify lint and type-check results after changes.
`;
      await fs.writeFile(skillPath, templateSkill, 'utf-8');
    }

    // Örnek alt ajan: Ayrı klasörde değil, doğrudan .agents/agents/devops-engineer.md
    const agentPath = path.join(agentsDir, 'devops-engineer.md');
    try {
      await fs.access(agentPath);
    } catch {
      const templateAgent = `---
name: devops-engineer
role: devops
description: Subagent specializing in Docker, CI/CD, package builds, and deployments
tools: read_file, list_directory, search_files, read_skill, write_file, edit_file, execute_command
---

You are the DevOps and environment configuration specialist for this project.
Your task is to optimize build scripts, Dockerfiles, and CI workflows according to best practices.
`;
      await fs.writeFile(agentPath, templateAgent, 'utf-8');
    }
  }

  public async customizeBuiltinAgent(workspaceRoot: string, agentDef: AgentDefinition): Promise<string> {
    const agentsDir = path.join(workspaceRoot, '.agents', 'agents');
    await fs.mkdir(agentsDir, { recursive: true });
    // Her ajan ayrı bir klasörde değil, doğrudan .agents/agents/<name>.md dosyası olarak saklanır.
    const agentFile = path.join(agentsDir, `${agentDef.name}.md`);

    try {
      await fs.access(agentFile);
      return agentFile;
    } catch {
      // Dosya henüz yok, şablondan oluşturulacak
    }

    // Araç listesi tek kaynaktan (ajan tanımı) gelir.
    const defaultTools = agentDef.tools.join(', ');

    const content = `---
name: ${agentDef.name}
role: ${agentDef.role}
description: ${agentDef.description}
tools: ${defaultTools || 'read_file, search_files, list_directory'}
---

# AhiCode — ${agentDef.displayName} (${agentDef.role})

Identity: ${agentDef.instructions.identity}
Mission: ${agentDef.instructions.mission}

## Chain of Thought Protocol:
${agentDef.instructions.chainOfThought}

## Mandatory Discipline Rules:
${agentDef.instructions.rules.map((rule, idx) => `${idx + 1}. ${rule}`).join('\n')}
${agentDef.instructions.knowledgeFiles && agentDef.instructions.knowledgeFiles.length > 0 ? `\n## Reference Standards:\n${agentDef.instructions.knowledgeFiles.join(', ')}\n` : ''}
`;

    await fs.writeFile(agentFile, content, 'utf-8');
    return agentFile;
  }

  public async resetBuiltinAgent(workspaceRoot: string, roleOrName: string): Promise<boolean> {
    const agentsDir = path.join(workspaceRoot, '.agents', 'agents');
    const agentFile = path.join(agentsDir, `${roleOrName}.md`);
    const legacyDir = path.join(agentsDir, roleOrName);
    let deleted = false;
    try {
      await fs.unlink(agentFile);
      deleted = true;
    } catch {
      // dosya yok veya silinemedi
    }
    try {
      await fs.rm(legacyDir, { recursive: true, force: true });
      deleted = true;
    } catch {
      // eski klasör yok
    }
    return deleted;
  }

  private parseSkillMarkdown(folderName: string, filePath: string, content: string): DiscoveredSkill {
    const fields = parseFrontmatter(content);
    return {
      name: frontmatterScalar(fields, 'name', folderName),
      description: frontmatterScalar(fields, 'description', 'Custom skill'),
      path: filePath,
      content
    };
  }

  private parseAgentMarkdown(folderName: string, filePath: string, content: string): CustomAgentDef {
    const fields = parseFrontmatter(content);
    return {
      name: frontmatterScalar(fields, 'name', folderName),
      role: frontmatterScalar(fields, 'role', folderName),
      description: frontmatterScalar(fields, 'description', 'Custom subagent'),
      path: filePath,
      prompt: content,
      allowedTools: frontmatterList(fields, 'tools')
    };
  }
}
