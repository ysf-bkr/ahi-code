/**
 * Çağrı haritasının kimlik ve yol yardımcıları.
 *
 * Kimlik kararlı olmalı: satır numarası kimliğe girmez, böylece dosyada
 * yukarıda bir satır eklenmesi düğüm kimliğini değiştirmez.
 */

/** Aynı ada sahip sembolleri ayırmak için kullanılan ayırıcı. */
const CLASS_SEPARATOR = '.';

/**
 * `dosya#ad` biçiminde kimlik üretir.
 *
 * - Sınıf metodu: `src/a.ts#Sınıf.metot`
 * - Aynı dosyada yinelenen ad: `src/a.ts#ad:2` (1 tabanlı sıra)
 */
export function nodeId(
  file: string,
  name: string,
  options: { className?: string; occurrence?: number } = {}
): string {
  const qualified = options.className ? `${options.className}${CLASS_SEPARATOR}${name}` : name;
  const suffix = options.occurrence && options.occurrence > 1 ? `:${options.occurrence}` : '';
  return `${file}#${qualified}${suffix}`;
}

/** Test dosyası ad desenleri. */
const TEST_PATTERNS = [
  /\.(test|spec)\.[cm]?[jt]sx?$/i,
  /(^|\/)(__tests__|tests?)\//i,
  /_test\.(py|go|rb)$/i,
  /Test\.(java|cs)$/i
];

/** Yolun test dosyası olup olmadığını söyler. */
export function isTestFile(relativePath: string): boolean {
  return TEST_PATTERNS.some((pattern) => pattern.test(relativePath));
}

/** Haritaya girmemesi gereken gizli/hassas yollar. */
const SENSITIVE_PATTERNS = [
  /(^|\/)\.env(\..*)?$/i,
  /\.(pem|key|p12|pfx|jks|keystore)$/i,
  /(^|\/)id_rsa(\..*)?$/i,
  /(^|\/)\.git\//i
];

/** Hassas dosya mı? Haritaya sembol olarak girmez. */
export function isSensitivePath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(normalized));
}

/** Haritanın tarayacağı kaynak dosya uzantıları. */
export const SUPPORTED_EXTENSIONS: ReadonlySet<string> = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.cs',
  '.rb',
  '.dart',
  '.c',
  '.cpp',
  '.cc',
  '.h',
  '.hpp',
  '.vue',
  '.svelte'
]);

/** Yolun desteklenen bir kaynak dosyası olup olmadığını söyler. */
export function isSupportedSource(relativePath: string): boolean {
  const lower = relativePath.toLowerCase();
  return [...SUPPORTED_EXTENSIONS].some((extension) => lower.endsWith(extension));
}

/** Tarama dışında bırakılan klasörler. */
export const IGNORED_DIRECTORIES: ReadonlySet<string> = new Set([
  'node_modules',
  'dist',
  'out',
  'build',
  'target',
  'coverage',
  '.git',
  '.ahi',
  '.vscode-test',
  '.next',
  '.dart_tool',
  '.gradle',
  'Pods',
  '__pycache__'
]);
