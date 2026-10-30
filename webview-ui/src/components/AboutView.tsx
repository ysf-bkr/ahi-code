import React, { useEffect, useState } from 'react';
import {
  Github,
  ExternalLink,
  Copy,
  Check,
  ShieldCheck,
  Zap,
  Plug,
  Layers,
  Bot,
  Compass,
  Code2,
  Scale,
  Info,
  Monitor,
  FolderOpen,
  RefreshCw,
  BookOpen,
  Bug
} from 'lucide-react';
import { AboutInfo, NavigationDestination } from '@shared/types';
import { ScreenHeader } from './ScreenHeader';
import { Logo } from './Logo';
import { Button, IconButton, LinkButton, ListButton } from './ui';
import { vscode } from '../utils/vscode';

interface AboutViewProps {
  onBack: () => void;
  onSelectMenu?: (destination: NavigationDestination) => void;
  changedFileCount?: number;
}

const REPO_URL = 'https://github.com/ysf-bkr/ahi-code';
const DEVELOPER_NAME = 'Yusuf BEKAR';
const DEVELOPER_EMAIL = 'ybekar@msn.com';

const FEATURES = [
  {
    icon: <Zap className="ahi-icon-sm ahi-text-warning" />,
    title: 'Otonom ReAct',
    desc: 'Planlar, uygular, test eder ve düzeltir.'
  },
  {
    icon: <Compass className="ahi-icon-sm ahi-text-brand" />,
    title: 'Planlama / Kodlama modları',
    desc: 'Planlama sırasında salt okunur korumalar.'
  },
  {
    icon: <Plug className="ahi-icon-sm ahi-text-info" />,
    title: 'MCP desteği',
    desc: 'Harici araçlar ve sunucular.'
  },
  {
    icon: <Layers className="ahi-icon-sm ahi-text-success" />,
    title: 'LSP entegrasyonu',
    desc: 'Tanılar, tanımlara gitme ve üzerine gelme.'
  },
  {
    icon: <Bot className="ahi-icon-sm ahi-text-brand" />,
    title: 'Alt ajanlar',
    desc: 'Görevleri uzman rollere devreder.'
  },
  {
    icon: <ShieldCheck className="ahi-icon-sm ahi-text-error" />,
    title: 'Güvenlik',
    desc: 'Yol kısıtlamaları, izinler ve denetim.'
  }
];

const SHORTCUTS = [
  { keys: 'Enter', desc: 'Mesajı gönder' },
  { keys: 'Shift + Enter', desc: 'Yeni satır' }
];

const openUrl = (url: string) => vscode.postMessage({ type: 'OPEN_EXTERNAL', payload: { url } });

