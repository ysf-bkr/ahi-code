import { AgentDefinition, SubagentRoleInfo } from './types';
import { analyst } from './registry/analyst';
import { architect } from './registry/architect';
import { backend } from './registry/backend';
import { database } from './registry/database';
import { devops } from './registry/devops';
import { explorer } from './registry/explorer';
import { frontend } from './registry/frontend';
import { git } from './registry/git';
import { manager } from './registry/manager';
import { mobile } from './registry/mobile';
import { native } from './registry/native';
import { quality } from './registry/quality';
import { security } from './registry/security';

export * from './types';
export {
  analyst,
  architect,
  backend,
  database,
  devops,
  explorer,
  frontend,
  git,
  manager,
  mobile,
  native,
  quality,
  security
};

export const ALL_AGENT_DEFINITIONS: readonly AgentDefinition[] = [
  manager,
  analyst,
  architect,
  backend,
  frontend,
  mobile,
  native,
  database,
  devops,
  explorer,
  git,
  quality,
  security
];

export const AGENT_DEFINITIONS_MAP: Readonly<Record<string, AgentDefinition>> = Object.freeze(
  ALL_AGENT_DEFINITIONS.reduce<Record<string, AgentDefinition>>((acc, agent) => {
    acc[agent.name] = agent;
    return acc;
  }, {})
);

export function getAgentDefinition(name: string): AgentDefinition | undefined {
  return AGENT_DEFINITIONS_MAP[name.toLowerCase()];
}

/** Geriye dönük uyumluluk için eski rol takma adları. */
export const ROLE_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  coder: 'backend',
  tester: 'quality',
  reviewer: 'quality'
});

export const BUILT_IN_SUBAGENT_ROLES: readonly SubagentRoleInfo[] = [
  {
    role: 'manager',
    name: 'Yönetici',
    description: 'Görev delegasyonu, bağımlılık koordinasyonu ve ajan orkestrasyonu',
    tier: 'supreme',
    capability: 10,
    tags: ['core', 'orchestration', 'governance']
  },
  {
    role: 'analyst',
    name: 'İş Analisti',
    description: 'Gereksinim analizi, şartname doğrulama ve sözleşme denetimi',
    tier: 'recon',
    capability: 9,
    tags: ['core', 'strategy']
  },
  {
    role: 'architect',
    name: 'Mimar',
    description: 'Sistem tasarımı, mimari analizi ve uygulama planlaması',
    tier: 'core',
    capability: 9,
    tags: ['core', 'design']
  },
  {
    role: 'backend',
    name: 'Backend Uzmanı',
    description: 'API rotaları, servisler, iş mantığı ve sunucu kodları',
    tier: 'core',
    capability: 9,
    tags: ['core', 'logic']
  },
  {
    role: 'frontend',
    name: 'Frontend Uzmanı',
    description: 'Kullanıcı arayüzü, React/Next.js, bileşenler ve durum yönetimi',
    tier: 'core',
    capability: 9,
    tags: ['core', 'ui']
  },
  {
    role: 'mobile',
    name: 'Mobil Uzmanı',
    description: 'React Native, Expo, iOS/Android mobil uygulama geliştirme',
    tier: 'core',
    capability: 9,
    tags: ['mobile', 'ui']
  },
  {
    role: 'native',
    name: 'Sistem / Native Uzmanı',
    description: 'Rust, Go, C/C++, sistem çağrıları ve yüksek başarımlı kodlar',
    tier: 'recon',
    capability: 9,
    tags: ['core', 'native']
  },
  {
    role: 'database',
    name: 'Veritabanı Uzmanı',
    description: 'Veritabanı şemaları, migrationlar, indeksleme ve sorgu optimizasyonu',
    tier: 'core',
    capability: 9,
    tags: ['core', 'data']
  },
  {
    role: 'devops',
    name: 'DevOps Uzmanı',
    description: 'CI/CD boru hatları, Docker, altyapı ve dağıtım otomasyonu',
    tier: 'core',
    capability: 9,
    tags: ['core', 'infra']
  },
  {
    role: 'explorer',
    name: 'Keşif Uzmanı',
    description: 'Kod tabanı taraması, bağımlılık haritalama ve derin keşif',
    tier: 'recon',
    capability: 8,
    tags: ['core', 'recon']
  },
  {
    role: 'git',
    name: 'Git Uzmanı',
    description: 'Sürüm kontrolü, dallanma, commit ve PR hazırlığı',
    tier: 'core',
    capability: 8,
    tags: ['core', 'logistics']
  },
  {
    role: 'quality',
    name: 'Kalite Uzmanı',
    description: 'Test otomasyonu, kod inceleme, lint denetimi ve kalite kapıları',
    tier: 'core',
    capability: 9,
    tags: ['core', 'audit', 'discipline']
  },
  {
    role: 'security',
    name: 'Güvenlik Uzmanı',
    description: 'Kimlik doğrulama, şifreleme ve güvenlik politikası denetimi',
    tier: 'supreme',
    capability: 10,
    tags: ['core', 'security']
  }
];

export const BUILT_IN_SUBAGENT_ROLE_IDS: readonly string[] = [
  ...BUILT_IN_SUBAGENT_ROLES.map((agent) => agent.role),
  ...Object.keys(ROLE_ALIASES)
];