export const AboutView: React.FC<AboutViewProps> = ({ onBack, onSelectMenu, changedFileCount }) => {
  const [info, setInfo] = useState<AboutInfo | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    vscode.postMessage({ type: 'GET_ABOUT_INFO' });
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'ABOUT_INFO_LOADED') {
        setInfo(event.data.payload);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const refreshInfo = () => {
    setInfo(null);
    vscode.postMessage({ type: 'GET_ABOUT_INFO' });
  };

  const diagnostics = () => {
    const lines = [
      'AhiCode tanılama bilgileri',
      `Geliştirici: ${DEVELOPER_NAME} <${DEVELOPER_EMAIL}>`,
      `Eklenti: ${info?.extensionVersion || __APP_VERSION__}`,
      `VS Code: ${info?.vscodeVersion || 'bilinmiyor'}`,
      `Platform: ${info?.platform || 'bilinmiyor'}`,
      `Çalışma alanı güvenilir: ${info?.isTrusted ?? 'bilinmiyor'}`,
      `Çalışma alanı kökleri: ${(info?.workspaceFolders || []).join(', ') || '(yok)'}`,
      `Tarih: ${new Date().toISOString()}`
    ].join('\n');

    navigator.clipboard
      .writeText(lines)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      })
      .catch(() => {});
  };

  const version = info?.extensionVersion || __APP_VERSION__;

  return (
    <div className="ahi-screen">
      <ScreenHeader
        title="Hakkında"
        subtitle="AhiCode bilgileri ve tanılama"
        onBack={onBack}
        onSelectMenu={onSelectMenu}
        changedFileCount={changedFileCount}
        actions={
          <IconButton label="Bilgileri yenile" onClick={refreshInfo} small>
            <RefreshCw className={`ahi-icon-xs ${!info ? 'animate-spin' : ''}`} />
          </IconButton>
        }
      />

      <div className="ahi-screen-body">
        <div className="ahi-soft-card flex flex-col items-center rounded-lg border ahi-border-surface p-4 text-center">
          <div className="ahi-avatar ahi-avatar-soft ahi-avatar--xl">
            <Logo className="ahi-icon-2xl" colored strokeWidth={1.3} />
          </div>
          <div className="mt-2 text-sm font-semibold tracking-tight ahi-text-fg">AhiCode</div>
          <div className="mt-0.5 flex items-center gap-1.5">
            <span className="rounded-full ahi-bg-accent px-1.5 py-0.5 font-mono ahi-text-on-accent text-2xs">
              v{version}
            </span>
            <span className="rounded-full border ahi-border-surface px-1.5 py-0.5 text-2xs ahi-text-muted">
              MIT
            </span>
            <span className="rounded-full border ahi-border-surface px-1.5 py-0.5 text-2xs ahi-text-muted">
              Açık kaynak
            </span>
          </div>
          <p className="mt-2 max-w-[280px] text-xs leading-relaxed ahi-text-muted">
            Ahilik zanaat disiplini ve mühendislik titizliğiyle projenizi anlayan, mimariyi kavrayan, kod
            yazan ve testlerle doğrulayan yapay zekâ yazılım ajanı.
          </p>
          <div className="mt-2 text-2xs ahi-text-muted">
            Geliştirici: <span className="font-medium ahi-text-fg">{DEVELOPER_NAME}</span>
          </div>
          <LinkButton
            plain
            onClick={() => openUrl(`mailto:${DEVELOPER_EMAIL}`)}
            className="mt-1 font-mono text-2xs"
            title="E-posta gönder"
          >
            {DEVELOPER_EMAIL}
          </LinkButton>
          <div className="mt-2.5 flex items-center gap-1.5">
            <Button
              variant="primary"
              size="xs"
              onClick={() => openUrl(REPO_URL)}
              icon={<Github className="ahi-icon-xs" />}
            >
              GitHub
            </Button>
            <Button
              variant="secondary"
              size="xs"
              onClick={() => openUrl(`${REPO_URL}#readme`)}
              icon={<BookOpen className="ahi-icon-xs" />}
            >
              README
            </Button>
          </div>
        </div>

        <section className="space-y-1.5">
          <div className="px-0.5 ahi-overline ahi-text-muted">Özellikler</div>
          <div className="grid grid-cols-2 gap-1.5">
            {FEATURES.map((feature) => (
              <div key={feature.title} className="rounded-md border ahi-border-surface ahi-bg-raised p-2">
                <div className="flex items-center gap-1.5">
                  {feature.icon}
                  <span className="text-xs font-medium ahi-text-fg">{feature.title}</span>
                </div>
                <div className="mt-0.5 text-2xs leading-relaxed ahi-text-muted">{feature.desc}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-1.5">
          <div className="px-0.5 ahi-overline ahi-text-muted">Ortam</div>
          <div className="space-y-1 rounded-md border ahi-border-surface ahi-bg-raised p-2.5">
            <div className="flex items-center justify-between gap-2 text-2xs">
              <span className="flex items-center gap-1 ahi-text-muted">
                <Code2 className="ahi-icon-xs" /> Eklenti
              </span>
              <span className="font-mono ahi-text-fg">v{version}</span>
            </div>
            <div className="flex items-center justify-between gap-2 text-2xs">
              <span className="flex items-center gap-1 ahi-text-muted">
                <Monitor className="ahi-icon-xs" /> VS Code
              </span>
              <span className="font-mono ahi-text-fg">{info?.vscodeVersion || '...'}</span>
            </div>
            <div className="flex items-center justify-between gap-2 text-2xs">
              <span className="flex items-center gap-1 ahi-text-muted">
                <Info className="ahi-icon-xs" /> İşletim sistemi
              </span>
              <span className="font-mono ahi-text-fg">{info?.platform || '...'}</span>
            </div>
            <div className="flex items-center justify-between gap-2 text-2xs">
              <span className="flex items-center gap-1 ahi-text-muted">
                <FolderOpen className="ahi-icon-xs" /> Çalışma alanı
              </span>
              <span className="max-w-[140px] truncate font-mono ahi-text-fg">
                {info?.workspaceFolders?.length ? info.workspaceFolders.join(', ') : '(açık değil)'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2 text-2xs">
              <span className="flex items-center gap-1 ahi-text-muted">
                <ShieldCheck className="ahi-icon-xs" /> Güven
              </span>
              <span className={`font-mono ${info?.isTrusted ? 'ahi-text-success' : 'ahi-text-warning'}`}>
                {info ? (info.isTrusted ? 'güvenilir' : 'kısıtlı') : '...'}
              </span>
            </div>

            <Button
              variant="secondary"
              size="xs"
              block
              onClick={diagnostics}
              className="mt-1"
              icon={
                copied ? <Check className="ahi-icon-xs ahi-text-success" /> : <Copy className="ahi-icon-xs" />
              }
            >
              {copied ? 'Tanılama bilgileri kopyalandı' : 'Tanılama bilgilerini kopyala'}
            </Button>
          </div>
        </section>

        <section className="space-y-1.5">
          <div className="px-0.5 ahi-overline ahi-text-muted">Kısayollar</div>
          <div className="rounded-md border ahi-border-surface ahi-bg-raised p-2">
            {SHORTCUTS.map((shortcut, index) => (
              <div
                key={shortcut.keys}
                className={`flex items-center justify-between gap-2 py-0.5 text-2xs ${index > 0 ? 'border-t ahi-border-surface' : ''}`}
              >
                <span className="ahi-text-muted">{shortcut.desc}</span>
                <kbd className="rounded border ahi-border-surface ahi-bg-input px-1 py-0.5 font-mono text-2xs ahi-text-fg">
                  {shortcut.keys}
                </kbd>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-1.5">
          <div className="px-0.5 ahi-overline ahi-text-muted">Bağlantılar</div>
          <div className="space-y-1">
            <ListButton
              onClick={() => openUrl(`${REPO_URL}/issues`)}
              icon={<Bug className="ahi-icon-sm ahi-text-error" />}
              title="Sorun bildir"
              trailing={<ExternalLink className="ahi-icon-xs opacity-50" />}
            />
            <ListButton
              onClick={() => openUrl(REPO_URL)}
              icon={<Github className="ahi-icon-sm ahi-text-brand" />}
              title="Kaynak kod"
              trailing={<ExternalLink className="ahi-icon-xs opacity-50" />}
            />
          </div>
        </section>

        <section className="rounded-md border ahi-border-surface ahi-bg-raised p-2.5">
          <div className="flex items-center gap-1.5 ahi-title">
            <Scale className="ahi-icon-xs ahi-text-brand" /> Lisans ve yasal bilgiler
          </div>
          <p className="mt-1 text-2xs leading-relaxed ahi-text-muted">
            AhiCode eklentisi MIT lisansı altında lisanslanmıştır ve {DEVELOPER_NAME} tarafından bağımsız açık
            kaynaklı bir proje olarak geliştirilmektedir.
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1 text-2xs ahi-text-muted">
            <span className="rounded ahi-bg-base px-1.5 py-0.5">React</span>
            <span className="rounded ahi-bg-base px-1.5 py-0.5">Lucide</span>
            <span className="rounded ahi-bg-base px-1.5 py-0.5">esbuild</span>
            <span className="rounded ahi-bg-base px-1.5 py-0.5">VS Code API</span>
          </div>
        </section>

        <div className="pb-2 text-center text-2xs ahi-text-muted">
          AhiCode · {DEVELOPER_NAME} · Bağımsız açık kaynaklı proje
        </div>
      </div>
    </div>
  );
};
